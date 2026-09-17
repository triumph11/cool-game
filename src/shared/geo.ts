import { PLOT_COUNT, PLOT_TILES, WORLD_TILES } from "./constants";

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function tileIndex(x: number, y: number): number {
  return y * WORLD_TILES + x;
}

export function inWorld(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WORLD_TILES && y < WORLD_TILES;
}

export function plotIdAt(tx: number, ty: number): number {
  const gx = Math.floor(tx / PLOT_TILES);
  const gy = Math.floor(ty / PLOT_TILES);
  return gy * PLOT_COUNT + gx;
}

export function plotOrigin(plotId: number): { x: number; y: number } {
  const gx = plotId % PLOT_COUNT;
  const gy = Math.floor(plotId / PLOT_COUNT);
  return { x: gx * PLOT_TILES, y: gy * PLOT_TILES };
}

export function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
