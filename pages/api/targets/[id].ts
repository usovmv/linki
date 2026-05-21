import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;

  if (req.method === "GET") {
    const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });

    const company = db.prepare("SELECT * FROM companies WHERE id = (SELECT company_id FROM targets WHERE id = ?)").get(id);
    const lists = db.prepare(`
      SELECT l.id, l.name FROM lists l
      INNER JOIN list_targets lt ON lt.list_id = l.id
      WHERE lt.target_id = ?
      ORDER BY l.name COLLATE NOCASE
    `).all(id);

    return res.json({ ...target as object, company: company ?? null, lists });
  }

  if (req.method === "PATCH") {
    const target = db.prepare("SELECT id FROM targets WHERE id = ?").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });

    const { email, notes } = req.body as { email?: string; notes?: string };

    if (email !== undefined) {
      const trimmed = email.trim();
      db.prepare("UPDATE targets SET email = ? WHERE id = ?").run(trimmed || null, id);
    }
    if (notes !== undefined) {
      db.prepare("UPDATE targets SET notes = ? WHERE id = ?").run(notes || null, id);
    }

    return res.json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
