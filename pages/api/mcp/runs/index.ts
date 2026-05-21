import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireMcpAuth } from "@/lib/mcp-auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireMcpAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();
  const { status = "all", limit = "20" } = req.query;

  const where = status !== "all" ? "WHERE r.status = ?" : "";
  const params: unknown[] = status !== "all" ? [status] : [];

  const rows = db.prepare(`
    SELECT
      r.id, r.status, r.created_at, r.updated_at,
      w.name as workflow_name, l.name as list_name,
      a.email as account_email,
      (SELECT COUNT(*) FROM run_profiles rp WHERE rp.run_id = r.id) as total_profiles,
      (SELECT COUNT(*) FROM run_profile_tracks rpt
         JOIN run_profiles rp ON rp.id = rpt.run_profile_id
         WHERE rp.run_id = r.id AND rpt.state = 'completed') as completed_profiles,
      (SELECT COUNT(*) FROM run_profile_tracks rpt
         JOIN run_profiles rp ON rp.id = rpt.run_profile_id
         WHERE rp.run_id = r.id AND rpt.state = 'failed') as failed_profiles
    FROM runs r
    JOIN workflows w ON w.id = r.workflow_id
    JOIN lists l ON l.id = r.list_id
    LEFT JOIN accounts a ON a.id = r.account_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(...params, Number(limit));

  return res.json(rows);
}
