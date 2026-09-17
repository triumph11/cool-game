import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILD_WORK_PER_TILE,
  DEPOT_CAP,
  DESIGNER_SIZE,
  HIRE_COST,
  MAX_WORKERS,
  MINE_TICKS,
  PLOT_COUNT,
  PLOT_TILES,
  RESTOCK_EVERY_TICKS,
  SAVE_EVERY_TICKS,
  START_MARKS,
  STRUCTURE,
  TERRAIN,
  WORKER_SPEED,
  WORLD_TILES,
  type Material,
  type StructureKind,
} from "../shared/constants";
import {
  addMaterials,
  billOfMaterials,
  depotPrices,
  emptyInventory,
  hasMaterials,
  subtractMaterials,
  terrainToMaterial,
} from "../shared/economy";
import { hash2, inWorld, plotIdAt, plotOrigin, tileIndex } from "../shared/geo";
import type {
  Blueprint,
  Building,
  DepotState,
  Inventory,
  Job,
  Plot,
  PublicPlayer,
  Worker,
  WorldSnapshot,
  You,
} from "../shared/types";
import { checkPassword, hashPassword, newId } from "./auth";
import { nextStep, walkable } from "./path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataFile = join(root, "data", "world.json");

interface Account {
  id: string;
  name: string;
  pass: string;
  marks: number;
  inventory: Inventory;
  blueprints: Blueprint[];
}

interface Persist {
  seed: number;
  tick: number;
  terrain: number[];
  plots: Plot[];
  workers: Worker[];
  buildings: Building[];
  depotStock: Inventory;
  accounts: Account[];
  mineProgress: Record<string, number>;
}

function generateTerrain(seed: number): number[] {
  const t = new Array<number>(WORLD_TILES * WORLD_TILES);
  for (let y = 0; y < WORLD_TILES; y++) {
    for (let x = 0; x < WORLD_TILES; x++) {
      const n = hash2(x, y, seed);
      const n2 = hash2(x, y, seed + 91);
      const n3 = hash2(x, y, seed + 17);
      const river = Math.abs(Math.sin(x * 0.07 + y * 0.02) + Math.sin(y * 0.09) * 0.35);
      let tile: number = TERRAIN.grass;
      if (river < 0.18) tile = TERRAIN.water;
      else if (n > 0.86) tile = TERRAIN.stone;
      else if (n2 > 0.9) tile = TERRAIN.sand;
      else if (n3 > 0.92) tile = TERRAIN.clay;
      else if (n > 0.72 && n2 > 0.45) tile = TERRAIN.tree;
      if (tile !== TERRAIN.water && hash2(x, y, seed + 3) > 0.965) tile = TERRAIN.ore;
      t[tileIndex(x, y)] = tile;
    }
  }
  return t;
}

function makePlots(terrain: number[]): Plot[] {
  const plots: Plot[] = [];
  for (let gy = 0; gy < PLOT_COUNT; gy++) {
    for (let gx = 0; gx < PLOT_COUNT; gx++) {
      let timber = 0;
      let stone = 0;
      let ore = 0;
      for (let y = 0; y < PLOT_TILES; y++) {
        for (let x = 0; x < PLOT_TILES; x++) {
          const tile = terrain[tileIndex(gx * PLOT_TILES + x, gy * PLOT_TILES + y)];
          if (tile === TERRAIN.tree) timber++;
          if (tile === TERRAIN.stone) stone++;
          if (tile === TERRAIN.ore) ore++;
        }
      }
      const price = 70 + timber * 2 + stone * 2 + ore * 10;
      plots.push({
        id: gy * PLOT_COUNT + gx,
        gx,
        gy,
        ownerId: null,
        ownerName: null,
        price,
        timber,
        stone,
        ore,
      });
    }
  }
  return plots;
}

function starterDepot(): Inventory {
  return { timber: 48, stone: 36, ore: 18, clay: 30, sand: 30 };
}

export class World {
  seed = 11011;
  tick = 0;
  terrain: number[] = [];
  plots: Plot[] = [];
  workers: Worker[] = [];
  buildings: Building[] = [];
  depotStock: Inventory = starterDepot();
  accounts = new Map<string, Account>();
  byName = new Map<string, Account>();
  mineProgress = new Map<string, number>();

  constructor() {
    this.loadOrCreate();
  }

