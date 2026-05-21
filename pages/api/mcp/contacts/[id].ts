import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireMcpAuth } from "@/lib/mcp-auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireMcpAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;

  const contact = db.prepare(`
    SELECT t.*, c.name as company_name_full, c.domain, c.description as company_description,
           c.employee_count, c.industry as company_industry_full
    FROM targets t
    LEFT JOIN companies c ON c.id = t.company_id
    WHERE t.id = ?
  `).get(id);

  if (!contact) return res.status(404).json({ error: "Not found" });

  const lists = db.prepare(`
    SELECT l.id, l.name FROM lists l
    JOIN list_targets lt ON lt.list_id = l.id
    WHERE lt.target_id = ?
  `).all(id);

  const runs = db.prepare(`
    SELECT r.id, r.status, r.created_at, w.name as workflow_name,
           rpt.state as track_state, rpt.track
    FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    JOIN workflows w ON w.id = r.workflow_id
    LEFT JOIN run_profile_tracks rpt ON rpt.run_profile_id = rp.id
    WHERE rp.target_id = ?
    ORDER BY r.created_at DESC
    LIMIT 10
  `).all(id);

  return res.json({ contact, lists, runs });
}
