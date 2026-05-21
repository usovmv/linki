import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";

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
      LINKI_DB_PATH: process.env.LINKI_DB_PATH ?? path.join(process.cwd(), "linki.db"),
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt, session_id } = req.body as {
    prompt?: string;
    session_id?: string;
  };

  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  try {
    const upstream = await fetch(`${WRAPPER_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        session_id,
        mcp_servers: LINKI_MCP_SERVERS,
        tools: LINKI_MCP_TOOLS,
        plugins: [{ type: "local", path: process.cwd() }],
      }),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    res.status(502).json({ error: message });
  }
}

export const config = { maxDuration: 300 };
