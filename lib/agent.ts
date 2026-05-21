import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { completeWithTool } from "@/lib/openrouter";
import { getDb } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  system_prompt: string | null;
  user_prompt: string | null;
  email_examples: string | null;
  linkedin_examples: string | null;
  default_model: string | null;
}

export interface ContactData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  seniority: string | null;
  tenure_months: number | null;
  spotlight_badges: string | null; // JSON array string
  positions_json: string | null; // JSON array string
  company_industry: string | null;
  company_location: string | null;
}

export interface CompanyData {
  name: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
  employee_count: number | null;
  website: string | null;
  technology_names: string | null; // JSON array string
  keywords: string | null; // JSON array string
}

export interface WriteParams {
  apiKey: string;
  model: string;
  stepType: "email" | "message";
  stepPrompt: string; // per-step instruction from the workflow step
  maxWords?: number; // optional word budget enforced via retry
  language?: string; // language for generated content (default: English)
  campaignPrompt?: string; // per-campaign context: USP, persona, tone override for this campaign
  contact: ContactData;
  company: CompanyData | null;
  agentConfig: AgentConfig;
  // followup context — only for email steps that are follow-ups
  followupContext?: {
    followupNumber: number; // 1 = first followup (after cold email), 2 = second, etc.
    previousSubject: string;
    previousBody: string;
  };
  // followup context — only for LinkedIn message steps that are follow-ups
  previousMessageContext?: {
    followupNumber: number; // 1 = first followup (after initial message), 2 = second, etc.
    previousMessage: string;
  };
  // for logging
  runId?: string;
  targetId?: string;
  stepId?: string;
}

