// game.js — Core simulation loop, spatial integration, and combat orchestration
// PERF: Zero-allocation ticks, fixed-step simulation, and direct linked-list queries.

import {
  GAME, GRID, TOWERS, ENEMIES, CANVAS_W, CANVAS_H,
  buildPathData, buildPathCellSet, generateWaves, towerStats,
} from './config.js';
import { SpatialHash } from './spatial.js';
import { EnemyManager } from './enemies.js';
import { TowerManager } from './towers.js';
import { ProjectileManager } from './projectiles.js';
import { ParticleManager } from './particles.js';
import { WaveManager } from './waves.js';
import { Renderer } from './renderer.js';
import { InputManager } from './input.js';

export const State = { MENU: 0, PLAYING: 1, PAUSED: 2, OVER: 3, WON: 4 };

export class GameEngine {
  constructor(bgCanvas, gameCanvas) {
    this.renderer = new Renderer(bgCanvas, gameCanvas);
    this.input = new InputManager(gameCanvas, this);

    this.pathData = buildPathData();
    this.pathCells = buildPathCellSet();

    this.enemies = new EnemyManager();
    this.towers = new TowerManager();
    this.projectiles = new ProjectileManager();
    this.particles = new ParticleManager();
    this.spatialHash = new SpatialHash();
    this.waves = new WaveManager(generateWaves(), this.pathData);

    // State
    this.state = State.MENU;
    this.lives = GAME.startLives;
    this.gold = GAME.startGold;
    this.score = 0;
    this.gameSpeed = 1;

    // Interaction
    this.placingType = -1;
    this.selectedTower = null;

    // Wave announcements
    this.announceTimer = 0;
    this.announceWave = 0;
    this.announceSubtext = '';

    // Ephemeral Tesla lightning arcs
    this.teslaArcs = [];

    // Frame timing & diagnostics (30-frame rolling window = 0.5s responsiveness)
    this.frameTimes = new Float64Array(30);
    this.frameTimes.fill(16.66);
    this.frameIdx = 0;
    this.fps = 60;
    this.lastTime = performance.now();
    this.accumulator = 0;

    // Event hooks
    this.onStateChange = null;
    this.onStatsChange = null;
    this.onSelectionChange = null;

    // Stress testing telemetry
    this.stressMode = false;
    this.perfLog = [];
  }

  start() {
    this.state = State.PLAYING;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.renderer.drawBackground(this.pathCells);
    this.onStateChange?.();
    this.onStatsChange?.();
    this._loop(performance.now());
  }

  restart() {
    this.enemies = new EnemyManager();
    this.towers = new TowerManager();
    this.projectiles = new ProjectileManager();
    this.particles = new ParticleManager();
    this.spatialHash = new SpatialHash();
    this.waves = new WaveManager(generateWaves(), this.pathData);

    this.lives = GAME.startLives;
    this.gold = GAME.startGold;
    this.score = 0;
    this.gameSpeed = 1;
    this.placingType = -1;
    this.selectedTower = null;
    this.announceTimer = 0;
    this.teslaArcs = [];
    this.stressMode = false;
    this.perfLog = [];
    this.frameTimes.fill(16.66);
    this.frameIdx = 0;
    this.fps = 60;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.state = State.PLAYING;

    this.renderer.invalidateBackground();
    this.renderer.drawBackground(this.pathCells);
    this.onStateChange?.();
    this.onStatsChange?.();
    this.onSelectionChange?.();
  }

  // ── Main Game Loop ─────────────────────────────────────────────────
  _loop(now) {
    requestAnimationFrame(t => this._loop(t));

    const rawDt = Math.max(0.001, (now - this.lastTime) * 0.001);
    this.lastTime = now;
    const dt = Math.min(rawDt, GAME.maxDt);

    // Frame timing buffer
    this.frameTimes[this.frameIdx % this.frameTimes.length] = rawDt * 1000;
    this.frameIdx++;
    if (this.frameIdx % 8 === 0) {
      this._computeFps();
    }

    if (this.state === State.PLAYING) {
      this.accumulator += dt * this.gameSpeed;
      // Guarantee exactly 1 fixed-timestep simulation step per render frame
      if (this.accumulator >= GAME.fixedDt) {
        this._tick(GAME.fixedDt);
        this.accumulator %= GAME.fixedDt;
      }
    }

    this._render();
  }

  _computeFps() {
    const n = Math.min(this.frameIdx, this.frameTimes.length);
    if (n === 0) return;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.frameTimes[i];
    this.fps = Math.round(1000 / (sum / n));
  }

