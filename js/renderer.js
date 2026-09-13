// renderer.js — Ultra-fast batched Canvas2D pipeline
// PERF: Two-pass line glows (zero Gaussian blur), batched towers & enemies, quad-buffer efficiency.

import { GRID, CANVAS_W, CANVAS_H, TOWERS, ENEMIES, PATH_WAYPOINTS } from './config.js';

const TAU = Math.PI * 2;
const HALF_CELL = GRID.cell * 0.5;

export class Renderer {
  constructor(bgCanvas, gameCanvas) {
    this.bgCtx = bgCanvas.getContext('2d');
    this.ctx = gameCanvas.getContext('2d', { alpha: true });

    bgCanvas.width = gameCanvas.width = CANVAS_W;
    bgCanvas.height = gameCanvas.height = CANVAS_H;

    this.bgDirty = true;
  }

  // ── Background (Cached permanently on bgCanvas) ────────────────────
  drawBackground(pathCells) {
    if (!this.bgDirty) return;
    this.bgDirty = false;

    const ctx = this.bgCtx;
    const c = GRID.cell;

    // Deep sci-fi backdrop
    const grad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    grad.addColorStop(0, '#090d16');
    grad.addColorStop(1, '#05070d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const pts = PATH_WAYPOINTS.map(([col, row]) => [col * c + HALF_CELL, row * c + HALF_CELL]);

    // Outer conduit glow
    ctx.strokeStyle = 'rgba(26, 68, 114, 0.45)';
    ctx.lineWidth = c * 1.65;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();

    // Trench track bed
    ctx.strokeStyle = '#121e2c';
    ctx.lineWidth = c * 1.25;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();

    // Centerline pulse
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 12]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Grid coordinates
    ctx.strokeStyle = 'rgba(70, 110, 160, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= CANVAS_W; x += c) {
      ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H);
    }
    for (let y = 0; y <= CANVAS_H; y += c) {
      ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y);
    }
    ctx.stroke();

    // Spawn Portal
    const spX = pts[0][0], spY = pts[0][1];
    const spGrad = ctx.createRadialGradient(spX, spY, 2, spX, spY, 22);
    spGrad.addColorStop(0, '#2ecc71');
    spGrad.addColorStop(0.6, 'rgba(46, 204, 113, 0.3)');
    spGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = spGrad;
    ctx.beginPath();
    ctx.arc(spX, spY, 22, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#2ecc71';
    ctx.font = 'bold 11px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('INVASION PORTAL', spX + 24, spY - 20);

    // Defense Core Base
    const bsX = pts[pts.length - 1][0], bsY = pts[pts.length - 1][1];
    const bsGrad = ctx.createRadialGradient(bsX, bsY, 2, bsX, bsY, 24);
    bsGrad.addColorStop(0, '#ff4757');
    bsGrad.addColorStop(0.6, 'rgba(255, 71, 87, 0.35)');
    bsGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = bsGrad;
    ctx.beginPath();
    ctx.arc(bsX, bsY, 24, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#ff4757';
    ctx.fillText('CORE PROTOCOL', bsX - 24, bsY - 20);

    ctx.textAlign = 'start';
  }

  // ── Game Frame ─────────────────────────────────────────────────────
  drawFrame(state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    this.drawPlacementGhost(ctx, state);
    this.drawTowers(ctx, state.towers);
    this.drawRangeCircle(ctx, state);
    this.drawEnemies(ctx, state.enemies);
    this.drawProjectiles(ctx, state.projectiles);
    this.drawTeslaArcs(ctx, state.teslaArcs);
    this.drawParticles(ctx, state.particles);
    this.drawWaveAnnounce(ctx, state);
  }

  // ── Towers (Batched into 7 draw calls total) ───────────────────────
  drawTowers(ctx, towerMgr) {
    const towers = towerMgr.towers;
    const len = towers.length;
    if (len === 0) return;
    const r = HALF_CELL * 0.72;

    // Pass 1: Pedestal bases
    ctx.fillStyle = '#172033';
    ctx.strokeStyle = '#2a4365';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const t = towers[i];
      ctx.rect((t.cx - r) | 0, (t.cy - r) | 0, (r * 2) | 0, (r * 2) | 0);
    }
    ctx.fill();
    ctx.stroke();

    // Pass 2: Colored cores batched by tower type
    for (let type = 0; type < TOWERS.length; type++) {
      ctx.fillStyle = TOWERS[type].color;
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < len; i++) {
        if (towers[i].type === type) {
          any = true;
          ctx.rect((towers[i].cx - 4) | 0, (towers[i].cy - 4) | 0, 8, 8);
        }
      }
      if (any) ctx.fill();
    }

    // Pass 3: Barrels in ONE stroke path
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const t = towers[i];
      const barrelLen = r + 4;
      ctx.moveTo(t.cx, t.cy);
      ctx.lineTo(t.cx + Math.cos(t.angle) * barrelLen, t.cy + Math.sin(t.angle) * barrelLen);
    }
    ctx.stroke();
  }

  // ── Enemies (Ultra-fast Path-batched drawing) ───────────────────────
  drawEnemies(ctx, enemyMgr) {
    const buckets = enemyMgr.typeBuckets;
    const items = enemyMgr.pool.items;
    const activeList = enemyMgr.pool.activeList;
    const activeLen = activeList.length;
    if (activeLen === 0) return;

    // Type 0: Scout (8x8 Speed Diamond)
    const b0 = buckets[0];
    if (b0.length > 0) {
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      for (let i = 0; i < b0.length; i++) {
        const e = items[b0[i]];
        const x = e.x | 0, y = e.y | 0;
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
      }
      ctx.fill();
    }

    // Type 1: Soldier (12x12 Armored Rect)
    const b1 = buckets[1];
    if (b1.length > 0) {
      ctx.fillStyle = '#ee5a24';
      ctx.beginPath();
      for (let i = 0; i < b1.length; i++) {
        const e = items[b1[i]];
        ctx.rect((e.x - 6) | 0, (e.y - 6) | 0, 12, 12);
      }
      ctx.fill();
    }

    // Type 2: Tank (18x18 Heavy Armored Octagonal Block)
    const b2 = buckets[2];
    if (b2.length > 0) {
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      for (let i = 0; i < b2.length; i++) {
        const e = items[b2[i]];
        ctx.rect((e.x - 9) | 0, (e.y - 9) | 0, 18, 18);
      }
      ctx.fill();

      ctx.fillStyle = '#5c1010';
      ctx.beginPath();
      for (let i = 0; i < b2.length; i++) {
        const e = items[b2[i]];
        ctx.rect((e.x - 4) | 0, (e.y - 4) | 0, 8, 8);
      }
      ctx.fill();
    }

    // Type 3: Healer (12x12 Emerald Block with Cross)
    const b3 = buckets[3];
    if (b3.length > 0) {
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      for (let i = 0; i < b3.length; i++) {
        const e = items[b3[i]];
        ctx.rect((e.x - 6) | 0, (e.y - 6) | 0, 12, 12);
      }
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (let i = 0; i < b3.length; i++) {
        const e = items[b3[i]];
        ctx.rect((e.x - 1) | 0, (e.y - 4) | 0, 2, 8);
        ctx.rect((e.x - 4) | 0, (e.y - 1) | 0, 8, 2);
      }
      ctx.fill();
    }

    // Type 4: Flyer (10x10 Stealth Delta Chevron)
    const b4 = buckets[4];
    if (b4.length > 0) {
      ctx.fillStyle = '#9b59b6';
      ctx.beginPath();
      for (let i = 0; i < b4.length; i++) {
        const e = items[b4[i]];
        const x = e.x | 0, y = e.y | 0;
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y + 4);
        ctx.lineTo(x, y + 1);
        ctx.lineTo(x - 6, y + 4);
      }
      ctx.fill();
    }

    // Hit Flash (Damaged units only, budgeted to 80 units max)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    let anyFlash = false;
    let flashBudget = 80;
    for (let i = 0; i < activeLen && flashBudget > 0; i++) {
      const e = items[activeList[i]];
      if (e.flashTimer > 0) {
        anyFlash = true;
        flashBudget--;
        ctx.rect((e.x - e.radius) | 0, (e.y - e.radius) | 0, e.radius * 2, e.radius * 2);
      }
    }
    if (anyFlash) ctx.fill();

    // Health Bars (Wounded units ONLY — Batched into 3 draw calls via pre-buffered list)
    const maxBarBudget = activeLen > 500 ? 150 : activeLen;
    if (!this._wounded) this._wounded = [];
    this._wounded.length = 0;
    for (let i = 0; i < activeLen && this._wounded.length < maxBarBudget; i++) {
      const e = items[activeList[i]];
      if (e.hp < e.maxHp) {
        this._wounded.push(e);
      }
    }

    const woundedCount = this._wounded.length;
    if (woundedCount > 0) {
      // 1. Backgrounds
      ctx.fillStyle = 'rgba(10, 15, 25, 0.88)';
      ctx.beginPath();
      for (let i = 0; i < woundedCount; i++) {
        const e = this._wounded[i];
        ctx.rect((e.x - e.radius) | 0, (e.y - e.radius - 5) | 0, e.radius * 2, 2.5);
      }
      ctx.fill();

      // 2. Green Bar (> 50% HP)
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      for (let i = 0; i < woundedCount; i++) {
        const e = this._wounded[i];
        const pct = e.hp / e.maxHp;
        if (pct > 0.5) {
          ctx.rect((e.x - e.radius) | 0, (e.y - e.radius - 5) | 0, (e.radius * 2 * pct) | 0, 2.5);
        }
      }
      ctx.fill();

      // 3. Red / Amber Bar (<= 50% HP)
      ctx.fillStyle = '#ff4757';
      ctx.beginPath();
      for (let i = 0; i < woundedCount; i++) {
        const e = this._wounded[i];
        const pct = e.hp / e.maxHp;
        if (pct <= 0.5 && pct > 0) {
          ctx.rect((e.x - e.radius) | 0, (e.y - e.radius - 5) | 0, Math.max(1, (e.radius * 2 * pct) | 0), 2.5);
        }
      }
      ctx.fill();
    }
  }

  // ── Projectiles (Batched into 1 draw call) ──────────────────────────
  drawProjectiles(ctx, projMgr) {
    const list = projMgr.pool.activeList;
    const items = projMgr.pool.items;
    const len = list.length;
    if (len === 0) return;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const p = items[list[i]];
      ctx.rect((p.x - 2) | 0, (p.y - 2) | 0, 4, 4);
    }
    ctx.fill();
  }

  // ── Tesla Lightning Arcs (Zero Gaussian blur — two-pass line glow) ──
  drawTeslaArcs(ctx, arcs) {
    if (!arcs || arcs.length === 0) return;

    // Pass 1: Translucent purple glow line
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.45)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < arcs.length; i++) {
      const arc = arcs[i];
      const mx = (arc.x1 + arc.x2) * 0.5 + (Math.random() - 0.5) * 14;
      const my = (arc.y1 + arc.y2) * 0.5 + (Math.random() - 0.5) * 14;
      ctx.moveTo(arc.x1, arc.y1);
      ctx.lineTo(mx, my);
      ctx.lineTo(arc.x2, arc.y2);
    }
    ctx.stroke();

    // Pass 2: Sharp white electrical core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ── Particles (Batched into 1 draw call) ────────────────────────────
  drawParticles(ctx, particleMgr) {
    const list = particleMgr.pool.activeList;
    const items = particleMgr.pool.items;
    const len = list.length;
    if (len === 0) return;

    ctx.fillStyle = '#ffaa44';
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const p = items[list[i]];
      ctx.rect((p.x - 1.5) | 0, (p.y - 1.5) | 0, 3, 3);
    }
    ctx.fill();
  }

  // ── Placement Hologram Ghost ───────────────────────────────────────
  drawPlacementGhost(ctx, state) {
    if (state.placingType < 0 || state.mouseCol < 0) return;

    const def = TOWERS[state.placingType];
    const c = GRID.cell;
    const cx = state.mouseCol * c + HALF_CELL;
    const cy = state.mouseRow * c + HALF_CELL;
    const ok = state.canPlaceHere;

    ctx.fillStyle = ok ? 'rgba(74, 158, 255, 0.08)' : 'rgba(255, 71, 87, 0.08)';
    ctx.strokeStyle = ok ? '#4a9eff' : '#ff4757';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, def.range, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = ok ? 'rgba(74, 158, 255, 0.35)' : 'rgba(255, 71, 87, 0.35)';
    ctx.fillRect(state.mouseCol * c + 2, state.mouseRow * c + 2, c - 4, c - 4);
    ctx.strokeStyle = ok ? '#4a9eff' : '#ff4757';
    ctx.lineWidth = 2;
    ctx.strokeRect(state.mouseCol * c + 2, state.mouseRow * c + 2, c - 4, c - 4);
  }

  // ── Selected Tower Radar Display ───────────────────────────────────
  drawRangeCircle(ctx, state) {
    if (!state.selectedTower) return;
    const t = state.selectedTower;
    const def = TOWERS[t.type];

    ctx.fillStyle = 'rgba(74, 158, 255, 0.05)';
    ctx.beginPath();
    ctx.arc(t.cx, t.cy, t.range, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = def.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(t.cx, t.cy, t.range, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    const c = GRID.cell;
    const bx = t.col * c;
    const by = t.row * c;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const bLen = 8;

    ctx.beginPath();
    ctx.moveTo(bx, by + bLen); ctx.lineTo(bx, by); ctx.lineTo(bx + bLen, by);
    ctx.moveTo(bx + c - bLen, by); ctx.lineTo(bx + c, by); ctx.lineTo(bx + c, by + bLen);
    ctx.moveTo(bx + c, by + c - bLen); ctx.lineTo(bx + c, by + c); ctx.lineTo(bx + c - bLen, by + c);
    ctx.moveTo(bx + bLen, by + c); ctx.lineTo(bx, by + c); ctx.lineTo(bx, by + c - bLen);
    ctx.stroke();
  }

  // ── Wave Heads-Up Display ──────────────────────────────────────────
  drawWaveAnnounce(ctx, state) {
    if (state.announceTimer <= 0) return;

    const alpha = Math.min(1, state.announceTimer / 0.4);
    ctx.globalAlpha = alpha;

    ctx.fillStyle = 'rgba(10, 16, 28, 0.82)';
    ctx.fillRect(CANVAS_W * 0.5 - 200, CANVAS_H * 0.5 - 45, 400, 90);
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(CANVAS_W * 0.5 - 200, CANVAS_H * 0.5 - 45, 400, 90);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 32px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`SECTOR INVASION: WAVE ${state.announceWave}`, CANVAS_W * 0.5, CANVAS_H * 0.5 - 12);

    ctx.font = '600 16px Rajdhani, sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(state.announceSubtext || 'DEFENSE PROTOCOLS ENGAGED', CANVAS_W * 0.5, CANVAS_H * 0.5 + 20);

    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  invalidateBackground() {
    this.bgDirty = true;
  }
}
