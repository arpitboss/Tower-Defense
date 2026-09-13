// config.js — All game constants, entity stats, wave data, and map layout

export const GRID = { cols: 40, rows: 25, cell: 32 };
export const CANVAS_W = GRID.cols * GRID.cell;
export const CANVAS_H = GRID.rows * GRID.cell;

export const GAME = {
  startLives: 20,
  startGold: 200,
  sellRatio: 0.7,
  fixedDt: 1 / 60,
  maxDt: 0.25,
  totalWaves: 50,
};

export const POOLS = {
  enemies: 6000,
  projectiles: 2000,
  particles: 5000,
};

export const SPATIAL_CELL = 64;

// ── Tower Definitions ────────────────────────────────────────────────
// Each tower has base stats at level 0 and 3 upgrade tiers.
// `upgrades[i]` gives the TOTAL stats at level i+1 (not deltas).

export const TOWERS = [
  {
    name: 'Blaster',
    desc: 'Fast single-target',
    cost: 50,
    damage: 8,
    range: 128,
    rof: 3.0,         // rounds per second
    projSpeed: 420,
    color: '#4a9eff',
    glow: '#2a6ecf',
    projColor: '#7ab8ff',
    upgrades: [
      { cost: 40,  damage: 13,  range: 140, rof: 3.5 },
      { cost: 70,  damage: 20,  range: 155, rof: 4.2 },
      { cost: 110, damage: 32,  range: 170, rof: 5.0 },
    ],
  },
  {
    name: 'Sniper',
    desc: 'Long range, ignores armor',
    cost: 100,
    damage: 50,
    range: 260,
    rof: 0.65,
    projSpeed: 900,
    color: '#ff6b35',
    glow: '#cc4a15',
    projColor: '#ffaa75',
    piercing: true,
    upgrades: [
      { cost: 80,  damage: 80,  range: 285, rof: 0.75 },
      { cost: 130, damage: 130, range: 310, rof: 0.85 },
      { cost: 200, damage: 200, range: 340, rof: 1.0 },
    ],
  },
  {
    name: 'Frost',
    desc: 'Area slow + damage',
    cost: 75,
    damage: 5,
    range: 115,
    rof: 1.8,
    projSpeed: 280,
    color: '#00d4ff',
    glow: '#009acc',
    projColor: '#80e8ff',
    slow: 0.45,
    slowDur: 2.0,
    splash: 55,
    upgrades: [
      { cost: 55,  damage: 8,   range: 125, rof: 2.0, slow: 0.5,  splash: 60 },
      { cost: 90,  damage: 13,  range: 138, rof: 2.3, slow: 0.58, splash: 68 },
      { cost: 140, damage: 20,  range: 150, rof: 2.6, slow: 0.68, splash: 78 },
    ],
  },
  {
    name: 'Cannon',
    desc: 'Heavy splash damage',
    cost: 125,
    damage: 35,
    range: 135,
    rof: 0.9,
    projSpeed: 320,
    color: '#ff4757',
    glow: '#cc2737',
    projColor: '#ff8a94',
    splash: 48,
    upgrades: [
      { cost: 85,  damage: 55,  range: 145, rof: 1.0, splash: 55 },
      { cost: 140, damage: 85,  range: 158, rof: 1.1, splash: 64 },
      { cost: 210, damage: 135, range: 172, rof: 1.2, splash: 75 },
    ],
  },
  {
    name: 'Tesla',
    desc: 'Chain lightning, multi-hit',
    cost: 200,
    damage: 18,
    range: 95,
    rof: 2.2,
    color: '#a855f7',
    glow: '#7c3aed',
    projColor: '#c084fc',
    chain: 3,
    chainRange: 65,
    upgrades: [
      { cost: 130, damage: 28,  range: 105, rof: 2.5, chain: 4, chainRange: 72 },
      { cost: 190, damage: 42,  range: 118, rof: 2.8, chain: 5, chainRange: 80 },
      { cost: 280, damage: 65,  range: 130, rof: 3.2, chain: 7, chainRange: 90 },
    ],
  },
];

// ── Enemy Definitions ────────────────────────────────────────────────

