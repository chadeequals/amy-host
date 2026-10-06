/**
 * Amy tool stubs (C18–C21). Facility ALWAYS from session — ignore model-supplied facility_id.
 * C22: play_after_hours_safety speaks Curriculum-fixed lines + fires urgent alert via Edge.
 */
import { callEdge } from "../cco/edge.js";
import { quoteSheetForFacility } from "../facts/lockedSheet.js";
import { redactSensitive } from "../llm/openai.js";
import type { ToolDef } from "../llm/openai.js";
import { canCallTool, recordTool, type SessionCaps } from "../session/caps.js";
import {
  afterHoursSafetyLine,
  afterHoursSafetyLineNoAlert,
  alertFailedLine,
  alertKindForSafety,
  type AfterHoursSafetyKind,
} from "../safety/constants.js";

export type AmySession = {
  callSid: string;
  facilityId: number;
  lang: "en" | "es";
  caps: SessionCaps;
  /** School forward_to — set from setup custom params / facts; never from model. Informational only:
   *  the actual Dial target is chosen by Oracle amy-done from phone_line.forward_to. */
  forwardTo: string | null;
  /** After-hours: no model-initiated live transfer; use fixed C22 safety scripts. (DTMF 1 still dials once.) */
  afterHours: boolean;
  /** Serializes Edge writes that read-modify-write phone_call.enroll_answers (answers + cost + urgent record). */
  writeChain?: Promise<unknown>;
  /** H1: true once Edge CONFIRMED an urgent alert on this call (alert_sent===true, no alert_skipped). */
  urgentAlertOk?: boolean;
  /** H1: true once an urgent alert attempt was NOT confirmed on this call (logged; caller offered press 1 / transfer). */
  urgentAlertFailed?: boolean;
};

export type UrgentAlertOutcome = { ok: true } | { ok: false; reason: string };

/**
 * H1 (Security re-review 2026-10-06): an urgent alert counts as sent ONLY when Edge answered HTTP 2xx with
 * alert_sent===true and no alert_skipped. alert_sent=false, any alert_skipped (no_resend / resend_failed /
 * resend_error / amy_disabled / …), a missing field, or an HTTP/network error is a FAILURE.
 */
export function urgentAlertOutcome(
  r: { ok: true; data: unknown } | { ok: false; error: string },
): UrgentAlertOutcome {
  if (!r.ok) return { ok: false, reason: r.error || "edge_error" };
  const d = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
  const skipped = typeof d.alert_skipped === "string" && d.alert_skipped ? d.alert_skipped : null;
  if (d.alert_sent === true && !skipped) return { ok: true };
  if (skipped) return { ok: false, reason: skipped.replace(/[^\w-]/g, "").slice(0, 32) || "alert_skipped" };
  return { ok: false, reason: d.alert_sent === false ? "alert_not_sent" : "alert_status_missing" };
}

/** H1: one log line per failed urgent alert (CallSid + facility + tool + reason code only; no PII). */
function logUrgentFailure(session: AmySession, tool: string, kind: string, reason: string): void {
  session.urgentAlertFailed = true;
  console.log("[amy-tool] urgent_alert_failed", session.callSid, "fac", session.facilityId, tool, kind, reason);
}

/** Phase 4: tour booking stays OFF on the test line (IVR parity: director books from the CRM card). */
export function bookTourEnabled(): boolean {
  return (process.env.AMY_BOOK_TOUR_ENABLED || "").trim() === "1";
}

/** Run an Edge write after any earlier write for this call finished (no lost JSON merges). */
export function serialWrite<T>(session: AmySession, fn: () => Promise<T>): Promise<T> {
  const prev = session.writeChain || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  session.writeChain = next.catch(() => undefined);
  return next;
}

