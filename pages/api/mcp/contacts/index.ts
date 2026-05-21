import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireMcpAuth } from "@/lib/mcp-auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireMcpAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();
  const {
    limit = "50",
    offset = "0",
    list_id,
    degree,
    connected,
    has_email,
    awaiting_acceptance,
  } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (list_id) {
    conditions.push("t.id IN (SELECT target_id FROM list_targets WHERE list_id = ?)");
    params.push(list_id);
  }
  if (degree !== undefined) {
    conditions.push("t.degree = ?");
    params.push(Number(degree));
  }
  if (connected === "true") {
    conditions.push("t.connected_at IS NOT NULL");
  }
  if (has_email === "true") {
    conditions.push("t.email IS NOT NULL AND t.email != ''");
  }
  if (awaiting_acceptance === "true") {
    conditions.push("t.connection_requested_at IS NOT NULL AND t.connected_at IS NULL");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT
      t.id, t.first_name, t.last_name, t.title, t.company,
      t.degree, t.email, t.linkedin_url,
      t.connection_requested_at, t.connected_at, t.message_sent_at,
      t.last_replied_at, t.headline, t.seniority,
      t.company_industry, t.company_location
    FROM targets t
    ${where}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const total = (db.prepare(`SELECT COUNT(*) as c FROM targets t ${where}`).get(...params) as { c: number }).c;

  return res.json({ total, rows });
}
