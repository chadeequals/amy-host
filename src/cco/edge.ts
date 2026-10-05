/**
 * Calls narrow CCO Edge Functions with AMY_HOST_API_TOKEN bearer (C15).
 * Never holds service_role.
 */
function edgeBase(): string {
  return (process.env.CCO_EDGE_BASE_URL || "").replace(/\/$/, "");
}
function token(): string {
  return (process.env.AMY_HOST_API_TOKEN || "").trim();
}

export type AmyEdgeName =
  | "amy-facts-read"
  | "amy-slots-read"
  | "amy-lead-upsert"
  | "amy-tour-book"
  | "amy-call-summary"
  | "amy-relay-consume";

export async function callEdge<T = unknown>(
  name: AmyEdgeName,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = edgeBase();
  const tok = token();
  if (!base || !tok) return { ok: false, error: "edge_unconfigured" };
  // 8s cap so a slow/cold Edge never stalls the live call; network errors fail closed (no throw).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(`${base}/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    console.log("[amy-edge]", name, "network_or_timeout");
    return { ok: false, error: "edge_network" };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    console.log("[amy-edge]", name, res.status);
    return { ok: false, error: `edge_${res.status}` };
  }
  try {
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "edge_bad_json" };
  }
}
