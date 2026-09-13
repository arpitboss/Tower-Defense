// spatial.js — High-performance spatial hash grid and object pool
// Zero-allocation static linked list spatial hash for cache-friendly entity queries.

import { SPATIAL_CELL, CANVAS_W, CANVAS_H, POOLS } from './config.js';

export class SpatialHash {
  constructor(cellSize = SPATIAL_CELL, w = CANVAS_W, h = CANVAS_H, maxEntities = POOLS.enemies + 500) {
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
    this.cols = Math.ceil(w / cellSize);
    this.rows = Math.ceil(h / cellSize);
    this.cellCount = this.cols * this.rows;

    // Static bucket linked list:
    // cellHead stores the first entity id in each cell (-1 = empty)
    // entityNext stores the next entity id in the same cell (-1 = end of list)
    this.cellHead = new Int32Array(this.cellCount);
    this.cellHead.fill(-1);
    this.entityNext = new Int32Array(maxEntities);
    this.entityNext.fill(-1);

    // Reusable buffer for query results to avoid GC in hot paths
    this._queryBuf = [];
  }

  clear() {
    this.cellHead.fill(-1);
  }

  insert(id, x, y) {
    const c = (x * this.invCell) | 0;
    const r = (y * this.invCell) | 0;
    if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
      const cell = r * this.cols + c;
      this.entityNext[id] = this.cellHead[cell];
      this.cellHead[cell] = id;
    }
  }

  // Find the single best target for a tower: furthest along the path (highest dist) within range
  findBestTarget(cx, cy, range, enemyPool) {
    const inv = this.invCell;
    const rangeSq = range * range;
    const cMin = Math.max(0, ((cx - range) * inv) | 0);
    const cMax = Math.min(this.cols - 1, ((cx + range) * inv) | 0);
    const rMin = Math.max(0, ((cy - range) * inv) | 0);
    const rMax = Math.min(this.rows - 1, ((cy + range) * inv) | 0);

    let bestId = -1;
    let bestDist = -1;
    const items = enemyPool.items;

    for (let r = rMin; r <= rMax; r++) {
      const rowOff = r * this.cols;
      for (let c = cMin; c <= cMax; c++) {
        let eid = this.cellHead[rowOff + c];
        while (eid !== -1) {
          const e = items[eid];
          if (e.active) {
            const dx = e.x - cx;
            const dy = e.y - cy;
            if (dx * dx + dy * dy <= rangeSq && e.dist > bestDist) {
              bestDist = e.dist;
              bestId = eid;
            }
          }
          eid = this.entityNext[eid];
        }
      }
    }
    return bestId;
  }

  // Find closest enemy for chain lightning jumps
  findClosest(cx, cy, maxRange, excludeSet, enemyPool) {
    const inv = this.invCell;
    let bestDistSq = maxRange * maxRange;
    let bestId = -1;
    const cMin = Math.max(0, ((cx - maxRange) * inv) | 0);
    const cMax = Math.min(this.cols - 1, ((cx + maxRange) * inv) | 0);
    const rMin = Math.max(0, ((cy - maxRange) * inv) | 0);
    const rMax = Math.min(this.rows - 1, ((cy + maxRange) * inv) | 0);
    const items = enemyPool.items;

    for (let r = rMin; r <= rMax; r++) {
      const rowOff = r * this.cols;
      for (let c = cMin; c <= cMax; c++) {
        let eid = this.cellHead[rowOff + c];
        while (eid !== -1) {
          if (!excludeSet.has(eid)) {
            const e = items[eid];
            if (e.active) {
              const dx = e.x - cx;
              const dy = e.y - cy;
              const dsq = dx * dx + dy * dy;
              if (dsq < bestDistSq) {
                bestDistSq = dsq;
                bestId = eid;
              }
            }
          }
          eid = this.entityNext[eid];
        }
      }
    }
    return bestId;
  }

  // Direct query filling a reusable array buffer
  queryRadius(cx, cy, radius, out = this._queryBuf) {
    out.length = 0;
    const inv = this.invCell;
    const cMin = Math.max(0, ((cx - radius) * inv) | 0);
    const cMax = Math.min(this.cols - 1, ((cx + radius) * inv) | 0);
    const rMin = Math.max(0, ((cy - radius) * inv) | 0);
    const rMax = Math.min(this.rows - 1, ((cy + radius) * inv) | 0);

    for (let r = rMin; r <= rMax; r++) {
      const rowOff = r * this.cols;
      for (let c = cMin; c <= cMax; c++) {
        let eid = this.cellHead[rowOff + c];
        while (eid !== -1) {
          out.push(eid);
          eid = this.entityNext[eid];
        }
      }
    }
    return out;
  }
}

// Fixed-capacity generic object pool with LIFO free-stack and dense active-list
export class Pool {
  constructor(size, factory) {
    this.items = new Array(size);
    this.freeStack = new Int32Array(size);
    this.freeTop = size;
    this.activeList = [];
    this.count = 0;

    for (let i = 0; i < size; i++) {
      const obj = factory(i);
      obj.id = i;
      obj.active = false;
      obj._aidx = -1;
      this.items[i] = obj;
      this.freeStack[i] = size - 1 - i;
    }
  }

  acquire() {
    if (this.freeTop <= 0) return null;
    const id = this.freeStack[--this.freeTop];
    const obj = this.items[id];
    obj.active = true;
    obj._aidx = this.activeList.length;
    this.activeList.push(id);
    this.count++;
    return obj;
  }

  release(id) {
    const obj = this.items[id];
    if (!obj || !obj.active) return;
    obj.active = false;
    this.freeStack[this.freeTop++] = id;

    // Swap-remove from activeList: O(1)
    const idx = obj._aidx;
    const last = this.activeList.length - 1;
    if (idx !== last) {
      const swapId = this.activeList[last];
      this.activeList[idx] = swapId;
      this.items[swapId]._aidx = idx;
    }
    this.activeList.pop();
    this.count--;
  }

  get(id) {
    return this.items[id] || null;
  }

  forEach(fn) {
    const list = this.activeList;
    const items = this.items;
    for (let i = list.length - 1; i >= 0; i--) {
      fn(items[list[i]]);
    }
  }
}
