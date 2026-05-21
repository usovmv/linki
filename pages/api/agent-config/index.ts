import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import fs from "fs";
import path from "path";

const DEFAULT_SYSTEM_PROMPT = fs.readFileSync(
  path.join(process.cwd(), "prompts", "agent-system.md"),
  "utf8"
);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const row = db.prepare("SELECT * FROM agent_config WHERE id = 1").get() as Record<string, unknown> | undefined;
    return res.json({
      system_prompt: row?.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
      user_prompt: row?.user_prompt ?? "",
      email_examples: row?.email_examples ?? "",
      linkedin_examples: row?.linkedin_examples ?? "",
      default_model: row?.default_model ?? "",
    });
  }

  if (req.method === "PUT") {
    const { system_prompt, user_prompt, email_examples, linkedin_examples, default_model } = req.body as Record<string, string>;
    db.prepare(`
      INSERT INTO agent_config (id, system_prompt, user_prompt, email_examples, linkedin_examples, default_model, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        system_prompt = excluded.system_prompt,
        user_prompt = excluded.user_prompt,
        email_examples = excluded.email_examples,
        linkedin_examples = excluded.linkedin_examples,
        default_model = excluded.default_model,
        updated_at = excluded.updated_at
    `).run(
      system_prompt ?? null,
      user_prompt ?? null,
      email_examples ?? null,
      linkedin_examples ?? null,
      default_model ?? null,
    );
    return res.json({ ok: true });
  }

  res.status(405).end();
}
