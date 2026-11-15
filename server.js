import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  WORLD,
  PLAYER,
  MATCH,
  WEAPONS,
  WEAPON_ORDER,
  WALLS,
  SPAWNS,
  PICKUPS,
  COLORS,
} from './shared/game-config.js';
import {
  moveCircle,
  hasLineOfSight,
  distance,
} from './shared/physics.js';
import { castShot, hasLineOfSight3D } from './shared/raycast3d.js';
import { findPath } from './shared/nav.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 2027;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARED_DIR = path.join(__dirname, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  let root = PUBLIC_DIR;
  if (urlPath.startsWith('/shared/')) {
    root = SHARED_DIR;
    urlPath = urlPath.slice('/shared'.length);
  }
  const filePath = path.normalize(path.join(root, urlPath));
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map();
const rooms = new Map();
let matchQueue = [];
let nextClientId = 1;

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function cleanName(raw, fallback = 'OPERATOR') {
  const name = String(raw ?? '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return name || fallback;
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += alphabet[(Math.random() * alphabet.length) | 0];
  } while (rooms.has(code));
  return code;
}

function send(client, msg) {
  if (!client || client.ws.readyState !== 1) return;
  try {
    client.ws.send(JSON.stringify(msg));
  } catch {
    // socket is going away
  }
}

function broadcast(room, msg) {
  for (const client of room.clients) send(client, msg);
}

function queueRemove(client) {
  matchQueue = matchQueue.filter((c) => c !== client);
}

function roomUpdate(room) {
  return {
    code: room.code,
    mode: room.mode,
    host: room.clients[0]?.id,
    players: room.clients.map((c) => ({ id: c.id, name: c.name })),
    max: 2,
  };
}

function leaveRoom(client, notify = true) {
  queueRemove(client);
  const room = client.room;
  if (!room) return;
  client.room = null;
  room.rematch?.clear();
  room.clients = room.clients.filter((c) => c !== client);
  for (const other of room.clients) {
    if (notify) {
      send(other, {
        t: 'opponent_left',
        message: room.match ? '对手已撤离战场' : '房主已离开房间',
      });
      other.room = null;
    }
  }
  if (room.match) room.match.disposed = true;
  rooms.delete(room.code);
}

function makePlayer(client, spawnIndex, isBot = false, name = null) {
  const spawn = SPAWNS[spawnIndex % SPAWNS.length];
  return {
    id: client?.id || uid('bot'),
    name: isBot ? name || 'VIPER-09' : client.name,
    isBot,
    x: spawn.x,
    y: spawn.y,
    a: spawn.a,
    pitch: 0,
    hp: PLAYER.maxHp,
    alive: true,
    score: 0,
    kills: 0,
    deaths: 0,
    weapon: 'ar',
    ammo: { ar: WEAPONS.ar.mag, sg: WEAPONS.sg.mag },
    reloading: false,
    reloadEnd: 0,
    reloadStart: 0,
    nextFire: 0,
    dashUntil: 0,
    dashReadyAt: 0,
    dashVx: 0,
    dashVy: 0,
    respawnAt: 0,
    spawnIndex,
    input: { mx: 0, my: 0, aim: 0, pitch: 0, ads: false, shoot: false },
    lastInputAt: 0,
    lastX: spawn.x,
    lastY: spawn.y,
    stuckTime: 0,
    ai: {
      strafe: Math.random() < 0.5 ? 1 : -1,
      strafeFlip: 0,
      nextBurst: 0,
      burstEnd: 0,
      aimNoise: 0,
      noiseTarget: 0,
      nextNoise: 0,
      roam: null,
      roamUntil: 0,
      path: null,
      pathIndex: 0,
      repathAt: 0,
      reactAt: 0,
      nextDash: 0,
    },
  };
}

class Match {
  constructor(room) {
    this.room = room;
    this.mode = room.mode;
    this.startedAt = Date.now();
    this.countdownEnds = this.startedAt + MATCH.countdown * 1000;
    this.phase = 'countdown';
    this.timeLeft = MATCH.duration;
    this.players = new Map();
    this.events = [];
    this.snapAcc = 0;
    this.lastTick = Date.now();
    this.endedAt = 0;
    this.timeoutWinner = null;
    this.rematchVotes = new Set();
    this.disposed = false;
    this.pickups = PICKUPS.map((p) => ({ ...p, active: true, respawnAt: 0 }));

    const humans = room.clients.slice(0, 2);
    humans.forEach((client, i) => {
      const p = makePlayer(client, i);
      this.players.set(p.id, p);
    });
    if (this.mode === 'practice') {
      const bot = makePlayer(null, 1, true);
      this.players.set(bot.id, bot);
    }
  }

