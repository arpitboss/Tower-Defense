// projectiles.js — Projectile pool, movement, and hit detection
// PERF: Direct array iteration, pre-allocated hit results array

import { POOLS } from './config.js';
import { Pool } from './spatial.js';

function makeProjectile(id) {
  return {
    id, active: false, _aidx: -1,
    x: 0, y: 0,
    tx: 0, ty: 0,
    targetId: -1,
    speed: 0,
    damage: 0,
    piercing: false,
    slow: 0,
    slowDur: 0,
    splash: 0,
    chain: 0,
    chainRange: 0,
    color: '#fff',
    towerType: 0,
  };
}

// Pre-allocated hit result object to reuse (avoids GC in hot loop)
function makeHit() {
  return {
    x: 0, y: 0, damage: 0, splash: 0,
    slow: 0, slowDur: 0, piercing: false,
    targetId: -1, chain: 0, chainRange: 0,
    towerType: 0, color: '#fff',
  };
}

export class ProjectileManager {
  constructor() {
    this.pool = new Pool(POOLS.projectiles, makeProjectile);
    // Pre-allocate hit buffer to avoid creating arrays each frame
    this._hits = [];
    this._hitPool = Array.from({ length: 200 }, makeHit);
    this._hitIdx = 0;
  }

  fire(tower, targetId, enemyPool) {
    const p = this.pool.acquire();
    if (!p) return null;

    const target = enemyPool.get(targetId);
    p.x = tower.cx;
    p.y = tower.cy;
    p.targetId = targetId;
    p.tx = target.x;
    p.ty = target.y;
    p.speed = tower.projSpeed;
    p.damage = tower.damage;
    p.piercing = tower.piercing;
    p.slow = tower.slow;
    p.slowDur = tower.slowDur;
    p.splash = tower.splash;
    p.chain = tower.chain;
    p.chainRange = tower.chainRange;
    p.color = tower.projColor;
    p.towerType = tower.type;
    return p;
  }

  update(dt, enemyPool) {
    const list = this.pool.activeList;
    const items = this.pool.items;
    this._hits.length = 0;
    this._hitIdx = 0;

    for (let i = list.length - 1; i >= 0; i--) {
      const p = items[list[i]];

      // Track living target
      if (p.targetId >= 0) {
        const target = enemyPool.get(p.targetId);
        if (target && target.active) {
          p.tx = target.x;
          p.ty = target.y;
        }
      }

      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const move = p.speed * dt;

      if (dist <= move + 4) {
        // Hit — reuse hit object from pool
        let hit;
        if (this._hitIdx < this._hitPool.length) {
          hit = this._hitPool[this._hitIdx++];
        } else {
          hit = makeHit();
          this._hitPool.push(hit);
          this._hitIdx++;
        }

        hit.x = p.tx; hit.y = p.ty;
        hit.damage = p.damage;
        hit.splash = p.splash;
        hit.slow = p.slow;
        hit.slowDur = p.slowDur;
        hit.piercing = p.piercing;
        hit.targetId = p.targetId;
        hit.chain = p.chain;
        hit.chainRange = p.chainRange;
        hit.towerType = p.towerType;
        hit.color = p.color;

        this._hits.push(hit);
        this.pool.release(p.id);
      } else {
        const inv = move / dist;
        p.x += dx * inv;
        p.y += dy * inv;
      }
    }

    return this._hits;
  }

  get count() { return this.pool.count; }
}
