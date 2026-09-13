// ui.js — High-performance HUD, sidebar, and overlay manager
// PERF: Value dirty-checking prevents layout reflows and DOM GC thrashing in hot loops.

import { TOWERS, ENEMIES, GAME, towerStats, towerTotalCost } from './config.js';

export class UI {
  constructor(game, audio) {
    this.game = game;
    this.audio = audio;

    // Cache DOM refs
    this.livesEl = document.getElementById('lives-val');
    this.goldEl = document.getElementById('gold-val');
    this.waveEl = document.getElementById('wave-val');
    this.scoreEl = document.getElementById('score-val');
    this.highscoreEl = document.getElementById('highscore-val');
    this.fpsEl = document.getElementById('fps-val');
    this.entityEl = document.getElementById('entity-val');

    this.shopEl = document.getElementById('tower-shop');
    this.infoEl = document.getElementById('tower-info');
    this.infoName = document.getElementById('info-name');
    this.infoStats = document.getElementById('info-stats');
    this.btnUpgrade = document.getElementById('btn-upgrade');
    this.btnSell = document.getElementById('btn-sell');

    this.wavePreviewEl = document.getElementById('wave-preview');
    this.btnWave = document.getElementById('btn-send-wave');

    this.overlayEl = document.getElementById('overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlayMsg = document.getElementById('overlay-msg');
    this.overlayBtns = document.getElementById('overlay-btns');

    // Cached button elements
    this.shopButtons = [];

    // Dirty checking cache
    this._lastLives = -1;
    this._lastGold = -1;
    this._lastWave = -1;
    this._lastScore = -1;
    this._lastSpawning = null;
    this._lastAllDone = null;

    // Wire callbacks
    game.onStatsChange = () => this.updateStats();
    game.onStateChange = () => this.updateState();
    game.onSelectionChange = () => this.updateSelection();

    this._buildShop();
    this._bindControls();
    this.showMenu();

    // Periodic telemetry update
    setInterval(() => this._updatePerf(), 250);

    // Tutorial overlay handling
    this.tutorialEl = document.getElementById('tutorial-overlay');
    if (!localStorage.getItem('td_tutorial_seen')) {
      this.tutorialEl.classList.remove('hidden');
    }
  }

  _buildShop() {
    this.shopEl.innerHTML = '<h3>TOWERS <span class="hint">(1-5)</span></h3>';
    this.shopButtons.length = 0;

    TOWERS.forEach((def, i) => {
      const btn = document.createElement('button');
      btn.className = 'tower-btn';
      btn.dataset.type = i;
      btn.innerHTML = `
        <span class="tower-swatch" style="background:${def.color}"></span>
        <span class="tower-name">${def.name}</span>
        <span class="tower-cost">${def.cost}g</span>
        <span class="tower-desc">${def.desc}</span>
      `;
      btn.addEventListener('click', () => this.game.selectTowerType(i));
      this.shopEl.appendChild(btn);
      this.shopButtons.push(btn);
    });
  }

  _bindControls() {
    document.getElementById('btn-pause').addEventListener('click', () => this.game.togglePause());
    document.getElementById('btn-play').addEventListener('click', () => {
      if (this.game.state === this.game.constructor.State.PAUSED) this.game.togglePause();
      this.game.setSpeed(1);
      this._highlightSpeed(1);
    });
    document.getElementById('btn-fast').addEventListener('click', () => {
      this.game.setSpeed(2);
      this._highlightSpeed(2);
    });
    document.getElementById('btn-turbo').addEventListener('click', () => {
      this.game.setSpeed(3);
      this._highlightSpeed(3);
    });
    document.getElementById('btn-restart').addEventListener('click', () => this.game.restart());
    document.getElementById('btn-stress').addEventListener('click', () => {
      this.game.runStressTest();
    });

    this.btnWave.addEventListener('click', () => {
      this.game.sendWave();
      if (this.audio) this.audio.play('click');
    });
    this.btnUpgrade.addEventListener('click', () => this.game.upgradeSelected());
    this.btnSell.addEventListener('click', () => this.game.sellSelected());

    const btnSound = document.getElementById('btn-sound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        if (!this.audio) return;
        const enabled = this.audio.toggle();
        btnSound.textContent = enabled ? '🔊' : '🔇';
        if (enabled) this.audio.play('click');
      });
    }

