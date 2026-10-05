/**
 * Guardrail 2 — server-side tuition output filter (defense in depth on top of the prompt).
 * Every model reply is scanned BEFORE it is sent to Twilio TTS. If it contains any money amount
 * that is not on the greened HP2 weekly Present Rate list, or pairs an amount with a non-weekly
 * period (daily/monthly/hourly/yearly), or mentions dollars/fees without an allowed amount,
 * the reply is replaced with a fixed director-callback offer. No CCA, drop-in, or other rates.
 */
import { GREENED_AMOUNTS } from "../config/guardrails.js";

export const TUITION_FALLBACK_EN =
  "I want to make sure you get exact pricing for that, so I'll have the center director call you back with it. " +
  "Would you like me to set that up?";
export const TUITION_FALLBACK_ES =
  "Quiero asegurarme de que reciba el precio exacto, así que la directora del centro le llamará con esa información. " +
  "¿Le gustaría que lo organice?";

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b[\s-]*(dollars?|bucks)\b/i;
const NON_WEEKLY = /\b(per|a|an|each|every|by the)\s+(day|daily|month|monthly|hour|hourly|year|yearly|annum|semester|term)\b|\b(daily|monthly|hourly|yearly|annually)\b|al d[ií]a|por d[ií]a|al mes|por mes|por hora|al a[nñ]o/i;

export type TuitionCheck = { ok: true } | { ok: false; reason: string; amounts: number[] };

/** Extract money amounts written with $ or followed by "dollars"/"USD". */
export function moneyAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?|\b(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*(?:dollars?|usd|bucks|d[oó]lares)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const whole = (m[1] || m[3] || "").replace(/,/g, "");
    const cents = m[2] || m[4] || "";
    const n = Number(whole) + (cents ? Number(cents) / 100 : 0);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function checkTuitionSpeech(text: string, ratesAllowed = true): TuitionCheck {
  const s = String(text || "");
  const amounts = moneyAmounts(s);
  if (!ratesAllowed && amounts.length) return { ok: false, reason: "rates_withheld", amounts };
  if (NUMBER_WORDS.test(s)) return { ok: false, reason: "spelled_amount", amounts };
  if (!amounts.length) {
    // "dollars"/"fee" talk with no digits is fine only if no amount is implied by a bare number + "dollar".
    return { ok: true };
  }
  for (const a of amounts) {
    if (!GREENED_AMOUNTS.has(a)) return { ok: false, reason: "amount_not_greened", amounts };
  }
  // Allowed amounts must be weekly.
  for (const sentence of s.split(/(?<=[.!?])\s+/)) {
    if (moneyAmounts(sentence).length && NON_WEEKLY.test(sentence)) {
      return { ok: false, reason: "non_weekly_period", amounts };
    }
  }
  return { ok: true };
}

export function guardTuitionReply(
  text: string,
  lang: "en" | "es",
  ratesAllowed = true,
): { text: string; blocked: boolean; reason?: string } {
  const c = checkTuitionSpeech(text, ratesAllowed);
  if (c.ok) return { text, blocked: false };
  return { text: lang === "es" ? TUITION_FALLBACK_ES : TUITION_FALLBACK_EN, blocked: true, reason: c.reason };
}
