import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILD_WORK_PER_TILE,
  BANKRUPT_DEBT,
  BANK_TICKS,
  DEPOT_CAP,
  ECO_EVERY_TICKS,
  DESIGNER_SIZE,
  HIRE_COST,
  LLC_FEE,
  LOAN_PERIOD_TICKS,
  MAX_WORKERS,
  MINE_TICKS,
  PATENT_FEE,
  PATENT_MAINT_TICKS,
  PLOT_COUNT,
  PLOT_TILES,
  RESTOCK_EVERY_TICKS,
  SAVE_EVERY_TICKS,
  START_MARKS,
  STRUCTURE,
  TAX_EVERY_TICKS,
  TAX_PER_PLOT,
  TERRAIN,
  TRUCK_MARKS,
  TRUCK_ORE,
  TRUCK_TIMBER,
  WORKER_SPEED,
  WORLD_TILES,
  type MachineKind,
  type Material,
  type StructureKind,
} from "../shared/constants";
import {
  KNOWN_RECIPES,
  compact,
  findRecipe,
  goodLabel,
  inventFrom,
  qtyAdd,
  qtyHas,
  qtySub,
  type Process,
  type Qty,
  type RegistryItem,
} from "../shared/chemistry";
import {
  addMaterials,
  billOfMaterials,
  depotPrices,
  emptyInventory,
  hasMaterials,
  subtractMaterials,
  terrainToMaterial,
} from "../shared/economy";
import { evalCircuits, runScript, type CircuitNode, type GateKind } from "../shared/compute";
import { hash2, inWorld, plotIdAt, plotOrigin, tileIndex } from "../shared/geo";
import type {
  Blueprint,
  Building,
  DepotState,
  Inventory,
  Job,
  Deposit,
  License,
  Llc,
  Loan,
  MailItem,
  MarketOrder,
  Patent,
  Plot,
  Proposal,
  PublicPlayer,
  Vehicle,
  Worker,
  WorldSnapshot,
  WrapReceipt,
  You,
} from "../shared/types";
import { chainInfo, mintMarks, verifyBurnTx } from "./chain";
import { checkPassword, hashPassword, newId } from "./auth";
import { nextStep, walkable } from "./path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataFile = join(root, "data", "world.json");

interface Account {
  id: string;
  name: string;
  pass: string;
  marks: number;
  debt: number;
  inventory: Inventory;
  blueprints: Blueprint[];
  script: string;
  scriptLog: string[];
  wallet: string;
  wraps: WrapReceipt[];
  usedUnwraps: string[];
}