  private loadOrCreate(): void {
    if (existsSync(dataFile)) {
      const raw = JSON.parse(readFileSync(dataFile, "utf8")) as Persist;
      this.seed = raw.seed;
      this.tick = raw.tick;
      this.terrain = raw.terrain;
      this.plots = raw.plots;
      this.workers = raw.workers;
      this.buildings = raw.buildings;
      this.depotStock = raw.depotStock;
      this.mineProgress = new Map(Object.entries(raw.mineProgress ?? {}));
      for (const a of raw.accounts) {
        this.accounts.set(a.id, a);
        this.byName.set(a.name.toLowerCase(), a);
      }
      return;
    }
    this.terrain = generateTerrain(this.seed);
    this.plots = makePlots(this.terrain);
    this.save();
  }

  save(): void {
    mkdirSync(dirname(dataFile), { recursive: true });
    const persist: Persist = {
      seed: this.seed,
      tick: this.tick,
      terrain: this.terrain,
      plots: this.plots,
      workers: this.workers,
      buildings: this.buildings,
      depotStock: this.depotStock,
      accounts: [...this.accounts.values()],
      mineProgress: Object.fromEntries(this.mineProgress),
    };
    writeFileSync(dataFile, JSON.stringify(persist));
  }

  register(name: string, password: string): Account {
    const clean = name.trim().slice(0, 20);
    if (clean.length < 3) throw new Error("Name must be at least 3 characters.");
    if (password.length < 4) throw new Error("Password must be at least 4 characters.");
    if (this.byName.has(clean.toLowerCase())) throw new Error("That name is taken.");
    const account: Account = {
      id: newId(),
      name: clean,
      pass: hashPassword(password),
      marks: START_MARKS,
      inventory: emptyInventory(),
      blueprints: [starterShack(clean)],
    };
    this.accounts.set(account.id, account);
    this.byName.set(clean.toLowerCase(), account);
    this.save();
    return account;
  }

  login(name: string, password: string): Account {
    const account = this.byName.get(name.trim().toLowerCase());
    if (!account || !checkPassword(password, account.pass)) {
      throw new Error("Wrong name or password.");
    }
    return account;
  }

  depot(): DepotState {
    const { buy, sell } = depotPrices(this.depotStock);
    return { stock: { ...this.depotStock }, buy, sell };
  }

  snapshot(you: Account): WorldSnapshot {
    return {
      tick: this.tick,
      seed: this.seed,
      terrain: this.terrain,
      plots: this.plots,
      workers: this.workers,
      buildings: this.buildings,
      depot: this.depot(),
      players: this.publicPlayers(),
      you: this.youView(you),
    };
  }

  private youView(you: Account): You {
    return {
      id: you.id,
      name: you.name,
      marks: you.marks,
      inventory: { ...you.inventory },
      blueprints: you.blueprints,
    };
  }

  private publicPlayers(): PublicPlayer[] {
    return [...this.accounts.values()].map((a) => ({
      id: a.id,
      name: a.name,
      marks: a.marks,
      plots: this.plots.filter((p) => p.ownerId === a.id).length,
      workers: this.workers.filter((w) => w.ownerId === a.id).length,
    }));
  }

  ownedPlots(id: string): Plot[] {
    return this.plots.filter((p) => p.ownerId === id);
  }

  buyPlot(you: Account, plotId: number): void {
    const plot = this.plots.find((p) => p.id === plotId);
    if (!plot) throw new Error("No such plot.");
    if (plot.ownerId) throw new Error("That plot is already claimed.");
    if (you.marks < plot.price) throw new Error("Not enough Marks.");
    you.marks -= plot.price;
    plot.ownerId = you.id;
    plot.ownerName = you.name;
  }

  hireWorker(you: Account): void {
    const owned = this.ownedPlots(you.id);
    if (!owned.length) throw new Error("Buy a plot before hiring.");
    const count = this.workers.filter((w) => w.ownerId === you.id).length;
    if (count >= MAX_WORKERS) throw new Error("Crew is full.");
    if (you.marks < HIRE_COST) throw new Error("Not enough Marks.");
    you.marks -= HIRE_COST;
    const origin = plotOrigin(owned[0].id);
    const spawn = this.findSpawn(origin.x, origin.y);
    this.workers.push({
      id: newId(),
      ownerId: you.id,
      x: spawn.x + 0.5,
      y: spawn.y + 0.5,
      job: null,
    });
  }

