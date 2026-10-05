/** Abuse limits (C21) — stubs enforced in-process. */
export const SESSION_MAX_MS = 15 * 60 * 1000;
export const MAX_TOOL_CALLS = 12;
export const MAX_BOOK_TOUR = 3;

export type SessionCaps = {
  startedAt: number;
  toolCalls: number;
  bookTourAttempts: number;
};

export function newCaps(): SessionCaps {
  return { startedAt: Date.now(), toolCalls: 0, bookTourAttempts: 0 };
}

export function sessionExpired(c: SessionCaps, now = Date.now()): boolean {
  return now - c.startedAt >= SESSION_MAX_MS;
}

export function canCallTool(c: SessionCaps, name: string): { ok: true } | { ok: false; reason: string } {
  if (sessionExpired(c)) return { ok: false, reason: "session_cap_15m" };
  if (c.toolCalls >= MAX_TOOL_CALLS) return { ok: false, reason: "tool_cap" };
  if (name === "book_tour" && c.bookTourAttempts >= MAX_BOOK_TOUR) {
    return { ok: false, reason: "book_tour_cap" };
  }
  return { ok: true };
}

export function recordTool(c: SessionCaps, name: string): void {
  c.toolCalls += 1;
  if (name === "book_tour") c.bookTourAttempts += 1;
}
