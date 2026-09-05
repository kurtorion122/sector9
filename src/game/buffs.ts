/* ------------------------------------------------------------------
 * Пассивные коллектиблы (баффы) — модульный реестр.
 * Чтобы добавить новый бафф: допишите объект в STAT_BUFFS и кейс в
 * drawBuffGlyph / buffDescribe — движок подхватит всё автоматически.
 * ------------------------------------------------------------------ */

export type StatBuffId =
  | "dmg" | "rate" | "hp" | "spd" | "acc" | "aura" | "chain" | "vamp" | "crit" | "reload";

/** белый → зелёный → синий → фиолетовый → оранжевый */
export type Rarity = 0 | 1 | 2 | 3 | 4;
export const RARITY_COLORS = ["#e8f4e8", "#7dff5e", "#4dc9ff", "#c07aff", "#ffb020"];

export interface StatBuffDef {
  id: StatBuffId;
  name: string;
  short: string;      // подпись на пикапе
  rarity: Rarity;
  baseChance: number; // базовый шанс дропа (растёт с волной)
  minWave: number;    // с какой волны может выпасть
  cap: number;        // максимум стаков (999 = без капа)
}

export const STAT_BUFFS: StatBuffDef[] = [
  { id: "dmg",   name: "УРОН",           short: "УРН", rarity: 0, baseChance: 0.12, minWave: 1,  cap: 999 },
  { id: "rate",  name: "СКОРОСТРЕЛЬНОСТЬ", short: "ТМП", rarity: 0, baseChance: 0.12, minWave: 1,  cap: 200 },
  { id: "hp",    name: "ЖИВУЧЕСТЬ",      short: "ЖВЧ", rarity: 1, baseChance: 0.05, minWave: 1,  cap: 999 },
  { id: "spd",   name: "СКОРОСТЬ",       short: "СКР", rarity: 1, baseChance: 0.05, minWave: 1,  cap: 20 },
  { id: "acc",   name: "ТОЧНОСТЬ",       short: "ТЧН", rarity: 2, baseChance: 0.02, minWave: 1,  cap: 25 },
  { id: "aura",  name: "АУРА ГОРЕНИЯ",   short: "АУР", rarity: 2, baseChance: 0.02, minWave: 1,  cap: 999 },
  { id: "chain", name: "ЦЕПНАЯ МОЛНИЯ",  short: "МЛН", rarity: 3, baseChance: 0.01, minWave: 6,  cap: 5 },
  { id: "vamp",  name: "ВАМПИРИЗМ",      short: "ВМП", rarity: 3, baseChance: 0.01, minWave: 10, cap: 5 },
  { id: "crit",  name: "КРИТ",           short: "КРТ", rarity: 3, baseChance: 0.02, minWave: 1,  cap: 8 },
  { id: "reload", name: "ПЕРЕЗАРЯДКА",    short: "ПРЗ", rarity: 1, baseChance: 0.04, minWave: 1,  cap: 35 },
];

export function buffDef(id: StatBuffId): StatBuffDef {
  return STAT_BUFFS.find((d) => d.id === id)!;
}

export function emptyStacks(): Record<StatBuffId, number> {
  return { dmg: 0, rate: 0, hp: 0, spd: 0, acc: 0, aura: 0, chain: 0, vamp: 0, crit: 0, reload: 0 };
}

/* ---------------- производные характеристики ---------------- */

export interface DerivedStats {
  dmgMul: number;     // ×(1 + 2%·n)
  rateMul: number;    // ×(1 + 3%·n) — делит интервал между выстрелами, кап 100%
  maxHp: number;      // 100 + 2·n
  spdMul: number;     // ×(1 + 1%·n), кап 20%
  accMul: number;     // ×(1 − 2%·n) — множитель разброса, кап 50%
  critChance: number; // 5%·n, кап 40%
  critMul: number;    // 1.5 + 0.25·n, кап ×3.0
  vamp: number;       // HP за убийство, кап 5
  chain: { jumps: number; chance: number; dmg: number };
  auraR: number;      // 0 = аура не открыта
  reloadMul: number;  // ×(1 - 1%·n), кап 35%
}

export function computeStats(s: Record<StatBuffId, number>): DerivedStats {
  const chainN = Math.min(s.chain, 5);
  return {
    dmgMul: 1 + 0.02 * s.dmg,
    rateMul: 1 + 0.005 * Math.min(s.rate, 200), // кап 100% (+0.5% за стек, макс 200 стеков)
    maxHp: 100 + 2 * s.hp,
    spdMul: 1 + 0.01 * Math.min(s.spd, 20),
    accMul: 1 - 0.02 * Math.min(s.acc, 25),
    critChance: Math.min(0.05 * s.crit, 0.4),
    critMul: Math.min(1.5 + 0.25 * s.crit, 3.0),
    vamp: Math.min(s.vamp, 5),
    chain: {
      jumps: chainN,
      chance: chainN > 0 ? Math.min(0.3 + 0.1 * (s.chain - 1), 0.8) : 0,
      dmg: chainN > 0 ? Math.min(0.5 + 0.1 * (s.chain - 1), 1.0) : 0,
    },
    auraR: s.aura > 0 ? 60 * Math.pow(1.15, s.aura - 1) : 0,
    reloadMul: 1 - 0.01 * Math.min(s.reload, 35), // кап 35% (-1% за стек)
  };
}

