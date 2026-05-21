import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireMcpAuth } from "@/lib/mcp-auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireMcpAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;

  const run = db.prepare(`
    SELECT r.*, w.name as workflow_name, l.name as list_name, a.email as account_email
    FROM runs r
    JOIN workflows w ON w.id = r.workflow_id
    JOIN lists l ON l.id = r.list_id
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE r.id = ?
  `).get(id);

  if (!run) return res.status(404).json({ error: "Not found" });

  const stateBreakdown = db.prepare(`
    SELECT rpt.track, rpt.state, COUNT(*) as count
    FROM run_profile_tracks rpt
    JOIN run_profiles rp ON rp.id = rpt.run_profile_id
    WHERE rp.run_id = ?
    GROUP BY rpt.track, rpt.state
  `).all(id);

  const recentLogs = db.prepare(`
    SELECT created_at, level, message
    FROM logs
    WHERE run_id = ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(id);

  return res.json({ run, stateBreakdown, recentLogs });
}
