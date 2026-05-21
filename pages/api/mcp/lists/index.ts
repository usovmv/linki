import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireMcpAuth } from "@/lib/mcp-auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireMcpAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();

  const rows = db.prepare(`
    SELECT l.id, l.name, l.created_at,
           COUNT(lt.target_id) as contact_count
    FROM lists l
    LEFT JOIN list_targets lt ON lt.list_id = l.id
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `).all();

  return res.json(rows);
}
