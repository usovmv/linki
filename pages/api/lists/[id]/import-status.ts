import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const job = db.prepare(`
    SELECT id, status, phase, page, total_pages, count, total, imported, skipped, error, started_at, finished_at
    FROM list_imports
    WHERE list_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(listId) as {
    id: string;
    status: string;
    phase: string | null;
    page: number;
    total_pages: number;
    count: number;
    total: number;
    imported: number;
    skipped: number;
    error: string | null;
    started_at: string;
    finished_at: string | null;
  } | undefined;

  if (!job) return res.json({ status: 'idle' });

  return res.json(job);
}
