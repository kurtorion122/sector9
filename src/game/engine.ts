import { AudioSys } from "./audio";
import {
  MAP_H,
  MAP_W,
  Rect,
  WorldData,
  angNorm,
  clamp,
  collideCircle,
  dist2,
  generateWorld,
  losClear,
  pointBlocked,
  rayDist,
} from "./world";

export type Phase = "menu" | "playing" | "paused" | "over";

export interface HudSlot {
  name: string;
  mag: number;
  reserve: number;
  reload: number; // -1 idle, 0..1 progress
  owned: boolean;
  infinite: boolean;
}
export interface HudData {
  hp: number;
  wave: number;
  left: number;
  score: number;
  best: number;
  newBest: boolean;
  kills: number;
  wi: number;
  slots: HudSlot[];
  dash: number;
  time: number;
}

interface Callbacks {
  onPhase: (p: Phase) => void;
  onHud: (h: HudData) => void;
  onBanner: (title: string, sub: string) => void;
  onMute: (m: boolean) => void;
}

interface WeaponDef {
  name: string;
  dmg: number;
  rate: number;
  speed: number;
  spread: number;
  pellets: number;
  magSize: number;
  reload: number;
  cap: number;
  startReserve: number;
  kick: number;
  len: number;
}

const WEAPONS: WeaponDef[] = [
  { name: "ПМ «ГРОМ»", dmg: 26, rate: 0.26, speed: 980, spread: 0.035, pellets: 1, magSize: 12, reload: 0.85, cap: 999999, startReserve: 999999, kick: 3, len: 16 },
  { name: "«ВЕПРЬ-12»", dmg: 13, rate: 0.82, speed: 830, spread: 0.3, pellets: 7, magSize: 6, reload: 1.8, cap: 48, startReserve: 24, kick: 9, len: 22 },
  { name: "«ШКВАЛ»", dmg: 13, rate: 0.082, speed: 1040, spread: 0.1, pellets: 1, magSize: 34, reload: 1.5, cap: 204, startReserve: 102, kick: 2.2, len: 20 },
  { name: "«ФИЛИН»", dmg: 52, rate: 0.58, speed: 1560, spread: 0.014, pellets: 1, magSize: 8, reload: 1.6, cap: 64, startReserve: 32, kick: 6, len: 26 },
];

interface BotDef {
  name: string;
  hp: number;
  speed: number;
  r: number;
  score: number;
  color: string;
  dark: string;
  sight: number;
  range: number;
  rate: number;
  dmg: number;
  pellets: number;
  bSpeed: number;
}

const BOTS: BotDef[] = [
  { name: "Стрелок", hp: 70, speed: 128, r: 13, score: 100, color: "#ff6a2e", dark: "#7e2c0c", sight: 470, range: 420, rate: 1.0, dmg: 9, pellets: 1, bSpeed: 500 },
  { name: "Жнец", hp: 46, speed: 238, r: 11, score: 150, color: "#ff2e5f", dark: "#7a0f2c", sight: 560, range: 0, rate: 0, dmg: 16, pellets: 0, bSpeed: 0 },
  { name: "Громила", hp: 250, speed: 64, r: 21, score: 300, color: "#e8342e", dark: "#6e120f", sight: 430, range: 350, rate: 1.75, dmg: 8, pellets: 5, bSpeed: 440 },
];

interface Bot {
  kind: number;
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number; r: number;
  dir: number; state: 0 | 1;
  tx: number; ty: number;
  lastSeen: number; seenX: number; seenY: number;
  cool: number; strafe: number; strafeT: number;
  flash: number; spawnT: number; visible: boolean;
  lunge: number;
}

interface Bullet { x: number; y: number; px: number; py: number; vx: number; vy: number; dmg: number; friendly: boolean; life: number; kind: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; drag: number; }
interface Floater { x: number; y: number; txt: string; color: string; t: number; max: number; size: number; }
interface Flash { x: number; y: number; r: number; t: number; max: number; color: string; }
interface Hitmark { x: number; y: number; t: number; big: boolean; }
interface Pickup { kind: 0 | 1 | 2; x: number; y: number; wi: number; t: number; visible: boolean; }
interface PendingSpawn { x: number; y: number; t: number; kind: number; }

const TAU = Math.PI * 2;
const FOV_HALF = 0.95;
const VISION_RANGE = 650;
const AMBIENT_R = 118;
const BEST_KEY = "sector9_best_v1";

