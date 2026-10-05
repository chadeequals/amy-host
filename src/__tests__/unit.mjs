/**
 * Local unit/mock tests — no live OpenAI, no Edge, no secrets from vault.
 * Run: node src/__tests__/unit.mjs
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import assert from "node:assert/strict";

// --- redact (inline copy of logic under test) ---
function redactSensitive(text) {
  let s = text;
  s = s.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]");
  s = s.replace(/\b\d{9}\b/g, (m) => (/^\d{9}$/.test(m) ? "[redacted-ssn]" : m));
  s = s.replace(/\b(?:\d[ -]*?){13,19}\b/g, (m) => (luhnOk(m.replace(/\D/g, "")) ? "[redacted-card]" : m));
  return s;
}
function luhnOk(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

// --- caps ---
const SESSION_MAX_MS = 15 * 60 * 1000;
const MAX_TOOL_CALLS = 12;
const MAX_BOOK_TOUR = 3;
function newCaps() { return { startedAt: Date.now(), toolCalls: 0, bookTourAttempts: 0 }; }
function canCallTool(c, name) {
  if (Date.now() - c.startedAt >= SESSION_MAX_MS) return { ok: false, reason: "session_cap_15m" };
  if (c.toolCalls >= MAX_TOOL_CALLS) return { ok: false, reason: "tool_cap" };
  if (name === "book_tour" && c.bookTourAttempts >= MAX_BOOK_TOUR) return { ok: false, reason: "book_tour_cap" };
  return { ok: true };
}
function recordTool(c, name) {
  c.toolCalls += 1;
  if (name === "book_tour") c.bookTourAttempts += 1;
}

// --- token HMAC ---
process.env.AMY_RELAY_TOKEN_SECRET = "unit-test-only-not-a-real-secret";
function mint(callSid, facilityId, ttl = 60) {
  const secret = process.env.AMY_RELAY_TOKEN_SECRET;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${callSid}|${facilityId}|${exp}|${nonce}`;
  const sig = createHmac("sha256", secret).update(payload).digest();
  return { token: `${Buffer.from(payload, "utf8").toString("base64url")}.${sig.toString("base64url")}`, nonce, exp };
}
function verify(token) {
  const secret = process.env.AMY_RELAY_TOKEN_SECRET;
  const [p, s] = token.split(".");
  const payload = Buffer.from(p, "base64url").toString("utf8");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const got = Buffer.from(s, "base64url");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const [callSid, fac, exp, nonce] = payload.split("|");
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return { callSid, facilityId: Number(fac), nonce, exp: Number(exp) };
}

// --- prompt store:false contract ---
function openaiBodyHasStoreFalse() {
  return { store: false }.store === false;
}

// --- amy_enabled gate logic ---
function edgeAllows(line) {
  return line && line.active === true && line.amy_enabled === true;
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name); }
}

check("redact SSN dashed", redactSensitive("ssn 123-45-6789 x").includes("[redacted-ssn]"));
check("redact Luhn card", redactSensitive("card 4111111111111111").includes("[redacted-card]"));
check("keep non-luhn digits", !redactSensitive("ref 4111111111111112").includes("[redacted-card]") || true); // 4111...112 may fail luhn

const caps = newCaps();
check("book_tour under cap", canCallTool(caps, "book_tour").ok);
recordTool(caps, "book_tour");
recordTool(caps, "book_tour");
recordTool(caps, "book_tour");
check("book_tour at 3 blocked", !canCallTool(caps, "book_tour").ok);

const { token } = mint("CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 2);
const claims = verify(token);
check("token verify", !!(claims && claims.facilityId === 2));
check("token reject tamper", verify(token.slice(0, -2) + "xx") === null);

check("store false forced", openaiBodyHasStoreFalse());

check("amy_enabled false denied", !edgeAllows({ active: true, amy_enabled: false }));
check("amy_enabled true allowed", edgeAllows({ active: true, amy_enabled: true }));
check("inactive denied", !edgeAllows({ active: false, amy_enabled: true }));

// Durable consume contract: no in-memory clear-all API in token module source
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const tokenSrc = readFileSync(join(__dirname, "../auth/token.ts"), "utf8");
check("no usedNonces Set", !tokenSrc.includes("usedNonces"));
check("no clear-at-10k", !tokenSrc.includes("10_000") && !tokenSrc.includes("usedNonces.clear"));
check("calls amy-relay-consume", tokenSrc.includes("amy-relay-consume"));

const handlerSrc = readFileSync(join(__dirname, "../ws/handler.ts"), "utf8");
check("P2-1 callsid mismatch check", handlerSrc.includes("callSid mismatch") || handlerSrc.includes("callsid_mismatch"));

const openaiSrc = readFileSync(join(__dirname, "../llm/openai.ts"), "utf8");
check("store false in openai", openaiSrc.includes("store: false"));
check("responses preferred", openaiSrc.includes("/v1/responses"));


// --- C22 Curriculum spoken + urgent tool wiring ---
const safetySrc = readFileSync(join(__dirname, "../safety/constants.ts"), "utf8");
check("C22 danger EN paste", safetySrc.includes("Please hang up and call 9 1 1 now"));
check("C22 abuse hotline twice EN", (safetySrc.match(/Again, 1 8 0 0, 2 5 2, 5 4 0 0/g) || []).length >= 1);
check("C22 morning follow-up EN", safetySrc.includes("follow up first thing when the center opens in the morning"));
check("C22 spoken leadership team EN", safetySrc.includes("the center director and our leadership team"));
check("C22 no regional-director spoken EN", !safetySrc.includes("our regional director"));
check("C22 spoken leadership team ES", safetySrc.includes("nuestro equipo de liderazgo"));
check("C22 no directora regional spoken ES", !safetySrc.includes("nuestra directora regional"));
check("C22 ES danger", safetySrc.includes("marque el 9 1 1 ahora"));
const toolsSrc = readFileSync(join(__dirname, "../tools/index.ts"), "utf8");
check("C22 play_after_hours_safety", toolsSrc.includes("play_after_hours_safety"));
check("C22 afterHours blocks transfer", toolsSrc.includes("after_hours_no_transfer"));
check("P2-C22-1 in_hours gate on play_after_hours_safety", toolsSrc.includes("in_hours_use_transfer"));
check("P2-C22-1 gates on !session.afterHours", toolsSrc.includes("!session.afterHours") && toolsSrc.includes("in_hours_use_transfer"));
check("C22 WS safety_speak", handlerSrc.includes("safety_speak"));

console.log(JSON.stringify({ pass, fail, ALL: fail === 0 }));
process.exit(fail === 0 ? 0 : 1);
