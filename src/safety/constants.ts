/**
 * C22 / SEC-026 — Curriculum-approved after-hours safety spoken lines (2026-09-29).
 * Fixed server-played text only — do not paraphrase via the model.
 * Source: /workspace/phone/C22-AFTER_HOURS_SAFETY_SCRIPT_SIGN_OFF_2026-09-29.md
 * Spoken wording owned by Curriculum; hotline verified 2026-09-29.
 */

export type SafetyLang = "en" | "es";

/** Configurable Texas DFPS Abuse Hotline (Curriculum/COO verify). Spoken digit-by-digit in scripts. */
export const TEXAS_ABUSE_HOTLINE_DISPLAY = "1-800-252-5400";
export const TEXAS_ABUSE_HOTLINE_SPOKEN = "1 8 0 0, 2 5 2, 5 4 0 0";
export const TEXAS_ABUSE_HOTLINE_URL_SPOKEN_EN = "T X abuse hotline dot org";
export const TEXAS_ABUSE_HOTLINE_URL_SPOKEN_ES = "te equis abuse hotline punto org";
export const TEXAS_ABUSE_HOTLINE_URL = "https://www.txabusehotline.org";

export type AfterHoursSafetyKind = "danger" | "abuse_neglect" | "injury";

/** Immediate danger — hang up for 911. Then end call; still fire urgent alert. */
export const afterHoursSafetyDanger: Record<SafetyLang, string> = {
  en: "This sounds like an emergency. Please hang up and call 9 1 1 now. I'm ending this call so you can dial 9 1 1.",
  es: "Esto suena como una emergencia. Por favor cuelgue y marque el 9 1 1 ahora. Voy a terminar esta llamada para que pueda marcar el 9 1 1.",
};

/**
 * Abuse/neglect (and injury-when-abuse-also-suspected) after hours.
 * Includes hotline twice, urgent alert to the center director and our leadership team, morning follow-up, optional callback fields. Locked 2026-10-03 (no names).
 */
export const afterHoursSafetyAbuseNeglect: Record<SafetyLang, string> = {
  en: [
    "Thank you for telling me. First, is anyone in danger right now?",
    "",
    "If you think a child is being abused or neglected, you can report it to the Texas Abuse Hotline, run by the state's Department of Family and Protective Services. The number is 1 8 0 0, 2 5 2, 5 4 0 0. Again, 1 8 0 0, 2 5 2, 5 4 0 0. It's open 24 hours a day. You can also report online at T X abuse hotline dot org, but for anything urgent, please call.",
    "",
    "I'm sending an urgent alert to the center director and our leadership team right now. Someone from leadership will follow up first thing when the center opens in the morning.",
    "",
    "If you'd like a call back, may I have your name and a good number? You don't have to give your name. In a sentence or two, what would you like them to know?",
    "",
    "Thank you for calling. If a child is ever in danger, hang up and call 9 1 1.",
  ].join("\n"),
  es: [
    "Gracias por avisarme. Primero, ¿hay alguien en peligro en este momento?",
    "",
    "Si cree que un niño o una niña está siendo abusado o descuidado, puede reportarlo a la Línea de Abuso de Texas, del Departamento de Servicios para la Familia y de Protección del estado. El número es 1 8 0 0, 2 5 2, 5 4 0 0. De nuevo, 1 8 0 0, 2 5 2, 5 4 0 0. Está abierta las 24 horas. También puede reportar en línea en te equis abuse hotline punto org, pero si es urgente, por favor llame.",
    "",
    "Estoy enviando ahora mismo una alerta urgente a la directora del centro y a nuestro equipo de liderazgo. Alguien del liderazgo le dará seguimiento a primera hora cuando el centro abra por la mañana.",
    "",
    "Si desea que le llamen, ¿me puede dar su nombre y un buen número? No tiene que darme su nombre. En una o dos frases, ¿qué desea que ellos sepan?",
    "",
    "Gracias por llamar. Si un niño o una niña alguna vez está en peligro, cuelgue y marque el 9 1 1.",
  ].join("\n"),
};

/** Injury at center after hours (not Path A). No medical advice. Alert + morning follow-up. */
export const afterHoursSafetyInjury: Record<SafetyLang, string> = {
  en: "I'm sorry to hear that. Is anyone in danger, or does your child need emergency care right now? I can't give medical advice. If you're worried about your child's health, please contact your child's doctor, or call 9 1 1 in an emergency. I'm sending an urgent alert to the center director and our leadership team right now. Someone from leadership will follow up first thing when the center opens in the morning.",
  es: "Lamento escuchar eso. ¿Hay alguien en peligro, o su niño o niña necesita atención de emergencia ahora mismo? No puedo dar consejos médicos. Si le preocupa la salud de su hijo o hija, por favor contacte al médico del niño, o marque el 9 1 1 en una emergencia. Estoy enviando ahora mismo una alerta urgente a la directora del centro y a nuestro equipo de liderazgo. Alguien del liderazgo le dará seguimiento a primera hora cuando el centro abra por la mañana.",
};

export const afterHoursSafetyConfidential: Record<SafetyLang, string> = {
  en: "I can't make promises about that. You don't have to give me your name. What you tell me goes to Handprints leadership so they can follow up. The hotline can tell you how they handle your information.",
  es: "No puedo hacer promesas sobre eso. No tiene que darme su nombre. Lo que me diga llega al liderazgo de Handprints para que puedan darle seguimiento. La línea de abuso puede explicarle cómo manejan su información.",
};

export const afterHoursSafetyIsThisAbuse: Record<SafetyLang, string> = {
  en: "I can't advise on that, but the Texas Abuse Hotline can help. Their number is 1 8 0 0, 2 5 2, 5 4 0 0.",
  es: "No puedo aconsejar sobre eso, pero la Línea de Abuso de Texas puede ayudarle. Su número es 1 8 0 0, 2 5 2, 5 4 0 0.",
};

export function afterHoursSafetyLine(kind: AfterHoursSafetyKind, lang: SafetyLang): string {
  if (kind === "danger") return afterHoursSafetyDanger[lang];
  if (kind === "injury") return afterHoursSafetyInjury[lang];
  return afterHoursSafetyAbuseNeglect[lang];
}

/** Map tool kind → alert kind for CCO urgent email (names-only body; kind logged only). */
export function alertKindForSafety(kind: AfterHoursSafetyKind): string {
  if (kind === "danger") return "immediate_danger";
  if (kind === "injury") return "injury";
  return "abuse_neglect";
}
