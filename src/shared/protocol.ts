import type { Process, Qty } from "./chemistry";
import type { Job, MachineKind, StructureKind, WorldSnapshot } from "./types";

export type ClientMsg =
  | { t: "register"; name: string; password: string }
  | { t: "login"; name: string; password: string }
  | { t: "buyPlot"; plotId: number }
  | { t: "hireWorker" }
  | { t: "setJob"; workerIds: string[]; job: Job | null }
  | { t: "saveBlueprint"; name: string; w: number; h: number; tiles: StructureKind[]; machine: MachineKind }
  | { t: "placeBuilding"; blueprintId: string; x: number; y: number }
  | { t: "setRecipe"; buildingId: string; recipeId: string | null }
  | { t: "depotBuy"; item: string; qty: number }
  | { t: "depotSell"; item: string; qty: number }
  | { t: "marketSell"; item: string; qty: number; price: number }
  | { t: "marketBuy"; orderId: string }
  | { t: "craft"; process: Process; inputs: Qty; name?: string }
  | { t: "mailSend"; toName: string; body: string }
  | { t: "mailLoan"; toName: string; amount: number; rate: number; plotId: number | null }
  | { t: "mailAccept"; mailId: string }
  | { t: "foundLlc"; name: string }
  | { t: "llcInvite"; llcId: string; toName: string; shares: number }
  | { t: "transferPlot"; plotId: number; llcId: string }
  | { t: "patent"; blueprintId: string }
  | { t: "licenseOffer"; patentId: string; toName: string; killSwitch: boolean }
  | { t: "licenseRevoke"; licenseId: string }
  | { t: "pave"; x: number; y: number }
  | { t: "propose"; kind: "road" | "pipe" | "power"; tiles: { x: number; y: number }[]; splits: { playerId: string; pct: number }[] }
  | { t: "vote"; proposalId: string; vote: "yes" | "no" }
  | { t: "pledge"; proposalId: string; marks: number }
  | { t: "comment"; proposalId: string; text: string }
  | { t: "buyTruck" }
  | { t: "setRoute"; vehicleId: string; route: { x: number; y: number; action: "skip" | "load" | "unload"; item: string }[] };

export type ServerMsg =
  | { t: "error"; message: string }
  | { t: "welcome"; snapshot: WorldSnapshot }
  | { t: "state"; snapshot: WorldSnapshot };
