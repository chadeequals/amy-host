/**
 * ConversationRelay WebSocket handler.
 * Messages: setup / prompt / interrupt / dtmf from Twilio; text / end toward Twilio.
 * No PII in logs — CallSid + facility only.
 * P2-1: setup CallSid must match token claims.
 *
 * Phase 4 guardrails (2026-10-05):
 *  G1  setup.to (or server-set calledNumber param) must be the HP2 TEST line; facility must be 2. Else end.
 *  G2  every model reply passes guardTuitionReply() before TTS (greened weekly list only).
 *  G3  DTMF "1" at ANY point → end{handoffData:'{"reason":"transfer"}'} → Oracle amy-done <Dial>s the school line;
 *      Dial no-answer → Oracle stays on line, collects callback, emails (celias-only on this path).
 *      handoffData MUST be a JSON string (Twilio rejects objects with 64107).
 *  G4  escalation phrase from SPOKEN_ESCALATION_TARGET only.
 *  G7  per-call cost estimate posted once on close (Edge amy-call-summary kind=cost_meta → phone_call.enroll_answers._amy_cost).
 *  H1  (2026-10-06) model text claiming an alert is replaced by a press-1 / transfer offer unless Edge CONFIRMED an
 *      urgent alert on this call (session.urgentAlertOk). Fixed safety lines are not filtered.
 *  H2  (2026-10-06) in hours, take_message urgent_kind=immediate_danger → the server speaks the fixed 911 line
 *      (inHoursDangerLine) BEFORE the Edge urgent write/alert runs, so the 911 instruction is never delayed by Edge
 *      and the alert still fires if the caller hangs up to dial 911.
 *  D5  (2026-10-06) ENGLISH ONLY: setup whose lang parameter is not exactly "en" is refused ("WS refused: lang_not_en");
 *      session.lang is the literal "en" (never read from Twilio), so no ES safety constant can be emitted; model text
 *      that reads as Spanish is replaced by the fixed englishOnlyLine (guardEnglishOnly).
 */
import type { WebSocket } from "ws";
import type { RelayClaims } from "../auth/token.js";
import { chatCompletion, llmModel, type ChatMessage } from "../llm/openai.js";
import { AMY_PROMPT_VERSION, buildSystemPrompt, CENTER_NAMES } from "../prompt.js";
import { newCaps, sessionExpired } from "../session/caps.js";
import { runTool, serialWrite, toolDefs, type AmySession } from "../tools/index.js";
import { callEdge } from "../cco/edge.js";
import { quoteSheetForFacility } from "../facts/lockedSheet.js";
import { guardTuitionReply } from "../safety/tuitionGuard.js";
import { AMY_TEST_LINE_FACILITY_ID, isAllowedCalledNumber, SPOKEN_ESCALATION_TARGET } from "../config/guardrails.js";
import { estimateCallCost } from "../cost/estimate.js";
import { ALERT_CLAIM_RE, englishOnlyLine, inHoursDangerLine, looksSpanish, personOfferLine } from "../safety/constants.js";

/** H2: does this take_message call carry urgent_kind=immediate_danger? (args are model JSON; parse defensively) */
export function isImmediateDangerMessage(name: string, rawArgs: string): boolean {
  if (name !== "take_message") return false;
  try {
    const a = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
    return String(a.urgent_kind || "").trim().toLowerCase() === "immediate_danger";
  } catch {
    return false;
  }
}

/** D5b test seam: under AMY_LLM_MOCK=1 ONLY, a test may swap the detector (e.g. "everything is Spanish") to prove
 *  that fixed server safety lines never pass through this guard. Ignored in production (env unset). */
function spanishDetector(): (t: string) => boolean {
  const o = (globalThis as { __amyLooksSpanishForTest?: unknown }).__amyLooksSpanishForTest;
  return process.env.AMY_LLM_MOCK === "1" && typeof o === "function" ? (o as (t: string) => boolean) : looksSpanish;
}

/** D5: replace a MODEL FREE-TEXT reply that reads as Spanish with the fixed English-only line.
 *  D5b (Security 2:57 PM): called from exactly one place, sayModel (model-authored text). Fixed server lines
 *  (911, alert-failed, after-hours C22/injury/danger, offer-a-person, time-limit, end lines) go out through
 *  sendText directly and are never inspected, replaced or suppressed by this guard. */
