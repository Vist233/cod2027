import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:2027/ws';
import { findPath } from '../shared/nav.js';
import { hasLineOfSight, distance } from '../shared/physics.js';

class Bot {
  constructor(name) {
    this.name = name;
    this.id = null;
    this.state = null;
    this.phase = '';
    this.ws = new WebSocket(WS_URL);
    this.path = null;
    this.pathIndex = 0;
    this.nextPath = 0;
    this.lastAim = 0;
    this.shots = 0;
    this.hits = 0;
    this.kills = 0;
    this.deaths = 0;
    this.ready = new Promise((resolve) => {
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ t: 'hello', name }));
        setTimeout(() => this.ws.send(JSON.stringify({ t: 'queue' })), 80);
        resolve();
      });
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.t === 'welcome') this.id = msg.id;
      if (msg.t === 'match') this.id = msg.you.id;
      if (msg.t === 'state') this.onState(msg);
      if (msg.t === 'pong') this.latency = performance.now() - msg.ts;
    });
    setInterval(() => this.tick(), 33);
  }

  onState(msg) {
    this.state = msg;
    if (msg.phase !== this.phase) {
      this.phase = msg.phase;
      console.log(`${this.name}: phase -> ${msg.phase}`);
    }
    for (const e of msg.events) {
      if (e.type === 'shot' && e.id === this.id) this.shots++;
      if (e.type === 'damage' && e.by === this.id) this.hits++;
      if (e.type === 'kill') {
        if (e.by === this.id) this.kills++;
        if (e.victim === this.id) this.deaths++;
        console.log(`KILL ${e.byName} -> ${e.victimName} (${e.weapon})`);
      }
    }
  }

  tick() {
    const s = this.state;
    if (!s || !this.ws || this.ws.readyState !== 1) return;
    const me = s.players.find((p) => p.id === this.id);
    const enemy = s.players.find((p) => p.id !== this.id);
    if (!me || !enemy) return;
    if (!me.alive || s.phase !== 'live') {
      this.ws.send(JSON.stringify({ t: 'input', mx: 0, my: 0, aim: me.a, shoot: false }));
      return;
    }
    const now = Date.now();
    const aim = Math.atan2(enemy.y - me.y, enemy.x - me.x);
    const dist = distance(me.x, me.y, enemy.x, enemy.y);
    const pitch = Math.atan2(110 - 165, Math.max(1, dist));
    const los = hasLineOfSight(me.x, me.y, enemy.x, enemy.y);
    let mx = 0;
    let my = 0;
    let shoot = false;

    if (los && dist < 650) {
      shoot = true;
      this.path = null;
      // Keep a little distance and strafe.
      if (dist < 180) {
        mx = -Math.cos(aim) * 0.8;
        my = -Math.sin(aim) * 0.8;
      }
      mx += -Math.sin(aim) * 0.4;
      my += Math.cos(aim) * 0.4;
    } else {
      if (!this.path || now > this.nextPath) {
        this.path = findPath(me.x, me.y, enemy.x, enemy.y);
        this.pathIndex = 0;
        this.nextPath = now + 900;
      }
      if (this.path?.length) {
        while (
          this.pathIndex < this.path.length &&
          distance(me.x, me.y, this.path[this.pathIndex].x, this.path[this.pathIndex].y) < 25
        ) {
          this.pathIndex++;
        }
        const p = this.path[this.pathIndex];
        if (p) {
          const dx = p.x - me.x;
          const dy = p.y - me.y;
          const l = Math.hypot(dx, dy) || 1;
          mx = dx / l;
          my = dy / l;
        }
      }
    }
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    this.ws.send(JSON.stringify({ t: 'input', mx, my, aim, pitch, ads: false, shoot }));
    if (now - this.lastAim > 2000) {
      this.lastAim = now;
      this.ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
    }
  }

  close() {
    this.ws.close();
  }
}

const a = new Bot('TEST-A');
const b = new Bot('TEST-B');
await Promise.all([a.ready, b.ready]);
await new Promise((r) => setTimeout(r, 38000));
console.log('RESULT', {
  a: { shots: a.shots, hits: a.hits, kills: a.kills, deaths: a.deaths, hp: a.state?.players.find((p) => p.id === a.id)?.hp },
  b: { shots: b.shots, hits: b.hits, kills: b.kills, deaths: b.deaths, hp: b.state?.players.find((p) => p.id === b.id)?.hp },
  phase: a.state?.phase,
  scores: a.state?.players.map((p) => `${p.name}:${p.score}`),
});
a.close();
b.close();
if (a.hits < 1 || b.hits < 1) {
  console.error('Combat did not register hits');
  process.exit(1);
}
if (a.kills + b.kills < 1) {
  console.error('No kills registered');
  process.exit(1);
}
process.exit(0);
