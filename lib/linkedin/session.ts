import { chromium } from "playwright-extra";
import type { Browser, BrowserContext, Page } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getDb } from "@/lib/db";

chromium.use(StealthPlugin());

let browser: Browser | null = null;
const contexts: Map<string, BrowserContext> = new Map();

const HEADLESS = process.env.HEADLESS !== "false";
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

function getProxyConfig(): { server: string; username?: string; password?: string } | undefined {
  const raw = process.env.LINKI_PROXY;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const server = `${url.protocol}//${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
    const username = url.username || undefined;
    const password = url.password || undefined;
    return username ? { server, username, password } : { server };
  } catch {
    // Plain host:port without protocol — assume http
    const match = raw.match(/^(.+):(\d+)$/);
    if (match) return { server: `http://${match[1]}:${match[2]}` };
    console.warn(`[session] Invalid LINKI_PROXY format: ${raw} — expected http://host:port or http://user:pass@host:port`);
    return undefined;
  }
}

async function getBrowser(headless = HEADLESS): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless,
      executablePath: CHROMIUM_PATH,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return browser;
}

async function getOrCreateContext(accountId: string): Promise<BrowserContext> {
  const db = getDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as
    | { cookies_json: string | null; email: string }
    | undefined;

  if (!account) throw new Error(`Account ${accountId} not found`);

  if (!contexts.has(accountId)) {
    const b = await getBrowser();

    let storageState: object | undefined;
    if (account.cookies_json) {
      try {
        storageState = JSON.parse(account.cookies_json);
      } catch {
        // Invalid storage state — will need re-auth
      }
    }

    const proxy = getProxyConfig();
    const ctx = await b.newContext({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      storageState: storageState as any,
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["clipboard-read", "clipboard-write"],
      ...(proxy ? { proxy } : {}),
    });
    if (proxy) console.log(`[session] Using proxy ${proxy.server} for account ${accountId}`);

    // Auto-evict from map when context closes for any reason (crash, session expiry, etc.)
    ctx.on("close", () => { if (contexts.get(accountId) === ctx) contexts.delete(accountId); });

    contexts.set(accountId, ctx);
  }

  return contexts.get(accountId)!;
}

/** Returns the BrowserContext for an account (for API calls via ctx.request) */
export async function getSessionContext(accountId: string): Promise<BrowserContext> {
  try {
    return await getOrCreateContext(accountId);
  } catch {
    // First attempt failed — evict and retry once with a fresh context
    contexts.delete(accountId);
    return getOrCreateContext(accountId);
  }
}

/** Returns a new Page from the account's browser context */
export async function getSessionPage(accountId: string): Promise<Page> {
  const ctx = await getOrCreateContext(accountId);
  try {
    return await ctx.newPage();
  } catch {
    // Context was dead — evict and retry once with a fresh context
    contexts.delete(accountId);
    const freshCtx = await getOrCreateContext(accountId);
    return freshCtx.newPage();
  }
}

export async function saveSessionState(accountId: string): Promise<void> {
  const ctx = contexts.get(accountId);
  if (!ctx) return;
  const db = getDb();
  const state = await ctx.storageState();
  db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
    JSON.stringify(state),
    accountId
  );
}

export async function closeSession(accountId: string): Promise<void> {
  const ctx = contexts.get(accountId);
  if (ctx) {
    await ctx.close();
    contexts.delete(accountId);
  }
}

/**
 * Opens a visible browser, navigates to LinkedIn login, and waits for the user
 * to complete login manually. Returns when the user reaches /feed.
 * Saves the full storage state to DB and marks account as authenticated.
 */
export async function authenticateAccount(accountId: string): Promise<void> {
  const db = getDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as
    | { email: string }
    | undefined;
  if (!account) throw new Error(`Account ${accountId} not found`);

  // Close any existing context for this account — start fresh
  await closeSession(accountId);

  // Always launch a VISIBLE browser for manual login
  const visibleBrowser = await chromium.launch({
    headless: false,
    executablePath: CHROMIUM_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const proxy = getProxyConfig();
    const ctx = await visibleBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      ...(proxy ? { proxy } : {}),
    });
    if (proxy) console.log(`[session] Using proxy ${proxy.server} for manual auth`);

    const page = await ctx.newPage();
    await page.goto("https://www.linkedin.com/login");

    // Pre-fill email to save the user a step
    try {
      await page.waitForSelector("input#username", { timeout: 5000 });
      await page.fill("input#username", account.email);
    } catch {
      // Input not found — page may have redirected already
    }

    // Wait up to 3 minutes for the user to complete login and reach /feed
    await page.waitForURL("**/feed/**", { timeout: 180_000 });

    // Save full storage state (cookies + localStorage) to DB
    const state = await ctx.storageState();
    db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
      JSON.stringify(state),
      accountId
    );

    await ctx.close();
  } finally {
    await visibleBrowser.close();
  }
}