export function guardEnglishOnly(text: string, s: { afterHours: boolean }): { text: string; blocked: boolean } {
  if (!spanishDetector()(text)) return { text, blocked: false };
  return { text: s.afterHours ? englishOnlyLine.afterHours : englishOnlyLine.inHours, blocked: true };
}

/** H1: replace a model reply that claims an alert unless Edge confirmed one on this call. */
export function guardAlertClaim(
  text: string,
  s: { lang: "en"; afterHours: boolean; urgentAlertOk?: boolean },
): { text: string; blocked: boolean } {
  if (s.urgentAlertOk || !ALERT_CLAIM_RE.test(text)) return { text, blocked: false };
  return { text: personOfferLine[s.lang][s.afterHours ? "afterHours" : "inHours"], blocked: true };
}

type TwilioInbound =
  | { type: "setup"; callSid?: string; customParameters?: Record<string, string>; from?: string; to?: string }
  | { type: "prompt"; voicePrompt?: string; lang?: string; last?: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt?: string }
  | { type: "dtmf"; digit?: string }
  | { type: "error"; description?: string };

export type UsageTally = { llmCalls: number; inputTokens: number; outputTokens: number };

/** Exact stay-on-line line (G4). */
export function stayOnLineLine(): string {
  return (
    `I'm alerting ${SPOKEN_ESCALATION_TARGET} ` +
    "If a child is in danger, please hang up and call 9 1 1. " +
    "May I have your name, your child's name, and a callback number?"
  );
}

/** Twilio requires handoffData to be a STRING; JSON-encode structured data. */
export function endMessage(handoff: Record<string, string>): string {
  return JSON.stringify({ type: "end", handoffData: JSON.stringify(handoff) });
}

/** Spoken-form fix for model text: Mesquite → Muhskeet (muh-SKEET), never mess-KEE-tay. */
export function spokenForm(text: string): string {
  return text.replace(/\bMesquite\b/g, "Muhskeet");
}

