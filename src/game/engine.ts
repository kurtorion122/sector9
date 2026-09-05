import { AudioSys } from "./audio";
import {
  MAP_H, MAP_W, Rect, WorldData, WorldOpts,
  angNorm, clamp, collideCircle, dist2, generateWorld, losClear, pointBlocked, rayDist,
} from "./world";
import {
  AURAS, AuraKind, BOTS, BOSSES, BossDef, BuffKind, BUFFS, BUFF_KINDS,
  DEBUFFS, DebuffKind, FxEvent, PickupKind, PLAYER_COLORS, PlayerSnap,
  Snap, UPGRADES, UPGRADE_STAGES, WEAPONS, weaponStats,
} from "./defs";
import { NetClient } from "./net";
import {
  RARITY_COLORS, STAT_BUFFS, StatBuffId, buffDef, buffDescribe, computeStats,
  DerivedStats, drawBuffGlyph, emptyStacks, rollBuffDrops, weaponDropChance,
} from "./buffs";
import { UNDERBARRELS, UB_DROP_CHANCE, UbId, pickUbDrop, ubPoolForWave } from "./underbarrel";
import { angleOff, lightningPath, nearestOther, rollCrit } from "./mechanics";

export type Phase = "menu" | "playing" | "paused" | "over";

export interface HudSlot {
  name: string; mag: number; reserve: number; cap: number; reload: number;
  owned: boolean; infinite: boolean; upgraded: boolean; prog: number;
}
export interface HudData {
  hp: number; armor: number; wave: number; left: number;
  score: number; best: number; newBest: boolean; kills: number;
  wi: number; slots: HudSlot[]; dash: number; time: number;
  buffs: { kind: BuffKind; left: number }[];
  foeMods: { hp: number; dmg: number; spd: number };
  still: number;
  boss: { name: string; hp: number; maxHp: number; weakName: string; auraName: string } | null;
  players: { name: string; hp: number; dead: boolean; colorIdx: number; me: boolean }[];
  meDead: boolean;
  netMode: string;
  stats: { id: string; name: string; val: string; rarity: number }[];
  ubs: { name: string; short: string; desc: string; owned: boolean; cool: number; active: boolean }[];
  ubIdx: number;
  pauseTimer: number; // таймер паузы перед сменой карты
}

interface Callbacks {
  onPhase: (p: Phase) => void;
  onHud: (h: HudData) => void;
  onBanner: (title: string, sub: string) => void;
  onMute: (m: boolean) => void;
}

export type NetSetup =
  | { mode: "solo" }
  | { mode: "host"; net: NetClient; players: { id: number; name: string }[]; seed: number; you: number }
  | { mode: "client"; net: NetClient; players: { id: number; name: string }[]; seed: number; you: number };

interface PlayerEnt {
  id: number; name: string; colorIdx: number;
  x: number; y: number; vx: number; vy: number;
  hp: number; armor: number; aim: number; r: number;
  dead: boolean; isRemote: boolean;
  wi: number; owned: boolean[]; mags: number[]; reserves: number[]; upgraded: boolean[];
  upgradeProg: number[]; // 0..3 фрагментов на каждое оружие
  reloadT: number; fireCool: number; switchCool: number; recoil: number;
  dashCool: number; lastHurt: number; hurtFx: number;
  buffs: Record<BuffKind, number>;
  stillT: number; stillAcc: number; prevX: number; prevY: number;
  darkT: number; // дебаф МРАК
  revive: boolean; // флаг БАТАРЕЙКИ для возрождения
  sprayT: number; sprayCool: number;
  fireHeld: boolean; reloadSeqSeen: number;
  // пассивные коллектиблы и подстволы
  stacks: Record<StatBuffId, number>;
  stats: DerivedStats;
  ubOwned: boolean[];
  ubIdx: number;
  ubCool: number[];
  ubFlame: number;      // оставшееся время струи огнемёта
  ubCold: number;       // оставшееся время конуса холода
  flameAcc: number;     // аккумулятор звука огнемёта
  rmbSeq: number;       // счётчик нажатий ПКМ (отправляется хосту)
  rmbSeen: number;      // счётчик ПКМ, уже виденный хостом
  ubQueued: boolean;    // запрос на выстрел подствола (от сети)
}

interface Bot {
  id: number; kind: number; boss: number;
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number; r: number;
  dir: number; state: 0 | 1;
  tx: number; ty: number; lastSeen: number; seenX: number; seenY: number;
  cool: number; strafe: number; strafeT: number;
  flash: number; spawnT: number; lunge: number;
  weak: number; aura: AuraKind | ""; auraR: number;
  weapon: number; speedMul: number; resist: number;
  burn: number; burnDps: number; burnSrc: number;  // DoT горения
  slow: number;                                    // замедление конусом холода
  lastSrc: number;                                 // кто нанёс последний урон (для вампиризма)
  auraPulse: number;                               // огибающая пика активности 0..1
  auraNext: number;                                // сек до следующего пика
  auraMul: number;                                 // текущий множитель радиуса ауры
}

interface Bullet {
  id: number; x: number; y: number; px: number; py: number;
  vx: number; vy: number; dmg: number; friendly: boolean; life: number;
  kind: number; owner: number;
  rocket: boolean; targetId: number;
  pierce?: number;   // сколько врагов прошивает насквозь
  crit?: boolean;    // критический снаряд
  hitIds?: number[]; // уже задетые враги (для прошивания)
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; drag: number; }
interface Floater { x: number; y: number; txt: string; color: string; t: number; max: number; size: number; }
interface Flash { x: number; y: number; r: number; t: number; max: number; color: string; }
interface Hitmark { x: number; y: number; t: number; big: boolean; }
interface Pickup { id: number; kind: PickupKind; wi: number; x: number; y: number; t: number; visible: boolean; buff?: StatBuffId; ub?: UbId; }
interface PendingSpawn { x: number; y: number; t: number; kind: number; boss: number; }
interface Grenade { x: number; y: number; tx: number; ty: number; t: number; dur: number; src: number; done?: boolean; }
interface Lightning { pts: { x: number; y: number }[]; t: number; max: number; }
interface Vamp { x: number; y: number; t: number; }

const TAU = Math.PI * 2;
const FOV_HALF = 0.95;
const VISION_RANGE = 650;
const AMBIENT_R = 118;
const BEST_KEY = "sector9_best_v1";

const PRESETS: WorldOpts[] = [
  { walls: 9, crates: 16, pillars: 5 },
  { walls: 13, crates: 10, pillars: 7 },
  { walls: 6, crates: 22, pillars: 4 },
  { walls: 15, crates: 12, pillars: 9 },
];

