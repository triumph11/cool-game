import type { Inventory, Job, StructureKind, WorldSnapshot } from "./types";

export type ClientMsg =
  | { t: "register"; name: string; password: string }
  | { t: "login"; name: string; password: string }
  | { t: "buyPlot"; plotId: number }
  | { t: "hireWorker" }
  | { t: "setJob"; workerIds: string[]; job: Job | null }
  | { t: "saveBlueprint"; name: string; w: number; h: number; tiles: StructureKind[] }
  | { t: "placeBuilding"; blueprintId: string; x: number; y: number }
  | { t: "depotBuy"; item: keyof Inventory; qty: number }
  | { t: "depotSell"; item: keyof Inventory; qty: number };

export type ServerMsg =
  | { t: "error"; message: string }
  | { t: "welcome"; snapshot: WorldSnapshot }
  | { t: "state"; snapshot: WorldSnapshot };
