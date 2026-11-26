import { Sfx } from "./audio";
import { loadScores, pushScore, qualifies } from "./scores";
import {
  CAP,
  type Mode,
  type ScoreEntry,
  type Snapshot,
  type UpgradeKind,
} from "./types";

/**
 * Movement yaw for the controls probe: 0 faces screen-up, +yaw is CCW
 * (nose / velocity toward screen-left). Screen space is +x right, +y down,
 * so forward = (-sin(yaw), -cos(yaw)). A/← adds -x. This is strafe, not chase-cam steer.
 */
export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  setSteer?: (v: number) => void;
  setKeys?: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
  }
}

const STEP = 1 / 60;
const MUTE_KEY = "sadeem.mute";
const SHAKE_KEY = "sadeem.shake";
const AUTO_KEY = "sadeem.autofire";

type Kind = "skiff" | "dart" | "turret" | "boss";

type Enemy = {
  alive: boolean;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  score: number;
  phase: number;
  flash: number;
  fireCd: number;
};

type Bullet = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  friendly: boolean;
  dmg: number;
};

type Part = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
};

type Flash = {
  alive: boolean;
  x: number;
  y: number;
  a: number;
  life: number;
  max: number;
  mag: number;
};

type Popup = {
  alive: boolean;
  x: number;
  y: number;
  life: number;
  text: string;
};

type Star = { x: number; y: number; z: number; ice: boolean };

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function swept(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = clamp(((cx - x0) * dx + (cy - y0) * dy) / len2, 0, 1);
  const px = x0 + dx * t - cx;
  const py = y0 + dy * t - cy;
  return px * px + py * py <= radius * radius;
}

function wrap(a: number): number {
  const t = Math.PI * 2;
  let x = a;
  while (x > Math.PI) x -= t;
  while (x < -Math.PI) x += t;
  return x;
}

function makeEnemy(): Enemy {
  return {
    alive: false,
    kind: "skiff",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 16,
    hp: 1,
    maxHp: 1,
    speed: 80,
    score: 100,
    phase: 0,
    flash: 0,
    fireCd: 1,
  };
}

function makeBullet(): Bullet {
  return {
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 3,
    life: 0,
    friendly: true,
    dmg: 1,
  };
}

function makePart(): Part {
  return { alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: "#fff" };
}

function makeFlash(): Flash {
  return { alive: false, x: 0, y: 0, a: 0, life: 0, max: 0.07, mag: 1 };
}

function makePopup(): Popup {
  return { alive: false, x: 0, y: 0, life: 0, text: "" };
}

const SPREAD: number[][] = [
  [0],
  [-0.16, 0, 0.16],
  [-0.3, -0.15, 0, 0.15, 0.3],
  [-0.2, -0.1, 0, 0.1, 0.2],
  [-0.46, -0.24, -0.1, 0, 0.1, 0.24, 0.46],
];

export class Game {
  private ctx: CanvasRenderingContext2D;
  private sfx = new Sfx();
  private raf = 0;
  private running = false;
  private last = 0;
  private acc = 0;
  private time = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private ro: ResizeObserver;
  private onChange: (snap: Snapshot) => void;
  private sig = "";

  private mode: Mode = "menu";
  private score = 0;
  private wave = 1;
  private lives = 3;
  private shield = 0;
  private shieldMax = 0;
  private multi = 0;
  private speedLv = 0;
  private combo = 0;
  private comboT = 0;
  private banner = "";
  private bannerT = 0;
  private clearTimer = 0.6;
  private spawnTimer = 0.4;
  private queue: Kind[] = [];
  private trauma = 0;
  private hitstop = 0;
  private shakeOn = true;
  private autoFire = false;
  private muted = false;
  private reduced = false;
  private saved = false;
  private qualifiesRun = false;
  private scores: ScoreEntry[] = [];
  private movementYaw = 0;
  private qaKeys: Set<string> | null = null;
  private qaSteer = 0;
  private keys = new Set<string>();
  private pointer = { x: 0, y: 0, inside: false, down: false, seen: false };
  private stick = { x: 0, y: 0, active: false };
  private fireHeld = false;
  private aimingPointer = false;
  private stars: Star[] = [];
  private enemies: Enemy[] = Array.from({ length: 40 }, makeEnemy);
  private bullets: Bullet[] = Array.from({ length: 280 }, makeBullet);
  private parts: Part[] = Array.from({ length: 380 }, makePart);
  private flashes: Flash[] = Array.from({ length: 36 }, makeFlash);
  private popups: Popup[] = Array.from({ length: 24 }, makePopup);

