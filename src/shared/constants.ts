export const GAME_NAME = "Claim";
export const CURRENCY = "Marks";

export const TICK_MS = 250;
export const PLOT_COUNT = 8;
export const PLOT_TILES = 16;
export const WORLD_TILES = PLOT_COUNT * PLOT_TILES;
export const TILE_PX = 20;
export const START_MARKS = 420;
export const HIRE_COST = 35;
export const MAX_WORKERS = 8;
export const DESIGNER_SIZE = 8;
export const MINE_TICKS = 14;
export const BUILD_WORK_PER_TILE = 8;
export const WORKER_SPEED = 2.4;
export const RESTOCK_EVERY_TICKS = 20;
export const SAVE_EVERY_TICKS = 40;

export const MATERIALS = ["timber", "stone", "ore", "clay", "sand"] as const;
export type Material = (typeof MATERIALS)[number];

export const DEPOT_CAP: Record<Material, number> = {
  timber: 80,
  stone: 60,
  ore: 36,
  clay: 50,
  sand: 50,
};

export const DEPOT_BASE_BUY: Record<Material, number> = {
  timber: 6,
  stone: 7,
  ore: 14,
  clay: 4,
  sand: 3,
};

export const TERRAIN = {
  grass: 0,
  water: 1,
  stone: 2,
  tree: 3,
  ore: 4,
  sand: 5,
  clay: 6,
} as const;

export type Terrain = (typeof TERRAIN)[keyof typeof TERRAIN];

export const STRUCTURE = {
  empty: 0,
  timberWall: 1,
  stoneWall: 2,
  clayFloor: 3,
  sandPath: 4,
  oreDoor: 5,
} as const;

export type StructureKind = (typeof STRUCTURE)[keyof typeof STRUCTURE];

export const STRUCTURE_MATERIAL: Record<Exclude<StructureKind, 0>, Material> = {
  [STRUCTURE.timberWall]: "timber",
  [STRUCTURE.stoneWall]: "stone",
  [STRUCTURE.clayFloor]: "clay",
  [STRUCTURE.sandPath]: "sand",
  [STRUCTURE.oreDoor]: "ore",
};

export const PALETTE = [
  { kind: STRUCTURE.timberWall, label: "Timber wall", material: "timber" as Material },
  { kind: STRUCTURE.stoneWall, label: "Stone wall", material: "stone" as Material },
  { kind: STRUCTURE.clayFloor, label: "Clay floor", material: "clay" as Material },
  { kind: STRUCTURE.sandPath, label: "Sand path", material: "sand" as Material },
  { kind: STRUCTURE.oreDoor, label: "Ore door", material: "ore" as Material },
];
