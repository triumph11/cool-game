import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { TICK_MS } from "../shared/constants";
import type { ClientMsg, ServerMsg } from "../shared/protocol";
import { World } from "./world";

const PORT = Number(process.env.PORT ?? 3001);
const world = new World();
const sockets = new Map<WebSocket, string>();

const http = createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, tick: world.tick, players: world.accounts.size }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: http, path: "/ws" });

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(): void {
  for (const [ws, playerId] of sockets) {
    const you = world.accounts.get(playerId);
    if (!you) continue;
    send(ws, { t: "state", snapshot: world.snapshot(you) });
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      send(ws, { t: "error", message: "Bad message." });
      return;
    }
    try {
      handle(ws, msg);
    } catch (err) {
      send(ws, { t: "error", message: err instanceof Error ? err.message : "Failed." });
    }
  });
  ws.on("close", () => sockets.delete(ws));
});

function handle(ws: WebSocket, msg: ClientMsg): void {
  if (msg.t === "register" || msg.t === "login") {
    const you = msg.t === "register" ? world.register(msg.name, msg.password) : world.login(msg.name, msg.password);
    sockets.set(ws, you.id);
    send(ws, { t: "welcome", snapshot: world.snapshot(you) });
    broadcast();
    return;
  }
  const playerId = sockets.get(ws);
  if (!playerId) throw new Error("Log in first.");
  const you = world.accounts.get(playerId);
  if (!you) throw new Error("Account missing.");

  switch (msg.t) {
    case "buyPlot":
      world.buyPlot(you, msg.plotId);
      break;
    case "hireWorker":
      world.hireWorker(you);
      break;
    case "setJob":
      world.setJob(you, msg.workerIds, msg.job);
      break;
    case "saveBlueprint":
      world.saveBlueprint(you, msg.name, msg.w, msg.h, msg.tiles);
      break;
    case "placeBuilding":
      world.placeBuilding(you, msg.blueprintId, msg.x, msg.y);
      break;
    case "depotBuy":
      world.depotBuy(you, msg.item, msg.qty);
      break;
    case "depotSell":
      world.depotSell(you, msg.item, msg.qty);
      break;
    default:
      throw new Error("Unknown command.");
  }
  world.save();
  broadcast();
}

setInterval(() => {
  world.step();
  if (sockets.size) broadcast();
}, TICK_MS);

http.listen(PORT, () => {
  console.log(`Claim server on http://127.0.0.1:${PORT}`);
});
