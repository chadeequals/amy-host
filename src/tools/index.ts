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
  alertKindForSafety,
  type AfterHoursSafetyKind,
} from "../safety/constants.js";

export type AmySession = {
  callSid: string;
  facilityId: number;
  lang: "en" | "es";
  caps: SessionCaps;
  /** School forward_to — set from setup custom params / facts; never from model. */
  forwardTo: string | null;
  /** After-hours: no live transfer; use fixed C22 safety scripts. */
  afterHours: boolean;
};

export const TOOL_DEFS: ToolDef[] = [
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
        "Create or append THIS caller's lead from fields collected on this call only. Never overwrite existing CRM fields.",
      parameters: {
        type: "object",
        properties: {
          parent_first_name: { type: "string" },
          child_first_name: { type: "string" },
          child_age_or_dob: { type: "string" },
          email: { type: "string" },
          start_date: { type: "string" },
          schedule: { type: "string" },
          subsidy: { type: "string" },
          source: { type: "string" },
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
      description: "Transfer caller to this center's configured school line. No number argument. In-hours only.",
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
        "notes",
      ]) {
        if (typeof args[k] === "string") payload[k] = redactSensitive(String(args[k])).slice(0, 500);
      }
      const r = await callEdge("amy-lead-upsert", payload);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, data: r.data };
    }
    case "book_tour": {
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
      if (!session.forwardTo) return { ok: false, error: "no_forward_to" };
      console.log("[amy-tool] transfer_to_school_line", call_sid, "fac", facility_id);
      return { ok: true, data: { queued: true }, action: "transfer" };
    }
    case "take_message": {
      const message = redactSensitive(String(args.message || "")).slice(0, 500);
      const urgent = Boolean(args.urgent);
      const r = await callEdge("amy-call-summary", {
        facility_id,
        call_sid,
        summary: message,
        urgent,
        kind: "message",
        urgent_kind: typeof args.urgent_kind === "string" ? args.urgent_kind : urgent ? "urgent" : undefined,
      });
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
      // Fixed Curriculum line — never model text.
      const spoken = afterHoursSafetyLine(kind, session.lang);
      const urgentKind = alertKindForSafety(kind);
      const note =
        typeof args.optional_note === "string"
          ? redactSensitive(args.optional_note).slice(0, 500)
          : `after_hours_safety:${kind}`;
      // Fire urgent alert via call-summary (Edge → Resend names-only). Fail closed logged there.
      const r = await callEdge("amy-call-summary", {
        facility_id,
        call_sid,
        summary: note,
        urgent: true,
        kind: "safety",
        urgent_kind: urgentKind,
      });
      console.log("[amy-tool] play_after_hours_safety", call_sid, "fac", facility_id, kind);
      // Even if Edge alert skipped (Amy off / no recipients), still speak fixed line.
      const action = kind === "danger" ? "end" : "safety_speak";
      return {
        ok: true,
        data: { kind, alert_ok: r.ok, alert: r.ok ? r.data : { error: r.error } },
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
