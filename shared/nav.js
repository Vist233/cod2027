import { WORLD, PLAYER } from './game-config.js';
import { circleHitsWalls } from './physics.js';

const CELL = 40;
const COLS = Math.ceil(WORLD.w / CELL);
const ROWS = Math.ceil(WORLD.h / CELL);
const WALK_RADIUS = PLAYER.radius + 7;

const walkable = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x = (c + 0.5) * CELL;
    const y = (r + 0.5) * CELL;
    walkable[r * COLS + c] = circleHitsWalls(x, y, WALK_RADIUS) ? 0 : 1;
  }
}

const idx = (c, r) => r * COLS + c;
const cellOf = (x, y) => {
  const c = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
  const r = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
  return { c, r };
};

function nearestWalkable(c, r) {
  if (walkable[idx(c, r)]) return { c, r };
  for (let radius = 1; radius <= 5; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        if (walkable[idx(nc, nr)]) return { c: nc, r: nr };
      }
    }
  }
  return null;
}

function reconstruct(came, end) {
  const cells = [];
  let cur = end;
  while (cur !== -1) {
    cells.push(cur);
    cur = came[cur];
  }
  cells.reverse();
  const points = cells.map((i) => {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    return { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
  });
  // Drop every other point on long straight runs for smoother movement.
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function findPath(sx, sy, tx, ty) {
  let start = cellOf(sx, sy);
  let goal = cellOf(tx, ty);
  start = nearestWalkable(start.c, start.r);
  goal = nearestWalkable(goal.c, goal.r);
  if (!start || !goal) return [];
  const startId = idx(start.c, start.r);
  const goalId = idx(goal.c, goal.r);
  if (startId === goalId) return [{ x: tx, y: ty }];

  const gScore = new Float32Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const open = [];
  const h = (c, r) => {
    const dx = Math.abs(c - goal.c);
    const dy = Math.abs(r - goal.r);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  gScore[startId] = 0;
  open.push({ id: startId, c: start.c, r: start.r, f: h(start.c, start.r) });

  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  let guard = 0;
  while (open.length && guard++ < 4000) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
    const cur = open.splice(bestIdx, 1)[0];
    if (closed[cur.id]) continue;
    if (cur.id === goalId) return reconstruct(came, goalId);
    closed[cur.id] = 1;

    for (const [dc, dr, cost] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const nid = idx(nc, nr);
      if (!walkable[nid] || closed[nid]) continue;
      if (dc && dr) {
        if (!walkable[idx(cur.c + dc, cur.r)] || !walkable[idx(cur.c, cur.r + dr)]) continue;
      }
      const ng = gScore[cur.id] + cost;
      if (ng < gScore[nid]) {
        gScore[nid] = ng;
        came[nid] = cur.id;
        open.push({ id: nid, c: nc, r: nr, f: ng + h(nc, nr) });
      }
    }
  }
  return [];
}

export const NAV_INFO = { CELL, COLS, ROWS };
