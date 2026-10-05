/**
 * CFO lock 2026-10-03: HP2 enrollment quotes come ONLY from the locked
 * Mesquite fact sheet (Present Rates). No billing_rate_cards. No DB.
 * Blank bands stay blank — do not invent five-year-old, summer, drop-in,
 * part-time, or registration dollar amounts.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GREENED_WEEKLY_RATES } from "../config/guardrails.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MESQUITE_FACILITY_ID = 2;

/**
 * Guardrail 2 (Phase 4, 2026-10-05): ONLY the bundled copy of the existing mesquite facts file
 * (byte-identical to /workspace/cco-integration/phone/fact_sheets/mesquite.json at commit time).
 * No env override, no DB, no billing_rate_cards.
 */
const BUNDLED = join(__dirname, "../../config/fact_sheets/mesquite.json");

type Room = {
  room_name?: string;
  age_min_months?: number | null;
  age_max_months?: number | null;
  full_time_weekly_usd?: number | null;
  nearly_full?: boolean;
};

type Center = {
  center_name?: string;
  address?: string;
  director_first_name?: string;
  center_hours?: string;
  meals_line?: string;
  ages_served?: string;
};

type Facts = {
  callback_window?: string | null;
  accepts_workforce_solutions?: boolean | null;
  trs_verified?: boolean;
  trs_level?: number | string | null;
  value_points?: string[];
  safety_facts?: string[];
  tuition_quote_scope?: string | null;
  registration_fee_usd?: number | null;
};

type Sheet = {
  facility_id?: number;
  center?: Center;
  facts?: Facts;
  rooms?: Room[];
};

export type LockedQuoteSheet = {
  source: "mesquite_json";
  path: string;
  facility_id: number;
  delimited: string;
  /** Greened weekly Present Rates only. No invented blanks. */
  spoken_rate_lines: string[];
  blank_hand_off: string[];
  billing_rate_cards: false;
  rates_verified_against_greened_list: boolean;
};

function sheetPath(): string | null {
  return existsSync(BUNDLED) ? BUNDLED : null;
}

/**
 * True only when the sheet's quotable (non-null full_time_weekly_usd) rooms are EXACTLY the greened list
 * (same room names, same amounts, nothing extra) and no other price field is populated.
 */
export function sheetMatchesGreenedList(rooms: Room[]): boolean {
  const quotable = rooms.filter((r) => r.full_time_weekly_usd != null);
  if (quotable.length !== GREENED_WEEKLY_RATES.length) return false;
  for (const g of GREENED_WEEKLY_RATES) {
    const hit = quotable.find((r) => r.room_name === g.room);
    if (!hit || hit.full_time_weekly_usd !== g.usd) return false;
  }
  for (const r of rooms as Array<Record<string, unknown>>) {
    for (const k of ["part_time_weekly_usd", "part_time_mwf_weekly_usd", "part_time_tth_weekly_usd", "drop_in_daily_usd"]) {
      if (r[k] != null) return false;
    }
  }
  return true;
}

function delimitRooms(rooms: Room[], ratesOk: boolean): string[] {
  const lines: string[] = [];
  for (const r of rooms) {
    const bits = [`room=${r.room_name}`];
    if (r.age_min_months != null) bits.push(`age_min_mo=${r.age_min_months}`);
    if (r.age_max_months != null) bits.push(`age_max_mo=${r.age_max_months}`);
    if (ratesOk && r.full_time_weekly_usd != null) bits.push(`ft_weekly=${r.full_time_weekly_usd}`);
    else bits.push("ft_weekly=BLANK_hand_off_director");
    if (r.nearly_full === true) bits.push("nearly_full=true");
    lines.push(bits.join("; "));
  }
  return lines;
}

/** Facility 2 only. Other centers are not this lock. */
export function quoteSheetForFacility(facilityId: number): LockedQuoteSheet | null {
  if (facilityId !== MESQUITE_FACILITY_ID) return null;
  const path = sheetPath();
  if (!path) return null;
  const facts = JSON.parse(readFileSync(path, "utf8")) as Sheet;
  const center = facts.center || {};
  const f = facts.facts || {};
  const header = [
    center.center_name && `center_name=${center.center_name}`,
    center.address && `address=${center.address}`,
    center.director_first_name && `director_first_name=${center.director_first_name}`,
    center.center_hours && `center_hours=${center.center_hours}`,
    center.meals_line && `meals_line=${center.meals_line}`,
    center.ages_served && `ages_served=${center.ages_served}`,
    f.callback_window && `callback_window=${f.callback_window}`,
    f.accepts_workforce_solutions != null &&
      `accepts_workforce_solutions=${f.accepts_workforce_solutions}`,
    f.trs_verified === true && f.trs_level != null && `trs_level=${f.trs_level}`,
    Array.isArray(f.value_points) && f.value_points.length
      ? `value_points=${f.value_points.join(" | ")}`
      : "",
    Array.isArray(f.safety_facts) && f.safety_facts.length
      ? `safety_facts=${f.safety_facts.join(" | ")}`
      : "",
    f.tuition_quote_scope && `tuition_quote_scope=${f.tuition_quote_scope}`,
    f.registration_fee_usd == null && "registration_fee_usd=BLANK_hand_off_director",
  ]
    .filter(Boolean)
    .join("\n");

  const rooms = facts.rooms || [];
  // Fail closed: if the file drifted from the greened list, quote NO rates (all bands → director).
  const ratesOk = sheetMatchesGreenedList(rooms);
  if (!ratesOk) console.log("[amy-facts] mesquite.json != greened list — rates withheld");
  const delimited = [header, ...delimitRooms(rooms, ratesOk)].filter(Boolean).join("\n");
  const spoken_rate_lines = ratesOk
    ? rooms
        .filter((r) => r.full_time_weekly_usd != null)
        .map((r) => `${r.room_name}: $${r.full_time_weekly_usd} per week`)
    : [];
  const blank_hand_off = rooms
    .filter((r) => !ratesOk || r.full_time_weekly_usd == null)
    .map((r) => String(r.room_name));

  return {
    source: "mesquite_json",
    path,
    facility_id: MESQUITE_FACILITY_ID,
    delimited,
    spoken_rate_lines,
    blank_hand_off,
    billing_rate_cards: false,
    rates_verified_against_greened_list: ratesOk,
  };
}
