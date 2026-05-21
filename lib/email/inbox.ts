import Imap from "imap";
import { getDb } from "@/lib/db";

const IMAP_POLL_INTERVAL_MS = 5 * 60 * 60 * 1000; // 5 hours

const BOUNCE_SENDER_PATTERNS = [
  /mailer-daemon@/i,
  /postmaster@/i,
  /mail-delivery-subsystem@/i,
  /delivery-status@/i,
  /amazonses\.com$/i,
];

function extractEmails(text: string): string[] {
  return [...text.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)].map(m => m[0].toLowerCase());
}

function isBounce(fromEmail: string): boolean {
  return BOUNCE_SENDER_PATTERNS.some(p => p.test(fromEmail));
}

function parseHeaderValue(raw: string, field: string): string {
  const regex = new RegExp(`^${field}:[ \\t]*(.+?)(?=\\r?\\n[^\\s]|$)`, "im");
  const m = raw.match(regex);
  if (!m) return "";
  return m[1].replace(/\r?\n[\t ]+/g, " ").trim();
}

interface EmailAccount {
  id: string;
  imap_host: string | null;
  imap_port: number | null;
  username: string;
  password: string;
  imap_username: string | null;
  imap_password: string | null;
  inbox_synced_at: string | null;
}

export function shouldSyncEmailInbox(emailAccountId: string): boolean {
  const db = getDb();
  const account = db
    .prepare("SELECT inbox_synced_at FROM email_accounts WHERE id = ?")
    .get(emailAccountId) as { inbox_synced_at: string | null } | undefined;
  if (!account?.inbox_synced_at) return true;
  return Date.now() - new Date(account.inbox_synced_at).getTime() >= IMAP_POLL_INTERVAL_MS;
}

/**
 * Opens one IMAP connection, then for each lead that has been emailed but
 * not yet replied, runs a server-side FROM search. Only touches the mailbox
 * index — never downloads message bodies for reply detection.
 *
 * Also scans the last 50 messages for bounces (mailer-daemon etc.).
 */