  setJob(you: Account, workerIds: string[], job: Job | null): void {
    for (const id of workerIds) {
      const w = this.workers.find((x) => x.id === id && x.ownerId === you.id);
      if (!w) continue;
      if (job?.type === "mine" || job?.type === "move") {
        if (!inWorld(job.x, job.y)) throw new Error("Out of the world.");
      }
      if (job?.type === "mine") {
        const plot = this.plots[plotIdAt(job.x, job.y)];
        if (plot.ownerId !== you.id) throw new Error("You can only mine your own land.");
        if (!terrainToMaterial(this.terrain[tileIndex(job.x, job.y)])) {
          throw new Error("Nothing to extract there.");
        }
      }
      w.job = job;
    }
  }

  saveBlueprint(you: Account, name: string, w: number, h: number, tiles: StructureKind[]): void {
    if (w !== DESIGNER_SIZE || h !== DESIGNER_SIZE) throw new Error("Designer is 8x8.");
    if (tiles.length !== w * h) throw new Error("Bad blueprint size.");
    const bom = billOfMaterials(tiles);
    if (MATERIALS_ZERO(bom)) throw new Error("Paint some materials first.");
    you.blueprints.push({
      id: newId(),
      ownerId: you.id,
      name: name.trim().slice(0, 24) || "Untitled",
      w,
      h,
      tiles: [...tiles],
    });
    if (you.blueprints.length > 24) you.blueprints.shift();
  }

  placeBuilding(you: Account, blueprintId: string, x: number, y: number): void {
    const bp = you.blueprints.find((b) => b.id === blueprintId);
    if (!bp) throw new Error("No such blueprint.");
    if (!inWorld(x, y) || !inWorld(x + bp.w - 1, y + bp.h - 1)) {
      throw new Error("Does not fit in the world.");
    }
    for (let iy = 0; iy < bp.h; iy++) {
      for (let ix = 0; ix < bp.w; ix++) {
        const plot = this.plots[plotIdAt(x + ix, y + iy)];
        if (plot.ownerId !== you.id) throw new Error("Building must sit on your land.");
        const tile = this.terrain[tileIndex(x + ix, y + iy)];
        if (tile === TERRAIN.water) throw new Error("Cannot build on water.");
      }
    }
    const cost = billOfMaterials(bp.tiles);
    if (!hasMaterials(you.inventory, cost)) throw new Error("Missing materials. Check the Depot.");
    subtractMaterials(you.inventory, cost);
    const needed = bp.tiles.filter((k) => k !== STRUCTURE.empty).length * BUILD_WORK_PER_TILE;
    const building: Building = {
      id: newId(),
      ownerId: you.id,
      x,
      y,
      w: bp.w,
      h: bp.h,
      tiles: [...bp.tiles],
      needed,
      done: 0,
      complete: needed === 0,
    };
    this.buildings.push(building);
    const idle = this.workers.filter((w) => w.ownerId === you.id && !w.job);
    for (const w of idle) w.job = { type: "build", buildingId: building.id };
  }

  depotBuy(you: Account, item: Material, qty: number): void {
    const n = Math.max(1, Math.min(50, Math.floor(qty)));
    const { buy } = depotPrices(this.depotStock);
    if (this.depotStock[item] < n) throw new Error("Depot is sold out of that.");
    const cost = buy[item] * n;
    if (you.marks < cost) throw new Error("Not enough Marks.");
    you.marks -= cost;
    this.depotStock[item] -= n;
    you.inventory[item] += n;
  }

  depotSell(you: Account, item: Material, qty: number): void {
    const n = Math.max(1, Math.min(50, Math.floor(qty)));
    if (you.inventory[item] < n) throw new Error("You do not have that.");
    const cap = DEPOT_CAP[item];
    const room = cap - this.depotStock[item];
    const take = Math.min(n, Math.max(0, room));
    if (take <= 0) throw new Error("Depot will not take more of that right now.");
    const { sell } = depotPrices(this.depotStock);
    you.inventory[item] -= take;
    this.depotStock[item] += take;
    you.marks += sell[item] * take;
  }

  step(): void {
    this.tick += 1;
    const dt = WORKER_SPEED / 4;
    for (const w of this.workers) this.stepWorker(w, dt);
    if (this.tick % RESTOCK_EVERY_TICKS === 0) this.restock();
    if (this.tick % SAVE_EVERY_TICKS === 0) this.save();
  }

  private restock(): void {
    const items: Material[] = ["timber", "stone", "ore", "clay", "sand"];
    const item = items[this.tick % items.length];
    if (this.depotStock[item] < DEPOT_CAP[item]) this.depotStock[item] += 1;
  }

