import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const sessions = db.prepare(
      `SELECT id, wrapper_session_id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 50`
    ).all();
    return res.json(sessions);
  }

  if (req.method === "POST") {
    const { wrapper_session_id, title, messages } = req.body as {
      wrapper_session_id: string;
      title?: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!wrapper_session_id || !messages?.length) {
      return res.status(400).json({ error: "wrapper_session_id and messages are required" });
    }

    const derivedTitle = title || messages.find((m) => m.role === "user")?.content?.slice(0, 60) || "Chat";

    const existing = db.prepare("SELECT id FROM chat_sessions WHERE wrapper_session_id = ?").get(wrapper_session_id) as { id: string } | undefined;

    if (existing) {
      // Update title + timestamp, replace messages
      db.prepare("UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(derivedTitle, existing.id);
      db.prepare("DELETE FROM chat_messages WHERE chat_session_id = ?").run(existing.id);
      const insertMsg = db.prepare("INSERT INTO chat_messages (id, chat_session_id, role, content) VALUES (?, ?, ?, ?)");
      for (const m of messages) {
        insertMsg.run(randomUUID(), existing.id, m.role, m.content);
      }
      return res.json({ id: existing.id });
    }

    const id = randomUUID();
    db.prepare("INSERT INTO chat_sessions (id, wrapper_session_id, title) VALUES (?, ?, ?)").run(id, wrapper_session_id, derivedTitle);
    const insertMsg = db.prepare("INSERT INTO chat_messages (id, chat_session_id, role, content) VALUES (?, ?, ?, ?)");
    for (const m of messages) {
      insertMsg.run(randomUUID(), id, m.role, m.content);
    }
    return res.status(201).json({ id });
  }

  res.status(405).json({ error: "Method not allowed" });
}
