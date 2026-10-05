/**
 * Guardrail 7 (CFO ask): per-call cost ESTIMATE for conversational Amy.
 * These are documented LIST prices, not invoices. Mark every record estimate:true.
 *
 * Sources (checked 2026-10-05):
 *  - Twilio Programmable Voice US, receive calls on a local number: $0.0085/min
 *      https://www.twilio.com/en-us/voice/pricing/us  ("Pricing current as of August 2026")
 *  - Twilio ConversationRelay: $0.07/min (STT+TTS+orchestration; voice billed separately)
 *      https://www.twilio.com/en-us/products/conversational-ai/pricing
 *  - OpenAI gpt-4o-mini: $0.15 / 1M input tokens, $0.60 / 1M output tokens
 *      https://developers.openai.com/api/docs/models/gpt-4o-mini
 * Twilio bills per started minute; we round session seconds UP to whole minutes for Twilio lines.
 * The pre-Amy IVR menu seconds are not included here (phone_call.total_seconds has the full call).
 */
export const PRICE_TWILIO_VOICE_INBOUND_LOCAL_PER_MIN = 0.0085;
export const PRICE_CONVERSATION_RELAY_PER_MIN = 0.07;
export const LLM_PRICES_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};
export const PRICE_SOURCES = [
  "twilio.com/en-us/voice/pricing/us (receive local $0.0085/min)",
  "twilio.com/en-us/products/conversational-ai/pricing (ConversationRelay $0.07/min)",
  "developers.openai.com/api/docs/models/gpt-4o-mini ($0.15 in / $0.60 out per 1M)",
];

export type CostEstimate = {
  estimate: true;
  prompt_version: string;
  model: string;
  session_seconds: number;
  billed_minutes: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  twilio_voice_usd: number;
  conversation_relay_usd: number;
  llm_usd: number;
  total_usd: number;
  per_minute_usd: number;
  rates: { twilio_voice_per_min: number; conversation_relay_per_min: number; llm_in_per_1m: number | null; llm_out_per_1m: number | null };
  end_reason: string;
  computed_at: string;
};

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function estimateCallCost(args: {
  promptVersion: string;
  model: string;
  sessionSeconds: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  endReason: string;
  now?: Date;
}): CostEstimate {
  const secs = Math.max(0, Math.round(args.sessionSeconds));
  const billedMinutes = secs > 0 ? Math.ceil(secs / 60) : 0;
  const llm = LLM_PRICES_PER_1M[args.model] || null;
  const twilio = billedMinutes * PRICE_TWILIO_VOICE_INBOUND_LOCAL_PER_MIN;
  const relay = billedMinutes * PRICE_CONVERSATION_RELAY_PER_MIN;
  const llmUsd = llm ? (args.inputTokens * llm.input + args.outputTokens * llm.output) / 1_000_000 : 0;
  const total = twilio + relay + llmUsd;
  return {
    estimate: true,
    prompt_version: args.promptVersion,
    model: args.model,
    session_seconds: secs,
    billed_minutes: billedMinutes,
    llm_calls: args.llmCalls,
    input_tokens: args.inputTokens,
    output_tokens: args.outputTokens,
    twilio_voice_usd: r6(twilio),
    conversation_relay_usd: r6(relay),
    llm_usd: r6(llmUsd),
    total_usd: r6(total),
    per_minute_usd: r6(secs > 0 ? total / (secs / 60) : 0),
    rates: {
      twilio_voice_per_min: PRICE_TWILIO_VOICE_INBOUND_LOCAL_PER_MIN,
      conversation_relay_per_min: PRICE_CONVERSATION_RELAY_PER_MIN,
      llm_in_per_1m: llm ? llm.input : null,
      llm_out_per_1m: llm ? llm.output : null,
    },
    end_reason: String(args.endReason || "close").slice(0, 32),
    computed_at: (args.now || new Date()).toISOString(),
  };
}
