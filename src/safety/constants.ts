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

// ---------------------------------------------------------------------------------------------------------------
// H1 / H2 (Security re-review 2026-10-06). Fixed server-played lines for the alert-FAILED and in-hours danger paths.
// The alert-failed variants are the Curriculum C22 scripts with ONLY the "I'm sending an urgent alert …" sentence(s)
// swapped for a truthful press-1 offer. ⚠ New spoken wording on a C22 path: needs Curriculum + Security sign-off.
// ---------------------------------------------------------------------------------------------------------------

/** H2: in-hours immediate danger. Server speaks this BEFORE firing take_message urgent immediate_danger. */
export const inHoursDangerLine: Record<SafetyLang, string> = {
  en: "This sounds like an emergency. Please hang up and call 9 1 1 now. If you stay on the line, press 1 to reach someone at the center.",
  es: "Esto suena como una emergencia. Por favor cuelgue y marque el 9 1 1 ahora. Si se queda en la línea, marque el 1 para hablar con alguien del centro.",
};

/** H1: Edge urgent alert NOT confirmed (alert_sent!==true / alert_skipped / HTTP or network error). Never claims an alert. */
export const alertFailedLine: Record<SafetyLang, { inHours: string; afterHours: string }> = {
  en: {
    inHours:
      "I'm sorry, I wasn't able to get that message through to the center just now. Please press 1 now to reach someone at the center, or tell me and I'll transfer you. If a child is in danger, hang up and call 9 1 1.",
    afterHours:
      "I'm sorry, I wasn't able to get that message through just now. Please press 1 now to try the center line. If a child is in danger, hang up and call 9 1 1.",
  },
  es: {
    inHours:
      "Lo siento, no pude hacer llegar ese mensaje al centro en este momento. Por favor marque el 1 ahora para hablar con alguien del centro, o dígame y le transfiero. Si un niño o una niña está en peligro, cuelgue y marque el 9 1 1.",
    afterHours:
      "Lo siento, no pude hacer llegar ese mensaje en este momento. Por favor marque el 1 ahora para intentar comunicarse con el centro. Si un niño o una niña está en peligro, cuelgue y marque el 9 1 1.",
  },
};

/** H1: replacement when a MODEL reply claims an alert that Edge has not confirmed. */
export const personOfferLine: Record<SafetyLang, { inHours: string; afterHours: string }> = {
  en: {
    inHours: "I can connect you with someone at the center right now. Press 1 at any time, or tell me and I'll transfer you.",
    afterHours: "You can press 1 at any time to try the center line. If a child is in danger, hang up and call 9 1 1.",
  },
  es: {
    inHours: "Puedo comunicarle con alguien del centro ahora mismo. Marque el 1 en cualquier momento, o dígame y le transfiero.",
    afterHours: "Puede marcar el 1 en cualquier momento para intentar comunicarse con el centro. Si un niño o una niña está en peligro, cuelgue y marque el 9 1 1.",
  },
};

const ALERT_SENTENCE: Record<SafetyLang, string> = {
  en: "I'm sending an urgent alert to the center director and our leadership team right now. Someone from leadership will follow up first thing when the center opens in the morning.",
  es: "Estoy enviando ahora mismo una alerta urgente a la directora del centro y a nuestro equipo de liderazgo. Alguien del liderazgo le dará seguimiento a primera hora cuando el centro abra por la mañana.",
};
const NO_ALERT_SENTENCE: Record<SafetyLang, string> = {
  en: "I wasn't able to send an alert to the center just now. Please press 1 now to try the center line.",
  es: "No pude enviar una alerta al centro en este momento. Por favor marque el 1 ahora para intentar comunicarse con el centro.",
};

/** H1: C22 after-hours script when the urgent alert was NOT confirmed. Danger line has no alert claim (unchanged). */
export function afterHoursSafetyLineNoAlert(kind: AfterHoursSafetyKind, lang: SafetyLang): string {
  const base = afterHoursSafetyLine(kind, lang);
  if (kind === "danger") return base;
  if (!base.includes(ALERT_SENTENCE[lang])) {
    // Fail safe: if Curriculum wording drifts, never speak an unconfirmed alert claim.
    return alertFailedLine[lang].afterHours;
  }
  return base.replace(ALERT_SENTENCE[lang], NO_ALERT_SENTENCE[lang]);
}

