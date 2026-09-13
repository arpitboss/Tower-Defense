// audio.js — Lightweight procedural audio with throttling
// Sounds are soft, short, and throttled to prevent cacophony during combat

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
    this.initialized = false;
    // Throttle map: type -> last play timestamp
    this._lastPlay = {};
    this._throttleMs = {
      shoot_archer: 120,
      shoot_artillery: 200,
      shoot_mage: 150,
      shoot_bombard: 200,
      shoot_sorcerer: 150,
      hit: 80,
      die: 60,
      base_hit: 300,
      build: 0,
      error: 200,
      click: 50,
      gameover: 0,
    };
  }

  init() {
    if (this.initialized) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6; // Increased from 0.18
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch (e) {
      // Web Audio not available
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled && !this.initialized) this.init();
    return this.enabled;
  }

  play(type) {
    if (!this.enabled || !this.initialized || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    // Throttle
    const now = performance.now();
    const minGap = this._throttleMs[type] || 50;
    if (this._lastPlay[type] && now - this._lastPlay[type] < minGap) return;
    this._lastPlay[type] = now;

    const t = this.ctx.currentTime;

    switch (type) {
      case 'shoot_archer':
        this._tone('triangle', 1100, 500, 0.15, 0.12);
        break;
      case 'shoot_artillery':
        this._noise(0.25, 0.25);
        this._tone('sine', 80, 35, 0.15, 0.2);
        break;
      case 'shoot_mage':
        this._tone('sine', 700, 1100, 0.12, 0.12);
        break;
      case 'shoot_bombard':
        this._noise(0.2, 0.2);
        this._tone('sine', 60, 25, 0.2, 0.25);
        break;
      case 'shoot_sorcerer':
        this._tone('sine', 400, 150, 0.15, 0.1);
        this._tone('sine', 800, 300, 0.1, 0.08);
        break;
      case 'hit':
        this._tone('square', 120, 60, 0.1, 0.04);
        break;
      case 'die':
        this._tone('sine', 800, 1200, 0.15, 0.08);
        break;
      case 'base_hit':
        this._tone('sine', 90, 30, 0.4, 0.35);
        break;
      case 'build':
        this._tone('sine', 400, 600, 0.2, 0.15);
        this._tone('sine', 600, 800, 0.15, 0.1, 0.1);
        break;
      case 'error':
        this._tone('triangle', 200, 140, 0.2, 0.15);
        break;
      case 'click':
        this._tone('sine', 500, 300, 0.15, 0.04);
        break;
      case 'gameover':
        this._tone('sine', 300, 80, 0.3, 1.2);
        this._tone('sine', 200, 50, 0.2, 1.5, 0.3);
        break;
    }
  }

  // Create a simple tone: osc from freqStart to freqEnd
  _tone(wave, f0, f1, vol, dur, delay) {
    const t = this.ctx.currentTime + (delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  // Short noise burst (for explosions)
  _noise(vol, dur) {
    const t = this.ctx.currentTime;
    const bufSize = this.ctx.sampleRate * dur;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - i / bufSize);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g);
    g.connect(this.masterGain);
    src.start(t);
  }
}
