/* ------------------------------------------------------------------
 * Подствольное оружие — модульный реестр.
 * ПКМ — выстрел активного подствола, Q — переключение.
 * Дроп: base_chance 0.5%, пул жёстко привязан к волнам.
 *
 * Отключено: UNDERBARREL_ENABLED = false
 * ------------------------------------------------------------------ */

export type UbId = 0 | 1 | 2 | 3;

export interface UbDef {
  id: UbId;
  name: string;
  short: string;
  cd: number;   // кулдаун, сек
  desc: string;
  kb: number;   // сила отката (отдачи толкает назад)
}

/* Содержим определения подстволов (оставлены для справки/совместимости) */
export const UNDERBARRELS: UbDef[] = [
  { id: 0, name: "ПОДСТВОЛЬНЫЙ ДРОБОВИК", short: "ДРБ", cd: 3,  desc: "6 дробинок · урон 15 · откат", kb: 3 },
  { id: 1, name: "ГРАНАТОМЁТ",            short: "ГРН", cd: 8,  desc: "выстрел по дуге · взрыв 80 · урон 40", kb: 8 },
  { id: 2, name: "ОГНЕМЁТ",               short: "ОГН", cd: 12, desc: "струя 3 с · 10 урона/с · поджигает", kb: 0 },
  { id: 3, name: "КОНУС ХОЛОДА",          short: "ХЛД", cd: 10, desc: "конус 60° на 4 с · замедление 30%", kb: 0 },
];

/* Флаг: глобально отключает подствольное оружие в коде, даёт возможность быстрых проверок */
export const UNDERBARREL_ENABLED = false;

/* Если нужно совсем убрать дропы — ставим в 0.0.
   Здесь дополнительно контролируем через флаг UNDERBARREL_ENABLED. */
export const UB_DROP_CHANCE = UNDERBARREL_ENABLED ? 0.005 : 0.0; // 0.5% -> 0%

/** доступный пул подстволов по волнам */
export function ubPoolForWave(wave: number): UbId[] {
  if (!UNDERBARREL_ENABLED) return [];
  if (wave >= 16) return [0, 1, 2, 3];
  if (wave >= 12) return [0, 1, 2];
  if (wave >= 6) return [0, 1];
  return [0];
}

/** случайный подствол из пула волны, которого нет в списке missing-кандидатов */
export function pickUbDrop(wave: number, missing: UbId[]): UbId | null {
  if (!UNDERBARREL_ENABLED) return null;
  // исправлено: исключаем missing-идентификаторы из пула
  const pool = ubPoolForWave(wave).filter((k) => !missing.includes(k));
  if (!pool.length) return null;
  return pool[(Math.random() * pool.length) | 0];
}
