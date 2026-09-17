import { WebSocket } from "ws";

const url = process.argv[2] ?? "ws://127.0.0.1:3001/ws";

function once(ws) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for server")), 5000);
    ws.once("message", (raw) => {
      clearTimeout(t);
      resolve(JSON.parse(String(raw)));
    });
  });
}

async function waitSnap(ws, pred) {
  for (;;) {
    const msg = await once(ws);
    if (msg.t === "error") throw new Error(msg.message);
    if (msg.t === "welcome" || msg.t === "state") {
      if (!pred || pred(msg.snapshot)) return msg.snapshot;
    }
  }
}

const ws = new WebSocket(url);
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});

const name = "smoke" + Math.floor(Math.random() * 9999);
ws.send(JSON.stringify({ t: "register", name, password: "test" }));
let snap = await waitSnap(ws, (s) => s.you?.name === name);
const cheap = [...snap.plots].filter((p) => !p.ownerId).sort((a, b) => a.price - b.price)[0];
if (!cheap) throw new Error("no unclaimed plots left");
if (snap.you.marks < cheap.price) throw new Error("starter marks too low");

ws.send(JSON.stringify({ t: "buyPlot", plotId: cheap.id }));
snap = await waitSnap(ws, (s) => s.plots.some((p) => p.ownerId === s.you.id));
const owned = snap.plots.find((p) => p.ownerId === snap.you.id);

ws.send(JSON.stringify({ t: "hireWorker" }));
snap = await waitSnap(ws, (s) => s.workers.some((w) => w.ownerId === s.you.id));

ws.send(JSON.stringify({ t: "depotBuy", item: "timber", qty: 1 }));
snap = await waitSnap(ws, (s) => s.you.inventory.timber >= 1);

const beforeOre = snap.depot.buy.ore;
ws.send(JSON.stringify({ t: "depotBuy", item: "ore", qty: 5 }));
snap = await waitSnap(ws, (s) => s.you.inventory.ore >= 5);
if (snap.depot.buy.ore < beforeOre) throw new Error("ore should get more expensive as stock drops");

const bp = snap.you.blueprints[0];
if (!bp) throw new Error("missing starter blueprint");
const originX = owned.gx * 16 + 4;
const originY = owned.gy * 16 + 4;
ws.send(JSON.stringify({ t: "saveBlueprint", name: "smoke shack", w: 8, h: 8, tiles: bp.tiles }));
snap = await waitSnap(ws, (s) => s.you.blueprints.some((b) => b.name === "smoke shack"));

console.log("SMOKE OK", {
  name,
  plot: `${owned.gx},${owned.gy}`,
  marks: snap.you.marks,
  timber: snap.you.inventory.timber,
  ore: snap.you.inventory.ore,
  oreBuy: snap.depot.buy.ore,
  workers: snap.workers.filter((w) => w.ownerId === snap.you.id).length,
  prints: snap.you.blueprints.length,
  unusedPlaceAt: [originX, originY],
});
ws.close();
process.exit(0);
