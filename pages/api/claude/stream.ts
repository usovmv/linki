import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";

const WRAPPER_URL = process.env.CLAUDE_WRAPPER_URL ?? "http://localhost:3001";

const LINKI_MCP_PATH = process.env.LINKI_MCP_PATH
  ?? path.join(process.cwd(), "mcp/dist/server.js");

const LINKI_MCP_SERVERS = {
  linki: {
    type: "stdio",
    command: "node",
    args: [LINKI_MCP_PATH],
    env: {
      LINKI_URL: process.env.LINKI_URL ?? "http://localhost:3000",
      LINKI_DB_PATH: process.env.LINKI_MCP_DB_PATH ?? process.env.LINKI_DB_PATH ?? path.join(process.cwd(), "linki.db"),
      MCP_API_KEY: process.env.MCP_API_KEY ?? "",
    },
  },
};

const LINKI_MCP_TOOLS = [
  "mcp__linki__get_stats",
  "mcp__linki__list_contacts",
  "mcp__linki__get_contact",
  "mcp__linki__list_runs",
  "mcp__linki__get_run",
  "mcp__linki__list_workflows",
  "mcp__linki__list_lists",
  "mcp__linki__analyze_list",
  "mcp__linki__remove_from_list",
  "mcp__linki__create_run",
  "mcp__linki__start_run",
  "mcp__linki__pause_run",
  "mcp__linki__resume_run",
  "mcp__linki__create_workflow",
];

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(process.cwd(), "prompts/chat-system.md"),
  "utf-8"
);

// Disable Next.js body parsing — we pipe the raw NDJSON stream through
export const config = { api: { bodyParser: true }, maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt, session_id, model, account_index } = req.body as {
    prompt?: string;
    session_id?: string;
    model?: string;
    account_index?: number;
  };

  if (process.env.ENABLE_AGENT === "false") return res.status(503).json({ error: "Agent is disabled" });

  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  try {
    const upstream = await fetch(`${WRAPPER_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        session_id,
        model,
        ...(account_index != null && { account_index }),
        system_prompt: SYSTEM_PROMPT,
        mcp_servers: LINKI_MCP_SERVERS,
        tools: LINKI_MCP_TOOLS,
        plugins: [{ type: "local", path: process.cwd() }],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: text });
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    res.status(502).json({ error: message });
  }
}
