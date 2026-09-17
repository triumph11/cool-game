import { DESIGNER_SIZE, HIRE_COST, MATERIALS, PALETTE, PLOT_TILES, STRUCTURE, TILE_PX, WORLD_TILES } from "../shared/constants";
import { billOfMaterials, materialLabel } from "../shared/economy";
import { inWorld, plotIdAt } from "../shared/geo";
import type { ClientMsg } from "../shared/protocol";
import type { StructureKind, WorldSnapshot } from "../shared/types";
import { connect } from "./net";
import { drawWorld, makeCamera, screenToTile, STRUCT_HEX, type Camera } from "./render";

type Tool = "select" | "buy" | "hire" | "mine" | "build";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const inspect = document.querySelector("#inspect")!;
const hint = document.querySelector("#hint")!;
const invEl = document.querySelector("#inv")!;
const marksEl = document.querySelector("#marks")!;
const tickEl = document.querySelector("#tick")!;
const toast = document.querySelector("#toast")!;

let snap: WorldSnapshot | null = null;
let tool: Tool = "select";
let cam: Camera = makeCamera();
let hover: { x: number; y: number } | null = null;
let selected = new Set<string>();
let paint: StructureKind = STRUCTURE.timberWall;
let design: StructureKind[] = new Array(DESIGNER_SIZE * DESIGNER_SIZE).fill(STRUCTURE.empty);
let selectedBlueprint: string | null = null;
let dragging = false;
let lastMouse = { x: 0, y: 0 };
const keys = new Set<string>();

const net = connect({
  onWelcome(s) {
    snap = s;
    document.querySelector("#boot")!.setAttribute("hidden", "hidden");
    document.querySelector("#game")!.removeAttribute("hidden");
    document.querySelector("#boot-err")!.textContent = "";
    focusHome();
    renderHud();
    renderDesigner();
  },
  onState(s) {
    snap = s;
    renderHud();
  },
  onError(message) {
    if (snap) showToast(message);
    else if (!message.startsWith("Lost")) {
      document.querySelector("#boot-err")!.textContent = message;
    }
  },
});

function send(msg: ClientMsg): void {
  net.send(msg);
}

document.querySelector("#register")!.addEventListener("click", () => auth("register"));
document.querySelector("#login")!.addEventListener("click", () => auth("login"));
for (const id of ["#name", "#pass"]) {
  document.querySelector(id)!.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") auth("login");
  });
}

function auth(kind: "register" | "login"): void {
  const name = (document.querySelector("#name") as HTMLInputElement).value.trim();
  const password = (document.querySelector("#pass") as HTMLInputElement).value;
  const err = document.querySelector("#boot-err")!;
  if (name.length < 3) {
    err.textContent = "Name must be at least 3 characters.";
    return;
  }
  if (password.length < 4) {
    err.textContent = "Password must be at least 4 characters.";
    return;
  }
  err.textContent = kind === "register" ? "Creating account…" : "Logging in…";
  send({ t: kind, name, password });
}

document.querySelector("#tools")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const next = btn.dataset.tool as Tool | undefined;
  const panel = btn.dataset.panel;
  if (next) {
    tool = next;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#tools [data-tool]")) {
      b.classList.toggle("on", b.dataset.tool === tool);
    }
    setHint();
  }
  if (panel) toggleSheet(panel);
});

for (const close of document.querySelectorAll("[data-close]")) {
  close.addEventListener("click", () => {
    const id = (close as HTMLElement).dataset.close!;
    document.querySelector(`#${id}`)?.setAttribute("hidden", "");
  });
}

document.querySelector("#bp-save")!.addEventListener("click", () => {
  const name = (document.querySelector("#bp-name") as HTMLInputElement).value;
  send({ t: "saveBlueprint", name, w: DESIGNER_SIZE, h: DESIGNER_SIZE, tiles: design });
});
document.querySelector("#bp-clear")!.addEventListener("click", () => {
  design = new Array(DESIGNER_SIZE * DESIGNER_SIZE).fill(STRUCTURE.empty);
  renderDesigner();
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
  if (e.button === 1 || e.button === 2) dragging = true;
  if (e.button === 0) onClick();
});
window.addEventListener("mouseup", () => {
  dragging = false;
});
window.addEventListener("mousemove", (e) => {
  if (dragging) {
    cam.x -= (e.clientX - lastMouse.x) / cam.zoom;
    cam.y -= (e.clientY - lastMouse.y) / cam.zoom;
  }
  lastMouse = { x: e.clientX, y: e.clientY };
  if (!snap) return;
  const rect = canvas.getBoundingClientRect();
  hover = screenToTile(cam, canvas, e.clientX - rect.left, e.clientY - rect.top);
  renderInspect();
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const next = cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1);
  cam.zoom = Math.max(0.35, Math.min(3.2, next));
}, { passive: false });

