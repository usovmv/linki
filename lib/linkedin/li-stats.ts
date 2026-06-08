import type { Page } from "playwright";

export interface LinkedInStats {
  connections: number;
  pending: number;
  profile_views: number;
}

function parseNum(str: string): number {
  return parseInt(str.replace(/[^0-9]/g, ""), 10) || 0;
}

export async function scrapeLinkedInStats(page: Page): Promise<LinkedInStats> {
  let connections = 0;
  let pending = 0;
  let profile_views = 0;

  // ── Step 1: Load the connections page ─────────────────────
  try {
    await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
  } catch (e) {
    console.warn("[li-stats] Connections page failed:", e instanceof Error ? e.message : e);
    return { connections: 0, pending: 0, profile_views: 0 };
  }

  // Extract connection count from page DOM
  try {
    const connectionsTexts = await page.evaluate(() =>
      [...document.querySelectorAll("h1,h2,h3,span,p")]
        .map(el => ((el as HTMLElement).innerText ?? "").trim())
        .filter(t => /\d.*connection/i.test(t))
    );
    connections = parseNum(connectionsTexts[0] ?? "0");
  } catch (e) {
    console.warn("[li-stats] Connections DOM scrape failed:", e instanceof Error ? e.message : e);
  }

  // ── Step 2: Get pending via Voyager API from the same page context ─
  try {
    const cookies = await page.context().cookies("https://www.linkedin.com");
    const jsessionid = cookies.find(c => c.name === "JSESSIONID")?.value?.replace(/"/g, "") ?? "";
    const csrf = jsessionid || "ajax:0";

    const result = await page.evaluate(async ({ url, csrfToken }) => {
      const resp = await fetch(url, {
        credentials: "include",
        headers: {
          "accept": "application/vnd.linkedin.normalized+json+2.1",
          "x-restli-protocol-version": "2.0.0",
          "csrf-token": csrfToken,
        },
      });
      if (!resp.ok) return { error: `status ${resp.status}` };
      const data = await resp.json();
      // Extract pending count from response — field name varies
      const p = data?.data?.paging?.total ?? data?.paging?.total ?? 0;
      return { pending: p, raw: JSON.stringify(data).slice(0, 500) };
    }, {
      url: "https://www.linkedin.com/voyager/api/relationships/dash/connections?count=0&q=search&sortType=RECENTLY_ADDED",
      csrfToken: csrf,
    });

    if (result.pending !== undefined) {
      pending = result.pending;
      console.log("[li-stats] Voyager pending:", pending);
    } else {
      console.warn("[li-stats] Voyager pending failed:", (result as { error: string }).error);
    }
  } catch (e) {
    console.warn("[li-stats] Pending Voyager call failed:", e instanceof Error ? e.message : e);
  }

  // ── Step 3: Try profile views page ────────────────────────
  try {
    await page.goto("https://www.linkedin.com/analytics/profile-views/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(3000);

    const profileViewsTexts = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .map(el => ((el as HTMLElement).innerText ?? "").trim())
        .filter(t => /Profile viewers/i.test(t) && t.length < 100)
    );
    const pvBlock = profileViewsTexts[0] ?? "";
    profile_views = parseNum(pvBlock.split("\n")[0]);
  } catch (e) {
    console.warn("[li-stats] Profile views page failed:", e instanceof Error ? e.message : e);
  }

  return { connections, pending, profile_views };
}
