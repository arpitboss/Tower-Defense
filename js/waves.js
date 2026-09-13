// waves.js — Wave spawning and progression

import { ENEMIES } from './config.js';

export class WaveManager {
  constructor(waveDefs, pathData) {
    this.waves = waveDefs;
    this.pathData = pathData;
    this.currentWave = -1;
    this.spawners = [];       // active spawn timers per group
    this.waveActive = false;
    this.allWavesDone = false;
  }

  startWave(enemies) {
    if (this.allWavesDone) return false;
    this.currentWave++;
    if (this.currentWave >= this.waves.length) {
      this.allWavesDone = true;
      return false;
    }

    const wave = this.waves[this.currentWave];
    this.waveActive = true;
    this.spawners = wave.groups.map(g => ({
      type: g.type,
      remaining: g.count,
      interval: g.interval,
      timer: 0,
      hpMul: wave.hpMul,
      spdMul: wave.spdMul,
    }));

    return true;
  }

  update(dt, enemies) {
    if (!this.waveActive) return;

    let anyLeft = false;
    for (let i = 0; i < this.spawners.length; i++) {
      const s = this.spawners[i];
      if (s.remaining <= 0) continue;

      anyLeft = true;
      s.timer -= dt;
      while (s.timer <= 0 && s.remaining > 0) {
        enemies.spawn(s.type, this.pathData, s.hpMul, s.spdMul);
        s.remaining--;
        s.timer += s.interval;
      }
    }

    if (!anyLeft) {
      this.waveActive = false;
    }
  }

  get isSpawning() { return this.waveActive; }

  get waveNum() { return this.currentWave + 1; }

  // How many enemies are still waiting to spawn in the current wave
  get pendingCount() {
    let n = 0;
    for (const s of this.spawners) n += s.remaining;
    return n;
  }

  // Preview info for the next wave
  getNextWavePreview() {
    const idx = this.currentWave + 1;
    if (idx >= this.waves.length) return null;
    const wave = this.waves[idx];
    return wave.groups.map(g => ({
      name: ENEMIES[g.type].name,
      color: ENEMIES[g.type].color,
      count: g.count,
    }));
  }

  reset(waveDefs) {
    this.waves = waveDefs;
    this.currentWave = -1;
    this.spawners = [];
    this.waveActive = false;
    this.allWavesDone = false;
  }
}