function pip(px: number, py: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mmCanvas: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D;
  private cbs: Callbacks;
  audio = new AudioSys();
  vignetteEl: HTMLDivElement | null = null;

  phase: Phase = "menu";

  private viewW = 800;
  private viewH = 600;
  private dpr = 1;

  private floorCv: HTMLCanvasElement;
  private decalCv: HTMLCanvasElement;
  private decalCtx: CanvasRenderingContext2D;
  private exploredCv: HTMLCanvasElement;
  private exploredCtx: CanvasRenderingContext2D;
  private maskCv: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private fogCv: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;

  private world!: WorldData;

  private keys = new Set<string>();
  private mouse = { x: 400, y: 300, down: false };

  private player = { x: 0, y: 0, vx: 0, vy: 0, hp: 100, aim: 0, r: 14 };
  private dashCool = 0;
  private lastHurt = -99;
  private hurtFx = 0;

  private wi = 0;
  private owned = [true, false, false, false];
  private mags = [12, 0, 0, 0];
  private reserves = [999999, 0, 0, 0];
  private reloadT = -1;
  private fireCool = 0;
  private switchCool = 0;
  private recoil = 0;

  private camX = 0;
  private camY = 0;
  private shake = 0;

  private bots: Bot[] = [];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private flashes: Flash[] = [];
  private hitmarks: Hitmark[] = [];
  private pickups: Pickup[] = [];
  private pending: PendingSpawn[] = [];

  private wave = 0;
  private betweenT = 0;
  private waveActive = false;
  private supplyT = 0;

  private score = 0;
  private kills = 0;
  private best = 0;
  private newBest = false;
  private time = 0;
  private demoT = 0;

  private fovPoly: { x: number; y: number }[] = [];
  private raf = 0;
  private last = 0;
  private hudAcc = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, mmCanvas: HTMLCanvasElement, cbs: Callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.mmCanvas = mmCanvas;
    this.mmCtx = mmCanvas.getContext("2d")!;
    this.cbs = cbs;

    this.floorCv = document.createElement("canvas");
    this.decalCv = document.createElement("canvas");
    this.decalCtx = this.decalCv.getContext("2d")!;
    this.exploredCv = document.createElement("canvas");
    this.exploredCtx = this.exploredCv.getContext("2d")!;
    this.maskCv = document.createElement("canvas");
    this.maskCtx = this.maskCv.getContext("2d")!;
    this.fogCv = document.createElement("canvas");
    this.fogCtx = this.fogCv.getContext("2d")!;

    try {
      this.best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
    } catch { this.best = 0; }

    this.newWorld((Math.random() * 1e9) | 0);
    this.onResize();
    this.bind();
    this.pushHud();
    this.last = performance.now();
    const loop = (t: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.033, (t - this.last) / 1000);
      this.last = t;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /* ---------------- lifecycle ---------------- */

  private bind() {
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onVis = this.onVis.bind(this);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.onVis);
    document.addEventListener("visibilitychange", this.onVis);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onCtx);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.onVis);
    document.removeEventListener("visibilitychange", this.onVis);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onCtx);
  }

  private onCtx = (e: Event) => e.preventDefault();

  private onResize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
    this.maskCv.width = this.viewW;
    this.maskCv.height = this.viewH;
    this.fogCv.width = this.viewW;
    this.fogCv.height = this.viewH;
  }

  private onVis() {
    if (this.phase !== "playing") return;
    if (document.hidden || !document.hasFocus()) this.pause();
  }

  private onKeyDown(e: KeyboardEvent) {
    this.audio.ensure();
    const c = e.code;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(c)) e.preventDefault();
    this.keys.add(c);
    if (c === "Escape" || c === "KeyP") {
      if (this.phase === "playing") this.pause();
      else if (this.phase === "paused") this.resume();
      return;
    }
    if (c === "KeyM") {
      this.audio.setMuted(!this.audio.muted);
      this.cbs.onMute(this.audio.muted);
      return;
    }
    if (this.phase !== "playing") {
      if ((c === "Enter" || c === "Space") && (this.phase === "menu" || this.phase === "over")) this.start();
      return;
    }
    if (c === "KeyR") this.startReload(true);
    if (c === "ShiftLeft" || c === "ShiftRight" || c === "Space") this.tryDash();
    for (let i = 0; i < 4; i++) if (c === `Digit${i + 1}`) this.switchWeapon(i);
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }

  private onMouseMove(e: MouseEvent) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  }

  private onMouseDown(e: MouseEvent) {
    this.audio.ensure();
    if (e.button === 0) this.mouse.down = true;
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 0) this.mouse.down = false;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (this.phase !== "playing") return;
    const dir = e.deltaY > 0 ? 1 : -1;
    for (let step = 1; step <= 4; step++) {
      const idx = (this.wi + dir * step + 4) % 4;
      if (this.owned[idx]) {
        this.switchWeapon(idx);
        break;
      }
    }
  }

  /* ---------------- state control ---------------- */

  private setPhase(p: Phase) {
    this.phase = p;
    this.cbs.onPhase(p);
  }

  start() {
    this.audio.ensure();
    this.newWorld((Math.random() * 1e9) | 0);
    this.exploredCtx.clearRect(0, 0, MAP_W, MAP_H);
    this.player.x = this.world.spawn.x;
    this.player.y = this.world.spawn.y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.hp = 100;
    this.wi = 0;
    this.owned = [true, false, false, false];
    this.mags = [WEAPONS[0].magSize, 0, 0, 0];
    this.reserves = [999999, 0, 0, 0];
    this.reloadT = -1;
    this.fireCool = 0;
    this.dashCool = 0;
    this.lastHurt = -99;
    this.score = 0;
    this.kills = 0;
    this.time = 0;
    this.newBest = false;
    this.wave = 0;
    this.betweenT = 1.4;
    this.waveActive = false;
    this.supplyT = 0;
    this.camX = this.camClampX(this.player.x - this.viewW / 2);
    this.camY = this.camClampY(this.player.y - this.viewH / 2);
    this.setPhase("playing");
    this.cbs.onBanner("СЕКТОР-9", "зачистите территорию · держитесь в конусе света");
    this.pushHud();
  }

  pause() {
    if (this.phase !== "playing") return;
    this.mouse.down = false;
    this.shake = 0;
    this.setPhase("paused");
    this.pushHud();
  }

  private camClampX(v: number) {
    return MAP_W <= this.viewW ? (MAP_W - this.viewW) / 2 : clamp(v, 0, MAP_W - this.viewW);
  }
  private camClampY(v: number) {
    return MAP_H <= this.viewH ? (MAP_H - this.viewH) / 2 : clamp(v, 0, MAP_H - this.viewH);
  }

  resume() {
    if (this.phase !== "paused") return;
    this.last = performance.now();
    this.setPhase("playing");
  }

  toMenu() {
    this.setPhase("menu");
    this.demoT = 0;
    this.exploredCtx.clearRect(0, 0, MAP_W, MAP_H);
    this.newWorld((Math.random() * 1e9) | 0);
  }

  private gameOver() {
    this.mouse.down = false;
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* noop */ }
    }
    this.audio.boom();
    this.burst(this.player.x, this.player.y, 40, "#a8ff3e", 320);
    this.burst(this.player.x, this.player.y, 26, "#ff5040", 260);
    this.flashes.push({ x: this.player.x, y: this.player.y, r: 90, t: 0.5, max: 0.5, color: "#c8ff7a" });
    this.shake = 22;
    this.setPhase("over");
    this.pushHud();
  }

  /* ---------------- world / waves ---------------- */

  private newWorld(seed: number) {
    this.world = generateWorld(seed);
    this.bots = [];
    this.bullets = [];
    this.particles = [];
    this.floaters = [];
    this.flashes = [];
    this.hitmarks = [];
    this.pickups = [];
    this.pending = [];
    this.fovPoly = [];
    this.floorCv.width = MAP_W;
    this.floorCv.height = MAP_H;
    this.decalCv.width = MAP_W;
    this.decalCv.height = MAP_H;
    this.exploredCv.width = MAP_W;
    this.exploredCv.height = MAP_H;
    this.paintFloor();
  }

  private paintFloor() {
    const g = this.floorCv.getContext("2d")!;
    const rnd = () => Math.random();
    g.fillStyle = "#0c120e";
    g.fillRect(0, 0, MAP_W, MAP_H);
    // stains
    for (let i = 0; i < 26; i++) {
      const x = rnd() * MAP_W, y = rnd() * MAP_H, r = 60 + rnd() * 180;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(0,0,0,0.30)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // grid
    g.strokeStyle = "rgba(150,220,140,0.055)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= MAP_W; x += 85) { g.moveTo(x, 0); g.lineTo(x, MAP_H); }
    for (let y = 0; y <= MAP_H; y += 85) { g.moveTo(0, y); g.lineTo(MAP_W, y); }
    g.stroke();
    // noise speckle
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(168,255,62,0.03)" : "rgba(0,0,0,0.16)";
      g.fillRect(rnd() * MAP_W, rnd() * MAP_H, 2, 2);
    }
    // sector stencil
    g.save();
    g.translate(MAP_W / 2, MAP_H / 2);
    g.rotate(-0.08);
    g.font = "340px 'Russo One', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(168,255,62,0.045)";
    g.fillText("С-9", 0, 0);
    g.restore();
    // hazard border band
    g.strokeStyle = "rgba(255,176,32,0.28)";
    g.lineWidth = 8;
    g.setLineDash([26, 20]);
    g.strokeRect(24, 24, MAP_W - 48, MAP_H - 48);
    g.setLineDash([]);
  }

  private startWave(n: number) {
    this.wave = n;
    this.waveActive = true;
    this.audio.wave();
    this.cbs.onBanner(`ВОЛНА ${n}`, n === 1 ? "противники на подходе" : "плотность огня нарастает");

    // budget & composition
    const budget = 5 + Math.round(n * 2.3);
    const kinds: number[] = [];
    let spent = 0;
    while (spent < budget) {
      let k = 0;
      const roll = Math.random();
      if (n >= 3 && roll < 0.16) k = 2;
      else if (n >= 2 && roll < 0.45) k = 1;
      const cost = k === 2 ? 2.6 : 1;
      if (spent + cost > budget + 1) k = 0;
      kinds.push(k);
      spent += k === 2 ? 2.6 : 1;
    }
    this.pending = [];
    kinds.forEach((k, i) => {
      const p = this.findSpawnPoint();
      this.pending.push({ x: p.x, y: p.y, t: 0.5 + i * 0.22, kind: k });
    });

    // weapon crates on early waves
    if (n >= 1 && n <= 3 && !this.owned[n]) {
      const spot = this.pickCrateSpot();
      if (spot) this.pickups.push({ kind: 2, x: spot.x, y: spot.y, wi: n, t: 0, visible: false });
    }
  }

  private findSpawnPoint() {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * TAU;
      const d = 560 + Math.random() * 420;
      const x = clamp(this.player.x + Math.cos(a) * d, 90, MAP_W - 90);
      const y = clamp(this.player.y + Math.sin(a) * d, 90, MAP_H - 90);
      if (!pointBlocked(this.world.rects, x, y, 34)) return { x, y };
    }
    return { x: clamp(this.player.x + 600, 90, MAP_W - 90), y: clamp(this.player.y, 90, MAP_H - 90) };
  }

  private pickCrateSpot() {
    const spots = this.world.crateSpots.filter(
      (s) => dist2(s.x, s.y, this.player.x, this.player.y) > 200 * 200
    );
    const pool = spots.length ? spots : this.world.crateSpots;
    return pool.length ? pool[(Math.random() * pool.length) | 0] : { x: this.player.x + 200, y: this.player.y };
  }

  private spawnBot(kind: number, x: number, y: number) {
    const d = BOTS[kind];
    const hpMul = 1 + (this.wave - 1) * 0.09;
    this.bots.push({
      kind, x, y, vx: 0, vy: 0,
      hp: d.hp * hpMul, maxHp: d.hp * hpMul, r: d.r,
      dir: Math.random() * TAU, state: 0,
      tx: x, ty: y, lastSeen: -99, seenX: x, seenY: y,
      cool: 1 + Math.random(), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1 + Math.random() * 2,
      flash: 0, spawnT: 0, visible: false, lunge: 0,
    });
    this.burst(x, y, 8, "#5a7d52", 90);
  }

  /* ---------------- weapons ---------------- */

  private switchWeapon(idx: number) {
    if (idx === this.wi || !this.owned[idx] || this.switchCool > 0) return;
    this.wi = idx;
    this.reloadT = -1;
    this.fireCool = Math.max(this.fireCool, 0.12);
    this.switchCool = 0.16;
    this.audio.click();
    this.pushHud();
  }

  private startReload(manual: boolean) {
    const w = WEAPONS[this.wi];
    if (this.reloadT >= 0) return;
    if (this.mags[this.wi] >= w.magSize) return;
    if (this.wi !== 0 && this.reserves[this.wi] <= 0) {
      if (manual) this.audio.empty();
      return;
    }
    this.reloadT = 0;
    this.audio.reload(0);
  }

  private tryDash() {
    if (this.dashCool > 0 || this.phase !== "playing") return;
    let dx = 0, dy = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;
    if (dx === 0 && dy === 0) { dx = Math.cos(this.player.aim); dy = Math.sin(this.player.aim); }
    const len = Math.hypot(dx, dy) || 1;
    this.player.vx += (dx / len) * 640;
    this.player.vy += (dy / len) * 640;
    this.dashCool = 2.1;
    this.audio.dash();
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: this.player.x, y: this.player.y,
        vx: -(dx / len) * (60 + Math.random() * 120) + (Math.random() - 0.5) * 60,
        vy: -(dy / len) * (60 + Math.random() * 120) + (Math.random() - 0.5) * 60,
        life: 0.3 + Math.random() * 0.2, max: 0.5, size: 5 + Math.random() * 5, color: "rgba(168,255,62,0.5)", drag: 4,
      });
    }
  }

  private fire() {
    const w = WEAPONS[this.wi];
    if (this.reloadT >= 0) return;
    if (this.mags[this.wi] <= 0) {
      if (this.wi !== 0 && this.reserves[this.wi] > 0) this.startReload(false);
      else { this.audio.empty(); this.fireCool = 0.28; }
      return;
    }
    this.mags[this.wi]--;
    this.fireCool = w.rate;
    this.recoil = Math.min(1, this.recoil + 0.55);
    this.shake = Math.min(14, this.shake + w.kick * 0.45);
    const aim = this.player.aim;
    const mx = this.player.x + Math.cos(aim) * (this.player.r + w.len);
    const my = this.player.y + Math.sin(aim) * (this.player.r + w.len);
    for (let p = 0; p < w.pellets; p++) {
      const a = aim + (Math.random() - 0.5) * w.spread * 2 + (w.pellets > 1 ? (p - (w.pellets - 1) / 2) * 0.055 : 0);
      this.bullets.push({
        x: mx, y: my, px: mx, py: my,
        vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
        dmg: w.dmg, friendly: true, life: 1.1, kind: this.wi,
      });
    }
    this.flashes.push({ x: mx, y: my, r: 20 + w.kick * 2.4, t: 0.06, max: 0.06, color: "#ffd98a" });
    this.audio.shot(this.wi, 0);
    // shell casing
    const sa = aim + Math.PI / 2;
    this.particles.push({
      x: mx, y: my, vx: Math.cos(sa) * 120 + (Math.random() - 0.5) * 40, vy: Math.sin(sa) * 120 + (Math.random() - 0.5) * 40,
      life: 0.4, max: 0.4, size: 2.5, color: "#ffb020", drag: 6,
    });
    if (this.mags[this.wi] === 0) this.startReload(false);
  }

  private botFire(b: Bot, def: BotDef) {
    const aim = Math.atan2(this.player.y - b.y, this.player.x - b.x);
    const mx = b.x + Math.cos(aim) * (b.r + 14);
    const my = b.y + Math.sin(aim) * (b.r + 14);
    for (let p = 0; p < Math.max(1, def.pellets); p++) {
      const spread = def.pellets > 1 ? 0.24 : 0.1;
      const a = aim + (Math.random() - 0.5) * spread * 2;
      this.bullets.push({
        x: mx, y: my, px: mx, py: my,
        vx: Math.cos(a) * def.bSpeed, vy: Math.sin(a) * def.bSpeed,
        dmg: def.dmg, friendly: false, life: 1.4, kind: b.kind,
      });
    }
    this.flashes.push({ x: mx, y: my, r: 24, t: 0.07, max: 0.07, color: "#ff9a4d" });
    const d = Math.hypot(this.player.x - b.x, this.player.y - b.y);
    this.audio.shot(b.kind === 2 ? 1 : 2, d);
  }

  /* ---------------- damage / fx ---------------- */

  private burst(x: number, y: number, n: number, color: string, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.3 + Math.random() * 0.45, max: 0.75, size: 2 + Math.random() * 3.4, color, drag: 5,
      });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }

  private blood(x: number, y: number, n: number) {
    this.burst(x, y, n, "#c22333", 170);
    const g = this.decalCtx;
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(120,16,24,${0.25 + Math.random() * 0.3})`;
      g.beginPath();
      g.arc(x + (Math.random() - 0.5) * 26, y + (Math.random() - 0.5) * 26, 2 + Math.random() * 6, 0, TAU);
      g.fill();
    }
  }

  private damageBot(b: Bot, dmg: number) {
    b.hp -= dmg;
    b.flash = 0.1;
    this.blood(b.x, b.y, 5);
    this.hitmarks.push({ x: b.x, y: b.y - b.r - 6, t: 0.18, big: false });
    this.audio.hit();
    if (b.hp <= 0) this.killBot(b);
  }

  private killBot(b: Bot) {
    const def = BOTS[b.kind];
    this.kills++;
    const gained = def.score + this.wave * 10;
    this.score += gained;
    this.floaters.push({ x: b.x, y: b.y - 16, txt: `+${gained}`, color: "#ffb020", t: 0.9, max: 0.9, size: 15 });
    this.hitmarks.push({ x: b.x, y: b.y, t: 0.3, big: true });
    this.burst(b.x, b.y, b.kind === 2 ? 34 : 18, def.color, 300);
    this.blood(b.x, b.y, b.kind === 2 ? 16 : 9);
    this.flashes.push({ x: b.x, y: b.y, r: b.kind === 2 ? 70 : 40, t: 0.25, max: 0.25, color: "#ffb020" });
    if (b.kind === 2) { this.audio.boom(); this.shake = Math.min(18, this.shake + 10); }
    else { this.audio.kill(); this.shake = Math.min(14, this.shake + 3); }
    // drops
    if (this.pickups.length < 9) {
      const roll = Math.random();
      if (roll < 0.09) this.pickups.push({ kind: 0, x: b.x, y: b.y, wi: 0, t: 0, visible: false });
      else if (roll < 0.26) this.pickups.push({ kind: 1, x: b.x, y: b.y, wi: 0, t: 0, visible: false });
    }
    this.bots = this.bots.filter((o) => o !== b);
  }

  private damagePlayer(dmg: number, fromX: number, fromY: number) {
    if (this.phase !== "playing") return;
    this.player.hp -= dmg;
    this.lastHurt = this.time;
    this.hurtFx = 1;
    this.shake = Math.min(20, this.shake + 7);
    this.audio.hurt();
    this.blood(this.player.x, this.player.y, 6);
    this.floaters.push({
      x: this.player.x, y: this.player.y - 22, txt: `-${dmg}`, color: "#ff5040", t: 0.7, max: 0.7, size: 14,
    });
    const a = Math.atan2(this.player.y - fromY, this.player.x - fromX);
    this.player.vx += Math.cos(a) * 120;
    this.player.vy += Math.sin(a) * 120;
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.gameOver();
    }
  }

  /* ---------------- update ---------------- */

  private frame(dt: number) {
    if (this.phase === "playing") this.update(dt);
    else if (this.phase === "menu") this.updateDemo(dt);
    else if (this.phase === "over") this.updateFx(dt);
    this.render();
  }

  private updateDemo(dt: number) {
    this.demoT += dt;
    const cx = MAP_W / 2 + Math.cos(this.demoT * 0.11) * 420;
    const cy = MAP_H / 2 + Math.sin(this.demoT * 0.09) * 300;
    this.camX = this.camClampX(cx - this.viewW / 2);
    this.camY = this.camClampY(cy - this.viewH / 2);
    const px = this.camX + this.viewW / 2;
    const py = this.camY + this.viewH / 2;
    this.player.x = px;
    this.player.y = py;
    const aim = this.demoT * 0.5;
    this.buildFov(px, py, aim);
    this.accumulateExplored();
  }

  private updateFx(dt: number) {
    this.stepParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 26);
    this.stepFloaters(dt);
    for (const f of this.flashes) f.t -= dt;
    this.flashes = this.flashes.filter((f) => f.t > 0);
  }

  private update(dt: number) {
    this.time += dt;
    const P = this.player;

    // --- movement
    let ix = 0, iy = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) ix -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) ix += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) iy -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) iy += 1;
    const il = Math.hypot(ix, iy) || 1;
    const accel = 2500;
    P.vx += (ix / il) * accel * dt;
    P.vy += (iy / il) * accel * dt;
    const fr = Math.exp(-8.2 * dt);
    P.vx *= fr;
    P.vy *= fr;
    const spd = Math.hypot(P.vx, P.vy);
    const maxSpd = 292;
    if (spd > maxSpd && this.dashCool < 1.7) {
      const k = maxSpd / spd;
      P.vx *= k; P.vy *= k;
    }
    P.x += P.vx * dt;
    P.y += P.vy * dt;
    for (let i = 4; i < this.world.rects.length; i++) {
      const res = collideCircle(P.x, P.y, P.r, this.world.rects[i]);
      P.x = res.x; P.y = res.y;
    }
    P.x = clamp(P.x, P.r, MAP_W - P.r);
    P.y = clamp(P.y, P.r, MAP_H - P.r);

    P.aim = Math.atan2(this.mouse.y + this.camY - P.y, this.mouse.x + this.camX - P.x);

    this.dashCool = Math.max(0, this.dashCool - dt);
    this.switchCool = Math.max(0, this.switchCool - dt);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.hurtFx = Math.max(0, this.hurtFx - dt * 2.2);

    // regen
    if (this.time - this.lastHurt > 4.5 && P.hp < 100) P.hp = Math.min(100, P.hp + 3.2 * dt);

    // --- weapon
    this.fireCool -= dt;
    if (this.mouse.down && this.fireCool <= 0) this.fire();
    if (this.reloadT >= 0) {
      const w = WEAPONS[this.wi];
      this.reloadT += dt / w.reload;
      if (this.reloadT >= 1) {
        this.reloadT = -1;
        const need = w.magSize - this.mags[this.wi];
        if (this.wi === 0) this.mags[0] = w.magSize;
        else {
          const take = Math.min(need, this.reserves[this.wi]);
          this.mags[this.wi] += take;
          this.reserves[this.wi] -= take;
        }
        this.audio.reload(1);
        this.pushHud();
      }
    }

    // --- fov
    this.buildFov(P.x, P.y, P.aim);
    this.accumulateExplored();

    // --- waves
    if (!this.waveActive) {
      this.betweenT -= dt;
      if (this.betweenT <= 0) this.startWave(this.wave + 1);
    } else if (this.bots.length === 0 && this.pending.length === 0) {
      this.waveActive = false;
      const bonus = 200 + this.wave * 50;
      this.score += bonus;
      P.hp = Math.min(100, P.hp + 18);
      for (let i = 1; i < 4; i++) {
        if (this.owned[i]) this.reserves[i] = Math.min(WEAPONS[i].cap, this.reserves[i] + Math.round(WEAPONS[i].cap * 0.3));
      }
      this.cbs.onBanner("СЕКТОР ЗАЧИЩЕН", `бонус +${bonus} · аптечка и патроны пополнены`);
      this.audio.pickup();
      this.betweenT = 3.2;
      this.pushHud();
    }

    // pending spawns
    for (const s of this.pending) s.t -= dt;
    for (const s of this.pending) if (s.t <= 0) this.spawnBot(s.kind, s.x, s.y);
    this.pending = this.pending.filter((s) => s.t > 0);

    // supply drops
    this.supplyT += dt;
    if (this.supplyT > 18) {
      this.supplyT = 0;
      if (this.pickups.length < 6) {
        const spot = this.pickCrateSpot();
        this.pickups.push({ kind: Math.random() < 0.5 ? 1 : 0, x: spot.x, y: spot.y, wi: 0, t: 0, visible: false });
      }
    }

    this.updateBots(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.stepParticles(dt);
    this.stepFloaters(dt);
    for (const f of this.flashes) f.t -= dt;
    this.flashes = this.flashes.filter((f) => f.t > 0);
    for (const h of this.hitmarks) h.t -= dt;
    this.hitmarks = this.hitmarks.filter((h) => h.t > 0);

    // camera
    const tx = this.camClampX(P.x - this.viewW / 2);
    const ty = this.camClampY(P.y - this.viewH / 2);
    const cl = 1 - Math.exp(-9 * dt);
    this.camX += (tx - this.camX) * cl;
    this.camY += (ty - this.camY) * cl;

    // hud + vignette
    this.hudAcc += dt;
    if (this.hudAcc >= 0.08) {
      this.hudAcc = 0;
      this.pushHud();
    }
    if (this.vignetteEl) {
      const lowHp = P.hp < 32 ? 0.16 + 0.1 * Math.sin(this.time * 6) : 0;
      this.vignetteEl.style.opacity = String(clamp(this.hurtFx * 0.6 + lowHp, 0, 0.75));
    }
  }

  private updateBots(dt: number) {
    const P = this.player;
    for (const b of this.bots) {
      const def = BOTS[b.kind];
      b.spawnT = Math.min(1, b.spawnT + dt / 0.7);
      b.flash = Math.max(0, b.flash - dt);
      b.cool -= dt;
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = 1 + Math.random() * 1.8; }

      const d2p = dist2(b.x, b.y, P.x, P.y);
      const dp = Math.sqrt(d2p);
      const see = d2p < def.sight * def.sight && losClear(this.world.rects, b.x, b.y, P.x, P.y);

      if (see) {
        if (b.state === 0) {
          // alarm nearby allies
          for (const o of this.bots) {
            if (o !== b && o.state === 0 && dist2(o.x, o.y, b.x, b.y) < 340 * 340) {
              o.state = 1; o.seenX = P.x; o.seenY = P.y; o.lastSeen = this.time;
            }
          }
        }
        b.state = 1;
        b.lastSeen = this.time;
        b.seenX = P.x;
        b.seenY = P.y;
      } else if (b.state === 1 && this.time - b.lastSeen > 5) {
        b.state = 0;
        b.tx = 120 + Math.random() * (MAP_W - 240);
        b.ty = 120 + Math.random() * (MAP_H - 240);
      }

      let mx = 0, my = 0;
      if (b.state === 0) {
        if (dist2(b.x, b.y, b.tx, b.ty) < 60 * 60) {
          b.tx = 120 + Math.random() * (MAP_W - 240);
          b.ty = 120 + Math.random() * (MAP_H - 240);
        }
        const a = Math.atan2(b.ty - b.y, b.tx - b.x);
        mx = Math.cos(a) * def.speed * 0.55;
        my = Math.sin(a) * def.speed * 0.55;
      } else {
        const gx = see ? P.x : b.seenX;
        const gy = see ? P.y : b.seenY;
        const a = Math.atan2(gy - b.y, gx - b.x);
        if (b.kind === 0) {
          const want = dp > def.range * 0.8 ? 1 : dp < 190 ? -0.8 : 0;
          mx = Math.cos(a) * def.speed * want + Math.cos(a + Math.PI / 2) * def.speed * 0.5 * b.strafe;
          my = Math.sin(a) * def.speed * want + Math.sin(a + Math.PI / 2) * def.speed * 0.5 * b.strafe;
        } else if (b.kind === 1) {
          b.lunge = Math.max(0, b.lunge - dt);
          const boost = dp < 150 && b.lunge <= 0 && b.cool <= 0 ? 2.4 : 1;
          if (boost > 1) b.lunge = 1.1;
          mx = Math.cos(a) * def.speed * boost;
          my = Math.sin(a) * def.speed * boost;
          if (dp < b.r + P.r + 6 && b.cool <= 0) {
            b.cool = 0.85;
            this.damagePlayer(def.dmg, b.x, b.y);
          }
        } else {
          const want = dp > 250 ? 1 : 0;
          mx = Math.cos(a) * def.speed * want;
          my = Math.sin(a) * def.speed * want;
        }
      }

      b.vx += (mx - b.vx) * Math.min(1, dt * 6);
      b.vy += (my - b.vy) * Math.min(1, dt * 6);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (let i = 4; i < this.world.rects.length; i++) {
        const res = collideCircle(b.x, b.y, b.r, this.world.rects[i]);
        b.x = res.x; b.y = res.y;
      }
      b.x = clamp(b.x, b.r, MAP_W - b.r);
      b.y = clamp(b.y, b.r, MAP_H - b.r);
      if (Math.hypot(b.vx, b.vy) > 12) b.dir = Math.atan2(b.vy, b.vx);

      // separation
      for (const o of this.bots) {
        if (o === b) continue;
        const d2o = dist2(b.x, b.y, o.x, o.y);
        const min = b.r + o.r + 4;
        if (d2o < min * min && d2o > 0.01) {
          const d = Math.sqrt(d2o);
          b.x += ((b.x - o.x) / d) * (min - d) * 0.5;
          b.y += ((b.y - o.y) / d) * (min - d) * 0.5;
        }
      }

      // shoot
      if (b.kind !== 1 && see && dp < def.range && b.cool <= 0 && b.spawnT >= 1) {
        b.cool = def.rate * (0.85 + Math.random() * 0.4);
        this.botFire(b, def);
      }

      // visibility to player
      b.visible = this.isVisible(b.x, b.y, b.r);
    }
  }

  private updateBullets(dt: number) {
    const P = this.player;
    const rects = this.world.rects;
    for (const bl of this.bullets) {
      bl.px = bl.x;
      bl.py = bl.y;
      bl.x += bl.vx * dt;
      bl.y += bl.vy * dt;
      bl.life -= dt;
      let dead = bl.life <= 0;
      if (!dead) {
        for (let i = 0; i < rects.length; i++) {
          if (this.segHit(bl.px, bl.py, bl.x, bl.y, rects[i]) >= 0) {
            dead = true;
            this.burst(bl.x, bl.y, 4, bl.friendly ? "#d0ff7a" : "#ff9a3d", 120);
            break;
          }
        }
      }
      if (!dead && bl.friendly) {
        for (const b of this.bots) {
          const rr = b.r + 3;
          if (dist2(bl.x, bl.y, b.x, b.y) < rr * rr) {
            dead = true;
            this.damageBot(b, bl.dmg);
            break;
          }
        }
      } else if (!dead && !bl.friendly) {
        const rr = P.r + 2;
        if (dist2(bl.x, bl.y, P.x, P.y) < rr * rr) {
          dead = true;
          this.damagePlayer(bl.dmg, bl.x - bl.vx, bl.y - bl.vy);
        }
      }
      if (dead) bl.life = -1;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  private segHit(x0: number, y0: number, x1: number, y1: number, r: Rect) {
    // inline segRect to avoid extra import churn
    let tmin = 0, tmax = 1;
    const dx = x1 - x0, dy = y1 - y0;
    if (Math.abs(dx) < 1e-9) {
      if (x0 < r.x || x0 > r.x + r.w) return -1;
    } else {
      let t1 = (r.x - x0) / dx, t2 = (r.x + r.w - x0) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    if (Math.abs(dy) < 1e-9) {
      if (y0 < r.y || y0 > r.y + r.h) return -1;
    } else {
      let t1 = (r.y - y0) / dy, t2 = (r.y + r.h - y0) / dy;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  private updatePickups(dt: number) {
    const P = this.player;
    for (const pk of this.pickups) {
      pk.t += dt;
      pk.visible = this.isVisible(pk.x, pk.y, 14);
      const d2p = dist2(pk.x, pk.y, P.x, P.y);
      if (d2p < 30 * 30) {
        pk.t = -999;
        if (pk.kind === 0) {
          P.hp = Math.min(100, P.hp + 35);
          this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "+35 HP", color: "#7dff8a", t: 0.9, max: 0.9, size: 14 });
        } else if (pk.kind === 1) {
          for (let i = 1; i < 4; i++) {
            if (this.owned[i]) this.reserves[i] = Math.min(WEAPONS[i].cap, this.reserves[i] + Math.round(WEAPONS[i].cap * 0.35));
          }
          this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "ПАТРОНЫ +", color: "#ffb020", t: 0.9, max: 0.9, size: 14 });
        } else {
          const wi = pk.wi;
          this.owned[wi] = true;
          this.mags[wi] = WEAPONS[wi].magSize;
          this.reserves[wi] = WEAPONS[wi].startReserve;
          this.switchWeapon(wi);
          this.switchCool = 0;
          this.floaters.push({ x: pk.x, y: pk.y - 14, txt: WEAPONS[wi].name, color: "#a8ff3e", t: 1.2, max: 1.2, size: 16 });
          this.audio.weaponGet();
        }
        if (pk.kind !== 2) this.audio.pickup();
        this.burst(pk.x, pk.y, 10, "#a8ff3e", 140);
        this.pushHud();
      }
    }
    this.pickups = this.pickups.filter((p) => p.t > -900);
  }

  private stepParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy *= dr;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private stepFloaters(dt: number) {
    for (const f of this.floaters) {
      f.t -= dt;
      f.y -= 34 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.t > 0);
  }

  /* ---------------- FOV ---------------- */

  private buildFov(px: number, py: number, aim: number) {
    const rects = this.world.rects;
    const corners = this.world.corners;
    const base = aim - FOV_HALF;
    const span = FOV_HALF * 2;
    const angles: number[] = [0, span];
    for (const c of corners) {
      const rel = ((Math.atan2(c.y - py, c.x - px) - base) % TAU + TAU) % TAU;
      if (rel <= span) {
        angles.push(clamp(rel, 0, span));
        if (rel - 0.0004 >= 0) angles.push(rel - 0.0004);
        if (rel + 0.0004 <= span) angles.push(rel + 0.0004);
      }
    }
    const n = 48;
    for (let i = 1; i < n; i++) angles.push((span * i) / n);
    angles.sort((a, b) => a - b);

    const poly: { x: number; y: number }[] = [{ x: px, y: py }];
    for (const rel of angles) {
      const a = base + rel;
      const d = rayDist(rects, px, py, a, VISION_RANGE);
      poly.push({ x: px + Math.cos(a) * d, y: py + Math.sin(a) * d });
    }
    this.fovPoly = poly;
  }

  private isVisible(x: number, y: number, r: number) {
    const P = this.phase === "menu" ? null : this.player;
    if (!P) return false;
    if (dist2(x, y, P.x, P.y) < (AMBIENT_R + r) * (AMBIENT_R + r)) return true;
    const rel = angNorm(Math.atan2(y - P.y, x - P.x) - P.aim);
    if (Math.abs(rel) > FOV_HALF + 0.08) return false;
    if (dist2(x, y, P.x, P.y) > (VISION_RANGE + r) * (VISION_RANGE + r)) return false;
    return pip(x, y, this.fovPoly);
  }

  private accumulateExplored() {
    const m = this.maskCtx;
    m.clearRect(0, 0, this.viewW, this.viewH);
    const px = this.player.x - this.camX;
    const py = this.player.y - this.camY;
    // ambient circle
    const g1 = m.createRadialGradient(px, py, 0, px, py, AMBIENT_R);
    g1.addColorStop(0, "rgba(255,255,255,0.85)");
    g1.addColorStop(1, "rgba(255,255,255,0)");
    m.fillStyle = g1;
    m.beginPath();
    m.arc(px, py, AMBIENT_R, 0, TAU);
    m.fill();
    // vision cone
    if (this.fovPoly.length > 2) {
      const g2 = m.createRadialGradient(px, py, 0, px, py, VISION_RANGE);
      g2.addColorStop(0, "rgba(255,255,255,0.98)");
      g2.addColorStop(0.45, "rgba(255,255,255,0.92)");
      g2.addColorStop(0.8, "rgba(255,255,255,0.55)");
      g2.addColorStop(1, "rgba(255,255,255,0)");
      m.fillStyle = g2;
      m.beginPath();
      m.moveTo(this.fovPoly[0].x - this.camX, this.fovPoly[0].y - this.camY);
      for (let i = 1; i < this.fovPoly.length; i++) m.lineTo(this.fovPoly[i].x - this.camX, this.fovPoly[i].y - this.camY);
      m.closePath();
      m.fill();
    }
    // accumulate memory (world space) + tint green
    const e = this.exploredCtx;
    e.globalCompositeOperation = "source-over";
    e.globalAlpha = 0.1;
    e.drawImage(this.maskCv, this.camX, this.camY);
    e.globalAlpha = 1;
    e.globalCompositeOperation = "source-in";
    e.fillStyle = "#3fae63";
    e.fillRect(0, 0, MAP_W, MAP_H);
    e.globalCompositeOperation = "source-over";
  }

  /* ---------------- render ---------------- */

  private render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#050807";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const shX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const camX = this.camX + shX;
    const camY = this.camY + shY;

    ctx.save();
    ctx.translate(-camX, -camY);

    ctx.drawImage(this.floorCv, 0, 0);
    ctx.drawImage(this.decalCv, 0, 0);

    // pickups (under fog)
    for (const pk of this.pickups) {
      if (!pk.visible) continue;
      const bob = Math.sin(pk.t * 3.4) * 3;
      const x = pk.x, y = pk.y + bob;
      ctx.save();
      ctx.translate(x, y);
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
      const gc = pk.kind === 0 ? "125,255,138" : pk.kind === 1 ? "255,176,32" : "168,255,62";
      glow.addColorStop(0, `rgba(${gc},0.28)`);
      glow.addColorStop(1, `rgba(${gc},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(-26, -26, 52, 52);
      if (pk.kind === 0) {
        ctx.fillStyle = "#123524";
        ctx.fillRect(-10, -10, 20, 20);
        ctx.strokeStyle = "#7dff8a";
        ctx.lineWidth = 2;
        ctx.strokeRect(-10, -10, 20, 20);
        ctx.fillStyle = "#7dff8a";
        ctx.fillRect(-6, -2, 12, 4);
        ctx.fillRect(-2, -6, 4, 12);
      } else if (pk.kind === 1) {
        ctx.fillStyle = "#3a2c10";
        ctx.fillRect(-11, -8, 22, 16);
        ctx.strokeStyle = "#ffb020";
        ctx.lineWidth = 2;
        ctx.strokeRect(-11, -8, 22, 16);
        ctx.fillStyle = "#ffb020";
        for (let i = -1; i <= 1; i++) ctx.fillRect(i * 6 - 1.5, -5, 3, 10);
      } else {
        ctx.rotate(Math.sin(pk.t * 2) * 0.08);
        ctx.fillStyle = "#1a2a14";
        ctx.fillRect(-14, -9, 28, 18);
        ctx.strokeStyle = "#a8ff3e";
        ctx.lineWidth = 2;
        ctx.strokeRect(-14, -9, 28, 18);
        ctx.fillStyle = "#a8ff3e";
        ctx.font = "11px 'Russo One', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(pk.wi + 1), 0, 1);
      }
      ctx.restore();
    }

    this.drawWalls(ctx);

    if (this.phase !== "menu") {
      this.drawBots(ctx);
      this.drawPlayer(ctx);
    }

    // world-space particles (blood/sparks below fog is fine — flashes on top)
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // ---------- FOG ----------
    const f = this.fogCtx;
    f.globalCompositeOperation = "source-over";
    f.globalAlpha = 1;
    f.fillStyle = "rgba(5,9,7,0.965)";
    f.fillRect(0, 0, this.viewW, this.viewH);
    f.globalCompositeOperation = "destination-out";
    f.drawImage(this.maskCv, 0, 0);
    f.globalAlpha = 0.6;
    f.drawImage(this.exploredCv, -camX, -camY);
    f.globalAlpha = 1;
    f.globalCompositeOperation = "source-over";
    ctx.drawImage(this.fogCv, 0, 0);

    // light tint inside cone
    if (this.fovPoly.length > 2) {
      const px = this.player.x - camX;
      const py = this.player.y - camY;
      const lg = ctx.createRadialGradient(px, py, 0, px, py, VISION_RANGE);
      lg.addColorStop(0, "rgba(255,244,200,0.10)");
      lg.addColorStop(1, "rgba(255,244,200,0)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(this.fovPoly[0].x - camX, this.fovPoly[0].y - camY);
      for (let i = 1; i < this.fovPoly.length; i++) ctx.lineTo(this.fovPoly[i].x - camX, this.fovPoly[i].y - camY);
      ctx.closePath();
      ctx.fill();
    }

    // ---------- ABOVE FOG ----------
    ctx.save();
    ctx.translate(-camX, -camY);
    ctx.globalCompositeOperation = "lighter";

    // bullets/tracers glow through dark
    for (const bl of this.bullets) {
      const col = bl.friendly ? "#d0ff7a" : "#ff9a3d";
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(bl.px, bl.py);
      ctx.lineTo(bl.x, bl.y);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(bl.px, bl.py);
      ctx.lineTo(bl.x, bl.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // muzzle flashes & explosions — light pierces the fog
    for (const fl of this.flashes) {
      const k = fl.t / fl.max;
      const g = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, fl.r);
      g.addColorStop(0, fl.color);
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.globalAlpha = k;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, fl.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // spawn warnings
    for (const s of this.pending) {
      if (s.t < 1.1) {
        const k = 1 - s.t / 1.1;
        ctx.globalAlpha = 0.35 + 0.4 * Math.sin(this.time * 10 + s.x);
        ctx.strokeStyle = "#ff3b30";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 26 - k * 14, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 6, s.y);
        ctx.lineTo(s.x + 6, s.y);
        ctx.moveTo(s.x, s.y - 6);
        ctx.lineTo(s.x, s.y + 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // floaters
    for (const fl of this.floaters) {
      ctx.globalAlpha = clamp(fl.t / fl.max, 0, 1);
      ctx.font = `${fl.size}px 'Russo One', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.txt, fl.x, fl.y);
    }
    ctx.globalAlpha = 1;

    // hit markers
    for (const h of this.hitmarks) {
      const k = h.t / (h.big ? 0.3 : 0.18);
      const s = h.big ? 12 : 7;
      ctx.strokeStyle = h.big ? "#ff5040" : "#ffffff";
      ctx.globalAlpha = k;
      ctx.lineWidth = h.big ? 3 : 2;
      ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        ctx.moveTo(h.x + dx * 3, h.y + dy * 3);
        ctx.lineTo(h.x + dx * s, h.y + dy * s);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // crosshair
    if (this.phase === "playing") this.drawCrosshair(ctx);

    this.drawMinimap();
  }

  private drawWalls(ctx: CanvasRenderingContext2D) {
    const rects = this.world.rects;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (i < 4) {
        ctx.fillStyle = "#141f18";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        continue;
      }
      const isCrate = r.w < 130 && r.h < 130;
      const isPillar = Math.abs(r.w - 64) < 0.01 && Math.abs(r.h - 64) < 0.01;
      if (isPillar) {
        ctx.fillStyle = "#1c2a22";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#35523f";
        ctx.lineWidth = 3;
        ctx.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10);
        ctx.strokeStyle = "#0a0f0c";
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
      } else if (isCrate) {
        ctx.fillStyle = "#243120";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#465c36";
        ctx.lineWidth = 3;
        ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
        ctx.strokeStyle = "rgba(70,92,54,0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x + r.w, r.y + r.h);
        ctx.moveTo(r.x + r.w, r.y);
        ctx.lineTo(r.x, r.y + r.h);
        ctx.stroke();
        ctx.strokeStyle = "#0a0f0c";
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      } else {
        ctx.fillStyle = "#1a2620";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = "#263a2e";
        ctx.fillRect(r.x, r.y, r.w, 5);
        ctx.fillRect(r.x, r.y, 5, r.h);
        ctx.strokeStyle = "#0a0f0c";
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx.fillStyle = "rgba(168,255,62,0.07)";
        ctx.fillRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
      }
    }
  }

  private drawBots(ctx: CanvasRenderingContext2D) {
    for (const b of this.bots) {
      if (!b.visible) continue;
      const def = BOTS[b.kind];
      const alpha = 0.35 + 0.65 * b.spawnT;
      ctx.globalAlpha = alpha;
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + b.r * 0.6, b.r * 0.95, b.r * 0.5, 0, 0, TAU);
      ctx.fill();
      // barrel
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.state === 1 ? Math.atan2(this.player.y - b.y, this.player.x - b.x) : b.dir);
      ctx.fillStyle = "#101710";
      ctx.fillRect(b.r - 4, -2.5, 14, 5);
      ctx.restore();
      // body
      ctx.fillStyle = def.dark;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 1.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r - 1, 0, TAU);
      ctx.fill();
      if (b.kind === 2) {
        ctx.strokeStyle = "#5c120e";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r - 5, 0, TAU);
        ctx.stroke();
      }
      // visor slit
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.state === 1 ? Math.atan2(this.player.y - b.y, this.player.x - b.x) : b.dir);
      ctx.fillStyle = "#1c0708";
      ctx.fillRect(3, -4, 7, 8);
      ctx.restore();
      // hit flash
      if (b.flash > 0) {
        ctx.globalAlpha = (b.flash / 0.1) * 0.85;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, TAU);
        ctx.fill();
      }
      // hp arc
      if (b.hp < b.maxHp) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(b.x, b.y - b.r - 8, 7, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = "#ffd23e";
        ctx.beginPath();
        ctx.arc(b.x, b.y - b.r - 8, 7, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(b.hp / b.maxHp, 0, 1));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const P = this.player;
    const w = WEAPONS[this.wi];
    ctx.save();
    ctx.translate(P.x, P.y);
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(0, P.r * 0.6, P.r * 0.95, P.r * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.rotate(P.aim);
    // weapon
    ctx.fillStyle = "#20301a";
    ctx.fillRect(4, -3, w.len + 8 - this.recoil * 4, 6);
    ctx.fillStyle = "#31481f";
    ctx.fillRect(4, -3, w.len + 8 - this.recoil * 4, 2);
    // body
    ctx.fillStyle = "#5c8f26";
    ctx.beginPath();
    ctx.arc(0, 0, P.r + 1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#a8ff3e";
    ctx.beginPath();
    ctx.arc(0, 0, P.r - 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#79c422";
    ctx.beginPath();
    ctx.arc(-2, 0, P.r - 6, 0, TAU);
    ctx.fill();
    // visor
    ctx.fillStyle = "#0e1a08";
    ctx.fillRect(4, -5, 8, 10);
    ctx.restore();
    // reload ring
    if (this.reloadT >= 0) {
      ctx.strokeStyle = "rgba(255,176,32,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(P.x, P.y, P.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(this.reloadT, 0, 1));
      ctx.stroke();
    }
    // dash ready pip
    if (this.dashCool <= 0) {
      ctx.fillStyle = "rgba(168,255,62,0.8)";
      ctx.beginPath();
      ctx.arc(P.x, P.y + P.r + 10, 2.5, 0, TAU);
      ctx.fill();
    }
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D) {
    const mx = this.mouse.x, my = this.mouse.y;
    let hot = false;
    for (const b of this.bots) {
      if (b.visible && dist2(mx + this.camX, my + this.camY, b.x, b.y) < (b.r + 8) * (b.r + 8)) {
        hot = true;
        break;
      }
    }
    const r = 10 + this.recoil * 16 + (WEAPONS[this.wi].spread * 22);
    const col = hot ? "#ff5040" : "#c8ff6e";
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, TAU);
    ctx.stroke();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      ctx.beginPath();
      ctx.moveTo(mx + dx * (r + 3), my + dy * (r + 3));
      ctx.lineTo(mx + dx * (r + 9), my + dy * (r + 9));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(mx, my, hot ? 2.6 : 1.6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawMinimap() {
    const g = this.mmCtx;
    const W = this.mmCanvas.width;
    const H = this.mmCanvas.height;
    const sx = W / MAP_W;
    const sy = H / MAP_H;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(8,14,11,0.92)";
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.85;
    g.drawImage(this.exploredCv, 0, 0, W, H);
    g.globalAlpha = 1;
    g.fillStyle = "rgba(140,200,150,0.12)";
    for (let i = 4; i < this.world.rects.length; i++) {
      const r = this.world.rects[i];
      g.fillRect(r.x * sx, r.y * sy, Math.max(1.5, r.w * sx), Math.max(1.5, r.h * sy));
    }
    if (this.phase === "menu") return;
    const P = this.player;
    // radar sweep
    const sw = (this.time * 1.3) % TAU;
    g.strokeStyle = "rgba(168,255,62,0.30)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(P.x * sx, P.y * sy);
    g.lineTo(P.x * sx + Math.cos(sw) * 90, P.y * sy + Math.sin(sw) * 90);
    g.stroke();
    // pickups
    g.fillStyle = "#ffb020";
    for (const pk of this.pickups) {
      if (!pk.visible) continue;
      g.fillRect(pk.x * sx - 1.5, pk.y * sy - 1.5, 3, 3);
    }
    // enemies
    g.fillStyle = "#ff4438";
    for (const b of this.bots) {
      if (!b.visible) continue;
      g.beginPath();
      g.arc(b.x * sx, b.y * sy, 2.4, 0, TAU);
      g.fill();
    }
    // player arrow
    g.save();
    g.translate(P.x * sx, P.y * sy);
    g.rotate(P.aim);
    g.fillStyle = "#a8ff3e";
    g.beginPath();
    g.moveTo(5, 0);
    g.lineTo(-4, -3.4);
    g.lineTo(-4, 3.4);
    g.closePath();
    g.fill();
    g.restore();
    // view box
    g.strokeStyle = "rgba(168,255,62,0.35)";
    g.strokeRect(this.camX * sx, this.camY * sy, this.viewW * sx, this.viewH * sy);
  }

  /* ---------------- HUD ---------------- */

  private pushHud() {
    const slots: HudSlot[] = WEAPONS.map((w, i) => ({
      name: w.name,
      mag: this.mags[i],
      reserve: i === 0 ? -1 : this.reserves[i],
      reload: this.reloadT >= 0 && this.wi === i ? clamp(this.reloadT, 0, 1) : -1,
      owned: this.owned[i],
      infinite: i === 0,
    }));
    this.cbs.onHud({
      hp: Math.max(0, Math.round(this.player.hp)),
      wave: this.wave,
      left: this.bots.length + this.pending.length,
      score: this.score,
      best: this.best,
      newBest: this.newBest,
      kills: this.kills,
      wi: this.wi,
      slots,
      dash: 1 - clamp(this.dashCool / 2.1, 0, 1),
      time: this.time,
    });
  }
}