export const ENEMIES = [
  { name: 'Scout',   hp: 30,  speed: 82,  armor: 0, reward: 5,  color: '#ff6b6b', radius: 6  },
  { name: 'Soldier', hp: 85,  speed: 48,  armor: 2, reward: 10, color: '#ee5a24', radius: 8  },
  { name: 'Tank',    hp: 320, speed: 28,  armor: 8, reward: 25, color: '#c0392b', radius: 12 },
  { name: 'Healer',  hp: 55,  speed: 44,  armor: 0, reward: 20, color: '#2ecc71', radius: 8,
    healRate: 6, healRange: 64 },
  { name: 'Flyer',   hp: 65,  speed: 72,  armor: 0, reward: 15, color: '#9b59b6', radius: 7,
    flying: true },
];

// ── Map Path ─────────────────────────────────────────────────────────
// Waypoints as [col, row] in grid coordinates.
// Path forms a winding S-curve across the 40×25 grid.

export const PATH_WAYPOINTS = [
  [0, 2], [14, 2], [14, 8], [3, 8], [3, 14],
  [18, 14], [18, 8], [30, 8], [30, 14], [24, 14],
  [24, 22], [39, 22],
];

// Build pixel-space path data from grid waypoints
export function buildPathData() {
  const c = GRID.cell;
  const pts = PATH_WAYPOINTS.map(([col, row]) => ({
    x: col * c + c / 2,
    y: row * c + c / 2,
  }));

  const segs = [];
  const cumLen = [0];

  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    segs.push({ dx: dx / len, dy: dy / len, len });
    cumLen.push(cumLen[i] + len);
  }

  return { pts, segs, cumLen, totalLen: cumLen[cumLen.length - 1] };
}

// Mark grid cells that lie on the path as unbuildable
export function buildPathCellSet() {
  const blocked = new Set();
  const wp = PATH_WAYPOINTS;

  for (let i = 0; i < wp.length - 1; i++) {
    const [c1, r1] = wp[i];
    const [c2, r2] = wp[i + 1];

    if (c1 === c2) {
      const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
      for (let r = lo; r <= hi; r++) blocked.add(r * GRID.cols + c1);
    } else {
      const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
      for (let c = lo; c <= hi; c++) blocked.add(r1 * GRID.cols + c);
    }
  }

  return blocked;
}

// ── Wave Generation ──────────────────────────────────────────────────
// Procedurally generates 50 waves with escalating difficulty.

export function generateWaves() {
  const out = [];
  for (let n = 1; n <= GAME.totalWaves; n++) out.push(makeWave(n));
  return out;
}

function makeWave(n) {
  const hpMul = Math.pow(1.082, n - 1);
  const spdMul = 1 + Math.min(n * 0.006, 0.35);
  const g = [];

  // Scouts: always present
  push(g, 0, 5 + n * 2.2, interp(0.85, 0.1, n / 50));

  // Soldiers: wave 4+
  if (n >= 4) push(g, 1, 2 + (n - 3) * 1.6, interp(1.0, 0.18, n / 50));

  // Tanks: wave 8+
  if (n >= 8) push(g, 2, 1 + (n - 7) * 0.55, interp(2.2, 0.45, n / 50));

  // Healers: wave 14+
  if (n >= 14) push(g, 3, 1 + (n - 13) * 0.38, interp(2.8, 0.6, n / 50));

  // Flyers: wave 20+
  if (n >= 20) push(g, 4, 1 + (n - 19) * 0.48, interp(1.6, 0.28, n / 50));

  // Wave 50 boss burst: extra tanks and healers
  if (n === 50) {
    push(g, 2, 15, 0.4);
    push(g, 3, 8, 0.6);
  }

  return { num: n, groups: g, hpMul, spdMul };
}

function push(arr, type, count, interval) {
  const c = Math.max(1, Math.floor(count));
  arr.push({ type, count: c, interval: Math.max(0.08, interval) });
}

function interp(a, b, t) {
  return a + (b - a) * Math.min(t, 1);
}

// ── Helpers ──────────────────────────────────────────────────────────

// Resolve tower stats at a given upgrade level (0 = base)
export function towerStats(typeIdx, level) {
  const base = TOWERS[typeIdx];
  if (level === 0) return base;
  const upg = base.upgrades[level - 1];
  return { ...base, ...upg };
}

// Total gold invested in a tower at a given level
export function towerTotalCost(typeIdx, level) {
  const base = TOWERS[typeIdx];
  let total = base.cost;
  for (let i = 0; i < level; i++) total += base.upgrades[i].cost;
  return total;
}
