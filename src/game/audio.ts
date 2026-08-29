/* Synthesized SFX — no external assets. */

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private noise(dur: number, gain: number, freq: number, q = 1, type: BiquadFilterType = "bandpass", delay = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    delay = 0
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** volume by distance: 1 near, 0 far */
  private att(dist: number, max = 760) {
    return Math.max(0, Math.min(1, 1 - dist / max));
  }

  shot(kind: number, dist = 0) {
    const v = this.att(dist);
    if (v <= 0.01) return;
    if (kind === 0) {
      this.tone("square", 210, 80, 0.09, 0.22 * v);
      this.noise(0.08, 0.3 * v, 1900, 0.9);
    } else if (kind === 1) {
      this.tone("square", 130, 46, 0.2, 0.3 * v);
      this.noise(0.2, 0.5 * v, 820, 0.7, "lowpass");
      this.noise(0.08, 0.25 * v, 2400, 1);
    } else if (kind === 2) {
      this.tone("square", 300, 120, 0.05, 0.14 * v);
      this.noise(0.05, 0.2 * v, 2600, 0.8);
    } else {
      this.tone("sawtooth", 190, 55, 0.13, 0.28 * v);
      this.noise(0.14, 0.4 * v, 2900, 1.2);
    }
  }

  hit() {
    this.tone("triangle", 950, 620, 0.045, 0.16);
  }
  kill() {
    this.tone("square", 520, 90, 0.16, 0.2);
    this.noise(0.2, 0.25, 500, 0.8, "lowpass");
  }
  boom() {
    this.tone("sawtooth", 120, 34, 0.4, 0.4);
    this.noise(0.5, 0.5, 300, 0.5, "lowpass");
  }
  hurt() {
    this.tone("sawtooth", 130, 70, 0.18, 0.3);
    this.noise(0.12, 0.2, 400, 0.7, "lowpass");
  }
  dash() {
    this.noise(0.22, 0.18, 900, 0.6, "highpass");
  }
  reload(stage: number) {
    if (stage === 0) this.tone("square", 700, 500, 0.04, 0.12);
    else this.tone("square", 500, 820, 0.05, 0.14);
  }
  pickup() {
    this.tone("sine", 520, 980, 0.12, 0.2);
    this.tone("sine", 780, 1400, 0.12, 0.12, 0.07);
  }
  weaponGet() {
    this.tone("square", 300, 300, 0.07, 0.16);
    this.tone("square", 450, 450, 0.07, 0.16, 0.09);
    this.tone("square", 620, 620, 0.12, 0.18, 0.18);
  }
  wave() {
    this.tone("sawtooth", 65, 98, 0.6, 0.24);
    this.noise(0.7, 0.16, 220, 0.5, "lowpass");
    this.tone("sawtooth", 98, 65, 0.5, 0.18, 0.65);
  }
  click() {
    this.tone("square", 900, 700, 0.03, 0.08);
  }
  empty() {
    this.tone("square", 240, 180, 0.05, 0.1);
  }
  buff() {
    this.tone("sine", 420, 880, 0.1, 0.18);
    this.tone("sine", 660, 1320, 0.12, 0.14, 0.08);
  }
  debuff() {
    this.tone("sawtooth", 320, 120, 0.2, 0.2);
    this.tone("sawtooth", 220, 90, 0.2, 0.14, 0.05);
  }
  surprise() {
    this.tone("square", 500, 500, 0.06, 0.14);
    this.tone("square", 380, 380, 0.06, 0.14, 0.08);
    this.tone("square", 700, 700, 0.1, 0.16, 0.16);
  }
  armor() {
    this.tone("square", 240, 240, 0.08, 0.16);
    this.tone("square", 360, 360, 0.1, 0.14, 0.09);
  }
  upgrade() {
    this.tone("square", 400, 400, 0.06, 0.15);
    this.tone("square", 600, 600, 0.06, 0.15, 0.07);
    this.tone("square", 900, 900, 0.12, 0.18, 0.14);
  }
  boss(dist = 0) {
    const v = this.att(dist);
    if (v <= 0.01) return;
    this.tone("sawtooth", 90, 40, 0.5, 0.35 * v);
    this.tone("sawtooth", 60, 30, 0.6, 0.3 * v, 0.1);
    this.noise(0.6, 0.3 * v, 180, 0.5, "lowpass");
  }
  rocket(dist = 0) {
    const v = this.att(dist);
    if (v <= 0.01) return;
    this.tone("sawtooth", 900, 200, 0.35, 0.22 * v);
    this.noise(0.4, 0.3 * v, 700, 0.6, "highpass");
  }
  explosion(dist = 0) {
    const v = this.att(dist);
    if (v <= 0.01) return;
    this.tone("sawtooth", 110, 30, 0.5, 0.4 * v);
    this.noise(0.6, 0.5 * v, 260, 0.5, "lowpass");
  }
}
