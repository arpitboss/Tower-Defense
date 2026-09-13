// towers.js — Tower management, upgrades, selling, and target acquisition
// PERF: Target-stickiness prevents redundant spatial queries every frame.

import { TOWERS, GRID, GAME, towerStats, towerTotalCost } from './config.js';

export class TowerManager {
  constructor() {
    this.towers = [];        // active tower instances
    this.grid = new Map();   // flat cell index -> tower instance
    this.nextId = 0;
  }

  place(typeIdx, col, row) {
    const def = TOWERS[typeIdx];
    const c = GRID.cell;
    const tower = {
      id: this.nextId++,
      type: typeIdx,
      col, row,
      cx: col * c + c * 0.5,
      cy: row * c + c * 0.5,
      level: 0,
      damage: def.damage,
      range: def.range,
      rof: def.rof,
      cooldown: 0,
      targetId: -1,
      angle: 0,
      totalCost: def.cost,
      piercing: !!def.piercing,
      slow: def.slow || 0,
      slowDur: def.slowDur || 0,
      splash: def.splash || 0,
      chain: def.chain || 0,
      chainRange: def.chainRange || 0,
      projSpeed: def.projSpeed || 0,
      projColor: def.projColor || '#fff',
    };

    this.towers.push(tower);
    this.grid.set(row * GRID.cols + col, tower);
    return tower;
  }

  upgrade(tower) {
    const def = TOWERS[tower.type];
    if (tower.level >= def.upgrades.length) return false;

    const upg = def.upgrades[tower.level];
    tower.level++;
    tower.totalCost += upg.cost;

    const stats = towerStats(tower.type, tower.level);
    tower.damage = stats.damage;
    tower.range = stats.range;
    tower.rof = stats.rof;
    if (stats.slow != null) tower.slow = stats.slow;
    if (stats.splash != null) tower.splash = stats.splash;
    if (stats.chain != null) tower.chain = stats.chain;
    if (stats.chainRange != null) tower.chainRange = stats.chainRange;
    return true;
  }

  sell(tower) {
    const refund = Math.floor(tower.totalCost * GAME.sellRatio);
    this.removeTower(tower);
    return refund;
  }

  removeTower(tower) {
    const key = tower.row * GRID.cols + tower.col;
    this.grid.delete(key);
    const idx = this.towers.indexOf(tower);
    if (idx !== -1) {
      this.towers[idx] = this.towers[this.towers.length - 1];
      this.towers.pop();
    }
  }

  hasTowerAt(col, row) {
    return this.grid.has(row * GRID.cols + col);
  }

  getTowerAt(col, row) {
    return this.grid.get(row * GRID.cols + col) || null;
  }

  // Update cooldowns and acquire targets.
  // Returns array of fire actions: [{ tower, targetId }]
  update(dt, spatialHash, enemyPool) {
    const commands = [];
    const towers = this.towers;
    const count = towers.length;
    const enemyItems = enemyPool.items;

    for (let i = 0; i < count; i++) {
      const t = towers[i];
      t.cooldown -= dt;
      const rangeSq = t.range * t.range;

      // 1. Target Stickiness: If current target is still alive and in range, maintain lock
      if (t.targetId >= 0) {
        const curr = enemyItems[t.targetId];
        if (curr && curr.active) {
          const dx = curr.x - t.cx;
          const dy = curr.y - t.cy;
          if (dx * dx + dy * dy <= rangeSq) {
            t.angle = Math.atan2(dy, dx);
            if (t.cooldown <= 0) {
              t.cooldown = 1 / t.rof;
              commands.push({ tower: t, targetId: t.targetId });
            }
            continue; // No spatial query needed!
          }
        }
        t.targetId = -1;
      }

      // 2. Query spatial hash for best target only when ready or almost ready
      if (t.cooldown <= dt * 2) {
        const bestId = spatialHash.findBestTarget(t.cx, t.cy, t.range, enemyPool);
        t.targetId = bestId;

        if (bestId >= 0) {
          const e = enemyItems[bestId];
          t.angle = Math.atan2(e.y - t.cy, e.x - t.cx);
          if (t.cooldown <= 0) {
            t.cooldown = 1 / t.rof;
            commands.push({ tower: t, targetId: bestId });
          }
        }
      }
    }

    return commands;
  }

  get count() {
    return this.towers.length;
  }
}
