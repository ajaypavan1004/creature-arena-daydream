// Sound effects, synthesised with Web Audio (no sound files, nothing downloaded). Audio
// starts on the first click or key press, as browsers require. M toggles mute.
import type { Effect, GameEvent } from "./sim.ts";

type Wave = OscillatorType;

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem("arena-muted") === "1"; } catch { /* storage blocked */ }
    const wake = () => this.start();
    addEventListener("pointerdown", wake);
    addEventListener("keydown", wake);
  }

  private start(): void {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.out = this.ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.5;
    this.out.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.out) this.out.gain.value = this.muted ? 0 : 0.5;
    try { localStorage.setItem("arena-muted", this.muted ? "1" : "0"); } catch { /* storage blocked */ }
    return this.muted;
  }

  // ------------------------------------------------------------ building blocks

  private tone(freq: number, to: number, dur: number, wave: Wave = "sine", vol = 0.3, delay = 0): void {
    const c = this.ctx, out = this.out;
    if (!c || !out || this.muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.015, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, from: number, to: number, vol = 0.3, q = 1, delay = 0): void {
    const c = this.ctx, out = this.out;
    if (!c || !out || !this.noiseBuf || this.muted) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf;
    f.type = "bandpass"; f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------ effects

  swing(dash: boolean): void {
    if (dash) { this.noise(0.25, 3000, 600, 0.35, 0.8); this.tone(900, 120, 0.22, "sawtooth", 0.12); }
    else this.noise(0.14, 2200, 500, 0.22, 1.2);
  }
  hit(big: boolean): void {
    this.tone(big ? 160 : 200, 55, 0.18, "triangle", 0.45);
    this.noise(0.08, 1800, 400, 0.3, 0.7);
  }
  block(): void { this.tone(1250, 1180, 0.35, "triangle", 0.25); this.tone(1870, 1800, 0.3, "sine", 0.12, 0.01); }
  spawn(): void { this.tone(660, 990, 0.12, "sine", 0.1); }
  ko(): void { this.tone(220, 40, 0.8, "sawtooth", 0.25); this.noise(0.6, 800, 80, 0.35, 0.5); }
  countdown(go: boolean): void { this.tone(go ? 880 : 520, go ? 880 : 520, go ? 0.35 : 0.12, "square", 0.08); }
  win(): void { [523, 659, 784, 1047].forEach((n, i) => this.tone(n, n, i === 3 ? 0.6 : 0.18, "triangle", 0.18, i * 0.12)); }

  power(effect: Effect): void {
    switch (effect) {
      case "boost": this.tone(300, 1200, 0.35, "sawtooth", 0.12); this.tone(600, 1800, 0.3, "sine", 0.1, 0.05); break;
      case "jitters": for (let i = 0; i < 8; i++) this.tone(140 + (i % 2) * 40, 140 + (i % 2) * 40, 0.06, "square", 0.08, i * 0.06); break;
      case "yum": this.tone(520, 780, 0.12, "sine", 0.2); this.tone(780, 1040, 0.16, "sine", 0.2, 0.12); break;
      case "bitter": for (let i = 0; i < 5; i++) this.tone(500 + Math.random() * 700, 1400, 0.07, "sine", 0.15, i * 0.07); break;
      case "lightning": this.noise(0.3, 5000, 1500, 0.25, 2); this.tone(1400, 2200, 0.25, "square", 0.06); break;
      case "shield": this.tone(440, 440, 0.6, "sine", 0.15); this.tone(660, 660, 0.6, "sine", 0.1, 0.05); break;
    }
  }

  /** Play whatever this step's events call for. */
  handle(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === "swing") this.swing(e.dash);
      else if (e.type === "hit") this.hit(e.dash || e.boosted);
      else if (e.type === "block") this.block();
      else if (e.type === "power") this.power(e.effect);
      else if (e.type === "spawn") this.spawn();
      else if (e.type === "ko") this.ko();
    }
  }
}