export function handleAmySocket(
  ws: WebSocket,
  claims: RelayClaims,
  meta?: { sessionsToday?: number },
): void {
  const session: AmySession = {
    callSid: claims.callSid,
    facilityId: claims.facilityId,
    lang: "en",
    caps: newCaps(),
    forwardTo: null,
    afterHours: false,
    writeChain: Promise.resolve(),
  };
  const messages: ChatMessage[] = [];
  const usage: UsageTally = { llmCalls: 0, inputTokens: 0, outputTokens: 0 };
  const openedAt = Date.now();
  let ended = false;
  let endReason = "caller_hangup";
  let setupOk = false;
  let ratesVerified = false;
  let costPosted = false;
  void meta;

  console.log("[amy-ws] open", claims.callSid, "fac", claims.facilityId);

  const sendText = (token: string, last = false) => {
    if (ended || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "text", token, last }));
  };
  const sendEnd = (handoffData?: Record<string, string>) => {
    if (ended) return;
    ended = true;
    endReason = (handoffData && handoffData.reason) || "done";
    if (ws.readyState === ws.OPEN) {
      ws.send(endMessage(handoffData || { reason: "done" }));
    }
  };
  const refuse = (reason: string) => {
    console.log("[amy-ws] refuse", reason, session.callSid);
    sendEnd({ reason });
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };
  /** G3: hand the call back to Oracle for a warm transfer. Oracle speaks "connecting" and Dials. */
  const transferNow = (via: string) => {
    console.log("[amy-ws] transfer", via, session.callSid);
    sendEnd({ reason: "transfer", via });
  };

  // G1 (host side): token facility must be the test-line facility.
  if (claims.facilityId !== AMY_TEST_LINE_FACILITY_ID) {
    refuse("not_test_line_facility");
    return;
  }

  const hardStopTimer = setTimeout(() => {
    console.log("[amy-ws] 15m cap", session.callSid);
    sendText("I've reached my time limit for this call. Someone from the school will follow up. Goodbye!", true);
    sendEnd({ reason: "session_cap" });
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }, 15 * 60 * 1000 + 500);

  ws.on("message", async (buf) => {
    if (ended) return;
    let msg: TwilioInbound;
    try {
      msg = JSON.parse(String(buf)) as TwilioInbound;
    } catch {
      return;
    }
    try {
      // G3: DTMF 1 wins from ANY point (before/after setup, during model turns).
      if (msg.type === "dtmf") {
        if ((msg.digit || "").trim() === "1") transferNow("dtmf_1");
        return;
      }

      if (msg.type === "setup") {
        // P2-1: bind Twilio CallSid to token claims.
        if (msg.callSid && msg.callSid !== claims.callSid) {
          refuse("callsid_mismatch");
          return;
        }
        // G1: called number must be the TEST line. Twilio's setup.to is authoritative; the server-set
        // calledNumber Parameter (Oracle) is the fallback. Any present value must be allowlisted.
        const to = (msg.to || "").trim();
        const calledParam = (msg.customParameters?.calledNumber || "").trim();
        const presented = [to, calledParam].filter(Boolean);
        if (!presented.length || !presented.every((n) => isAllowedCalledNumber(n))) {
          refuse("not_test_line");
          return;
        }
        // D5: English only. Oracle always sends <Parameter name="lang" value="en|es"/> (Oracle amy.ts:181); anything
        // other than exactly "en" (including missing) is refused. handoffData reason "error" is used because Oracle's
        // amy-done FALLBACK_REASONS (amy-done-logic.ts:8-14) maps it to the IVR drop-back (amy-fallback) in the
        // caller's language; an unknown reason would hit amy-done's goodbye + hangup instead.
        const langParam = String(msg.customParameters?.lang ?? "").trim().toLowerCase();
        if (langParam !== "en") {
          console.log("[amy-ws] WS refused: lang_not_en", session.callSid);
          sendEnd({ reason: "error", refused: "lang_not_en" });
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          return;
        }
        // session.lang stays the literal "en" (D5) — never assigned from Twilio.
        const ah = (msg.customParameters?.afterHours || msg.customParameters?.after_hours || "").toLowerCase();
        session.afterHours = ah === "1" || ah === "true" || ah === "yes";
        // Do NOT log From.
        const facts = await callEdge<{ delimited?: string; forward_to?: string }>("amy-facts-read", {
          facility_id: session.facilityId,
          call_sid: session.callSid,
        });
        // G2 / CFO lock 2026-10-03: HP2 quotes from mesquite.json only (verified against greened list).
        const sheet = quoteSheetForFacility(session.facilityId);
        ratesVerified = !!sheet?.rates_verified_against_greened_list;
        const delimited = sheet ? sheet.delimited : "";
        if (facts.ok && (facts.data as { forward_to?: string }).forward_to) {
          session.forwardTo = String((facts.data as { forward_to?: string }).forward_to);
        }
        const center = CENTER_NAMES[session.facilityId] || "Handprints";
        messages.length = 0;
        messages.push({
          role: "system",
          content: buildSystemPrompt({
            facilityId: session.facilityId,
            centerName: center,
            lang: session.lang,
            factsDelimited: delimited,
            forwardLabel: "configured_server_side",
            afterHours: session.afterHours,
            ratesVerified,
          }),
        });
        setupOk = true;
        console.log("[amy-ws] setup", session.callSid, "fac", session.facilityId, "rates_ok", ratesVerified);
        return;
      }

      if (msg.type === "interrupt") return;

      if (msg.type === "prompt") {
        if (!setupOk) return; // never talk before G1 passed
        if (sessionExpired(session.caps)) {
          sendText("I've reached my time limit. Goodbye!", true);
          sendEnd({ reason: "session_cap" });
          return;
        }
        const uttered = (msg.voicePrompt || "").trim();
        if (!uttered) return;
        messages.push({ role: "user", content: uttered });
        await replyLoop(session, messages, usage, ratesVerified, sendText, sendEnd, () => ended);
        return;
      }

      if (msg.type === "error") {
        console.log("[amy-ws] twilio error", session.callSid);
        sendEnd({ reason: "twilio_error" });
      }
    } catch {
      console.log("[amy-ws] handler error", session.callSid);
      sendText("I'm having trouble right now. Let me have the school call you back.", true);
      sendEnd({ reason: "error" });
    }
  });

  ws.on("close", () => {
    clearTimeout(hardStopTimer);
    console.log("[amy-ws] close", session.callSid, "reason", endReason);
    if (costPosted || !setupOk) return;
    costPosted = true;
    // G7: one cost record per conversational call, after any pending answer writes.
    const cost = estimateCallCost({
      promptVersion: AMY_PROMPT_VERSION,
      model: llmModel(),
      sessionSeconds: (Date.now() - openedAt) / 1000,
      llmCalls: usage.llmCalls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endReason,
    });
    void serialWrite(session, () =>
      callEdge("amy-call-summary", {
        facility_id: session.facilityId,
        call_sid: session.callSid,
        kind: "cost_meta",
        summary: "cost_meta",
        cost,
      }),
    ).then((r) => {
      if (!r.ok) console.log("[amy-ws] cost_meta not stored", session.callSid, r.error);
    });
  });
}

