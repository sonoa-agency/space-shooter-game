export type Sound =
  | "shoot"
  | "hit"
  | "explode"
  | "hurt"
  | "shield"
  | "upgrade"
  | "start"
  | "over"
  | "boss"
  | "ui";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.42;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.45);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.42, this.ctx.currentTime, 0.02);
    }
  }

  play(kind: Sound): void {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    const jitter = 0.94 + Math.random() * 0.12;
    if (kind === "shoot") this.blip(t, 720 * jitter, "square", 0.05, 0.055);
    else if (kind === "hit") this.blip(t, 240 * jitter, "triangle", 0.06, 0.06);
    else if (kind === "explode") {
      this.noiseBurst(t, 0.16, 0.18);
      this.blip(t, 150 * jitter, "sine", 0.14, 0.08);
    } else if (kind === "hurt") this.blip(t, 88, "sawtooth", 0.22, 0.09);
    else if (kind === "shield") this.blip(t, 540 * jitter, "sine", 0.12, 0.07);
    else if (kind === "upgrade") {
      this.blip(t, 523, "sine", 0.09, 0.05);
      this.blip(t + 0.08, 659, "sine", 0.1, 0.05);
      this.blip(t + 0.16, 784, "sine", 0.14, 0.06);
    } else if (kind === "start") this.blip(t, 392, "triangle", 0.09, 0.05);
    else if (kind === "over") {
      this.noiseBurst(t, 0.32, 0.16);
      this.blip(t, 98, "sawtooth", 0.36, 0.07);
    } else if (kind === "boss") {
      this.noiseBurst(t, 0.36, 0.26);
      this.blip(t, 64, "sine", 0.4, 0.1);
    } else this.blip(t, 640, "square", 0.03, 0.035);
  }

  private blip(
    time: number,
    freq: number,
    type: OscillatorType,
    dur: number,
    gain: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), time + dur);
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      amp.disconnect();
    };
  }

  private noiseBurst(time: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(980, time);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(time);
    src.stop(time + dur);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      amp.disconnect();
    };
  }
}
