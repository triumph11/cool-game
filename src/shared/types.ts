import type { MachineKind, Material, StructureKind } from "./constants";
import type { Process, Qty, RegistryItem } from "./chemistry";
import type { CircuitNode } from "./compute";
export type { Material, StructureKind, MachineKind };
export type { Qty };

export type Inventory = Qty;

export interface Plot {
  id: number;
  gx: number;
  gy: number;
  ownerId: string | null;
  ownerName: string | null;
  price: number;
  timber: number;
  stone: number;
  ore: number;
  pollution: number;
}

export interface Worker {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  job: Job | null;
}

export type Job =
  | { type: "move"; x: number; y: number }
  | { type: "mine"; x: number; y: number }
  | { type: "build"; buildingId: string }
  | { type: "work"; buildingId: string };

export interface Building {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tiles: StructureKind[];
  needed: number;
  done: number;
  complete: boolean;
  machine: MachineKind;
  recipeId: string | null;
  work: number;
  paused: boolean;
}

export interface Blueprint {
  id: string;
  ownerId: string;
  name: string;
  w: number;
  h: number;
  tiles: StructureKind[];
  machine: MachineKind;
  patented: boolean;
}

export interface DepotState {
  stock: Inventory;
  buy: Inventory;
  sell: Inventory;
}

export interface PublicPlayer {
  id: string;
  name: string;
  marks: number;
  plots: number;
  workers: number;
}

export interface MarketOrder {
  id: string;
  sellerId: string;
  sellerName: string;
  item: string;
  qty: number;
  price: number;
}

export interface MailItem {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  body: string;
  kind: "note" | "loan" | "license" | "llc-invite";
  payload: Record<string, string | number | boolean>;
  read: boolean;
  tick: number;
}

export interface Llc {
  id: string;
  name: string;
  marks: number;
  inventory: Qty;
  members: { playerId: string; name: string; shares: number; role: "manager" | "partner" }[];
  isBank: boolean;
  depositRate: number;
}

export interface Deposit {
  id: string;
  bankId: string;
  bankName: string;
  ownerId: string;
  ownerName: string;
  amount: number;
  rate: number;
}

export interface WrapReceipt {
  tick: number;
  amount: number;
  address: string;
}

export interface Loan {
  id: string;
  lenderId: string;
  lenderName: string;
  borrowerId: string;
  remaining: number;
  rate: number;
  nextDue: number;
  collateralPlotId: number | null;
}

export interface Patent {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  fingerprint: string;
  until: number;
}

export interface License {
  id: string;
  patentId: string;
  licensorId: string;
  licenseeId: string;
  killSwitch: boolean;
  revoked: boolean;
}

export interface Vehicle {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  cargo: Qty;
  route: { x: number; y: number; action: "skip" | "load" | "unload"; item: string }[];
  stop: number;
}

export interface Proposal {
  id: string;
  authorId: string;
  authorName: string;
  kind: "road" | "pipe" | "power";
  tiles: { x: number; y: number }[];
  marksCost: number;
  stoneCost: number;
  splits: { playerId: string; name: string; pct: number }[];
  votes: Record<string, "yes" | "no">;
  pledges: Record<string, number>;
  thread: { name: string; text: string }[];
  status: "open" | "built" | "failed";
}

export interface You {
  id: string;
  name: string;
  marks: number;
  debt: number;
  inventory: Inventory;
  blueprints: Blueprint[];
  mail: MailItem[];
  llcs: Llc[];
  loansMade: Loan[];
  loansTaken: Loan[];
  patents: Patent[];
  licenses: License[];
  deposits: Deposit[];
  script: string;
  scriptLog: string[];
  wallet: string;
  wraps: WrapReceipt[];
}

export interface WorldSnapshot {
  tick: number;
  seed: number;
  terrain: number[];
  roads: number[];
  plots: Plot[];
  workers: Worker[];
  buildings: Building[];
  vehicles: Vehicle[];
  depot: DepotState;
  market: MarketOrder[];
  registry: RegistryItem[];
  recipes: { id: string; name: string; process: Process; in: Qty; out: Qty }[];
  proposals: Proposal[];
  circuits: CircuitNode[];
  pipes: number[];
  power: number[];
  banks: Llc[];
  players: PublicPlayer[];
  you: You;
}
