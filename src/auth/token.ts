/**
 * One-time ConversationRelay handshake token (C14 / Security P1-1).
 * HMAC verify locally; durable single-use consume via Edge amy-relay-consume (DB).
 * NEVER an in-memory Set with clear-at-N (that revived old nonces).
 * Fail closed if Edge/nonce store unavailable.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type RelayClaims = {
  callSid: string;
  facilityId: number;
  exp: number;
  nonce: string;
};

function secret(): string {
  return (process.env.AMY_RELAY_TOKEN_SECRET || "").trim();
}

export function verifyRelayToken(token: string): RelayClaims | null {
  const sec = secret();
  if (!sec || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let payload: string;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", sec).update(payload).digest();
  let got: Buffer;
  try {
    got = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const [callSid, facStr, expStr, nonce] = payload.split("|");
  const facilityId = Number(facStr);
  const exp = Number(expStr);
  if (!callSid || !nonce || !Number.isFinite(facilityId) || !Number.isFinite(exp)) return null;
  if (exp < Math.floor(Date.now() / 1000)) return null;
  return { callSid, facilityId, exp, nonce };
}

export type ConsumeResult =
  | { ok: true; claims: RelayClaims; sessionsToday: number; dayCapHit: boolean }
  | { ok: false; reason: string };

/**
 * Verify HMAC then atomically consume nonce via Edge (amy_relay_nonce table).
 * Returns null-path as { ok:false } — caller must refuse the socket.
 */
export async function consumeRelayTokenDurable(token: string): Promise<ConsumeResult> {
  const claims = verifyRelayToken(token);
  if (!claims) return { ok: false, reason: "bad_token" };

  const base = (process.env.CCO_EDGE_BASE_URL || "").replace(/\/$/, "");
  const tok = (process.env.AMY_HOST_API_TOKEN || "").trim();
  if (!base || !tok) return { ok: false, reason: "edge_unconfigured" };

  try {
    const res = await fetch(`${base}/amy-relay-consume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        call_sid: claims.callSid,
        nonce: claims.nonce,
        facility_id: claims.facilityId,
        exp: claims.exp,
      }),
    });
    if (!res.ok) {
      console.log("[amy-token] consume rejected", claims.callSid, res.status);
      return { ok: false, reason: `edge_${res.status}` };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      day_cap_hit?: boolean;
      sessions_today?: number;
      error?: string;
    };
    if (!data.ok) {
      return { ok: false, reason: data.error || "consume_failed" };
    }
    return {
      ok: true,
      claims,
      sessionsToday: Number(data.sessions_today || 1),
      dayCapHit: data.day_cap_hit === true,
    };
  } catch {
    console.log("[amy-token] consume network error", claims.callSid);
    return { ok: false, reason: "edge_network" };
  }
}

/** @deprecated Prefer consumeRelayTokenDurable — kept for unit HMAC tests only. */
export function consumeRelayTokenFromUrlSyncVerifyOnly(url: URL): RelayClaims | null {
  const t = url.searchParams.get("t") || "";
  return verifyRelayToken(t);
}
