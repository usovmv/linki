import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const { sales_nav_url, account_id } = req.body;
  if (!sales_nav_url) return res.status(400).json({ error: "sales_nav_url required" });
  if (!account_id) return res.status(400).json({ error: "account_id required" });

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(account_id) as
    | { cookies_json: string | null; is_authenticated: number }
    | undefined;
  if (!account) return res.status(400).json({ error: "Account not found" });
  if (!account.is_authenticated || !account.cookies_json) {
    return res.status(400).json({ error: "Account not authenticated. Please authenticate first." });
  }

  // Check if there's already a running import for this list
  const existing = db.prepare(
    "SELECT id FROM list_imports WHERE list_id = ? AND status = 'running'"
  ).get(listId);
  if (existing) {
    return res.status(409).json({ error: "Import already in progress for this list" });
  }

  // Create the import job record
  const importId = randomUUID();
  db.prepare(
    "INSERT INTO list_imports (id, list_id, status, started_at) VALUES (?, ?, 'running', datetime('now'))"
  ).run(importId, listId);

  // Save the Sales Nav URL on the list
  db.prepare("UPDATE lists SET sales_nav_url = ? WHERE id = ?").run(sales_nav_url, listId);

  // Respond immediately — client will poll import-status
  res.json({ started: true, importId });

  const { enrich } = req.body as { enrich?: boolean };

  // Fire and forget — run after response is sent
  setImmediate(async () => {
    console.log(`[import] starting import job ${importId} for list ${listId}`);
    const { getSessionContext } = await import("@/lib/linkedin/session");
    const { scrapeNavigatorUrl } = await import("@/lib/linkedin/scraper");

    const updateProgress = db.prepare(`
      UPDATE list_imports SET phase = ?, page = ?, total_pages = ?, count = ?, total = ? WHERE id = ?
    `);

    try {
      console.log(`[import] getting session context for account ${account_id}`);
      const ctx = await getSessionContext(account_id);
      console.log(`[import] session context ready, starting scrape of: ${sales_nav_url}`);

      // Phase 1+2: scrape pages + resolve flagship URLs (both reported via onProgress)
      const profiles = await scrapeNavigatorUrl(ctx, sales_nav_url, 50, (p) => {
        console.log(`[import] progress: phase=${p.phase} count=${p.count}/${p.total} page=${p.page ?? '-'}/${p.totalPages ?? '-'}`);
        updateProgress.run(p.phase, p.page ?? 0, p.totalPages ?? 0, p.count, p.total, importId);
      });
      console.log(`[import] scrape complete: ${profiles.length} profiles returned`);

      // Insert all profiles
      const insertTarget = db.prepare(
        `INSERT INTO targets (
           id, linkedin_url, sales_nav_url, first_name, last_name, full_name,
           title, company, location, degree,
           object_urn, summary, open_link, company_industry, company_location,
           tenure_months, spotlight_badges
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(linkedin_url) DO UPDATE SET
           sales_nav_url = excluded.sales_nav_url,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           full_name = excluded.full_name,
           title = excluded.title,
           company = excluded.company,
           location = excluded.location,
           degree = excluded.degree,
           object_urn = excluded.object_urn,
           summary = excluded.summary,
           open_link = excluded.open_link,
           company_industry = excluded.company_industry,
           company_location = excluded.company_location,
           tenure_months = excluded.tenure_months,
           spotlight_badges = excluded.spotlight_badges`
      );
      const insertLink = db.prepare(
        "INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)"
      );
      const findTarget = db.prepare("SELECT id FROM targets WHERE linkedin_url = ?");

      let imported = 0;
      let skipped = 0;

      db.transaction(() => {
        for (const p of profiles) {
          const url = p.linkedinUrl ?? p.salesNavUrl;
          insertTarget.run(
            randomUUID(), url, p.salesNavUrl,
            p.firstName, p.lastName, p.fullName,
            p.title, p.company, p.location, p.degree,
            p.objectUrn, p.summary, p.openLink ? 1 : 0,
            p.companyIndustry, p.companyLocation,
            p.tenureMonths, p.spotlightBadges
          );
          const target = findTarget.get(url) as { id: string };
          const result = insertLink.run(listId, target.id);
          if (result.changes > 0) imported++;
          else skipped++;
        }
      })();

      // Phase 3: Sales Nav profile visits (optional, only if enrich checkbox was checked)
      if (enrich) {
        const { enrichList } = await import("@/lib/linkedin/enrich");
        const pendingCount = db.prepare(`
          SELECT COUNT(*) as c FROM targets t
          JOIN list_targets lt ON lt.target_id = t.id
          WHERE lt.list_id = ? AND t.sales_nav_url IS NOT NULL AND t.enriched_profile_at IS NULL
        `).get(listId) as { c: number };

        updateProgress.run('visiting', 0, 0, 0, pendingCount.c, importId);
        await enrichList(ctx, listId, 2000, (count, total) => {
          updateProgress.run('visiting', 0, 0, count, total, importId);
        });
      }

      console.log(`[import] inserted ${imported} new, skipped ${skipped} duplicates`);
      db.prepare(`
        UPDATE list_imports
        SET status = 'done', imported = ?, skipped = ?, count = ?, total = ?, finished_at = datetime('now')
        WHERE id = ?
      `).run(imported, skipped, profiles.length, profiles.length, importId);
      console.log(`[import] job ${importId} marked done`);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[import] FAILED:", message);
      if (err instanceof Error && err.stack) console.error("[import] stack:", err.stack);
      db.prepare(
        "UPDATE list_imports SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?"
      ).run(message, importId);
    }
  });
}

export const config = {
  api: { responseLimit: false, bodyParser: { sizeLimit: "1mb" } },
};