window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function onClick(): void {
  if (!snap || !hover || !inWorld(hover.x, hover.y)) return;
  if (tool === "select") {
    const hit = snap.workers.find(
      (w) => w.ownerId === snap!.you.id && Math.hypot(w.x - hover!.x - 0.5, w.y - hover!.y - 0.5) < 0.9,
    );
    if (hit) {
      if (!keys.has("shift")) selected.clear();
      if (selected.has(hit.id)) selected.delete(hit.id);
      else selected.add(hit.id);
      return;
    }
    if (selected.size) {
      send({ t: "setJob", workerIds: [...selected], job: { type: "move", x: hover.x, y: hover.y } });
      return;
    }
  }
  if (tool === "buy") {
    send({ t: "buyPlot", plotId: plotIdAt(hover.x, hover.y) });
  }
  if (tool === "hire") send({ t: "hireWorker" });
  if (tool === "mine") {
    const ids = selected.size
      ? [...selected]
      : snap.workers.filter((w) => w.ownerId === snap!.you.id).map((w) => w.id);
    send({ t: "setJob", workerIds: ids, job: { type: "mine", x: hover.x, y: hover.y } });
  }
  if (tool === "build") {
    if (!selectedBlueprint) {
      showToast("Open Blueprints and pick a print first.");
      toggleSheet("blueprints");
      return;
    }
    send({ t: "placeBuilding", blueprintId: selectedBlueprint, x: hover.x, y: hover.y });
  }
}

function focusHome(): void {
  if (!snap) return;
  const mine = snap.plots.find((p) => p.ownerId === snap!.you.id);
  if (!mine) return;
  cam.x = (mine.gx + 0.5) * PLOT_TILES * TILE_PX;
  cam.y = (mine.gy + 0.5) * PLOT_TILES * TILE_PX;
}

function setHint(): void {
  const hints: Record<Tool, string> = {
    select: "Click a worker. Shift-click to add. Click ground to walk.",
    buy: "Click an unclaimed plot to buy it with Marks.",
    hire: `Click anywhere to hire a worker for ${HIRE_COST} Marks. You need land first.`,
    mine: "Click timber, stone, ore, clay, or sand on your land.",
    build: "Click your land to place the selected blueprint.",
  };
  hint.textContent = hints[tool];
}

function renderHud(): void {
  if (!snap) return;
  marksEl.textContent = `${snap.you.marks} M`;
  tickEl.textContent = `tick ${snap.tick}`;
  invEl.innerHTML = MATERIALS.map((m) => `<span>${materialLabel(m)} ${snap!.you.inventory[m]}</span>`).join("");
  renderDepot();
  renderBpList();
  renderInspect();
  setHint();
}

function renderInspect(): void {
  if (!snap) return;
  const plot = hover && inWorld(hover.x, hover.y) ? snap.plots[plotIdAt(hover.x, hover.y)] : null;
  const tile = hover && inWorld(hover.x, hover.y) ? snap.terrain[hover.y * WORLD_TILES + hover.x] : null;
  const names = ["grass", "water", "stone", "timber", "ore", "sand", "clay"];
  inspect.innerHTML = `
    <h3>${snap.you.name}</h3>
    <p class="muted">${snap.you.blueprints.length} prints · ${snap.workers.filter((w) => w.ownerId === snap!.you.id).length} crew</p>
    ${plot ? `<p>Plot ${plot.gx},${plot.gy}<br>Owner: ${plot.ownerName ?? "unclaimed"}<br>Price: ${plot.price} M<br>Timber ${plot.timber} · Stone ${plot.stone} · Ore ${plot.ore}</p>` : "<p>Pan with right-drag. Wheel to zoom.</p>"}
    ${tile != null && hover ? `<p class="muted">Tile ${hover.x},${hover.y} · ${names[tile] ?? tile}</p>` : ""}
    <p class="muted">Players online: ${snap.players.map((p) => p.name).join(", ") || "you"}</p>
  `;
}