/* ---------------- дроп ---------------- */

export function isCapped(id: StatBuffId, stacks: Record<StatBuffId, number>): boolean {
  return stacks[id] >= buffDef(id).cap;
}

/** шанс баффа растёт с волной: base · (1 + wave·0.08) */
export function buffDropChance(def: StatBuffDef, wave: number): number {
  return def.baseChance * (1 + wave * 0.08);
}

/** шанс оружия падает с волной: base · max(0.2, 1 − wave·0.04) */
export function weaponDropChance(base: number, wave: number): number {
  return base * Math.max(0.2, 1 - wave * 0.04);
}

/** независимые броски по каждому баффу из убитого врага */
export function rollBuffDrops(
  wave: number,
  stacksList: Record<StatBuffId, number>[],
  x: number,
  y: number
): { id: StatBuffId; x: number; y: number }[] {
  const out: { id: StatBuffId; x: number; y: number }[] = [];
  for (const def of STAT_BUFFS) {
    if (wave < def.minWave) continue;
    // не спавним, если у всех игроков кап
    if (!stacksList.some((s) => s[def.id] < def.cap)) continue;
    if (Math.random() < buffDropChance(def, wave)) {
      out.push({ id: def.id, x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 40 });
    }
  }
  return out;
}

/* ---------------- описание для HUD ---------------- */

export function buffDescribe(id: StatBuffId, n: number): string {
  switch (id) {
    case "dmg": return `+${2 * n}% урона`;
    case "rate": return `+${0.5 * n}% темп`;
    case "hp": return `+${2 * n} макс. HP`;
    case "spd": return `${n}% / 20%`;
    case "acc": return `${2 * n}% / 50%`;
    case "reload": return `-${n}% перезарядка`;
    case "aura": return `радиус ${Math.round(60 * Math.pow(1.15, n - 1))}`;
    case "chain": {
      const jumps = Math.min(n, 5);
      const ch = Math.round(Math.min(0.3 + 0.1 * (n - 1), 0.8) * 100);
      return `${jumps}/5 прыжков · ${ch}%`;
    }
    case "vamp": return `${n} / 5 HP за убийство`;
    case "crit": {
      const ch = Math.min(5 * n, 40);
      const mul = Math.min(1.5 + 0.25 * n, 3.0);
      return `${ch}% / 40% · ×${mul.toFixed(2)}`;
    }
  }
}

/* ---------------- глифы пикапов ---------------- */

/** маленькая иконка баффа (рисуется в центре, размер ~10px) */
export function drawBuffGlyph(ctx: CanvasRenderingContext2D, id: StatBuffId, color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  switch (id) {
    case "dmg": // шеврон вверх
      ctx.moveTo(-4, 1); ctx.lineTo(0, -4); ctx.lineTo(4, 1);
      ctx.moveTo(-4, 5); ctx.lineTo(0, 0); ctx.lineTo(4, 5);
      break;
    case "rate": // молния
      ctx.moveTo(1, -5); ctx.lineTo(-3, 1); ctx.lineTo(0, 1); ctx.lineTo(-1, 5); ctx.lineTo(3, -1); ctx.lineTo(0, -1); ctx.closePath();
      ctx.fill();
      return;
    case "hp": // крест
      ctx.moveTo(-4, 0); ctx.lineTo(4, 0);
      ctx.moveTo(0, -4); ctx.lineTo(0, 4);
      break;
    case "spd": // двойной шеврон вправо
      ctx.moveTo(-4, -4); ctx.lineTo(0, 0); ctx.lineTo(-4, 4);
      ctx.moveTo(0, -4); ctx.lineTo(4, 0); ctx.lineTo(0, 4);
      break;
    case "acc": // круг с точкой
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.moveTo(1, 0); ctx.arc(0, 0, 1, 0, Math.PI * 2);
      break;
    case "aura": // пламя
      ctx.moveTo(0, -5); ctx.quadraticCurveTo(4, -1, 2, 2); ctx.quadraticCurveTo(1, 4, 0, 5);
      ctx.quadraticCurveTo(-1, 4, -2, 2); ctx.quadraticCurveTo(-4, -1, 0, -5);
      break;
    case "chain": // зигзаг молнии
      ctx.moveTo(-4, -4); ctx.lineTo(1, -1); ctx.lineTo(-2, 1); ctx.lineTo(4, 4);
      break;
    case "vamp": // клыки
      ctx.moveTo(-4, -3); ctx.lineTo(-2, 3); ctx.lineTo(0, -3);
      ctx.moveTo(0, -3); ctx.lineTo(2, 3); ctx.lineTo(4, -3);
      break;
    case "crit": // звезда
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5);
      }
      break;
    case "reload": // магазин вниз
      ctx.moveTo(-3, -4); ctx.lineTo(3, -4);
      ctx.lineTo(3, 2); ctx.lineTo(0, 5); ctx.lineTo(-3, 2);
      ctx.closePath();
      ctx.moveTo(-1, 0); ctx.lineTo(1, 0);
      ctx.moveTo(0, -2); ctx.lineTo(0, 3);
      break;
  }
  ctx.stroke();
}