/** H1: model-authored text that claims an alert (EN/ES). Fixed lines are not filtered. */
export const ALERT_CLAIM_RE =
  /(^|[^A-Za-zÀ-ÿ])(alert|alerts|alerting|alerted|alerta|alertas|alertar|alertando|alertado|alertada|alerté|alertaré|alertamos)(?![A-Za-zÀ-ÿ])/i;

// ---------------------------------------------------------------------------------------------------------------
// D5 (Security ruling 2:42 PM CT 2026-10-06; Curriculum 2:34 PM): ENGLISH ONLY until a native Spanish read is signed.
// The ES strings in this file are KEPT (for the later native sign-off, CF-7 / S5) but no code path can emit them:
//  - AmySession.lang is the literal type "en" (tools/index.ts) and the handler never assigns it from Twilio;
//  - the WS handler refuses any setup whose lang parameter is not exactly "en" (log: "WS refused: lang_not_en");
//  - model text that reads as Spanish is replaced by englishOnlyLine before TTS (guardEnglishOnly, handler.ts).
// ---------------------------------------------------------------------------------------------------------------

/** D5: the only language Amy speaks. */
export const SPOKEN_LANG = "en" as const;

/** D5: said (verbatim) when the caller speaks Spanish / another language. Pressing 9 mid-Amy does nothing
 *  (handler only acts on DTMF 1), so the caller is told to call back and press 9 at the IVR menu. */
export const englishOnlyLine: { inHours: string; afterHours: string } = {
  inHours:
    "I'm sorry, I can only help in English right now. For Spanish, please call back and press 9 at the start of the call, or press 1 now to reach someone at the center.",
  afterHours:
    "I'm sorry, I can only help in English right now. For Spanish, please call back and press 9 at the start of the call, or call the center when it opens.",
};

/** Common Spanish words that are not ordinary English words (lowercase). */
// D5c (Security R3, 3:05 PM): the name/place particles de, del, la, las, los, el are deliberately NOT markers, so
// English read-backs such as "Is that Juan de la Cruz del Río?" or "Los Fresnos, La Porte, or Del Rio?" never trip.
const SPANISH_MARKERS: ReadonlySet<string> = new Set([
  "que", "qué", "para", "por", "usted", "ustedes", "gracias", "hola", "está", "están", "estoy", "estamos", "esta",
  "este", "esto", "señor", "señora", "niño", "niña", "niños", "hijo", "hija", "hijos", "llamar", "llamada", "llame",
  "puedo", "puede", "pueden", "quiero", "quiere", "necesito", "necesita", "ayudar", "ayudarle", "cuelgue", "marque",
  "favor", "muy", "pero", "cuando", "cuándo", "donde", "dónde", "cómo", "también", "ahora", "mismo", "nuestro",
  "nuestra", "nuestros", "horario", "inscripción", "inscribir", "visita", "buenos", "buenas", "días", "tardes",
  "noches", "una", "unos", "unas", "con", "soy", "sí", "mis", "tengo", "tiene", "hablar",
  "español", "centro", "maestra", "maestro", "escuela", "guardería", "cuánto", "cuesta", "semana", "es",
  "lo", "le", "les", "se", "su", "sus", "en", "al", "pregunta", "preguntas", "llamarle", "directora",
]);

/** D5: does this MODEL FREE-TEXT reply read as Spanish? (¿/¡, or ≥3 Spanish marker words making up ≥30% of the words.)
 *  A Spanish name alone (e.g. "José") never trips it; name particles are not markers (D5c). Only handler.ts sayModel
 *  calls this; fixed server safety lines never pass through it. */
export function looksSpanish(text: string): boolean {
  if (/[¿¡]/.test(text)) return true;
  const words = (text.toLowerCase().match(/[a-zñáéíóúü]+/g) || []);
  if (!words.length) return false;
  const hits = words.filter((w) => SPANISH_MARKERS.has(w)).length;
  return hits >= 3 && hits / words.length >= 0.3;
}
