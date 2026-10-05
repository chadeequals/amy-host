/**
 * Amy host entry — HTTP health + WebSocket upgrade for ConversationRelay.
 * Fail closed: if AMY_ENABLED !== "1", reject new WS sessions.
 * C14: HMAC verify + durable Edge consume (P1-1). No in-memory nonce Set.
 */
import http from "node:http";
import { WebSocketServer } from "ws";
import { handleAmySocket } from "./ws/handler.js";
import { consumeRelayTokenDurable, verifyRelayToken } from "./auth/token.js";

const PORT = Number(process.env.PORT || 10000);

function amyEnabled(): boolean {
  return (process.env.AMY_ENABLED || "").trim() === "1";
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, amy: amyEnabled() ? "armed" : "off" }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!amyEnabled()) {
    console.log("[amy-host] WS refused: AMY_ENABLED off");
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  const rawTok = url.searchParams.get("t") || "";
  // Fast HMAC reject before Edge round-trip.
  if (!verifyRelayToken(rawTok)) {
    console.log("[amy-host] WS refused: bad/missing token");
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  // Durable consume (async) then upgrade.
  void (async () => {
    const consumed = await consumeRelayTokenDurable(rawTok);
    if (!consumed.ok) {
      console.log("[amy-host] WS refused: consume", consumed.reason);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (consumed.dayCapHit) {
      console.log("[amy-host] WS refused: day_cap", consumed.claims.callSid);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleAmySocket(ws, consumed.claims, { sessionsToday: consumed.sessionsToday });
    });
  })();
});

server.listen(PORT, () => {
  console.log("[amy-host] listening", PORT, "amy", amyEnabled() ? "armed" : "off");
});
