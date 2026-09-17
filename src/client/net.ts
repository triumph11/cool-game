import type { ClientMsg, ServerMsg } from "../shared/protocol";
import type { WorldSnapshot } from "../shared/types";

export type Handler = {
  onWelcome: (snap: WorldSnapshot) => void;
  onState: (snap: WorldSnapshot) => void;
  onError: (message: string) => void;
};

export function connect(handler: Handler): { send: (msg: ClientMsg) => void } {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const queue: ClientMsg[] = [];
  let ws: WebSocket | null = null;
  let open = false;

  function attach(socket: WebSocket): void {
    socket.addEventListener("open", () => {
      open = true;
      for (const msg of queue) socket.send(JSON.stringify(msg));
      queue.length = 0;
    });
    socket.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg;
      if (msg.t === "error") handler.onError(msg.message);
      if (msg.t === "welcome") handler.onWelcome(msg.snapshot);
      if (msg.t === "state") handler.onState(msg.snapshot);
    });
    socket.addEventListener("close", () => {
      open = false;
      handler.onError("Lost the world. Reconnecting…");
      window.setTimeout(connectSocket, 600);
    });
    socket.addEventListener("error", () => {
      /* close handler will reconnect */
    });
  }

  function connectSocket(): void {
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    attach(ws);
  }

  connectSocket();

  return {
    send(msg) {
      if (!open || !ws || ws.readyState !== WebSocket.OPEN) queue.push(msg);
      else ws.send(JSON.stringify(msg));
    },
  };
}
