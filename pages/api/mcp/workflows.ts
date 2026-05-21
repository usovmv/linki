import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireMcpAuth } from "@/lib/mcp-auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireMcpAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();

  const workflows = db.prepare(`
    SELECT w.id, w.name, w.created_at, w.prompt,
           COUNT(ws.id) as step_count
    FROM workflows w
    LEFT JOIN workflow_steps ws ON ws.workflow_id = w.id
    GROUP BY w.id
    ORDER BY w.created_at DESC
  `).all();

  const steps = db.prepare(`
    SELECT workflow_id, step_order, step_type, track, delay_seconds, ai_enabled
    FROM workflow_steps
    ORDER BY workflow_id, track, step_order
  `).all() as Array<{ workflow_id: string }>;

  const stepsMap: Record<string, unknown[]> = {};
  for (const s of steps) {
    if (!stepsMap[s.workflow_id]) stepsMap[s.workflow_id] = [];
    stepsMap[s.workflow_id].push(s);
  }

  const result = (workflows as Array<{ id: string }>).map((w) => ({
    ...w,
    steps: stepsMap[w.id] ?? [],
  }));

  return res.json(result);
}
