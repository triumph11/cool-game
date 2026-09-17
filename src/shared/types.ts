import type { Material, StructureKind } from "./constants";
export type { Material, StructureKind };

export type Inventory = Record<Material, number>;

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
  | { type: "build"; buildingId: string };

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
}

export interface Blueprint {
  id: string;
  ownerId: string;
  name: string;
  w: number;
  h: number;
  tiles: StructureKind[];
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

export interface You {
  id: string;
  name: string;
  marks: number;
  inventory: Inventory;
  blueprints: Blueprint[];
}

export interface WorldSnapshot {
  tick: number;
  seed: number;
  terrain: number[];
  plots: Plot[];
  workers: Worker[];
  buildings: Building[];
  depot: DepotState;
  players: PublicPlayer[];
  you: You;
}
