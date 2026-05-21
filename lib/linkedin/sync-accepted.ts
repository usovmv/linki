import type { Page } from "playwright";
import { getDb } from "@/lib/db";
import { getSessionPage, saveSessionState } from "@/lib/linkedin/session";

const ACCEPTED_SYNC_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8h — 3x per day
const MAX_SCROLL_ROUNDS = 150; // safety cap (150 * 10 = 1500 max pending)
const SCROLL_WAIT_MS = 3500;
const STABLE_ROUNDS_REQUIRED = 8;

export function shouldSyncAccepted(accountId: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT accepted_sync_at FROM accounts WHERE id = ?").get(accountId) as
    | { accepted_sync_at: string | null }
    | undefined;
  if (!row?.accepted_sync_at) return true;
  return Date.now() - new Date(row.accepted_sync_at).getTime() >= ACCEPTED_SYNC_INTERVAL_MS;
}

/**
 * Scrolls /mynetwork/invitation-manager/sent/ to completion, extracts all
 * still-pending vanity names from RSC pagination responses, then stamps
 * degree=1 / connected_at on any DB contact whose invite has disappeared.
 *
 * Returns the number of contacts stamped as accepted.
 */
export async function syncAcceptedConnections(accountId: string): Promise<number> {
  const db = getDb();
  const page = await getSessionPage(accountId);
  let stamped = 0;

  try {
    const pendingVanityNames = await scrapeAllPendingVanityNames(page);

    if (pendingVanityNames === null) {
      console.warn("[sync-accepted] Could not determine pending list — skipping stamp");
      return 0;
    }

    const declaredTotal = pendingVanityNames.declared;
    const extracted = pendingVanityNames.vanityNames;

    console.log(`[sync-accepted] Extracted ${extracted.size}/${declaredTotal} pending vanity names`);

    // Find all DB contacts waiting for acceptance
    const waiting = db.prepare(`
      SELECT id, full_name, linkedin_url
      FROM targets
      WHERE connection_requested_at IS NOT NULL
        AND (degree IS NULL OR degree != 1)
        AND connected_at IS NULL
    `).all() as Array<{ id: string; full_name: string | null; linkedin_url: string | null }>;

    for (const target of waiting) {
      const vanity = extractVanity(target.linkedin_url);
      if (!vanity) continue;

      // If their vanity name is NOT in the still-pending set → they accepted
      if (!extracted.has(vanity)) {
        db.prepare("UPDATE targets SET degree = 1, connected_at = datetime('now') WHERE id = ?").run(target.id);
        console.log(`[sync-accepted] Accepted: ${target.full_name ?? vanity}`);
        stamped++;
      }
    }

    console.log(`[sync-accepted] Stamped ${stamped} contacts as accepted`);
  } finally {
    try { await page.close(); } catch { /* ignore — page may already be dead */ }
    try { await saveSessionState(accountId); } catch { /* ignore — context may be dead */ }
    db.prepare("UPDATE accounts SET accepted_sync_at = datetime('now') WHERE id = ?").run(accountId);
  }

  return stamped;
}

// ── helpers ──────────────────────────────────────────────────────────────────

interface ScrapeResult {
  vanityNames: Set<string>;
  declared: number;
}

async function scrapeAllPendingVanityNames(page: Page): Promise<ScrapeResult | null> {
  const vanityNames = new Set<string>();
  let rscPageCount = 0;

  page.on("response", async (res) => {
    if (!res.url().includes("rsc-action/actions/pagination")) return;
    try {
      const body = await res.text();
      const matches = body.matchAll(/\/in\/([a-zA-Z0-9_%.-]+)/g);
      for (const m of matches) {
        vanityNames.add(decodeVanity(m[1]));
      }
      rscPageCount++;
    } catch {
      // Race condition reading response — harmless, next scroll will catch remaining
    }
  });

  await page.goto("https://www.linkedin.com/mynetwork/invitation-manager/sent/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(4000);

  // Read the declared total from the page tab label e.g. "People (485)"
  const declared = await page.evaluate((): number => {
    const texts = [...document.querySelectorAll("button, span, li, h2, h3")]
      .map(el => el.textContent?.trim() ?? "")
      .filter(t => /People\s*\(\d+\)/i.test(t) || /Sent\s*\(\d+\)/i.test(t));
    const match = texts[0]?.match(/\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
  });

  if (declared === 0) {
    // No pending invitations at all — nothing to check
    return { vanityNames, declared: 0 };
  }

  // Scroll loop — stop when RSC pages stop firing
  let lastRscCount = rscPageCount;
  let stableRounds = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      document.documentElement.scrollTop = document.documentElement.scrollHeight;
      const scrollables = [...document.querySelectorAll("*")].filter(el => {
        const s = window.getComputedStyle(el);
        return (s.overflowY === "auto" || s.overflowY === "scroll") &&
               el.scrollHeight > el.clientHeight + 50;
      });
      scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
      if (scrollables[0]) (scrollables[0] as HTMLElement).scrollTop = scrollables[0].scrollHeight;
    });

    await page.waitForTimeout(SCROLL_WAIT_MS + Math.random() * 500);

    if (rscPageCount === lastRscCount) {
      stableRounds++;
      if (stableRounds >= STABLE_ROUNDS_REQUIRED) break;
    } else {
      stableRounds = 0;
      lastRscCount = rscPageCount;
    }
  }

  return { vanityNames, declared };
}

function decodeVanity(raw: string): string {
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function extractVanity(linkedinUrl: string | null): string | null {
  if (!linkedinUrl) return null;
  const m = linkedinUrl.match(/\/in\/([^/?#]+)/);
  if (!m) return null;
  return decodeVanity(m[1]);
}
