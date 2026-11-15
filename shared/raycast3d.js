import { WALLS, PLAYER } from './game-config.js';

const EPS = 1e-8;

// Slab intersection between a ray and an axis-aligned box.
// Returns the entry distance, or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0;
  let tmax = Infinity;

  for (const [o, d, mn, mx] of [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ]) {
    if (Math.abs(d) < EPS) {
      if (o < mn || o > mx) return Infinity;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin >= 0 ? tmin : Infinity;
}

export function rayWorldWalls(ox, oy, oz, dx, dy, dz, maxDist = Infinity) {
  let nearest = maxDist;
  let wall = null;
  for (const w of WALLS) {
    const t = rayBox(
      ox, oy, oz, dx, dy, dz,
      w.x, 0, w.y,
      w.x + w.w, w.height, w.y + w.h,
    );
    if (t < nearest) {
      nearest = t;
      wall = w;
    }
  }
  return { t: nearest, wall };
}

export function castShot(ox, oy, oz, dx, dy, dz, maxDist, shooterId, players) {
  let bestT = maxDist;
  let hitType = 'none';
  let hitPlayer = null;
  let headshot = false;
  let wall = null;

  const wallHit = rayWorldWalls(ox, oy, oz, dx, dy, dz, bestT);
  if (wallHit.wall) {
    bestT = wallHit.t;
    hitType = 'wall';
    wall = wallHit.wall;
  }

  // Floor plane.
  if (dy < -EPS) {
    const t = -oy / dy;
    if (t > 0 && t < bestT) {
      bestT = t;
      hitType = 'floor';
      wall = null;
    }
  }

  for (const p of players) {
    if (p.id === shooterId || !p.alive) continue;
    const r = PLAYER.radius;
    const bodyT = rayBox(
      ox, oy, oz, dx, dy, dz,
      p.x - r, 0, p.y - r,
      p.x + r, PLAYER.height * 0.84, p.y + r,
    );
    const headT = rayBox(
      ox, oy, oz, dx, dy, dz,
      p.x - r * 0.55, PLAYER.height * 0.84, p.y - r * 0.55,
      p.x + r * 0.55, PLAYER.height, p.y + r * 0.55,
    );
    let t = bodyT;
    let head = false;
    if (headT < t) {
      t = headT;
      head = true;
    }
    if (t < bestT) {
      bestT = t;
      hitType = 'player';
      hitPlayer = p;
      headshot = head;
      wall = null;
    }
  }

  const point = {
    x: ox + dx * bestT,
    y: oy + dy * bestT,
    z: oz + dz * bestT,
  };
  return { t: bestT, type: hitType, player: hitPlayer, headshot, point, wall };
}

export function hasLineOfSight3D(ax, az, bx, bz, fromY = PLAYER.eye, toY = PLAYER.eye * 0.7) {
  const dx = bx - ax;
  const dz = bz - az;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1) return true;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  const hit = rayWorldWalls(ax, fromY, az, nx, ny, nz, len - 2);
  return !hit.wall;
}

export function directionFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: cp * Math.cos(yaw),
    y: Math.sin(pitch),
    z: cp * Math.sin(yaw),
  };
}
