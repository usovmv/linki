import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const { id } = req.query as { id: string };

  if (req.method === "GET") {
    const session = db.prepare("SELECT id, wrapper_session_id, title, created_at FROM chat_sessions WHERE id = ?").get(id) as Record<string, string> | undefined;
    if (!session) return res.status(404).json({ error: "Not found" });

    const messages = db.prepare(
      "SELECT id, role, content, created_at FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at ASC"
    ).all(id);

    return res.json({ ...session, messages });
  }

  if (req.method === "DELETE") {
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}