  private stepWorker(w: Worker, dt: number): void {
    const job = w.job;
    if (!job) return;
    let tx = 0;
    let ty = 0;
    if (job.type === "move" || job.type === "mine") {
      tx = job.x + 0.5;
      ty = job.y + 0.5;
    } else {
      const b = this.buildings.find((x) => x.id === job.buildingId);
      if (!b) {
        w.job = null;
        return;
      }
      tx = b.x + b.w / 2;
      ty = b.y + b.h / 2;
    }
    const dist = Math.hypot(tx - w.x, ty - w.y);
    if (dist > 0.55) {
      const step = nextStep(this.terrain, w.x, w.y, tx, ty);
      if (!step) return;
      const nx = step.x + 0.5;
      const ny = step.y + 0.5;
      const mag = Math.hypot(nx - w.x, ny - w.y) || 1;
      w.x += ((nx - w.x) / mag) * Math.min(dt, mag);
      w.y += ((ny - w.y) / mag) * Math.min(dt, mag);
      return;
    }
    if (job.type === "move") {
      w.job = null;
      return;
    }
    if (job.type === "mine") this.doMine(w, job.x, job.y);
    if (job.type === "build") this.doBuild(w, job.buildingId);
  }

  private doMine(w: Worker, x: number, y: number): void {
    const owner = this.accounts.get(w.ownerId);
    if (!owner) return;
    const key = `${x},${y}`;
    const prog = (this.mineProgress.get(key) ?? 0) + 1;
    if (prog < MINE_TICKS) {
      this.mineProgress.set(key, prog);
      return;
    }
    this.mineProgress.set(key, 0);
    const idx = tileIndex(x, y);
    const mat = terrainToMaterial(this.terrain[idx]);
    if (!mat) {
      w.job = null;
      return;
    }
    owner.inventory[mat] += 1;
    if (mat === "timber" || mat === "ore") {
      this.terrain[idx] = TERRAIN.grass;
      const plot = this.plots[plotIdAt(x, y)];
      if (mat === "timber") plot.timber = Math.max(0, plot.timber - 1);
      if (mat === "ore") plot.ore = Math.max(0, plot.ore - 1);
      w.job = null;
    }
  }

  private doBuild(w: Worker, buildingId: string): void {
    const b = this.buildings.find((x) => x.id === buildingId);
    if (!b || b.complete) {
      w.job = null;
      return;
    }
    b.done += 1;
    if (b.done >= b.needed) {
      b.complete = true;
      b.done = b.needed;
      for (const other of this.workers) {
        if (other.job?.type === "build" && other.job.buildingId === buildingId) other.job = null;
      }
    }
  }

  private findSpawn(ox: number, oy: number): { x: number; y: number } {
    for (let r = 0; r < PLOT_TILES; r++) {
      for (let y = oy; y < oy + PLOT_TILES; y++) {
        for (let x = ox; x < ox + PLOT_TILES; x++) {
          if (Math.abs(x - (ox + 8)) + Math.abs(y - (oy + 8)) !== r) continue;
          if (walkable(this.terrain, x, y)) return { x, y };
        }
      }
    }
    return { x: ox + 1, y: oy + 1 };
  }
}

function MATERIALS_ZERO(inv: Inventory): boolean {
  return Object.values(inv).every((n) => n === 0);
}

function starterShack(name: string): Blueprint {
  const w = DESIGNER_SIZE;
  const h = DESIGNER_SIZE;
  const tiles: StructureKind[] = new Array(w * h).fill(STRUCTURE.empty);
  const put = (x: number, y: number, k: StructureKind) => {
    tiles[y * w + x] = k;
  };
  for (let x = 1; x <= 6; x++) {
    put(x, 1, STRUCTURE.timberWall);
    put(x, 6, STRUCTURE.timberWall);
  }
  for (let y = 1; y <= 6; y++) {
    put(1, y, STRUCTURE.timberWall);
    put(6, y, STRUCTURE.timberWall);
  }
  for (let y = 2; y <= 5; y++) {
    for (let x = 2; x <= 5; x++) put(x, y, STRUCTURE.clayFloor);
  }
  put(3, 6, STRUCTURE.oreDoor);
  put(4, 6, STRUCTURE.oreDoor);
  return {
    id: newId(),
    ownerId: "starter",
    name: `${name}'s shack`,
    w,
    h,
    tiles,
  };
}