function pip(px: number, py: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
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

  net: NetSetup;
  netMode: "solo" | "host" | "client";
  private isAuthority: boolean;
  private netClient: NetClient | null = null;
  private unsubscribers: (() => void)[] = [];

  phase: Phase = "menu";

  private viewW = 800; private viewH = 600; private dpr = 1;

  private floorCv: HTMLCanvasElement;
  private decalCv: HTMLCanvasElement; private decalCtx: CanvasRenderingContext2D;
  private exploredCv: HTMLCanvasElement; private exploredCtx: CanvasRenderingContext2D;
  private maskCv: HTMLCanvasElement; private maskCtx: CanvasRenderingContext2D;
  private fogCv: HTMLCanvasElement; private fogCtx: CanvasRenderingContext2D;

  private world!: WorldData;
  private mapId = 0;
  private mapSeed = 0;

  private keys = new Set<string>();
  private mouse = { x: 400, y: 300, down: false };

  private players: PlayerEnt[] = [];
  private me!: PlayerEnt;
  private meId = 0;

  private camX = 0; private camY = 0; private shake = 0;

  private bots: Bot[] = [];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private flashes: Flash[] = [];
  private hitmarks: Hitmark[] = [];
  private pickups: Pickup[] = [];
  private pending: PendingSpawn[] = [];
  private grenades: Grenade[] = [];
  private grenadePos: { x: number; y: number; k: number }[] = [];
  private lightnings: Lightning[] = [];
  private vamps: Vamp[] = [];
  private rmbQueued = false; // ПКМ локального игрока (хост/соло)

  private wave = 0;
  private betweenT = 0;
  private pauseTimer = 0; // таймер паузы перед сменой карты после босса
  private waveActive = false;
  private supplyT = 0;
  private surpriseT = 0;

  private foeModT = { hp: 0, dmg: 0, spd: 0 };

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
  private snapAcc = 0;
  private inAcc = 0;
  private destroyed = false;

  private bulletId = 1; private botId = 1; private pickId = 1;
  private fxQueue: FxEvent[] = [];

  // client interp
  private snapPrev: Snap | null = null;
  private snapCurr: Snap | null = null;
  private snapPrevAt = 0; private snapCurrAt = 0;

  constructor(canvas: HTMLCanvasElement, mmCanvas: HTMLCanvasElement, cbs: Callbacks, net?: NetSetup) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.mmCanvas = mmCanvas;
    this.mmCtx = mmCanvas.getContext("2d")!;
    this.cbs = cbs;
    this.net = net ?? { mode: "solo" };
    this.netMode = this.net.mode;
    this.isAuthority = this.netMode !== "client";
    if (this.net.mode !== "solo") this.netClient = this.net.net;

    this.floorCv = document.createElement("canvas");
    this.decalCv = document.createElement("canvas");
    this.decalCtx = this.decalCv.getContext("2d")!;
    this.exploredCv = document.createElement("canvas");
    this.exploredCtx = this.exploredCv.getContext("2d")!;
    this.maskCv = document.createElement("canvas");
    this.maskCtx = this.maskCv.getContext("2d")!;
    this.fogCv = document.createElement("canvas");
    this.fogCtx = this.fogCv.getContext("2d")!;

    try { this.best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0; } catch { this.best = 0; }

    this.mapSeed = (Math.random() * 1e9) | 0;
    this.newWorld(this.mapSeed, PRESETS[0]);
    this.onResize();
    this.bind();
    this.wireNet();
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

  /* ---------------- net wiring ---------------- */

  private wireNet() {
    if (!this.netClient) return;
    if (this.netMode === "host") {
      this.unsubscribers.push(this.netClient.on("in", (m) => this.handleIn(m as never)));
      this.unsubscribers.push(this.netClient.on("peerleft", (m) => this.handlePeerLeft((m as { id: number }).id)));
    } else if (this.netMode === "client") {
      this.unsubscribers.push(this.netClient.on("snap", (m) => this.handleSnap((m as { s: Snap }).s)));
      this.unsubscribers.push(this.netClient.on("fx", (m) => this.handleFx((m as { ev: FxEvent[] }).ev)));
      this.unsubscribers.push(this.netClient.on("banner", (m) => { const b = m as { title: string; sub: string }; this.cbs.onBanner(b.title, b.sub); }));
      this.unsubscribers.push(this.netClient.on("over", (m) => { const o = m as { score: number }; this.applyOver(o.score); }));
    }
  }

  private handleIn(m: { from?: number; x: number; y: number; aim: number; fire: boolean; weapon: number; reloadSeq: number; ub: number; rmb: number }) {
    const ent = this.players.find((p) => p.id === m.from);
    if (!ent) return;
    ent.x = clamp(m.x, ent.r, MAP_W - ent.r);
    ent.y = clamp(m.y, ent.r, MAP_H - ent.r);
    ent.aim = m.aim;
    ent.fireHeld = m.fire;
    // allow weapon switch on direct request (client sends weapon index explicitly)
    if (m.weapon !== ent.wi && ent.owned[m.weapon]) {
      // bypass cooldown for network requests
      if (ent.switchCool <= 0 || ent !== this.me) {
        ent.wi = m.weapon;
        ent.reloadT = -1;
        ent.fireCool = Math.max(ent.fireCool, 0.12);
        ent.switchCool = 0.16;
        if (ent === this.me) this.sfx("click");
        this.pushHud();
      }
    }
    if (m.reloadSeq > ent.reloadSeqSeen) {
      ent.reloadSeqSeen = m.reloadSeq;
      this.startReloadEnt(ent);
    }
    ent.ubIdx = m.ub;
    if (m.rmb > ent.rmbSeen) {
      ent.rmbSeen = m.rmb;
      ent.ubQueued = true;
    }
  }

  private handlePeerLeft(id: number) {
    this.players = this.players.filter((p) => p.id !== id);
    this.floaters.push({ x: this.me.x, y: this.me.y - 40, txt: "игрок покинул бой", color: "#8fae85", t: 1.2, max: 1.2, size: 13 });
  }

  private handleSnap(s: Snap) {
    this.snapPrev = this.snapCurr; this.snapPrevAt = this.snapCurrAt;
    this.snapCurr = s; this.snapCurrAt = performance.now();
  }

  private handleFx(ev: FxEvent[]) {
    for (const e of ev) this.applyFx(e);
  }

  private applyFx(e: FxEvent) {
    switch (e.k) {
      case "burst": this.burst(e.x, e.y, e.n, e.color, e.speed); break;
      case "blood": this.bloodFx(e.x, e.y, e.n, false); break;
      case "flash": this.flashes.push({ x: e.x, y: e.y, r: e.r, t: 0.2, max: 0.2, color: e.color }); break;
      case "float": this.floaters.push({ x: e.x, y: e.y, txt: e.txt, color: e.color, t: 0.9, max: 0.9, size: e.size }); break;
      case "shake": this.shake = Math.min(24, this.shake + e.v); break;
      case "decal": this.decalBlood(e.x, e.y); break;
      case "snd": this.playSndId(e.id, e.dist); break;
      case "zap": this.lightnings.push({ pts: e.pts, t: 0.2, max: 0.2 }); break;
      case "vamp":
        for (let i = 0; i < 5; i++) this.vamps.push({ x: e.x + (Math.random() - 0.5) * 20, y: e.y + (Math.random() - 0.5) * 20, t: 1.1 });
        break;
    }
  }

  private playSndId(id: string, dist: number) {
    const a = this.audio;
    switch (id) {
      case "hit": a.hit(); break;
      case "kill": a.kill(); break;
      case "boom": a.boom(); break;
      case "hurt": a.hurt(); break;
      case "buff": a.buff(); break;
      case "debuff": a.debuff(); break;
      case "armor": a.armor(); break;
      case "upgrade": a.upgrade(); break;
      case "boss": a.boss(dist); break;
      case "rocket": a.rocket(dist); break;
      case "explosion": a.explosion(dist); break;
      case "pickup": a.pickup(); break;
      case "weaponGet": a.weaponGet(); break;
      case "wave": a.wave(); break;
      case "surprise": a.surprise(); break;
      case "dash": a.dash(); break;
      case "click": a.click(); break;
      case "empty": a.empty(); break;
      case "zap": a.zap(dist); break;
      case "flame": a.flame(dist); break;
      case "auraSpike": a.auraSpike(dist); break;
      default: {
        if (id.startsWith("shot")) a.shot(parseInt(id.slice(4), 10) || 0, dist);
        else if (id.startsWith("reload")) a.reload(parseInt(id.slice(6), 10) || 0);
        else if (id.startsWith("ub")) a.ub(parseInt(id.slice(2), 10) || 0);
        else if (id.startsWith("buffUp")) a.buffUp(parseInt(id.slice(6), 10) || 0);
      }
    }
  }

  private sfx(id: string, dist = 0) {
    if (!this.isAuthority) return;
    this.playSndId(id, dist);
    if (this.netMode === "host") this.fxQueue.push({ k: "snd", id, dist });
  }

  private queueFx(e: FxEvent) {
    if (this.netMode === "host") this.fxQueue.push(e);
  }

  private banner(title: string, sub: string) {
    this.cbs.onBanner(title, sub);
    if (this.netMode === "host" && this.netClient) this.netClient.send({ t: "banner", title, sub });
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
    for (const u of this.unsubscribers) u();
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
    this.maskCv.width = this.viewW; this.maskCv.height = this.viewH;
    this.fogCv.width = this.viewW; this.fogCv.height = this.viewH;
  }

  private onVis() {
    if (this.phase !== "playing") return;
    if (this.netMode === "client") return; // don't auto-pause in MP
    if (document.hidden || !document.hasFocus()) this.pause();
  }

  private onKeyDown(e: KeyboardEvent) {
    this.audio.ensure();
    const c = e.code;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(c)) e.preventDefault();
    this.keys.add(c);
    if (c === "Escape" || c === "KeyP") {
      if (this.netMode === "solo") {
        if (this.phase === "playing") this.pause();
        else if (this.phase === "paused") this.resume();
      }
      return;
    }
    if (c === "KeyM") {
      this.audio.setMuted(!this.audio.muted);
      this.cbs.onMute(this.audio.muted);
      return;
    }
    if (this.phase !== "playing") {
      if ((c === "Enter" || c === "Space") && (this.phase === "menu" || this.phase === "over") && this.netMode === "solo") this.start();
      return;
    }
    if (!this.me || this.me.dead) {
      if (c === "KeyR") { /* no-op when dead */ }
      return;
    }
    if (c === "KeyR") {
      if (this.netMode === "client") this.me.reloadSeqSeen++; // will send via input
      this.startReloadEnt(this.me);
    }
    if (c === "ShiftLeft" || c === "ShiftRight" || c === "Space") this.tryDash(this.me);
    if (c === "KeyQ") this.cycleUb(this.me);
    for (let i = 0; i < 4; i++) if (c === `Digit${i + 1}`) this.switchWeaponEnt(this.me, i);
  }

  private onKeyUp(e: KeyboardEvent) { this.keys.delete(e.code); }
  private onMouseMove(e: MouseEvent) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }
  private onMouseDown(e: MouseEvent) {
    this.audio.ensure();
    if (e.button === 0) this.mouse.down = true;
    if (e.button === 2 && this.phase === "playing" && this.me && !this.me.dead) {
      if (this.netMode === "client") {
        // хост выстрелит; локально предсказываем кулдаун для HUD
        this.me.rmbSeq++;
        const k = this.me.ubIdx;
        if (this.me.ubOwned[k] && this.me.ubCool[k] <= 0) this.me.ubCool[k] = UNDERBARRELS[k].cd;
      } else {
        this.rmbQueued = true;
      }
    }
  }
  private onMouseUp(e: MouseEvent) { if (e.button === 0) this.mouse.down = false; }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (this.phase !== "playing" || !this.me) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    for (let step = 1; step <= 4; step++) {
      const idx = (this.me.wi + dir * step + 4) % 4;
      if (this.me.owned[idx]) { this.switchWeaponEnt(this.me, idx); break; }
    }
  }

  /* ---------------- state control ---------------- */

  private setPhase(p: Phase) { this.phase = p; this.cbs.onPhase(p); }

  private makeEnt(id: number, name: string, colorIdx: number): PlayerEnt {
    return {
      id, name, colorIdx,
      x: 0, y: 0, vx: 0, vy: 0, hp: 100, armor: 0, aim: 0, r: 14,
      dead: false, isRemote: false,
      wi: 0, owned: [true, false, false, false],
      mags: [WEAPONS[0].magSize, 0, 0, 0],
      reserves: [999999, 0, 0, 0],
      upgraded: [false, false, false, false],
      upgradeProg: [0, 0, 0, 0],
      reloadT: -1, fireCool: 0, switchCool: 0, recoil: 0,
      dashCool: 0, lastHurt: -99, hurtFx: 0,
      buffs: { firerate: 0, precision: 0, swift: 0, invuln: 0 },
      stillT: 0, stillAcc: 0, prevX: 0, prevY: 0,
      darkT: 0, revive: false,
      sprayT: 0, sprayCool: 0,
      fireHeld: false, reloadSeqSeen: 0,
      stacks: emptyStacks(), stats: computeStats(emptyStacks()),
      ubOwned: [false, false, false, false], ubIdx: 0,
      ubCool: [0, 0, 0, 0], ubFlame: 0, ubCold: 0, flameAcc: 0,
      rmbSeq: 0, rmbSeen: 0, ubQueued: false,
    };
  }

  start() {
    this.audio.ensure();
    this.mapId = 0;
    this.mapSeed = (Math.random() * 1e9) | 0;
    this.newWorld(this.mapSeed, PRESETS[0]);
    this.exploredCtx.clearRect(0, 0, MAP_W, MAP_H);

    this.players = [this.makeEnt(0, "ОПЕРАТИВНИК", 0)];
    this.meId = 0; this.me = this.players[0];
    this.me.x = this.world.spawn.x; this.me.y = this.world.spawn.y;
    this.me.prevX = this.me.x; this.me.prevY = this.me.y;

    this.score = 0; this.kills = 0; this.time = 0; this.newBest = false;
    this.wave = 0; this.betweenT = 1.4; this.waveActive = false;
    this.supplyT = 0; this.surpriseT = 0;
    this.foeModT = { hp: 0, dmg: 0, spd: 0 };
    this.camX = this.camClampX(this.me.x - this.viewW / 2);
    this.camY = this.camClampY(this.me.y - this.viewH / 2);
    this.setPhase("playing");
    this.cbs.onBanner("СЕКТОР-9", "зачистите территорию · держитесь в конусе света");
    this.pushHud();
  }

  /** begin a networked match (host or client) */
  begin() {
    const cfg = this.net;
    if (cfg.mode === "solo") { this.start(); return; }
    this.audio.ensure();
    this.mapId = 0;
    this.mapSeed = cfg.seed;
    this.newWorld(this.mapSeed, PRESETS[0]);
    this.exploredCtx.clearRect(0, 0, MAP_W, MAP_H);

    const sp = this.world.spawn;
    this.players = cfg.players.map((p, i) => {
      const ent = this.makeEnt(p.id, p.name, i % PLAYER_COLORS.length);
      const a = (i / cfg.players.length) * TAU;
      ent.x = clamp(sp.x + Math.cos(a) * 60, 30, MAP_W - 30);
      ent.y = clamp(sp.y + Math.sin(a) * 60, 30, MAP_H - 30);
      ent.prevX = ent.x; ent.prevY = ent.y;
      ent.isRemote = p.id !== cfg.you;
      return ent;
    });
    this.meId = cfg.you;
    this.me = this.players.find((p) => p.id === cfg.you) ?? this.players[0];

    this.score = 0; this.kills = 0; this.time = 0; this.newBest = false;
    this.supplyT = 0; this.surpriseT = 0;
    this.foeModT = { hp: 0, dmg: 0, spd: 0 };
    this.camX = this.camClampX(this.me.x - this.viewW / 2);
    this.camY = this.camClampY(this.me.y - this.viewH / 2);
    this.setPhase("playing");
    this.cbs.onBanner("СЕКТОР-9", `совместная операция · ${cfg.players.length} бойц(а)`);
    if (this.isAuthority) { this.wave = 0; this.betweenT = 1.6; this.waveActive = false; }
    this.pushHud();
  }

  pause() {
    if (this.phase !== "playing" || this.netMode !== "solo") return;
    this.mouse.down = false;
    this.shake = 0;
    this.setPhase("paused");
    this.pushHud();
  }

  private camClampX(v: number) { return MAP_W <= this.viewW ? (MAP_W - this.viewW) / 2 : clamp(v, 0, MAP_W - this.viewW); }
  private camClampY(v: number) { return MAP_H <= this.viewH ? (MAP_H - this.viewH) / 2 : clamp(v, 0, MAP_H - this.viewH); }

  resume() {
    if (this.phase !== "paused") return;
    this.last = performance.now();
    this.setPhase("playing");
  }

  toMenu() {
    this.setPhase("menu");
    this.demoT = 0;
    this.exploredCtx.clearRect(0, 0, MAP_W, MAP_H);
    this.mapSeed = (Math.random() * 1e9) | 0;
    this.newWorld(this.mapSeed, PRESETS[0]);
  }

  private applyOver(score: number) {
    this.score = score;
    this.mouse.down = false;
    if (this.score > this.best) {
      this.best = this.score; this.newBest = true;
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* noop */ }
    }
    this.setPhase("over");
    this.pushHud();
  }

  private gameOver() {
    this.mouse.down = false;
    if (this.score > this.best) {
      this.best = this.score; this.newBest = true;
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* noop */ }
    }
    this.audio.boom();
    this.burst(this.me.x, this.me.y, 40, "#a8ff3e", 320);
    this.burst(this.me.x, this.me.y, 26, "#ff5040", 260);
    this.flashes.push({ x: this.me.x, y: this.me.y, r: 90, t: 0.5, max: 0.5, color: "#c8ff7a" });
    this.shake = 22;
    if (this.netMode === "host" && this.netClient) {
      this.netClient.send({ t: "over", score: this.score, kills: this.kills, wave: this.wave, time: this.time });
    }
    this.setPhase("over");
    this.pushHud();
  }

  /* ---------------- world / waves ---------------- */

  private newWorld(seed: number, opts: WorldOpts) {
    this.world = generateWorld(seed, opts);
    this.bots = []; this.bullets = []; this.particles = []; this.floaters = [];
    this.flashes = []; this.hitmarks = []; this.pickups = []; this.pending = [];
    this.grenades = []; this.grenadePos = []; this.lightnings = []; this.vamps = [];
    this.fovPoly = [];
    this.floorCv.width = MAP_W; this.floorCv.height = MAP_H;
    this.decalCv.width = MAP_W; this.decalCv.height = MAP_H;
    this.exploredCv.width = MAP_W; this.exploredCv.height = MAP_H;
    this.paintFloor();
  }

  private presetFor(mapId: number) { return PRESETS[mapId % PRESETS.length]; }

  private paintFloor() {
    const g = this.floorCv.getContext("2d")!;
    const rnd = () => Math.random();
    g.fillStyle = "#0c120e";
    g.fillRect(0, 0, MAP_W, MAP_H);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * MAP_W, y = rnd() * MAP_H, r = 60 + rnd() * 180;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(0,0,0,0.30)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = "rgba(150,220,140,0.055)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= MAP_W; x += 85) { g.moveTo(x, 0); g.lineTo(x, MAP_H); }
    for (let y = 0; y <= MAP_H; y += 85) { g.moveTo(0, y); g.lineTo(MAP_W, y); }
    g.stroke();
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(168,255,62,0.03)" : "rgba(0,0,0,0.16)";
      g.fillRect(rnd() * MAP_W, rnd() * MAP_H, 2, 2);
    }
    g.save();
    g.translate(MAP_W / 2, MAP_H / 2);
    g.rotate(-0.08);
    g.font = "340px 'Russo One', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "rgba(168,255,62,0.045)";
    g.fillText(`С-9·${this.mapId + 1}`, 0, 0);
    g.restore();
    g.strokeStyle = "rgba(255,176,32,0.28)";
    g.lineWidth = 8;
    g.setLineDash([26, 20]);
    g.strokeRect(24, 24, MAP_W - 48, MAP_H - 48);
    g.setLineDash([]);
  }

  private startWave(n: number) {
    this.wave = n;
    this.waveActive = true;
    this.sfx("wave");

    // map rotation after boss wave (every 3 waves, after the boss is defeated)
    // actual rotation happens in the completion handler below

    const isBossWave = n % 3 === 0;
    const players = Math.max(1, this.players.length);
    const budget = Math.round((5 + n * 2.3) * (1 + (players - 1) * 0.6) * 1.5); // увеличено в 1.5 раза

    const kinds: number[] = [];
    if (!isBossWave) {
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
    } else {
      // boss wave: boss + a small escort
      for (let i = 0; i < 3 + players; i++) kinds.push(Math.random() < 0.5 ? 0 : 1);
    }

    this.pending = [];
    kinds.forEach((k, i) => {
      const p = this.findSpawnPoint();
      this.pending.push({ x: p.x, y: p.y, t: 0.5 + i * 0.22, kind: k, boss: -1 });
    });
    if (isBossWave) {
      const bossIdx = ((Math.floor(n / 3) - 1) % BOSSES.length + BOSSES.length) % BOSSES.length;
      const p = this.findSpawnPoint();
      this.pending.push({ x: p.x, y: p.y, t: 1.4, kind: 3, boss: bossIdx });
      const bd = BOSSES[bossIdx];
      this.banner(`ВОЛНА ${n} · БОСС`, `${bd.name} · слабое место: ${WEAPONS[bd.weak].name}`);
      this.sfx("boss");
      this.queueFx({ k: "shake", v: 10 });
    } else {
      this.banner(`ВОЛНА ${n}`, n === 1 ? "противники на подходе" : "плотность огня нарастает");
    }

    // weapon crates on early waves (per player that lacks them)
    if (n >= 1 && n <= 3) {
      for (const ent of this.players) {
        if (!ent.owned[n]) {
          const spot = this.pickCrateSpot();
          if (spot) this.pickups.push({ id: this.pickId++, kind: 2, wi: n, x: spot.x, y: spot.y, t: 0, visible: false });
        }
      }
    }
  }

  private rotateMap() {
    this.mapId++;
    this.mapSeed = (Math.random() * 1e9) | 0;
    this.newWorld(this.mapSeed, this.presetFor(this.mapId));
    this.exploredCtx.clearRect(0, 0, MAP_W, MAP_H);
    const sp = this.world.spawn;
    this.players.forEach((p, i) => {
      const a = (i / this.players.length) * TAU;
      p.x = clamp(sp.x + Math.cos(a) * 60, 30, MAP_W - 30);
      p.y = clamp(sp.y + Math.sin(a) * 60, 30, MAP_H - 30);
      p.prevX = p.x; p.prevY = p.y; p.vx = 0; p.vy = 0;
    });
    this.camX = this.camClampX(this.me.x - this.viewW / 2);
    this.camY = this.camClampY(this.me.y - this.viewH / 2);
    this.banner("СМЕНА СЕКТОРА", `карта перестроена · блок ${this.mapId + 1}`);
    this.sfx("wave");
  }

  private findSpawnPoint() {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * TAU;
      const d = 560 + Math.random() * 420;
      const x = clamp(this.me.x + Math.cos(a) * d, 90, MAP_W - 90);
      const y = clamp(this.me.y + Math.sin(a) * d, 90, MAP_H - 90);
      if (!pointBlocked(this.world.rects, x, y, 34)) return { x, y };
    }
    return { x: clamp(this.me.x + 600, 90, MAP_W - 90), y: clamp(this.me.y, 90, MAP_H - 90) };
  }

  private pickCrateSpot() {
    const spots = this.world.crateSpots.filter((s) => dist2(s.x, s.y, this.me.x, this.me.y) > 200 * 200);
    const pool = spots.length ? spots : this.world.crateSpots;
    return pool.length ? pool[(Math.random() * pool.length) | 0] : { x: this.me.x + 200, y: this.me.y };
  }

  private foeHpMul() { return this.foeModT.hp > 0 ? 1.6 : 1; }
  private foeDmgMul() { return this.foeModT.dmg > 0 ? 1.5 : 1; }
  private foeSpdMul() { return this.foeModT.spd > 0 ? 1.4 : 1; }

  private spawnBot(kind: number, x: number, y: number, bossIdx: number) {
    if (kind === 3 && bossIdx >= 0) { this.spawnBoss(bossIdx, x, y); return; }
    const d = BOTS[kind];
    const hpMul = (1 + (this.wave - 1) * 0.09) * this.foeHpMul();
    this.bots.push({
      id: this.botId++, kind, boss: -1, x, y, vx: 0, vy: 0,
      hp: d.hp * hpMul, maxHp: d.hp * hpMul, r: d.r,
      dir: Math.random() * TAU, state: 0,
      tx: x, ty: y, lastSeen: -99, seenX: x, seenY: y,
      cool: 1 + Math.random(), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1 + Math.random() * 2,
      flash: 0, spawnT: 0, lunge: 0, weak: -1, aura: "", auraR: 0,
      burn: 0, burnDps: 0, burnSrc: -1, slow: 0, lastSrc: -1,
      auraPulse: 0, auraNext: 0, auraMul: 1,
    });
    this.burst(x, y, 8, "#5a7d52", 90);
  }

  private spawnBoss(idx: number, x: number, y: number) {
    const bd = BOSSES[idx];
    const hpMul = (1 + (this.wave - 1) * 0.05) * this.foeHpMul();
    // рандомизация босса: аура, оружие, скорость, резист к урону
    const auraKeys = Object.keys(AURAS) as AuraKind[];
    const randAura = auraKeys[Math.floor(Math.random() * auraKeys.length)];
    const randWeapon = Math.floor(Math.random() * WEAPONS.length);
    const speedVar = 0.85 + Math.random() * 0.3; // 0.85..1.15
    const weakVar = Math.floor(Math.random() * WEAPONS.length);
    const resistVar = 0.7 + Math.random() * 0.6; // 0.7..1.3 множитель урона
    this.bots.push({
      id: this.botId++, kind: 3, boss: idx, x, y, vx: 0, vy: 0,
      hp: bd.hp * hpMul, maxHp: bd.hp * hpMul, r: bd.r,
      dir: 0, state: 1,
      tx: x, ty: y, lastSeen: this.time, seenX: x, seenY: y,
      cool: 1.2, strafe: 1, strafeT: 2,
      flash: 0, spawnT: 0, lunge: 0, weak: weakVar, aura: randAura, auraR: bd.auraR * (0.9 + Math.random() * 0.2),
      weapon: randWeapon, speedMul: speedVar, resist: resistVar,
      burn: 0, burnDps: 0, burnSrc: -1, slow: 0, lastSrc: -1,
      auraPulse: 0, auraNext: 1.6 + Math.random() * 1.6, auraMul: 1,
    });
    this.flashes.push({ x, y, r: 120, t: 0.5, max: 0.5, color: AURAS[randAura].color });
    this.burst(x, y, 30, AURAS[randAura].color, 260);
    this.queueFx({ k: "shake", v: 8 });
  }

  /* ---------------- weapons / combat ---------------- */

  private switchWeaponEnt(ent: PlayerEnt, idx: number) {
    if (idx === ent.wi || !ent.owned[idx] || ent.switchCool > 0) return;
    ent.wi = idx;
    ent.reloadT = -1;
    ent.fireCool = Math.max(ent.fireCool, 0.12);
    ent.switchCool = 0.16;
    if (ent === this.me) this.sfx("click");
    // send weapon switch to host for remote players in client mode
    if (this.netMode === "client" && this.netClient) {
      this.netClient.send({
        t: "in", x: ent.x, y: ent.y, aim: ent.aim,
        fire: this.mouse.down && !ent.dead, weapon: idx, reloadSeq: ent.reloadSeqSeen,
        ub: ent.ubIdx, rmb: ent.rmbSeq,
      });
    }
    this.pushHud();
  }

  private startReloadEnt(ent: PlayerEnt) {
    const w = weaponStats(ent.wi, ent.upgraded[ent.wi]);
    if (ent.reloadT >= 0 || ent.dead) return;
    if (ent.mags[ent.wi] >= w.magSize) return;
    if (ent.wi !== 0 && ent.reserves[ent.wi] <= 0) {
      if (ent === this.me) this.sfx("empty");
      return;
    }
    ent.reloadT = 0;
    if (ent === this.me) this.sfx("reload0");
  }

  private tryDash(ent: PlayerEnt) {
    if (ent.dashCool > 0 || this.phase !== "playing" || ent.dead) return;
    let dx = 0, dy = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;
    if (dx === 0 && dy === 0) { dx = Math.cos(ent.aim); dy = Math.sin(ent.aim); }
    const len = Math.hypot(dx, dy) || 1;
    ent.vx += (dx / len) * 640;
    ent.vy += (dy / len) * 640;
    ent.dashCool = 2.1;
    if (ent === this.me) this.sfx("dash");
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: ent.x, y: ent.y,
        vx: -(dx / len) * (60 + Math.random() * 120) + (Math.random() - 0.5) * 60,
        vy: -(dy / len) * (60 + Math.random() * 120) + (Math.random() - 0.5) * 60,
        life: 0.3 + Math.random() * 0.2, max: 0.5, size: 5 + Math.random() * 5, color: "rgba(168,255,62,0.5)", drag: 4,
      });
    }
  }

  private fireEnt(ent: PlayerEnt) {
    const w = weaponStats(ent.wi, ent.upgraded[ent.wi]);
    if (ent.reloadT >= 0) return;
    if (ent.mags[ent.wi] <= 0) {
      if (ent.wi !== 0 && ent.reserves[ent.wi] > 0) this.startReloadEnt(ent);
      else { if (ent === this.me) this.sfx("empty"); ent.fireCool = 0.28; }
      return;
    }
    ent.mags[ent.wi]--;
    const st = ent.stats;
    let rate = w.rate / st.rateMul;        // пассивная скорострельность
    let spread = w.spread * st.accMul;     // пассивная точность
    if (ent.buffs.firerate > 0) rate *= 0.55;
    if (ent.buffs.precision > 0) spread *= 0.4;
    ent.fireCool = rate;
    ent.recoil = Math.min(1, ent.recoil + 0.55);
    if (ent === this.me) this.shake = Math.min(14, this.shake + w.kick * 0.45);

    // откат (отдача толкает назад): снайперка 5, остальное минимально
    this.knockback(ent, ent.aim, ent.wi === 3 ? 5 : 1);

    const aim = ent.aim;
    const mx = ent.x + Math.cos(aim) * (ent.r + w.len);
    const my = ent.y + Math.sin(aim) * (ent.r + w.len);
    for (let p = 0; p < w.pellets; p++) {
      const a = aim + (Math.random() - 0.5) * spread * 2 + (w.pellets > 1 ? (p - (w.pellets - 1) / 2) * 0.055 : 0);
      const crit = rollCrit(st.critChance);
      this.bullets.push({
        id: this.bulletId++, x: mx, y: my, px: mx, py: my,
        vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
        dmg: w.dmg * st.dmgMul * (crit ? st.critMul : 1),
        friendly: true, life: w.range / w.speed, kind: ent.wi, owner: ent.id,
        rocket: false, targetId: -1,
        pierce: w.pierce > 0 ? w.pierce : undefined,
        crit: crit || undefined,
        hitIds: w.pierce > 0 ? [] : undefined,
      });
    }
    this.flashes.push({ x: mx, y: my, r: 20 + w.kick * 2.4, t: 0.06, max: 0.06, color: "#ffd98a" });
    this.queueFx({ k: "flash", x: mx, y: my, r: 20 + w.kick * 2.4, color: "#ffd98a" });
    this.sfx(`shot${ent.wi}`, ent === this.me ? 0 : Math.hypot(ent.x - this.me.x, ent.y - this.me.y));
    const sa = aim + Math.PI / 2;
    this.particles.push({
      x: mx, y: my, vx: Math.cos(sa) * 120 + (Math.random() - 0.5) * 40, vy: Math.sin(sa) * 120 + (Math.random() - 0.5) * 40,
      life: 0.4, max: 0.4, size: 2.5, color: "#ffb020", drag: 6,
    });
    if (ent.mags[ent.wi] === 0) this.startReloadEnt(ent);
  }

  private fireSpray(ent: PlayerEnt) {
    const n = 7;
    const base = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * TAU;
      this.bullets.push({
        id: this.bulletId++, x: ent.x, y: ent.y, px: ent.x, py: ent.y,
        vx: Math.cos(a) * 760, vy: Math.sin(a) * 760,
        dmg: 14, friendly: true, life: 0.7, kind: 2, owner: ent.id,
        rocket: false, targetId: -1,
      });
    }
    this.flashes.push({ x: ent.x, y: ent.y, r: 26, t: 0.08, max: 0.08, color: "#ffd98a" });
    this.queueFx({ k: "flash", x: ent.x, y: ent.y, r: 26, color: "#ffd98a" });
    this.sfx("shot2", ent === this.me ? 0 : 300);
  }

  private launchRocket(ent: PlayerEnt) {
    let target: Bot | null = null;
    let bd = Infinity;
    for (const b of this.bots) {
      const d = dist2(b.x, b.y, ent.x, ent.y);
      if (d < bd) { bd = d; target = b; }
    }
    const a = target ? Math.atan2(target.y - ent.y, target.x - ent.x) : ent.aim;
    this.bullets.push({
      id: this.bulletId++, x: ent.x, y: ent.y, px: ent.x, py: ent.y,
      vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
      dmg: 120, friendly: true, life: 2.2, kind: 4, owner: ent.id,
      rocket: true, targetId: target ? target.id : -1,
    });
    this.sfx("rocket", ent === this.me ? 0 : 300);
    this.floaters.push({ x: ent.x, y: ent.y - 24, txt: "РАКЕТА!", color: "#ffb020", t: 0.8, max: 0.8, size: 14 });
  }

  /* ---------------- подствольное оружие ---------------- */

  private cycleUb(ent: PlayerEnt) {
    const owned = [0, 1, 2, 3].filter((i) => ent.ubOwned[i]);
    if (!owned.length) { if (ent === this.me) this.sfx("empty"); return; }
    const cur = owned.indexOf(ent.ubIdx);
    ent.ubIdx = owned[(cur + 1 + owned.length) % owned.length];
    if (ent === this.me) { this.sfx("click"); this.pushHud(); }
  }

  /** откат: импульс назад от направления выстрела, складывается с инерцией дэша */
  private knockback(ent: PlayerEnt, aim: number, force: number) {
    if (force <= 0) return;
    ent.vx -= Math.cos(aim) * force * 26;
    ent.vy -= Math.sin(aim) * force * 26;
  }

  private fireUnderbarrel(ent: PlayerEnt) {
    if (ent.dead) return;
    const k = ent.ubIdx;
    if (!ent.ubOwned[k]) { if (ent === this.me) this.sfx("empty"); return; }
    if (ent.ubCool[k] > 0) { if (ent === this.me) this.sfx("empty"); return; }
    const def = UNDERBARRELS[k];
    ent.ubCool[k] = def.cd;
    const aim = ent.aim;
    const st = ent.stats;
    const dMe = Math.hypot(ent.x - this.me.x, ent.y - this.me.y);

    if (k === 0) {
      // подствольный дробовик: 6 дробинок, малый разброс, урон 15
      const mx = ent.x + Math.cos(aim) * (ent.r + 14);
      const my = ent.y + Math.sin(aim) * (ent.r + 14);
      for (let p = 0; p < 6; p++) {
        const a = aim + (Math.random() - 0.5) * 0.12 * st.accMul * 2 + (p - 2.5) * 0.04;
        this.bullets.push({
          id: this.bulletId++, x: mx, y: my, px: mx, py: my,
          vx: Math.cos(a) * 900, vy: Math.sin(a) * 900,
          dmg: 15 * st.dmgMul, friendly: true, life: 430 / 900, kind: 1, owner: ent.id,
          rocket: false, targetId: -1,
        });
      }
      this.flashes.push({ x: mx, y: my, r: 22, t: 0.06, max: 0.06, color: "#ffd98a" });
      this.queueFx({ k: "flash", x: mx, y: my, r: 22, color: "#ffd98a" });
      this.knockback(ent, aim, def.kb);
      this.sfx("ub0", ent === this.me ? 0 : dMe);
    } else if (k === 1) {
      // гранатомёт: снаряд по дуге, взрыв AoE 80, урон 40
      let dist = 380;
      if (ent === this.me) {
        const wx = this.mouse.x + this.camX, wy = this.mouse.y + this.camY;
        dist = clamp(Math.hypot(wx - ent.x, wy - ent.y), 120, 470);
      }
      this.grenades.push({
        x: ent.x, y: ent.y,
        tx: ent.x + Math.cos(aim) * dist, ty: ent.y + Math.sin(aim) * dist,
        t: 0, dur: 0.3 + dist / 950, src: ent.id,
      });
      this.knockback(ent, aim, def.kb);
      this.sfx("ub1", ent === this.me ? 0 : dMe);
    } else if (k === 2) {
      // огнемёт: струя 3 с (урон тикает в tickFlame)
      ent.ubFlame = 3;
      this.sfx("ub2", ent === this.me ? 0 : dMe);
    } else {
      // конус холода: активная зона 4 с (замедление в tickCold)
      ent.ubCold = 4;
      this.flashes.push({ x: ent.x + Math.cos(aim) * 60, y: ent.y + Math.sin(aim) * 60, r: 70, t: 0.3, max: 0.3, color: "#5fd8d0" });
      this.queueFx({ k: "flash", x: ent.x + Math.cos(aim) * 60, y: ent.y + Math.sin(aim) * 60, r: 70, color: "#5fd8d0" });
      this.sfx("ub3", ent === this.me ? 0 : dMe);
    }
    if (ent === this.me) this.pushHud();
  }

  private tickFlame(ent: PlayerEnt, dt: number) {
    const len = rayDist(this.world.rects, ent.x, ent.y, ent.aim, 120);
    const dx = Math.cos(ent.aim), dy = Math.sin(ent.aim);
    for (const b of this.bots) {
      const t = clamp(((b.x - ent.x) * dx + (b.y - ent.y) * dy) / Math.max(1, len), 0, 1);
      const px = ent.x + dx * len * t, py = ent.y + dy * len * t;
      const rr = b.r + 18;
      if (dist2(b.x, b.y, px, py) < rr * rr) {
        this.damageBot(b, 10 * dt, 99, false, ent.id, true); // 10 урона/сек
        b.burn = 3; b.burnDps = 5; b.burnSrc = ent.id;       // поджог: 5/сек на 3 сек
      }
    }
    // огненные частицы вдоль струи
    if (Math.random() < 0.9) {
      const d = Math.random() * len;
      this.particles.push({
        x: ent.x + dx * d + (Math.random() - 0.5) * 16, y: ent.y + dy * d + (Math.random() - 0.5) * 16,
        vx: dx * 130 + (Math.random() - 0.5) * 70, vy: dy * 130 + (Math.random() - 0.5) * 70,
        life: 0.25 + Math.random() * 0.2, max: 0.45, size: 3 + Math.random() * 4,
        color: Math.random() < 0.5 ? "#ff9a3d" : "#ffd98a", drag: 3,
      });
    }
    ent.flameAcc += dt;
    if (ent.flameAcc >= 0.14) {
      ent.flameAcc = 0;
      this.sfx("flame", ent === this.me ? 0 : Math.hypot(ent.x - this.me.x, ent.y - this.me.y));
    }
  }

  private tickCold(ent: PlayerEnt) {
    // конус 60° (±30°), длина 150, в сторону курсора; замедление 30%
    for (const b of this.bots) {
      const d2b = dist2(b.x, b.y, ent.x, ent.y);
      if (d2b > 150 * 150) continue;
      if (angleOff(ent.aim, ent.x, ent.y, b.x, b.y) > Math.PI / 6 + 0.1) continue;
      if (!losClear(this.world.rects, ent.x, ent.y, b.x, b.y)) continue;
      b.slow = 0.3;
      if (Math.random() < 0.2) {
        this.particles.push({
          x: b.x + (Math.random() - 0.5) * 16, y: b.y + (Math.random() - 0.5) * 16,
          vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 40,
          life: 0.4, max: 0.4, size: 2.5, color: "#bfeef0", drag: 2,
        });
      }
    }
  }

  /* ---------------- пассивные баффы (коллектиблы) ---------------- */

  private addStack(ent: PlayerEnt, id: StatBuffId) {
    const def = buffDef(id);
    ent.stacks[id]++;
    ent.stats = computeStats(ent.stacks);
    if (id === "hp") ent.hp = Math.min(ent.stats.maxHp, ent.hp + 2);
    const col = RARITY_COLORS[def.rarity];
    this.floaters.push({ x: ent.x, y: ent.y - 28, txt: `${def.name} · ${buffDescribe(id, ent.stacks[id])}`, color: col, t: 1.3, max: 1.3, size: 14 });
    this.queueFx({ k: "float", x: ent.x, y: ent.y - 28, txt: def.name, color: col, size: 14 });
    if (id === "aura" && ent.stacks[id] === 1) {
      this.floaters.push({ x: ent.x, y: ent.y - 46, txt: "АУРА ГОРЕНИЯ АКТИВНА", color: "#ff9a3d", t: 1.4, max: 1.4, size: 13 });
    }
    this.sfxIfMe(ent, `buffUp${def.rarity}`);
    this.pushHud();
  }

  /** цепная молния: от поражённой цели прыгает на ближайших врагов */
  private tryChain(shooter: PlayerEnt, origin: Bot, dmg: number) {
    const st = shooter.stats;
    if (st.chain.jumps < 1 || dmg <= 0) return;
    if (Math.random() > st.chain.chance) return;
    const anchors = [{ x: origin.x, y: origin.y }];
    const used = new Set<number>([origin.id]);
    let cur = origin;
    const jumpDmg = dmg * st.chain.dmg;
    for (let j = 0; j < st.chain.jumps; j++) {
      const next = nearestOther(this.bots, used, cur.x, cur.y, 120);
      if (!next) break;
      used.add(next.id);
      anchors.push({ x: next.x, y: next.y });
      this.damageBot(next, jumpDmg, 99, false, shooter.id);
      cur = next;
    }
    if (anchors.length > 1) {
      const path = lightningPath(anchors);
      this.lightnings.push({ pts: path, t: 0.2, max: 0.2 });
      this.queueFx({ k: "zap", pts: path });
      this.sfx("zap", shooter === this.me ? 0 : Math.hypot(shooter.x - this.me.x, shooter.y - this.me.y));
    }
  }

  /** взрыв подствольной гранаты: AoE радиус 80, урон 40 */
  private explodeUb(x: number, y: number, dmg: number, src: number) {
    const R = 80;
    this.flashes.push({ x, y, r: R, t: 0.3, max: 0.3, color: "#ffb020" });
    this.queueFx({ k: "flash", x, y, r: R, color: "#ffb020" });
    this.burst(x, y, 26, "#ff9a3d", 320);
    this.burst(x, y, 14, "#ffd98a", 240);
    this.queueFx({ k: "burst", x, y, n: 26, color: "#ff9a3d", speed: 320 });
    this.sfx("boom", Math.hypot(x - this.me.x, y - this.me.y));
    this.queueFx({ k: "shake", v: 7 });
    this.shake = Math.min(24, this.shake + 7);
    for (const b of [...this.bots]) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < R + b.r) this.damageBot(b, dmg, 99, false, src);
    }
  }

  private tickGrenades(dt: number) {
    for (const g of this.grenades) {
      g.t += dt;
      if (g.t >= g.dur) { g.done = true; this.explodeUb(g.tx, g.ty, 40, g.src); }
    }
    this.grenades = this.grenades.filter((g) => !g.done);
    this.grenadePos = this.grenades.map((g) => {
      const t = clamp(g.t / g.dur, 0, 1);
      return { x: g.x + (g.tx - g.x) * t, y: g.y + (g.ty - g.y) * t, k: Math.sin(Math.PI * t) };
    });
  }

  /** аура горения: 5 урона/сек всем врагам в радиусе (пассивная) */
  private tickAuras(dt: number) {
    for (const p of this.players) {
      if (p.dead || p.stats.auraR <= 0) continue;
      const r2 = p.stats.auraR * p.stats.auraR;
      for (const b of this.bots) {
        if (dist2(b.x, b.y, p.x, p.y) < r2) {
          this.damageBot(b, 5 * dt, 99, false, p.id, true);
          if (Math.random() < dt * 6) this.burst(b.x, b.y, 1, "#ff9a3d", 70);
        }
      }
      if (Math.random() < dt * 10) {
        const a = Math.random() * TAU;
        this.particles.push({
          x: p.x + Math.cos(a) * p.stats.auraR, y: p.y + Math.sin(a) * p.stats.auraR,
          vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 50,
          life: 0.5, max: 0.5, size: 3, color: "#ff9a3d", drag: 1,
        });
      }
    }
  }

  private stepLightnings(dt: number) {
    for (const l of this.lightnings) l.t -= dt;
    this.lightnings = this.lightnings.filter((l) => l.t > 0);
  }

  /** зелёные частицы вампиризма летят от трупа к игроку */
  private stepVamps(dt: number) {
    if (!this.me) return;
    for (const v of this.vamps) {
      v.t -= dt;
      const dx = this.me.x - v.x, dy = this.me.y - v.y;
      const d = Math.hypot(dx, dy);
      if (d > 10) { v.x += (dx / d) * 480 * dt; v.y += (dy / d) * 480 * dt; }
    }
    this.vamps = this.vamps.filter((v) => v.t > 0 && Math.hypot(this.me.x - v.x, this.me.y - v.y) > 10);
  }

  private botFire(b: Bot, dmgMul: number, target: PlayerEnt) {
    const def = BOTS[b.kind];
    const aim = Math.atan2(target.y - b.y, target.x - b.x);
    const mx = b.x + Math.cos(aim) * (b.r + 14);
    const my = b.y + Math.sin(aim) * (b.r + 14);
    for (let p = 0; p < Math.max(1, def.pellets); p++) {
      const spread = def.pellets > 1 ? 0.24 : 0.1;
      const a = aim + (Math.random() - 0.5) * spread * 2;
      this.bullets.push({
        id: this.bulletId++, x: mx, y: my, px: mx, py: my,
        vx: Math.cos(a) * def.bSpeed, vy: Math.sin(a) * def.bSpeed,
        dmg: def.dmg * dmgMul, friendly: false, life: 1.4, kind: b.kind, owner: -1,
        rocket: false, targetId: -1,
      });
    }
    this.flashes.push({ x: mx, y: my, r: 24, t: 0.07, max: 0.07, color: "#ff9a4d" });
    this.queueFx({ k: "flash", x: mx, y: my, r: 24, color: "#ff9a4d" });
    const d = Math.hypot(target.x - b.x, target.y - b.y);
    this.sfx(b.kind === 2 ? "shot1" : "shot2", d);
  }

  private bossFire(b: Bot, bd: BossDef, dmgMul: number, target: PlayerEnt) {
    const w = WEAPONS[b.weapon]; // используем рандомное оружие босса
    const aim = Math.atan2(target.y - b.y, target.x - b.x);
    const mx = b.x + Math.cos(aim) * (b.r + 16);
    const my = b.y + Math.sin(aim) * (b.r + 16);
    const pellets = Math.max(1, w.pellets);
    for (let p = 0; p < pellets; p++) {
      const a = aim + (Math.random() - 0.5) * w.spread * 2.4 + (pellets > 1 ? (p - (pellets - 1) / 2) * 0.06 : 0);
      this.bullets.push({
        id: this.bulletId++, x: mx, y: my, px: mx, py: my,
        vx: Math.cos(a) * w.speed * 0.72, vy: Math.sin(a) * w.speed * 0.72,
        dmg: w.dmg * 0.8 * dmgMul * b.resist, friendly: false, life: 1.3, kind: b.weapon, owner: -1,
        rocket: false, targetId: -1,
      });
    }
    this.flashes.push({ x: mx, y: my, r: 34, t: 0.09, max: 0.09, color: "#ffb020" });
    this.queueFx({ k: "flash", x: mx, y: my, r: 34, color: "#ffb020" });
    const d = Math.hypot(target.x - b.x, target.y - b.y);
    this.sfx(`shot${b.weapon}`, d);
  }

  /* ---------------- damage / fx ---------------- */

  private burst(x: number, y: number, n: number, color: string, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.45, max: 0.75, size: 2 + Math.random() * 3.4, color, drag: 5 });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }

  private decalBlood(x: number, y: number) {
    const g = this.decalCtx;
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(120,16,24,${0.25 + Math.random() * 0.3})`;
      g.beginPath();
      g.arc(x + (Math.random() - 0.5) * 26, y + (Math.random() - 0.5) * 26, 2 + Math.random() * 6, 0, TAU);
      g.fill();
    }
  }

  private bloodFx(x: number, y: number, n: number, decal: boolean) {
    this.burst(x, y, n, "#c22333", 170);
    if (decal) this.decalBlood(x, y);
  }

  private damageBot(b: Bot, dmg: number, wKind: number, crit = false, src = -1, silent = false) {
    // boss resist: only weak weapon full damage
    if (b.kind === 3 && b.weak >= 0 && wKind !== b.weak) dmg *= 0.25;
    b.hp -= dmg;
    if (src >= 0) b.lastSrc = src;
    if (silent) {
      if (b.hp <= 0) this.killBot(b);
      return;
    }
    b.flash = 0.1;
    this.bloodFx(b.x, b.y, crit ? 8 : 5, true);
    this.hitmarks.push({ x: b.x, y: b.y - b.r - 6, t: 0.18, big: crit });
    this.queueFx({ k: "blood", x: b.x, y: b.y, n: crit ? 8 : 5 });
    if (crit) {
      this.floaters.push({ x: b.x, y: b.y - b.r - 16, txt: `${Math.round(dmg)}!`, color: "#ffd23e", t: 0.8, max: 0.8, size: 19 });
      this.queueFx({ k: "float", x: b.x, y: b.y - b.r - 16, txt: `${Math.round(dmg)}!`, color: "#ffd23e", size: 19 });
    }
    if (b.kind === 3 && wKind !== b.weak) {
      this.floaters.push({ x: b.x, y: b.y - b.r - 14, txt: "РЕЗИСТ", color: "#8fae85", t: 0.5, max: 0.5, size: 11 });
    }
    this.sfx("hit");
    if (b.hp <= 0) this.killBot(b);
  }

  private killBot(b: Bot) {
    this.kills++;
    const isBoss = b.kind === 3;
    const gained = (isBoss ? BOSSES[b.boss].score : BOTS[b.kind].score) + this.wave * 10;
    this.score += gained;
    this.floaters.push({ x: b.x, y: b.y - 16, txt: `+${gained}`, color: "#ffb020", t: 0.9, max: 0.9, size: 15 });
    this.queueFx({ k: "float", x: b.x, y: b.y - 16, txt: `+${gained}`, color: "#ffb020", size: 15 });
    this.hitmarks.push({ x: b.x, y: b.y, t: 0.3, big: true });

    const color = isBoss ? AURAS[BOSSES[b.boss].aura].color : BOTS[b.kind].color;
    this.burst(b.x, b.y, isBoss ? 50 : b.kind === 2 ? 34 : 18, color, 300);
    this.bloodFx(b.x, b.y, isBoss ? 24 : b.kind === 2 ? 16 : 9, true);
    this.flashes.push({ x: b.x, y: b.y, r: isBoss ? 130 : b.kind === 2 ? 70 : 40, t: 0.25, max: 0.25, color: "#ffb020" });
    this.queueFx({ k: "burst", x: b.x, y: b.y, n: isBoss ? 50 : 20, color, speed: 300 });
    this.queueFx({ k: "flash", x: b.x, y: b.y, r: isBoss ? 130 : 50, color: "#ffb020" });
    this.queueFx({ k: "decal", x: b.x, y: b.y });

    if (isBoss) {
      this.sfx("explosion");
      this.shake = Math.min(24, this.shake + 16);
      this.queueFx({ k: "shake", v: 16 });
      this.dropBossLoot(b);
    } else if (b.kind === 2) {
      this.sfx("boom");
      this.shake = Math.min(18, this.shake + 10);
    } else {
      this.sfx("kill");
      this.shake = Math.min(14, this.shake + 3);
    }

    // вампиризм: убийца лечится за убийство
    if (b.lastSrc >= 0) {
      const killer = this.players.find((p) => p.id === b.lastSrc);
      if (killer && !killer.dead && killer.stats.vamp > 0) {
        const heal = Math.min(killer.stats.vamp, killer.stats.maxHp - killer.hp);
        if (heal > 0.01) {
          killer.hp += heal;
          this.floaters.push({ x: b.x, y: b.y - 26, txt: `+${Math.round(heal)}`, color: "#7dff8a", t: 0.8, max: 0.8, size: 14 });
          for (let i = 0; i < 5; i++) {
            this.vamps.push({ x: b.x + (Math.random() - 0.5) * 20, y: b.y + (Math.random() - 0.5) * 20, t: 1.1 });
          }
          this.queueFx({ k: "vamp", x: b.x, y: b.y });
          this.queueFx({ k: "float", x: b.x, y: b.y - 26, txt: `+${Math.round(heal)}`, color: "#7dff8a", size: 14 });
        }
      }
    }

    if (!isBoss) this.rollDrops(b.x, b.y);
    this.bots = this.bots.filter((o) => o !== b);
  }

  /** дроп из убитого врага: аптечки/броня/сюрпризы + пассивные баффы + подстволы + оружие */
  private rollDrops(x: number, y: number) {
    if (this.pickups.length >= 16) return;
    const w = this.wave;

    // --- классические дропы ---
    const buffChance = Math.min(0.05 + w * 0.012, 0.3);
    const surpriseChance = Math.min(0.02 + w * 0.01, 0.22);
    const roll = Math.random();
    let kind: PickupKind | null = null;
    if (roll < 0.08) kind = 0;               // medkit
    else if (roll < 0.17) kind = 1;          // ammo
    else if (roll < 0.26) kind = 3;          // armor
    else if (roll < 0.26 + buffChance * 0.6) kind = 4;       // timed buff
    else if (roll < 0.26 + buffChance * 0.6 + surpriseChance) kind = 6; // surprise
    else if (roll < 0.26 + buffChance * 0.6 + surpriseChance + 0.04) kind = 7; // spray
    else if (roll < 0.26 + buffChance * 0.6 + surpriseChance + 0.07) kind = 8; // rocket
    else if (roll < 0.26 + buffChance * 0.6 + surpriseChance + 0.1) kind = 5;  // upgrade
    if (kind !== null) this.pickups.push({ id: this.pickId++, kind, wi: 0, x, y, t: 0, visible: false });

    // --- пассивные баффы: шанс растёт с волной, капнутые не спавнятся ---
    const stacksList = this.players.map((p) => p.stacks);
    for (const drop of rollBuffDrops(w, stacksList, x, y)) {
      this.pickups.push({ id: this.pickId++, kind: 9, wi: 0, x: drop.x, y: drop.y, t: 0, visible: false, buff: drop.id });
    }

    // --- подстволы: 0.5%, пул по волнам, не спавнятся если все собраны ---
    if (Math.random() < UB_DROP_CHANCE) {
      const missing = ubPoolForWave(w).filter((k) => !this.players.every((p) => p.ubOwned[k]));
      const ub = pickUbDrop(w, missing);
      if (ub !== null) {
        this.pickups.push({ id: this.pickId++, kind: 10, wi: 0, x, y: y + 14, t: 0, visible: false, ub });
      }
    }

    // --- оружие: шанс падает с волной (обратная формула) ---
    const missingWi = [1, 2, 3].filter((i) => this.players.some((p) => !p.owned[i]));
    if (missingWi.length && Math.random() < weaponDropChance(0.03, w)) {
      const wi = missingWi[(Math.random() * missingWi.length) | 0];
      this.pickups.push({ id: this.pickId++, kind: 2, wi, x: x + 20, y, t: 0, visible: false });
    }
  }

  private dropBossLoot(b: Bot) {
    const spots = [
      { x: b.x, y: b.y },
      { x: b.x + 46, y: b.y + 20 },
      { x: b.x - 46, y: b.y + 20 },
      { x: b.x, y: b.y - 50 },
    ];
    const kinds: PickupKind[] = [5, 6, 3, 4];
    spots.forEach((s, i) => {
      this.pickups.push({ id: this.pickId++, kind: kinds[i % kinds.length], wi: 0, x: s.x, y: s.y, t: 0, visible: false });
    });
    // гарантированный редкий пассивный бафф с босса
    const rarePool = STAT_BUFFS.filter((d) => d.rarity >= 2 && this.players.some((p) => p.stacks[d.id] < d.cap));
    if (rarePool.length) {
      const def = rarePool[(Math.random() * rarePool.length) | 0];
      this.pickups.push({ id: this.pickId++, kind: 9, wi: 0, x: b.x, y: b.y + 44, t: 0, visible: false, buff: def.id });
    }
  }

  private damageEnt(ent: PlayerEnt, dmg: number, fromX: number, fromY: number) {
    if (this.phase !== "playing" || ent.dead) return;
    if (ent.buffs.invuln > 0) {
      this.floaters.push({ x: ent.x, y: ent.y - 24, txt: "ЩИТ", color: "#c07aff", t: 0.4, max: 0.4, size: 12 });
      return;
    }
    // armor absorbs 60%
    if (ent.armor > 0) {
      const absorbed = Math.min(ent.armor, dmg * 0.6);
      ent.armor -= absorbed;
      dmg -= absorbed;
    }
    ent.hp -= dmg;
    ent.lastHurt = this.time;
    ent.hurtFx = 1;
    if (ent === this.me) {
      this.shake = Math.min(20, this.shake + 7);
      this.sfx("hurt");
    }
    this.queueFx({ k: "shake", v: 4 });
    this.bloodFx(ent.x, ent.y, 6, true);
    this.queueFx({ k: "blood", x: ent.x, y: ent.y, n: 6 });
    this.floaters.push({ x: ent.x, y: ent.y - 22, txt: `-${Math.round(dmg)}`, color: "#ff5040", t: 0.7, max: 0.7, size: 14 });
    const a = Math.atan2(ent.y - fromY, ent.x - fromX);
    ent.vx += Math.cos(a) * 120;
    ent.vy += Math.sin(a) * 120;
    if (ent.hp <= 0) {
      ent.hp = 0;
      // проверка БАТАРЕЙКИ для возрождения
      if (ent.revive && !ent.isRemote) {
        ent.revive = false;
        ent.dead = false;
        ent.hp = Math.floor(ent.stats.maxHp * 0.5); // 50% HP
        this.floaters.push({ x: ent.x, y: ent.y - 40, txt: "ВОЗРОЖДЕНИЕ!", color: "#ffb020", t: 1.5, max: 1.5, size: 16 });
        this.queueFx({ k: "float", x: ent.x, y: ent.y - 40, txt: "ВОЗРОЖДЕНИЕ!", color: "#ffb020", size: 16 });
        this.sfxIfMe(ent, "buff");
      } else {
        ent.dead = true;
        this.burst(ent.x, ent.y, 34, PLAYER_COLORS[ent.colorIdx], 300);
        this.flashes.push({ x: ent.x, y: ent.y, r: 80, t: 0.4, max: 0.4, color: PLAYER_COLORS[ent.colorIdx] });
        this.queueFx({ k: "burst", x: ent.x, y: ent.y, n: 34, color: PLAYER_COLORS[ent.colorIdx], speed: 300 });
        this.queueFx({ k: "snd", id: "boom", dist: 0 });
        if (this.players.every((p) => p.dead)) this.gameOver();
      }
    }
    this.pushHud();
  }

  /* ---------------- buffs / debuffs / pickups ---------------- */

  private addBuff(ent: PlayerEnt, kind: BuffKind) {
    ent.buffs[kind] = BUFFS[kind].dur;
    this.floaters.push({ x: ent.x, y: ent.y - 26, txt: BUFFS[kind].name, color: BUFFS[kind].color, t: 1, max: 1, size: 15 });
    this.queueFx({ k: "float", x: ent.x, y: ent.y - 26, txt: BUFFS[kind].name, color: BUFFS[kind].color, size: 15 });
    this.queueFx({ k: "snd", id: "buff", dist: 0 });
    if (ent === this.me) this.sfx("buff");
  }

  private addDebuff(kind: DebuffKind, ent: PlayerEnt) {
    if (kind === "still") {
      ent.stillT = DEBUFFS.still.dur;
      this.floaters.push({ x: ent.x, y: ent.y - 26, txt: DEBUFFS.still.name, color: DEBUFFS.still.color, t: 1, max: 1, size: 15 });
      this.queueFx({ k: "float", x: ent.x, y: ent.y - 26, txt: DEBUFFS.still.name, color: DEBUFFS.still.color, size: 15 });
    } else if (kind === "dark") {
      // МРАК: сужает обзор, мигает, скрывает UI на 10 сек
      ent.darkT = DEBUFFS.dark.dur;
      this.floaters.push({ x: ent.x, y: ent.y - 26, txt: DEBUFFS.dark.name, color: DEBUFFS.dark.color, t: 1, max: 1, size: 15 });
      this.queueFx({ k: "float", x: ent.x, y: ent.y - 26, txt: DEBUFFS.dark.name, color: DEBUFFS.dark.color, size: 15 });
    } else if (kind === "spawn") {
      // ПОДКРЕПЛЕНИЕ: спавн 10 врагов за 5 секунд
      this.spawnReinforcement(10);
      this.floaters.push({ x: ent.x, y: ent.y - 26, txt: DEBUFFS.spawn.name, color: DEBUFFS.spawn.color, t: 1, max: 1, size: 15 });
      this.queueFx({ k: "float", x: ent.x, y: ent.y - 26, txt: DEBUFFS.spawn.name, color: DEBUFFS.spawn.color, size: 15 });
    } else {
      const key = kind === "foeHp" ? "hp" : kind === "foeDmg" ? "dmg" : "spd";
      this.foeModT[key] = DEBUFFS[kind].dur;
      if (kind === "foeHp") for (const b of this.bots) { b.hp = Math.min(b.maxHp * 1.6, b.hp * 1.35); b.maxHp *= 1.6; }
      this.cbs.onBanner("СИГНАЛ ПОДАВЛЕН", DEBUFFS[kind].name);
    }
    this.queueFx({ k: "snd", id: "debuff", dist: 0 });
    if (ent === this.me) this.sfx("debuff");
  }

  private applyPickup(ent: PlayerEnt, pk: Pickup) {
    switch (pk.kind) {
      case 0:
        ent.hp = Math.min(ent.stats.maxHp, ent.hp + 35);
        this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "+35 HP", color: "#7dff8a", t: 0.9, max: 0.9, size: 14 });
        this.sfxIfMe(ent, "pickup");
        break;
      case 1:
        // скудное пополнение — патроны в дефиците
        for (let i = 1; i < 4; i++) if (ent.owned[i]) ent.reserves[i] = Math.min(WEAPONS[i].cap, ent.reserves[i] + Math.round(WEAPONS[i].cap * 0.18));
        this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "ПАТРОНЫ +", color: "#ffb020", t: 0.9, max: 0.9, size: 14 });
        this.sfxIfMe(ent, "pickup");
        break;
      case 2: {
        const wi = pk.wi;
        ent.owned[wi] = true;
        ent.mags[wi] = WEAPONS[wi].magSize;
        ent.reserves[wi] = WEAPONS[wi].startReserve;
        this.switchWeaponEnt(ent, wi);
        ent.switchCool = 0;
        this.floaters.push({ x: pk.x, y: pk.y - 14, txt: WEAPONS[wi].name, color: "#a8ff3e", t: 1.2, max: 1.2, size: 16 });
        this.sfxIfMe(ent, "weaponGet");
        break;
      }
      case 3:
        ent.armor = Math.min(100, ent.armor + 50);
        this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "БРОНЯ +50", color: "#5fd8d0", t: 0.9, max: 0.9, size: 14 });
        this.sfxIfMe(ent, "armor");
        break;
      case 4: {
        const bk = BUFF_KINDS[(Math.random() * BUFF_KINDS.length) | 0];
        this.addBuff(ent, bk);
        break;
      }
      case 5: {
        // улучшение собирается из 3 фрагментов: сначала текущее оружие, потом первое неготовое
        let target = -1;
        if (ent.owned[ent.wi] && ent.upgradeProg[ent.wi] < UPGRADE_STAGES) target = ent.wi;
        else for (let i = 0; i < 4; i++) if (ent.owned[i] && ent.upgradeProg[i] < UPGRADE_STAGES) { target = i; break; }
        if (target >= 0) {
          ent.upgradeProg[target]++;
          const st = ent.upgradeProg[target];
          if (st >= UPGRADE_STAGES) {
            ent.upgraded[target] = true;
            this.floaters.push({ x: pk.x, y: pk.y - 14, txt: `${UPGRADES[target].label} ГОТОВ`, color: "#c07aff", t: 1.5, max: 1.5, size: 16 });
            this.queueFx({ k: "float", x: pk.x, y: pk.y - 14, txt: `${UPGRADES[target].label} ГОТОВ`, color: "#c07aff", size: 16 });
            this.burst(pk.x, pk.y, 22, "#c07aff", 220);
            this.queueFx({ k: "burst", x: pk.x, y: pk.y, n: 22, color: "#c07aff", speed: 220 });
            this.sfxIfMe(ent, "upgrade");
          } else {
            this.floaters.push({ x: pk.x, y: pk.y - 14, txt: `ФРАГМЕНТ ${st}/${UPGRADE_STAGES} · ${UPGRADES[target].label}`, color: "#9a7fd0", t: 1.1, max: 1.1, size: 13 });
            this.sfxIfMe(ent, "buffUp1");
          }
        } else {
          this.score += 250;
          this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "ВСЁ УЛУЧШЕНО +250", color: "#c07aff", t: 1, max: 1, size: 13 });
        }
        break;
      }
      case 6: {
        // surprise crate: 50% buff, 50% debuff (включая новые МРАК и ПОДКРЕПЛЕНИЕ)
        this.sfxIfMe(ent, "surprise");
        if (Math.random() < 0.5) {
          const bk = BUFF_KINDS[(Math.random() * BUFF_KINDS.length) | 0];
          this.addBuff(ent, bk);
        } else {
          // теперь включаем dark и spawn в пул дебаффов
          const dk = DEBUFF_KINDS[(Math.random() * DEBUFF_KINDS.length) | 0];
          this.addDebuff(dk, ent);
        }
        break;
      }
      case 11: {
        // БАТАРЕЙКА - возрождение после смерти
        ent.revive = true;
        this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "БАТАРЕЙКА", color: "#ffb020", t: 1.4, max: 1.4, size: 15 });
        this.sfxIfMe(ent, "pickup");
        break;
      }
      case 7:
        ent.sprayT = 4;
        ent.sprayCool = 0;
        this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "ШАКТИ-ШКВАЛ!", color: "#ffb020", t: 1.1, max: 1.1, size: 15 });
        this.sfxIfMe(ent, "pickup");
        break;
      case 8:
        this.launchRocket(ent);
        break;
      case 9: {
        // пассивный бафф (коллектибл)
        const id = pk.buff!;
        const def = buffDef(id);
        if (ent.stacks[id] >= def.cap) {
          this.score += 100;
          this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "МАКСИМУМ +100", color: "#8fae85", t: 0.9, max: 0.9, size: 12 });
        } else {
          this.addStack(ent, id);
        }
        break;
      }
      case 10: {
        // подствольное оружие
        const k = pk.ub!;
        if (ent.ubOwned[k]) {
          this.score += 150;
          this.floaters.push({ x: pk.x, y: pk.y - 14, txt: "УЖЕ ЕСТЬ +150", color: "#8fae85", t: 0.9, max: 0.9, size: 12 });
        } else {
          ent.ubOwned[k] = true;
          ent.ubIdx = k;
          this.floaters.push({ x: pk.x, y: pk.y - 14, txt: UNDERBARRELS[k].name, color: "#ffb020", t: 1.4, max: 1.4, size: 15 });
          this.queueFx({ k: "float", x: pk.x, y: pk.y - 14, txt: UNDERBARRELS[k].name, color: "#ffb020", size: 15 });
          this.sfxIfMe(ent, "weaponGet");
        }
        break;
      }
    }
    this.burst(pk.x, pk.y, 10, "#a8ff3e", 140);
    this.queueFx({ k: "burst", x: pk.x, y: pk.y, n: 10, color: "#a8ff3e", speed: 140 });
    this.pushHud();
  }

  private sfxIfMe(ent: PlayerEnt, id: string) {
    if (ent === this.me) this.sfx(id);
    else this.queueFx({ k: "snd", id, dist: Math.hypot(ent.x - this.me.x, ent.y - this.me.y) });
  }

  /* ---------------- update ---------------- */

  private frame(dt: number) {
    if (this.phase === "playing") {
      if (this.isAuthority) this.updateAuthority(dt);
      else this.updateClient(dt);
    } else if (this.phase === "menu") this.updateDemo(dt);
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
    if (!this.me) {
      this.players = [this.makeEnt(0, "ДЕМО", 0)];
      this.me = this.players[0];
    }
    this.me.x = px; this.me.y = py;
    this.me.prevX = px; this.me.prevY = py;
    const aim = this.demoT * 0.5;
    this.me.aim = aim;
    this.buildFov(px, py, aim);
    this.accumulateExplored();
    this.hudAcc += dt;
    if (this.hudAcc >= 0.25) { this.hudAcc = 0; this.pushHud(); }
  }

  private updateFx(dt: number) {
    this.stepParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 26);
    this.stepFloaters(dt);
    for (const f of this.flashes) f.t -= dt;
    this.flashes = this.flashes.filter((f) => f.t > 0);
  }

  private updateMeMovement(dt: number) {
    const P = this.me;
    if (!P || P.dead) return;
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
    P.vx *= fr; P.vy *= fr;
    const spd = Math.hypot(P.vx, P.vy);
    const maxSpd = 292 * P.stats.spdMul * (P.buffs.swift > 0 ? 1.45 : 1);
    if (spd > maxSpd && P.dashCool < 1.7) {
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
  }

  private updateEntCombat(ent: PlayerEnt, dt: number) {
    if (ent.dead) return;
    ent.fireCool -= dt;
    ent.switchCool = Math.max(0, ent.switchCool - dt);
    ent.recoil = Math.max(0, ent.recoil - dt * 4);
    ent.hurtFx = Math.max(0, ent.hurtFx - dt * 2.2);
    ent.dashCool = Math.max(0, ent.dashCool - dt);
    for (const k of BUFF_KINDS) ent.buffs[k] = Math.max(0, ent.buffs[k] - dt);
    ent.stillT = Math.max(0, ent.stillT - dt);
    ent.sprayT = Math.max(0, ent.sprayT - dt);

    // подстволы: кулдауны и активные режимы
    for (let i = 0; i < 4; i++) ent.ubCool[i] = Math.max(0, ent.ubCool[i] - dt);
    if (ent.ubFlame > 0) { ent.ubFlame -= dt; this.tickFlame(ent, dt); }
    if (ent.ubCold > 0) { ent.ubCold -= dt; this.tickCold(ent); }

    // regen (до максимума, заданного стаками живучести)
    const maxHp = ent.stats.maxHp;
    if (this.time - ent.lastHurt > 4.5 && ent.hp < maxHp) ent.hp = Math.min(maxHp, ent.hp + 3.2 * dt);

    // still debuff damage
    if (ent.stillT > 0) {
      const moved = Math.hypot(ent.x - ent.prevX, ent.y - ent.prevY) / Math.max(dt, 0.001);
      if (moved < 26) {
        ent.stillAcc += dt;
        if (ent.stillAcc >= 0.5) {
          ent.stillAcc = 0;
          this.damageEnt(ent, 4, ent.x, ent.y - 1);
          this.floaters.push({ x: ent.x, y: ent.y - 30, txt: "ДВИГАЙСЯ!", color: "#e8c834", t: 0.5, max: 0.5, size: 11 });
        }
      } else ent.stillAcc = 0;
    }
    ent.prevX = ent.x; ent.prevY = ent.y;

    // spray bonus
    if (ent.sprayT > 0) {
      ent.sprayCool -= dt;
      if (ent.sprayCool <= 0) { ent.sprayCool = 0.09; this.fireSpray(ent); }
    }

    // reload
    if (ent.reloadT >= 0) {
      const w = weaponStats(ent.wi, ent.upgraded[ent.wi]);
      ent.reloadT += dt / w.reload;
      if (ent.reloadT >= 1) {
        ent.reloadT = -1;
        const need = w.magSize - ent.mags[ent.wi];
        if (ent.wi === 0) ent.mags[0] = w.magSize;
        else {
          const take = Math.min(need, ent.reserves[ent.wi]);
          ent.mags[ent.wi] += take;
          ent.reserves[ent.wi] -= take;
        }
        if (ent === this.me) this.sfx("reload1");
        this.pushHud();
      }
    }

    // fire
    const fireHeld = ent.isRemote ? ent.fireHeld : this.mouse.down;
    if (fireHeld && ent.fireCool <= 0) this.fireEnt(ent);

    // underbarrel fire (ПКМ): локальный игрок — rmbQueued, сетевой — ubQueued
    const wantUb = ent === this.me ? this.rmbQueued : ent.ubQueued;
    if (wantUb) {
      if (ent === this.me) this.rmbQueued = false;
      else ent.ubQueued = false;
      this.fireUnderbarrel(ent);
    }
  }

  private updateAuthority(dt: number) {
    this.time += dt;

    // local player movement
    this.updateMeMovement(dt);

    // foe mod timers
    this.foeModT.hp = Math.max(0, this.foeModT.hp - dt);
    this.foeModT.dmg = Math.max(0, this.foeModT.dmg - dt);
    this.foeModT.spd = Math.max(0, this.foeModT.spd - dt);

    // combat for all players
    for (const ent of this.players) this.updateEntCombat(ent, dt);

    // fov & explored (from me)
    if (!this.me.dead) {
      this.buildFov(this.me.x, this.me.y, this.me.aim);
      this.accumulateExplored();
    }

    // waves
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) {
        this.rotateMap();
        this.betweenT = 3.2;
      }
    } else if (!this.waveActive) {
      this.betweenT -= dt;
      if (this.betweenT <= 0) this.startWave(this.wave + 1);
    } else if (this.bots.length === 0 && this.pending.length === 0) {
      this.waveActive = false;
      const bonus = 200 + this.wave * 50;
      this.score += bonus;
      for (const ent of this.players) if (!ent.dead) ent.hp = Math.min(ent.stats.maxHp, ent.hp + 18);
      for (const ent of this.players) for (let i = 1; i < 4; i++) if (ent.owned[i]) ent.reserves[i] = Math.min(WEAPONS[i].cap, ent.reserves[i] + Math.round(WEAPONS[i].cap * 0.15));
      this.cbs.onBanner("СЕКТОР ЗАЧИЩЕН", `бонус +${bonus} · аптечка и патроны пополнены`);
      this.sfx("pickup");
      
      // пауза 10 секунд перед сменой карты после босса (каждые 3 уровня)
      if (this.wave % 3 === 0) {
        this.pauseTimer = 10;
        this.cbs.onBanner("ПАУЗА", "смена сектора через 10 секунд");
      } else {
        this.betweenT = 3.2;
      }
      this.pushHud();
    }

    // pending spawns
    for (const s of this.pending) s.t -= dt;
    for (const s of this.pending) if (s.t <= 0) this.spawnBot(s.kind, s.x, s.y, s.boss);
    this.pending = this.pending.filter((s) => s.t > 0);

    // supply drops
    this.supplyT += dt;
    if (this.supplyT > 18) {
      this.supplyT = 0;
      if (this.pickups.length < 8) {
        const spot = this.pickCrateSpot();
        this.pickups.push({ id: this.pickId++, kind: Math.random() < 0.5 ? 1 : 0, wi: 0, x: spot.x, y: spot.y, t: 0, visible: false });
      }
    }
    // surprise crates appear over time
    this.surpriseT += dt;
    if (this.surpriseT > 26) {
      this.surpriseT = 0;
      if (this.pickups.length < 8) {
        const spot = this.pickCrateSpot();
        this.pickups.push({ id: this.pickId++, kind: 6, wi: 0, x: spot.x, y: spot.y, t: 0, visible: false });
      }
    }

    this.tickAuras(dt);
    this.updateBots(dt);
    this.updateBullets(dt);
    this.tickGrenades(dt);
    this.updatePickups(dt);
    this.stepParticles(dt);
    this.stepFloaters(dt);
    this.stepLightnings(dt);
    this.stepVamps(dt);
    for (const f of this.flashes) f.t -= dt;
    this.flashes = this.flashes.filter((f) => f.t > 0);
    for (const h of this.hitmarks) h.t -= dt;
    this.hitmarks = this.hitmarks.filter((h) => h.t > 0);
    this.shake = Math.max(0, this.shake - dt * 30);

    // camera
    const tx = this.camClampX(this.me.x - this.viewW / 2);
    const ty = this.camClampY(this.me.y - this.viewH / 2);
    const cl = 1 - Math.exp(-9 * dt);
    this.camX += (tx - this.camX) * cl;
    this.camY += (ty - this.camY) * cl;

    // hud + vignette
    this.hudAcc += dt;
    if (this.hudAcc >= 0.08) { this.hudAcc = 0; this.pushHud(); }
    this.updateVignette();

    // net: send snapshots
    if (this.netMode === "host" && this.netClient) {
      this.snapAcc += dt;
      if (this.snapAcc >= 0.05) {
        this.snapAcc = 0;
        if (this.fxQueue.length) {
          this.netClient.send({ t: "fx", ev: this.fxQueue });
          this.fxQueue = [];
        }
        this.netClient.send({ t: "snap", s: this.buildSnap() });
      }
    }
  }

  private updateClient(dt: number) {
    this.time += dt;
    this.updateMeMovement(dt);

    // send input ~30Hz
    this.inAcc += dt;
    if (this.inAcc >= 0.033 && this.netClient) {
      this.inAcc = 0;
      this.netClient.send({
        t: "in", x: this.me.x, y: this.me.y, aim: this.me.aim,
        fire: this.mouse.down && !this.me.dead, weapon: this.me.wi, reloadSeq: this.me.reloadSeqSeen,
        ub: this.me.ubIdx, rmb: this.me.rmbSeq,
      });
      // also send weapon switch request immediately when keys pressed
      for (let i = 0; i < 4; i++) {
        const code = `Digit${i + 1}` as any;
        if (this.keys.has(code) && this.me.owned[i] && this.me.wi !== i) {
          this.switchWeaponEnt(this.me, i);
          this.netClient.send({
            t: "in", x: this.me.x, y: this.me.y, aim: this.me.aim,
            fire: this.mouse.down && !this.me.dead, weapon: i, reloadSeq: this.me.reloadSeqSeen,
            ub: this.me.ubIdx, rmb: this.me.rmbSeq,
          });
        }
      }
    }

    this.applySnapshot();

    if (!this.me.dead) {
      this.buildFov(this.me.x, this.me.y, this.me.aim);
      this.accumulateExplored();
    }

    this.stepParticles(dt);
    this.stepFloaters(dt);
    this.stepLightnings(dt);
    this.stepVamps(dt);
    for (const f of this.flashes) f.t -= dt;
    this.flashes = this.flashes.filter((f) => f.t > 0);
    for (const h of this.hitmarks) h.t -= dt;
    this.hitmarks = this.hitmarks.filter((h) => h.t > 0);
    this.shake = Math.max(0, this.shake - dt * 30);

    const tx = this.camClampX(this.me.x - this.viewW / 2);
    const ty = this.camClampY(this.me.y - this.viewH / 2);
    const cl = 1 - Math.exp(-9 * dt);
    this.camX += (tx - this.camX) * cl;
    this.camY += (ty - this.camY) * cl;

    this.hudAcc += dt;
    if (this.hudAcc >= 0.08) { this.hudAcc = 0; this.pushHud(); }
    this.updateVignette();
  }

  private updateVignette() {
    if (this.vignetteEl && this.me) {
      const lowHp = this.me.hp < 32 && !this.me.dead ? 0.16 + 0.1 * Math.sin(this.time * 6) : 0;
      this.vignetteEl.style.opacity = String(clamp(this.me.hurtFx * 0.6 + lowHp, 0, 0.75));
    }
  }

  /* ---------------- client snapshot apply ---------------- */

  private applySnapshot() {
    const s = this.snapCurr;
    if (!s) return;

    // map rotation
    if (s.mapId !== this.mapId) {
      this.mapId = s.mapId;
      this.mapSeed = s.seed;
      this.newWorld(this.mapSeed, this.presetFor(this.mapId));
      this.exploredCtx.clearRect(0, 0, MAP_W, MAP_H);
    }

    this.wave = s.wave;
    this.waveActive = s.waveActive;
    this.score = s.score;
    this.foeModT = { hp: s.foeMods.hp > 1 ? 1 : 0, dmg: s.foeMods.dmg > 1 ? 1 : 0, spd: s.foeMods.spd > 1 ? 1 : 0 };

    // interpolation alpha
    let alpha = 1;
    if (this.snapPrev) {
      const span = this.snapCurrAt - this.snapPrevAt;
      if (span > 0) alpha = clamp((performance.now() - 70 - this.snapPrevAt) / span, 0, 1.4);
    }
    const lerp = (a: number, b: number) => a + (b - a) * Math.min(1, alpha);

    // players
    for (const ps of s.players) {
      let ent = this.players.find((p) => p.id === ps.id);
      if (!ent) {
        ent = this.makeEnt(ps.id, ps.name, ps.colorIdx);
        ent.isRemote = ps.id !== this.meId;
        this.players.push(ent);
      }
      // статы/подстволы — авторитетно от хоста
      const st = emptyStacks();
      for (const [k, n] of ps.stacks) st[k as StatBuffId] = n;
      ent.stacks = st;
      ent.stats = computeStats(st);
      ent.ubOwned = [0, 1, 2, 3].map((i) => (ps.ubMask & (1 << i)) !== 0);
      ent.ubIdx = ps.ubIdx;
      ent.ubCool = ps.ubCool;
      ent.ubFlame = ps.ubFlame;
      ent.ubCold = ps.ubCold;
      // прогресс улучшений: 3 фрагмента = готово
      ent.upgradeProg = ps.prog.slice();
      for (let i = 0; i < 4; i++) ent.upgraded[i] = ent.upgradeProg[i] >= UPGRADE_STAGES;

      if (ent === this.me) {
        // keep local x/y/aim; take authoritative vitals
        ent.hp = ps.hp; ent.armor = ps.armor; ent.dead = ps.dead;
        ent.wi = ps.wi; ent.reloadT = ps.reload;
        ent.mags[ent.wi] = ps.mag;
        if (ps.reserve >= 0) ent.reserves[ent.wi] = ps.reserve;
        for (const k of BUFF_KINDS) ent.buffs[k] = ps.buffs.includes(k) ? 1 : 0;
        ent.stillT = ps.still;
      } else {
        ent.x = this.snapPrev ? lerp(this.prevPlayer(ps.id)?.x ?? ps.x, ps.x) : ps.x;
        ent.y = this.snapPrev ? lerp(this.prevPlayer(ps.id)?.y ?? ps.y, ps.y) : ps.y;
        ent.aim = ps.aim; ent.hp = ps.hp; ent.armor = ps.armor;
        ent.wi = ps.wi; ent.dead = ps.dead; ent.reloadT = ps.reload;
        for (const k of BUFF_KINDS) ent.buffs[k] = ps.buffs.includes(k) ? 1 : 0;
        ent.stillT = ps.still;
      }
    }
    this.players = this.players.filter((p) => s.players.some((sp) => sp.id === p.id) || p === this.me);

    // bots / bullets / pickups (render-only copies)
    this.bots = s.bots.map((b) => {
      const prev = this.prevBot(b.id);
      return {
        ...b,
        x: prev ? lerp(prev.x, b.x) : b.x,
        y: prev ? lerp(prev.y, b.y) : b.y,
        vx: 0, vy: 0, tx: b.x, ty: b.y, lastSeen: -99, seenX: b.seenX, seenY: b.seenY,
        cool: 0, strafe: 1, strafeT: 1, lunge: 0,
        weak: b.weak, aura: (b.aura || "") as AuraKind | "", auraR: b.kind === 3 ? (BOSSES[b.boss]?.auraR ?? 0) : 0,
        burn: b.burn ? 1 : 0, burnDps: 5, burnSrc: -1, slow: b.slow ? 1 : 0, lastSrc: -1,
        visible: false,
      } as unknown as Bot;
    });
    for (const b of this.bots) (b as unknown as { visible: boolean }).visible = this.isVisible(b.x, b.y, b.r);

    this.bullets = s.bullets.map((bl) => {
      const prev = this.prevBullet(bl.id);
      return {
        ...bl,
        x: prev ? lerp(prev.x, bl.x) : bl.x,
        y: prev ? lerp(prev.y, bl.y) : bl.y,
        px: prev ? lerp(prev.px, bl.px) : bl.px,
        py: prev ? lerp(prev.py, bl.py) : bl.py,
        vx: 0, vy: 0, dmg: 0, life: 1, owner: -1, targetId: -1,
      } as unknown as Bullet;
    });

    this.pickups = s.pickups.map((pk) => ({ ...pk, visible: false }));
    for (const pk of this.pickups) pk.visible = this.isVisible(pk.x, pk.y, 14);

    this.grenadePos = s.grenades.map((g) => ({ ...g }));
  }

  private prevPlayer(id: number): PlayerSnap | undefined { return this.snapPrev?.players.find((p) => p.id === id); }
  private prevBot(id: number) { return this.snapPrev?.bots.find((b) => b.id === id); }
  private prevBullet(id: number) { return this.snapPrev?.bullets.find((b) => b.id === id); }

  private buildSnap(): Snap {
    return {
      time: this.time,
      wave: this.wave,
      waveActive: this.waveActive,
      score: this.score,
      mapId: this.mapId,
      seed: this.mapSeed,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, colorIdx: p.colorIdx,
        x: Math.round(p.x), y: Math.round(p.y), aim: p.aim,
        hp: Math.round(p.hp), armor: Math.round(p.armor), wi: p.wi, r: p.r,
        dead: p.dead, reload: p.reloadT,
        buffs: BUFF_KINDS.filter((k) => p.buffs[k] > 0),
        still: p.stillT,
        mag: p.mags[p.wi], reserve: p.wi === 0 ? -1 : p.reserves[p.wi],
        prog: p.upgradeProg.slice(),
        stacks: Object.entries(p.stacks).filter(([, n]) => n > 0) as [string, number][],
        ubMask: p.ubOwned.reduce((m, o, i) => m | (o ? 1 << i : 0), 0),
        ubIdx: p.ubIdx,
        ubCool: p.ubCool.map((c) => Math.round(c * 10) / 10),
        ubFlame: Math.round(p.ubFlame * 10) / 10,
        ubCold: Math.round(p.ubCold * 10) / 10,
      })),
      bots: this.bots.map((b) => ({
        id: b.id, kind: b.kind, boss: b.boss,
        x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp), maxHp: Math.round(b.maxHp), r: b.r,
        dir: b.dir, state: b.state, flash: b.flash, weak: b.weak, aura: b.aura, spawnT: b.spawnT,
        seenX: Math.round(b.seenX), seenY: Math.round(b.seenY),
        burn: b.burn > 0, slow: b.slow > 0,
        auraMul: Math.round(b.auraMul * 100) / 100,
        weapon: b.weapon ?? 0, speedMul: b.speedMul ?? 1, resist: b.resist ?? 1,
      })),
      bullets: this.bullets.map((bl) => ({
        id: bl.id, x: Math.round(bl.x), y: Math.round(bl.y), px: Math.round(bl.px), py: Math.round(bl.py),
        friendly: bl.friendly, kind: bl.kind, rocket: bl.rocket, crit: bl.crit === true,
      })),
      pickups: this.pickups.map((pk) => ({ id: pk.id, kind: pk.kind, wi: pk.wi, x: Math.round(pk.x), y: Math.round(pk.y), t: pk.t, buff: pk.buff, ub: pk.ub })),
      grenades: this.grenadePos.map((g) => ({ x: Math.round(g.x), y: Math.round(g.y), k: Math.round(g.k * 100) / 100 })),
      foeMods: { hp: this.foeHpMul(), dmg: this.foeDmgMul(), spd: this.foeSpdMul() },
    };
  }

  /* ---------------- bots ---------------- */

  private nearestAlivePlayer(x: number, y: number): PlayerEnt | null {
    let best: PlayerEnt | null = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (p.dead) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private updateBots(dt: number) {
    const spdMul = this.foeSpdMul();
    const dmgMul = this.foeDmgMul();
    for (const b of [...this.bots]) {
      // DoT горения (огнемёт)
      if (b.burn > 0) {
        b.burn -= dt;
        this.damageBot(b, b.burnDps * dt, 99, false, b.burnSrc, true);
        if (Math.random() < dt * 14) this.burst(b.x, b.y, 1, "#ff9a3d", 60);
        if (b.hp <= 0) continue; // сгорел — дальше не обновляем
      }
      b.slow = Math.max(0, b.slow - dt);

      const target = this.nearestAlivePlayer(b.x, b.y);
      if (!target) continue;
      const isBoss = b.kind === 3;
      const def = isBoss ? null : BOTS[b.kind];
      const bd = isBoss ? BOSSES[b.boss] : null;
      const speed = (isBoss ? bd!.speed * b.speedMul : def!.speed) * spdMul * (b.slow > 0 ? 0.7 : 1);
      const sight = isBoss ? 900 : def!.sight;
      const range = isBoss ? 560 : def!.range;

      b.spawnT = Math.min(1, b.spawnT + dt / 0.7);
      b.flash = Math.max(0, b.flash - dt);
      b.cool -= dt;
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = 1 + Math.random() * 1.8; }

      const d2p = dist2(b.x, b.y, target.x, target.y);
      const dp = Math.sqrt(d2p);
      const see = d2p < sight * sight && losClear(this.world.rects, b.x, b.y, target.x, target.y);

      if (see) {
        if (b.state === 0) {
          for (const o of this.bots) {
            if (o !== b && o.state === 0 && dist2(o.x, o.y, b.x, b.y) < 340 * 340) {
              o.state = 1; o.seenX = target.x; o.seenY = target.y; o.lastSeen = this.time;
            }
          }
        }
        b.state = 1;
        b.lastSeen = this.time;
        b.seenX = target.x; b.seenY = target.y;
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
        mx = Math.cos(a) * speed * 0.55;
        my = Math.sin(a) * speed * 0.55;
      } else {
        const gx = see ? target.x : b.seenX;
        const gy = see ? target.y : b.seenY;
        const a = Math.atan2(gy - b.y, gx - b.x);
        if (isBoss) {
          const want = dp > 300 ? 1 : dp < 180 ? -0.6 : 0;
          mx = Math.cos(a) * speed * want + Math.cos(a + Math.PI / 2) * speed * 0.4 * b.strafe;
          my = Math.sin(a) * speed * want + Math.sin(a + Math.PI / 2) * speed * 0.4 * b.strafe;
        } else if (b.kind === 0) {
          const want = dp > range * 0.8 ? 1 : dp < 190 ? -0.8 : 0;
          mx = Math.cos(a) * speed * want + Math.cos(a + Math.PI / 2) * speed * 0.5 * b.strafe;
          my = Math.sin(a) * speed * want + Math.sin(a + Math.PI / 2) * speed * 0.5 * b.strafe;
        } else if (b.kind === 1) {
          b.lunge = Math.max(0, b.lunge - dt);
          const boost = dp < 150 && b.lunge <= 0 && b.cool <= 0 ? 2.4 : 1;
          if (boost > 1) b.lunge = 1.1;
          mx = Math.cos(a) * speed * boost;
          my = Math.sin(a) * speed * boost;
          if (dp < b.r + target.r + 6 && b.cool <= 0) {
            b.cool = 0.85;
            this.damageEnt(target, BOTS[1].dmg * dmgMul, b.x, b.y);
          }
        } else {
          const want = dp > 250 ? 1 : 0;
          mx = Math.cos(a) * speed * want;
          my = Math.sin(a) * speed * want;
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
      if (isBoss) {
        if (see && dp < 620 && b.cool <= 0 && b.spawnT >= 1) {
          b.cool = 1.1 * (0.85 + Math.random() * 0.4);
          this.bossFire(b, bd!, dmgMul, target);
        }
      } else if (b.kind !== 1 && see && dp < range && b.cool <= 0 && b.spawnT >= 1) {
        b.cool = def!.rate * (0.85 + Math.random() * 0.4);
        this.botFire(b, dmgMul, target);
      }

      // boss aura effects
      if (isBoss && bd) this.applyBossAura(b, bd, dt);
    }
  }

  private applyBossAura(b: Bot, bd: BossDef, dt: number) {
    // --- динамика поля: медленное «дыхание» + внезапные всплески активности ---
    b.auraNext -= dt;
    if (b.auraNext <= 0) {
      // пик: поле резко раздувается, эффекты злее
      b.auraPulse = 1;
      b.auraNext = 2.4 + Math.random() * 2.8;
      const d0 = Math.hypot(b.x - this.me.x, b.y - this.me.y);
      this.sfx("auraSpike", d0);
      this.shake = Math.min(20, this.shake + 6);
      this.queueFx({ k: "shake", v: 4 });
      this.queueFx({ k: "flash", x: b.x, y: b.y, r: bd.auraR * 1.25, color: AURAS[bd.aura].color });
      this.flashes.push({ x: b.x, y: b.y, r: bd.auraR * 1.25, t: 0.32, max: 0.32, color: AURAS[bd.aura].color });
      this.burst(b.x, b.y, 26, AURAS[bd.aura].color, 240);
      this.queueFx({ k: "burst", x: b.x, y: b.y, n: 26, color: AURAS[bd.aura].color, speed: 240 });
    }
    b.auraPulse = Math.max(0, b.auraPulse - dt * 0.85); // всплеск откатывается ~1.2 с
    b.auraMul = (1 + 0.1 * Math.sin(this.time * 2.2 + b.id * 1.7)) * (1 + 0.5 * b.auraPulse);

    const R = bd.auraR * b.auraMul;
    const intensity = 1 + 0.9 * b.auraPulse; // на пике урон/тяга почти вдвое выше

    const auraColor = AURAS[bd.aura].color;
    for (const p of this.players) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d > R) continue;
      if (bd.aura === "slow") {
        const f = Math.exp(-(2.6 + 2.8 * b.auraPulse) * dt);
        p.vx *= f;
        p.vy *= f;
      } else if (bd.aura === "burn") {
        (p as PlayerEnt & { burnAcc?: number }).burnAcc = ((p as PlayerEnt & { burnAcc?: number }).burnAcc ?? 0) + dt;
        if ((p as PlayerEnt & { burnAcc?: number }).burnAcc! >= 0.5) {
          (p as PlayerEnt & { burnAcc?: number }).burnAcc = 0;
          this.damageEnt(p, 6 * intensity, b.x, b.y);
        }
        if (Math.random() < 0.3 + 0.4 * b.auraPulse) this.burst(p.x, p.y, 1, auraColor, 60 + 80 * b.auraPulse);
      } else if (bd.aura === "vortex") {
        const a = Math.atan2(b.y - p.y, b.x - p.x);
        const pull = 340 * intensity * (1 - d / R);
        p.vx += Math.cos(a) * pull * dt * 4;
        p.vy += Math.sin(a) * pull * dt * 4;
      }
    }
  }

  private updateBullets(dt: number) {
    const rects = this.world.rects;
    for (const bl of this.bullets) {
      bl.px = bl.x; bl.py = bl.y;

      // rocket homing
      if (bl.rocket) {
        let target = this.bots.find((b) => b.id === bl.targetId);
        if (!target) {
          let bdd = Infinity;
          for (const b of this.bots) {
            const d = dist2(b.x, b.y, bl.x, bl.y);
            if (d < bdd) { bdd = d; target = b; }
          }
          if (target) bl.targetId = target.id;
        }
        if (target) {
          const want = Math.atan2(target.y - bl.y, target.x - bl.x);
          const cur = Math.atan2(bl.vy, bl.vx);
          let da = angNorm(want - cur);
          da = clamp(da, -4.5 * dt, 4.5 * dt);
          const sp = Math.hypot(bl.vx, bl.vy) * 1.02;
          const na = cur + da;
          bl.vx = Math.cos(na) * sp;
          bl.vy = Math.sin(na) * sp;
        }
        this.particles.push({ x: bl.x, y: bl.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.3, max: 0.3, size: 4, color: "rgba(255,176,32,0.7)", drag: 3 });
      }

      bl.x += bl.vx * dt;
      bl.y += bl.vy * dt;
      bl.life -= dt;
      let dead = bl.life <= 0;

      if (!dead) {
        for (let i = 0; i < rects.length; i++) {
          if (this.segHit(bl.px, bl.py, bl.x, bl.y, rects[i]) >= 0) {
            dead = true;
            if (bl.rocket) this.explode(bl.x, bl.y, bl.dmg, bl.owner);
            else this.burst(bl.x, bl.y, 4, bl.friendly ? "#d0ff7a" : "#ff9a3d", 120);
            break;
          }
        }
      }
      if (!dead && bl.friendly) {
        for (const b of this.bots) {
          if (bl.hitIds && bl.hitIds.includes(b.id)) continue; // уже прошита
          const rr = b.r + 3;
          if (dist2(bl.x, bl.y, b.x, b.y) < rr * rr) {
            if (bl.rocket) {
              dead = true;
              this.explode(bl.x, bl.y, bl.dmg, bl.owner);
              break;
            }
            // цепная молния — до урона (исходит от точки попадания)
            const shooter = this.players.find((p) => p.id === bl.owner);
            if (shooter) this.tryChain(shooter, b, bl.dmg);
            this.damageBot(b, bl.dmg, bl.kind, bl.crit === true, bl.owner);
            // отдача попадания: импульс пули толкает врага (боссы тяжелее)
            const bsp = Math.hypot(bl.vx, bl.vy);
            if (bsp > 0) {
              const imp = Math.min(260, bl.dmg * 3.2) * (bl.crit ? 1.4 : 1) * (b.kind === 3 ? 0.22 : 1);
              b.vx += (bl.vx / bsp) * imp;
              b.vy += (bl.vy / bsp) * imp;
            }
            if ((bl.pierce ?? 0) > 0) {
              bl.pierce = (bl.pierce ?? 0) - 1;
              if (!bl.hitIds) bl.hitIds = [];
              bl.hitIds.push(b.id);
              // пуля летит дальше — не умирает
            } else {
              dead = true;
              break;
            }
          }
        }
      } else if (!dead && !bl.friendly) {
        for (const p of this.players) {
          if (p.dead) continue;
          const rr = p.r + 2;
          if (dist2(bl.x, bl.y, p.x, p.y) < rr * rr) {
            dead = true;
            this.damageEnt(p, bl.dmg, bl.x - bl.vx, bl.y - bl.vy);
            break;
          }
        }
      }
      if (dead) bl.life = -1;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  private explode(x: number, y: number, dmg: number, owner: number) {
    const R = 130;
    this.flashes.push({ x, y, r: R, t: 0.35, max: 0.35, color: "#ffb020" });
    this.queueFx({ k: "flash", x, y, r: R, color: "#ffb020" });
    this.burst(x, y, 40, "#ff9a3d", 380);
    this.burst(x, y, 20, "#ffd98a", 300);
    this.queueFx({ k: "burst", x, y, n: 40, color: "#ff9a3d", speed: 380 });
    this.sfx("explosion", Math.hypot(x - this.me.x, y - this.me.y));
    this.queueFx({ k: "shake", v: 10 });
    this.shake = Math.min(24, this.shake + 10);
    for (const b of [...this.bots]) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < R + b.r) this.damageBot(b, dmg * (1 - d / (R + b.r)) + 40, 4);
    }
    void owner;
  }

  private segHit(x0: number, y0: number, x1: number, y1: number, r: Rect) {
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
    for (const pk of this.pickups) {
      pk.t += dt;
      pk.visible = this.isVisible(pk.x, pk.y, 14);
      for (const p of this.players) {
        if (p.dead) continue;
        if (dist2(pk.x, pk.y, p.x, p.y) < 30 * 30) {
          pk.t = -999;
          this.applyPickup(p, pk);
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((p) => p.t > -900);
  }

  private stepParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr;
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
    const P = this.phase === "menu" ? this.me : this.me;
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
    const px = this.me.x - this.camX;
    const py = this.me.y - this.camY;
    const g1 = m.createRadialGradient(px, py, 0, px, py, AMBIENT_R);
    g1.addColorStop(0, "rgba(255,255,255,0.85)");
    g1.addColorStop(1, "rgba(255,255,255,0)");
    m.fillStyle = g1;
    m.beginPath();
    m.arc(px, py, AMBIENT_R, 0, TAU);
    m.fill();
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

    // pickups
    for (const pk of this.pickups) {
      if (!pk.visible) continue;
      this.drawPickup(ctx, pk);
    }

    // подствольные гранаты в полёте (дуга)
    for (const g of this.grenadePos) {
      const h = g.k * 26;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(g.x, g.y + 4, 5, 2.5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#31402a";
      ctx.beginPath(); ctx.arc(g.x, g.y - h, 5.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#ffb020";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(g.x, g.y - h, 5.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = "#ffb020";
      ctx.fillRect(g.x - 1, g.y - h - 8, 2, 3);
    }

    this.drawWalls(ctx);

    if (this.phase !== "menu") {
      this.drawBots(ctx);
      this.drawPlayers(ctx);
    }

    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // FOG
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

    if (this.fovPoly.length > 2 && this.me) {
      const px = this.me.x - camX;
      const py = this.me.y - camY;
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

    // ABOVE FOG
    ctx.save();
    ctx.translate(-camX, -camY);
    ctx.globalCompositeOperation = "lighter";

    for (const bl of this.bullets) {
      const isCrit = bl.crit === true;
      const col = bl.friendly ? (bl.rocket ? "#ffb020" : isCrit ? "#ffd23e" : "#d0ff7a") : "#ff9a3d";
      ctx.strokeStyle = col;
      ctx.globalAlpha = isCrit ? 0.45 : 0.28;
      ctx.lineWidth = bl.rocket ? 9 : isCrit ? 10 : 6;
      ctx.beginPath();
      ctx.moveTo(bl.px, bl.py);
      ctx.lineTo(bl.x, bl.y);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = bl.rocket ? 4 : isCrit ? 3.6 : 2.2;
      ctx.beginPath();
      ctx.moveTo(bl.px, bl.py);
      ctx.lineTo(bl.x, bl.y);
      ctx.stroke();
      if (isCrit) {
        ctx.fillStyle = "#fff2b8";
        ctx.beginPath(); ctx.arc(bl.x, bl.y, 3.4, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

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

    // boss auras — heavy, breathing fields with activity spikes
    for (const b of this.bots) {
      if (b.kind === 3 && b.aura && b.auraR > 0) this.drawBossAura(ctx, b);
    }

    // аура горения игрока
    for (const p of this.players) {
      if (p.dead || p.stats.auraR <= 0) continue;
      const pul = 1 + 0.04 * Math.sin(this.time * 5);
      const R = p.stats.auraR * pul;
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#ff9a3d";
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 9]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, this.time * 0.9, this.time * 0.9 + TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      const ag = ctx.createRadialGradient(p.x, p.y, R * 0.4, p.x, p.y, R);
      ag.addColorStop(0, "rgba(255,120,40,0)");
      ag.addColorStop(1, "rgba(255,120,40,0.13)");
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // струя огнемёта
    for (const p of this.players) {
      if (p.dead || p.ubFlame <= 0) continue;
      const len = rayDist(this.world.rects, p.x, p.y, p.aim, 120);
      const ex = p.x + Math.cos(p.aim) * len;
      const ey = p.y + Math.sin(p.aim) * len;
      const flick = 0.75 + 0.25 * Math.sin(this.time * 40 + p.id);
      ctx.globalAlpha = 0.3 * flick;
      ctx.strokeStyle = "#ff6a2e";
      ctx.lineWidth = 26;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.x + Math.cos(p.aim) * 16, p.y + Math.sin(p.aim) * 16); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.globalAlpha = 0.8 * flick;
      ctx.strokeStyle = "#ffd98a";
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(p.x + Math.cos(p.aim) * 16, p.y + Math.sin(p.aim) * 16); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.lineCap = "butt";
      ctx.globalAlpha = 1;
    }

    // конус холода
    for (const p of this.players) {
      if (p.dead || p.ubCold <= 0) continue;
      ctx.globalAlpha = 0.14 + 0.05 * Math.sin(this.time * 7);
      ctx.fillStyle = "#5fd8d0";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, 150, p.aim - Math.PI / 6, p.aim + Math.PI / 6);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = "#8fe8e4";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // цепные молнии
    for (const l of this.lightnings) {
      const k = l.t / l.max;
      ctx.globalAlpha = k;
      ctx.strokeStyle = "#cfeaff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.pts[0].x, l.pts[0].y);
      for (let i = 1; i < l.pts.length; i++) ctx.lineTo(l.pts[i].x, l.pts[i].y);
      ctx.stroke();
      ctx.strokeStyle = "#7db8ff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // частицы вампиризма
    for (const v of this.vamps) {
      ctx.globalAlpha = clamp(v.t, 0, 1);
      ctx.fillStyle = "#7dff8a";
      ctx.beginPath(); ctx.arc(v.x, v.y, 3, 0, TAU); ctx.fill();
      ctx.globalAlpha = clamp(v.t, 0, 1) * 0.4;
      ctx.beginPath(); ctx.arc(v.x, v.y, 6, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const s of this.pending) {
      if (s.t < 1.1) {
        const k = 1 - s.t / 1.1;
        ctx.globalAlpha = 0.35 + 0.4 * Math.sin(this.time * 10 + s.x);
        ctx.strokeStyle = s.kind === 3 ? "#ffb020" : "#ff3b30";
        ctx.lineWidth = s.kind === 3 ? 3 : 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, (s.kind === 3 ? 44 : 26) - k * 14, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y);
        ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    for (const fl of this.floaters) {
      ctx.globalAlpha = clamp(fl.t / fl.max, 0, 1);
      ctx.font = `${fl.size}px 'Russo One', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.txt, fl.x, fl.y);
    }
    ctx.globalAlpha = 1;

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

    if (this.phase === "playing" && this.me && !this.me.dead) this.drawCrosshair(ctx);

    this.drawMinimap();
  }

  /** «тяжёлое» энергетическое поле босса: дышит, вспыхивает, несёт обломки */
  private drawBossAura(ctx: CanvasRenderingContext2D, b: Bot) {
    const ad = AURAS[(b.aura || "burn") as AuraKind];
    const col = ad.color;
    const mul = b.auraMul || 1;
    const R = b.auraR * mul;
    const t = this.time;
    const pk = clamp((mul - 1) / 0.6, 0, 1); // 0 — покой, 1 — пик всплеска
    const jit = 1.6 * pk;                      // дрожание центра на пике
    const cx = b.x + (Math.random() - 0.5) * jit;
    const cy = b.y + (Math.random() - 0.5) * jit;

    // 1. объём поля: плотное свечение, сгущающееся к краю (вес)
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.72, this.rgba(col, 0.05 + 0.05 * pk));
    g.addColorStop(0.95, this.rgba(col, 0.16 + 0.22 * pk));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();

    // медленно вращающиеся «массы» внутри поля
    for (let i = 0; i < 4; i++) {
      const a = t * (0.25 + i * 0.07) * (i % 2 ? -1 : 1) + i * 1.9;
      const bx = cx + Math.cos(a) * R * 0.45;
      const by = cy + Math.sin(a) * R * 0.45;
      const br = R * 0.34;
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, this.rgba(col, 0.06 + 0.05 * pk));
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fill();
    }

    // 2. границы поля — «живые» волнистые контуры
    this.wavyRing(ctx, cx, cy, R, t * 1.4 + b.id, 0.035 + 0.02 * pk, 5, 7 + 3 * pk, this.rgba(col, 0.1 + 0.14 * pk));
    this.wavyRing(ctx, cx, cy, R, -t * 2.1 + b.id * 2, 0.02, 9, 3.4, this.rgba(col, 0.5 + 0.35 * pk));
    this.wavyRing(ctx, cx, cy, R * 0.985, -t * 2.1 + b.id * 2 + 0.3, 0.02, 9, 1.6, "rgba(255,255,255," + (0.22 + 0.3 * pk).toFixed(3) + ")");

    // 3. вращающийся пунктирный лимб (преемственность со старой аурой)
    ctx.globalAlpha = 0.3 + 0.3 * pk;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.86, t * 0.6, t * 0.6 + TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. орбитальные обломки — придают полю массу
    for (let i = 0; i < 11; i++) {
      const spd = (0.35 + ((i * 53) % 40) / 55) * (i % 2 ? 1 : -1);
      const a = t * spd + i * 2.39996;
      const rr = R * (0.55 + 0.42 * ((i * 37) % 10) / 10);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a * 1.7);
      ctx.globalAlpha = 0.5 + 0.4 * pk;
      ctx.fillStyle = col;
      const s = 2 + ((i * 29) % 10) / 4 + 2 * pk;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // 5. ударное кольцо в момент всплеска
    if (pk > 0.05) {
      ctx.globalAlpha = pk * 0.55;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 + 10 * pk;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.02 + 0.05 * (1 - pk)), 0, TAU);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** замкнутый контур с бегущей волной по радиусу */
  private wavyRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, phase: number, amp: number, lobes: number, lw: number, style: string) {
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    ctx.beginPath();
    const steps = 52;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU;
      const rr = R * (1 + amp * Math.sin(a * lobes + phase) + amp * 0.5 * Math.sin(a * (lobes * 2 + 1) - phase * 1.7));
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** hex-цвет -> rgba() с заданной альфой */
  private rgba(hex: string, alpha: number) {
    const r = parseInt(hex.slice(1, 3), 16);
    const gch = parseInt(hex.slice(3, 5), 16);
    const bch = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${gch},${bch},${alpha.toFixed(3)})`;
  }

  private drawPickup(ctx: CanvasRenderingContext2D, pk: Pickup) {
    const bob = Math.sin(pk.t * 3.4) * 3;
    const x = pk.x, y = pk.y + bob;
    ctx.save();
    ctx.translate(x, y);
    const hexToRgb = (h: string) => `${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)}`;
    const glowRgb =
      pk.kind === 0 ? "125,255,138" :
      pk.kind === 1 ? "255,176,32" :
      pk.kind === 3 ? "95,216,208" :
      pk.kind === 4 ? "168,255,62" :
      pk.kind === 5 ? "192,122,255" :
      pk.kind === 6 ? "232,200,52" :
      pk.kind === 7 ? "255,176,32" :
      pk.kind === 8 ? "255,106,46" :
      pk.kind === 9 && pk.buff ? hexToRgb(RARITY_COLORS[buffDef(pk.buff).rarity]) :
      pk.kind === 10 ? "255,176,32" : "168,255,62";
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    glow.addColorStop(0, `rgba(${glowRgb},0.3)`);
    glow.addColorStop(1, `rgba(${glowRgb},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(-26, -26, 52, 52);

    if (pk.kind === 0) {
      ctx.fillStyle = "#123524"; ctx.fillRect(-10, -10, 20, 20);
      ctx.strokeStyle = "#7dff8a"; ctx.lineWidth = 2; ctx.strokeRect(-10, -10, 20, 20);
      ctx.fillStyle = "#7dff8a";
      ctx.fillRect(-6, -2, 12, 4); ctx.fillRect(-2, -6, 4, 12);
    } else if (pk.kind === 1) {
      ctx.fillStyle = "#3a2c10"; ctx.fillRect(-11, -8, 22, 16);
      ctx.strokeStyle = "#ffb020"; ctx.lineWidth = 2; ctx.strokeRect(-11, -8, 22, 16);
      ctx.fillStyle = "#ffb020";
      for (let i = -1; i <= 1; i++) ctx.fillRect(i * 6 - 1.5, -5, 3, 10);
    } else if (pk.kind === 3) {
      ctx.fillStyle = "#12303a"; ctx.fillRect(-10, -9, 20, 18);
      ctx.strokeStyle = "#5fd8d0"; ctx.lineWidth = 2; ctx.strokeRect(-10, -9, 20, 18);
      ctx.fillStyle = "#5fd8d0";
      ctx.fillRect(-7, -4, 14, 3); ctx.fillRect(-7, 1, 14, 3);
    } else if (pk.kind === 4) {
      ctx.rotate(Math.sin(pk.t * 3) * 0.12);
      ctx.fillStyle = "#1a2a14"; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#a8ff3e"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.stroke();
      ctx.fillStyle = "#a8ff3e"; ctx.font = "11px 'Russo One', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("▲", 0, 1);
    } else if (pk.kind === 5) {
      ctx.rotate(Math.sin(pk.t * 2.4) * 0.1);
      ctx.fillStyle = "#241a33"; ctx.fillRect(-11, -8, 22, 16);
      ctx.strokeStyle = "#c07aff"; ctx.lineWidth = 2; ctx.strokeRect(-11, -8, 22, 16);
      ctx.fillStyle = "#c07aff"; ctx.font = "10px 'Russo One', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("М+", 0, 1);
    } else if (pk.kind === 6) {
      ctx.rotate(Math.sin(pk.t * 2) * 0.08);
      ctx.fillStyle = "#33300f"; ctx.fillRect(-12, -10, 24, 20);
      ctx.strokeStyle = "#e8c834"; ctx.lineWidth = 2; ctx.strokeRect(-12, -10, 24, 20);
      ctx.fillStyle = "#e8c834"; ctx.font = "12px 'Russo One', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 1);
    } else if (pk.kind === 7) {
      ctx.fillStyle = "#3a2c10"; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#ffb020"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + pk.t;
        ctx.fillStyle = "#ffb020";
        ctx.fillRect(Math.cos(a) * 6 - 1, Math.sin(a) * 6 - 1, 2, 2);
      }
    } else if (pk.kind === 8) {
      ctx.rotate(-0.5);
      ctx.fillStyle = "#3a1c10"; ctx.fillRect(-4, -11, 8, 22);
      ctx.strokeStyle = "#ff6a2e"; ctx.lineWidth = 2; ctx.strokeRect(-4, -11, 8, 22);
      ctx.fillStyle = "#ff6a2e";
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(-4, -11); ctx.lineTo(4, -11); ctx.closePath(); ctx.fill();
    } else if (pk.kind === 9 && pk.buff) {
      // пассивный бафф: ромб с глифом, цвет свечения = редкость
      const def = buffDef(pk.buff);
      const col = RARITY_COLORS[def.rarity];
      ctx.rotate(Math.sin(pk.t * 2.6) * 0.16);
      ctx.fillStyle = "#0e1611";
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(9, 0); ctx.lineTo(0, 11); ctx.lineTo(-9, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(9, 0); ctx.lineTo(0, 11); ctx.lineTo(-9, 0); ctx.closePath(); ctx.stroke();
      drawBuffGlyph(ctx, pk.buff, col);
    } else if (pk.kind === 10 && pk.ub !== undefined) {
      // подствольное оружие: оранжевый ящик со стволом
      ctx.rotate(Math.sin(pk.t * 2.2) * 0.1);
      ctx.fillStyle = "#33250e"; ctx.fillRect(-12, -8, 24, 16);
      ctx.strokeStyle = "#ffb020"; ctx.lineWidth = 2; ctx.strokeRect(-12, -8, 24, 16);
      ctx.fillStyle = "#ffb020";
      ctx.fillRect(-8, -2, 16, 4);
      ctx.fillRect(4, -5, 3, 10);
      ctx.fillRect(-8, -5, 2, 2);
    } else {
      // weapon crate (2)
      ctx.rotate(Math.sin(pk.t * 2) * 0.08);
      ctx.fillStyle = "#1a2a14"; ctx.fillRect(-14, -9, 28, 18);
      ctx.strokeStyle = "#a8ff3e"; ctx.lineWidth = 2; ctx.strokeRect(-14, -9, 28, 18);
      ctx.fillStyle = "#a8ff3e";
      ctx.font = "11px 'Russo One', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(pk.wi + 1), 0, 1);
    }
    ctx.restore();
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
        ctx.fillStyle = "#1c2a22"; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#35523f"; ctx.lineWidth = 3; ctx.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10);
        ctx.strokeStyle = "#0a0f0c"; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
      } else if (isCrate) {
        ctx.fillStyle = "#243120"; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#465c36"; ctx.lineWidth = 3; ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
        ctx.strokeStyle = "rgba(70,92,54,0.7)"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.w, r.y + r.h);
        ctx.moveTo(r.x + r.w, r.y); ctx.lineTo(r.x, r.y + r.h);
        ctx.stroke();
        ctx.strokeStyle = "#0a0f0c"; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      } else {
        ctx.fillStyle = "#1a2620"; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = "#263a2e";
        ctx.fillRect(r.x, r.y, r.w, 5);
        ctx.fillRect(r.x, r.y, 5, r.h);
        ctx.strokeStyle = "#0a0f0c"; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx.fillStyle = "rgba(168,255,62,0.07)";
        ctx.fillRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
      }
    }
  }

  private drawBots(ctx: CanvasRenderingContext2D) {
    for (const b of this.bots) {
      if (this.phase !== "menu" && !this.isVisible(b.x, b.y, b.r)) continue;
      const isBoss = b.kind === 3;
      const color = isBoss ? AURAS[BOSSES[b.boss]?.aura ?? "burn"].color : BOTS[b.kind].color;
      const dark = isBoss ? "#3a1030" : BOTS[b.kind].dark;
      const alpha = 0.35 + 0.65 * b.spawnT;
      ctx.globalAlpha = alpha;

      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + b.r * 0.6, b.r * 0.95, b.r * 0.5, 0, 0, TAU);
      ctx.fill();

      // barrel
      const aimAng = b.state === 1 ? Math.atan2(b.seenY - b.y, b.seenX - b.x) : b.dir;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(aimAng);
      ctx.fillStyle = "#101710";
      ctx.fillRect(b.r - 4, -2.5, isBoss ? 22 : 14, isBoss ? 7 : 5);
      ctx.restore();

      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 1, 0, TAU); ctx.fill();

      if (isBoss) {
        ctx.strokeStyle = "#2a0a22";
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 6, 0, TAU); ctx.stroke();
        // spikes
        ctx.fillStyle = dark;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + this.time * 0.5;
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(a) * (b.r - 2), b.y + Math.sin(a) * (b.r - 2), 4, 0, TAU);
          ctx.fill();
        }
      } else if (b.kind === 2) {
        ctx.strokeStyle = "#5c120e";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 5, 0, TAU); ctx.stroke();
      }

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(aimAng);
      ctx.fillStyle = "#1c0708";
      ctx.fillRect(3, -4, 7, 8);
      ctx.restore();

      if (b.flash > 0) {
        ctx.globalAlpha = (b.flash / 0.1) * 0.85;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      }

      // горение (DoT)
      if (b.burn > 0) {
        ctx.globalAlpha = alpha * (0.5 + 0.3 * Math.sin(this.time * 22 + b.id));
        ctx.strokeStyle = "#ff9a3d";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 3, 0, TAU); ctx.stroke();
      }
      // заморозка
      if (b.slow > 0) {
        ctx.globalAlpha = alpha * 0.45;
        ctx.fillStyle = "rgba(95,216,208,0.4)";
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      }

      if (!isBoss && b.hp < b.maxHp) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(b.x, b.y - b.r - 8, 7, 0, TAU); ctx.stroke();
        ctx.strokeStyle = "#ffd23e";
        ctx.beginPath();
        ctx.arc(b.x, b.y - b.r - 8, 7, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(b.hp / b.maxHp, 0, 1));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawPlayers(ctx: CanvasRenderingContext2D) {
    for (const P of this.players) {
      if (P.dead) {
        // draw a small wreck marker
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = PLAYER_COLORS[P.colorIdx];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(P.x - 8, P.y - 8); ctx.lineTo(P.x + 8, P.y + 8);
        ctx.moveTo(P.x + 8, P.y - 8); ctx.lineTo(P.x - 8, P.y + 8);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      const w = WEAPONS[P.wi];
      const bodyCol = PLAYER_COLORS[P.colorIdx];
      ctx.save();
      ctx.translate(P.x, P.y);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.ellipse(0, P.r * 0.6, P.r * 0.95, P.r * 0.55, 0, 0, TAU);
      ctx.fill();

      // invuln shield
      if (P.buffs.invuln > 0) {
        ctx.strokeStyle = "rgba(192,122,255,0.8)";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, P.r + 7, 0, TAU); ctx.stroke();
      }
      // spray indicator
      if (P.sprayT > 0) {
        ctx.strokeStyle = "rgba(255,176,32,0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, P.r + 4, this.time * 6, this.time * 6 + TAU * 0.6); ctx.stroke();
      }

      ctx.rotate(P.aim);
      // laser sight for upgraded sniper (drawn relative to player origin)
      if (P.wi === 3 && P.upgraded[3]) {
        ctx.save();
        ctx.rotate(-P.aim); // undo body rotation, keep translation
        const ld = rayDist(this.world.rects, P.x, P.y, P.aim, 1400);
        ctx.strokeStyle = "rgba(255,60,40,0.5)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(P.aim) * (P.r + w.len), Math.sin(P.aim) * (P.r + w.len));
        ctx.lineTo(Math.cos(P.aim) * ld, Math.sin(P.aim) * ld);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = "#20301a";
      ctx.fillRect(4, -3, w.len + 8 - P.recoil * 4, 6);
      ctx.fillStyle = "#31481f";
      ctx.fillRect(4, -3, w.len + 8 - P.recoil * 4, 2);

      ctx.fillStyle = P === this.me ? "#5c8f26" : "#3d5c50";
      ctx.beginPath(); ctx.arc(0, 0, P.r + 1, 0, TAU); ctx.fill();
      ctx.fillStyle = bodyCol;
      ctx.beginPath(); ctx.arc(0, 0, P.r - 2, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.arc(-2, 0, P.r - 6, 0, TAU); ctx.fill();
      ctx.fillStyle = "#0e1a08";
      ctx.fillRect(4, -5, 8, 10);
      ctx.restore();

      // name tag in MP
      if (this.players.length > 1) {
        ctx.font = "10px 'Russo One', sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = bodyCol;
        ctx.globalAlpha = 0.85;
        ctx.fillText(P.name.slice(0, 12), P.x, P.y - P.r - 12);
        ctx.globalAlpha = 1;
      }

      // weapon indicator under player with color
      ctx.font = "bold 11px 'Russo One', sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = w.color;
      ctx.shadowColor = w.color;
      ctx.shadowBlur = 6;
      ctx.fillText(w.name.split(" ")[0].replace(/[«»]/g, ""), P.x, P.y + P.r + 14);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // reload ring
      if (P.reloadT >= 0) {
        ctx.strokeStyle = "rgba(255,176,32,0.9)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(P.x, P.y, P.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(P.reloadT, 0, 1));
        ctx.stroke();
      }
      if (P === this.me && P.dashCool <= 0) {
        ctx.fillStyle = "rgba(168,255,62,0.8)";
        ctx.beginPath();
        ctx.arc(P.x, P.y + P.r + 10, 2.5, 0, TAU);
        ctx.fill();
      }
    }
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D) {
    const mx = this.mouse.x, my = this.mouse.y;
    let hot = false;
    for (const b of this.bots) {
      if (dist2(mx + this.camX, my + this.camY, b.x, b.y) < (b.r + 8) * (b.r + 8)) { hot = true; break; }
    }
    const w = weaponStats(this.me.wi, this.me.upgraded[this.me.wi]);
    let spread = w.spread * this.me.stats.accMul;
    if (this.me.buffs.precision > 0) spread *= 0.4;
    const r = 10 + this.me.recoil * 16 + spread * 22;
    const col = hot ? "#ff5040" : "#c8ff6e";
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, TAU); ctx.stroke();
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
    if (this.phase === "menu" || !this.me) return;
    const P = this.me;
    const sw = (this.time * 1.3) % TAU;
    g.strokeStyle = "rgba(168,255,62,0.30)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(P.x * sx, P.y * sy);
    g.lineTo(P.x * sx + Math.cos(sw) * 90, P.y * sy + Math.sin(sw) * 90);
    g.stroke();

    g.fillStyle = "#ffb020";
    for (const pk of this.pickups) {
      if (!pk.visible) continue;
      g.fillRect(pk.x * sx - 1.5, pk.y * sy - 1.5, 3, 3);
    }
    for (const b of this.bots) {
      if (!this.isVisible(b.x, b.y, b.r)) continue;
      g.fillStyle = b.kind === 3 ? "#ffb020" : "#ff4438";
      g.beginPath();
      g.arc(b.x * sx, b.y * sy, b.kind === 3 ? 4 : 2.4, 0, TAU);
      g.fill();
    }
    // all players
    for (const p of this.players) {
      if (p.dead) continue;
      g.save();
      g.translate(p.x * sx, p.y * sy);
      if (p === this.me) g.rotate(p.aim);
      g.fillStyle = PLAYER_COLORS[p.colorIdx];
      if (p === this.me) {
        g.beginPath();
        g.moveTo(5, 0); g.lineTo(-4, -3.4); g.lineTo(-4, 3.4);
        g.closePath(); g.fill();
      } else {
        g.beginPath(); g.arc(0, 0, 2.6, 0, TAU); g.fill();
      }
      g.restore();
    }
    g.strokeStyle = "rgba(168,255,62,0.35)";
    g.strokeRect(this.camX * sx, this.camY * sy, this.viewW * sx, this.viewH * sy);
  }

  /* ---------------- HUD ---------------- */

  private pushHud() {
    if (!this.me) return;
    const slots: HudSlot[] = WEAPONS.map((w, i) => ({
      name: w.name,
      mag: this.me.mags[i],
      reserve: i === 0 ? -1 : this.me.reserves[i],
      cap: i === 0 ? -1 : w.cap,
      reload: this.me.reloadT >= 0 && this.me.wi === i ? clamp(this.me.reloadT, 0, 1) : -1,
      owned: this.me.owned[i],
      infinite: i === 0,
      upgraded: this.me.upgraded[i],
      prog: this.me.upgradeProg[i],
    }));
    const bossBot = this.bots.find((b) => b.kind === 3);
    const boss = bossBot
      ? {
          name: BOSSES[bossBot.boss]?.name ?? "БОСС",
          hp: Math.max(0, Math.round(bossBot.hp)),
          maxHp: Math.round(bossBot.maxHp),
          weakName: WEAPONS[bossBot.weak]?.name ?? "",
          auraName: bossBot.aura ? AURAS[bossBot.aura as AuraKind].name : "",
        }
      : null;
    this.cbs.onHud({
      hp: Math.max(0, Math.round(this.me.hp)),
      armor: Math.max(0, Math.round(this.me.armor)),
      wave: this.wave,
      left: this.bots.length + this.pending.length,
      score: this.score,
      best: this.best,
      newBest: this.newBest,
      kills: this.kills,
      wi: this.me.wi,
      slots,
      dash: 1 - clamp(this.me.dashCool / 2.1, 0, 1),
      time: this.time,
      buffs: BUFF_KINDS.filter((k) => this.me.buffs[k] > 0).map((k) => ({ kind: k, left: this.me.buffs[k] })),
      foeMods: { hp: this.foeHpMul(), dmg: this.foeDmgMul(), spd: this.foeSpdMul() },
      still: this.me.stillT,
      boss,
      players: this.players.map((p) => ({ name: p.name, hp: Math.round(p.hp), dead: p.dead, colorIdx: p.colorIdx, me: p === this.me })),
      meDead: this.me.dead,
      netMode: this.netMode,
      stats: STAT_BUFFS.filter((d) => this.me.stacks[d.id] > 0).map((d) => ({
        id: d.id, name: d.name, val: buffDescribe(d.id, this.me.stacks[d.id]), rarity: d.rarity,
      })),
      ubs: UNDERBARRELS.map((u) => ({
        name: u.name, short: u.short, desc: u.desc,
        owned: this.me.ubOwned[u.id],
        cool: this.me.ubCool[u.id] / u.cd,
        active: this.me.ubIdx === u.id,
      })),
      ubIdx: this.me.ubIdx,
      pauseTimer: Math.max(0, this.pauseTimer),
    });
  }
}