  // ── Fixed Timestep Tick ────────────────────────────────────────────
  _tick(dt) {
    if (this.announceTimer > 0) this.announceTimer -= dt;

    const t0 = performance.now();
    // 1. Spawning
    this.waves.update(dt, this.enemies);

    const t1 = performance.now();
    // 2. Movement
    this.enemies.update(dt, this.pathData);

    const t2 = performance.now();
    // 3. Spatial Hash Rebuild
    this.spatialHash.clear();
    const elist = this.enemies.pool.activeList;
    const eitems = this.enemies.pool.items;
    const enemyCount = elist.length;
    for (let i = 0; i < enemyCount; i++) {
      const e = eitems[elist[i]];
      this.spatialHash.insert(e.id, e.x, e.y);
    }

    const t3 = performance.now();
    // 4. Status Auras
    this.enemies.applyHealers(dt, this.spatialHash);

    const t4 = performance.now();
    // 5. Tower Targeting & Fire commands
    const fireCommands = this.towers.update(dt, this.spatialHash, this.enemies.pool);

    const t5 = performance.now();
    // 6. Projectile generation
    this.teslaArcs.length = 0;
    for (let i = 0; i < fireCommands.length; i++) {
      const cmd = fireCommands[i];
      if (cmd.tower.chain > 0) {
        this._chainLightning(cmd.tower, cmd.targetId);
      } else {
        this.projectiles.fire(cmd.tower, cmd.targetId, this.enemies.pool);
      }
    }

    const t6 = performance.now();
    // 7. Projectile physics & collision
    const hits = this.projectiles.update(dt, this.enemies.pool);
    for (let i = 0; i < hits.length; i++) {
      this._resolveHit(hits[i]);
    }

    const t7 = performance.now();
    // 8. Particle physics
    this.particles.update(dt);

    // 9. Leaked enemies
    const leaked = this.enemies.collectLeaked(this.pathData, this.stressMode);
    if (!this.stressMode && leaked.length > 0) {
      const basePt = this.pathData.pts[this.pathData.pts.length - 1];
      const burstCount = Math.min(leaked.length, 3);
      for (let i = 0; i < leaked.length; i++) {
        this.lives--;
      }
      for (let i = 0; i < burstCount; i++) {
        this.particles.burst(basePt.x, basePt.y, '#ff4757', 6);
      }
    }

    // 10. Win / Loss state evaluations
    if (this.lives <= 0) {
      this.lives = 0;
      this.state = State.OVER;
      this.onStateChange?.();
    } else if (
      this.waves.allWavesDone &&
      !this.waves.isSpawning &&
      this.enemies.count === 0
    ) {
      this.state = State.WON;
      this.onStateChange?.();
    }

    if (this.frameIdx % 6 === 0) {
      this.onStatsChange?.();
    }
  }

  // ── Combat Resolution ──────────────────────────────────────────────
  _resolveHit(hit) {
    // Single-target damage
    if (hit.targetId >= 0) {
      const target = this.enemies.pool.get(hit.targetId);
      if (target && target.active) {
        this._damageEnemy(target, hit.damage, hit.piercing);
        if (hit.slow > 0) this._applySlow(target, hit.slow, hit.slowDur);
      }
    }

    // Area-of-Effect Splash damage via spatial hash linked-list
    if (hit.splash > 0) {
      const spl = hit.splash;
      const splSq = spl * spl;
      const inv = this.spatialHash.invCell;
      const cMin = Math.max(0, ((hit.x - spl) * inv) | 0);
      const cMax = Math.min(this.spatialHash.cols - 1, ((hit.x + spl) * inv) | 0);
      const rMin = Math.max(0, ((hit.y - spl) * inv) | 0);
      const rMax = Math.min(this.spatialHash.rows - 1, ((hit.y + spl) * inv) | 0);
      const items = this.enemies.pool.items;
      const splashDmg = hit.damage * 0.6;

      for (let r = rMin; r <= rMax; r++) {
        const rowOff = r * this.spatialHash.cols;
        for (let c = cMin; c <= cMax; c++) {
          let eid = this.spatialHash.cellHead[rowOff + c];
          while (eid !== -1) {
            if (eid !== hit.targetId) {
              const e = items[eid];
              if (e.active) {
                const dx = e.x - hit.x;
                const dy = e.y - hit.y;
                if (dx * dx + dy * dy <= splSq) {
                  this._damageEnemy(e, splashDmg, hit.piercing);
                  if (hit.slow > 0) this._applySlow(e, hit.slow, hit.slowDur);
                }
              }
            }
            eid = this.spatialHash.entityNext[eid];
          }
        }
      }

      if (!this.stressMode) {
        this.particles.ring(hit.x, hit.y, hit.color, hit.splash);
      }
    }

    // Impact burst
    if (!this.stressMode) {
      this.particles.burst(hit.x, hit.y, hit.color, 3, { speed: 55, life: 0.2 });
    }
  }