  private player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: -Math.PI / 2,
    fireCd: 0,
    iframes: 0,
    flash: 0,
    regen: 0,
    recoil: 0,
  };

  constructor(canvas: HTMLCanvasElement, onChange: (snap: Snapshot) => void) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unsupported");
    this.ctx = ctx;
    this.onChange = onChange;
    this.canvas = canvas;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.scores = loadScores();
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
      const shake = localStorage.getItem(SHAKE_KEY);
      this.shakeOn = shake === null ? !this.reduced : shake === "1";
      const auto = localStorage.getItem(AUTO_KEY);
      this.autoFire =
        auto === null ? window.matchMedia("(pointer: coarse)").matches : auto === "1";
    } catch {
      /* ignore */
    }
    this.sfx.muted = this.muted;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.bind();
  }

  private canvas: HTMLCanvasElement;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    window.__controlsTest = {
      getYaw: () => this.movementYaw,
      getSpeed: () => Math.hypot(this.player.vx, this.player.vy),
      setSteer: (v) => {
        this.qaSteer = v;
      },
      setKeys: (codes) => {
        this.qaKeys = codes.length ? new Set(codes) : null;
      },
    };
    this.emitNow();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unbind();
    if (window.__controlsTest) delete window.__controlsTest;
  }

  begin(): void {
    this.sfx.unlock();
    this.sfx.play("start");
    this.mode = "playing";
    this.score = 0;
    this.wave = 1;
    this.lives = 3;
    this.shield = 0;
    this.shieldMax = 0;
    this.multi = 0;
    this.speedLv = 0;
    this.combo = 0;
    this.comboT = 0;
    this.saved = false;
    this.qualifiesRun = false;
    this.banner = "الموجة 1";
    this.bannerT = 1.7;
    this.clearTimer = 0.7;
    this.hitstop = 0;
    this.trauma = 0;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.facing = -Math.PI / 2;
    this.player.fireCd = 0.2;
    this.player.iframes = 0.6;
    this.player.flash = 0;
    this.player.regen = 0;
    this.player.recoil = 0;
    this.movementYaw = 0;
    this.wipe();
    this.placePlayer();
    this.queueWave(1);
    this.emitNow();
  }

  togglePause(): void {
    if (this.mode === "playing") this.pause();
    else if (this.mode === "paused") this.resume();
  }

  pause(): void {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    this.sfx.play("ui");
    this.emitNow();
  }

  resume(): void {
    if (this.mode !== "paused") return;
    this.mode = "playing";
    this.sfx.play("ui");
    this.emitNow();
  }

  restart(): void {
    this.sfx.unlock();
    this.begin();
  }

  toMenu(): void {
    this.mode = "menu";
    this.wipe();
    this.banner = "";
    this.sfx.play("ui");
    this.emitNow();
  }

  pick(kind: UpgradeKind): void {
    if (this.mode !== "upgrade") return;
    if (kind === "multi") {
      if (this.multi < CAP.multi) this.multi += 1;
      else this.score += 400;
    } else if (kind === "shield") {
      if (this.shieldMax < CAP.shield) {
        this.shieldMax += 1;
        this.shield = this.shieldMax;
        this.player.regen = 0;
      } else this.score += 400;
    } else if (this.speedLv < CAP.speed) this.speedLv += 1;
    else this.score += 400;
    this.wave += 1;
    this.clearSide(false);
    this.player.iframes = Math.max(this.player.iframes, 0.75);
    this.queueWave(this.wave);
    this.mode = "playing";
    this.banner = this.wave % 5 === 0 ? `طراد — الموجة ${this.wave}` : `الموجة ${this.wave}`;
    this.bannerT = 1.6;
    this.clearTimer = 0.7;
    this.sfx.play("ui");
    this.emitNow();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.sfx.setMuted(this.muted);
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!this.muted) {
      this.sfx.unlock();
      this.sfx.play("ui");
    }
    this.emitNow();
  }

  toggleShake(): void {
    this.shakeOn = !this.shakeOn;
    try {
      localStorage.setItem(SHAKE_KEY, this.shakeOn ? "1" : "0");
    } catch {
      /* ignore */
    }
    this.sfx.play("ui");
    this.emitNow();
  }

  toggleAuto(): void {
    this.autoFire = !this.autoFire;
    try {
      localStorage.setItem(AUTO_KEY, this.autoFire ? "1" : "0");
    } catch {
      /* ignore */
    }
    this.sfx.play("ui");
    this.emitNow();
  }

  saveName(name: string): void {
    if (this.mode !== "over" || this.saved) return;
    const clean = name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 16) || "طيار";
    this.scores = pushScore({
      name: clean,
      score: this.score,
      wave: this.wave,
      at: Date.now(),
    });
    this.saved = true;
    this.sfx.unlock();
    this.sfx.play("upgrade");
    this.emitNow();
  }

  skipSave(): void {
    if (this.mode !== "over") return;
    this.saved = true;
    this.sfx.play("ui");
    this.emitNow();
  }

  setStick(x: number, y: number, active: boolean): void {
    this.stick.x = x;
    this.stick.y = y;
    this.stick.active = active;
  }

  setFire(held: boolean): void {
    this.fireHeld = held;
    if (held) this.sfx.unlock();
  }

  private bind(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("pointerdown", this.onUnlock);
    document.addEventListener("visibilitychange", this.onVis);
    this.canvas.addEventListener("pointerdown", this.onPtrDown);
    this.canvas.addEventListener("pointermove", this.onPtrMove);
    this.canvas.addEventListener("pointerup", this.onPtrUp);
    this.canvas.addEventListener("pointerleave", this.onPtrLeave);
    this.canvas.addEventListener("contextmenu", this.onMenu);
  }

  private unbind(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("pointerdown", this.onUnlock);
    document.removeEventListener("visibilitychange", this.onVis);
    this.canvas.removeEventListener("pointerdown", this.onPtrDown);
    this.canvas.removeEventListener("pointermove", this.onPtrMove);
    this.canvas.removeEventListener("pointerup", this.onPtrUp);
    this.canvas.removeEventListener("pointerleave", this.onPtrLeave);
    this.canvas.removeEventListener("contextmenu", this.onMenu);
  }

  private onUnlock = (): void => {
    this.sfx.unlock();
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.pointer.down = false;
    this.fireHeld = false;
    this.stick.active = false;
  };

  private onVis = (): void => {
    this.last = 0;
    if (document.hidden && this.mode === "playing") this.pause();
    else this.sfx.resume();
  };

  private typingTarget(e: Event): boolean {
    const t = e.target;
    return t instanceof HTMLElement && !!t.closest("button, input, textarea, a");
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.typingTarget(e) && e.code !== "Escape") return;
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.repeat) return;
    this.sfx.unlock();
    if (e.code === "Escape" || e.code === "KeyP") {
      this.togglePause();
      return;
    }
    if (this.mode === "upgrade") {
      if (e.code === "Digit1" || e.code === "Numpad1") this.pick("multi");
      else if (e.code === "Digit2" || e.code === "Numpad2") this.pick("shield");
      else if (e.code === "Digit3" || e.code === "Numpad3") this.pick("speed");
      return;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private rel(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPtrDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.sfx.unlock();
    const p = this.rel(e);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.inside = true;
    this.pointer.down = e.pointerType !== "touch";
    this.pointer.seen = true;
  };

  private onPtrMove = (e: PointerEvent): void => {
    const p = this.rel(e);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.inside = true;
    this.pointer.seen = true;
  };

  private onPtrUp = (): void => {
    this.pointer.down = false;
  };

  private onPtrLeave = (): void => {
    this.pointer.inside = false;
    this.pointer.down = false;
  };

  private onMenu = (e: Event): void => {
    e.preventDefault();
  };

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
    if (!this.stars.length) this.seedStars();
    if (this.mode === "playing" || this.mode === "paused" || this.mode === "upgrade") {
      this.player.x = clamp(this.player.x, 20, this.w - 20);
      this.player.y = clamp(this.player.y, 20, this.h - 20);
    }
  }

  private seedStars(): void {
    const layers = [
      { n: 90, z: 0.16 },
      { n: 56, z: 0.46 },
      { n: 30, z: 0.82 },
    ];
    this.stars = [];
    for (const layer of layers) {
      for (let i = 0; i < layer.n; i++) {
        this.stars.push({
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          z: layer.z + Math.random() * 0.12,
          ice: i % 6 === 0,
        });
      }
    }
  }

  private placePlayer(): void {
    if (this.w < 2) return;
    this.player.x = this.w * 0.5;
    this.player.y = this.h * 0.62;
  }

  private wipe(): void {
    for (const e of this.enemies) e.alive = false;
    for (const b of this.bullets) b.alive = false;
    for (const p of this.parts) p.alive = false;
    for (const f of this.flashes) f.alive = false;
    for (const p of this.popups) p.alive = false;
    this.queue = [];
  }

  private clearSide(friendly: boolean): void {
    for (const b of this.bullets) if (b.alive && b.friendly === friendly) b.alive = false;
  }

  private queueWave(wave: number): void {
    const kinds: Kind[] = [];
    const skiffs = Math.min(16, 6 + wave * 2);
    const darts = Math.min(12, Math.max(0, (wave - 1) * 2));
    const turrets = Math.min(5, Math.max(0, wave - 2));
    for (let i = 0; i < skiffs; i++) kinds.push("skiff");
    for (let i = 0; i < darts; i++) kinds.push("dart");
    for (let i = 0; i < turrets; i++) kinds.push("turret");
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = kinds[i]!;
      kinds[i] = kinds[j]!;
      kinds[j] = tmp;
    }
    if (wave % 5 === 0) kinds.push("boss");
    this.queue = kinds;
    this.spawnTimer = 0.32;
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    if (!this.last) this.last = now;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    const freeze = this.mode === "playing" && this.hitstop > 0 && !this.qaKeys;
    if (freeze) {
      this.hitstop = Math.max(0, this.hitstop - dt);
    } else if (this.mode === "playing") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 5) {
        this.step(STEP);
        this.acc -= STEP;
        steps += 1;
      }
    } else {
      this.acc = 0;
      this.driftStars(dt, 0, 26);
      this.decayFx(dt);
      if (this.mode === "menu" && Math.random() < dt * 5) {
        this.spawnPart(
          Math.random() * this.w,
          this.h + 8,
          (Math.random() - 0.5) * 16,
          -28 - Math.random() * 36,
          2.4,
          1.6,
          Math.random() > 0.7 ? "#e8c36a" : "#3ddcb5",
        );
      }
    }
    this.draw();
    this.emitIfNeeded();
    this.raf = requestAnimationFrame(this.loop);
  };

  private maxSpeed(): number {
    return 268 * (1 + this.speedLv * 0.18);
  }

  private fireDelay(): number {
    if (this.multi >= 4) return 0.098;
    if (this.multi === 3) return 0.118;
    return 0.15;
  }

  private readMove(): { x: number; y: number; keyed: boolean } {
    const keys = this.qaKeys ?? this.keys;
    let ix = 0;
    let iy = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) iy -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) iy += 1;
    if (this.qaSteer) ix -= this.qaSteer;
    const mag = Math.hypot(ix, iy);
    if (mag > 0) {
      const s = mag > 1 ? 1 / mag : 1;
      return { x: ix * s, y: iy * s, keyed: true };
    }
    if (this.qaKeys) return { x: 0, y: 0, keyed: false };
    if (this.stick.active) {
      const sl = Math.hypot(this.stick.x, this.stick.y);
      if (sl > 0.18) {
        const scale = Math.min(1, (sl - 0.18) / 0.82);
        return { x: (this.stick.x / sl) * scale, y: (this.stick.y / sl) * scale, keyed: true };
      }
    }
    if (this.pointer.inside) {
      const dx = this.pointer.x - this.player.x;
      const dy = this.pointer.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      const stop = 28;
      if (dist > stop) {
        const ease = Math.min(1, (dist - stop) / 140);
        return { x: (dx / dist) * ease, y: (dy / dist) * ease, keyed: false };
      }
    }
    return { x: 0, y: 0, keyed: false };
  }

  private step(dt: number): void {
    const move = this.readMove();
    const max = this.maxSpeed();
    const k = 1 - Math.exp(-13 * dt);
    this.player.vx += (move.x * max - this.player.vx) * k;
    this.player.vy += (move.y * max - this.player.vy) * k;
    this.player.x += this.player.vx * dt;
    this.player.y += this.player.vy * dt;
    const pad = 22;
    if (this.player.x < pad) {
      this.player.x = pad;
      this.player.vx = Math.max(0, this.player.vx);
    } else if (this.player.x > this.w - pad) {
      this.player.x = this.w - pad;
      this.player.vx = Math.min(0, this.player.vx);
    }
    if (this.player.y < pad) {
      this.player.y = pad;
      this.player.vy = Math.max(0, this.player.vy);
    } else if (this.player.y > this.h - pad) {
      this.player.y = this.h - pad;
      this.player.vy = Math.min(0, this.player.vy);
    }
    const sp = Math.hypot(this.player.vx, this.player.vy);
    if (sp > 24) this.movementYaw = Math.atan2(-this.player.vx, -this.player.vy);

    let aim: number | null = null;
    if (this.qaKeys) {
      if (sp > 24) aim = Math.atan2(this.player.vy, this.player.vx);
      this.aimingPointer = false;
    } else if (move.keyed && this.pointer.inside && this.pointer.seen) {
      aim = Math.atan2(this.pointer.y - this.player.y, this.pointer.x - this.player.x);
      this.aimingPointer = true;
    } else if (!move.keyed && this.pointer.inside && this.pointer.seen) {
      aim = Math.atan2(this.pointer.y - this.player.y, this.pointer.x - this.player.x);
      this.aimingPointer = false;
    } else {
      this.aimingPointer = false;
      const near = this.nearest(680);
      if (near) aim = Math.atan2(near.y - this.player.y, near.x - this.player.x);
      else if (sp > 24) aim = Math.atan2(this.player.vy, this.player.vx);
    }
    if (aim !== null) {
      const diff = wrap(aim - this.player.facing);
      const maxTurn = 14 * dt;
      this.player.facing += clamp(diff, -maxTurn, maxTurn);
    }

    this.player.fireCd -= dt;
    this.player.iframes = Math.max(0, this.player.iframes - dt);
    this.player.flash = Math.max(0, this.player.flash - dt);
    this.player.recoil = Math.max(0, this.player.recoil - dt * 7);
    this.trauma = Math.max(0, this.trauma - dt * 1.65);
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner = "";
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (this.shieldMax > 0 && this.shield < this.shieldMax) {
      this.player.regen += dt;
      if (this.player.regen >= 12) {
        this.player.regen = 0;
        this.shield += 1;
        this.sfx.play("shield");
      }
    } else this.player.regen = 0;

    if (this.wantFire() && this.player.fireCd <= 0) this.shoot();

    if (!this.reduced && sp > 50 && Math.random() < 0.55) {
      const a = this.player.facing;
      this.spawnPart(
        this.player.x - Math.cos(a) * 16,
        this.player.y - Math.sin(a) * 16,
        -Math.cos(a) * 50 + (Math.random() - 0.5) * 24,
        -Math.sin(a) * 50 + (Math.random() - 0.5) * 24,
        0.22,
        2,
        "#3ddcb5",
      );
    }

    this.driftStars(dt, this.player.vx, this.player.vy);
    this.tickSpawns(dt);
    this.tickEnemies(dt);
    this.separate();
    this.tickBullets(dt);
    this.touchPlayer();
    this.decayFx(dt);
    this.maybeClear(dt);
  }

  private wantFire(): boolean {
    if (this.qaKeys) return this.qaKeys.has("Space");
    if (this.keys.has("Space") || this.pointer.down || this.fireHeld) return true;
    return this.autoFire && this.nearest(900) !== null;
  }

  private shoot(): void {
    const a = this.player.facing;
    const mx = this.player.x + Math.cos(a) * 20;
    const my = this.player.y + Math.sin(a) * 20;
    const spread = SPREAD[this.multi] ?? SPREAD[0]!;
    for (const off of spread) {
      const ang = a + off;
      this.spawnBullet(mx, my, ang, 760, true, 1, 3.3, 0.85);
    }
    this.spawnFlash(mx, my, a, 0.85 + this.multi * 0.12);
    this.player.fireCd = this.fireDelay();
    this.player.recoil = 1;
    this.trauma = Math.min(1, this.trauma + 0.045);
    this.sfx.play("shoot");
  }

  private tickSpawns(dt: number): void {
    if (!this.queue.length) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const kind = this.queue.shift();
    if (!kind) return;
    this.spawnEnemy(kind);
    this.spawnTimer = kind === "boss" ? 0.25 : 0.36;
  }

  private spawnEnemy(kind: Kind): void {
    const e = this.enemies.find((item) => !item.alive);
    if (!e || this.w < 2) return;
    const margin = 40;
    let x = this.w * 0.5;
    let y = -margin;
    for (let attempt = 0; attempt < 8; attempt++) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) {
        x = Math.random() * this.w;
        y = -margin;
      } else if (side === 1) {
        x = this.w + margin;
        y = Math.random() * this.h;
      } else if (side === 2) {
        x = Math.random() * this.w;
        y = this.h + margin;
      } else {
        x = -margin;
        y = Math.random() * this.h;
      }
      const dx = x - this.player.x;
      const dy = y - this.player.y;
      if (dx * dx + dy * dy > 200 * 200) break;
    }
    e.alive = true;
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.vx = 0;
    e.vy = 0;
    e.phase = Math.random() * Math.PI * 2;
    e.flash = 0;
    e.fireCd = 0.9 + Math.random() * 0.4;
    const wave = this.wave;
    if (kind === "skiff") {
      e.r = 16;
      e.maxHp = e.hp = 2 + Math.floor((wave - 1) / 2);
      e.speed = 74 + wave * 7;
      e.score = 110 + wave * 6;
    } else if (kind === "dart") {
      e.r = 11;
      e.maxHp = e.hp = 1 + Math.floor(wave / 6);
      e.speed = 214 + wave * 5;
      e.score = 160 + wave * 5;
      const ang = Math.atan2(this.player.y - y, this.player.x - x);
      e.vx = Math.cos(ang) * e.speed;
      e.vy = Math.sin(ang) * e.speed;
    } else if (kind === "turret") {
      e.r = 18;
      e.maxHp = e.hp = 5 + Math.floor(wave * 0.85);
      e.speed = 50 + wave * 2;
      e.score = 280 + wave * 8;
    } else {
      e.r = 46;
      e.maxHp = e.hp = 34 + wave * 8;
      e.speed = 34;
      e.score = 2200 + wave * 50;
      e.x = this.w * 0.5;
      e.y = Math.min(110, this.h * 0.2);
      e.fireCd = 1.1;
    }
  }

  private tickEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.phase += dt;
      e.flash = Math.max(0, e.flash - dt);
      e.fireCd -= dt;
      if (e.kind === "dart") {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.x < -120 || e.y < -120 || e.x > this.w + 120 || e.y > this.h + 120) e.alive = false;
        continue;
      }
      if (e.kind === "boss") {
        e.x = this.w * 0.5 + Math.sin(e.phase * 0.5) * Math.min(200, this.w * 0.28);
        e.y = Math.min(120, this.h * 0.18) + Math.sin(e.phase * 1.2) * 14;
        if (e.fireCd <= 0) {
          e.fireCd = Math.max(1.05, 1.55 - this.wave * 0.015);
          const count = 8;
          for (let i = 0; i < count; i++) {
            const a = e.phase * 0.6 + (i / count) * Math.PI * 2;
            this.spawnBullet(e.x, e.y, a, 132, false, 1, 5.4, 4.2);
          }
          const aim = Math.atan2(this.player.y - e.y, this.player.x - e.x);
          this.spawnBullet(e.x, e.y, aim, 248, false, 1, 4.6, 3.4);
        }
        continue;
      }
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      let tx = dx / dist;
      let ty = dy / dist;
      if (e.kind === "turret") {
        const prefer = 230;
        if (dist < prefer - 36) {
          tx = -tx;
          ty = -ty;
        } else if (dist < prefer + 50) {
          const swap = tx;
          tx = -ty;
          ty = swap;
        }
      }
      const weave = e.kind === "skiff" ? 0.42 : 0.12;
      tx += Math.cos(e.phase * 2.3) * weave;
      ty += Math.sin(e.phase * 1.9) * weave;
      const tm = Math.hypot(tx, ty) || 1;
      e.vx = (tx / tm) * e.speed;
      e.vy = (ty / tm) * e.speed;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const lim = 54;
      e.x = clamp(e.x, -lim, this.w + lim);
      e.y = clamp(e.y, -lim, this.h + lim);
      if (e.kind === "turret" && e.fireCd <= 0 && dist < 620) {
        e.fireCd = Math.max(0.75, 1.4 - this.wave * 0.03);
        const aim = Math.atan2(dy, dx);
        this.spawnBullet(e.x, e.y, aim, 228 + this.wave * 2, false, 1, 5, 3.5);
      }
    }
  }

  private separate(): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (!a.alive || a.kind === "dart" || a.kind === "boss") continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (!b.alive || b.kind === "dart" || b.kind === "boss") continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r + 10;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 0 || d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }

  private tickBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -50 || b.y < -50 || b.x > this.w + 50 || b.y > this.h + 50) {
        b.alive = false;
        continue;
      }
      if (b.friendly) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (!swept(b.x - b.vx * dt, b.y - b.vy * dt, b.x, b.y, e.x, e.y, e.r + b.r)) continue;
          b.alive = false;
          this.hurtEnemy(e, b.dmg);
          this.spark(b.x, b.y);
          break;
        }
      } else if (!this.qaKeys && this.player.iframes <= 0 && this.mode === "playing") {
        if (swept(b.x - b.vx * dt, b.y - b.vy * dt, b.x, b.y, this.player.x, this.player.y, 12 + b.r)) {
          b.alive = false;
          this.hurtPlayer(b.x, b.y);
        }
      }
    }
  }

  private touchPlayer(): void {
    if (this.qaKeys || this.player.iframes > 0 || this.mode !== "playing") return;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const rr = 12 + e.r * 0.78;
      if (dx * dx + dy * dy <= rr * rr) {
        this.hurtPlayer(e.x, e.y);
        break;
      }
    }
  }

  private hurtEnemy(e: Enemy, dmg: number): void {
    e.hp -= dmg;
    e.flash = 0.09;
    if (e.hp <= 0) this.killEnemy(e);
    else {
      this.sfx.play("hit");
      this.trauma = Math.min(1, this.trauma + 0.1);
    }
  }

  private killEnemy(e: Enemy): void {
    if (!e.alive) return;
    e.alive = false;
    this.combo += 1;
    this.comboT = 2.05;
    const gained = Math.round(e.score * (1 + (this.combo - 1) * 0.22));
    this.score += gained;
    this.spawnPopup(e.x, e.y - e.r, `+${gained}`);
    const n = this.reduced ? 8 : e.kind === "boss" ? 36 : 18;
    this.burst(e.x, e.y, e.kind === "boss" ? "#e8c36a" : "#ff5a36", n, e.kind === "boss" ? 260 : 180, 0.45);
    this.spawnFlash(e.x, e.y, Math.random() * Math.PI, e.kind === "boss" ? 1.8 : 0.7);
    this.hitstop = e.kind === "boss" ? 0.09 : 0.04;
    this.trauma = Math.min(1, this.trauma + (e.kind === "boss" ? 0.9 : 0.36));
    this.sfx.play(e.kind === "boss" ? "boss" : "explode");
  }

  private hurtPlayer(srcX: number, srcY: number): void {
    if (this.qaKeys || this.player.iframes > 0 || this.mode !== "playing") return;
    const dx = this.player.x - srcX;
    const dy = this.player.y - srcY;
    const d = Math.hypot(dx, dy) || 1;
    this.player.vx += (dx / d) * 280;
    this.player.vy += (dy / d) * 280;
    this.player.flash = 0.14;
    this.trauma = Math.min(1, this.trauma + 0.72);
    this.hitstop = 0.07;
    if (this.shield > 0) {
      this.shield -= 1;
      this.player.regen = 0;
      this.player.iframes = 0.6;
      this.burst(this.player.x, this.player.y, "#3ddcb5", this.reduced ? 6 : 16, 170, 0.35);
      this.sfx.play("shield");
      return;
    }
    this.lives -= 1;
    this.player.iframes = 1.4;
    this.burst(this.player.x, this.player.y, "#ff5a36", this.reduced ? 8 : 22, 210, 0.5);
    this.sfx.play("hurt");
    if (this.lives <= 0) this.finish();
  }

  private finish(): void {
    if (this.mode === "over") return;
    this.mode = "over";
    this.banner = "";
    this.qualifiesRun = qualifies(this.score, this.scores);
    this.saved = this.score <= 0;
    this.burst(this.player.x, this.player.y, "#e8f4ef", this.reduced ? 10 : 28, 240, 0.6);
    this.sfx.play("over");
  }

  private maybeClear(dt: number): void {
    if (this.mode !== "playing") return;
    const pending = this.queue.length > 0 || this.enemies.some((e) => e.alive);
    if (pending) {
      this.clearTimer = 0.65;
      return;
    }
    this.clearTimer -= dt;
    if (this.clearTimer <= 0) {
      this.mode = "upgrade";
      this.banner = "";
      this.sfx.play("upgrade");
    }
  }

  private nearest(range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range * range;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private spawnBullet(
    x: number,
    y: number,
    angle: number,
    speed: number,
    friendly: boolean,
    dmg: number,
    r: number,
    life: number,
  ): void {
    const b = this.bullets.find((item) => !item.alive);
    if (!b) return;
    b.alive = true;
    b.x = x;
    b.y = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.friendly = friendly;
    b.dmg = dmg;
    b.r = r;
    b.life = life;
  }

  private spawnFlash(x: number, y: number, a: number, mag: number): void {
    const f = this.flashes.find((item) => !item.alive);
    if (!f) return;
    f.alive = true;
    f.x = x;
    f.y = y;
    f.a = a;
    f.mag = mag;
    f.max = 0.07;
    f.life = f.max;
  }

  private spawnPart(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: string,
  ): void {
    const p = this.parts.find((item) => !item.alive);
    if (!p) return;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.max = life;
    p.size = size;
    p.color = color;
  }

  private burst(x: number, y: number, color: string, n: number, speed: number, life: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const s = speed * (0.35 + Math.random() * 0.75);
      this.spawnPart(
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        life * (0.55 + Math.random() * 0.6),
        1.4 + Math.random() * 2.4,
        color,
      );
    }
  }

  private spark(x: number, y: number): void {
    this.burst(x, y, "#d9fff4", this.reduced ? 2 : 5, 120, 0.18);
  }

  private spawnPopup(x: number, y: number, text: string): void {
    const p = this.popups.find((item) => !item.alive);
    if (!p) return;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.life = 0.7;
    p.text = text;
  }

  private decayFx(dt: number): void {
    const damp = Math.exp(-1.6 * dt);
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= damp;
      p.vy *= damp;
    }
    for (const f of this.flashes) {
      if (!f.alive) continue;
      f.life -= dt;
      if (f.life <= 0) f.alive = false;
    }
    for (const p of this.popups) {
      if (!p.alive) continue;
      p.life -= dt;
      p.y -= 28 * dt;
      if (p.life <= 0) p.alive = false;
    }
  }

  private driftStars(dt: number, pvx: number, pvy: number): void {
    if (this.w < 2 || this.h < 2) return;
    for (const s of this.stars) {
      const depth = 0.25 + s.z;
      s.x += (-pvx * s.z * 0.45 + Math.sin(this.time * 0.15 + s.y) * 2) * dt;
      s.y += (-pvy * s.z * 0.45 + 16 * depth) * dt;
      if (s.x < 0) s.x += this.w;
      else if (s.x >= this.w) s.x -= this.w;
      if (s.y < 0) s.y += this.h;
      else if (s.y >= this.h) s.y -= this.h;
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#070b10";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.w < 2 || this.h < 2) return;
    const shakeAmt = !this.shakeOn || this.reduced ? 0 : this.trauma * this.trauma;
    const sx = shakeAmt * 14 * Math.sin(this.time * 43);
    const sy = shakeAmt * 10 * Math.cos(this.time * 37);
    const rot = shakeAmt * 0.018 * Math.sin(this.time * 31);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, sx * this.dpr, sy * this.dpr);
    ctx.translate(this.w / 2, this.h / 2);
    ctx.rotate(rot);
    ctx.translate(-this.w / 2, -this.h / 2);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    this.drawNebula(ctx);
    this.drawStars(ctx);
    this.drawBullets(ctx, false);
    for (const e of this.enemies) if (e.alive) this.drawEnemy(ctx, e);
    this.drawBullets(ctx, true);
    this.drawParts(ctx);
    if (this.mode === "menu") this.drawMenuShip(ctx);
    else if (this.lives > 0 || this.mode !== "over") this.drawPlayer(ctx);
    else this.drawPlayer(ctx);
    this.drawFlashes(ctx);
    this.drawPopups(ctx);
    if (this.mode === "playing" && this.aimingPointer) this.drawCrosshair(ctx);
    this.drawVignette(ctx);
  }

  private drawNebula(ctx: CanvasRenderingContext2D): void {
    const blobs = [
      { x: this.w * 0.2 + Math.sin(this.time * 0.07) * 30, y: this.h * 0.3, r: this.w * 0.38, c: "rgba(61,220,181,0.07)" },
      { x: this.w * 0.78, y: this.h * 0.72 + Math.cos(this.time * 0.05) * 24, r: this.w * 0.34, c: "rgba(255,90,54,0.05)" },
      { x: this.w * 0.55, y: this.h * 0.18, r: this.w * 0.22, c: "rgba(232,195,106,0.04)" },
    ];
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, b.c);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStars(ctx: CanvasRenderingContext2D): void {
    for (const s of this.stars) {
      const size = s.z < 0.35 ? 1 : s.z < 0.65 ? 1.5 : 2.2;
      const alpha = 0.25 + s.z * 0.65;
      if (s.z > 0.7) {
        ctx.fillStyle = s.ice ? `rgba(61,220,181,${alpha * 0.35})` : `rgba(232,195,106,${alpha * 0.35})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, size * 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = s.ice ? `rgba(186,255,236,${alpha})` : `rgba(232,244,239,${alpha})`;
      ctx.fillRect(s.x, s.y, size, size);
    }
  }

  private drawBullets(ctx: CanvasRenderingContext2D, friendly: boolean): void {
    for (const b of this.bullets) {
      if (!b.alive || b.friendly !== friendly) continue;
      if (friendly) {
        ctx.strokeStyle = "rgba(126,246,220,0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
        ctx.stroke();
        ctx.fillStyle = "#f4fffc";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#ff5a36";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,214,190,0.9)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy): void {
    const face =
      e.kind === "boss" || e.kind === "turret"
        ? Math.atan2(this.player.y - e.y, this.player.x - e.x)
        : Math.atan2(e.vy, e.vx);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(face);
    if (e.kind === "skiff") {
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-12, 11);
      ctx.lineTo(-5, 0);
      ctx.lineTo(-12, -11);
      ctx.closePath();
      ctx.fillStyle = "#8d2c1c";
      ctx.fill();
      ctx.strokeStyle = "#ffb199";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (e.kind === "dart") {
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-14, 4.5);
      ctx.lineTo(-8, 0);
      ctx.lineTo(-14, -4.5);
      ctx.closePath();
      ctx.fillStyle = "#ffd8cc";
      ctx.fill();
    } else if (e.kind === "turret") {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const px = Math.cos(a) * 16;
        const py = Math.sin(a) * 16;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "#5c2418";
      ctx.fill();
      ctx.strokeStyle = "#e8c36a";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = "#ff5a36";
      ctx.fillRect(4, -3, 18, 6);
      if (e.fireCd < 0.28) {
        ctx.strokeStyle = "rgba(255,90,54,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(42, 0);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(42, 0);
      ctx.lineTo(12, 24);
      ctx.lineTo(-28, 28);
      ctx.lineTo(-16, 0);
      ctx.lineTo(-28, -28);
      ctx.lineTo(12, -24);
      ctx.closePath();
      ctx.fillStyle = "#4a160f";
      ctx.fill();
      ctx.strokeStyle = "#e8c36a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#ff5a36";
      ctx.beginPath();
      ctx.arc(8, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.flash > 0) {
      ctx.globalAlpha = Math.min(1, e.flash * 8);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (e.kind === "boss" || e.kind === "turret") {
      const bw = e.kind === "boss" ? 78 : 30;
      const y = e.y - e.r - 12;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(e.x - bw / 2, y, bw, 4);
      ctx.fillStyle = e.kind === "boss" ? "#e8c36a" : "#ff5a36";
      ctx.fillRect(e.x - bw / 2, y, bw * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    if (this.player.iframes > 0 && Math.floor(this.time * 18) % 2 === 0 && this.mode === "playing") {
      ctx.globalAlpha = 0.45;
    }
    ctx.save();
    ctx.translate(this.player.x, this.player.y);
    ctx.rotate(this.player.facing);
    ctx.translate(-this.player.recoil * 5, 0);
    this.paintHull(ctx, this.shield > 0, this.player.flash);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawMenuShip(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.w * 0.22, this.h * 0.56);
    ctx.rotate(-Math.PI / 2 + Math.sin(this.time * 0.8) * 0.28);
    ctx.scale(2.5, 2.5);
    this.paintHull(ctx, true, 0);
    ctx.restore();
  }

  private paintHull(ctx: CanvasRenderingContext2D, shield: boolean, flash: number): void {
    const flicker = 0.7 + Math.sin(this.time * 28) * 0.3;
    ctx.fillStyle = `rgba(61,220,181,${0.85 * flicker})`;
    ctx.beginPath();
    ctx.moveTo(-12, 5);
    ctx.lineTo(-24 - flicker * 8, 7);
    ctx.lineTo(-12, 9);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-12, -5);
    ctx.lineTo(-24 - flicker * 8, -7);
    ctx.lineTo(-12, -9);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(4, 6);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-16, 15);
    ctx.lineTo(-10, 4);
    ctx.lineTo(-16, 3);
    ctx.lineTo(-16, -3);
    ctx.lineTo(-10, -4);
    ctx.lineTo(-16, -15);
    ctx.lineTo(-8, -8);
    ctx.lineTo(4, -6);
    ctx.closePath();
    ctx.fillStyle = "#0c2e29";
    ctx.fill();
    ctx.strokeStyle = "#3ddcb5";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-2, 3.2);
    ctx.lineTo(-2, -3.2);
    ctx.closePath();
    ctx.fillStyle = "#e8f4ef";
    ctx.fill();
    if (shield) {
      ctx.strokeStyle = `rgba(61,220,181,${0.35 + Math.sin(this.time * 3) * 0.15})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = this.time * 0.7 + (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * 28;
        const py = Math.sin(a) * 28;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    if (flash > 0) {
      ctx.globalAlpha = Math.min(1, flash * 7);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawParts(ctx: CanvasRenderingContext2D): void {
    for (const p of this.parts) {
      if (!p.alive) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawFlashes(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of this.flashes) {
      if (!f.alive) continue;
      const k = Math.max(0, f.life / f.max);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.a);
      ctx.fillStyle = `rgba(255,255,255,${0.9 * k})`;
      ctx.beginPath();
      ctx.arc(0, 0, (4 + 8 * k) * f.mag, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(120,255,220,${0.75 * k})`;
      ctx.beginPath();
      ctx.ellipse(8 * k, 0, 18 * f.mag * k, 5 * k + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(22 * f.mag * k, 0);
      ctx.moveTo(0, -4);
      ctx.lineTo(10 * k, -9);
      ctx.moveTo(0, 4);
      ctx.lineTo(10 * k, 9);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawPopups(ctx: CanvasRenderingContext2D): void {
    ctx.font = "600 14px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    for (const p of this.popups) {
      if (!p.alive) continue;
      ctx.globalAlpha = Math.max(0, p.life / 0.7);
      ctx.fillStyle = "#e8c36a";
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D): void {
    const x = this.pointer.x;
    const y = this.pointer.y;
    ctx.strokeStyle = "rgba(61,220,181,0.9)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 16);
    ctx.stroke();
  }

  private drawVignette(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.28,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.72,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, this.lives === 1 && this.mode === "playing" ? "rgba(80,16,8,0.55)" : "rgba(0,0,0,0.5)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private remaining(): number {
    let n = this.queue.length;
    for (const e of this.enemies) if (e.alive) n += 1;
    return n;
  }

  private boss(): { hp: number; max: number } {
    for (const e of this.enemies) {
      if (e.alive && e.kind === "boss") return { hp: e.hp, max: e.maxHp };
    }
    return { hp: 0, max: 0 };
  }

  private snapshot(): Snapshot {
    const boss = this.boss();
    const best = this.scores[0]?.score ?? 0;
    return {
      mode: this.mode,
      score: this.score,
      best,
      wave: this.wave,
      lives: this.lives,
      shield: this.shield,
      shieldMax: this.shieldMax,
      shieldRegen: this.shieldMax > this.shield && this.shieldMax > 0 ? this.player.regen / 12 : 0,
      multi: this.multi,
      speed: this.speedLv,
      combo: this.combo,
      muted: this.muted,
      shake: this.shakeOn,
      autoFire: this.autoFire,
      scores: this.scores.map((row) => ({ ...row })),
      qualifies: this.qualifiesRun,
      saved: this.saved,
      banner: this.bannerT > 0 ? this.banner : "",
      remaining: this.remaining(),
      bossHp: boss.hp,
      bossMax: boss.max,
    };
  }

  private emitNow(): void {
    const snap = this.snapshot();
    this.sig = this.signature(snap);
    this.onChange(snap);
  }

  private emitIfNeeded(): void {
    const snap = this.snapshot();
    const sig = this.signature(snap);
    if (sig === this.sig) return;
    this.sig = sig;
    this.onChange(snap);
  }

  private signature(s: Snapshot): string {
    const regen = Math.round(s.shieldRegen * 16);
    const board = s.scores.map((row) => `${row.name}:${row.score}`).join("|");
    return [
      s.mode,
      s.score,
      s.best,
      s.wave,
      s.lives,
      s.shield,
      s.shieldMax,
      regen,
      s.multi,
      s.speed,
      s.combo,
      s.muted ? 1 : 0,
      s.shake ? 1 : 0,
      s.autoFire ? 1 : 0,
      s.qualifies ? 1 : 0,
      s.saved ? 1 : 0,
      s.banner,
      s.remaining,
      s.bossHp,
      board,
    ].join("~");
  }
}
