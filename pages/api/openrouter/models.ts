import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { listModels } from "@/lib/openrouter";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const integration = db.prepare("SELECT api_key FROM integrations WHERE key = 'openrouter'").get() as
    | { api_key: string }
    | undefined;

  if (!integration?.api_key) {
    return res.status(400).json({ error: "OpenRouter API key not configured" });
  }

  try {
    const models = await listModels(integration.api_key);
    return res.json({ models });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch models" });
  }
}
