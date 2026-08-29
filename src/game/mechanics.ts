/* ------------------------------------------------------------------
 * Боевые компоненты: криты, цепная молния (геометрия и выбор целей).
 * Чистые функции — движок вызывает их, не храня логику в игроке.
 * ------------------------------------------------------------------ */

export function rollCrit(chance: number): boolean {
  return chance > 0 && Math.random() < chance;
}

interface EntityLike { id: number; x: number; y: number; }

/** ближайшая сущность, не входящая в exclude, в радиусе maxR */
export function nearestOther<T extends EntityLike>(
  arr: T[],
  exclude: Set<number>,
  x: number,
  y: number,
  maxR: number
): T | null {
  let best: T | null = null;
  let bd = maxR * maxR;
  for (const e of arr) {
    if (exclude.has(e.id)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = e; }
  }
  return best;
}

/** ломаная «молния» между точками: добавляет jitter-сегменты */
export function lightningPath(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segs = 5;
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      const jx = s === 0 ? 0 : (Math.random() - 0.5) * 22;
      const jy = s === 0 ? 0 : (Math.random() - 0.5) * 22;
      out.push({ x: a.x + (b.x - a.x) * t + jx, y: a.y + (b.y - a.y) * t + jy });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** угол между направлением (x,y)->(tx,ty) и aim, по модулю */
export function angleOff(aim: number, x: number, y: number, tx: number, ty: number): number {
  const a = Math.atan2(ty - y, tx - x);
  let d = a - aim;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}
