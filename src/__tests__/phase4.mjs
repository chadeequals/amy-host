/**
 * Phase 4 test-line guardrail checks (behavioral, against compiled dist/). No network, no secrets.
 * Run: npm run build && node src/__tests__/phase4.mjs
 */
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

delete process.env.CCO_EDGE_BASE_URL; // force edge_unconfigured → no network
delete process.env.AMY_HOST_API_TOKEN;
process.env.AMY_LLM_MOCK = "1";
delete process.env.AMY_BOOK_TOUR_ENABLED;

const __dirname = dirname(fileURLToPath(import.meta.url));
const D = join(__dirname, "../../dist");
const g = await import(join(D, "config/guardrails.js"));
const tg = await import(join(D, "safety/tuitionGuard.js"));
const ls = await import(join(D, "facts/lockedSheet.js"));
const cost = await import(join(D, "cost/estimate.js"));
const pr = await import(join(D, "prompt.js"));
const h = await import(join(D, "ws/handler.js"));
const tools = await import(join(D, "tools/index.js"));

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

// G1
check("G1 test line allowed", g.isAllowedCalledNumber("+14696891960"));
check("G1 HP14 refused", !g.isAllowedCalledNumber("+19035008033"));
check("G1 HP15 refused", !g.isAllowedCalledNumber("+19365854387"));
check("G1 school line refused", !g.isAllowedCalledNumber("+19722856683"));
check("G1 empty refused", !g.isAllowedCalledNumber(""));

// G2 sheet
const sheet = ls.quoteSheetForFacility(2);
check("G2 sheet from bundled mesquite.json", !!sheet && sheet.path.endsWith("config/fact_sheets/mesquite.json"));
check("G2 sheet verified vs greened list", sheet.rates_verified_against_greened_list === true);
check("G2 exactly 8 quotable lines", sheet.spoken_rate_lines.length === 8);
const amounts = sheet.spoken_rate_lines.map((l) => Number(/\$(\d+)/.exec(l)[1])).sort((a, b) => a - b);
check("G2 amounts = 83,106,155,160,167,176,179,196", JSON.stringify(amounts) === JSON.stringify([83, 106, 155, 160, 167, 176, 179, 196]));
check("G2 billing_rate_cards false", sheet.billing_rate_cards === false);
check("G2 other facility → null", ls.quoteSheetForFacility(7) === null);
const tampered = JSON.parse(readFileSync(join(__dirname, "../../config/fact_sheets/mesquite.json"), "utf8")).rooms;
tampered[0].full_time_weekly_usd = 210;
check("G2 drifted sheet fails verification", ls.sheetMatchesGreenedList(tampered) === false);
const extra = JSON.parse(readFileSync(join(__dirname, "../../config/fact_sheets/mesquite.json"), "utf8")).rooms;
extra[6].full_time_weekly_usd = 150; // five-year-old band populated
check("G2 extra band fails verification", ls.sheetMatchesGreenedList(extra) === false);
const dropin = JSON.parse(readFileSync(join(__dirname, "../../config/fact_sheets/mesquite.json"), "utf8")).rooms;
dropin[0].drop_in_daily_usd = 50;
check("G2 drop-in populated fails verification", ls.sheetMatchesGreenedList(dropin) === false);

// G2 output guard
const ok = (t) => tg.checkTuitionSpeech(t).ok;
check("G2 infant $196 per week ok", ok("Our infant room is $196 per week."));
check("G2 before+after $106 ok", ok("Before and after school is $106 a week, and after-school only is $83."));
check("G2 $150 blocked", !ok("Toddlers are about $150 per week."));
check("G2 CCA remittance $34.50 blocked", !ok("With CCA the state pays $34.50 a day."));
check("G2 $196 per month blocked", !ok("Infants are $196 per month."));
check("G2 $160 daily blocked", !ok("It's $160 daily."));
check("G2 spelled amount blocked", !ok("Registration is one hundred dollars."));
check("G2 '75 dollars' blocked", !ok("Drop-in is 75 dollars."));
check("G2 no money ok", ok("We're open 6:30 AM to 6:30 PM. Call (972) 285-6683."));
check("G2 rates withheld blocks all", !tg.checkTuitionSpeech("$196 per week", false).ok);
check("G2 fallback offers director callback", /center director call you back/.test(tg.guardTuitionReply("$99", "en").text));

