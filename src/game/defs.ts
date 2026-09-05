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
  color: string; // color for UI display
}

export const WEAPONS: WeaponDef[] = [
  // Пистолет ПМ «ГРОМ»: магазин 16, бесконечный боезапас
  { name: "ПМ «ГРОМ»", dmg: 22, rate: 0.432, speed: 980, spread: 0.09, pellets: 1, magSize: 16, reload: 0.9, cap: 999999, startReserve: 999999, kick: 5, len: 16, range: 900, color: "#a8ff3e" },
  // Дробовик «ВЕПРЬ-12»: магазин 10, боезапас 40
  { name: "«ВЕПРЬ-12»", dmg: 11, rate: 0.65, speed: 800, spread: 0.112, pellets: 9, magSize: 10, reload: 2.1, cap: 40, startReserve: 40, kick: 11, len: 22, range: 1100, color: "#ff6a2e" },
  // Автомат «ШКВАЛ»: магазин 50, боезапас 300
  { name: "«ШКВАЛ»", dmg: 15, rate: 0.09, speed: 1050, spread: 0.12, pellets: 1, magSize: 50, reload: 1.7, cap: 300, startReserve: 300, kick: 2.8, len: 20, range: 950, color: "#5fd8d0" },
  // Винтовка «ФИЛИН»: магазин 5, боезапас 50
  { name: "«ФИЛИН»", dmg: 68, rate: 0.75, speed: 1600, spread: 0.018, pellets: 1, magSize: 5, reload: 1.9, cap: 50, startReserve: 50, kick: 8, len: 26, range: 1300, color: "#ffb020" },
];

// Уровни улучшений для каждого оружия (последовательные)
export interface WeaponUpgradeTier {
  label: string;
  desc: string;
  apply: (w: WeaponDef) => Partial<WeaponDef>;
}

export const WEAPON_UPGRADES: WeaponUpgradeTier[][] = [
  // Пистолет (индекс 0)
  [
    { label: "МАГАЗИН+", desc: "Увеличивает магазин до 20 патронов", apply: () => ({ magSize: 20 }) },
    { label: "СТВОЛ+", desc: "Увеличивает точность на 50%", apply: (w) => ({ spread: w.spread * 0.5 }) },
    { label: "УСМ+", desc: "Стрельба очередями по 3 патрона", apply: () => ({ pellets: 3 }) },
  ],
  // Дробовик (индекс 1)
  [
    { label: "ЧОК", desc: "Увеличивает точность на 30%", apply: (w) => ({ spread: w.spread * 0.7 }) },
    { label: "СТВОЛ+", desc: "Увеличивает дальность на 50%", apply: (w) => ({ range: w.range * 1.5 }) },
    { label: "МАГАЗИН+", desc: "Магазин 15, боезапас 60", apply: () => ({ magSize: 15 }) },
  ],
  // Автомат (индекс 2)
  [
    { label: "ПРИЦЕЛ", desc: "Увеличивает точность на 50%", apply: (w) => ({ spread: w.spread * 0.5 }) },
    { label: "МАГАЗИН+", desc: "Увеличивает магазин до 75 патронов", apply: () => ({ magSize: 75 }) },
    { label: "УСМ+", desc: "Увеличивает скорострельность на 75%", apply: (w) => ({ rate: w.rate / 1.75 }) },
  ],
  // Винтовка (индекс 3)
  [
    { label: "ЛАЗЕР", desc: "Добавляет лазерный указатель", apply: () => ({}) }, // визуальный эффект
    { label: "КАЛИБР+", desc: "Увеличивает урон на 100%", apply: (w) => ({ dmg: w.dmg * 2 }) },
    { label: "НАСТИЛЬНОСТЬ", desc: "Увеличивает скорость пули на 100%", apply: (w) => ({ speed: w.speed * 2 }) },
  ],
];

export interface UpgradeDef { label: string; desc: string; }
export const UPGRADES: UpgradeDef[] = [
  { label: "КАЛИБР+", desc: "3 фрагмента → урон ×1.7 · темп +25% · разброс выше" },
  { label: "ЧОК", desc: "3 фрагмента → разброс ×0.7 · дальность ×0.6 · точный" },
  { label: "МАГАЗИН+", desc: "3 фрагмента → магазин 50 · темп выше · урон +2" },
  { label: "ОПТИКА+", desc: "3 фрагмента → урон ×2 · лазер · прошивает 2 врагов" },
];

/** фрагментов нужно для полного улучшения оружия */
export const UPGRADE_STAGES = 3;

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

export type DebuffKind = "foeHp" | "foeDmg" | "foeSpd" | "still" | "dark" | "spawn";
export interface DebuffDef { name: string; dur: number; color: string; }
export const DEBUFFS: Record<DebuffKind, DebuffDef> = {
  foeHp: { name: "ВРАГИ КРЕПЧЕ", dur: 14, color: "#ff5040" },
  foeDmg: { name: "ВРАГИ ЗЛЕЕ", dur: 12, color: "#ff6a2e" },
  foeSpd: { name: "ВРАГИ БЫСТРЕЕ", dur: 12, color: "#ff2e5f" },
  still: { name: "НЕ СТОЙ!", dur: 10, color: "#e8c834" },
  dark: { name: "МРАК", dur: 10, color: "#1a1a1a" }, // сужает обзор, мигает, скрывает UI
  spawn: { name: "ПОДКРЕПЛЕНИЕ", dur: 5, color: "#ff0000" }, // спавнит 10 врагов
};
export const DEBUFF_KINDS: DebuffKind[] = ["foeHp", "foeDmg", "foeSpd", "still", "dark", "spawn"];

/* ---------------- pickups ---------------- */

/** 0 medkit · 1 ammo · 2 weapon crate · 3 armor · 4 timed buff · 5 upgrade kit
 *  6 surprise crate · 7 spray bonus · 8 rocket bonus
 *  9 passive stat buff (buff=StatBuffId) · 10 underbarrel (ub=UbId) · 11 battery (revive) */
export type PickupKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/* ---------------- players ---------------- */

export const PLAYER_COLORS = ["#a8ff3e", "#5fd8d0", "#ffb020", "#c07aff"];

export interface PlayerSnap {
  id: number; name: string; colorIdx: number;
  x: number; y: number; aim: number;
  hp: number; armor: number; wi: number; r: number;
  dead: boolean; reload: number;
  buffs: BuffKind[]; still: number;
  mag: number; reserve: number;
  prog: number[];
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
  auraMul: number;
  weapon: number; speedMul: number; resist: number;
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