    const btnCloseTutorial = document.getElementById('btn-close-tutorial');
    if (btnCloseTutorial) {
      btnCloseTutorial.addEventListener('click', () => {
        localStorage.setItem('td_tutorial_seen', '1');
        this.tutorialEl.classList.add('hidden');
        if (this.audio) this.audio.play('click');
      });
    }
  }

  _highlightSpeed(speed) {
    const ids = ['btn-play', 'btn-fast', 'btn-turbo'];
    for (let i = 0; i < ids.length; i++) {
      const el = document.getElementById(ids[i]);
      if (el) {
        el.classList.toggle('active', (i + 1) === speed);
      }
    }
  }

  updateStats() {
    const g = this.game;

    // Strict dirty check before touching DOM
    if (this._lastLives !== g.lives) {
      this._lastLives = g.lives;
      this.livesEl.textContent = g.lives > 9999 ? '∞' : g.lives;
    }
    if (this._lastGold !== g.gold) {
      this._lastGold = g.gold;
      this.goldEl.textContent = g.gold > 99999 ? '∞' : g.gold;

      // Update affordability classes without querySelector
      for (let i = 0; i < this.shopButtons.length; i++) {
        const btn = this.shopButtons[i];
        const cost = TOWERS[i].cost;
        btn.classList.toggle('affordable', g.gold >= cost);
      }
    }
    if (this._lastScore !== g.score) {
      this._lastScore = g.score;
      this.scoreEl.textContent = g.score;
      if (this.highscoreEl) {
        this.highscoreEl.textContent = g.bestScore;
      }
    }

    const waveChanged = this._lastWave !== g.waves.waveNum;
    const spawnChanged = this._lastSpawning !== g.waves.isSpawning;
    const doneChanged = this._lastAllDone !== g.waves.allWavesDone;

    if (waveChanged || spawnChanged || doneChanged) {
      this._lastWave = g.waves.waveNum;
      this._lastSpawning = g.waves.isSpawning;
      this._lastAllDone = g.waves.allWavesDone;

      this.waveEl.textContent = `${g.waves.waveNum} / ${GAME.totalWaves}`;
      this.btnWave.disabled = g.waves.isSpawning || g.waves.allWavesDone;
      this.btnWave.textContent = g.waves.allWavesDone
        ? 'ALL WAVES SENT'
        : g.waves.isSpawning
          ? 'SPAWNING...'
          : `SEND WAVE ${g.waves.waveNum + 1}`;

      // Update preview HTML only when wave actually changes
      const preview = g.waves.getNextWavePreview();
      if (preview) {
        this.wavePreviewEl.innerHTML = preview.map(p =>
          `<span class="preview-tag" style="border-color:${p.color}">${p.count}× ${p.name}</span>`
        ).join('');
      } else {
        this.wavePreviewEl.innerHTML = '<span class="preview-done">—</span>';
      }
    }
  }

  updateState() {
    const g = this.game;
    const State = g.constructor.State;

    if (g.state === State.OVER) {
      this.showOverlay('DEFEAT', `The kingdom fell at Wave ${g.waves.waveNum}. Score: ${g.score}`, [
        { label: 'TRY AGAIN', action: () => { if (this.audio) this.audio.play('click'); g.restart(); this.hideOverlay(); } },
      ]);
    } else if (g.state === State.WON) {
      this.showOverlay('VICTORY!', `All 50 waves conquered! Final Score: ${g.score}`, [
        { label: 'PLAY AGAIN', action: () => { if (this.audio) this.audio.play('click'); g.restart(); this.hideOverlay(); } },
      ]);
    } else if (g.state === State.PAUSED) {
      this.showOverlay('GAME PAUSED', 'Press SPACE or click Resume to continue', [
        { label: 'RESUME', action: () => { if (this.audio) this.audio.play('click'); g.togglePause(); this.hideOverlay(); } },
      ]);
    } else {
      this.hideOverlay();
    }
  }

  updateSelection() {
    const g = this.game;
    const t = g.selectedTower;

    if (!t) {
      this.infoEl.classList.add('hidden');
      return;
    }

    this.infoEl.classList.remove('hidden');
    const def = TOWERS[t.type];
    const stats = towerStats(t.type, t.level);

    this.infoName.textContent = `${def.name} MK.${t.level + 1}`;
    this.infoName.style.color = def.color;

    let html = `
      <div class="stat-row"><span>Damage</span><span>${stats.damage}</span></div>
      <div class="stat-row"><span>Range</span><span>${stats.range}px</span></div>
      <div class="stat-row"><span>Fire Rate</span><span>${stats.rof.toFixed(1)}/s</span></div>
    `;
    if (stats.splash) html += `<div class="stat-row"><span>Splash</span><span>${stats.splash}px</span></div>`;
    if (stats.slow) html += `<div class="stat-row"><span>Frost Slow</span><span>${Math.round(stats.slow * 100)}%</span></div>`;
    if (stats.chain) html += `<div class="stat-row"><span>Chain</span><span>${stats.chain} arcs</span></div>`;
    if (stats.piercing) html += `<div class="stat-row"><span>Armor Piercing</span><span>Active</span></div>`;

    this.infoStats.innerHTML = html;

    // Upgrade button
    if (t.level < def.upgrades.length) {
      const upCost = def.upgrades[t.level].cost;
      this.btnUpgrade.textContent = `UPGRADE (${upCost}g)`;
      this.btnUpgrade.disabled = g.gold < upCost;
      this.btnUpgrade.classList.remove('hidden');
    } else {
      this.btnUpgrade.textContent = 'MAX TIER';
      this.btnUpgrade.disabled = true;
    }

    // Sell button
    const refund = Math.floor(t.totalCost * GAME.sellRatio);
    this.btnSell.textContent = `SELL (+${refund}g)`;
  }

  _updatePerf() {
    const g = this.game;
    this.fpsEl.textContent = `${g.fps} FPS`;
    this.fpsEl.style.color = g.fps >= 50 ? '#4ade80' : g.fps >= 35 ? '#facc15' : '#ef4444';
    this.entityEl.textContent = `E:${g.enemies.count} T:${g.towers.count} P:${g.projectiles.count}`;
  }

  showMenu() {
    // Show best score on load
    if (this.highscoreEl) this.highscoreEl.textContent = this.game.bestScore;
    this.showOverlay('KINGDOM DEFENSE', 'Defend the castle against 50 waves of orcs and monsters', [
      { label: 'START BATTLE', action: () => {
        if (this.audio) this.audio.init();
        if (this.audio) this.audio.play('click');
        this.game.start();
        this.hideOverlay();
      } },
    ]);
  }

  showOverlay(title, msg, buttons) {
    this.overlayEl.classList.remove('hidden');
    this.overlayTitle.textContent = title;
    this.overlayMsg.textContent = msg;
    this.overlayBtns.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'overlay-btn';
      btn.textContent = b.label;
      btn.addEventListener('click', b.action);
      this.overlayBtns.appendChild(btn);
    }
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }
}
