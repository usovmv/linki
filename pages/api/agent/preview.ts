import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getContactWithCompany, getAgentConfig, writeEmail, writeLinkedInMessage } from "@/lib/agent";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const { step_type, ai_model, ai_prompt, ai_max_words, ai_language, target_id, campaign_prompt } = req.body as {
    step_type: "email" | "message";
    ai_model: string;
    ai_prompt: string;
    ai_max_words?: number | null;
    ai_language?: string | null;
    target_id: string;
    campaign_prompt?: string | null;
  };

  if (!step_type || !ai_model || !target_id) {
    return res.status(400).json({ error: "step_type, ai_model, and target_id are required" });
  }

  const db = getDb();
  const integration = db
    .prepare("SELECT api_key FROM integrations WHERE key = 'openrouter'")
    .get() as { api_key: string } | undefined;

  if (!integration?.api_key) {
    return res.status(400).json({ error: "OpenRouter API key not configured" });
  }

  const result = getContactWithCompany(target_id);
  if (!result) {
    return res.status(404).json({ error: "Contact not found" });
  }

  const agentConfig = getAgentConfig();

  try {
    const params = {
      apiKey: integration.api_key,
      model: ai_model,
      stepType: step_type,
      stepPrompt: ai_prompt ?? "",
      maxWords: ai_max_words ?? undefined,
      language: ai_language ?? undefined,
      campaignPrompt: campaign_prompt ?? undefined,
      contact: result.contact,
      company: result.company,
      agentConfig,
    };

    if (step_type === "email") {
      const out = await writeEmail(params);
      return res.json(out);
    } else {
      const out = await writeLinkedInMessage(params);
      return res.json(out);
    }
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Agent failed" });
  }
}
