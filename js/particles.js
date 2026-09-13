// particles.js — Visual-only particle system
// PERF: Direct array iteration, reduced particle counts at high entity counts

import { POOLS } from './config.js';
import { Pool } from './spatial.js';

function makeParticle(id) {
  return {
    id, active: false, _aidx: -1,
    x: 0, y: 0,
    vx: 0, vy: 0,
    life: 0, maxLife: 0,
    radius: 2,
    color: '#fff',
    alpha: 1,
    shrink: true,
  };
}

export class ParticleManager {
  constructor() {
    this.pool = new Pool(POOLS.particles, makeParticle);
  }

  burst(x, y, color, count, opts = {}) {
    const speed = opts.speed || 80;
    const life = opts.life || 0.4;
    const radius = opts.radius || 2.5;

    // PERF: Reduce particle count when pool is getting full
    const budget = Math.min(count, this.pool.freeStack.length);

    for (let i = 0; i < budget; i++) {
      const p = this.pool.acquire();
      if (!p) break;
      const angle = Math.random() * Math.PI * 2;
      const spd = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * spd;
      p.vy = Math.sin(angle) * spd;
      p.life = life * (0.6 + Math.random() * 0.4);
      p.maxLife = p.life;
      p.radius = radius * (0.5 + Math.random() * 0.5);
      p.color = color;
      p.alpha = 1;
      p.shrink = opts.shrink !== false;
    }
  }

  ring(x, y, color, radius) {
    const count = Math.min(10, Math.floor(radius / 5), this.pool.freeStack.length);
    for (let i = 0; i < count; i++) {
      const p = this.pool.acquire();
      if (!p) break;
      const angle = (i / count) * Math.PI * 2;
      p.x = x + Math.cos(angle) * radius * 0.3;
      p.y = y + Math.sin(angle) * radius * 0.3;
      p.vx = Math.cos(angle) * radius * 1.5;
      p.vy = Math.sin(angle) * radius * 1.5;
      p.life = 0.3;
      p.maxLife = 0.3;
      p.radius = 3;
      p.color = color;
      p.alpha = 0.8;
      p.shrink = true;
    }
  }

  update(dt) {
    const list = this.pool.activeList;
    const items = this.pool.items;

    for (let i = list.length - 1; i >= 0; i--) {
      const p = items[list[i]];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;

      const t = p.life / p.maxLife;
      p.alpha = t > 0 ? t : 0;
      if (p.shrink) p.radius *= 0.98;

      if (p.life <= 0) {
        this.pool.release(p.id);
      }
    }
  }

  get count() { return this.pool.count; }
}
