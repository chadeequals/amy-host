/**
 * Phase 4 TEST-LINE guardrails (2026-10-05). Hard-coded on purpose: env vars cannot widen these.
 * Changing any value here = code change + Security re-gate. Kill switch AMY_ENABLED stays separate.
 */

/** Guardrail 1: ConversationRelay may only run for calls TO these numbers (HP2 Mesquite TEST line). */
export const AMY_CONVERSATIONAL_TEST_LINES: ReadonlySet<string> = new Set(["+14696891960"]);
/** Facility bound to the test line (HP2 Mesquite). */
export const AMY_TEST_LINE_FACILITY_ID = 2;

export function isAllowedCalledNumber(e164: string | null | undefined): boolean {
  return AMY_CONVERSATIONAL_TEST_LINES.has(String(e164 || "").trim());
}

/**
 * Guardrail 2: the ONLY tuition amounts Amy may speak (HP2 Mesquite weekly Present Rates,
 * greened Chad via COO-CFO 2026-10-03). Source of truth at runtime is config/fact_sheets/mesquite.json;
 * lockedSheet.ts refuses to emit rates unless that file matches this list exactly.
 */
export const GREENED_WEEKLY_RATES: ReadonlyArray<{ room: string; usd: number }> = [
  { room: "Infants", usd: 196 },
  { room: "Toddler 12\u201317 months", usd: 179 },
  { room: "Toddler 18\u201323 months", usd: 176 },
  { room: "Two", usd: 167 },
  { room: "3 years", usd: 160 },
  { room: "4 years", usd: 155 },
  { room: "Before/after school \u2014 AFTER-SCHOOL ONLY", usd: 83 },
  { room: "Before/after school \u2014 BEFORE AND AFTER", usd: 106 },
];
export const GREENED_AMOUNTS: ReadonlySet<number> = new Set(GREENED_WEEKLY_RATES.map((r) => r.usd));

/** Guardrail 4: exact spoken escalation phrase (no personal names). */
export const SPOKEN_ESCALATION_TARGET = "the center director and our leadership team.";

/** Guardrail 3: warm-transfer target (amy-done Dials line.forward_to; this is the expected value + fallback). */
export const SCHOOL_LINE_E164 = "+19722856683";

/** Guardrail 7: menu/prompt version stamped on every cost record. Bump on any prompt/greeting change. */
export const AMY_PROMPT_VERSION = "amy-cr-hp2-test-2026-10-05.p4";

/** Guardrail 8: never creates/links a lead (enforced in Oracle store.ts linkCallToLead). Listed for tests. */
export const LEAD_EXCLUDED_CALLERS_LAST10: ReadonlySet<string> = new Set(["2147046825"]);