interface Persist {
  seed: number;
  tick: number;
  terrain: number[];
  roads: number[];
  plots: Plot[];
  workers: Worker[];
  buildings: Building[];
  vehicles: Vehicle[];
  depotStock: Inventory;
  accounts: Account[];
  mineProgress: Record<string, number>;
  registry: RegistryItem[];
  market: MarketOrder[];
  mails: MailItem[];
  llcs: Llc[];
  loans: Loan[];
  patents: Patent[];
  licenses: License[];
  proposals: Proposal[];
  circuits: CircuitNode[];
  deposits: Deposit[];
  pipes: number[];
  power: number[];
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
        pollution: 0,
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
  roads: number[] = [];
  vehicles: Vehicle[] = [];
  registry: RegistryItem[] = [];
  market: MarketOrder[] = [];
  mails: MailItem[] = [];
  llcs: Llc[] = [];
  loans: Loan[] = [];
  patents: Patent[] = [];
  licenses: License[] = [];
  proposals: Proposal[] = [];
  circuits: CircuitNode[] = [];
  deposits: Deposit[] = [];
  pipes: number[] = [];
  power: number[] = [];

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
      this.roads = raw.roads ?? new Array(this.terrain.length).fill(0);
      this.vehicles = raw.vehicles ?? [];
      this.registry = raw.registry ?? [];
      this.market = raw.market ?? [];
      this.mails = raw.mails ?? [];
      this.llcs = raw.llcs ?? [];
      this.loans = raw.loans ?? [];
      this.patents = raw.patents ?? [];
      this.licenses = raw.licenses ?? [];
      this.proposals = raw.proposals ?? [];
      this.circuits = raw.circuits ?? [];
      this.deposits = raw.deposits ?? [];
      this.pipes = raw.pipes ?? new Array(this.terrain.length).fill(0);
      this.power = raw.power ?? new Array(this.terrain.length).fill(0);
      for (const a of raw.accounts) {
        a.debt ??= 0;
        a.script ??= "";
        a.scriptLog ??= [];
        a.wallet ??= "";
        a.wraps ??= [];
        a.usedUnwraps ??= [];
        for (const bp of a.blueprints) {
          bp.machine ??= "none";
          bp.patented ??= false;
        }
        this.accounts.set(a.id, a);
        this.byName.set(a.name.toLowerCase(), a);
      }
      for (const b of this.buildings) {
        b.machine ??= "none";
        b.recipeId ??= null;
        b.work ??= 0;
        b.paused ??= false;
      }
      for (const p of this.plots) p.pollution ??= 0;
      for (const l of this.llcs) {
        l.isBank ??= false;
        l.depositRate ??= 3;
      }
      return;
    }
    this.terrain = generateTerrain(this.seed);
    this.plots = makePlots(this.terrain);
    this.roads = new Array(this.terrain.length).fill(0);
    this.pipes = new Array(this.terrain.length).fill(0);
    this.power = new Array(this.terrain.length).fill(0);
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
      roads: this.roads,
      vehicles: this.vehicles,
      registry: this.registry,
      market: this.market,
      mails: this.mails,
      llcs: this.llcs,
      loans: this.loans,
      patents: this.patents,
      licenses: this.licenses,
      proposals: this.proposals,
      circuits: this.circuits,
      deposits: this.deposits,
      pipes: this.pipes,
      power: this.power,
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
      debt: 0,
      inventory: emptyInventory(),
      blueprints: [starterShack(clean)],
      script: "IF STOCK timber > 8 THEN START smelter\nIF STOCK timber < 2 THEN STOP smelter\nIF POLLUTION > 40 THEN STOP ALL",
      scriptLog: [],
      wallet: "",
      wraps: [],
      usedUnwraps: [],
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
      market: this.market,
      registry: this.registry,
      recipes: KNOWN_RECIPES.map((r) => ({ id: r.id, name: r.name, process: r.process, in: r.in, out: r.out })),
      proposals: this.proposals,
      vehicles: this.vehicles,
      roads: this.roads,
      circuits: this.circuits,
      pipes: this.pipes,
      power: this.power,
      banks: this.llcs.filter((l) => l.isBank),
      players: this.publicPlayers(),
      you: this.youView(you),
    };
  }

  private youView(you: Account): You {
    return {
      id: you.id,
      name: you.name,
      marks: you.marks,
      debt: you.debt,
      inventory: { ...you.inventory },
      blueprints: you.blueprints,
      mail: this.mails.filter((m) => m.toId === you.id).slice(-40),
      llcs: this.llcs.filter((l) => l.members.some((m) => m.playerId === you.id)),
      loansMade: this.loans.filter((l) => l.lenderId === you.id),
      loansTaken: this.loans.filter((l) => l.borrowerId === you.id),
      patents: this.patents.filter((p) => p.ownerId === you.id && p.until > this.tick),
      licenses: this.licenses.filter((l) => l.licensorId === you.id || l.licenseeId === you.id),
      deposits: this.deposits.filter((d) => d.ownerId === you.id),
      script: you.script,
      scriptLog: you.scriptLog,
      wallet: you.wallet,
      wraps: you.wraps,
      chain: chainInfo(),
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
    const llcIds = this.llcs.filter((l) => l.members.some((m) => m.playerId === id)).map((l) => l.id);
    return this.plots.filter((p) => p.ownerId === id || (p.ownerId && llcIds.includes(p.ownerId)));
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
        if (!this.controls(you, plot.ownerId)) throw new Error("You can only mine your own land.");
        if (!terrainToMaterial(this.terrain[tileIndex(job.x, job.y)])) {
          throw new Error("Nothing to extract there.");
        }
      }
      if (job?.type === "work") {
        const b = this.buildings.find((x) => x.id === job.buildingId);
        if (!b || !this.controls(you, b.ownerId)) throw new Error("Not your machine.");
        if (!b.complete) throw new Error("Machine is still being built.");
        if (b.machine === "none") throw new Error("That building is not a machine.");
      }
      w.job = job;
    }
  }

  saveBlueprint(you: Account, name: string, w: number, h: number, tiles: StructureKind[], machine: MachineKind = "none"): void {
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
      machine,
      patented: false,
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
        if (!this.controls(you, plot.ownerId)) throw new Error("Building must sit on your land.");
        const tile = this.terrain[tileIndex(x + ix, y + iy)];
        if (tile === TERRAIN.water) throw new Error("Cannot build on water.");
      }
    }
    this.assertPrintAllowed(you, bp);
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
      machine: bp.machine ?? "none",
      recipeId: bp.machine === "smelter" ? "iron" : bp.machine === "lab" ? null : null,
      work: 0,
      paused: false,
    };
    this.buildings.push(building);
    const idle = this.workers.filter((w) => w.ownerId === you.id && !w.job);
    for (const w of idle) w.job = { type: "build", buildingId: building.id };
  }

  depotBuy(you: Account, item: string, qty: number): void {
    if (!(item in DEPOT_CAP)) throw new Error("Depot only stocks starter goods.");
    const n = Math.max(1, Math.min(50, Math.floor(qty)));
    const { buy } = depotPrices(this.depotStock);
    if ((this.depotStock[item] ?? 0) < n) throw new Error("Depot is sold out of that.");
    const cost = buy[item as Material] * n;
    if (you.marks < cost) throw new Error("Not enough Marks.");
    you.marks -= cost;
    this.depotStock[item] -= n;
    you.inventory[item] = (you.inventory[item] ?? 0) + n;
  }

  depotSell(you: Account, item: string, qty: number): void {
    if (!(item in DEPOT_CAP)) throw new Error("Depot only buys starter goods. Use the player market.");
    const n = Math.max(1, Math.min(50, Math.floor(qty)));
    if ((you.inventory[item] ?? 0) < n) throw new Error("You do not have that.");
    const cap = DEPOT_CAP[item as Material];
    const room = cap - this.depotStock[item];
    const take = Math.min(n, Math.max(0, room));
    if (take <= 0) throw new Error("Depot will not take more of that right now.");
    const { sell } = depotPrices(this.depotStock);
    you.inventory[item] -= take;
    this.depotStock[item] += take;
    you.marks += sell[item as Material] * take;
  }

  step(): void {
    this.tick += 1;
    const dt = WORKER_SPEED / 4;
    for (const w of this.workers) this.stepWorker(w, dt);
    for (const v of this.vehicles) this.stepVehicle(v, dt);
    if (this.tick % RESTOCK_EVERY_TICKS === 0) this.restock();
    if (this.tick % TAX_EVERY_TICKS === 0) this.collectTax();
    if (this.tick % 8 === 0) this.tickLoans();
    if (this.tick % BANK_TICKS === 0) this.tickBanks();
    if (this.tick % ECO_EVERY_TICKS === 0) this.stepEco();
    this.stepCompute();
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
    } else if (job.type === "build" || job.type === "work") {
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
    if (job.type === "work") this.doWork(w, job.buildingId);
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

  private doWork(w: Worker, buildingId: string): void {
    const b = this.buildings.find((x) => x.id === buildingId);
    const owner = this.accounts.get(w.ownerId);
    if (!b || !owner || !b.complete || b.machine === "none" || b.paused) return;
    const recipe = KNOWN_RECIPES.find((r) => r.id === b.recipeId);
    if (!recipe) return;
    if (!qtyHas(owner.inventory, recipe.in)) return;
    const plot = this.plots[plotIdAt(b.x, b.y)];
    const slow = (plot.pollution ?? 0) > 40 ? 2 : 1;
    b.work += 1;
    if (b.work < recipe.ticks * slow) return;
    b.work = 0;
    qtySub(owner.inventory, recipe.in);
    qtyAdd(owner.inventory, recipe.out);
    plot.pollution = Math.min(100, (plot.pollution ?? 0) + 4);
    this.bleedPollution(plot);
  }

  private stepVehicle(v: Vehicle, dt: number): void {
    if (!v.route.length) return;
    const stop = v.route[v.stop % v.route.length];
    const speed = this.roads[tileIndex(Math.floor(v.x), Math.floor(v.y))] ? dt * 2.2 : dt * 0.9;
    const tx = stop.x + 0.5;
    const ty = stop.y + 0.5;
    const dist = Math.hypot(tx - v.x, ty - v.y);
    if (dist > 0.6) {
      const mag = dist || 1;
      v.x += ((tx - v.x) / mag) * Math.min(speed, dist);
      v.y += ((ty - v.y) / mag) * Math.min(speed, dist);
      return;
    }
    const owner = this.accounts.get(v.ownerId);
    if (owner && stop.action === "load" && stop.item && (owner.inventory[stop.item] ?? 0) > 0) {
      owner.inventory[stop.item] -= 1;
      v.cargo[stop.item] = (v.cargo[stop.item] ?? 0) + 1;
    }
    if (owner && stop.action === "unload" && stop.item && (v.cargo[stop.item] ?? 0) > 0) {
      v.cargo[stop.item] -= 1;
      owner.inventory[stop.item] = (owner.inventory[stop.item] ?? 0) + 1;
    }
    v.stop = (v.stop + 1) % v.route.length;
  }

  private collectTax(): void {
    for (const a of this.accounts.values()) {
      const n = this.plots.filter((p) => p.ownerId === a.id).length;
      const bill = n * TAX_PER_PLOT;
      if (bill <= 0) continue;
      if (a.marks >= bill) a.marks -= bill;
      else {
        a.debt += bill - a.marks;
        a.marks = 0;
      }
      if (a.debt >= BANKRUPT_DEBT) this.bankrupt(a);
    }
  }

  private tickLoans(): void {
    for (const loan of this.loans) {
      if (loan.remaining <= 0 || this.tick < loan.nextDue) continue;
      const b = this.accounts.get(loan.borrowerId);
      const l = this.accounts.get(loan.lenderId);
      if (!b || !l) continue;
      const interest = Math.max(1, Math.round(loan.remaining * (loan.rate / 100)));
      const due = Math.min(loan.remaining + interest, interest + Math.ceil(loan.remaining * 0.15));
      if (b.marks >= due) {
        b.marks -= due;
        l.marks += due;
        loan.remaining = Math.max(0, loan.remaining + interest - due);
      } else {
        b.debt += due;
        loan.remaining += interest;
        if (b.debt >= BANKRUPT_DEBT) this.bankrupt(b);
      }
      loan.nextDue = this.tick + LOAN_PERIOD_TICKS;
    }
    this.loans = this.loans.filter((l) => l.remaining > 0);
  }

  private bankrupt(a: Account): void {
    for (const p of this.plots) {
      if (p.ownerId === a.id) {
        p.ownerId = null;
        p.ownerName = null;
        p.price = Math.max(40, Math.floor(p.price * 0.7));
      }
    }
    for (const [k, v] of Object.entries(a.inventory)) {
      if (k in DEPOT_CAP) this.depotStock[k] = (this.depotStock[k] ?? 0) + v;
    }
    a.inventory = emptyInventory();
    a.marks = 80;
    a.debt = 0;
    this.workers = this.workers.filter((w) => w.ownerId !== a.id);
    this.vehicles = this.vehicles.filter((v) => v.ownerId !== a.id);
    this.buildings = this.buildings.filter((b) => b.ownerId !== a.id);
  }

  controls(you: Account, ownerId: string | null): boolean {
    if (!ownerId) return false;
    if (ownerId === you.id) return true;
    return this.llcs.some((l) => l.id === ownerId && l.members.some((m) => m.playerId === you.id));
  }

  private assertPrintAllowed(you: Account, bp: Blueprint): void {
    const print = fingerprint(bp.tiles, bp.machine ?? "none");
    const hit = this.patents.find((p) => p.fingerprint === print && p.until > this.tick);
    if (!hit) return;
    if (hit.ownerId === you.id) return;
    const lic = this.licenses.find((l) => l.patentId === hit.id && l.licenseeId === you.id && !l.revoked);
    if (!lic) throw new Error(`Print is patented by ${hit.ownerName}. Ask them for a license.`);
  }

  setRecipe(you: Account, buildingId: string, recipeId: string | null): void {
    const b = this.buildings.find((x) => x.id === buildingId);
    if (!b || !this.controls(you, b.ownerId)) throw new Error("Not your machine.");
    if (recipeId && !KNOWN_RECIPES.some((r) => r.id === recipeId)) throw new Error("Unknown recipe.");
    b.recipeId = recipeId;
  }

  craft(you: Account, process: Process, inputs: Qty, name?: string): void {
    const use = compact(inputs);
    if (!qtyHas(you.inventory, use)) throw new Error("Missing inputs.");
    if (Object.keys(use).length === 0) throw new Error("Pick inputs.");
    const known = findRecipe(process, use);
    if (known) {
      qtySub(you.inventory, known.in);
      qtyAdd(you.inventory, known.out);
      return;
    }
    const made = inventFrom(process, use, you.name);
    qtySub(you.inventory, use);
    if (made === "slag") throw new Error("The mix collapsed into slag.");
    const existing = this.registry.find((r) => r.id === made.id);
    if (existing) {
      you.inventory[existing.id] = (you.inventory[existing.id] ?? 0) + 1;
      return;
    }
    made.name = (name || "").trim().slice(0, 22) || `Unknown ${made.id.slice(0, 5)}`;
    this.registry.push(made);
    you.inventory[made.id] = 1;
  }

  marketSell(you: Account, item: string, qty: number, price: number): void {
    const n = Math.max(1, Math.floor(qty));
    const p = Math.max(1, Math.floor(price));
    if ((you.inventory[item] ?? 0) < n) throw new Error("You do not have that.");
    you.inventory[item] -= n;
    this.market.push({
      id: newId(),
      sellerId: you.id,
      sellerName: you.name,
      item,
      qty: n,
      price: p,
    });
  }

  marketBuy(you: Account, orderId: string): void {
    const i = this.market.findIndex((o) => o.id === orderId);
    if (i < 0) throw new Error("Order is gone.");
    const o = this.market[i];
    if (o.sellerId === you.id) throw new Error("That is your own order.");
    const cost = o.price * o.qty;
    if (you.marks < cost) throw new Error("Not enough Marks.");
    const seller = this.accounts.get(o.sellerId);
    you.marks -= cost;
    if (seller) seller.marks += cost;
    you.inventory[o.item] = (you.inventory[o.item] ?? 0) + o.qty;
    this.market.splice(i, 1);
  }

  mailSend(you: Account, toName: string, body: string): void {
    const to = this.byName.get(toName.trim().toLowerCase());
    if (!to) throw new Error("No player by that name.");
    this.pushMail(you, to, body.slice(0, 280), "note", {});
  }

  mailLoan(you: Account, toName: string, amount: number, rate: number, plotId: number | null): void {
    const to = this.byName.get(toName.trim().toLowerCase());
    if (!to) throw new Error("No player by that name.");
    const n = Math.max(10, Math.floor(amount));
    if (you.marks < n) throw new Error("You cannot lend what you do not have.");
    this.pushMail(you, to, `Loan offer: ${n} M at ${rate}%`, "loan", {
      amount: n,
      rate: Math.max(0, Math.min(40, rate)),
      plotId: plotId ?? -1,
    });
  }

  mailAccept(you: Account, mailId: string): void {
    const mail = this.mails.find((m) => m.id === mailId && m.toId === you.id);
    if (!mail) throw new Error("No such letter.");
    mail.read = true;
    if (mail.kind === "loan") {
      const amount = Number(mail.payload.amount);
      const lender = this.accounts.get(mail.fromId);
      if (!lender || lender.marks < amount) throw new Error("Lender no longer has the Marks.");
      lender.marks -= amount;
      you.marks += amount;
      this.loans.push({
        id: newId(),
        lenderId: lender.id,
        lenderName: lender.name,
        borrowerId: you.id,
        remaining: amount,
        rate: Number(mail.payload.rate),
        nextDue: this.tick + LOAN_PERIOD_TICKS,
        collateralPlotId: Number(mail.payload.plotId) >= 0 ? Number(mail.payload.plotId) : null,
      });
    }
    if (mail.kind === "llc-invite") {
      const llc = this.llcs.find((l) => l.id === String(mail.payload.llcId));
      if (!llc) throw new Error("Company is gone.");
      if (llc.members.some((m) => m.playerId === you.id)) return;
      llc.members.push({
        playerId: you.id,
        name: you.name,
        shares: Number(mail.payload.shares) || 10,
        role: "partner",
      });
    }
    if (mail.kind === "license") {
      this.licenses.push({
        id: newId(),
        patentId: String(mail.payload.patentId),
        licensorId: mail.fromId,
        licenseeId: you.id,
        killSwitch: Boolean(mail.payload.killSwitch),
        revoked: false,
      });
    }
  }

  foundLlc(you: Account, name: string): void {
    const n = name.trim().slice(0, 24);
    if (n.length < 3) throw new Error("Company name is too short.");
    if (you.marks < LLC_FEE) throw new Error("Filing fee is 50 Marks.");
    you.marks -= LLC_FEE;
    this.llcs.push({
      id: newId(),
      name: n,
      marks: 0,
      isBank: false,
      depositRate: 3,
      inventory: emptyInventory(),
      members: [{ playerId: you.id, name: you.name, shares: 100, role: "manager" }],
    });
  }

  llcInvite(you: Account, llcId: string, toName: string, shares: number): void {
    const llc = this.llcs.find((l) => l.id === llcId);
    if (!llc || llc.members[0]?.playerId !== you.id) throw new Error("Only the manager can invite.");
    const to = this.byName.get(toName.trim().toLowerCase());
    if (!to) throw new Error("No player by that name.");
    this.pushMail(you, to, `Join ${llc.name} for ${shares}%`, "llc-invite", { llcId: llc.id, shares });
  }

  transferPlot(you: Account, plotId: number, llcId: string): void {
    const plot = this.plots.find((p) => p.id === plotId);
    const llc = this.llcs.find((l) => l.id === llcId);
    if (!plot || plot.ownerId !== you.id) throw new Error("Not your plot.");
    if (!llc || !llc.members.some((m) => m.playerId === you.id)) throw new Error("Not your company.");
    plot.ownerId = llc.id;
    plot.ownerName = llc.name;
  }

  patent(you: Account, blueprintId: string): void {
    const bp = you.blueprints.find((b) => b.id === blueprintId);
    if (!bp) throw new Error("No such print.");
    if (you.marks < PATENT_FEE) throw new Error("Patent fee is 40 Marks.");
    const print = fingerprint(bp.tiles, bp.machine ?? "none");
    if (this.patents.some((p) => p.fingerprint === print && p.until > this.tick)) {
      throw new Error("Someone already locked that print.");
    }
    you.marks -= PATENT_FEE;
    bp.patented = true;
    this.patents.push({
      id: newId(),
      ownerId: you.id,
      ownerName: you.name,
      name: bp.name,
      fingerprint: print,
      until: this.tick + PATENT_MAINT_TICKS,
    });
  }

  licenseOffer(you: Account, patentId: string, toName: string, killSwitch: boolean): void {
    const pat = this.patents.find((p) => p.id === patentId && p.ownerId === you.id);
    if (!pat) throw new Error("Not your patent.");
    const to = this.byName.get(toName.trim().toLowerCase());
    if (!to) throw new Error("No player by that name.");
    this.pushMail(you, to, `License for ${pat.name}`, "license", { patentId: pat.id, killSwitch });
  }

  licenseRevoke(you: Account, licenseId: string): void {
    const lic = this.licenses.find((l) => l.id === licenseId && l.licensorId === you.id);
    if (!lic) throw new Error("Not your license to pull.");
    lic.revoked = true;
    if (lic.killSwitch) {
      const pat = this.patents.find((p) => p.id === lic.patentId);
      if (pat) {
        for (const b of this.buildings) {
          if (b.ownerId === lic.licenseeId && fingerprint(b.tiles, b.machine) === pat.fingerprint) {
            b.complete = false;
            b.needed = Math.max(b.needed, 40);
            b.done = 0;
          }
        }
      }
    }
  }

  pave(you: Account, x: number, y: number): void {
    if (!inWorld(x, y)) throw new Error("Out of the world.");
    const plot = this.plots[plotIdAt(x, y)];
    if (!this.controls(you, plot.ownerId)) throw new Error("Pave your own land, or file a Government proposal.");
    if ((you.inventory.stone ?? 0) < 1) throw new Error("Need 1 stone.");
    you.inventory.stone -= 1;
    this.roads[tileIndex(x, y)] = 1;
  }

  propose(
    you: Account,
    kind: "road" | "pipe" | "power",
    tiles: { x: number; y: number }[],
    splits: { playerId: string; pct: number }[],
  ): void {
    if (tiles.length < 2) throw new Error("Draw a longer path.");
    const owners = new Set<string>();
    for (const t of tiles) {
      if (!inWorld(t.x, t.y)) throw new Error("Path leaves the map.");
      const o = this.plots[plotIdAt(t.x, t.y)].ownerId;
      if (o) owners.add(o);
    }
    this.proposals.push({
      id: newId(),
      authorId: you.id,
      authorName: you.name,
      kind,
      tiles,
      marksCost: tiles.length,
      stoneCost: tiles.length,
      splits: (splits.length ? splits : [...owners].map((id) => ({ playerId: id, pct: Math.floor(100 / Math.max(1, owners.size)) }))).map((s) => ({
        playerId: s.playerId,
        name: this.nameOf(s.playerId),
        pct: s.pct,
      })),
      votes: {},
      pledges: {},
      thread: [{ name: you.name, text: `Proposed a ${kind}.` }],
      status: "open",
    });
  }

  vote(you: Account, proposalId: string, vote: "yes" | "no"): void {
    const p = this.proposals.find((x) => x.id === proposalId);
    if (!p || p.status !== "open") throw new Error("No open proposal.");
    p.votes[you.id] = vote;
    this.tryBuildProposal(p);
  }

  pledge(you: Account, proposalId: string, marks: number): void {
    const p = this.proposals.find((x) => x.id === proposalId);
    if (!p || p.status !== "open") throw new Error("No open proposal.");
    const n = Math.max(1, Math.floor(marks));
    if (you.marks < n) throw new Error("Not enough Marks.");
    you.marks -= n;
    p.pledges[you.id] = (p.pledges[you.id] ?? 0) + n;
    this.tryBuildProposal(p);
  }

  comment(you: Account, proposalId: string, text: string): void {
    const p = this.proposals.find((x) => x.id === proposalId);
    if (!p) throw new Error("No such proposal.");
    p.thread.push({ name: you.name, text: text.slice(0, 180) });
  }

  buyTruck(you: Account): void {
    if (you.marks < TRUCK_MARKS) throw new Error("Truck costs 55 Marks.");
    if ((you.inventory.timber ?? 0) < TRUCK_TIMBER || (you.inventory.ore ?? 0) < TRUCK_ORE) {
      throw new Error("Need 6 timber and 3 ore.");
    }
    const plots = this.ownedPlots(you.id);
    if (!plots.length) throw new Error("Need land for a depot.");
    you.marks -= TRUCK_MARKS;
    you.inventory.timber -= TRUCK_TIMBER;
    you.inventory.ore -= TRUCK_ORE;
    const o = plotOrigin(plots[0].id);
    this.vehicles.push({
      id: newId(),
      ownerId: you.id,
      x: o.x + 2,
      y: o.y + 2,
      cargo: {},
      route: [],
      stop: 0,
    });
  }

  setRoute(you: Account, vehicleId: string, route: Vehicle["route"]): void {
    const v = this.vehicles.find((x) => x.id === vehicleId && x.ownerId === you.id);
    if (!v) throw new Error("Not your truck.");
    v.route = route.slice(0, 12);
    v.stop = 0;
  }

  private tryBuildProposal(p: Proposal): void {
    const owners = new Set(p.tiles.map((t) => this.plots[plotIdAt(t.x, t.y)].ownerId).filter(Boolean) as string[]);
    const people = [...owners].filter((id) => this.accounts.has(id));
    if (people.some((id) => p.votes[id] === "no")) {
      p.status = "failed";
      return;
    }
    if (people.length && people.some((id) => p.votes[id] !== "yes")) return;
    const pledged = Object.values(p.pledges).reduce((a, b) => a + b, 0);
    if (pledged < p.marksCost) return;
    const author = this.accounts.get(p.authorId);
    if (!author || (author.inventory.stone ?? 0) < p.stoneCost) return;
    author.inventory.stone -= p.stoneCost;
    if (p.kind === "road") {
      for (const t of p.tiles) this.roads[tileIndex(t.x, t.y)] = 1;
    }
    if (p.kind === "pipe") {
      for (const t of p.tiles) this.pipes[tileIndex(t.x, t.y)] = 1;
    }
    if (p.kind === "power") {
      for (const t of p.tiles) this.power[tileIndex(t.x, t.y)] = 1;
    }
    p.status = "built";
  }

  private bleedPollution(plot: Plot): void {
    for (const n of this.plots) {
      if (Math.abs(n.gx - plot.gx) + Math.abs(n.gy - plot.gy) === 1) {
        n.pollution = Math.min(100, (n.pollution ?? 0) + 1);
      }
    }
  }

  private stepEco(): void {
    for (const p of this.plots) {
      p.pollution = Math.max(0, (p.pollution ?? 0) - 1);
      if ((p.pollution ?? 0) > 8) continue;
      const ox = p.gx * PLOT_TILES;
      const oy = p.gy * PLOT_TILES;
      const x = ox + Math.floor(hash2(p.id, this.tick, this.seed) * PLOT_TILES);
      const y = oy + Math.floor(hash2(this.tick, p.id, this.seed) * PLOT_TILES);
      const i = tileIndex(x, y);
      if (this.terrain[i] === TERRAIN.grass && hash2(x, y, this.tick) > 0.92) {
        this.terrain[i] = TERRAIN.tree;
        p.timber += 1;
      }
    }
  }

  private stepCompute(): void {
    for (const a of this.accounts.values()) {
      const poll = this.ownedPlots(a.id).reduce((s, p) => s + (p.pollution ?? 0), 0);
      evalCircuits(this.circuits.filter((c) => c.ownerId === a.id), a.inventory, poll, this.tick);
      const relays = this.circuits.filter((c) => c.ownerId === a.id && c.kind === "relay");
      for (const r of relays) {
        const b = this.buildings.find((x) => x.id === r.param && this.controls(a, x.ownerId));
        if (b) b.paused = !r.on;
      }
      if (!a.script.trim()) continue;
      const res = runScript(a.script, {
        stock: a.inventory,
        pollution: poll,
        tick: this.tick,
        buildings: this.buildings.filter((b) => this.controls(a, b.ownerId)).map((b) => ({
          id: b.id,
          machine: b.machine,
          paused: b.paused,
        })),
      });
      a.scriptLog = res.log.slice(-8);
      if (res.stopAll) {
        for (const b of this.buildings) if (this.controls(a, b.ownerId)) b.paused = true;
      }
      for (const id of res.stop) {
        const b = this.buildings.find((x) => x.id === id);
        if (b) b.paused = true;
      }
      for (const id of res.start) {
        const b = this.buildings.find((x) => x.id === id);
        if (b) b.paused = false;
      }
    }
  }

  private tickBanks(): void {
    for (const d of this.deposits) {
      const bank = this.llcs.find((l) => l.id === d.bankId);
      if (!bank) continue;
      const pay = Math.max(1, Math.round(d.amount * (d.rate / 100)));
      if (bank.marks >= pay) {
        bank.marks -= pay;
        d.amount += pay;
      } else {
        this.bankRun(bank);
      }
    }
  }

  private bankRun(bank: Llc): void {
    const book = this.deposits.filter((d) => d.bankId === bank.id);
    const total = book.reduce((s, d) => s + d.amount, 0) || 1;
    const cash = bank.marks;
    for (const d of book) {
      const owner = this.accounts.get(d.ownerId);
      if (owner) owner.marks += Math.floor((d.amount / total) * cash);
    }
    this.deposits = this.deposits.filter((d) => d.bankId !== bank.id);
    bank.marks = 0;
    bank.isBank = false;
    for (const p of this.plots) {
      if (p.ownerId === bank.id) {
        p.ownerId = null;
        p.ownerName = null;
        p.price = Math.max(40, Math.floor(p.price * 0.7));
      }
    }
  }

  placeGate(you: Account, x: number, y: number, kind: GateKind, param: string): void {
    if (!inWorld(x, y)) throw new Error("Out of world.");
    if (!this.controls(you, this.plots[plotIdAt(x, y)].ownerId)) throw new Error("Place gates on your land.");
    this.circuits.push({
      id: newId(),
      ownerId: you.id,
      x,
      y,
      kind,
      inA: null,
      inB: null,
      param,
      on: false,
    });
  }

  wireGates(you: Account, fromId: string, toId: string, slot: "a" | "b"): void {
    const from = this.circuits.find((c) => c.id === fromId && c.ownerId === you.id);
    const to = this.circuits.find((c) => c.id === toId && c.ownerId === you.id);
    if (!from || !to) throw new Error("Those gates are not yours.");
    if (slot === "a") to.inA = from.id;
    else to.inB = from.id;
  }

  saveScript(you: Account, text: string): void {
    you.script = text.slice(0, 1200);
  }

  openBank(you: Account, llcId: string, rate: number): void {
    const llc = this.llcs.find((l) => l.id === llcId);
    if (!llc || llc.members[0]?.playerId !== you.id) throw new Error("Only the manager can open a bank.");
    llc.isBank = true;
    llc.depositRate = Math.max(1, Math.min(20, Math.floor(rate)));
  }

  deposit(you: Account, llcId: string, amount: number): void {
    const llc = this.llcs.find((l) => l.id === llcId && l.isBank);
    if (!llc) throw new Error("That is not a bank.");
    const n = Math.max(5, Math.floor(amount));
    if (you.marks < n) throw new Error("Not enough Marks.");
    you.marks -= n;
    llc.marks += n;
    this.deposits.push({
      id: newId(),
      bankId: llc.id,
      bankName: llc.name,
      ownerId: you.id,
      ownerName: you.name,
      amount: n,
      rate: llc.depositRate,
    });
  }

  withdraw(you: Account, depositId: string): void {
    const i = this.deposits.findIndex((d) => d.id === depositId && d.ownerId === you.id);
    if (i < 0) throw new Error("No such deposit.");
    const d = this.deposits[i];
    const bank = this.llcs.find((l) => l.id === d.bankId);
    if (!bank || bank.marks < d.amount) {
      if (bank) this.bankRun(bank);
      throw new Error("Bank could not cover the withdrawal. Run.");
    }
    bank.marks -= d.amount;
    you.marks += d.amount;
    this.deposits.splice(i, 1);
  }

  linkWallet(you: Account, address: string): void {
    const a = address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      throw new Error("Link a 0x wallet address (MetaMask / local chain account).");
    }
    you.wallet = a;
  }

  async wrapMarks(you: Account, amount: number): Promise<void> {
    if (!you.wallet) throw new Error("Link a 0x wallet first.");
    const n = Math.max(1, Math.floor(amount));
    if (you.marks < n) throw new Error("Not enough Marks.");
    you.marks -= n;
    try {
      const tx = await mintMarks(you.wallet, n);
      you.wraps.push({ tick: this.tick, amount: n, address: you.wallet, tx, kind: "wrap" });
    } catch (err) {
      you.marks += n;
      throw err;
    }
  }

  async unwrapMarks(you: Account, txHash: string): Promise<void> {
    if (!you.wallet) throw new Error("Link a 0x wallet first.");
    const hash = txHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Need a transaction hash from MARKS.burn().");
    if (you.usedUnwraps.includes(hash)) throw new Error("That unwrap was already credited.");
    const amount = await verifyBurnTx(hash, you.wallet);
    if (amount < 1) throw new Error("Burn amount is under 1 Mark.");
    you.usedUnwraps.push(hash);
    you.marks += Math.floor(amount);
    you.wraps.push({ tick: this.tick, amount: Math.floor(amount), address: you.wallet, tx: hash, kind: "unwrap" });
  }

  private nameOf(id: string): string {
    return this.accounts.get(id)?.name ?? this.llcs.find((l) => l.id === id)?.name ?? "unknown";
  }

  private pushMail(
    from: Account,
    to: Account,
    body: string,
    kind: MailItem["kind"],
    payload: MailItem["payload"],
  ): void {
    this.mails.push({
      id: newId(),
      fromId: from.id,
      fromName: from.name,
      toId: to.id,
      body,
      kind,
      payload,
      read: false,
      tick: this.tick,
    });
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
    machine: "none",
    patented: false,
  };
}

function fingerprint(tiles: StructureKind[], machine: MachineKind): string {
  return `${machine}:${tiles.join(",")}`;
}
