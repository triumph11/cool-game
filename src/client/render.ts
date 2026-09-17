import { PLOT_TILES, STRUCTURE, TERRAIN, TILE_PX, WORLD_TILES } from "../shared/constants";
import type { WorldSnapshot } from "../shared/types";

const TERRAIN_COLOR: Record<number, string> = {
  [TERRAIN.grass]: "#3f6b38",
  [TERRAIN.water]: "#2f5d73",
  [TERRAIN.stone]: "#7a776e",
  [TERRAIN.tree]: "#245c2a",
  [TERRAIN.ore]: "#8a6a2a",
  [TERRAIN.sand]: "#c2a36b",
  [TERRAIN.clay]: "#8b5a3c",
};

const STRUCT_COLOR: Record<number, string> = {
  [STRUCTURE.timberWall]: "#6b4226",
  [STRUCTURE.stoneWall]: "#9a968c",
  [STRUCTURE.clayFloor]: "#a56a48",
  [STRUCTURE.sandPath]: "#d4b57a",
  [STRUCTURE.oreDoor]: "#c9a227",
  [STRUCTURE.road]: "#5c5346",
};

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function makeCamera(): Camera {
  return {
    x: (WORLD_TILES * TILE_PX) / 2,
    y: (WORLD_TILES * TILE_PX) / 2,
    zoom: 1,
  };
}

