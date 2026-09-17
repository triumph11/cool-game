export type Qty = Record<string, number>;

export type Process = "heat" | "crush" | "mix";

export interface Recipe {
  id: string;
  name: string;
  process: Process;
  in: Qty;
  out: Qty;
  ticks: number;
}

export interface RegistryItem {
  id: string;
  name: string;
  formula: string;
  process: Process;
  discoveredBy: string;
  hardness: number;
  conductivity: number;
  melt: number;
}

export const PROCESSES: Process[] = ["heat", "crush", "mix"];

export const KNOWN_RECIPES: Recipe[] = [
  { id: "charcoal", name: "Char charcoal", process: "heat", in: { timber: 2 }, out: { charcoal: 1 }, ticks: 10 },
  { id: "iron", name: "Smelt iron", process: "heat", in: { ore: 2, charcoal: 1 }, out: { iron: 1 }, ticks: 16 },
  { id: "brick", name: "Fire brick", process: "heat", in: { clay: 2 }, out: { brick: 1 }, ticks: 12 },
  { id: "glass", name: "Melt glass", process: "heat", in: { sand: 2 }, out: { glass: 1 }, ticks: 14 },
  { id: "steel", name: "Forge steel", process: "heat", in: { iron: 2, charcoal: 1 }, out: { steel: 1 }, ticks: 22 },
  { id: "crushed-ore", name: "Crush ore", process: "crush", in: { ore: 1 }, out: { grit: 2 }, ticks: 8 },
  { id: "mortar", name: "Mix mortar", process: "mix", in: { sand: 1, clay: 1 }, out: { mortar: 2 }, ticks: 6 },
];

export function compact(q: Qty): Qty {
  const out: Qty = {};
  for (const [k, v] of Object.entries(q)) {
    if (v > 0) out[k] = v;
  }
  return out;
}

export function qtyHas(inv: Qty, cost: Qty): boolean {
  return Object.entries(cost).every(([k, v]) => (inv[k] ?? 0) >= v);
}

export function qtySub(inv: Qty, cost: Qty): void {
  for (const [k, v] of Object.entries(cost)) inv[k] = (inv[k] ?? 0) - v;
}

export function qtyAdd(inv: Qty, add: Qty): void {
  for (const [k, v] of Object.entries(add)) inv[k] = (inv[k] ?? 0) + v;
}

export function qtyEq(a: Qty, b: Qty): boolean {
  const keys = new Set([...Object.keys(compact(a)), ...Object.keys(compact(b))]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

export function findRecipe(process: Process, inputs: Qty): Recipe | undefined {
  return KNOWN_RECIPES.find((r) => r.process === process && qtyEq(r.in, inputs));
}

export function inputKey(process: Process, inputs: Qty): string {
  const parts = Object.entries(compact(inputs))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`);
  return `${process}|${parts.join(",")}`;
}

export function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function inventFrom(process: Process, inputs: Qty, discoverer: string): RegistryItem | "slag" {
  const key = inputKey(process, inputs);
  const h = hashKey(key);
  if (h % 5 === 0) return "slag";
  return {
    id: `m${h.toString(16)}`,
    name: "",
    formula: key,
    process,
    discoveredBy: discoverer,
    hardness: 20 + (h % 80),
    conductivity: h % 100,
    melt: 400 + (h % 1600),
  };
}

export function goodLabel(id: string): string {
  return id
    .split(/[_\s-]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