  humanPlayers() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  otherPlayers(p) {
    return [...this.players.values()].filter((q) => q.id !== p.id);
  }

  pushEvent(event) {
    this.events.push(event);
  }

  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p || p.isBot) return;
    const now = Date.now();
    let mx = Number(msg.mx) || 0;
    let my = Number(msg.my) || 0;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    p.input.mx = Math.max(-1, Math.min(1, mx));
    p.input.my = Math.max(-1, Math.min(1, my));
    const aim = Number(msg.aim);
    if (Number.isFinite(aim)) p.input.aim = aim;
    const pitch = Number(msg.pitch);
    if (Number.isFinite(pitch)) p.input.pitch = Math.max(-1.32, Math.min(1.32, pitch));
    p.input.ads = !!msg.ads;
    p.input.shoot = !!msg.shoot;
    p.lastInputAt = now;
  }

  action(id, action, value) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const now = Date.now();
    if (action === 'weapon') {
      const idx = Number(value) === 2 ? 1 : 0;
      const next = WEAPON_ORDER[idx];
      if (next && next !== p.weapon) {
        p.weapon = next;
        p.reloading = false;
        p.nextFire = Math.max(p.nextFire, now + 180);
        this.pushEvent({ type: 'switch', id: p.id, weapon: next });
      }
      return;
    }
    if (this.phase !== 'live') return;
    if (action === 'reload') this.startReload(p, now);
    if (action === 'dash') this.startDash(p, now);
  }

  startReload(p, now) {
    const weapon = WEAPONS[p.weapon];
    if (p.reloading || p.ammo[p.weapon] >= weapon.mag) return;
    p.reloading = true;
    p.reloadStart = now;
    p.reloadEnd = now + weapon.reload;
    this.pushEvent({ type: 'reload', id: p.id, weapon: p.weapon, duration: weapon.reload });
  }

  startDash(p, now) {
    if (now < p.dashReadyAt) return;
    let dx = p.input.mx;
    let dy = p.input.my;
    if (Math.hypot(dx, dy) < 0.2) {
      dx = Math.cos(p.a);
      dy = Math.sin(p.a);
    }
    const len = Math.hypot(dx, dy) || 1;
    p.dashVx = (dx / len) * PLAYER.dashSpeed;
    p.dashVy = (dy / len) * PLAYER.dashSpeed;
    p.dashUntil = now + PLAYER.dashTime * 1000;
    p.dashReadyAt = now + PLAYER.dashCooldown * 1000;
    this.pushEvent({ type: 'dash', id: p.id, x: p.x, y: p.y, a: Math.atan2(dy, dx) });
  }

  respawn(p, now) {
    const enemies = this.otherPlayers(p).filter((q) => q.alive);
    let best = SPAWNS[p.spawnIndex % SPAWNS.length];
    let bestScore = -Infinity;
    for (const spawn of SPAWNS) {
      let minD = Infinity;
      for (const e of enemies) minD = Math.min(minD, distance(spawn.x, spawn.y, e.x, e.y));
      const score = minD + Math.random() * 60;
      if (score > bestScore) {
        bestScore = score;
        best = spawn;
      }
    }
    p.x = best.x;
    p.y = best.y;
    p.a = best.a;
    p.pitch = 0;
    p.input.pitch = 0;
    p.hp = PLAYER.maxHp;
    p.alive = true;
    p.ammo = { ar: WEAPONS.ar.mag, sg: WEAPONS.sg.mag };
    p.reloading = false;
    p.nextFire = now + 120;
    p.dashUntil = 0;
    p.dashReadyAt = now;
    p.lastX = p.x;
    p.lastY = p.y;
    p.input.shoot = false;
    this.pushEvent({ type: 'spawn', id: p.id, x: p.x, y: p.y });
  }

  damage(attacker, victim, amount, now, headshot = false) {
    victim.hp -= amount;
    this.pushEvent({
      type: 'damage',
      target: victim.id,
      by: attacker.id,
      amount: Math.round(amount),
      hp: Math.max(0, victim.hp),
      x: victim.x,
      y: victim.y,
      ax: attacker.x,
      az: attacker.y,
      a: Math.atan2(victim.y - attacker.y, victim.x - attacker.x),
      headshot,
    });
    if (victim.hp > 0) return;

    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.reloading = false;
    victim.respawnAt = now + PLAYER.respawnTime * 1000;
    victim.input.shoot = false;
    attacker.kills++;
    attacker.score++;
    this.pushEvent({
      type: 'kill',
      by: attacker.id,
      byName: attacker.name,
      victim: victim.id,
      victimName: victim.name,
      weapon: attacker.weapon,
      headshot,
      x: victim.x,
      y: victim.y,
    });
    if (attacker.score >= MATCH.killLimit) this.end(attacker.id, now);
  }

  fire(p, now) {
    const weapon = WEAPONS[p.weapon];
    if (!p.alive || p.reloading || now < p.nextFire || this.phase !== 'live') return;
    if (p.ammo[p.weapon] <= 0) {
      this.startReload(p, now);
      return;
    }
    p.ammo[p.weapon]--;
    p.nextFire = now + weapon.rate;
    const moving = Math.abs(p.input.mx) + Math.abs(p.input.my) > 0.1;
    const ads = p.input.ads;
    let spread = weapon.spread + (moving ? weapon.moveSpread : 0);
    spread *= ads ? 0.42 : 1;
    if (p.isBot) spread *= 2.4;
    const originX = p.x + Math.cos(p.a) * 18;
    const originY = PLAYER.eye;
    const originZ = p.y + Math.sin(p.a) * 18;
    const players = [...this.players.values()];

    for (let i = 0; i < weapon.pellets; i++) {
      const yaw = p.a + (Math.random() - 0.5) * spread * 2;
      const pitch = p.pitch + (Math.random() - 0.5) * spread * 2;
      const cp = Math.cos(pitch);
      const dx = cp * Math.cos(yaw);
      const dy = Math.sin(pitch);
      const dz = cp * Math.sin(yaw);
      const result = castShot(
        originX, originY, originZ,
        dx, dy, dz,
        weapon.range,
        p.id,
        players,
      );
      this.pushEvent({
        type: 'shot',
        id: p.id,
        weapon: p.weapon,
        x1: originX,
        y1: originY,
        z1: originZ,
        x2: result.point.x,
        y2: result.point.y,
        z2: result.point.z,
        hit: result.type === 'player',
        headshot: result.headshot,
        surface: result.type,
      });
      if (result.type === 'player' && result.player) {
        const dmg = weapon.damage * (result.headshot ? 2.1 : 1) * (p.isBot ? 0.85 : 1);
        this.damage(p, result.player, dmg, now, result.headshot);
      }
    }

    if (p.ammo[p.weapon] === 0 && !p.reloading) this.startReload(p, now);
  }

  updateBot(bot, now, dt) {
    if (!bot.alive) return;
    const target = this.otherPlayers(bot).find((q) => q.alive);
    if (!target) return;
    const ai = bot.ai;
    const d = distance(bot.x, bot.y, target.x, target.y);
    const los = hasLineOfSight3D(bot.x, bot.y, target.x, target.y);
    bot.lastInputAt = now;

    if (now > ai.strafeFlip) {
      ai.strafe = Math.random() < 0.5 ? 1 : -1;
      ai.strafeFlip = now + 900 + Math.random() * 1400;
    }
    if (now > ai.nextNoise) {
      ai.noiseTarget = (Math.random() - 0.5) * 0.075;
      ai.nextNoise = now + 300 + Math.random() * 500;
    }
    ai.aimNoise += (ai.noiseTarget - ai.aimNoise) * Math.min(1, dt * 5);

    let mx = 0;
    let my = 0;
    const dirX = (target.x - bot.x) / (d || 1);
    const dirY = (target.y - bot.y) / (d || 1);

    if (los) {
      ai.path = null;
      let radial = 0;
      if (d > 470) radial = 1;
      else if (d < 215) radial = -0.8;
      mx = dirX * radial + -dirY * ai.strafe * 0.85;
      my = dirY * radial + dirX * ai.strafe * 0.85;
      const desired = Math.atan2(target.y - bot.y, target.x - bot.x) + ai.aimNoise;
      const delta = Math.atan2(Math.sin(desired - bot.a), Math.cos(desired - bot.a));
      bot.a += Math.max(-7 * dt, Math.min(7 * dt, delta));
      const desiredPitch =
        Math.atan2(PLAYER.height * 0.6 - PLAYER.eye, Math.max(1, d)) + ai.aimNoise * 0.4;
      bot.pitch += Math.max(-5 * dt, Math.min(5 * dt, desiredPitch - bot.pitch));

      const aimErr = Math.abs(Math.atan2(Math.sin(desired - bot.a), Math.cos(desired - bot.a)));
      const pitchErr = Math.abs(desiredPitch - bot.pitch);
      if (now >= ai.nextBurst) {
        ai.reactAt = now + 230 + Math.random() * 320;
        ai.burstEnd = ai.reactAt + 280 + Math.random() * 300;
        ai.nextBurst = ai.burstEnd + 760 + Math.random() * 700;
      }
      bot.input.shoot =
        now >= ai.reactAt && now <= ai.burstEnd && aimErr < 0.13 && pitchErr < 0.1 && d < 1100;

      if (d < 280 && now > ai.nextDash && now > bot.dashReadyAt + 500 && Math.random() < 0.03) {
        bot.input.mx = mx;
        bot.input.my = my;
        this.startDash(bot, now);
        ai.nextDash = now + 4200;
      }
    } else {
      bot.input.shoot = false;
      if (!ai.path || now > ai.repathAt) {
        ai.path = findPath(bot.x, bot.y, target.x, target.y);
        ai.pathIndex = 0;
        ai.repathAt = now + 650 + Math.random() * 350;
      }
      let point = null;
      if (ai.path && ai.path.length) {
        while (
          ai.pathIndex < ai.path.length &&
          distance(bot.x, bot.y, ai.path[ai.pathIndex].x, ai.path[ai.pathIndex].y) < 28
        ) {
          ai.pathIndex++;
        }
        if (ai.pathIndex < ai.path.length) point = ai.path[ai.pathIndex];
      }
      if (!point) {
        if (!ai.roam || now > ai.roamUntil || distance(bot.x, bot.y, ai.roam.x, ai.roam.y) < 36) {
          ai.roam = {
            x: target.x + (Math.random() - 0.5) * 440,
            y: target.y + (Math.random() - 0.5) * 440,
          };
          ai.roam.x = Math.max(70, Math.min(WORLD.w - 70, ai.roam.x));
          ai.roam.y = Math.max(70, Math.min(WORLD.h - 70, ai.roam.y));
          ai.roamUntil = now + 2400;
        }
        point = ai.roam;
      }
      if (point) {
        const rx = point.x - bot.x;
        const ry = point.y - bot.y;
        const rl = Math.hypot(rx, ry) || 1;
        mx = rx / rl;
        my = ry / rl;
        const want = Math.atan2(ry, rx);
        const delta = Math.atan2(Math.sin(want - bot.a), Math.cos(want - bot.a));
        bot.a += Math.max(-8 * dt, Math.min(8 * dt, delta));
        bot.pitch += (0 - bot.pitch) * Math.min(1, dt * 5);
      }
    }

    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    bot.input.mx = mx;
    bot.input.my = my;
    if (bot.ammo[bot.weapon] === 0 && !bot.reloading) this.startReload(bot, now);

    if (bot.hp < 58 && this.pickups.some((p) => p.active)) {
      const kit = this.pickups
        .filter((p) => p.active)
        .sort((a, b) => distance(bot.x, bot.y, a.x, a.y) - distance(bot.x, bot.y, b.x, b.y))[0];
      if (kit && distance(bot.x, bot.y, kit.x, kit.y) < 420 && hasLineOfSight(bot.x, bot.y, kit.x, kit.y)) {
        const rx = kit.x - bot.x;
        const ry = kit.y - bot.y;
        const rl = Math.hypot(rx, ry) || 1;
        if (rl > 24) {
          bot.input.mx = rx / rl;
          bot.input.my = ry / rl;
        }
      }
    }
  }

  updatePlayer(p, now, dt) {
    if (!p.alive) {
      if (now >= p.respawnAt) this.respawn(p, now);
      return;
    }
    if (now - p.lastInputAt > 900) {
      p.input.mx = 0;
      p.input.my = 0;
      p.input.shoot = false;
    }
    if (p.reloading && now >= p.reloadEnd) {
      p.reloading = false;
      p.ammo[p.weapon] = WEAPONS[p.weapon].mag;
      this.pushEvent({ type: 'reloaded', id: p.id, weapon: p.weapon });
    }

    if (!p.isBot) {
      p.a = p.input.aim;
      p.pitch = p.input.pitch;
    }

    if (this.phase === 'live') {
      if (now < p.dashUntil) {
        const moved = moveCircle(p.x, p.y, p.dashVx * dt, p.dashVy * dt, PLAYER.radius);
        p.x = moved.x;
        p.y = moved.y;
      } else {
        const speed = PLAYER.speed * (p.reloading ? 0.86 : 1) * (p.input.ads ? 0.62 : 1);
        const moved = moveCircle(
          p.x,
          p.y,
          p.input.mx * speed * dt,
          p.input.my * speed * dt,
          PLAYER.radius,
        );
        p.x = moved.x;
        p.y = moved.y;
      }
      if (p.input.shoot) this.fire(p, now);
    }

    for (const kit of this.pickups) {
      if (!kit.active || !p.alive) continue;
      if (distance(p.x, p.y, kit.x, kit.y) < 30) {
        if (p.hp < PLAYER.maxHp) {
          const healed = Math.min(PLAYER.maxHp - p.hp, kit.amount);
          p.hp += healed;
          kit.active = false;
          kit.respawnAt = now + kit.respawn;
          this.pushEvent({
            type: 'pickup',
            id: p.id,
            kind: kit.kind,
            x: kit.x,
            y: kit.y,
            amount: healed,
          });
        }
      }
    }
  }

  end(winnerId, now) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.endedAt = now;
    this.timeoutWinner = winnerId || null;
    this.pushEvent({ type: 'match_end', winner: winnerId || null });
  }

  tick(now) {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTick) / 1000));
    this.lastTick = now;

    if (this.phase === 'countdown') {
      if (now >= this.countdownEnds) this.phase = 'live';
    } else if (this.phase === 'live') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      for (const p of this.players.values()) {
        if (p.isBot) this.updateBot(p, now, dt);
        this.updatePlayer(p, now, dt);
      }
      for (const kit of this.pickups) {
        if (!kit.active && kit.respawnAt && now >= kit.respawnAt) kit.active = true;
      }
      if (this.timeLeft <= 0 && this.phase === 'live') {
        let winner = null;
        let best = -1;
        for (const p of this.players.values()) {
          if (p.score > best) {
            best = p.score;
            winner = p.id;
          }
        }
        this.end(winner, now);
      }
    }

    this.snapAcc += dt;
    if (this.snapAcc >= 1 / MATCH.snapshotRate) {
      this.snapAcc = 0;
      this.broadcastSnapshot(now);
    }
  }

  serialize(now) {
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      a: Math.round(p.a * 1000) / 1000,
      pitch: Math.round(p.pitch * 1000) / 1000,
      hp: Math.round(p.hp),
      alive: p.alive,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
      weapon: p.weapon,
      ammo: p.ammo[p.weapon],
      reserve: Infinity,
      reloading: p.reloading,
      reloadPct: p.reloading
        ? Math.max(0, Math.min(1, (now - p.reloadStart) / (p.reloadEnd - p.reloadStart)))
        : 0,
      dashCd: Math.max(0, p.dashReadyAt - now),
      respawnIn: p.alive ? 0 : Math.max(0, p.respawnAt - now),
      ads: !!p.input.ads,
      isBot: p.isBot,
    }));
    const events = this.events;
    this.events = [];
    return {
      t: 'state',
      now,
      phase: this.phase,
      countdown: Math.max(0, Math.ceil((this.countdownEnds - now) / 1000)),
      timeLeft: Math.round(this.timeLeft * 10) / 10,
      killLimit: MATCH.killLimit,
      winner: this.phase === 'ended' ? this.timeoutWinner : null,
      players,
      pickups: this.pickups.map((p) => ({ id: p.id, x: p.x, y: p.y, kind: p.kind, active: p.active })),
      events,
      rematch: [...this.rematchVotes],
    };
  }

  broadcastSnapshot(now) {
    const payload = this.serialize(now);
    for (const client of this.room.clients) send(client, payload);
  }
}