// G3 end message + DTMF
const em = JSON.parse(h.endMessage({ reason: "transfer" }));
check("G3 handoffData is a STRING", typeof em.handoffData === "string");
check("G3 handoffData reason=transfer", JSON.parse(em.handoffData).reason === "transfer");

function fakeWs() {
  const e = new EventEmitter();
  const sent = [];
  return Object.assign(e, { OPEN: 1, readyState: 1, sent, send: (s) => sent.push(JSON.parse(s)), close: () => { e.readyState = 3; } });
}
const tick = () => new Promise((r) => setTimeout(r, 30));
const claims = (fac) => ({ callSid: "CA" + "a".repeat(32), facilityId: fac, exp: 9e9, nonce: "n".repeat(32) });

{ // non-test facility refused before any speech
  const ws = fakeWs();
  h.handleAmySocket(ws, claims(7));
  const end = ws.sent.find((m) => m.type === "end");
  check("G1 host refuses facility 7", !!end && JSON.parse(end.handoffData).reason === "not_test_line_facility");
}
{ // wrong called number refused
  const ws = fakeWs();
  h.handleAmySocket(ws, claims(2));
  ws.emit("message", JSON.stringify({ type: "setup", callSid: claims(2).callSid, to: "+19035008033" }));
  await tick();
  const end = ws.sent.find((m) => m.type === "end");
  check("G1 host refuses non-test called number", !!end && JSON.parse(end.handoffData).reason === "not_test_line");
  ws.emit("close");
}
{ // spoofed param cannot override Twilio 'to'
  const ws = fakeWs();
  h.handleAmySocket(ws, claims(2));
  ws.emit("message", JSON.stringify({ type: "setup", callSid: claims(2).callSid, to: "+19365854387", customParameters: { calledNumber: "+14696891960" } }));
  await tick();
  const end = ws.sent.find((m) => m.type === "end");
  check("G1 calledNumber param cannot widen", !!end && JSON.parse(end.handoffData).reason === "not_test_line");
  ws.emit("close");
}
{ // test line: setup ok, prompt replies, then DTMF 1 → transfer
  const ws = fakeWs();
  h.handleAmySocket(ws, claims(2));
  ws.emit("message", JSON.stringify({ type: "setup", callSid: claims(2).callSid, to: "+14696891960", customParameters: { calledNumber: "+14696891960", lang: "en", afterHours: "0" } }));
  await tick();
  check("G1 test line setup not refused", !ws.sent.some((m) => m.type === "end"));
  ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "What are your hours?", last: true }));
  await tick();
  check("conversation replies on test line", ws.sent.some((m) => m.type === "text"));
  ws.emit("message", JSON.stringify({ type: "dtmf", digit: "1" }));
  await tick();
  const end = ws.sent.find((m) => m.type === "end");
  check("G3 DTMF 1 → end reason transfer", !!end && JSON.parse(end.handoffData).reason === "transfer");
  ws.emit("close");
}
{ // DTMF 1 after hours still transfers (IVR parity: dial once, Oracle stays-on-line on no answer)
  const ws = fakeWs();
  h.handleAmySocket(ws, claims(2));
  ws.emit("message", JSON.stringify({ type: "setup", callSid: claims(2).callSid, to: "+14696891960", customParameters: { lang: "en", afterHours: "1" } })); // D5: Oracle always sends lang (amy.ts:181); missing lang is now refused
  await tick();
  ws.emit("message", JSON.stringify({ type: "dtmf", digit: "1" }));
  await tick();
  const end = ws.sent.find((m) => m.type === "end");
  check("G3 DTMF 1 after hours → transfer", !!end && JSON.parse(end.handoffData).reason === "transfer");
}
{ // DTMF 1 before setup also transfers
  const ws = fakeWs();
  h.handleAmySocket(ws, claims(2));
  ws.emit("message", JSON.stringify({ type: "dtmf", digit: "1" }));
  await tick();
  const end = ws.sent.find((m) => m.type === "end");
  check("G3 DTMF 1 before setup → transfer", !!end && JSON.parse(end.handoffData).reason === "transfer");
}
{ // model transfer tool works without facts forward_to (Oracle picks number)
  const s = { callSid: "CAx", facilityId: 2, lang: "en", caps: { startedAt: Date.now(), toolCalls: 0, bookTourAttempts: 0 }, forwardTo: null, afterHours: false };
  const r = await tools.runTool(s, "transfer_to_school_line", "{}");
  check("G3 transfer tool → action transfer", r.action === "transfer");
  const r2 = await tools.runTool({ ...s, afterHours: true }, "transfer_to_school_line", "{}");
  check("C22 model transfer blocked after hours", r2.ok === false && r2.error === "after_hours_no_transfer");
}
check("tour tools hidden by default", !tools.toolDefs().some((t) => t.function.name === "book_tour" || t.function.name === "read_open_slots"));

