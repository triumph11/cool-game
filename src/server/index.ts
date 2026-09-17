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
      world.saveBlueprint(you, msg.name, msg.w, msg.h, msg.tiles, msg.machine);
      break;
    case "placeBuilding":
      world.placeBuilding(you, msg.blueprintId, msg.x, msg.y);
      break;
    case "setRecipe":
      world.setRecipe(you, msg.buildingId, msg.recipeId);
      break;
    case "depotBuy":
      world.depotBuy(you, msg.item, msg.qty);
      break;
    case "depotSell":
      world.depotSell(you, msg.item, msg.qty);
      break;
    case "marketSell":
      world.marketSell(you, msg.item, msg.qty, msg.price);
      break;
    case "marketBuy":
      world.marketBuy(you, msg.orderId);
      break;
    case "craft":
      world.craft(you, msg.process, msg.inputs, msg.name);
      break;
    case "mailSend":
      world.mailSend(you, msg.toName, msg.body);
      break;
    case "mailLoan":
      world.mailLoan(you, msg.toName, msg.amount, msg.rate, msg.plotId);
      break;
    case "mailAccept":
      world.mailAccept(you, msg.mailId);
      break;
    case "foundLlc":
      world.foundLlc(you, msg.name);
      break;
    case "llcInvite":
      world.llcInvite(you, msg.llcId, msg.toName, msg.shares);
      break;
    case "transferPlot":
      world.transferPlot(you, msg.plotId, msg.llcId);
      break;
    case "patent":
      world.patent(you, msg.blueprintId);
      break;
    case "licenseOffer":
      world.licenseOffer(you, msg.patentId, msg.toName, msg.killSwitch);
      break;
    case "licenseRevoke":
      world.licenseRevoke(you, msg.licenseId);
      break;
    case "pave":
      world.pave(you, msg.x, msg.y);
      break;
    case "propose":
      world.propose(you, msg.kind, msg.tiles, msg.splits);
      break;
    case "vote":
      world.vote(you, msg.proposalId, msg.vote);
      break;
    case "pledge":
      world.pledge(you, msg.proposalId, msg.marks);
      break;
    case "comment":
      world.comment(you, msg.proposalId, msg.text);
      break;
    case "buyTruck":
      world.buyTruck(you);
      break;
    case "setRoute":
      world.setRoute(you, msg.vehicleId, msg.route);
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