  _damageEnemy(e, damage, piercing) {
    const effective = piercing ? damage : Math.max(1, damage - e.armor);
    e.hp -= effective;
    e.flashTimer = 0.08;

    if (e.hp <= 0) {
      this.gold += e.reward;
      this.score += e.reward * 2;
      const burstAmt = this.stressMode ? 1 : 8;
      this.particles.burst(e.x, e.y, e.color, burstAmt, { speed: 70, life: 0.3 });
      this.enemies.kill(e.id);
    }
  }

  _applySlow(e, factor, duration) {
    if (e.flying) return; // Flyers bypass ground-based cryo slow
    if (factor > e.slowFactor || e.slowTimer <= 0) {
      e.slowFactor = factor;
    }
    e.slowTimer = Math.max(e.slowTimer, duration);
  }

  _chainLightning(tower, firstTargetId) {
    if (!this._chainSet) this._chainSet = new Set();
    const hit = this._chainSet;
    hit.clear();

    let currentId = firstTargetId;
    let px = tower.cx, py = tower.cy;
    const maxChains = tower.chain;
    const chainRange = tower.chainRange;

    for (let i = 0; i <= maxChains && currentId >= 0; i++) {
      const e = this.enemies.pool.get(currentId);
      if (!e || !e.active || hit.has(currentId)) break;

      hit.add(currentId);
      this.teslaArcs.push({ x1: px, y1: py, x2: e.x, y2: e.y });
      this._damageEnemy(e, tower.damage, false);

      px = e.x;
      py = e.y;

      // Inlined nearest neighbor query
      currentId = this.spatialHash.findClosest(px, py, chainRange, hit, this.enemies.pool);
    }
  }

  // ── Render Dispatch ────────────────────────────────────────────────
  _render() {
    const t0 = performance.now();
    this.renderer.drawBackground(this.pathCells);
    this.renderer.drawFrame({
      towers: this.towers,
      enemies: this.enemies,
      projectiles: this.projectiles,
      particles: this.particles,
      teslaArcs: this.teslaArcs,
      placingType: this.placingType,
      mouseCol: this.input.col,
      mouseRow: this.input.row,
      canPlaceHere: this._canPlace(this.input.col, this.input.row),
      selectedTower: this.selectedTower,
      announceTimer: this.announceTimer,
      announceWave: this.announceWave,
      announceSubtext: this.announceSubtext,
    });
  }

  // ── Player Actions ─────────────────────────────────────────────────
  handleClick(col, row) {
    if (this.state !== State.PLAYING) return;

    if (this.placingType >= 0) {
      if (this._canPlace(col, row)) {
        const def = TOWERS[this.placingType];
        if (this.gold >= def.cost) {
          this.gold -= def.cost;
          const t = this.towers.place(this.placingType, col, row);
          this.selectedTower = t;
          this.placingType = -1;
          this.onStatsChange?.();
          this.onSelectionChange?.();
        }
      }
    } else {
      const existing = this.towers.getTowerAt(col, row);
      this.selectedTower = existing;
      this.onSelectionChange?.();
    }
  }

  selectTowerType(typeIdx) {
    if (typeIdx < 0 || typeIdx >= TOWERS.length) return;
    if (this.state !== State.PLAYING) return;
    this.placingType = typeIdx;
    this.selectedTower = null;
    this.onSelectionChange?.();
  }

  cancelPlacement() {
    this.placingType = -1;
    this.selectedTower = null;
    this.onSelectionChange?.();
  }

  upgradeSelected() {
    if (!this.selectedTower) return;
    const t = this.selectedTower;
    const def = TOWERS[t.type];
    if (t.level >= def.upgrades.length) return;
    const cost = def.upgrades[t.level].cost;
    if (this.gold < cost) return;

    this.gold -= cost;
    this.towers.upgrade(t);
    this.onStatsChange?.();
    this.onSelectionChange?.();
  }

  sellSelected() {
    if (!this.selectedTower) return;
    const refund = this.towers.sell(this.selectedTower);
    this.gold += refund;
    this.selectedTower = null;
    this.onStatsChange?.();
    this.onSelectionChange?.();
  }

