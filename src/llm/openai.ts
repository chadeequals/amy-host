/**
 * OpenAI text path with store:false (C24 / Security P2-3).
 * Prefers /v1/responses; falls back to /v1/chat/completions still with store:false.
 * No Assistants, Threads, Conversations, Files, Vector stores, Agents, hosted tools.
 * AMY_LLM_MOCK=1 → deterministic stub (no network) for local unit tests.
 */
const DEFAULT_BASE = "https://api.openai.com";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** Token usage for Guardrail 7 cost estimate (0 when provider omits it). */
export type LlmUsage = { input_tokens: number; output_tokens: number };
export type LlmResult = {
  content: string | null;
  tool_calls: Array<{ id: string; name: string; arguments: string }> | null;
  raw_id?: string;
  usage?: LlmUsage;
  model?: string;
};

export function llmModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export async function chatCompletion(args: {
  messages: ChatMessage[];
  tools?: ToolDef[];
  model?: string;
}): Promise<LlmResult> {
  if ((process.env.AMY_LLM_MOCK || "").trim() === "1") {
    return mockCompletion(args.messages);
  }

  const key = (process.env.AMY_LLM_API_KEY || "").trim();
  if (!key) throw new Error("AMY_LLM_API_KEY unset");
  const base = (process.env.OPENAI_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  const model = args.model || llmModel();
  const preferResponses = (process.env.OPENAI_USE_RESPONSES || "1").trim() !== "0";

  if (preferResponses) {
    try {
      return await responsesApi({ base, key, model, messages: args.messages, tools: args.tools });
    } catch (e) {
      console.log("[amy-llm] responses fallback to chat", String(e).slice(0, 80));
    }
  }
  return chatCompletionsApi({ base, key, model, messages: args.messages, tools: args.tools });
}

function mockCompletion(messages: ChatMessage[]): LlmResult {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = (last?.content || "").toLowerCase();
  if (text.includes("person") || text.includes("human") || text.includes("director")) {
    return {
      content: null,
      tool_calls: [{ id: "mock_xfer", name: "transfer_to_school_line", arguments: '{"reason":"caller_request"}' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
  return {
    content: "Thanks for calling. I can help with a tour or answer questions from our fact sheet. What would you like to know?",
    tool_calls: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

async function responsesApi(args: {
  base: string;
  key: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
}): Promise<LlmResult> {
  // Map chat-style messages into Responses "input" items (simplified).
  // Assistant tool calls must be replayed as function_call items so the following
  // function_call_output items resolve (otherwise Responses 400s and we fall back to chat every round).
  const input: Array<Record<string, unknown>> = [];
  for (const m of args.messages) {
    if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      if (m.content) input.push({ role: "assistant", content: m.content });
      for (const tc of m.tool_calls) {
        input.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
      }
      continue;
    }
    input.push({ role: m.role, content: m.content });
  }
  const body: Record<string, unknown> = {
    model: args.model,
    input,
    store: false, // C24 — always
  };
  if (args.tools?.length) {
    body.tools = args.tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
  }
  const res = await fetch(`${args.base}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log("[amy-llm] responses error", res.status, text.slice(0, 120));
    throw new Error(`responses_${res.status}`);
  }
  const json = (await res.json()) as {
    id?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
      name?: string;
      arguments?: string;
      call_id?: string;
    }>;
    output_text?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const tool_calls: Array<{ id: string; name: string; arguments: string }> = [];
  let content: string | null = json.output_text || null;
  for (const item of json.output || []) {
    if (item.type === "function_call" && item.name) {
      tool_calls.push({
        id: item.call_id || `fc_${tool_calls.length}`,
        name: item.name,
        arguments: item.arguments || "{}",
      });
    }
    if (item.type === "message" && item.content) {
      const texts = item.content.filter((c) => c.type === "output_text" || c.text).map((c) => c.text || "");
      if (texts.length) content = texts.join("");
    }
  }
  return {
    content,
    tool_calls: tool_calls.length ? tool_calls : null,
    raw_id: json.id,
    usage: { input_tokens: Number(json.usage?.input_tokens || 0), output_tokens: Number(json.usage?.output_tokens || 0) },
    model: args.model,
  };
}

async function chatCompletionsApi(args: {
  base: string;
  key: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
}): Promise<LlmResult> {
  const body: Record<string, unknown> = {
    model: args.model,
    messages: args.messages,
    store: false, // C24 — set even if chat ignores; Responses preferred
  };
  if (args.tools?.length) {
    body.tools = args.tools;
    body.tool_choice = "auto";
  }
  const res = await fetch(`${args.base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log("[amy-llm] chat error", res.status, text.slice(0, 120));
    throw new Error(`openai_${res.status}`);
  }
  const json = (await res.json()) as {
    id?: string;
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = json.choices?.[0]?.message;
  const tool_calls =
    msg?.tool_calls?.map((t) => ({
      id: t.id,
      name: t.function.name,
      arguments: t.function.arguments,
    })) || null;
  return {
    content: msg?.content ?? null,
    tool_calls,
    raw_id: json.id,
    usage: { input_tokens: Number(json.usage?.prompt_tokens || 0), output_tokens: Number(json.usage?.completion_tokens || 0) },
    model: args.model,
  };
}

/** Redact SSN / Luhn card patterns before any CCO write or log (C17). */
export function redactSensitive(text: string): string {
  let s = text;
  s = s.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]");
  s = s.replace(/\b\d{9}\b/g, (m) => (/^\d{9}$/.test(m) ? "[redacted-ssn]" : m));
  s = s.replace(/\b(?:\d[ -]*?){13,19}\b/g, (m) => (luhnOk(m.replace(/\D/g, "")) ? "[redacted-card]" : m));
  return s;
}

function luhnOk(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