function startMatch(room) {
  if (room.mode !== 'practice' && room.clients.length < 2) return;
  const match = new Match(room);
  room.match = match;
  room.rematch = new Set();
  for (const client of room.clients) {
    const opponent = [...match.players.values()].find((p) => p.id !== client.id);
    send(client, {
      t: 'match',
      mode: room.mode,
      code: room.code,
      you: { id: client.id, name: client.name },
      opponent: opponent
        ? { id: opponent.id, name: opponent.name, isBot: opponent.isBot }
        : null,
      killLimit: MATCH.killLimit,
      duration: MATCH.duration,
      countdown: MATCH.countdown,
    });
  }
}

function createRoom(mode, client, code = null) {
  const room = {
    code: code || makeCode(),
    mode,
    clients: [client],
    match: null,
    createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  client.room = room;
  return room;
}

function startPractice(client) {
  leaveRoom(client);
  const room = createRoom('practice', client);
  startMatch(room);
}

function tryQuickMatch(client) {
  leaveRoom(client);
  queueRemove(client);
  const waiting = matchQueue.find(
    (c) => c !== client && c.ws.readyState === 1 && !c.room,
  );
  if (waiting) {
    matchQueue = matchQueue.filter((c) => c !== waiting);
    const room = createRoom('pvp', waiting);
    room.clients.push(client);
    client.room = room;
    startMatch(room);
  } else {
    matchQueue.push(client);
    send(client, { t: 'queued', position: matchQueue.length });
  }
}

function rematch(client) {
  const room = client.room;
  if (!room || !room.match || room.match.phase !== 'ended') return;
  room.match.rematchVotes.add(client.id);
  if (room.mode === 'practice') {
    startMatch(room);
    return;
  }
  const humans = room.clients.map((c) => c.id);
  const votes = humans.filter((id) => room.match.rematchVotes.has(id));
  broadcast(room, { t: 'rematch_update', votes });
  if (votes.length === humans.length) startMatch(room);
}

function handleMessage(client, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'hello': {
      client.name = cleanName(msg.name);
      send(client, { t: 'welcome', id: client.id, name: client.name });
      break;
    }
    case 'ping': {
      send(client, { t: 'pong', ts: msg.ts });
      break;
    }
    case 'queue':
      if (!client.room) tryQuickMatch(client);
      break;
    case 'cancel_queue':
      queueRemove(client);
      send(client, { t: 'queue_cancelled' });
      break;
    case 'create_room': {
      leaveRoom(client);
      const room = createRoom('private', client);
      send(client, { ...roomUpdate(room), t: 'room_created' });
      break;
    }
    case 'join_room': {
      const code = String(msg.code || '').trim().toUpperCase().slice(0, 6);
      const room = rooms.get(code);
      if (!room) {
        send(client, { t: 'error', message: '房间不存在或已关闭' });
        break;
      }
      if (room.mode !== 'private' || room.match) {
        send(client, { t: 'error', message: '该房间已开始对战' });
        break;
      }
      if (room.clients.length >= 2) {
        send(client, { t: 'error', message: '房间已满' });
        break;
      }
      leaveRoom(client);
      room.clients.push(client);
      client.room = room;
      broadcast(room, { ...roomUpdate(room), t: 'room_joined' });
      startMatch(room);
      break;
    }
    case 'practice':
      startPractice(client);
      break;
    case 'input':
      client.room?.match?.setInput(client.id, msg);
      break;
    case 'action':
      client.room?.match?.action(client.id, String(msg.a || ''), msg.v);
      break;
    case 'rematch':
      rematch(client);
      break;
    case 'leave':
      leaveRoom(client);
      send(client, { t: 'left' });
      break;
    default:
      break;
  }
}

wss.on('connection', (ws) => {
  const client = {
    id: `op_${nextClientId++}_${Math.random().toString(36).slice(2, 5)}`,
    name: 'OPERATOR',
    ws,
    room: null,
    connectedAt: Date.now(),
  };
  clients.set(ws, client);
  send(client, { t: 'welcome', id: client.id, name: client.name });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    try {
      handleMessage(client, msg);
    } catch (err) {
      console.error('Message error:', err);
    }
  });

  ws.on('close', () => {
    queueRemove(client);
    leaveRoom(client);
    clients.delete(ws);
  });

  ws.on('error', () => {
    // close handler cleans up
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.match && !room.match.disposed) room.match.tick(now);
  }
  // Drop stale waiting rooms after 30 minutes.
  for (const [code, room] of rooms) {
    if (!room.match && now - room.createdAt > 30 * 60 * 1000) {
      for (const client of room.clients) client.room = null;
      rooms.delete(code);
    }
  }
}, 16);

server.listen(PORT, () => {
  console.log('');
  console.log('  COD 2027 // 灰区协议');
  console.log(`  PvP server running at http://localhost:${PORT}`);
  console.log('  快速匹配 / 私人房间 / 训练场已就绪');
  console.log('');
});
