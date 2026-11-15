const STORE_KEY = 'cod2027_sound';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = localStorage.getItem(STORE_KEY) !== 'off';
    this.started = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.started = true;
  }

  setEnabled(on) {
    this.enabled = !!on;
    localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.03);
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    if (this.enabled) this.tone(780, 0.06, 'sine', 0.05);
    return this.enabled;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  tone(freq, dur, type = 'sine', gain = 0.1, endFreq = null, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, gain = 0.2, filterFreq = 1800, q = 0.7, delay = 0, type = 'lowpass', sweepTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(80, sweepTo), t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }

  shot(weapon, volume = 1) {
    if (volume <= 0.02) return;
    if (weapon === 'sg') {
      this.noise(0.24, 0.34 * volume, 2400, 0.8, 0, 'lowpass', 240);
      this.tone(82, 0.22, 'sine', 0.24 * volume, 38);
      this.tone(140, 0.08, 'square', 0.08 * volume, 60);
    } else {
      this.noise(0.08, 0.22 * volume, 3200, 0.9, 0, 'lowpass', 500);
      this.tone(105, 0.1, 'sine', 0.16 * volume, 45);
      this.tone(220, 0.03, 'square', 0.04 * volume, 120);
    }
  }

  empty() {
    this.tone(1400, 0.025, 'square', 0.05);
    this.noise(0.035, 0.05, 4000, 1);
  }

  hit(kill = false) {
    if (kill) {
      this.tone(1150, 0.05, 'square', 0.08);
      this.tone(1660, 0.08, 'square', 0.06, 1400, 0.03);
      this.tone(240, 0.18, 'sine', 0.14, 150, 0.02);
    } else {
      this.tone(1250, 0.035, 'square', 0.065, 900);
      this.noise(0.03, 0.03, 5000, 1);
    }
  }

  hurt() {
    this.tone(70, 0.25, 'sine', 0.22, 40);
    this.noise(0.12, 0.1, 900, 0.5);
  }

  reloadStart() {
    this.tone(950, 0.02, 'square', 0.04);
    this.noise(0.04, 0.04, 3000, 1);
    this.tone(620, 0.03, 'square', 0.035, 500, 0.07);
  }

  reloadDone() {
    this.tone(700, 0.025, 'square', 0.04);
    this.tone(1050, 0.04, 'square', 0.04, 900, 0.09);
    this.noise(0.06, 0.05, 2500, 1, 0.09);
  }

  dash() {
    this.noise(0.22, 0.13, 500, 0.5, 0, 'bandpass', 2400);
    this.tone(180, 0.18, 'sine', 0.06, 90);
  }

  pickup() {
    this.tone(520, 0.08, 'sine', 0.07);
    this.tone(780, 0.12, 'sine', 0.06, 900, 0.06);
  }

  spawn() {
    this.tone(240, 0.3, 'sine', 0.09, 480);
    this.noise(0.25, 0.04, 900, 0.4);
  }

  kill() {
    this.tone(140, 0.45, 'sawtooth', 0.08, 60);
    this.tone(520, 0.2, 'sine', 0.05, 260, 0.05);
  }

  death() {
    this.tone(180, 0.7, 'sine', 0.15, 48);
    this.noise(0.4, 0.08, 600, 0.4);
  }

  countdown(last = false) {
    this.tone(last ? 1040 : 660, last ? 0.22 : 0.08, 'square', last ? 0.1 : 0.06);
    if (last) this.tone(1560, 0.26, 'sine', 0.06, 1560, 0.02);
  }

  start() {
    this.tone(320, 0.5, 'sine', 0.08, 640);
    this.tone(480, 0.5, 'sine', 0.05, 960, 0.05);
    this.noise(0.5, 0.03, 500, 0.3, 0, 'bandpass', 1600);
  }

  win() {
    this.tone(440, 0.25, 'sine', 0.09);
    this.tone(660, 0.25, 'sine', 0.08, null, 0.12);
    this.tone(880, 0.5, 'sine', 0.09, null, 0.24);
    this.noise(0.4, 0.04, 2400, 0.5, 0.2);
  }

  lose() {
    this.tone(300, 0.4, 'sine', 0.1);
    this.tone(220, 0.5, 'sine', 0.09, 150, 0.18);
    this.tone(110, 0.8, 'sine', 0.1, 70, 0.36);
  }

  ui() {
    this.tone(880, 0.025, 'square', 0.025);
  }

  step() {
    this.noise(0.055, 0.035, 550, 0.9);
    this.tone(72, 0.055, 'sine', 0.025, 46);
  }
}
