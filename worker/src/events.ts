import { DurableObject } from "cloudflare:workers";

// The Worker authenticates subscriptions; /notify is only called internally.
export class NoteEvents extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST" && new URL(request.url).pathname === "/notify") {
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send("notes_changed"); }
        catch { socket.close(1011, "Reconnect to sync"); }
      }
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send("notes_changed");
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "Reconnect to sync");
  }
}
