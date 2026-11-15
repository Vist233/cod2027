import { WALLS, WORLD } from './game-config.js';

export function circleRectOverlap(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function circleHitsWalls(x, y, r, walls = WALLS) {
  for (let i = 0; i < walls.length; i++) {
    if (circleRectOverlap(x, y, r, walls[i])) return true;
  }
  return false;
}

export function moveCircle(x, y, dx, dy, r = 16, walls = WALLS) {
  let nx = x + dx;
  let ny = y;
  if (circleHitsWalls(nx, ny, r, walls)) {
    nx = x;
  }
  ny = y + dy;
  if (circleHitsWalls(nx, ny, r, walls)) {
    ny = y;
  }
  nx = Math.max(r, Math.min(WORLD.w - r, nx));
  ny = Math.max(r, Math.min(WORLD.h - r, ny));
  return { x: nx, y: ny };
}

// Slab test. Returns the entry t in [0, 1] or Infinity.
export function rayRect(x1, y1, x2, y2, rect) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tmin = 0;
  let tmax = 1;

  if (Math.abs(dx) < 1e-9) {
    if (x1 < rect.x || x1 > rect.x + rect.w) return Infinity;
  } else {
    let t1 = (rect.x - x1) / dx;
    let t2 = (rect.x + rect.w - x1) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }

  if (Math.abs(dy) < 1e-9) {
    if (y1 < rect.y || y1 > rect.y + rect.h) return Infinity;
  } else {
    let t1 = (rect.y - y1) / dy;
    let t2 = (rect.y + rect.h - y1) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }

  return tmin;
}

export function rayWalls(x1, y1, x2, y2, walls = WALLS) {
  let nearest = Infinity;
  for (let i = 0; i < walls.length; i++) {
    const t = rayRect(x1, y1, x2, y2, walls[i]);
    if (t < nearest) nearest = t;
  }
  return nearest;
}

export function hasLineOfSight(x1, y1, x2, y2, walls = WALLS) {
  return rayWalls(x1, y1, x2, y2, walls) === Infinity;
}

// Segment vs circle, returns t in [0,1] or Infinity.
export function rayCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return Infinity;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return Infinity;
}

export function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
