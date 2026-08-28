export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAP_W = 2400;
export const MAP_H = 1700;
const TAU = Math.PI * 2;

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
export const angNorm = (a: number) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

export interface WorldData {
  rects: Rect[];
  corners: { x: number; y: number }[];
  spawn: { x: number; y: number };
  crateSpots: { x: number; y: number }[];
}

export function generateWorld(seed: number): WorldData {
  const rnd = mulberry(seed);
  const rects: Rect[] = [];
  const B = 42; // border wall thickness
  rects.push({ x: -B, y: -B, w: MAP_W + 2 * B, h: B });
  rects.push({ x: -B, y: MAP_H, w: MAP_W + 2 * B, h: B });
  rects.push({ x: -B, y: -B, w: B, h: MAP_H + 2 * B });
  rects.push({ x: MAP_W, y: -B, w: B, h: MAP_H + 2 * B });

  const spawn = { x: MAP_W / 2, y: MAP_H / 2 };
  const clearZone = 230;

  const intersectsSpawn = (r: Rect) =>
    r.x < spawn.x + clearZone &&
    r.x + r.w > spawn.x - clearZone &&
    r.y < spawn.y + clearZone &&
    r.y + r.h > spawn.y - clearZone;

  const overlapsAny = (r: Rect, pad: number) =>
    rects.some(
      (o) =>
        r.x < o.x + o.w + pad &&
        r.x + r.w + pad > o.x &&
        r.y < o.y + o.h + pad &&
        r.y + r.h + pad > o.y
    );

  // long walls
  for (let i = 0; i < 9; i++) {
    const horiz = rnd() < 0.5;
    const len = 240 + rnd() * 320;
    const th = 36 + rnd() * 14;
    const r: Rect = horiz
      ? { x: 120 + rnd() * (MAP_W - 240 - len), y: 120 + rnd() * (MAP_H - 240), w: len, h: th }
      : { x: 120 + rnd() * (MAP_W - 240), y: 120 + rnd() * (MAP_H - 240 - len), w: th, h: len };
    if (!intersectsSpawn(r) && !overlapsAny(r, 46)) rects.push(r);
  }
  // crates
  for (let i = 0; i < 16; i++) {
    const s = 54 + rnd() * 34;
    const r: Rect = { x: 100 + rnd() * (MAP_W - 200 - s), y: 100 + rnd() * (MAP_H - 200 - s), w: s, h: s };
    if (!intersectsSpawn(r) && !overlapsAny(r, 30)) rects.push(r);
  }
  // pillars
  for (let i = 0; i < 5; i++) {
    const s = 64;
    const r: Rect = { x: 160 + rnd() * (MAP_W - 320 - s), y: 160 + rnd() * (MAP_H - 320 - s), w: s, h: s };
    if (!intersectsSpawn(r) && !overlapsAny(r, 60)) rects.push(r);
  }

  const corners: { x: number; y: number }[] = [];
  for (const r of rects) {
    corners.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h });
  }

  // candidate pickup spots (open floor points)
  const crateSpots: { x: number; y: number }[] = [];
  for (let i = 0; i < 26; i++) {
    const x = 120 + rnd() * (MAP_W - 240);
    const y = 120 + rnd() * (MAP_H - 240);
    if (!pointBlocked(rects, x, y, 30)) crateSpots.push({ x, y });
  }

  return { rects, corners, spawn, crateSpots };
}

export function pointBlocked(rects: Rect[], x: number, y: number, pad: number) {
  for (const r of rects) {
    if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
  }
  return false;
}

/** resolve circle vs rect, returns corrected position */
export function collideCircle(px: number, py: number, rad: number, r: Rect) {
  const cx = clamp(px, r.x, r.x + r.w);
  const cy = clamp(py, r.y, r.y + r.h);
  const dx = px - cx;
  const dy = py - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rad * rad) return { x: px, y: py, hit: false };
  const d = Math.sqrt(d2) || 0.0001;
  const push = rad - d;
  return { x: px + (dx / d) * push, y: py + (dy / d) * push, hit: true };
}

/** segment vs rect, returns t in [0,1] of first hit or -1 */
export function segRect(x0: number, y0: number, x1: number, y1: number, r: Rect): number {
  let tmin = 0;
  let tmax = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < r.x || x0 > r.x + r.w) return -1;
  } else {
    let t1 = (r.x - x0) / dx;
    let t2 = (r.x + r.w - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y0 < r.y || y0 > r.y + r.h) return -1;
  } else {
    let t1 = (r.y - y0) / dy;
    let t2 = (r.y + r.h - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export function losClear(rects: Rect[], x0: number, y0: number, x1: number, y1: number) {
  for (let i = 4; i < rects.length; i++) {
    if (segRect(x0, y0, x1, y1, rects[i]) >= 0) return false;
  }
  return true;
}

/** raycast distance against interior rects + border */
export function rayDist(rects: Rect[], x: number, y: number, angle: number, maxDist: number) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const x1 = x + dx * maxDist;
  const y1 = y + dy * maxDist;
  let best = maxDist;
  for (const r of rects) {
    const t = segRect(x, y, x1, y1, r);
    if (t >= 0 && t * maxDist < best) best = t * maxDist;
  }
  return best;
}
