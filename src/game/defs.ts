/* Shared types & static data for engine, net, UI. */

import type { StatBuffId } from "./buffs";
import type { UbId } from "./underbarrel";

/* ---------------- weapons ---------------- */

export interface WeaponDef {
  name: string;
  dmg: number;
  rate: number; // seconds between shots
  speed: number;
  spread: number; // half-cone in rad
  pellets: number;
  magSize: number;
  reload: number;
  cap: number;
  startReserve: number;
  kick: number;
  len: number;
  range: number; // bullet life = range / speed
}

export const WEAPONS: WeaponDef[] = [
  { name: "ПМ «ГРОМ»", dmg: 26, rate: 0.26, speed: 980, spread: 0.035, pellets: 1, magSize: 12, reload: 0.85, cap: 999999, startReserve: 999999, kick: 3, len: 16, range: 1050 },
  { name: "«ВЕПРЬ-12»", dmg: 13, rate: 0.82, speed: 830, spread: 0.3, pellets: 7, magSize: 6, reload: 1.8, cap: 48, startReserve: 24, kick: 9, len: 22, range: 700 },
  { name: "«ШКВАЛ»", dmg: 13, rate: 0.0713, speed: 1040, spread: 0.1, pellets: 1, magSize: 34, reload: 1.5, cap: 204, startReserve: 102, kick: 2.2, len: 20, range: 1000 },
  { name: "«ФИЛИН»", dmg: 52, rate: 0.58, speed: 1560, spread: 0.014, pellets: 1, magSize: 8, reload: 1.6, cap: 64, startReserve: 32, kick: 6, len: 26, range: 1400 },
];

export interface UpgradeDef { label: string; desc: string; }
export const UPGRADES: UpgradeDef[] = [
  { label: "КАЛИБР+", desc: "урон ×1.7 · темп +25% · разброс выше" },
  { label: "ЧОК", desc: "разброс ×0.7 · дальность ×0.6 · точный" },
  { label: "МАГАЗИН+", desc: "магазин 50 · темп выше · урон +2" },
  { label: "ОПТИКА+", desc: "урон ×2 · лазер · прошивает 2 врагов" },
];

export interface WeaponStats extends WeaponDef { pierce: number; }

export function weaponStats(wi: number, upgraded: boolean): WeaponStats {
  const w = WEAPONS[wi];
  const s: WeaponStats = { ...w, pierce: 0 };
  if (!upgraded) return s;
  if (wi === 0) { s.dmg = Math.round(w.dmg * 1.7); s.rate = w.rate / 1.25; s.spread = w.spread * 1.8; }
  else if (wi === 1) { s.spread = w.spread * 0.7; s.range = w.range * 0.6; }
  else if (wi === 2) { s.magSize = 50; s.rate = w.rate * 0.82; s.dmg = w.dmg + 2; }
  else if (wi === 3) { s.dmg = w.dmg * 2; s.rate = w.rate * 1.3; s.pierce = 2; }
  return s;
}

/* ---------------- enemies ---------------- */

export interface BotDef {
  name: string; hp: number; speed: number; r: number; score: number;
  color: string; dark: string; sight: number; range: number; rate: number;
  dmg: number; pellets: number; bSpeed: number;
}

export const BOTS: BotDef[] = [
  { name: "Стрелок", hp: 70, speed: 128, r: 13, score: 100, color: "#ff6a2e", dark: "#7e2c0c", sight: 470, range: 420, rate: 1.0, dmg: 9, pellets: 1, bSpeed: 500 },
  { name: "Жнец", hp: 46, speed: 238, r: 11, score: 150, color: "#ff2e5f", dark: "#7a0f2c", sight: 560, range: 0, rate: 0, dmg: 16, pellets: 0, bSpeed: 0 },
  { name: "Громила", hp: 250, speed: 64, r: 21, score: 300, color: "#e8342e", dark: "#6e120f", sight: 430, range: 350, rate: 1.75, dmg: 8, pellets: 5, bSpeed: 440 },
];

/* ---------------- boss ---------------- */

export type AuraKind = "slow" | "burn" | "vortex";
export interface AuraDef { name: string; desc: string; color: string; }
export const AURAS: Record<AuraKind, AuraDef> = {
  slow: { name: "СТАЗИС", desc: "замедляет игроков в зоне", color: "#5fd8d0" },
  burn: { name: "ПЛАЗМА", desc: "обжигает игроков в зоне", color: "#ff6a2e" },
  vortex: { name: "ГРАВИТАЦИЯ", desc: "затягивает игроков к боссу", color: "#c07aff" },
};

export interface BossDef {
  name: string; hp: number; speed: number; r: number; score: number;
  weapon: number; weak: number; aura: AuraKind; auraR: number;
}

export const BOSSES: BossDef[] = [
  { name: "ВАРТ-3 «ЦЕРБЕР»", hp: 1500, speed: 74, r: 30, score: 1500, weapon: 1, weak: 2, aura: "burn", auraR: 190 },
  { name: "ОБСИДИАН", hp: 2200, speed: 86, r: 34, score: 2500, weapon: 3, weak: 1, aura: "slow", auraR: 230 },
  { name: "МОЛЬХ", hp: 3000, speed: 66, r: 38, score: 4000, weapon: 2, weak: 0, aura: "vortex", auraR: 250 },
];