function renderDepot(): void {
  if (!snap) return;
  const root = document.querySelector("#depot-rows")!;
  root.innerHTML = MATERIALS.map((m) => {
    const d = snap!.depot;
    return `<div class="depot-row">
      <strong>${materialLabel(m)}</strong>
      <span>stock ${d.stock[m]}</span>
      <span>buy ${d.buy[m]} M</span>
      <span>sell ${d.sell[m]} M</span>
      <span>
        <button data-buy="${m}">Buy 1</button>
        <button data-sell="${m}">Sell 1</button>
      </span>
    </div>`;
  }).join("");
  root.querySelectorAll("[data-buy]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "depotBuy", item: (b as HTMLElement).dataset.buy as typeof MATERIALS[number], qty: 1 }));
  });
  root.querySelectorAll("[data-sell]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "depotSell", item: (b as HTMLElement).dataset.sell as typeof MATERIALS[number], qty: 1 }));
  });
}

function renderDesigner(): void {
  const pal = document.querySelector("#palette")!;
  pal.innerHTML = PALETTE.map(
    (p) => `<button data-kind="${p.kind}" class="${paint === p.kind ? "on" : ""}"><span class="swatch" style="background:${STRUCT_HEX[p.kind]}"></span>${p.label}</button>`,
  ).join("");
  pal.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      paint = Number((b as HTMLElement).dataset.kind) as StructureKind;
      renderDesigner();
    });
  });
  const grid = document.querySelector("#grid")!;
  grid.innerHTML = design
    .map((k, i) => `<div class="cell" data-i="${i}" style="background:${k ? STRUCT_HEX[k] : "#0e0d0b"}"></div>`)
    .join("");
  grid.querySelectorAll(".cell").forEach((c) => {
    const paintCell = (ev: Event) => {
      ev.preventDefault();
      const i = Number((c as HTMLElement).dataset.i);
      design[i] = (ev as MouseEvent).buttons === 2 ? STRUCTURE.empty : paint;
      (c as HTMLElement).style.background = design[i] ? STRUCT_HEX[design[i]] : "#0e0d0b";
      const bom = billOfMaterials(design);
      document.querySelector("#bom")!.textContent =
        "Bill of materials: " + MATERIALS.map((m) => `${materialLabel(m)} ${bom[m]}`).join(" · ");
    };
    c.addEventListener("mousedown", paintCell);
    c.addEventListener("mouseenter", (ev) => {
      if ((ev as MouseEvent).buttons) paintCell(ev);
    });
  });
  const bom = billOfMaterials(design);
  document.querySelector("#bom")!.textContent =
    "Bill of materials: " + MATERIALS.map((m) => `${materialLabel(m)} ${bom[m]}`).join(" · ");
}

function renderBpList(): void {
  if (!snap) return;
  const list = document.querySelector("#bp-list")!;
  list.innerHTML = snap.you.blueprints
    .map((bp) => {
      const bom = billOfMaterials(bp.tiles);
      const cost = MATERIALS.filter((m) => bom[m]).map((m) => `${bom[m]} ${m}`).join(", ");
      const on = selectedBlueprint === bp.id ? "on" : "";
      return `<div class="bp-item"><div><strong>${bp.name}</strong><div class="muted">${cost || "empty"}</div></div>
        <button class="${on}" data-pick="${bp.id}">Use to place</button></div>`;
    })
    .join("");
  list.querySelectorAll("[data-pick]").forEach((b) => {
    b.addEventListener("click", () => {
      selectedBlueprint = (b as HTMLElement).dataset.pick!;
      tool = "build";
      for (const tb of document.querySelectorAll<HTMLButtonElement>("#tools [data-tool]")) {
        tb.classList.toggle("on", tb.dataset.tool === "build");
      }
      document.querySelector("#blueprints")?.setAttribute("hidden", "");
      setHint();
      renderBpList();
    });
  });
}

function toggleSheet(id: string): void {
  const el = document.querySelector(`#${id}`)!;
  if (el.hasAttribute("hidden")) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.removeAttribute("hidden");
  window.setTimeout(() => toast.setAttribute("hidden", ""), 2800);
}

function ghost() {
  if (!snap || tool !== "build" || !hover || !selectedBlueprint) return null;
  const bp = snap.you.blueprints.find((b) => b.id === selectedBlueprint);
  if (!bp) return null;
  return { x: hover.x, y: hover.y, w: bp.w, h: bp.h };
}

function loop(): void {
  const speed = 6 / (cam.zoom || 1);
  if (keys.has("w") || keys.has("arrowup")) cam.y -= speed;
  if (keys.has("s") || keys.has("arrowdown")) cam.y += speed;
  if (keys.has("a") || keys.has("arrowleft")) cam.x -= speed;
  if (keys.has("d") || keys.has("arrowright")) cam.x += speed;
  if (snap) {
    drawWorld(ctx, snap, cam, hover, selected, ghost(), snap.you.id);
  }
  requestAnimationFrame(loop);
}

const ctx = canvas.getContext("2d")!;
setHint();
renderDesigner();
loop();
