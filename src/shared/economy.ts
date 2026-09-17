import {
  DEPOT_BASE_BUY,
  DEPOT_CAP,
  MATERIALS,
  STRUCTURE,
  STRUCTURE_MATERIAL,
  type Material,
  type StructureKind,
} from "./constants";
import type { Inventory } from "./types";

export function emptyInventory(): Inventory {
  return { timber: 0, stone: 0, ore: 0, clay: 0, sand: 0 };
}

export function depotPrices(stock: Inventory): { buy: Inventory; sell: Inventory } {
  const buy = emptyInventory();
  const sell = emptyInventory();
  for (const item of MATERIALS) {
    const cap = DEPOT_CAP[item];
    const s = Math.max(0, Math.min(cap, stock[item]));
    const scarcity = 1 - s / cap;
    buy[item] = Math.max(1, Math.round(DEPOT_BASE_BUY[item] * (1.05 + 1.7 * scarcity)));
    sell[item] = Math.max(1, Math.round(buy[item] * 0.55));
  }
  return { buy, sell };
}

export function billOfMaterials(tiles: StructureKind[]): Inventory {
  const bom = emptyInventory();
  for (const kind of tiles) {
    if (kind === STRUCTURE.empty) continue;
    const mat = STRUCTURE_MATERIAL[kind];
    bom[mat] += 1;
  }
  return bom;
}

export function hasMaterials(inv: Inventory, cost: Inventory): boolean {
  return MATERIALS.every((m) => inv[m] >= cost[m]);
}

export function subtractMaterials(inv: Inventory, cost: Inventory): void {
  for (const m of MATERIALS) inv[m] -= cost[m];
}

export function addMaterials(inv: Inventory, add: Inventory): void {
  for (const m of MATERIALS) inv[m] += add[m];
}

export function terrainToMaterial(terrain: number): Material | null {
  if (terrain === 3) return "timber";
  if (terrain === 2) return "stone";
  if (terrain === 4) return "ore";
  if (terrain === 5) return "sand";
  if (terrain === 6) return "clay";
  return null;
}

export function materialLabel(m: Material): string {
  return m[0].toUpperCase() + m.slice(1);
}
