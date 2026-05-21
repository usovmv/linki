import OpenAI from "openai";

const BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterModel {
  id: string;
  name: string;
  provider: string; // derived from id prefix, e.g. "anthropic", "openai"
}

export interface CompletionResult {
  content: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

function getClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: BASE_URL,
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://linki.app",
      "X-Title": "Linki",
    },
  });
}

export async function listModels(apiKey: string): Promise<OpenRouterModel[]> {
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);
  const data = await res.json() as { data: Array<{ id: string; name: string }> };
  return (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    provider: m.id.split("/")[0] ?? "unknown",
  }));
}

export async function complete(
  apiKey: string,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  responseFormat?: OpenAI.Chat.ChatCompletionCreateParams["response_format"],
): Promise<CompletionResult> {
  const client = getClient(apiKey);

  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };

  const resp = await client.chat.completions.create(params);

  console.log("[openrouter] raw response:", JSON.stringify({
    id: resp.id,
    model: resp.model,
    usage: resp.usage,
    choices: resp.choices?.map(c => ({ finish_reason: c.finish_reason, content: c.message?.content?.slice(0, 200) })),
    ...(resp as unknown as Record<string, unknown>),
  }, null, 2));

  const content = resp.choices[0]?.message?.content ?? "";
  const input_tokens = resp.usage?.prompt_tokens ?? 0;
  const output_tokens = resp.usage?.completion_tokens ?? 0;

  const cost_usd = (resp as unknown as Record<string, unknown>).usage
    ? ((resp.usage as unknown as Record<string, unknown>).cost as number | null) ?? null
    : null;

  return { content, input_tokens, output_tokens, cost_usd };
}

export interface ToolCallResult {
  args: Record<string, unknown>;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export async function completeWithTool(
  apiKey: string,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tool: OpenAI.Chat.ChatCompletionTool,
): Promise<ToolCallResult> {
  const client = getClient(apiKey);

  const resp = await client.chat.completions.create({
    model,
    messages,
    tools: [tool],
    tool_choice: { type: "function", function: { name: (tool as { function: { name: string } }).function.name } },
  });

  console.log("[openrouter] tool call response:", JSON.stringify({
    id: resp.id,
    model: resp.model,
    usage: resp.usage,
    choices: resp.choices?.map(c => ({
      finish_reason: c.finish_reason,
      tool_calls: c.message?.tool_calls?.map(t => ({ name: (t as { function: { name: string; arguments: string } }).function.name, args: (t as { function: { name: string; arguments: string } }).function.arguments.slice(0, 300) })),
    })),
  }, null, 2));

  const toolCall = resp.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Model did not call the tool");

  const args = JSON.parse((toolCall as { function: { arguments: string } }).function.arguments) as Record<string, unknown>;
  const input_tokens = resp.usage?.prompt_tokens ?? 0;
  const output_tokens = resp.usage?.completion_tokens ?? 0;
  const cost_usd = (resp as unknown as Record<string, unknown>).usage
    ? ((resp.usage as unknown as Record<string, unknown>).cost as number | null) ?? null
    : null;

  return { args, input_tokens, output_tokens, cost_usd };
}
