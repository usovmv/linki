import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export interface InboxReply {
  id: string;
  full_name: string | null;
  linkedin_url: string | null;
  email: string | null;
  headline: string | null;
  company: string | null;
  channel: "email" | "linkedin" | "both";
  replied_at: string;
  email_replied_at: string | null;
  last_replied_at: string | null;
  // run context
  run_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  // email account context
  email_account_id: string | null;
  email_account_name: string | null;
  email_account_from: string | null;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const channel = req.query.channel as string | undefined; // "email" | "linkedin" | undefined

  let channelFilter = "AND (t.email_replied_at IS NOT NULL OR t.last_replied_at IS NOT NULL)";
  if (channel === "email") channelFilter = "AND t.email_replied_at IS NOT NULL";
  if (channel === "linkedin") channelFilter = "AND t.last_replied_at IS NOT NULL";

  const rows = db.prepare(`
    SELECT
      t.id,
      t.full_name,
      t.linkedin_url,
      t.email,
      t.headline,
      t.company,
      t.email_replied_at,
      t.last_replied_at,
      CASE
        WHEN t.email_replied_at IS NOT NULL AND t.last_replied_at IS NOT NULL THEN 'both'
        WHEN t.email_replied_at IS NOT NULL THEN 'email'
        ELSE 'linkedin'
      END AS channel,
      MAX(COALESCE(t.email_replied_at, ''), COALESCE(t.last_replied_at, '')) AS replied_at,
      r.id AS run_id,
      r.workflow_id,
      w.name AS workflow_name,
      ea.id AS email_account_id,
      ea.name AS email_account_name,
      ea.from_email AS email_account_from
    FROM targets t
    LEFT JOIN run_profiles rp ON rp.target_id = t.id
    LEFT JOIN runs r ON r.id = rp.run_id AND r.status IN ('running', 'paused', 'completed')
    LEFT JOIN workflows w ON w.id = r.workflow_id
    LEFT JOIN email_accounts ea ON ea.id = rp.email_account_id
    WHERE 1=1
    ${channelFilter}
    GROUP BY t.id
    ORDER BY replied_at DESC
  `).all() as InboxReply[];

  return res.json({ replies: rows });
}
