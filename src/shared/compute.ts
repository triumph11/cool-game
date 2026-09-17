export type GateKind = "sensor-stock" | "sensor-pollution" | "and" | "or" | "not" | "timer" | "relay";

export const GATE_KINDS: { id: GateKind; label: string }[] = [
  { id: "sensor-stock", label: "Sensor: stock" },
  { id: "sensor-pollution", label: "Sensor: pollution" },
  { id: "and", label: "AND" },
  { id: "or", label: "OR" },
  { id: "not", label: "NOT" },
  { id: "timer", label: "Timer" },
  { id: "relay", label: "Relay (pause machine)" },
];

export interface CircuitNode {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  kind: GateKind;
  inA: string | null;
  inB: string | null;
  param: string;
  on: boolean;
}

export interface ScriptCtx {
  stock: Record<string, number>;
  pollution: number;
  tick: number;
  buildings: { id: string; machine: string; paused: boolean }[];
}

export interface ScriptResult {
  start: string[];
  stop: string[];
  stopAll: boolean;
  log: string[];
}

export function evalCircuits(
  nodes: CircuitNode[],
  stock: Record<string, number>,
  pollution: number,
  tick: number,
): CircuitNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = [
    ...nodes.filter((n) => n.kind.startsWith("sensor") || n.kind === "timer"),
    ...nodes.filter((n) => n.kind === "not" || n.kind === "and" || n.kind === "or"),
    ...nodes.filter((n) => n.kind === "relay"),
  ];
  for (const n of order) {
    const a = n.inA ? byId.get(n.inA)?.on : false;
    const b = n.inB ? byId.get(n.inB)?.on : false;
    if (n.kind === "sensor-stock") {
      const [item, op, raw] = n.param.split(" ");
      const need = Number(raw);
      const have = stock[item] ?? 0;
      n.on = op === "<" ? have < need : have > need;
    } else if (n.kind === "sensor-pollution") {
      n.on = pollution > (Number(n.param) || 20);
    } else if (n.kind === "timer") {
      const period = Math.max(4, Number(n.param) || 16);
      n.on = tick % period < period / 2;
    } else if (n.kind === "and") n.on = Boolean(a && b);
    else if (n.kind === "or") n.on = Boolean(a || b);
    else if (n.kind === "not") n.on = !a;
    else if (n.kind === "relay") n.on = Boolean(a);
  }
  return nodes;
}

export function runScript(text: string, ctx: ScriptCtx): ScriptResult {
  const result: ScriptResult = { start: [], stop: [], stopAll: false, log: [] };
  const lines = text.split(/\r?\n/).slice(0, 24);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stock = line.match(/^IF\s+STOCK\s+(\S+)\s*(>|<)\s*(\d+)\s+THEN\s+(START|STOP)\s+(\S+)$/i);
    const poll = line.match(/^IF\s+POLLUTION\s*(>|<)\s*(\d+)\s+THEN\s+(START|STOP)\s+(\S+)$/i);
    let pass = false;
    let act = "";
    let target = "";
    if (stock) {
      const have = ctx.stock[stock[1]] ?? ctx.stock[stock[1].toLowerCase()] ?? 0;
      const need = Number(stock[3]);
      pass = stock[2] === "<" ? have < need : have > need;
      act = stock[4];
      target = stock[5];
    } else if (poll) {
      pass = poll[1] === "<" ? ctx.pollution < Number(poll[2]) : ctx.pollution > Number(poll[2]);
      act = poll[3];
      target = poll[4];
    } else {
      result.log.push(`bad: ${line}`);
      continue;
    }
    if (!pass) continue;
    if (act.toUpperCase() === "STOP" && target.toUpperCase() === "ALL") {
      result.stopAll = true;
      result.log.push(line);
      continue;
    }
    const ids = resolveTarget(ctx, target);
    if (act.toUpperCase() === "START") result.start.push(...ids);
    else result.stop.push(...ids);
    result.log.push(line);
  }
  return result;
}

function resolveTarget(ctx: ScriptCtx, target: string): string[] {
  if (ctx.buildings.some((b) => b.id === target)) return [target];
  const kind = target.toLowerCase();
  return ctx.buildings.filter((b) => b.machine === kind).map((b) => b.id);
}
