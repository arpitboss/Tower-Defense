// enemies.js — Enemy pooling, path progression, and status updates
// PERF: Dedicated type buckets with O(1) swap-remove for batch-draw rendering.

import { ENEMIES, POOLS } from './config.js';
import { Pool } from './spatial.js';

function makeEnemy(id) {
  return {
    id, active: false, _aidx: -1, _tidx: -1,
    type: 0,
    x: 0, y: 0,
    hp: 0, maxHp: 0,
    speed: 0, baseSpeed: 0,
    armor: 0,
    reward: 0,
    dist: 0,
    segIdx: 0,
    slowTimer: 0,
    slowFactor: 1,
    flying: false,
    healRate: 0,
    healRange: 0,
    healCooldown: 0,
    color: '#fff',
    radius: 6,
    flashTimer: 0,
    boss: false,
    auraRange: 0,
    auraSlow: 0,
    auraTimer: 0,
  };
}

export class EnemyManager {
  constructor() {
    this.pool = new Pool(POOLS.enemies, makeEnemy);
    // Categorized ID buckets for instant batched draw calls without iteration filtering
    this.typeBuckets = [[], [], [], [], [], []];
  }

  spawn(typeIdx, pathData, hpMul, spdMul) {
    const e = this.pool.acquire();
    if (!e) return null;

    const def = ENEMIES[typeIdx];
    e.type = typeIdx;
    e.x = pathData.pts[0].x;
    e.y = pathData.pts[0].y;
    e.hp = def.hp * hpMul;
    e.maxHp = e.hp;
    e.baseSpeed = def.speed * spdMul;
    e.speed = e.baseSpeed;
    e.armor = def.armor;
    e.reward = def.reward;
    e.dist = 0;
    e.segIdx = 0;
    e.slowTimer = 0;
    e.slowFactor = 1;
    e.flying = !!def.flying;
    e.healRate = def.healRate || 0;
    e.healRange = def.healRange || 0;
    e.healCooldown = Math.random() * 0.5;
    e.color = def.color;
    e.radius = def.radius;
    e.flashTimer = 0;
    e.boss = !!def.boss;
    e.auraRange = def.auraRange || 0;
    e.auraSlow = def.auraSlow || 0;
    e.auraTimer = 0;

    // Track in type bucket
    const bucket = this.typeBuckets[typeIdx];
    e._tidx = bucket.length;
    bucket.push(e.id);

    return e;
  }

  _releaseEnemy(e) {
    if (!e || !e.active) return;

    // Swap-remove from type bucket
    const bucket = this.typeBuckets[e.type];
    const tidx = e._tidx;
    const last = bucket.length - 1;
    if (tidx !== last && last >= 0) {
      const swapId = bucket[last];
      bucket[tidx] = swapId;
      this.pool.items[swapId]._tidx = tidx;
    }
    bucket.pop();

    this.pool.release(e.id);
  }

  // Update enemy positions along the pre-calculated path
  update(dt, pathData) {
    const list = this.pool.activeList;
    const items = this.pool.items;
    const segs = pathData.segs;
    const cumLen = pathData.cumLen;
    const pts = pathData.pts;
    const segCount = segs.length;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = items[list[i]];

      // Slow status decay
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        e.speed = e.slowTimer > 0
          ? e.baseSpeed * (1 - e.slowFactor)
          : e.baseSpeed;
        if (e.slowTimer <= 0) {
          e.slowTimer = 0;
          e.slowFactor = 1;
        }
      }

      // Hit flash visual decay
      if (e.flashTimer > 0) e.flashTimer -= dt;

      // Distance advancement
      e.dist += e.speed * dt;

      // Advance waypoint segments
      while (e.segIdx < segCount - 1 && e.dist >= cumLen[e.segIdx + 1]) {
        e.segIdx++;
      }
      if (e.segIdx >= segCount) {
        e.dist = cumLen[segCount];
        e.segIdx = segCount - 1;
      }

      // Interpolate coordinates on segment
      const segStart = cumLen[e.segIdx];
      const seg = segs[e.segIdx];
      const t = Math.min((e.dist - segStart) / seg.len, 1);
      const p0 = pts[e.segIdx];
      const p1 = pts[e.segIdx + 1];
      e.x = p0.x + (p1.x - p0.x) * t;
      e.y = p0.y + (p1.y - p0.y) * t;
    }
  }

  // Pulse heal nearby damaged allies (throttled to 2x/sec per healer)
  applyHealers(dt, spatialHash) {
    const healerBucket = this.typeBuckets[3];
    const items = this.pool.items;
    const count = healerBucket.length;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const healer = items[healerBucket[i]];
      if (!healer.active || healer.healRate <= 0) continue;

      healer.healCooldown -= dt;
      if (healer.healCooldown > 0) continue;
      healer.healCooldown = 1.0;
      const amount = healer.healRate * 1.0;
      const range = healer.healRange;
      const rangeSq = range * range;
      const hx = healer.x, hy = healer.y;
      const hid = healer.id;

      const inv = spatialHash.invCell;
      const cMin = Math.max(0, ((hx - range) * inv) | 0);
      const cMax = Math.min(spatialHash.cols - 1, ((hx + range) * inv) | 0);
      const rMin = Math.max(0, ((hy - range) * inv) | 0);
      const rMax = Math.min(spatialHash.rows - 1, ((hy + range) * inv) | 0);

      for (let r = rMin; r <= rMax; r++) {
        const rowOff = r * spatialHash.cols;
        for (let c = cMin; c <= cMax; c++) {
          let eid = spatialHash.cellHead[rowOff + c];
          while (eid !== -1) {
            if (eid !== hid) {
              const target = items[eid];
              if (target.active && target.hp < target.maxHp) {
                const dx = target.x - hx;
                const dy = target.y - hy;
                if (dx * dx + dy * dy <= rangeSq) {
                  target.hp = Math.min(target.hp + amount, target.maxHp);
                }
              }
            }
            eid = spatialHash.entityNext[eid];
          }
        }
      }
    }
  }

  collectLeaked(pathData, loopMode = false) {
    const leaked = [];
    const list = this.pool.activeList;
    const items = this.pool.items;
    const pts = pathData.pts;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = items[list[i]];
      if (e.dist >= pathData.totalLen) {
        leaked.push(e.type);
        if (loopMode) {
          // Wrap back to beginning for continuous stress testing load
          e.dist = 0;
          e.segIdx = 0;
          e.x = pts[0].x;
          e.y = pts[0].y;
        } else {
          this._releaseEnemy(e);
        }
      }
    }
    return leaked;
  }

  kill(id) {
    const e = this.pool.items[id];
    if (e && e.active) {
      this._releaseEnemy(e);
    }
  }

  get count() {
    return this.pool.count;
  }
}