export interface EmailResult {
  subject: string;
  body: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface MessageResult {
  body: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

// ─── Default system prompt ────────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = fs.readFileSync(
  path.join(process.cwd(), "prompts", "agent-system.md"),
  "utf8",
);

// ─── Context builders ─────────────────────────────────────────────────────────

export function buildContactContext(
  contact: ContactData,
  company: CompanyData | null,
): string {
  const lines: string[] = ["## Contact"];

  lines.push(
    `Name: ${contact.full_name ?? [contact.first_name, contact.last_name].filter(Boolean).join(" ") ?? "Unknown"}`,
  );
  if (contact.title) lines.push(`Title: ${contact.title}`);
  if (contact.company) lines.push(`Company: ${contact.company}`);
  if (contact.location) lines.push(`Location: ${contact.location}`);
  if (contact.seniority) lines.push(`Seniority: ${contact.seniority}`);

  if (contact.tenure_months != null) {
    const years = Math.floor(contact.tenure_months / 12);
    const months = contact.tenure_months % 12;
    const tenure =
      years > 0 ? `${years}y${months > 0 ? ` ${months}m` : ""}` : `${months}m`;
    lines.push(`Tenure in current role: ${tenure}`);
  }

  if (contact.headline) lines.push(`Headline: ${contact.headline}`);
  if (contact.summary) lines.push(`About: ${contact.summary}`);

  if (contact.spotlight_badges) {
    try {
      const badges: string[] = JSON.parse(contact.spotlight_badges);
      if (badges.length > 0) lines.push(`Highlights: ${badges.join(", ")}`);
    } catch {
      /* ignore */
    }
  }

  if (contact.positions_json) {
    try {
      const positions: Array<{
        title: string;
        companyName: string;
        current: boolean;
        startedOn?: { year?: number };
      }> = JSON.parse(contact.positions_json);
      if (positions.length > 0) {
        lines.push("\nCareer history:");
        for (const p of positions.slice(0, 4)) {
          const year = p.startedOn?.year ? ` (${p.startedOn.year})` : "";
          const flag = p.current ? " [current]" : "";
          lines.push(`  - ${p.title} at ${p.companyName}${year}${flag}`);
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (company) {
    lines.push("\n## Company");
    if (company.name) lines.push(`Name: ${company.name}`);
    if (company.industry) lines.push(`Industry: ${company.industry}`);
    if (company.location) lines.push(`Location: ${company.location}`);
    if (company.employee_count)
      lines.push(`Employees: ~${company.employee_count.toLocaleString()}`);
    if (company.website) lines.push(`Website: ${company.website}`);
    if (company.description) lines.push(`Description: ${company.description}`);

    if (company.technology_names) {
      try {
        const tech: string[] = JSON.parse(company.technology_names);
        if (tech.length > 0)
          lines.push(`Tech stack: ${tech.slice(0, 10).join(", ")}`);
      } catch {
        /* ignore */
      }
    }
    if (company.keywords) {
      try {
        const kw: string[] = JSON.parse(company.keywords);
        if (kw.length > 0) lines.push(`Keywords: ${kw.slice(0, 8).join(", ")}`);
      } catch {
        /* ignore */
      }
    }
  } else if (contact.company_industry || contact.company_location) {
    lines.push("\n## Company (partial)");
    if (contact.company) lines.push(`Name: ${contact.company}`);
    if (contact.company_industry)
      lines.push(`Industry: ${contact.company_industry}`);
    if (contact.company_location)
      lines.push(`Location: ${contact.company_location}`);
  }

  return lines.join("\n");
}

export function buildSystemPrompt(agentConfig: AgentConfig, campaignPrompt?: string): string {
  const parts: string[] = [];

  // Base instructions — from file or user-overridden version
  parts.push(agentConfig.system_prompt?.trim() || DEFAULT_SYSTEM_PROMPT);

  // Sender context from user (global, about the sender's business)
  if (agentConfig.user_prompt?.trim()) {
    parts.push("## Sender context\n" + agentConfig.user_prompt.trim());
  }

  // Campaign-specific context — overrides or extends sender context for this campaign
  if (campaignPrompt?.trim()) {
    parts.push("## Campaign context\n" + campaignPrompt.trim());
  }

  // Examples
  if (agentConfig.email_examples?.trim()) {
    parts.push(
      "## Email examples (match this tone and style)\n" +
        agentConfig.email_examples.trim(),
    );
  }
  if (agentConfig.linkedin_examples?.trim()) {
    parts.push(
      "## LinkedIn message examples (match this tone and style)\n" +
        agentConfig.linkedin_examples.trim(),
    );
  }

  return parts.join("\n\n---\n\n");
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const EMAIL_TOOL = {
  type: "function" as const,
  function: {
    name: "write_outreach",
    description: `Write a personalized cold outreach email.

Structure:
- Greeting: "Hi [first name]," or "Dear [first name],"
- Body: 2–4 short sentences. Open with one specific, relevant observation about the person or their work. Then connect it to what you offer. One clear ask at the end.
- Closing: a single short valediction appropriate for the language and tone of the message (e.g. "Cheers," in English, "Viele Grüße," in German, "Cordialement," in French). One word or short phrase. Nothing after it — signature is added automatically.

Rules:
- Use the contact's real name from the data — never write {{first_name}} or any placeholder
- No em-dashes. Use a comma or period instead.
- No fluff openers ("I hope this finds you well", "I wanted to reach out")
- Plain text only. No markdown, no HTML.`,
    parameters: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Email subject line. Short, specific, no clickbait.",
        },
        body: {
          type: "string",
          description: "Email body. Plain text. Use \\n between paragraphs.",
        },
      },
      required: ["subject", "body"],
    },
  },
};

const MESSAGE_TOOL = {
  type: "function" as const,
  function: {
    name: "write_outreach",
    description: `Write a personalized LinkedIn message.

Structure:
- No greeting line needed — go straight into the message
- 2–3 sentences max. One specific observation, one connection to your offer or reason for reaching out, one low-friction ask.
- Casual and direct. First-name basis is fine.

Rules:
- Use the contact's real name from the data — never write {{first_name}} or any placeholder
- No em-dashes. Use a comma or period instead.
- No fluff openers ("I hope this finds you well", "I wanted to reach out")
- Plain text only. No markdown, no HTML.`,
    parameters: {
      type: "object",
      properties: {
        body: {
          type: "string",
          description: "Message body. Plain text. Use \\n between paragraphs.",
        },
      },
      required: ["body"],
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Replace known {{variables}} with real contact values, strip em-dashes,
// and throw if any unknown {{placeholder}} remains.
function postProcess(text: string, contact: ContactData): string {
  const firstName =
    contact.first_name ?? contact.full_name?.split(" ")[0] ?? "";
  const lastName =
    contact.last_name ?? contact.full_name?.split(" ").slice(1).join(" ") ?? "";

  const out = text
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{last_name\}\}/gi, lastName)
    .replace(
      /\{\{full_name\}\}/gi,
      contact.full_name ?? `${firstName} ${lastName}`.trim(),
    )
    .replace(/\{\{company\}\}/gi, contact.company ?? "")
    .replace(/\{\{title\}\}/gi, contact.title ?? "")
    // em-dash → comma+space
    .replace(/\s*—\s*/g, ", ");

  const unknown = out.match(/\{\{[^}]+\}\}/);
  if (unknown) {
    throw new Error(
      `Agent used an unknown placeholder: ${unknown[0]}. Only use the real contact data provided in the message.`,
    );
  }

  return out;
}

// ─── Core write function ──────────────────────────────────────────────────────

interface WriteResult {
  subject?: string;
  body: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

async function writeMessage(params: WriteParams): Promise<WriteResult> {
  const systemPrompt = buildSystemPrompt(params.agentConfig, params.campaignPrompt);
  const contactContext = buildContactContext(params.contact, params.company);

  const maxWordsNote = params.maxWords
    ? `\nMax words: ${params.maxWords}. The body MUST be ${params.maxWords} words or fewer.`
    : "";

  const languageNote =
    params.language &&
    params.language !== "English" &&
    params.language !== "Agent decides"
      ? `**Language: You MUST write in ${params.language}. Do not use any other language.**`
      : params.language === "Agent decides"
        ? "**Language: Choose the most appropriate language for this recipient based on their profile.**"
        : "";

  const ordinals = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
  ];
  const followupSection = params.followupContext
    ? [
        "",
        "## Follow-up context",
        `This is follow-up #${params.followupContext.followupNumber} (the ${ordinals[params.followupContext.followupNumber - 1] ?? `#${params.followupContext.followupNumber}`} follow-up after the initial cold email).`,
        "Do NOT repeat the same opener or content as the previous email. Make it feel natural as a second touch — no clichéd 'just following up' phrases.",
        "",
        `Previous subject: ${params.followupContext.previousSubject}`,
        `Previous body:\n${params.followupContext.previousBody}`,
      ].join("\n")
    : "";

  const previousMessageSection = params.previousMessageContext
    ? [
        "",
        "## Follow-up context",
        `This is follow-up #${params.previousMessageContext.followupNumber} (the ${ordinals[params.previousMessageContext.followupNumber - 1] ?? `#${params.previousMessageContext.followupNumber}`} follow-up after the initial message).`,
        "Do NOT repeat the same opener or content as the previous message. No clichéd 'just following up' phrases.",
        "",
        `Previous message:\n${params.previousMessageContext.previousMessage}`,
      ].join("\n")
    : "";

  const userMessage = [
    contactContext,
    followupSection,
    previousMessageSection,
    "",
    ...(languageNote ? [languageNote, ""] : []),
    "## Step instruction",
    params.stepPrompt + maxWordsNote,
  ].join("\n");

  console.log("[agent] system prompt:\n---\n" + systemPrompt + "\n---");
  console.log("[agent] user message:\n---\n" + userMessage + "\n---");

  const tool = params.stepType === "email" ? EMAIL_TOOL : MESSAGE_TOOL;

  let result = await completeWithTool(
    params.apiKey,
    params.model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    tool,
  );

  // Word budget enforcement — one retry if over limit
  if (params.maxWords) {
    const bodyText = (result.args.body as string) ?? "";
    if (countWords(bodyText) > params.maxWords) {
      const retryMessage = [
        contactContext,
        "",
        ...(languageNote ? [languageNote, ""] : []),
        "## Step instruction",
        params.stepPrompt + maxWordsNote,
        "",
        `## Previous attempt (too long — ${countWords(bodyText)} words, limit is ${params.maxWords})`,
        bodyText,
        "",
        `Rewrite to be ${params.maxWords} words or fewer. Keep the same intent and tone.`,
      ].join("\n");

      result = await completeWithTool(
        params.apiKey,
        params.model,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: retryMessage },
        ],
        tool,
      );
    }
  }

  const body = postProcess(
    ((result.args.body as string) ?? "").trim(),
    params.contact,
  );
  const subject =
    params.stepType === "email"
      ? postProcess(
          ((result.args.subject as string) ?? "").trim(),
          params.contact,
        )
      : undefined;

  // Log to agent_sessions
  try {
    const db = getDb();
    db.prepare(
      `
      INSERT INTO agent_sessions (id, run_id, target_id, step_id, model, input_tokens, output_tokens, cost_usd, prompt, generated_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    ).run(
      randomUUID(),
      params.runId ?? null,
      params.targetId ?? null,
      params.stepId ?? null,
      params.model,
      result.input_tokens,
      result.output_tokens,
      result.cost_usd,
      userMessage,
      JSON.stringify(result.args),
    );
  } catch {
    /* non-fatal */
  }

  return {
    subject,
    body,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cost_usd: result.cost_usd,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function writeEmail(params: WriteParams): Promise<EmailResult> {
  const { subject, body, input_tokens, output_tokens, cost_usd } =
    await writeMessage({ ...params, stepType: "email" });
  return {
    subject: subject ?? "",
    body,
    input_tokens,
    output_tokens,
    cost_usd,
  };
}

export async function writeLinkedInMessage(
  params: WriteParams,
): Promise<MessageResult> {
  const { body, input_tokens, output_tokens, cost_usd } = await writeMessage({
    ...params,
    stepType: "message",
  });
  return { body, input_tokens, output_tokens, cost_usd };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export function getAgentConfig(): AgentConfig {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agent_config WHERE id = 1").get() as
    | AgentConfig
    | undefined;
  return (
    row ?? {
      system_prompt: null,
      user_prompt: null,
      email_examples: null,
      linkedin_examples: null,
      default_model: null,
    }
  );
}

export function getContactWithCompany(
  targetId: string,
): { contact: ContactData; company: CompanyData | null } | null {
  const db = getDb();
  const contact = db
    .prepare(
      `
    SELECT id, first_name, last_name, full_name, title, company, location,
           headline, summary, seniority, tenure_months, spotlight_badges,
           positions_json, company_industry, company_location, company_id
    FROM targets WHERE id = ?
  `,
    )
    .get(targetId) as (ContactData & { company_id: string | null }) | undefined;

  if (!contact) return null;

  let company: CompanyData | null = null;
  if (contact.company_id) {
    company = db
      .prepare(
        `
      SELECT name, industry, location, description, employee_count,
             website, technology_names, keywords
      FROM companies WHERE id = ?
    `,
      )
      .get(contact.company_id) as CompanyData | null;
  }

  return { contact, company };
}