export function screenToTile(cam: Camera, canvas: HTMLCanvasElement, sx: number, sy: number): { x: number; y: number } {
  const z = cam.zoom;
  const wx = cam.x + (sx - canvas.clientWidth / 2) / z;
  const wy = cam.y + (sy - canvas.clientHeight / 2) / z;
  return { x: Math.floor(wx / TILE_PX), y: Math.floor(wy / TILE_PX) };
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  snap: WorldSnapshot,
  cam: Camera,
  hover: { x: number; y: number } | null,
  selectedWorkers: Set<string>,
  ghost: { x: number; y: number; w: number; h: number } | null,
  youId: string,
): void {
  const { canvas } = ctx;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0b0a09";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  const t0 = Math.max(0, Math.floor((cam.x - w / cam.zoom / 2) / TILE_PX) - 1);
  const t1 = Math.min(WORLD_TILES - 1, Math.ceil((cam.x + w / cam.zoom / 2) / TILE_PX) + 1);
  const u0 = Math.max(0, Math.floor((cam.y - h / cam.zoom / 2) / TILE_PX) - 1);
  const u1 = Math.min(WORLD_TILES - 1, Math.ceil((cam.y + h / cam.zoom / 2) / TILE_PX) + 1);

  for (let y = u0; y <= u1; y++) {
    for (let x = t0; x <= t1; x++) {
      const tile = snap.terrain[y * WORLD_TILES + x];
      const px = x * TILE_PX;
      const py = y * TILE_PX;
      ctx.fillStyle = TERRAIN_COLOR[tile] ?? "#3f6b38";
      ctx.fillRect(px, py, TILE_PX, TILE_PX);
      if (tile === TERRAIN.grass && ((x + y) & 1) === 0) {
        ctx.fillStyle = "#3a6334";
        ctx.fillRect(px, py, TILE_PX, TILE_PX);
      }
      if (tile === TERRAIN.tree) {
        ctx.fillStyle = "#1d3f1c";
        ctx.fillRect(px + 8, py + 10, 4, 8);
        ctx.fillStyle = "#2e7a32";
        ctx.fillRect(px + 3, py + 2, 14, 12);
      }
      if (tile === TERRAIN.ore) {
        ctx.fillStyle = "#c9a227";
        ctx.fillRect(px + 6, py + 6, 4, 4);
        ctx.fillRect(px + 12, py + 11, 3, 3);
      }
      if (tile === TERRAIN.water) {
        ctx.fillStyle = "#3a7390";
        if ((x + y + Math.floor(snap.tick / 8)) % 5 === 0) ctx.fillRect(px + 2, py + 8, 8, 2);
      }
      if (snap.roads?.[y * WORLD_TILES + x]) {
        ctx.fillStyle = "#5c5346";
        ctx.fillRect(px + 3, py + 3, TILE_PX - 6, TILE_PX - 6);
        ctx.fillStyle = "#c9a227";
        ctx.fillRect(px + TILE_PX / 2 - 1, py + 4, 2, TILE_PX - 8);
      }
      if (snap.pipes?.[y * WORLD_TILES + x]) {
        ctx.fillStyle = "#3d6b8a";
        ctx.fillRect(px + 4, py + TILE_PX / 2 - 1, TILE_PX - 8, 3);
      }
      if (snap.power?.[y * WORLD_TILES + x]) {
        ctx.fillStyle = "#d4a017";
        ctx.fillRect(px + TILE_PX / 2 - 1, py + 4, 2, TILE_PX - 8);
      }
    }
  }

  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 1 / cam.zoom;
  for (const plot of snap.plots) {
    const px = plot.gx * PLOT_TILES * TILE_PX;
    const py = plot.gy * PLOT_TILES * TILE_PX;
    const size = PLOT_TILES * TILE_PX;
    const pol = Math.min(1, (plot.pollution ?? 0) / 80);
    ctx.fillStyle = `rgba(120, 70, 30, ${0.08 + pol * 0.35})`;
    ctx.fillRect(px, py, size, size);
    if (plot.ownerId === youId) {
      ctx.fillStyle = "#d4a01718";
      ctx.fillRect(px, py, size, size);
      ctx.strokeStyle = "#d4a017aa";
    } else if (plot.ownerId) {
      ctx.fillStyle = "#c45c3e14";
      ctx.fillRect(px, py, size, size);
      ctx.strokeStyle = "#c45c3e66";
    } else {
      ctx.strokeStyle = "#00000066";
    }
    ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
  }

  for (const b of snap.buildings) {
    const alpha = b.complete ? 1 : 0.35 + 0.65 * (b.done / Math.max(1, b.needed));
    for (let iy = 0; iy < b.h; iy++) {
      for (let ix = 0; ix < b.w; ix++) {
        const kind = b.tiles[iy * b.w + ix];
        if (!kind) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = STRUCT_COLOR[kind] ?? "#888";
        ctx.fillRect((b.x + ix) * TILE_PX + 1, (b.y + iy) * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
      }
    }
    ctx.globalAlpha = 1;
    if (!b.complete) {
      ctx.fillStyle = "#e7dcc4";
      ctx.font = "10px monospace";
      ctx.fillText(`${Math.floor((b.done / b.needed) * 100)}%`, b.x * TILE_PX, b.y * TILE_PX - 2);
    } else if (b.paused) {
      ctx.fillStyle = "#c45c3e";
      ctx.font = "10px monospace";
      ctx.fillText("PAUSE", b.x * TILE_PX, b.y * TILE_PX - 2);
    }
  }

  if (ghost) {
    ctx.fillStyle = "#d4a01733";
    ctx.strokeStyle = "#d4a017";
    ctx.strokeRect(ghost.x * TILE_PX, ghost.y * TILE_PX, ghost.w * TILE_PX, ghost.h * TILE_PX);
    ctx.fillRect(ghost.x * TILE_PX, ghost.y * TILE_PX, ghost.w * TILE_PX, ghost.h * TILE_PX);
  }

  for (const worker of snap.workers) {
    const px = worker.x * TILE_PX;
    const py = worker.y * TILE_PX;
    const mine = worker.ownerId === youId;
    ctx.fillStyle = selectedWorkers.has(worker.id) ? "#fff4c2" : mine ? "#e7dcc4" : "#8a7f6a";
    ctx.fillRect(px - 4, py - 6, 8, 8);
    ctx.fillStyle = mine ? "#d4a017" : "#5c3d2e";
    ctx.fillRect(px - 3, py + 2, 6, 5);
  }

  for (const v of snap.vehicles ?? []) {
    const px = v.x * TILE_PX;
    const py = v.y * TILE_PX;
    ctx.fillStyle = v.ownerId === youId ? "#d4a017" : "#6b5344";
    ctx.fillRect(px - 7, py - 5, 14, 10);
    ctx.fillStyle = "#1c1a16";
    ctx.fillRect(px - 5, py - 2, 4, 4);
    ctx.fillRect(px + 1, py - 2, 4, 4);
  }

  for (const g of snap.circuits ?? []) {
    const px = g.x * TILE_PX + 4;
    const py = g.y * TILE_PX + 4;
    ctx.fillStyle = g.on ? "#7aa35a" : "#3a342a";
    ctx.fillRect(px, py, 12, 12);
    ctx.fillStyle = "#e7dcc4";
    ctx.font = "8px monospace";
    ctx.fillText(g.kind[0].toUpperCase(), px + 2, py + 10);
    if (g.inA) {
      const a = snap.circuits.find((x) => x.id === g.inA);
      if (a) {
        ctx.strokeStyle = g.on ? "#7aa35a" : "#8a7f6a";
        ctx.beginPath();
        ctx.moveTo(a.x * TILE_PX + 10, a.y * TILE_PX + 10);
        ctx.lineTo(g.x * TILE_PX + 10, g.y * TILE_PX + 10);
        ctx.stroke();
      }
    }
  }

  if (hover && hover.x >= 0 && hover.y >= 0 && hover.x < WORLD_TILES && hover.y < WORLD_TILES) {
    ctx.strokeStyle = "#e7dcc4";
    ctx.lineWidth = 2 / cam.zoom;
    ctx.strokeRect(hover.x * TILE_PX, hover.y * TILE_PX, TILE_PX, TILE_PX);
  }

  ctx.restore();
}

export const STRUCT_HEX = STRUCT_COLOR;
