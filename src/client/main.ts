import { DESIGNER_SIZE, HIRE_COST, MATERIALS, PALETTE, PLOT_TILES, STRUCTURE, TILE_PX, WORLD_TILES, type MachineKind } from "../shared/constants";
import { goodLabel } from "../shared/chemistry";
import { billOfMaterials, materialLabel } from "../shared/economy";
import { inWorld, plotIdAt } from "../shared/geo";
import type { ClientMsg } from "../shared/protocol";
import type { GateKind } from "../shared/compute";
import type { StructureKind, WorldSnapshot } from "../shared/types";
import { connect } from "./net";
import { drawWorld, makeCamera, screenToTile, STRUCT_HEX, type Camera } from "./render";

type Tool = "select" | "buy" | "hire" | "mine" | "build" | "pave" | "work" | "route" | "wire";

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
let selectedTruck: string | null = null;
let draftPath: { x: number; y: number }[] = [];
let draftRoute: { x: number; y: number; action: "skip" | "load" | "unload"; item: string }[] = [];
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
  const machine = (document.querySelector("#bp-machine") as HTMLSelectElement).value as MachineKind;
  send({ t: "saveBlueprint", name, w: DESIGNER_SIZE, h: DESIGNER_SIZE, tiles: design, machine });
});
document.querySelector("#bp-clear")!.addEventListener("click", () => {
  design = new Array(DESIGNER_SIZE * DESIGNER_SIZE).fill(STRUCTURE.empty);
  renderDesigner();
});
document.querySelector("#m-sell")?.addEventListener("click", () => {
  send({
    t: "marketSell",
    item: (document.querySelector("#m-item") as HTMLInputElement).value.trim(),
    qty: Number((document.querySelector("#m-qty") as HTMLInputElement).value),
    price: Number((document.querySelector("#m-price") as HTMLInputElement).value),
  });
});
document.querySelector("#lab-go")?.addEventListener("click", () => {
  const process = (document.querySelector("#lab-process") as HTMLSelectElement).value as "heat" | "crush" | "mix";
  const a = (document.querySelector("#lab-a") as HTMLInputElement).value.trim();
  const an = Number((document.querySelector("#lab-an") as HTMLInputElement).value);
  const b = (document.querySelector("#lab-b") as HTMLInputElement).value.trim();
  const bn = Number((document.querySelector("#lab-bn") as HTMLInputElement).value);
  const inputs: Record<string, number> = {};
  if (a) inputs[a] = an;
  if (b && bn > 0) inputs[b] = bn;
  send({ t: "craft", process, inputs, name: (document.querySelector("#lab-name") as HTMLInputElement).value });
});
document.querySelector("#mail-send")?.addEventListener("click", () => {
  send({
    t: "mailSend",
    toName: (document.querySelector("#mail-to") as HTMLInputElement).value,
    body: (document.querySelector("#mail-body") as HTMLInputElement).value,
  });
});
document.querySelector("#loan-send")?.addEventListener("click", () => {
  send({
    t: "mailLoan",
    toName: (document.querySelector("#loan-to") as HTMLInputElement).value,
    amount: Number((document.querySelector("#loan-amt") as HTMLInputElement).value),
    rate: Number((document.querySelector("#loan-rate") as HTMLInputElement).value),
    plotId: null,
  });
});
document.querySelector("#llc-found")?.addEventListener("click", () => {
  send({ t: "foundLlc", name: (document.querySelector("#llc-name") as HTMLInputElement).value });
});
document.querySelector("#gov-submit")?.addEventListener("click", () => {
  if (draftPath.length < 2) {
    showToast("Pave-click a path across other plots first.");
    return;
  }
  send({ t: "propose", kind: "road", tiles: draftPath, splits: [] });
  draftPath = [];
});
document.querySelector("#buy-truck")?.addEventListener("click", () => send({ t: "buyTruck" }));
document.querySelector("#wire-go")?.addEventListener("click", () => {
  send({
    t: "wireGates",
    fromId: (document.querySelector("#wire-from") as HTMLInputElement).value.trim(),
    toId: (document.querySelector("#wire-to") as HTMLInputElement).value.trim(),
    slot: (document.querySelector("#wire-slot") as HTMLSelectElement).value as "a" | "b",
  });
});
document.querySelector("#script-save")?.addEventListener("click", () => {
  send({ t: "saveScript", text: (document.querySelector("#script-text") as HTMLTextAreaElement).value });
});
document.querySelector("#wrap-link")?.addEventListener("click", () => {
  send({ t: "linkWallet", address: (document.querySelector("#wrap-addr") as HTMLInputElement).value });
});
document.querySelector("#wrap-go")?.addEventListener("click", () => {
  send({ t: "wrapMarks", amount: Number((document.querySelector("#wrap-amt") as HTMLInputElement).value) });
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
  if (tool === "pave") {
    const plot = snap.plots[plotIdAt(hover.x, hover.y)];
    const mine = plot.ownerId === snap.you.id || snap.you.llcs.some((l) => l.id === plot.ownerId);
    if (mine) send({ t: "pave", x: hover.x, y: hover.y });
    else {
      draftPath.push({ x: hover.x, y: hover.y });
      showToast(`Path ${draftPath.length} tiles. Submit in Government.`);
    }
  }
  if (tool === "work") {
    const b = snap.buildings.find(
      (x) => hover!.x >= x.x && hover!.x < x.x + x.w && hover!.y >= x.y && hover!.y < x.y + x.h && x.machine !== "none",
    );
    if (!b) {
      showToast("Click a smelter or lab.");
      return;
    }
    const ids = selected.size
      ? [...selected]
      : snap.workers.filter((w) => w.ownerId === snap!.you.id).map((w) => w.id);
    send({ t: "setJob", workerIds: ids, job: { type: "work", buildingId: b.id } });
  }
  if (tool === "route") {
    draftRoute.push({ x: hover.x, y: hover.y, action: "load", item: "ore" });
    showToast(`Stop ${draftRoute.length}. Save on Trucks.`);
  }
  if (tool === "wire") {
    const kind = (document.querySelector("#gate-kind") as HTMLSelectElement | null)?.value as GateKind | undefined;
    const param = (document.querySelector("#gate-param") as HTMLInputElement | null)?.value ?? "";
    send({ t: "placeGate", x: hover.x, y: hover.y, kind: kind ?? "and", param });
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
    pave: "Click your land to pave (1 stone). Click neighbors to draft a Government road.",
    work: "Click a smelter or lab to put your crew on that recipe.",
    route: "Click map stops for the selected truck, then save in Trucks.",
    wire: "Click your land to place the selected gate. Connect ids in Compute.",
  };
  hint.textContent = hints[tool];
}

function renderHud(): void {
  if (!snap) return;
  const you = snap.you;
  marksEl.textContent = `${you.marks} M${you.debt ? ` · debt ${you.debt}` : ""}`;
  tickEl.textContent = `tick ${snap.tick}`;
  const goods = new Set([...MATERIALS, ...Object.keys(you.inventory).filter((k) => (you.inventory[k] ?? 0) > 0)]);
  invEl.innerHTML = [...goods].map((m) => `<span>${goodLabel(m)} ${you.inventory[m] ?? 0}</span>`).join("");
  renderDepot();
  renderBpList();
  renderMarket();
  renderLab();
  renderMail();
  renderFirm();
  renderBank();
  renderGov();
  renderTrucks();
  renderCompute();
  renderWrap();
  renderInspect();
  setHint();
}

function renderInspect(): void {
  if (!snap) return;
  const youId = snap.you.id;
  const plot = hover && inWorld(hover.x, hover.y) ? snap.plots[plotIdAt(hover.x, hover.y)] : null;
  const tile = hover && inWorld(hover.x, hover.y) ? snap.terrain[hover.y * WORLD_TILES + hover.x] : null;
  const names = ["grass", "water", "stone", "timber", "ore", "sand", "clay"];
  inspect.innerHTML = `
    <h3>${snap.you.name}</h3>
    <p class="muted">${snap.you.blueprints.length} prints · ${snap.workers.filter((w) => w.ownerId === snap!.you.id).length} crew</p>
    ${plot ? `<p>Plot ${plot.gx},${plot.gy}<br>Owner: ${plot.ownerName ?? "unclaimed"}<br>Price: ${plot.price} M<br>Timber ${plot.timber} · Stone ${plot.stone} · Ore ${plot.ore}<br>Pollution ${plot.pollution ?? 0}</p>` : "<p>Pan with right-drag. Wheel to zoom.</p>"}
    <p class="muted">Unread mail: ${snap.you.mail.filter((m) => !m.read).length} · trucks ${snap.vehicles.filter((v) => v.ownerId === youId).length}</p>
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
      return `<div class="bp-item"><div><strong>${bp.name}</strong> ${bp.machine !== "none" ? `(${bp.machine})` : ""} ${bp.patented ? "· locked" : ""}<div class="muted">${cost || "empty"}</div></div>
        <button class="${on}" data-pick="${bp.id}">Use to place</button>
        <button data-patent="${bp.id}">Patent 40M</button></div>`;
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
  list.querySelectorAll("[data-patent]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "patent", blueprintId: (b as HTMLElement).dataset.patent! }));
  });
}

function renderMarket(): void {
  if (!snap) return;
  const root = document.querySelector("#market-rows");
  if (!root) return;
  root.innerHTML = snap.market.length
    ? snap.market.map((o) => `<div class="depot-row"><strong>${goodLabel(o.item)} ×${o.qty}</strong><span>${o.price} M each</span><span>${o.sellerName}</span><span></span><button data-mbuy="${o.id}">Buy</button></div>`).join("")
    : `<p class="muted">No player orders yet.</p>`;
  root.querySelectorAll("[data-mbuy]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "marketBuy", orderId: (b as HTMLElement).dataset.mbuy! }));
  });
}

function renderLab(): void {
  if (!snap) return;
  const rec = document.querySelector("#lab-recipes");
  const reg = document.querySelector("#lab-reg");
  if (!rec || !reg) return;
  rec.innerHTML = snap.recipes.map((r) => {
    const inn = Object.entries(r.in).map(([k, v]) => `${v} ${k}`).join(" + ");
    const out = Object.entries(r.out).map(([k, v]) => `${v} ${k}`).join(" + ");
    return `<div class="bp-item"><div><strong>${r.name}</strong><div class="muted">${r.process}: ${inn} → ${out}</div></div>
      <button data-recipe="${r.id}">Assign to selected smelter</button></div>`;
  }).join("");
  rec.querySelectorAll("[data-recipe]").forEach((b) => {
    b.addEventListener("click", () => {
      const building = snap!.buildings.find((x) => x.ownerId === snap!.you.id && x.machine !== "none" && x.complete);
      if (!building) {
        showToast("Place a smelter or lab first.");
        return;
      }
      send({ t: "setRecipe", buildingId: building.id, recipeId: (b as HTMLElement).dataset.recipe! });
    });
  });
  reg.innerHTML = snap.registry.length
    ? snap.registry.map((r) => `<p><strong>${r.name}</strong> · ${r.formula} · by ${r.discoveredBy} · hard ${r.hardness} cond ${r.conductivity} melt ${r.melt}</p>`).join("")
    : `<p class="muted">No invented materials yet. Mix something the recipes do not cover.</p>`;
}

function renderMail(): void {
  if (!snap) return;
  const root = document.querySelector("#mail-list");
  if (!root) return;
  root.innerHTML = snap.you.mail.slice().reverse().map((m) => `
    <div class="bp-item"><div><strong>${m.fromName}</strong> · ${m.kind}<div class="muted">${m.body}</div></div>
    ${m.kind !== "note" ? `<button data-accept="${m.id}">Accept</button>` : ""}</div>`).join("") || `<p class="muted">Inbox empty.</p>`;
  root.querySelectorAll("[data-accept]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "mailAccept", mailId: (b as HTMLElement).dataset.accept! }));
  });
}

function renderFirm(): void {
  if (!snap) return;
  const root = document.querySelector("#llc-list");
  if (!root) return;
  root.innerHTML = snap.you.llcs.map((l) => {
    const people = l.members.map((m) => `${m.name} ${m.shares}%`).join(", ");
    return `<div class="bp-item"><div><strong>${l.name}</strong><div class="muted">${people}</div></div>
      <input data-inv="${l.id}" placeholder="invite name" />
      <button data-invite="${l.id}">Invite 20%</button>
      <button data-xfer="${l.id}">Move my first plot in</button>
      ${l.isBank ? `<span class="muted">BANK ${l.depositRate}%</span>` : `<button data-bank="${l.id}">Open as bank 4%</button>`}
      ${l.isBank ? `<button data-dep="${l.id}">Deposit 40M</button>` : ""}</div>`;
  }).join("") || `<p class="muted">No company yet. File one to hold land with friends.</p>`;
  root.querySelectorAll("[data-invite]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = (b as HTMLElement).dataset.invite!;
      const name = (root.querySelector(`[data-inv="${id}"]`) as HTMLInputElement)?.value ?? "";
      send({ t: "llcInvite", llcId: id, toName: name, shares: 20 });
    });
  });
  root.querySelectorAll("[data-xfer]").forEach((b) => {
    b.addEventListener("click", () => {
      const plot = snap!.plots.find((p) => p.ownerId === snap!.you.id);
      if (!plot) {
        showToast("No personal plot to move.");
        return;
      }
      send({ t: "transferPlot", plotId: plot.id, llcId: (b as HTMLElement).dataset.xfer! });
    });
  });
  root.querySelectorAll("[data-bank]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "openBank", llcId: (b as HTMLElement).dataset.bank!, rate: 4 }));
  });
  root.querySelectorAll("[data-dep]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "deposit", llcId: (b as HTMLElement).dataset.dep!, amount: 40 }));
  });
}

function renderBank(): void {
  if (!snap) return;
  const root = document.querySelector("#bank-book");
  if (!root) return;
  const made = snap.you.loansMade.map((l) => `You lent: ${l.remaining} M left @ ${l.rate}% to borrower`).join("<br>");
  const taken = snap.you.loansTaken.map((l) => `You owe ${l.lenderName}: ${l.remaining} M @ ${l.rate}%`).join("<br>");
  const pat = snap.you.patents.map((p) => `${p.name} [${p.id}] until tick ${p.until}`).join("<br>");
  const lic = snap.you.licenses.map((l) => `${l.revoked ? "REVOKED" : "active"} license ${l.id.slice(0, 6)} ${l.killSwitch ? "(kill switch)" : ""} <button data-rev="${l.id}">Revoke</button>`).join("<br>");
  const deps = snap.you.deposits.map((d) => `${d.amount} M at ${d.bankName} (${d.rate}%) <button data-wd="${d.id}">Withdraw</button>`).join("<br>");
  root.innerHTML = `<p>Cash ${snap.you.marks} M · Debt ${snap.you.debt}</p>
    <p>${deps || "No deposits."}</p>
    <p>${made || "No loans issued."}</p>
    <p>${taken || "No loans taken."}</p>
    <p>${pat || "No patents."}</p>
    <p>${lic || "No licenses."}</p>
    <div class="row"><input id="lic-to" placeholder="license to player" /><input id="lic-pat" placeholder="patent id" /><label><input type="checkbox" id="lic-kill" /> kill switch</label><button id="lic-offer">Offer license</button></div>`;
  root.querySelectorAll("[data-rev]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "licenseRevoke", licenseId: (b as HTMLElement).dataset.rev! }));
  });
  root.querySelectorAll("[data-wd]").forEach((b) => {
    b.addEventListener("click", () => send({ t: "withdraw", depositId: (b as HTMLElement).dataset.wd! }));
  });
  document.querySelector("#lic-offer")?.addEventListener("click", () => {
    send({
      t: "licenseOffer",
      patentId: (document.querySelector("#lic-pat") as HTMLInputElement).value,
      toName: (document.querySelector("#lic-to") as HTMLInputElement).value,
      killSwitch: (document.querySelector("#lic-kill") as HTMLInputElement).checked,
    });
  });
}

function renderGov(): void {
  if (!snap) return;
  const root = document.querySelector("#gov-list");
  if (!root) return;
  root.innerHTML = `<p class="muted">Draft path: ${draftPath.length} tiles</p>` + snap.proposals.map((p) => `
    <div class="bp-item"><div><strong>${p.kind}</strong> by ${p.authorName} · ${p.status}
      <div class="muted">${p.tiles.length} tiles · ${p.marksCost} M · ${p.stoneCost} stone · pledged ${Object.values(p.pledges).reduce((a, b) => a + b, 0)}</div>
      <div class="muted">${p.thread.map((t) => `${t.name}: ${t.text}`).join(" · ")}</div></div>
      <button data-yes="${p.id}">Yes</button>
      <button data-no="${p.id}">No</button>
      <button data-pledge="${p.id}">Pledge 10M</button>
    </div>`).join("");
  root.querySelectorAll("[data-yes]").forEach((b) => b.addEventListener("click", () => send({ t: "vote", proposalId: (b as HTMLElement).dataset.yes!, vote: "yes" })));
  root.querySelectorAll("[data-no]").forEach((b) => b.addEventListener("click", () => send({ t: "vote", proposalId: (b as HTMLElement).dataset.no!, vote: "no" })));
  root.querySelectorAll("[data-pledge]").forEach((b) => b.addEventListener("click", () => send({ t: "pledge", proposalId: (b as HTMLElement).dataset.pledge!, marks: 10 })));
}

function renderCompute(): void {
  if (!snap) return;
  const box = document.querySelector("#script-text") as HTMLTextAreaElement | null;
  if (box && document.activeElement !== box) box.value = snap.you.script ?? "";
  const root = document.querySelector("#compute-list");
  if (!root) return;
  const gates = (snap.circuits ?? []).filter((c) => c.ownerId === snap!.you.id);
  const list = gates.map((g) => `<p>${g.kind} [${g.id}] @${g.x},${g.y} ${g.on ? "ON" : "off"} · ${g.param} · A=${g.inA ?? "-"} B=${g.inB ?? "-"}</p>`).join("");
  root.innerHTML = `<p class="muted">Last script: ${(snap.you.scriptLog ?? []).join(" · ") || "idle"}</p>` +
    (list || `<p class="muted">No gates yet. Wire tool places them on your land.</p>`);
}

function renderWrap(): void {
  if (!snap) return;
  const root = document.querySelector("#wrap-list");
  if (!root) return;
  const addr = document.querySelector("#wrap-addr") as HTMLInputElement | null;
  if (addr && document.activeElement !== addr && snap.you.wallet) addr.value = snap.you.wallet;
  root.innerHTML = `<p>Linked: ${snap.you.wallet || "none"}</p>` +
    (snap.you.wraps ?? []).map((w) => `<p>tick ${w.tick}: wrapped ${w.amount} M → ${w.address}</p>`).join("");
}

function renderTrucks(): void {
  if (!snap) return;
  const root = document.querySelector("#truck-list");
  if (!root) return;
  const mine = snap.vehicles.filter((v) => v.ownerId === snap!.you.id);
  root.innerHTML = mine.map((v) => `<div class="bp-item"><div><strong>Truck ${v.id.slice(0, 6)}</strong>
    <div class="muted">stops ${v.route.length} · cargo ${JSON.stringify(v.cargo)}</div></div>
    <button class="${selectedTruck === v.id ? "on" : ""}" data-truck="${v.id}">Select</button>
    <button data-save-route="${v.id}">Save draft route (${draftRoute.length})</button></div>`).join("")
    || `<p class="muted">No trucks. Buy one when you have timber and ore.</p>`;
  root.querySelectorAll("[data-truck]").forEach((b) => {
    b.addEventListener("click", () => {
      selectedTruck = (b as HTMLElement).dataset.truck!;
      renderTrucks();
    });
  });
  root.querySelectorAll("[data-save-route]").forEach((b) => {
    b.addEventListener("click", () => {
      send({ t: "setRoute", vehicleId: (b as HTMLElement).dataset.saveRoute!, route: draftRoute });
      draftRoute = [];
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
