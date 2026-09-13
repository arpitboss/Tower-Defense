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

    // Sandy desert background
    ctx.fillStyle = '#e2d2a4';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Procedural scenery (rocks/dirt)
    ctx.fillStyle = '#c8b687';
    for (let x = 0; x < CANVAS_W; x += c) {
      for (let y = 0; y < CANVAS_H; y += c) {
        if (Math.sin(x * 13.1 + y * 97.5) > 0.6) {
          ctx.beginPath();
          ctx.arc(x + c/2, y + c/2, 2 + Math.abs(Math.sin(x*y))*3, 0, TAU);
          ctx.fill();
        }
      }
    }

    const pts = PATH_WAYPOINTS.map(([col, row]) => [col * c + HALF_CELL, row * c + HALF_CELL]);

    // Outer dirt path outline
    ctx.strokeStyle = '#8f7242';
    ctx.lineWidth = c * 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();

    // Inner dirt path
    ctx.strokeStyle = '#b08d55';
    ctx.lineWidth = c * 1.4;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();

    // Faint grid for placement clarity
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= CANVAS_W; x += c) {
      ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H);
    }
    for (let y = 0; y <= CANVAS_H; y += c) {
      ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y);
    }
    ctx.stroke();

    // Enemy Cave (Spawn)
    const spX = pts[0][0], spY = pts[0][1];
    ctx.fillStyle = '#1a1a1a'; // Dark cave hole
    ctx.beginPath();
    if (ctx.ellipse) {
      ctx.ellipse(spX, spY, 20, 24, 0, 0, TAU);
    } else {
      ctx.arc(spX, spY, 22, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = '#4a403d'; // Cave rocks
    ctx.beginPath();
    ctx.arc(spX - 15, spY - 10, 10, 0, TAU);
    ctx.arc(spX + 15, spY - 10, 10, 0, TAU);
    ctx.arc(spX, spY - 18, 12, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#4a2e15';
    ctx.font = 'bold 12px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ENEMY CAVE', spX + 24, spY - 24);

    // Kingdom Castle (Base)
    const bsX = pts[pts.length - 1][0], bsY = pts[pts.length - 1][1];
    ctx.fillStyle = '#8c7b75'; // Castle grey
    ctx.fillRect(bsX - 20, bsY - 20, 40, 40);
    // Castle battlements
    ctx.fillRect(bsX - 22, bsY - 25, 10, 10);
    ctx.fillRect(bsX - 5, bsY - 25, 10, 10);
    ctx.fillRect(bsX + 12, bsY - 25, 10, 10);
    // Castle door
    ctx.fillStyle = '#4a2e15';
    ctx.fillRect(bsX - 8, bsY + 4, 16, 16);
    ctx.beginPath();
    ctx.arc(bsX, bsY + 4, 8, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#4a2e15';
    ctx.fillText('KINGDOM CASTLE', bsX - 24, bsY - 30);

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

  // ── Towers (Batched into multi-layer draw calls) ───────────────────────
  drawTowers(ctx, towerMgr) {
    const towers = towerMgr.towers;
    const len = towers.length;
    if (len === 0) return;
    const r = HALF_CELL * 0.72;

    // Draw towers grouped by type
    for (let type = 0; type < TOWERS.length; type++) {
      let typeTowers = [];
      for (let i = 0; i < len; i++) {
        if (towers[i].type === type) typeTowers.push(towers[i]);
      }
      if (typeTowers.length === 0) continue;
      
      const def = TOWERS[type];

      // Draw bases (static part)
      ctx.beginPath();
      for (let i = 0; i < typeTowers.length; i++) {
        const t = typeTowers[i];
        if (type === 0 || type === 3) {
          // Archer & Bombard: Wooden platform
          ctx.fillStyle = '#6b4226';
          ctx.strokeStyle = '#3e2723';
          ctx.lineWidth = 2;
          if (ctx.roundRect) ctx.roundRect((t.cx - r) | 0, (t.cy - r) | 0, (r * 2) | 0, (r * 2) | 0, 4);
          else ctx.rect((t.cx - r) | 0, (t.cy - r) | 0, (r * 2) | 0, (r * 2) | 0);
          ctx.fill(); ctx.stroke();
          
          // Inner wooden planks
          ctx.fillStyle = '#8b5a2b';
          ctx.fillRect(t.cx - r + 2, t.cy - r + 2, r * 2 - 4, r * 2 - 4);
        } else {
          // Artillery, Mage, Sorcerer: Stone tower
          ctx.fillStyle = type === 4 ? '#2d2d2d' : '#8c7b75'; // Sorcerer is darker stone
          ctx.strokeStyle = '#4a403d';
          ctx.lineWidth = 2;
          if (type === 1) { // Square stone for catapult
            ctx.rect((t.cx - r) | 0, (t.cy - r) | 0, (r * 2) | 0, (r * 2) | 0);
          } else { // Round stone for mages
            ctx.moveTo(t.cx + r, t.cy);
            ctx.arc(t.cx, t.cy, r, 0, TAU);
          }
          ctx.fill(); ctx.stroke();
          
          if (type === 2 || type === 4) { // inner stone circle
            ctx.fillStyle = type === 4 ? '#1a1a1a' : '#6d5f5a';
            ctx.beginPath();
            ctx.arc(t.cx, t.cy, r * 0.6, 0, TAU);
            ctx.fill();
          }
        }
      }

      // Draw turrets (rotating part)
      for (let i = 0; i < typeTowers.length; i++) {
        const t = typeTowers[i];
        ctx.save();
        ctx.translate(t.cx, t.cy);
        ctx.rotate(t.angle);
        
        ctx.fillStyle = def.color;
        ctx.strokeStyle = '#3e2723';
        ctx.lineWidth = 2;

        if (type === 0) { 
          // Archer: Simple bow
          ctx.strokeStyle = '#8b5a2b'; // Wood bow
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, 10, -Math.PI / 2, Math.PI / 2);
          ctx.stroke();
          // Arrow
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, -1, 14, 2);
        } else if (type === 1) { 
          // Artillery: Catapult arm
          ctx.fillStyle = '#6b4226'; // wood arm
          ctx.fillRect(-6, -3, 18, 6);
          ctx.fillStyle = '#4a403d'; // stone payload
          ctx.beginPath();
          ctx.arc(10, 0, 4, 0, TAU);
          ctx.fill();
        } else if (type === 2) { 
          // Mage: Floating crystal
          ctx.fillStyle = '#0ea5e9';
          ctx.beginPath();
          ctx.moveTo(8, 0); ctx.lineTo(0, 5); ctx.lineTo(-8, 0); ctx.lineTo(0, -5);
          ctx.fill();
          ctx.fillStyle = '#e0f2fe';
          ctx.beginPath();
          ctx.moveTo(8, 0); ctx.lineTo(0, 2); ctx.lineTo(-8, 0); ctx.lineTo(0, -2);
          ctx.fill();
        } else if (type === 3) { 
          // Bombard: Thick iron cannon
          ctx.fillStyle = '#2d2d2d'; // iron
          ctx.fillRect(-4, -6, 16, 12);
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(10, -5, 4, 10); // muzzle flare
        } else if (type === 4) { 
          // Sorcerer: Dark magic orb
          ctx.fillStyle = '#a855f7';
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = '#d8b4fe';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(5, 0); ctx.lineTo(12, 0);
          ctx.moveTo(-2.5, 4.3); ctx.lineTo(-6, 10);
          ctx.moveTo(-2.5, -4.3); ctx.lineTo(-6, -10);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Pass 4: Level indicator pips
    for (let i = 0; i < len; i++) {
      const t = towers[i];
      if (t.level > 0) {
        ctx.fillStyle = TOWERS[t.type].color;
        const pips = t.level;
        const spacing = 5;
        const startX = t.cx - ((pips - 1) * spacing) / 2;
        for (let p = 0; p < pips; p++) {
          ctx.beginPath();
          ctx.arc(startX + p * spacing, t.cy + r - 3, 1.5, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  // ── Enemies (Ultra-fast Path-batched drawing) ───────────────────────
  drawEnemies(ctx, enemyMgr) {
    const buckets = enemyMgr.typeBuckets;
    const items = enemyMgr.pool.items;
    const activeList = enemyMgr.pool.activeList;
    const activeLen = activeList.length;
    if (activeLen === 0) return;

    // Clutter reduction removed to avoid the "solid translucent snake" look
    const detail = activeLen > 800 ? 0 : activeLen > 400 ? 1 : 2;

    ctx.globalAlpha = 1.0;

    // Drop Shadows (Ground units only: 0 to 3)
    if (detail > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      for (let type = 0; type <= 3; type++) {
        const b = buckets[type];
        for (let i = 0; i < b.length; i++) {
          const e = items[b[i]];
          if (ctx.ellipse) {
            ctx.moveTo(e.x + e.radius * 0.8, e.y + 4);
            ctx.ellipse(e.x, e.y + 4, e.radius * 0.8, e.radius * 0.3, 0, 0, TAU);
          } else {
            ctx.rect(e.x - e.radius, e.y + 2, e.radius * 2, e.radius * 0.6);
          }
        }
      }
      ctx.fill();
    }

    // Type 0: Goblin (Scout) - Small green body
    const b0 = buckets[0];
    if (b0.length > 0) {
      ctx.fillStyle = '#84cc16';
      ctx.beginPath();
      for (let i = 0; i < b0.length; i++) {
        const e = items[b0[i]];
        if (detail === 0) {
          ctx.rect(e.x - e.radius, e.y - e.radius, e.radius * 2, e.radius * 2);
        } else {
          ctx.moveTo(e.x + e.radius, e.y);
          ctx.arc(e.x, e.y, e.radius, 0, TAU);
        }
      }
      ctx.fill();
    }

    // Type 1: Orc (Soldier) - Green body, brown leather
    const b1 = buckets[1];
    if (b1.length > 0) {
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      for (let i = 0; i < b1.length; i++) {
        const e = items[b1[i]];
        if (detail === 0) {
          ctx.rect(e.x - e.radius, e.y - e.radius, e.radius * 2, e.radius * 2);
        } else {
          ctx.moveTo(e.x + e.radius, e.y);
          ctx.arc(e.x, e.y, e.radius, 0, TAU);
        }
      }
      ctx.fill();
      if (detail > 0) {
        ctx.fillStyle = '#8b5a2b';
        ctx.beginPath();
        for (let i = 0; i < b1.length; i++) {
          const e = items[b1[i]];
          ctx.rect(e.x - e.radius, e.y - 3, e.radius * 2, 6);
        }
        ctx.fill();
      }
    }

    // Type 2: Ogre (Tank) - Huge grey body
    const b2 = buckets[2];
    if (b2.length > 0) {
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      for (let i = 0; i < b2.length; i++) {
        const e = items[b2[i]];
        if (detail === 0) {
          ctx.rect(e.x - e.radius, e.y - e.radius, e.radius * 2, e.radius * 2);
        } else {
          ctx.moveTo(e.x + e.radius, e.y);
          ctx.arc(e.x, e.y, e.radius, 0, TAU);
        }
      }
      ctx.fill();
      if (detail > 0) {
        ctx.fillStyle = '#64748b'; // stone armor plates
        ctx.beginPath();
        for (let i = 0; i < b2.length; i++) {
          const e = items[b2[i]];
          ctx.rect(e.x - 6, e.y - 6, 12, 12);
        }
        ctx.fill();
      }
    }

    // Type 3: Shaman (Healer) - Cyan body + staff
    const b3 = buckets[3];
    if (b3.length > 0) {
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      for (let i = 0; i < b3.length; i++) {
        const e = items[b3[i]];
        if (detail === 0) {
          ctx.rect(e.x - e.radius, e.y - e.radius, e.radius * 2, e.radius * 2);
        } else {
          ctx.moveTo(e.x + e.radius, e.y);
          ctx.arc(e.x, e.y, e.radius, 0, TAU);
        }
      }
      ctx.fill();
      if (detail > 0) {
        ctx.fillStyle = '#4a2e15'; // wooden staff
        ctx.beginPath();
        for (let i = 0; i < b3.length; i++) {
          const e = items[b3[i]];
          ctx.rect(e.x + 4, e.y - 8, 2, 16);
        }
        ctx.fill();
      }
    }

    // Type 4: Bat (Flyer) - Dark wings flapping
    const b4 = buckets[4];
    if (b4.length > 0) {
      ctx.fillStyle = '#1e293b';
      const time = performance.now() * 0.015;
      ctx.beginPath();
      for (let i = 0; i < b4.length; i++) {
        const e = items[b4[i]];
        if (detail === 0) {
          ctx.rect(e.x - 4, e.y - 4, 8, 8);
        } else {
          const bob = Math.sin(time + e.x) * 1.5;
          const flap = Math.sin(time * 2 + e.id * 0.5) * 4;
          const angle = Math.atan2(e.vy, e.vx);
          const cos = Math.cos(angle), sin = Math.sin(angle);
          const p1x = e.x + 4 * cos, p1y = e.y + bob + 4 * sin; // nose
          const p2x = e.x - 4 * cos - (8 + flap) * sin, p2y = e.y + bob - 4 * sin + (8 + flap) * cos; // left wing
          const p3x = e.x - 2 * cos, p3y = e.y + bob - 2 * sin; // tail
          const p4x = e.x - 4 * cos + (8 + flap) * sin, p4y = e.y + bob - 4 * sin - (8 + flap) * cos; // right wing
          ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.lineTo(p3x, p3y); ctx.lineTo(p4x, p4y);
        }
      }
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;

    // Type 5: Troll Champion (Boss) — Large golden body with crown and aura ring
    const b5 = buckets[5];
    if (b5 && b5.length > 0) {
      const time = performance.now() * 0.003;
      for (let i = 0; i < b5.length; i++) {
        const e = items[b5[i]];

        // Aura ring (pulsing)
        const auraPulse = 0.15 + Math.sin(time * 2) * 0.08;
        ctx.strokeStyle = `rgba(250, 204, 21, ${auraPulse})`;
        ctx.lineWidth = 3;
        const auraR = e.auraRange || 150;
        ctx.beginPath();
        ctx.moveTo(e.x + auraR, e.y);
        ctx.arc(e.x, e.y, auraR, 0, TAU);
        ctx.stroke();

        // Body — large circle
        ctx.fillStyle = '#5d4e37';
        ctx.beginPath();
        ctx.moveTo(e.x + e.radius, e.y);
        ctx.arc(e.x, e.y, e.radius, 0, TAU);
        ctx.fill();

        // Inner highlight
        ctx.fillStyle = '#7a6b54';
        ctx.beginPath();
        ctx.moveTo(e.x + e.radius * 0.7, e.y - 3);
        ctx.arc(e.x, e.y - 3, e.radius * 0.7, 0, TAU);
        ctx.fill();

        // Crown (three golden triangles)
        ctx.fillStyle = '#facc15';
        const crownY = e.y - e.radius - 4;
        ctx.beginPath();
        ctx.moveTo(e.x - 12, crownY + 6); ctx.lineTo(e.x - 8, crownY - 6); ctx.lineTo(e.x - 4, crownY + 6);
        ctx.moveTo(e.x - 5, crownY + 6); ctx.lineTo(e.x, crownY - 10); ctx.lineTo(e.x + 5, crownY + 6);
        ctx.moveTo(e.x + 4, crownY + 6); ctx.lineTo(e.x + 8, crownY - 6); ctx.lineTo(e.x + 12, crownY + 6);
        ctx.fill();

        // Crown jewels
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(e.x + 3, crownY - 3);
        ctx.arc(e.x, crownY - 3, 3, 0, TAU);
        ctx.fill();

        // Boss Health Bar (large, always visible)
        const barW = e.radius * 3;
        const barH = 5;
        const barX = e.x - barW / 2;
        const barY = e.y + e.radius + 6;
        const pct = Math.max(0, e.hp / e.maxHp);

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
        ctx.fillStyle = pct > 0.5 ? '#facc15' : pct > 0.25 ? '#f97316' : '#dc2626';
        ctx.fillRect(barX, barY, barW * pct, barH);
        ctx.strokeStyle = '#4a2e15';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
      }
    }

    // Hit Flash (Damaged units only, budgeted to 40 units max)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    let anyFlash = false;
    let flashBudget = 40;
    for (let i = 0; i < activeLen && flashBudget > 0; i++) {
      const e = items[activeList[i]];
      if (e.flashTimer > 0) {
        anyFlash = true;
        flashBudget--;
        ctx.rect((e.x - e.radius) | 0, (e.y - e.radius) | 0, e.radius * 2, e.radius * 2);
      }
    }
    if (anyFlash) ctx.fill();

    // Health Bars (Bosses, <30% HP, or flashed)
    if (!this._wounded) this._wounded = [];
    this._wounded.length = 0;
    for (let i = 0; i < activeLen; i++) {
      const e = items[activeList[i]];
      if (e.hp < e.maxHp) {
        const pct = e.hp / e.maxHp;
        if (e.type === 5 || pct < 0.3 || e.flashTimer > 0) {
          this._wounded.push(e);
        }
      }
    }

    const woundedCount = this._wounded.length;
    if (woundedCount > 0) {
      // 1. Backgrounds
      ctx.fillStyle = 'rgba(10, 15, 25, 0.88)';
      ctx.beginPath();
      for (let i = 0; i < woundedCount; i++) {
        const e = this._wounded[i];
        if (e.type === 5) continue;
        ctx.rect((e.x - e.radius) | 0, (e.y - e.radius - 5) | 0, e.radius * 2, 2.5);
      }
      ctx.fill();

      // 2. Green Bar (> 50% HP)
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      for (let i = 0; i < woundedCount; i++) {
        const e = this._wounded[i];
        if (e.type === 5) continue;
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
        if (e.type === 5) continue;
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
    const r = HALF_CELL * 0.72;

    ctx.fillStyle = ok ? 'rgba(56, 142, 60, 0.35)' : 'rgba(211, 47, 47, 0.35)';
    ctx.strokeStyle = ok ? '#388e3c' : '#d32f2f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect((cx - r) | 0, (cy - r) | 0, (r * 2) | 0, (r * 2) | 0, 4);
    else ctx.rect((cx - r) | 0, (cy - r) | 0, (r * 2) | 0, (r * 2) | 0);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, def.range, 0, TAU);
    ctx.fill(); ctx.stroke();
  }

  // ── Selected Tower Radar Display ───────────────────────────────────
  drawRangeCircle(ctx, state) {
    if (!state.selectedTower) return;
    const t = state.selectedTower;
    const def = TOWERS[t.type];

    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
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

    const isBossWave = state.announceWave === 50;
    const bgColor = isBossWave ? 'rgba(80, 20, 10, 0.9)' : 'rgba(30, 20, 10, 0.85)';
    const borderColor = isBossWave ? 'rgba(250, 204, 21, 0.6)' : 'rgba(205, 133, 63, 0.4)';

    ctx.fillStyle = bgColor;
    ctx.fillRect(CANVAS_W * 0.5 - 200, CANVAS_H * 0.5 - 45, 400, 90);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isBossWave ? 3 : 1.5;
    ctx.strokeRect(CANVAS_W * 0.5 - 200, CANVAS_H * 0.5 - 45, 400, 90);

    ctx.fillStyle = isBossWave ? '#facc15' : '#ffffff';
    ctx.font = '700 32px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isBossWave ? 'BOSS WAVE!' : `WAVE ${state.announceWave}`, CANVAS_W * 0.5, CANVAS_H * 0.5 - 12);

    ctx.font = '600 16px Fredoka, sans-serif';
    ctx.fillStyle = isBossWave ? '#ff6b35' : '#cd853f';
    ctx.fillText(state.announceSubtext || 'DEFEND THE KINGDOM', CANVAS_W * 0.5, CANVAS_H * 0.5 + 20);

    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  invalidateBackground() {
    this.bgDirty = true;
  }
}