// G4
check("G4 exact phrase constant", g.SPOKEN_ESCALATION_TARGET === "the center director and our leadership team.");
check("G4 stay-on-line line uses phrase", h.stayOnLineLine().includes("I'm alerting the center director and our leadership team. "));
const sys = pr.buildSystemPrompt({ facilityId: 2, centerName: "Muhskeet", lang: "en", factsDelimited: sheet.delimited, forwardLabel: "x", afterHours: false, ratesVerified: true });
check("G4 prompt carries exact phrase", sys.includes("the center director and our leadership team"));
const rulesOnly = sys.split("--- FACT_SHEET_DATA")[0]; // fact data may name the director for callbacks
check("G4 no personal escalation names in prompt rules", !/Brianna|Sheri|regional director/i.test(rulesOnly));

// G6
check("G6 intro names Handprints Academy of Mesquite", pr.AMY_INTRO_CANONICAL_EN.includes("Handprints Academy of Mesquite"));
check("G6 intro recording disclosure", /may be recorded/.test(pr.AMY_INTRO_CANONICAL_EN));
check("G6 intro 911", /call 9 1 1/.test(pr.AMY_INTRO_CANONICAL_EN));
check("G6 spoken form muh-SKEET", pr.AMY_INTRO_SPOKEN_EN.includes("Academy of Muhskeet") && !pr.AMY_INTRO_SPOKEN_EN.includes("Mesquite"));
check("G6 model text Mesquite → Muhskeet", h.spokenForm("Welcome to Mesquite!") === "Welcome to Muhskeet!");

// G7
const c = cost.estimateCallCost({ promptVersion: g.AMY_PROMPT_VERSION, model: "gpt-4o-mini", sessionSeconds: 125, llmCalls: 6, inputTokens: 10000, outputTokens: 2000, endReason: "end_call" });
check("G7 billed minutes rounds up", c.billed_minutes === 3);
check("G7 twilio voice 3×0.0085", Math.abs(c.twilio_voice_usd - 0.0255) < 1e-9);
check("G7 relay 3×0.07", Math.abs(c.conversation_relay_usd - 0.21) < 1e-9);
check("G7 llm 10k×0.15/1M + 2k×0.60/1M", Math.abs(c.llm_usd - 0.0027) < 1e-9);
check("G7 estimate flag + prompt version", c.estimate === true && c.prompt_version === g.AMY_PROMPT_VERSION);
check("G7 per-minute present", c.per_minute_usd > 0);
const costSrc = readFileSync(join(__dirname, "../cost/estimate.ts"), "utf8");
check("G7 price sources cited in code", costSrc.includes("twilio.com/en-us/voice/pricing/us") && costSrc.includes("conversational-ai/pricing") && costSrc.includes("gpt-4o-mini"));

// G8 (host side): host never creates leads; lead-upsert payload carries IVR-parity fields only
const toolsSrc = readFileSync(join(__dirname, "../tools/index.ts"), "utf8");
check("G8 callback_preference + tour_interest collected", toolsSrc.includes("callback_preference") && toolsSrc.includes("tour_interest"));
check("G8 214 listed as excluded", g.LEAD_EXCLUDED_CALLERS_LAST10.has("2147046825"));

console.log(JSON.stringify({ pass, fail, ALL: fail === 0 }));
process.exit(fail === 0 ? 0 : 1);