/* ---------------- buffs & debuffs (временные, из ящика-сюрприза) ---------------- */

export type BuffKind = "firerate" | "precision" | "swift" | "invuln";
export interface BuffDef { name: string; dur: number; color: string; }
export const BUFFS: Record<BuffKind, BuffDef> = {
  firerate: { name: "ТЕМП+", dur: 12, color: "#ffb020" },
  precision: { name: "ТОЧНОСТЬ", dur: 12, color: "#5fd8d0" },
  swift: { name: "СПРИНТ", dur: 10, color: "#a8ff3e" },
  invuln: { name: "ЩИТ", dur: 6, color: "#c07aff" },
};
export const BUFF_KINDS: BuffKind[] = ["firerate", "precision", "swift", "invuln"];

export type DebuffKind = "foeHp" | "foeDmg" | "foeSpd" | "still";
export interface DebuffDef { name: string; dur: number; color: string; }
export const DEBUFFS: Record<DebuffKind, DebuffDef> = {
  foeHp: { name: "ВРАГИ КРЕПЧЕ", dur: 14, color: "#ff5040" },
  foeDmg: { name: "ВРАГИ ЗЛЕЕ", dur: 12, color: "#ff6a2e" },
  foeSpd: { name: "ВРАГИ БЫСТРЕЕ", dur: 12, color: "#ff2e5f" },
  still: { name: "НЕ СТОЙ!", dur: 10, color: "#e8c834" },
};
export const DEBUFF_KINDS: DebuffKind[] = ["foeHp", "foeDmg", "foeSpd", "still"];

/* ---------------- pickups ---------------- */

/** 0 medkit · 1 ammo · 2 weapon crate · 3 armor · 4 timed buff · 5 upgrade kit
 *  6 surprise crate · 7 spray bonus · 8 rocket bonus
 *  9 passive stat buff (buff=StatBuffId) · 10 underbarrel (ub=UbId) */
export type PickupKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/* ---------------- players ---------------- */

export const PLAYER_COLORS = ["#a8ff3e", "#5fd8d0", "#ffb020", "#c07aff"];

export interface PlayerSnap {
  id: number; name: string; colorIdx: number;
  x: number; y: number; aim: number;
  hp: number; armor: number; wi: number; r: number;
  dead: boolean; reload: number;
  buffs: BuffKind[]; still: number;
  mag: number; reserve: number;
  stacks: [string, number][];
  ubMask: number; ubIdx: number; ubCool: number[];
  ubFlame: number; ubCold: number;
}

export interface BotSnap {
  id: number; kind: number; boss: number;
  x: number; y: number; hp: number; maxHp: number; r: number;
  dir: number; state: number; flash: number; weak: number; aura: string; spawnT: number;
  seenX: number; seenY: number;
  burn: boolean; slow: boolean;
}

export interface BulletSnap {
  id: number; x: number; y: number; px: number; py: number;
  friendly: boolean; kind: number; rocket: boolean; crit: boolean;
}

export interface PickupSnap {
  id: number; kind: PickupKind; wi: number; x: number; y: number; t: number;
  buff?: StatBuffId; ub?: UbId;
}

export interface GrenadeSnap { x: number; y: number; k: number; }

export interface Snap {
  time: number; wave: number; waveActive: boolean; score: number;
  mapId: number; seed: number;
  players: PlayerSnap[]; bots: BotSnap[]; bullets: BulletSnap[]; pickups: PickupSnap[];
  grenades: GrenadeSnap[];
  foeMods: { hp: number; dmg: number; spd: number };
}

/* ---------------- net protocol ---------------- */

export type Msg =
  | { t: "create"; name: string }
  | { t: "join"; code: string; name: string }
  | { t: "leave" }
  | { t: "start" }
  | { t: "room"; code: string; you: number; host: number; players: { id: number; name: string }[] }
  | { t: "err"; msg: string }
  | { t: "begin"; seed: number; players: { id: number; name: string }[]; host: number; you: number }
  | { t: "in"; from?: number; x: number; y: number; aim: number; fire: boolean; weapon: number; reloadSeq: number; ub: number; rmb: number }
  | { t: "snap"; s: Snap }
  | { t: "fx"; ev: FxEvent[] }
  | { t: "banner"; title: string; sub: string }
  | { t: "over"; score: number; kills: number; wave: number; time: number }
  | { t: "peerleft"; id: number };

export type FxEvent =
  | { k: "burst"; x: number; y: number; n: number; color: string; speed: number }
  | { k: "blood"; x: number; y: number; n: number }
  | { k: "flash"; x: number; y: number; r: number; color: string }
  | { k: "float"; x: number; y: number; txt: string; color: string; size: number }
  | { k: "shake"; v: number }
  | { k: "snd"; id: string; dist: number }
  | { k: "decal"; x: number; y: number }
  | { k: "zap"; pts: { x: number; y: number }[] }
  | { k: "vamp"; x: number; y: number };
