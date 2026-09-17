import type { ClientMsg, ServerMsg } from "../shared/protocol";
import type { WorldSnapshot } from "../shared/types";

export type Handler = {
  onWelcome: (snap: WorldSnapshot) => void;
  onState: (snap: WorldSnapshot) => void;
  onError: (message: string) => void;
};

export function connect(handler: Handler): { send: (msg: ClientMsg) => void } {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const queue: ClientMsg[] = [];
  let open = false;

  ws.addEventListener("open", () => {
    open = true;
    for (const msg of queue) ws.send(JSON.stringify(msg));
    queue.length = 0;
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMsg;
    if (msg.t === "error") handler.onError(msg.message);
    if (msg.t === "welcome") handler.onWelcome(msg.snapshot);
    if (msg.t === "state") handler.onState(msg.snapshot);
  });
  ws.addEventListener("close", () => handler.onError("Disconnected from the world."));

  return {
    send(msg) {
      if (!open) queue.push(msg);
      else ws.send(JSON.stringify(msg));
    },
  };
}