async function replyLoop(
  session: AmySession,
  messages: ChatMessage[],
  usage: UsageTally,
  ratesVerified: boolean,
  sendText: (t: string, last?: boolean) => void,
  sendEnd: (h?: Record<string, string>) => void,
  isEnded: () => boolean,
): Promise<void> {
  /** G2: every model-authored line goes through the tuition filter. Fixed safety lines do not. */
  let englishOnlyFired = false;
  const sayModel = (raw: string) => {
    const g = guardTuitionReply(raw, session.lang, ratesVerified);
    if (g.blocked) console.log("[amy-ws] tuition_guard", session.callSid, g.reason);
    const e = guardEnglishOnly(g.text, session);
    englishOnlyFired = e.blocked;
    if (e.blocked) console.log("[amy-ws] english_only_guard", session.callSid);
    const a = guardAlertClaim(e.text, session);
    if (a.blocked) console.log("[amy-ws] alert_claim_guard", session.callSid, session.urgentAlertFailed ? "after_failure" : "unconfirmed");
    sendText(spokenForm(a.text), true);
    return a.text;
  };
  let dangerLineSpoken = false;

  for (let round = 0; round < 4; round++) {
    if (isEnded()) return;
    const out = await chatCompletion({ messages, tools: toolDefs() });
    usage.llmCalls += 1;
    usage.inputTokens += out.usage?.input_tokens || 0;
    usage.outputTokens += out.usage?.output_tokens || 0;
    if (isEnded()) return; // e.g. caller pressed 1 while the model was thinking
    if (out.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: out.content || "",
        tool_calls: out.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
      for (const tc of out.tool_calls) {
        if (!session.afterHours && !dangerLineSpoken && isImmediateDangerMessage(tc.name, tc.arguments)) {
          // H2: fixed 911 line first (in hours); the urgent take_message below then records + alerts.
          sendText(inHoursDangerLine[session.lang], true);
          dangerLineSpoken = true;
          console.log("[amy-ws] in_hours_danger_line", session.callSid);
        }
        const result = await runTool(session, tc.name, tc.arguments);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify(result),
        });
        if (isEnded()) return;
        if (result.action === "transfer") {
          // P2-5: handoffData reason=transfer → amy-done Dials phone_line.forward_to only.
          sendEnd({ reason: "transfer", via: "model" });
          return;
        }
        if (result.action === "safety_speak") {
          // C22: Curriculum-fixed line only — never model paraphrase.
          const line = (result.spoken || "").trim();
          if (line) sendText(line, true);
          messages.push({ role: "assistant", content: line || "[safety_script]" });
          return;
        }
        if (result.action === "end") {
          if (result.spoken) sendText(result.spoken, true);
          else if (out.content) {
            const said = sayModel(out.content);
            if (englishOnlyFired && !session.afterHours) {
              // D5c (Security 3:08 PM): the in-hours English-only line says "press 1 now". Do NOT hang up on that
              // turn: keep the session open so DTMF 1 → transferNow (G3) works. No new wording. After hours the
              // English-only line has no press-1 offer, so the call ends normally below.
              messages.push({ role: "assistant", content: said });
              console.log("[amy-ws] english_only_guard_keep_open", session.callSid);
              return;
            }
          } else sendText("Thank you for calling Handprints Academy. If a child is ever in danger, hang up and call 9 1 1.", true);
          sendEnd({ reason: result.spoken ? "safety_danger" : "end_call" });
          return;
        }
      }
      continue;
    }
    const text = sayModel((out.content || "Sorry, I didn't catch that.").trim());
    messages.push({ role: "assistant", content: text });
    return;
  }
  sendText("Let me have the center director follow up with you. Thank you!", true);
}
