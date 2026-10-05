#!/usr/bin/env node
/**
 * Amy HP2 enrollment mouthpiece DRY-RUN (Option 2) — TEST ONLY.
 *
 * - Loads locked Mesquite fact sheet from disk (not live DB / not billing).
 * - Builds the system prompt Amy would see + prints quotable rates + safety spoken lines.
 * - Refuses if AMY_ENABLED=1 (kill switch must stay off).
 * - Does NOT open WebSocket, Twilio, ConversationRelay, Edge tools, or place parent calls.
 *
 * Run:
 *   node /workspace/amy-host/scripts/dry-run-enrollment.mjs
 * Optional:
 *   AMY_DRY_RUN_FACT_SHEET=/path/to/mesquite.json node ...
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function amyEnabled() {
  return (process.env.AMY_ENABLED || "").trim() === "1";
}

if (amyEnabled()) {
  console.error("REFUSE: AMY_ENABLED=1. Dry-run requires kill switch OFF. Unset AMY_ENABLED or set 0.");
  process.exit(2);
}

const factPath =
  process.env.AMY_DRY_RUN_FACT_SHEET ||
  "/workspace/cco-integration/phone/fact_sheets/mesquite.json";
const testLinesPath = join(ROOT, "config/test-only-lines.json");
const safetyPath = join(ROOT, "src/safety/constants.ts");

if (!existsSync(factPath)) {
  console.error("Missing fact sheet:", factPath);
  process.exit(1);
}

const facts = JSON.parse(readFileSync(factPath, "utf8"));
const testLines = existsSync(testLinesPath)
  ? JSON.parse(readFileSync(testLinesPath, "utf8"))
  : null;
const safetySrc = readFileSync(safetyPath, "utf8");

const SPEAK_EN =
  "I'm sending an urgent alert to the center director and our leadership team right now. Someone from leadership will follow up first thing when the center opens in the morning.";

function delimitRooms(rooms) {
  const lines = [];
  for (const r of rooms || []) {
    const bits = [`room=${r.room_name}`];
    if (r.age_min_months != null) bits.push(`age_min_mo=${r.age_min_months}`);
    if (r.age_max_months != null) bits.push(`age_max_mo=${r.age_max_months}`);
    if (r.full_time_weekly_usd != null) bits.push(`ft_weekly=${r.full_time_weekly_usd}`);
    else bits.push("ft_weekly=BLANK_hand_off_director");
    if (r.nearly_full === true) bits.push("nearly_full=true");
    lines.push(bits.join("; "));
  }
  return lines.join("\n");
}

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
  f.accepts_workforce_solutions != null && `accepts_workforce_solutions=${f.accepts_workforce_solutions}`,
  f.trs_verified === true && f.trs_level != null && `trs_level=${f.trs_level}`,
  Array.isArray(f.value_points) && f.value_points.length && `value_points=${f.value_points.join(" | ")}`,
  Array.isArray(f.safety_facts) && f.safety_facts.length && `safety_facts=${f.safety_facts.join(" | ")}`,
  f.tuition_quote_scope && `tuition_quote_scope=${f.tuition_quote_scope}`,
  f.registration_fee_usd == null && "registration_fee_usd=BLANK_hand_off_director",
]
  .filter(Boolean)
  .join("\n");

const delimited = [header, delimitRooms(facts.rooms)].filter(Boolean).join("\n");

const quotable = (facts.rooms || [])
  .filter((r) => r.full_time_weekly_usd != null)
  .map((r) => ({ room: r.room_name, weekly_usd: r.full_time_weekly_usd }));
const blanks = (facts.rooms || [])
  .filter((r) => r.full_time_weekly_usd == null)
  .map((r) => r.room_name);

const spokenOk = safetySrc.includes("the center director and our leadership team");
const spokenBad = safetySrc.includes("our regional director");

const out = {
  ok: true,
  mode: "dry_run_enrollment_mouthpiece",
  amy_enabled: process.env.AMY_ENABLED || "(unset)",
  amy_enabled_is_on: false,
  live_calls: false,
  fact_sheet: factPath,
  facility_id: facts.facility_id,
  center: center.center_name,
  test_line: testLines?.test_lines?.[0] || null,
  quotable_weekly_present_rates: quotable,
  blank_hand_off_to_brianna: blanks,
  spoken_alert_line_en: SPEAK_EN,
  spoken_alert_in_safety_constants: spokenOk && !spokenBad,
  fact_sheet_delimited_preview: delimited,
  notes: [
    "Dry-run only — no Twilio, no WS, no Edge, no parent calls.",
    "Do not set AMY_ENABLED=1. Live switch stays off until Monday practice.",
    "Billing rate card was NOT written. Compare separately (CFO lock).",
  ],
};

console.log(JSON.stringify(out, null, 2));
if (!spokenOk || spokenBad) {
  console.error("FAIL: safety constants missing locked spoken leadership-team line");
  process.exit(1);
}