export async function syncEmailInbox(emailAccountId: string): Promise<{ replies: number; bounces: number }> {
  const db = getDb();

  const account = db
    .prepare("SELECT id, imap_host, imap_port, username, password, imap_username, imap_password, inbox_synced_at FROM email_accounts WHERE id = ?")
    .get(emailAccountId) as EmailAccount | undefined;

  if (!account?.imap_host) {
    console.warn(`[email-inbox] Account ${emailAccountId} has no IMAP config — skipping`);
    return { replies: 0, bounces: 0 };
  }

  // Leads that were emailed via this account and haven't replied yet
  const pendingTargets = db.prepare(`
    SELECT DISTINCT t.id, t.email
    FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id
    WHERE t.email IS NOT NULL
      AND t.email_replied_at IS NULL
      AND t.email_status != 'invalid'
      AND rt.track = 'email'
      AND rt.state NOT IN ('pending')
      AND rp.email_account_id = ?
  `).all(emailAccountId) as { id: string; email: string }[];

  if (pendingTargets.length === 0) {
    db.prepare("UPDATE email_accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(emailAccountId);
    return { replies: 0, bounces: 0 };
  }

  console.log(`[email-inbox] Checking ${pendingTargets.length} leads via IMAP FROM search`);

  const imapUser = account.imap_username ?? account.username;
  const imapPass = account.imap_password ?? account.password;

  let replies = 0;
  let bounces = 0;

  await new Promise<void>((resolve) => {
    const imap = new Imap({
      host: account.imap_host!,
      port: account.imap_port ?? 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      user: imapUser,
      password: imapPass,
      authTimeout: 10_000,
      connTimeout: 12_000,
    });

    const done = () => {
      try { imap.end(); } catch { /* ignore */ }
      resolve();
    };

    imap.once("error", (err: Error) => {
      console.warn(`[email-inbox] IMAP error for account ${emailAccountId}:`, err.message);
      done();
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", true, async (err, box) => {
        if (err || !box) { console.warn("[email-inbox] openBox failed:", err?.message); done(); return; }

        // ── Reply detection: one FROM search per lead ──────────────────────────
        // Run sequentially — the imap library serialises commands over one TCP connection
        for (const target of pendingTargets) {
          await new Promise<void>((resSearch) => {
            imap.search([["FROM", target.email]], (searchErr, uids) => {
              if (searchErr) { resSearch(); return; }
              if (uids.length > 0) {
                // Confirmed: at least one email received from this address
                const repliedAt = new Date().toISOString();
                db.prepare("UPDATE targets SET email_replied_at = ? WHERE id = ?").run(repliedAt, target.id);
                console.log(`[email-inbox] Reply confirmed for ${target.email} (target ${target.id})`);
                replies++;
              }
              resSearch();
            });
          });
        }

        // ── Bounce detection: scan last 50 messages for mailer-daemon ─────────
        if (box.messages.total > 0) {
          const total = box.messages.total;
          const start = Math.max(1, total - 49);
          const range = `${start}:${total}`;

          await new Promise<void>((resFetch) => {
            const fetch = imap.seq.fetch(range, {
              bodies: ["HEADER.FIELDS (FROM TO)", "TEXT"],
              struct: false,
            });

            type RawMsg = { header: string; body: string };
            const msgs: RawMsg[] = [];

            fetch.on("message", (msg) => {
              const entry: RawMsg = { header: "", body: "" };
              msg.on("body", (stream, info) => {
                const chunks: Buffer[] = [];
                stream.on("data", (c: Buffer) => chunks.push(c));
                stream.once("end", () => {
                  const text = Buffer.concat(chunks).toString();
                  if (info.which.startsWith("HEADER")) entry.header = text;
                  else entry.body = text.slice(0, 3000);
                });
              });
              msg.once("end", () => msgs.push(entry));
            });

            fetch.once("error", () => resFetch());
            fetch.once("end", () => {
              for (const msg of msgs) {
                const fromRaw = parseHeaderValue(msg.header, "From");
                const toRaw = parseHeaderValue(msg.header, "To");

                const emailMatch = fromRaw.match(/<([^>]+)>/) ?? fromRaw.match(/([^\s]+@[^\s]+)/);
                const fromEmail = emailMatch?.[1]?.toLowerCase().trim();
                if (!fromEmail || !isBounce(fromEmail)) continue;

                // Also extract Final-Recipient from DSN bodies (SES bounce format)
                const finalRecipient = msg.body.match(/Final-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i)?.[1] ?? "";
                const candidates = extractEmails(msg.body + " " + toRaw + " " + finalRecipient);
                for (const candidate of candidates) {
                  if (BOUNCE_SENDER_PATTERNS.some(p => p.test(candidate))) continue;

                  const target = db
                    .prepare("SELECT id, email_status, company_id FROM targets WHERE lower(email) = ?")
                    .get(candidate) as { id: string; email_status: string | null; company_id: string | null } | undefined;

                  if (!target || target.email_status === "invalid") continue;

                  const note = `Email bounced on ${new Date().toISOString().slice(0, 10)} — marked invalid`;
                  db.prepare(`
                    UPDATE targets SET email_status = 'invalid',
                      notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
                    WHERE id = ?
                  `).run(note, note, target.id);

                  db.prepare(`
                    UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Email bounced — invalid address'
                    WHERE run_profile_id IN (SELECT id FROM run_profiles WHERE target_id = ?)
                    AND state IN ('pending', 'in_progress')
                  `).run(target.id);

                  if (target.company_id) {
                    const companyNote = `Email domain flagged invalid — bounce for ${candidate} on ${new Date().toISOString().slice(0, 10)}`;
                    db.prepare(`
                      UPDATE companies SET email_domain_invalid = 1,
                        notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
                      WHERE id = ?
                    `).run(companyNote, companyNote, target.company_id);

                    const siblings = db.prepare(`
                      SELECT id FROM targets WHERE company_id = ? AND id != ? AND email IS NOT NULL AND email_status != 'invalid'
                    `).all(target.company_id, target.id) as { id: string }[];

                    for (const sibling of siblings) {
                      const sibNote = `Email bounced on ${new Date().toISOString().slice(0, 10)} — marked invalid (domain flagged via company)`;
                      db.prepare(`
                        UPDATE targets SET email_status = 'invalid',
                          notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
                        WHERE id = ?
                      `).run(sibNote, sibNote, sibling.id);
                      db.prepare(`
                        UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Email domain invalid — company flagged'
                        WHERE run_profile_id IN (SELECT id FROM run_profiles WHERE target_id = ?)
                        AND state IN ('pending', 'in_progress')
                      `).run(sibling.id);
                    }

                    if (siblings.length > 0) {
                      console.log(`[email-inbox] Company ${target.company_id} flagged — ${siblings.length} sibling(s) marked invalid`);
                    }
                  }

                  console.log(`[email-inbox] Bounce for ${candidate} (target ${target.id}) — marked invalid`);
                  bounces++;
                  break;
                }
              }
              resFetch();
            });
          });
        }

        done();
      });
    });

    imap.connect();
  });

  db.prepare("UPDATE email_accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(emailAccountId);
  return { replies, bounces };
}
