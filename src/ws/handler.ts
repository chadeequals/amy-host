/**
 * ConversationRelay WebSocket handler.
 * Messages: setup / prompt / interrupt / dtmf from Twilio; text / end toward Twilio.
 * No PII in logs — CallSid + facility only.
 * P2-1: setup CallSid must match token claims.
 */
import type { WebSocket } from "ws";
import type { RelayClaims } from "../auth/token.js";
import { chatCompletion, type ChatMessage } from "../llm/openai.js";
import { buildSystemPrompt, CENTER_NAMES } from "../prompt.js";
import { newCaps, sessionExpired } from "../session/caps.js";
import { TOOL_DEFS, runTool, type AmySession } from "../tools/index.js";
import { callEdge } from "../cco/edge.js";
import { quoteSheetForFacility } from "../facts/lockedSheet.js";

type TwilioInbound =
  | { type: "setup"; callSid?: string; customParameters?: Record<string, string>; from?: string }
  | { type: "prompt"; voicePrompt?: string; lang?: string; last?: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt?: string }
  | { type: "dtmf"; digit?: string }
  | { type: "error"; description?: string };

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
  };
  const messages: ChatMessage[] = [];
  let ended = false;
  void meta;

  console.log("[amy-ws] open", claims.callSid, "fac", claims.facilityId);

  const sendText = (token: string, last = false) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "text", token, last }));
  };
  const sendEnd = (handoffData?: Record<string, string>) => {
    if (ended) return;
    ended = true;
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "end", handoffData: handoffData || { reason: "done" } }));
    }
  };

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
      if (msg.type === "setup") {
        // P2-1: bind Twilio CallSid to token claims.
        if (msg.callSid && msg.callSid !== claims.callSid) {
          console.log("[amy-ws] setup callSid mismatch", claims.callSid);
          sendEnd({ reason: "callsid_mismatch" });
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          return;
        }
        const lang = (msg.customParameters?.lang === "es" ? "es" : "en") as "en" | "es";
        session.lang = lang;
        // afterHours from TwiML Parameter (server-set). Default false = in-hours path.
        const ah = (msg.customParameters?.afterHours || msg.customParameters?.after_hours || "").toLowerCase();
        session.afterHours = ah === "1" || ah === "true" || ah === "yes";
        // Do NOT log From. Capture only for tool payloads if needed later (lead uses Edge phone_call).
        const facts = await callEdge<{ delimited?: string; forward_to?: string }>("amy-facts-read", {
          facility_id: session.facilityId,
          call_sid: session.callSid,
        });
        // CFO lock 2026-10-03: HP2 quotes from mesquite.json only.
        // Edge amy-facts-read still requires billing_rate_card_id before it will
        // emit a price — those cards are NOT the charge schedule. Do not use them.
        const sheet = quoteSheetForFacility(session.facilityId);
        const delimited = sheet
          ? sheet.delimited
          : facts.ok
            ? String((facts.data as { delimited?: string }).delimited || "")
            : "";
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
            forwardLabel: session.forwardTo ? "configured" : "unset",
            afterHours: session.afterHours,
          }),
        });
        console.log("[amy-ws] setup", session.callSid, "fac", session.facilityId);
        return;
      }

      if (msg.type === "interrupt") {
        return;
      }

      if (msg.type === "dtmf") {
        // Press 1 → warm-transfer to school line (urgent / live person). Never bare goodbye.
        if ((msg.digit || "").trim() === "1") {
          if (session.afterHours || !session.forwardTo) {
            sendText(
              "I'm alerting the center director and our leadership team right now. " +
                "If a child is in danger, please hang up and call 9 1 1. " +
                "May I have your name, your child's name, and a callback number?",
              true,
            );
            messages.push({
              role: "assistant",
              content:
                "DTMF 1 after-hours/no-forward: alerting leadership; collecting name/child/callback. Never bare goodbye.",
            });
            // Fire urgent take_message via tool path
            const result = await runTool(session, "take_message", JSON.stringify({
              message: "DTMF 1 urgent — caller requested live person; collecting callback",
              urgent: true,
              urgent_kind: "urgent",
            }));
            void result;
            return;
          }
          const result = await runTool(session, "transfer_to_school_line", "{}");
          if (result.action === "transfer") {
            sendText("Of course — connecting you with the school now.", true);
            sendEnd({ reason: "transfer" });
            return;
          }
          sendText(
            "I'm alerting the center director and our leadership team right now. " +
              "If a child is in danger, please hang up and call 9 1 1. " +
              "May I have your name, your child's name, and a callback number?",
            true,
          );
          await runTool(session, "take_message", JSON.stringify({
            message: "DTMF 1 transfer failed — collecting callback",
            urgent: true,
            urgent_kind: "urgent",
          }));
          return;
        }
        return;
      }

      if (msg.type === "prompt") {
        if (sessionExpired(session.caps)) {
          sendText("I've reached my time limit. Goodbye!", true);
          sendEnd({ reason: "session_cap" });
          return;
        }
        const uttered = (msg.voicePrompt || "").trim();
        if (!uttered) return;
        messages.push({ role: "user", content: uttered });
        await replyLoop(session, messages, sendText, sendEnd);
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
    console.log("[amy-ws] close", session.callSid);
  });
}

async function replyLoop(
  session: AmySession,
  messages: ChatMessage[],
  sendText: (t: string, last?: boolean) => void,
  sendEnd: (h?: Record<string, string>) => void,
): Promise<void> {
  for (let round = 0; round < 4; round++) {
    const out = await chatCompletion({ messages, tools: TOOL_DEFS });
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
        const result = await runTool(session, tc.name, tc.arguments);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify(result),
        });
        if (result.action === "transfer") {
          // P2-5: handoffData reason=transfer → amy-done Dial session forward_to only.
          sendText("Of course — connecting you with the school now.", true);
          sendEnd({ reason: "transfer" });
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
          // Danger path: prefer fixed spoken over model content.
          if (result.spoken) sendText(result.spoken, true);
          else if (out.content) sendText(out.content, true);
          else {
            // Never bare "Thank you. Goodbye." on safety/urgent ends — soft confirmation only if no spoken line.
            sendText(
              result.action === "end" && !result.spoken
                ? "Thank you for calling Handprints Academy. If a child is in danger, hang up and call 9 1 1."
                : "Thank you for calling Handprints Academy. Goodbye!",
              true,
            );
          }
          sendEnd({ reason: result.spoken ? "safety_danger" : "end_call" });
          return;
        }
      }
      continue;
    }
    const text = (out.content || "Sorry, I didn't catch that.").trim();
    sendText(text, true);
    messages.push({ role: "assistant", content: text });
    return;
  }
  sendText("Let me have the director follow up with you. Thank you!", true);
}