const ALL_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "read_facts",
      description: "Read this center's fact sheet (allowlisted columns). TRS only if verified.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_open_slots",
      description: "Read open tour slots for this center.",
      parameters: {
        type: "object",
        properties: { days_ahead: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_own_lead",
      description:
        "Save what THIS caller said on THIS call (enrollment answers). Call as soon as you learn any field and again when you learn more; " +
        "only include fields the caller actually said. The CRM card and director email are built from these after the call.",
      parameters: {
        type: "object",
        properties: {
          parent_first_name: { type: "string" },
          child_first_name: { type: "string" },
          child_age_or_dob: { type: "string" },
          email: { type: "string" },
          start_date: { type: "string" },
          schedule: { type: "string", description: "full-time | part-time | before and after school | after-school only, in caller's words" },
          subsidy: { type: "string" },
          source: { type: "string" },
          callback_preference: {
            type: "string",
            description: "Caller's answer to: is the number you're calling from the best callback number? (e.g. 'yes' or what they said)",
          },
          tour_interest: {
            type: "string",
            description: "Caller's answer about a tour: 'yes' plus preferred days/times, or 'not yet'.",
          },
          notes: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_tour",
      description: "Book a tour into an open slot (re-checked server-side).",
      parameters: {
        type: "object",
        properties: {
          slot_id: { type: "string" },
          parent_first_name: { type: "string" },
          child_first_name: { type: "string" },
        },
        required: ["slot_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_to_school_line",
      description: "Warm-transfer caller to this center's school line (number chosen server-side). No number argument. In-hours only.",
      parameters: { type: "object", properties: { reason: { type: "string" } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "take_message",
      description: "Leave a short callback message for the director (≤500 chars after redact). Set urgent=true for rule-4 safety.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          urgent: { type: "boolean" },
          urgent_kind: {
            type: "string",
            description: "immediate_danger | abuse_neglect | injury | distressed | staff_coworker | urgent",
          },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "play_after_hours_safety",
      description:
        "AFTER HOURS only: play Curriculum-fixed safety script (danger / abuse_neglect / injury) and fire urgent alert (spoken: center director and our leadership team). Do not improvise spoken text.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            description: "danger | abuse_neglect | injury",
          },
          optional_note: {
            type: "string",
            description: "Optional ≤500-char note for CCO only (not spoken; not emailed).",
          },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_call",
      description: "End the call politely after closing.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
];

/** Tools offered to the model. Tour slot/booking tools only when AMY_BOOK_TOUR_ENABLED=1 (default off). */
export function toolDefs(): ToolDef[] {
  if (bookTourEnabled()) return ALL_TOOL_DEFS;
  return ALL_TOOL_DEFS.filter((t) => t.function.name !== "book_tour" && t.function.name !== "read_open_slots");
}
/** @deprecated use toolDefs() — kept for back-compat imports. */
export const TOOL_DEFS: ToolDef[] = ALL_TOOL_DEFS;

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Side effects for WS layer */
  action?: "transfer" | "end" | "safety_speak";
  /** Fixed Curriculum line — WS must play verbatim (no model paraphrase). */
  spoken?: string;
};

function parseSafetyKind(raw: unknown): AfterHoursSafetyKind | null {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "danger" || s === "immediate_danger") return "danger";
  if (s === "injury") return "injury";
  if (s === "abuse_neglect" || s === "abuse" || s === "neglect") return "abuse_neglect";
  return null;
}

export async function runTool(
  session: AmySession,
  name: string,
  rawArgs: string,
): Promise<ToolResult> {
  const gate = canCallTool(session.caps, name);
  if (!gate.ok) return { ok: false, error: gate.reason };
  recordTool(session.caps, name);

  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: "bad_args" };
  }
  // Strip any model-supplied facility / phone / url (C18/C20).
  delete args.facility_id;
  delete args.facilityId;
  delete args.phone;
  delete args.to;
  delete args.forward_to;
  delete args.url;

  const facility_id = session.facilityId;
  const call_sid = session.callSid;

  switch (name) {
    case "read_facts": {
      // CFO lock: facility 2 quotes from the locked fact sheet, never billing cards.
      const sheet = quoteSheetForFacility(facility_id);
      if (sheet) {
        return {
          ok: true,
          data: {
            facility_id,
            source: sheet.source,
            fact_sheet: sheet.path,
            delimited: sheet.delimited,
            spoken_rate_lines: sheet.spoken_rate_lines,
            blank_hand_off: sheet.blank_hand_off,
            billing_rate_cards: false,
            tuition_from_billing_cards: "gated",
          },
        };
      }
      const r = await callEdge("amy-facts-read", { facility_id, call_sid });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, data: r.data };
    }
    case "read_open_slots": {
      if (!bookTourEnabled()) return { ok: false, error: "tour_booking_off_collect_preferred_times" };
      const r = await callEdge("amy-slots-read", {
        facility_id,
        call_sid,
        days_ahead: args.days_ahead ?? 14,
      });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, data: r.data };
    }
    case "upsert_own_lead": {
      const payload: Record<string, unknown> = { facility_id, call_sid };
      for (const k of [
        "parent_first_name",
        "child_first_name",
        "child_age_or_dob",
        "email",
        "start_date",
        "schedule",
        "subsidy",
        "source",
        "callback_preference",
        "tour_interest",
        "notes",
      ]) {
        if (typeof args[k] === "string" && String(args[k]).trim()) {
          payload[k] = redactSensitive(String(args[k])).slice(0, 400);
        }
      }
      // Edge merges into phone_call.enroll_answers (IVR-parity keys). Lead create/link + director email
      // happen in Oracle's status callback (linkCallToLead / maybeSendPhoneDirectorAlert).
      const r = await serialWrite(session, () => callEdge("amy-lead-upsert", payload));
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, data: r.data };
    }
    case "book_tour": {
      if (!bookTourEnabled()) return { ok: false, error: "tour_booking_off_collect_preferred_times" };
      const r = await callEdge("amy-tour-book", {
        facility_id,
        call_sid,
        slot_id: args.slot_id,
        parent_first_name: typeof args.parent_first_name === "string" ? args.parent_first_name : undefined,
        child_first_name: typeof args.child_first_name === "string" ? args.child_first_name : undefined,
      });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, data: r.data };
    }
    case "transfer_to_school_line": {
      if (session.afterHours) {
        return { ok: false, error: "after_hours_no_transfer" };
      }
      // Target is chosen by Oracle amy-done from phone_line.forward_to (fallback +19722856683); never the model.
      console.log("[amy-tool] transfer_to_school_line", call_sid, "fac", facility_id);
      return { ok: true, data: { queued: true }, action: "transfer" };
    }
    case "take_message": {
      const message = redactSensitive(String(args.message || "")).slice(0, 500);
      const urgent = Boolean(args.urgent);
      const urgentKind = typeof args.urgent_kind === "string" ? args.urgent_kind : urgent ? "urgent" : undefined;
      const r = await serialWrite(session, () => callEdge("amy-call-summary", {
        facility_id,
        call_sid,
        summary: message,
        urgent,
        kind: "message",
        urgent_kind: urgentKind,
      }));
      if (urgent) {
        // H1: never let the model claim an alert Edge did not confirm. Failure → fixed press-1 / transfer offer.
        const outcome = urgentAlertOutcome(r);
        if (!outcome.ok) {
          logUrgentFailure(session, "take_message", String(urgentKind || "urgent").slice(0, 24), outcome.reason);
          return {
            ok: false,
            error: "urgent_alert_not_sent",
            data: {
              alert_sent: false,
              reason: outcome.reason,
              instruction:
                "The alert was NOT sent. Do not say you sent or are sending an alert. Offer press 1" +
                (session.afterHours ? "." : " or transfer_to_school_line."),
            },
            action: "safety_speak",
            spoken: alertFailedLine[session.lang][session.afterHours ? "afterHours" : "inHours"],
          };
        }
        session.urgentAlertOk = true;
        return { ok: true, data: { ...(r.ok && r.data && typeof r.data === "object" ? r.data : {}), alert_sent: true } };
      }
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, data: r.data };
    }
    case "play_after_hours_safety": {
      // P2-C22-1: in-hours must use transfer_to_school_line + take_message urgent — not after-hours script.
      if (!session.afterHours) {
        return { ok: false, error: "in_hours_use_transfer" };
      }
      const kind = parseSafetyKind(args.kind);
      if (!kind) return { ok: false, error: "bad_safety_kind" };
      const urgentKind = alertKindForSafety(kind);
      const note =
        typeof args.optional_note === "string"
          ? redactSensitive(args.optional_note).slice(0, 500)
          : `after_hours_safety:${kind}`;
      // Fire urgent alert via call-summary (Edge writes the durable urgent record, then Resend names-only).
      // Serialized with other enroll_answers writes (Edge read-modify-writes phone_call.enroll_answers).
      const r = await serialWrite(session, () => callEdge("amy-call-summary", {
        facility_id,
        call_sid,
        summary: note,
        urgent: true,
        kind: "safety",
        urgent_kind: urgentKind,
      }));
      console.log("[amy-tool] play_after_hours_safety", call_sid, "fac", facility_id, kind);
      // H1: fixed Curriculum line. If the alert was NOT confirmed, the variant without the "I'm sending an urgent
      // alert" sentence (press-1 offer instead) is spoken, and the failure is logged. Danger line has no alert claim.
      const outcome = urgentAlertOutcome(r);
      if (outcome.ok) session.urgentAlertOk = true;
      else logUrgentFailure(session, "play_after_hours_safety", urgentKind, outcome.reason);
      const spoken = outcome.ok ? afterHoursSafetyLine(kind, session.lang) : afterHoursSafetyLineNoAlert(kind, session.lang);
      const action = kind === "danger" ? "end" : "safety_speak";
      return {
        ok: true,
        data: {
          kind,
          alert_sent: outcome.ok,
          ...(outcome.ok ? {} : { alert_failure: outcome.reason }),
        },
        spoken,
        action,
      };
    }
    case "end_call": {
      const summary = redactSensitive(String(args.summary || "")).slice(0, 500);
      await callEdge("amy-call-summary", {
        facility_id,
        call_sid,
        summary,
        kind: "end",
      });
      return { ok: true, data: { ended: true }, action: "end" };
    }
    default:
      return { ok: false, error: "unknown_tool" };
  }
}
