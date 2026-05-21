import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireMcpAuth } from "@/lib/mcp-auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireMcpAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT t.id) AS total_contacts,
      COUNT(DISTINCT CASE WHEN t.connection_requested_at IS NOT NULL THEN t.id END) AS connections_requested,
      COUNT(DISTINCT CASE WHEN t.connected_at IS NOT NULL THEN t.id END) AS connected,
      COUNT(DISTINCT CASE WHEN t.message_sent_at IS NOT NULL THEN t.id END) AS messages_sent,
      COUNT(DISTINCT CASE WHEN t.last_replied_at IS NOT NULL THEN t.id END) AS replies_received,
      COUNT(DISTINCT CASE WHEN t.email IS NOT NULL THEN t.id END) AS contacts_with_email,
      (SELECT COUNT(*) FROM runs WHERE status = 'running') AS active_runs,
      (SELECT COUNT(*) FROM runs WHERE status IN ('running','paused','completed')) AS total_runs,
      (SELECT COUNT(*) FROM lists) AS total_lists,
      (SELECT COUNT(*) FROM workflows) AS total_workflows
    FROM targets t
  `).get();

  const today = db.prepare(`
    SELECT
      COUNT(CASE WHEN message LIKE 'Visited%' THEN 1 END) AS visits_today,
      COUNT(CASE WHEN message LIKE 'Connection request sent%' THEN 1 END) AS connections_today,
      COUNT(CASE WHEN message LIKE 'Message sent%' THEN 1 END) AS messages_today,
      COUNT(CASE WHEN message LIKE 'Email sent%' THEN 1 END) AS emails_today
    FROM logs
    WHERE date(created_at) = date('now')
  `).get();

  const runsByStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM runs GROUP BY status
  `).all();

  return res.json({ totals, today, runsByStatus });
}