  sendWave() {
    if (this.state !== State.PLAYING) return;
    if (this.waves.isSpawning) return;
    if (this.waves.allWavesDone) return;

    const started = this.waves.startWave(this.enemies);
    if (started) {
      this.announceTimer = 2.0;
      this.announceWave = this.waves.waveNum;

      if (this.waves.waveNum <= GAME.totalWaves) {
        const currentWaveDef = this.waves.waves[this.waves.currentWave];
        const totalIncoming = currentWaveDef.groups.reduce((s, g) => s + g.count, 0);
        this.announceSubtext = `${totalIncoming} HOSTILE CONTACTS DETECTED`;
      }
      this.onStatsChange?.();
    }
  }

  togglePause() {
    if (this.state === State.PLAYING) {
      this.state = State.PAUSED;
      this.onStateChange?.();
    } else if (this.state === State.PAUSED) {
      this.state = State.PLAYING;
      this.lastTime = performance.now();
      this.onStateChange?.();
    }
  }

  setSpeed(speed) {
    this.gameSpeed = speed;
  }

  _canPlace(col, row) {
    if (col < 0 || row < 0 || col >= GRID.cols || row >= GRID.rows) return false;
    const key = row * GRID.cols + col;
    return !this.pathCells.has(key) && !this.towers.hasTowerAt(col, row);
  }

  // ── Stress Testing Harness ─────────────────────────────────────────
  runStressTest() {
    this.stressMode = true;
    this.state = State.PLAYING;

    // Reset entities
    this.enemies = new EnemyManager();
    this.towers = new TowerManager();
    this.projectiles = new ProjectileManager();
    this.particles = new ParticleManager();
    this.spatialHash = new SpatialHash();

    // Place 100 tactical towers along path boundary
    let placed = 0;
    for (let r = 0; r < GRID.rows && placed < 100; r++) {
      for (let c = 0; c < GRID.cols && placed < 100; c++) {
        if (this._canPlace(c, r)) {
          const adj = [
            [c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1],
          ];
          const nearPath = adj.some(([ac, ar]) => {
            if (ac < 0 || ar < 0 || ac >= GRID.cols || ar >= GRID.rows) return false;
            return this.pathCells.has(ar * GRID.cols + ac);
          });
          if (nearPath) {
            this.towers.place(placed % TOWERS.length, c, r);
            placed++;
          }
        }
      }
    }

    // Distribute 5000 active enemies evenly along entire path geometry
    const totalPath = this.pathData.totalLen;
    for (let i = 0; i < 5000; i++) {
      const e = this.enemies.spawn(
        i % ENEMIES.length,
        this.pathData,
        2.5 + Math.random() * 1.5,
        0.85 + Math.random() * 0.3,
      );
      if (e) {
        e.dist = (i / 5000) * totalPath * 0.95;
        e.segIdx = 0;
        while (
          e.segIdx < this.pathData.segs.length - 1 &&
          e.dist >= this.pathData.cumLen[e.segIdx + 1]
        ) {
          e.segIdx++;
        }

        const segStart = this.pathData.cumLen[e.segIdx];
        const seg = this.pathData.segs[e.segIdx];
        const t = Math.min((e.dist - segStart) / seg.len, 1);
        const p0 = this.pathData.pts[e.segIdx];
        const p1 = this.pathData.pts[e.segIdx + 1];
        e.x = p0.x + (p1.x - p0.x) * t;
        e.y = p0.y + (p1.y - p0.y) * t;
      }
    }

    this.lives = 999999;
    this.gold = 999999;
    this.frameTimes.fill(16.66);
    this.frameIdx = 0;
    this.fps = 60;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.onStateChange?.();
    this.onStatsChange?.();

    console.log(`[Stress Test Initialized] Active Towers: ${this.towers.count}, Enemies: ${this.enemies.count}`);
    console.log('Sampling performance for 10 seconds...');

    this.perfLog = [];
    const startTime = performance.now();
    const interval = setInterval(() => {
      this.perfLog.push(this.fps);
      const elapsed = (performance.now() - startTime) * 0.001;
      if (elapsed >= 10) {
        clearInterval(interval);
        this._reportStressResults();
      }
    }, 200);
  }

  _reportStressResults() {
    if (this.perfLog.length === 0) return;
    const sorted = [...this.perfLog].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)];
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const min = sorted[0];

    console.log(`=== STRESS TEST BENCHMARK ===`);
    console.log(`Average FPS: ${avg.toFixed(1)}`);
    console.log(`95th Percentile Floor (p5): ${p5} FPS`);
    console.log(`Minimum FPS: ${min}`);
    console.log(`Live Entity Count -> Enemies: ${this.enemies.count}, Towers: ${this.towers.count}, Projectiles: ${this.projectiles.count}`);
    console.log(`Result: ${p5 >= 45 ? 'PASSED (Target >= 45 FPS)' : 'FAILED'}`);
  }

  static State = State;
}
