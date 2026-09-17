import { TERRAIN, WORLD_TILES } from "../shared/constants";
import { inWorld, tileIndex } from "../shared/geo";

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function walkable(terrain: number[], x: number, y: number): boolean {
  if (!inWorld(x, y)) return false;
  return terrain[tileIndex(x, y)] !== TERRAIN.water;
}

export function nextStep(
  terrain: number[],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): { x: number; y: number } | null {
  const startX = Math.round(sx);
  const startY = Math.round(sy);
  const goalX = Math.round(tx);
  const goalY = Math.round(ty);
  if (startX === goalX && startY === goalY) return null;
  if (!walkable(terrain, goalX, goalY)) return { x: startX, y: startY };

  const key = (x: number, y: number) => y * WORLD_TILES + x;
  const came = new Map<number, number>();
  const q: number[] = [key(startX, startY)];
  const seen = new Set<number>(q);
  let found = false;
  const limit = 1400;

  for (let i = 0; i < q.length && i < limit; i++) {
    const cur = q[i];
    const cx = cur % WORLD_TILES;
    const cy = Math.floor(cur / WORLD_TILES);
    if (cx === goalX && cy === goalY) {
      found = true;
      break;
    }
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nk = key(nx, ny);
      if (seen.has(nk) || !walkable(terrain, nx, ny)) continue;
      seen.add(nk);
      came.set(nk, cur);
      q.push(nk);
    }
  }

  if (!found) {
    const dx = Math.sign(goalX - startX);
    const dy = Math.sign(goalY - startY);
    if (dx && walkable(terrain, startX + dx, startY)) return { x: startX + dx, y: startY };
    if (dy && walkable(terrain, startX, startY + dy)) return { x: startX, y: startY + dy };
    return null;
  }

  let cur = key(goalX, goalY);
  const start = key(startX, startY);
  while (came.get(cur) !== start && came.has(cur)) {
    cur = came.get(cur)!;
  }
  return { x: cur % WORLD_TILES, y: Math.floor(cur / WORLD_TILES) };
}
