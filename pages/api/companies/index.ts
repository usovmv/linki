import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const companies = db.prepare(`
      SELECT c.*, COUNT(t.id) as contact_count
      FROM companies c
      LEFT JOIN targets t ON t.company_id = c.id
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE
    `).all();
    return res.json(companies);
  }

  if (req.method === "POST") {
    const { name, domain, industry, location, linkedin_url, website, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const id = randomUUID();
    db.prepare(`
      INSERT INTO companies (id, name, domain, industry, location, linkedin_url, website, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, domain ?? null, industry ?? null, location ?? null, linkedin_url ?? null, website ?? null, notes ?? null);
    return res.status(201).json({ id });
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end();
}
