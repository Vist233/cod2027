import { PLAYER, MATCH, WEAPONS } from '/shared/game-config.js';
import { moveCircle, distance } from '/shared/physics.js';
import { Net } from './net.js';
import { Game3D } from './game3d.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const audio = new AudioEngine();
const game = new Game3D($('game'), $('minimap'));
const input = new Input({
  canvas: $('game'),
  onFirstInteract: () => audio.init(),
  onLockChange: (locked) => onLockChange(locked),
});

const app = {
  screen: 'menu',
  net: null,
  connecting: null,
  selfId: null,
  selfName: 'OPERATOR',
  mode: null,
  roomCode: null,
  match: null,
  opponent: null,
  state: null,
  pred: { x: 800, y: 500, alive: true, hp: 100, name: 'OPERATOR' },
  predInit: false,
  prevAlive: true,
  yaw: 0,
  pitch: 0,
  ads: false,
  locked: false,
  fallbackInput: false,
  lastSend: 0,
  lastShot: 0,
  lastEmpty: 0,
  lastStep: 0,
  lastPing: 0,
  ping: null,
  searching: false,
  queueStart: 0,
  paused: true,
  resultShown: false,
  resultTimer: null,
  lastKiller: '',
  lastCountdown: null,
  lastHud: 0,
  lastFrame: performance.now(),
  session: { shots: 0, hits: 0, kills: 0, deaths: 0, start: 0, damage: 0 },
};

let toastTimer = null;
let centerTimer = null;
let hitTimer = null;
let flashTimer = null;

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

function toast(text, isError = false, duration = 2800) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function centerToast(text, duration = 1600) {
  const el = $('centerToast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(centerTimer);
  centerTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function getCallsign() {
  const value = $('callsign').value.trim().slice(0, 14);
  return value || 'OPERATOR';
}

function clearCombatUi() {
  $('killfeed').replaceChildren();
  $('damageDirs').replaceChildren();
  $('crosshair3d').className = 'crosshair3d off';
  $('deathOverlay').classList.remove('show');
  $('countdown').classList.remove('show');
  $('hitmarker').className = 'hitmarker';
  $('pauseOverlay').classList.add('is-hidden');
}

function openMenu() {
  input.exitLock();
  input.setFallback(false);
  $('menu').classList.remove('is-hidden');
  $('lobby').classList.add('is-hidden');
  $('result').classList.add('is-hidden');
  $('hud').classList.add('is-hidden');
  $('searching').classList.add('is-hidden');
  $('netError').classList.add('is-hidden');
  app.screen = 'menu';
  app.searching = false;
  app.paused = true;
  app.state = null;
  app.match = null;
  app.resultShown = false;
  app.predInit = false;
  app.locked = false;
  app.lastCountdown = null;
  app.selfName = getCallsign();
  input.setEnabled(false);
  game.reset();
  clearCombatUi();
  document.title = 'COD 2027 // 灰区协议';
}

function resetMatchState() {
  clearTimeout(app.resultTimer);
  app.resultTimer = null;
  app.state = null;
  app.predInit = false;
  app.prevAlive = true;
  app.resultShown = false;
  app.paused = true;
  app.lastKiller = '';
  app.lastCountdown = null;
  app.lastShot = 0;
  app.yaw = 0;
  app.pitch = 0;
  app.ads = false;
  app.session = { shots: 0, hits: 0, kills: 0, deaths: 0, start: performance.now(), damage: 0 };
  game.reset();
  clearCombatUi();
  $('result').classList.add('is-hidden');
  $('rematchBtn').disabled = false;
  $('rematchBtn').textContent = '再来一局';
  $('rematchStatus').textContent = '';
}

function showLockPrompt(first = false) {
  app.paused = true;
  input.setEnabled(false);
  $('pauseTitle').textContent = first ? '部署完成' : '行动暂停';
  $('pauseDesc').textContent = first
    ? '点击进入战场并锁定鼠标。WASD 移动，鼠标瞄准，左键射击，右键机瞄，Shift 冲刺。'
    : '鼠标已释放。在线对战仍在继续，点击返回战场。';
  $('resumeBtn').textContent = first ? '进入战场' : '返回战场';
  $('pauseOverlay').classList.remove('is-hidden');
  $('crosshair3d').classList.add('off');
}

function requestLock() {
  audio.init();
  input.requestLock();
  setTimeout(() => {
    if (app.screen === 'match' && !input.locked && !app.fallbackInput) {
      toast('未获得鼠标锁定 · 再次点击“进入战场”', true, 2200);
    }
  }, 800);
}

function enterFallbackInput() {
  if (app.screen !== 'match') return;
  app.fallbackInput = true;
  input.setFallback(true);
  app.paused = false;
  input.setEnabled(true);
  $('pauseOverlay').classList.add('is-hidden');
  $('crosshair3d').classList.remove('off');
  toast('指针锁定不可用 · 使用方向键转向', false, 3000);
}

function onLockChange(locked) {
  app.locked = locked;
  if (app.screen !== 'match') {
    if (locked) input.exitLock();
    return;
  }
  if (locked) {
    app.fallbackInput = false;
    input.setFallback(false);
    app.paused = false;
    input.setEnabled(true);
    $('pauseOverlay').classList.add('is-hidden');
    $('crosshair3d').classList.remove('off');
  } else {
    input.setEnabled(false);
    showLockPrompt(false);
  }
}

function enterMatch(msg) {
  app.match = msg;
  app.mode = msg.mode;
  app.roomCode = msg.code;
  app.opponent = msg.opponent;
  app.selfId = msg.you.id;
  app.selfName = msg.you.name;
  resetMatchState();
  $('hudSelfName').textContent = app.selfName;
  $('hudEnemyName').textContent = msg.opponent?.name || 'VIPER-09';
  $('hudSelfTag').textContent = `${app.selfName} // 蓝队`;
  $('resultCode').textContent = `ROOM // ${msg.code || '----'} · ${msg.mode.toUpperCase()}`;
  $('menu').classList.add('is-hidden');
  $('lobby').classList.add('is-hidden');
  $('result').classList.add('is-hidden');
  $('hud').classList.remove('is-hidden');
  $('searching').classList.add('is-hidden');
  app.screen = 'match';
  app.searching = false;
  app.fallbackInput = false;
  input.setFallback(false);
  showLockPrompt(true);
  const fade = $('screenFade');
  fade.classList.add('on');
  requestAnimationFrame(() => setTimeout(() => fade.classList.remove('on'), 40));
  document.title = '作战中 // COD 2027';
  audio.init();
  audio.start();
  toast(msg.mode === 'practice' ? '训练场已部署 · 击倒 VIPER-09' : '对手已接入 · 点击进入战场', false, 2600);
}

function showLobby(msg) {
  app.roomCode = msg.code;
  app.screen = 'lobby';
  app.paused = true;
  input.setEnabled(false);
  $('lobbyCode').textContent = msg.code;
  $('menu').classList.add('is-hidden');
  $('lobby').classList.remove('is-hidden');
  $('hud').classList.add('is-hidden');
  $('searching').classList.add('is-hidden');
  app.selfName = getCallsign();
  const players = msg.players || [];
  $('lobbyHostName').textContent = players[0]?.name || app.selfName;
  const guest = $('lobbyGuestSlot');
  if (players[1]) {
    guest.classList.remove('waiting');
    guest.querySelector('.slot-avatar').textContent = '◈';
    guest.querySelector('.slot-info strong').textContent = players[1].name;
    guest.querySelector('.slot-info span').textContent = '挑战者 · 已接入';
    guest.querySelector('.ready-pill').textContent = 'READY';
    guest.querySelector('.ready-pill').classList.remove('dim');
    $('lobbyStatus').textContent = '双方已就位，正在部署…';
  } else {
    guest.classList.add('waiting');
    guest.querySelector('.slot-avatar').textContent = '?';
    guest.querySelector('.slot-info strong').textContent = '等待挑战者';
    guest.querySelector('.slot-info span').textContent = '分享房间码以邀请';
    guest.querySelector('.ready-pill').textContent = 'STANDBY';
    guest.querySelector('.ready-pill').classList.add('dim');
    $('lobbyStatus').textContent = '正在等待对手接入…';
  }
}

function showSearching(on) {
  app.searching = on;
  $('searching').classList.toggle('is-hidden', !on);
  if (on) {
    app.queueStart = performance.now();
    $('queueTime').textContent = '00:00';
    $('netError').classList.add('is-hidden');
  }
}

function showNetError(message) {
  showSearching(false);
  $('netErrorMsg').textContent = message || '请确认服务器已启动，然后重试。';
  $('netError').classList.remove('is-hidden');
}

/* ------------------------------------------------------------------ */
/* Networking                                                          */
/* ------------------------------------------------------------------ */

function sayHello() {
  app.selfName = getCallsign();
  app.net?.send({ t: 'hello', name: app.selfName });
}

function setupNet() {
  if (app.net) return;
  const net = new Net();
  app.net = net;

  net.on('welcome', (msg) => {
    app.selfId = msg.id;
    if (msg.name && msg.name !== 'OPERATOR') app.selfName = msg.name;
    $('hudSelfName').textContent = app.selfName;
    $('hudSelfTag').textContent = `${app.selfName} // 蓝队`;
  });
  net.on('queued', () => showSearching(true));
  net.on('queue_cancelled', () => showSearching(false));
  net.on('room_created', (msg) => showLobby(msg));
  net.on('room_joined', (msg) => showLobby(msg));
  net.on('room', (msg) => {
    if (app.screen === 'lobby') showLobby(msg);
  });
  net.on('match', (msg) => enterMatch(msg));
  net.on('state', (msg) => onState(msg));
  net.on('pong', (msg) => {
    app.ping = Math.max(0, Math.round(performance.now() - msg.ts));
  });
  net.on('rematch_update', (msg) => {
    if (app.screen !== 'result') return;
    const votes = msg.votes || [];
    const opponentReady = votes.some((id) => id !== app.selfId);
    const selfReady = votes.includes(app.selfId);
    if (opponentReady && !selfReady) {
      $('rematchStatus').textContent = '对手已准备 · 等待你确认再战';
      $('rematchBtn').textContent = '接受再战';
    } else if (opponentReady && selfReady) {
      $('rematchStatus').textContent = '双方已确认 · 正在重新部署…';
    } else {
      $('rematchStatus').textContent = '已提交请求 · 等待对手确认…';
    }
  });
  net.on('opponent_left', (msg) => {
    if (app.screen === 'result') {
      $('rematchStatus').textContent = '对手已离开，无法重新部署';
      $('rematchBtn').disabled = true;
      toast(msg.message || '对手已撤离', true);
      return;
    }
    toast(msg.message || '对手已撤离', true);
    centerToast('对手已撤离战场');
    setTimeout(() => {
      if (app.screen === 'match' || app.screen === 'lobby') openMenu();
    }, 1800);
  });
  net.on('error', (msg) => {
    showSearching(false);
    const text = msg.message || '操作失败';
    if (app.screen === 'menu') {
      $('joinError').textContent = text;
      if ($('joinBox').classList.contains('is-hidden')) toast(text, true);
    } else if (app.screen === 'lobby') {
      $('lobbyStatus').textContent = text;
      toast(text, true);
    } else {
      toast(text, true);
    }
  });
  net.on('left', () => {
    if (app.screen !== 'menu') openMenu();
  });
  net.onClose(() => {
    showSearching(false);
    if (app.screen === 'match' || app.screen === 'result') {
      toast('与行动服务器断开连接', true, 3400);
      openMenu();
      showNetError('连接已断开，请重新连接行动服务器。');
    }
  });
}

async function connect() {
  setupNet();
  if (app.net.connected) {
    sayHello();
    return true;
  }
  if (app.connecting) return app.connecting;
  app.connecting = (async () => {
    try {
      await app.net.connect();
      $('netError').classList.add('is-hidden');
      sayHello();
      return true;
    } catch (err) {
      showNetError(err.message || '无法连接行动服务器');
      return false;
    } finally {
      app.connecting = null;
    }
  })();
  return app.connecting;
}

/* ------------------------------------------------------------------ */
/* State events                                                        */
/* ------------------------------------------------------------------ */

function onState(msg) {
  if (!app.match) return;
  const prevPhase = app.state?.phase;
  app.state = msg;
  const self = msg.players.find((p) => p.id === app.selfId);
  if (!self) return;

  for (const e of msg.events || []) handleEvent(e);

  if (!app.predInit) {
    app.pred.x = self.x;
    app.pred.y = self.y;
    app.predInit = true;
    app.prevAlive = self.alive;
    app.yaw = self.a;
    app.pitch = self.pitch || 0;
  } else {
    const spawned = self.alive && !app.prevAlive;
    const err = Math.hypot(self.x - app.pred.x, self.y - app.pred.y);
    if (!self.alive || spawned || err > 190) {
      app.pred.x = self.x;
      app.pred.y = self.y;
      if (spawned) {
        app.yaw = self.a;
        app.pitch = 0;
      }
    } else if (msg.phase === 'live' && self.alive) {
      const k = Math.min(0.3, 0.12 + err * 0.001);
      app.pred.x += (self.x - app.pred.x) * k;
      app.pred.y += (self.y - app.pred.y) * k;
    }
    app.prevAlive = self.alive;
  }
  app.pred.alive = self.alive;
  app.pred.hp = self.hp;
  app.pred.name = self.name;
  if (prevPhase !== 'live' && msg.phase === 'live') audio.start();

  if (msg.phase === 'ended' && !app.resultShown && !app.resultTimer) {
    input.setEnabled(false);
    app.resultTimer = setTimeout(() => {
      app.resultTimer = null;
      showResult();
    }, 650);
  }
}

function handleEvent(e) {
  if (!e || !e.type) return;
  const selfPlayer = app.state?.players.find((p) => p.id === app.selfId);
  switch (e.type) {
    case 'shot': {
      const weapon = WEAPONS[e.weapon] || WEAPONS.ar;
      const isSelf = e.id === app.selfId;
      game.addShotEvent(e, app.selfId);
      const d = selfPlayer
        ? Math.hypot(selfPlayer.x - e.x1, selfPlayer.y - e.z1)
        : 900;
      const vol = isSelf ? 1 : clamp(1 - d / 1500, 0, 1) * 0.65;
      audio.shot(e.weapon, vol);
      if (isSelf) {
        app.session.shots++;
        app.lastShot = performance.now();
      }
      break;
    }
    case 'damage': {
      if (e.by === app.selfId) {
        app.session.hits++;
        app.session.damage += e.amount;
        showHitmarker(e.hp <= 0, e.headshot);
        audio.hit(e.hp <= 0);
      }
      if (e.target === app.selfId) {
        audio.hurt();
        game.addShake(e.headshot ? 8 : 5);
        flashDamage();
        addDamageDir(e);
      }
      break;
    }
    case 'kill': {
      addKillfeed(e);
      if (e.by === app.selfId) {
        game.addKill(e.x, e.y, '#5ce9ff');
        audio.hit(true);
        centerToast(e.headshot ? 'HEADSHOT ELIMINATED  +1' : 'ELIMINATED  +1', 1200);
        app.session.kills++;
      } else if (e.victim === app.selfId) {
        app.lastKiller = e.byName || 'UNKNOWN';
        game.addKill(e.x, e.y, '#ff6252');
        audio.death();
        game.addShake(10);
      } else {
        game.addKill(e.x, e.y, '#ff6252');
      }
      break;
    }
    case 'pickup': {
      game.addPickup(e.x, e.y);
      if (e.id === app.selfId) {
        audio.pickup();
        centerToast(`医疗包 +${e.amount || 45}`, 1000);
      }
      break;
    }
    case 'spawn': {
      const color = e.id === app.selfId ? '#5ce9ff' : '#ff6252';
      game.addSpawn(e.x, e.y, color);
      if (e.id === app.selfId) {
        app.pred.x = e.x;
        app.pred.y = e.y;
        app.pred.alive = true;
        audio.spawn();
      }
      break;
    }
    case 'dash': {
      game.addDash(e.x, e.y, e.a);
      if (e.id === app.selfId) {
        audio.dash();
        game.addShake(2.2);
      } else {
        const d = selfPlayer ? Math.hypot(selfPlayer.x - e.x, selfPlayer.y - e.y) : 900;
        if (d < 600) audio.dash();
      }
      break;
    }
    case 'reload':
      if (e.id === app.selfId) audio.reloadStart();
      break;
    case 'reloaded':
      if (e.id === app.selfId) audio.reloadDone();
      break;
    default:
      break;
  }
}

function showHitmarker(kill = false, headshot = false) {
  const el = $('hitmarker');
  el.className = kill ? 'hitmarker show kill' : 'hitmarker show';
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => {
    el.className = 'hitmarker';
  }, kill || headshot ? 220 : 110);
}

function flashDamage() {
  const el = $('damageFlash');
  el.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('on'), 160);
}

function addDamageDir(e) {
  const angle = Math.atan2(e.az - app.pred.y, e.ax - app.pred.x);
  const rel = angle - app.yaw;
  const dir = document.createElement('div');
  dir.className = 'dmg-dir';
  dir.style.transform = `rotate(${rel}rad)`;
  dir.style.transition = 'opacity 0.3s';
  const i = document.createElement('i');
  dir.appendChild(i);
  $('damageDirs').appendChild(dir);
  setTimeout(() => {
    dir.style.opacity = '0';
    setTimeout(() => dir.remove(), 320);
  }, 750);
}

function addKillfeed(e) {
  const feed = $('killfeed');
  const row = document.createElement('div');
  row.className = 'kill-entry' + (e.victim === app.selfId ? ' enemy' : '');
  const by = document.createElement('span');
  by.className = 'feed-by';
  by.textContent = e.by === app.selfId ? '你' : e.byName;
  const weapon = document.createElement('span');
  weapon.className = 'feed-weapon';
  weapon.textContent = `${WEAPONS[e.weapon]?.short || e.weapon}${e.headshot ? ' HS' : ''}`;
  const victim = document.createElement('span');
  victim.className = 'feed-victim';
  victim.textContent = e.victim === app.selfId ? '你' : e.victimName;
  const tag = document.createElement('span');
  tag.className = 'feed-weapon';
  tag.textContent = 'ELIM';
  row.append(by, weapon, victim, tag);
  feed.prepend(row);
  while (feed.children.length > 4) feed.lastElementChild.remove();
  setTimeout(() => {
    row.classList.add('fade');
    setTimeout(() => row.remove(), 400);
  }, 5200);
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0.001, (now - app.lastFrame) / 1000));
  app.lastFrame = now;

  if (app.screen !== 'match' && app.screen !== 'result') {
    if (app.searching) {
      const s = Math.floor((now - app.queueStart) / 1000);
      $('queueTime').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    }
    return;
  }
  if (!app.state) return;

  const selfState = app.state.players.find((p) => p.id === app.selfId);
  const active =
    app.screen === 'match' &&
    !app.paused &&
    !!selfState?.alive &&
    app.state.phase === 'live' &&
    (app.locked || app.fallbackInput);

  const look = input.consumeLook();
  if (active && app.locked) {
    const sens = 0.00225 * (app.ads ? 0.68 : 1);
    app.yaw += look.x * sens;
    app.pitch -= look.y * sens * (app.fallbackInput ? 1.4 : 1);
  }
  if (active) {
    const k = input.keys;
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    const tilt = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    app.yaw += turn * 2.1 * dt;
    app.pitch += tilt * 1.35 * dt;
  }
  app.yaw = Math.atan2(Math.sin(app.yaw), Math.cos(app.yaw));
  app.pitch = clamp(app.pitch, -1.3, 1.3);
  app.ads = active && input.mouse.right;

  let mx = 0;
  let my = 0;
  let strafe = 0;
  if (active) {
    const keys = input.getMove();
    strafe = keys.strafe;
    const cos = Math.cos(app.yaw);
    const sin = Math.sin(app.yaw);
    mx = cos * keys.forward - sin * keys.strafe;
    my = sin * keys.forward + cos * keys.strafe;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const speed =
      PLAYER.speed *
      (selfState.reloading ? 0.86 : 1) *
      (app.ads ? 0.62 : 1);
    if (now < app.pred.dashUntil) {
      const moved = moveCircle(app.pred.x, app.pred.y, app.pred.dashVx * dt, app.pred.dashVy * dt, PLAYER.radius);
      app.pred.x = moved.x;
      app.pred.y = moved.y;
    } else if (mx || my) {
      const moved = moveCircle(app.pred.x, app.pred.y, mx * speed * dt, my * speed * dt, PLAYER.radius);
      app.pred.x = moved.x;
      app.pred.y = moved.y;
    }
  }

  if (app.screen === 'match') {
    for (const action of input.consumeActions()) handleAction(action, selfState, mx, my);
  }

  if (app.screen === 'match' && app.net?.connected) {
    if (now - app.lastSend > 33) {
      app.lastSend = now;
      app.net.send({
        t: 'input',
        mx: active ? mx : 0,
        my: active ? my : 0,
        aim: app.yaw,
        pitch: app.pitch,
        ads: app.ads,
        shoot: active && input.mouse.left,
      });
    }
    if (now - app.lastPing > 2000) {
      app.lastPing = now;
      app.net.send({ t: 'ping', ts: performance.now() });
    }
    if (selfState && selfState.ammo === 0 && input.mouse.left && !selfState.reloading && active && now - app.lastEmpty > 650) {
      app.lastEmpty = now;
      audio.empty();
    }
    if (active && (Math.abs(mx) + Math.abs(my) > 0.1) && now - app.lastStep > (app.ads ? 480 : 360)) {
      app.lastStep = now;
      audio.step();
    }
  }

  const selfView = {
    id: app.selfId,
    name: selfState?.name || app.selfName,
    x: app.pred.x,
    z: app.pred.y,
    yaw: app.yaw,
    pitch: app.pitch,
    alive: selfState ? selfState.alive : true,
    hp: selfState?.hp ?? 100,
    weapon: selfState?.weapon || 'ar',
    ads: app.ads,
    reloading: selfState?.reloading || false,
    reloadPct: selfState?.reloadPct || 0,
  };

  const view = {
    players: app.state.players,
    selfId: app.selfId,
    self: selfView,
    phase: app.state.phase,
    pickups: app.state.pickups,
    moving: active && (Math.abs(mx) + Math.abs(my) > 0.1),
    strafe: active ? strafe : 0,
  };

  game.render(view, dt);

  const weapon = WEAPONS[selfView.weapon] || WEAPONS.ar;
  const ch = $('crosshair3d');
  const showCross = app.screen === 'match' && !app.paused && selfView.alive;
  ch.classList.toggle('off', !showCross);
  ch.classList.toggle('ads', app.ads);
  ch.classList.toggle('hot', showCross && active && game.isAimingAtEnemy(view));
  const gap = (weapon.id === 'sg' ? 13 : 8) + (view.moving ? 3 : 0) - (app.ads ? 3 : 0);
  ch.style.setProperty('--gap', `${Math.max(3, gap)}px`);

  if (now - app.lastHud > 55) {
    app.lastHud = now;
    updateHud(now);
  }
}

function handleAction(action, selfState, mx, my) {
  if (!app.net?.connected) return;
  if (action.a === 'weapon') input.setLastWeapon(action.v);
  if (action.a === 'dash') {
    if (selfState?.alive && app.state.phase === 'live' && (selfState.dashCd ?? 0) < 40) {
      let dx = mx;
      let dy = my;
      if (Math.hypot(dx, dy) < 0.2) {
        dx = Math.cos(app.yaw);
        dy = Math.sin(app.yaw);
      }
      const len = Math.hypot(dx, dy) || 1;
      app.pred.dashVx = (dx / len) * PLAYER.dashSpeed;
      app.pred.dashVy = (dy / len) * PLAYER.dashSpeed;
      app.pred.dashUntil = performance.now() + PLAYER.dashTime * 1000;
      game.addDash(app.pred.x, app.pred.y, Math.atan2(dy, dx));
      game.addShake(2);
      audio.dash();
    }
  }
  app.net.send({ t: 'action', a: action.a, v: action.v });
}

function updateHud(now) {
  const s = app.state;
  if (!s) return;
  const self = s.players.find((p) => p.id === app.selfId);
  const enemy = s.players.find((p) => p.id !== app.selfId);
  if (!self) return;

  $('hudSelfScore').textContent = self.score;
  $('hudEnemyScore').textContent = enemy?.score ?? 0;
  $('hudEnemyName').textContent = enemy?.name || 'VIPER-09';

  const time = Math.max(0, Math.ceil(s.timeLeft));
  const mm = String(Math.floor(time / 60)).padStart(2, '0');
  const ss = String(time % 60).padStart(2, '0');
  $('matchTimer').textContent = `${mm}:${ss}`;
  $('matchTimer').classList.toggle('low', s.timeLeft <= 30 && s.phase === 'live');
  $('matchState').textContent =
    app.paused && s.phase === 'live'
      ? '行动暂停'
      : s.phase === 'countdown'
        ? '战术部署'
        : s.phase === 'ended'
          ? '行动结束'
          : '行动进行中';

  const hp = clamp(self.hp, 0, 100);
  $('hpValue').textContent = Math.round(hp);
  $('healthFill').style.width = `${hp}%`;
  $('healthFill').classList.toggle('low', hp <= 30);
  $('dashFill').style.width = `${clamp(1 - (self.dashCd ?? 0) / (PLAYER.dashCooldown * 1000), 0, 1) * 100}%`;

  const weapon = WEAPONS[self.weapon] || WEAPONS.ar;
  $('weaponName').textContent = weapon.name;
  $('ammoValue').textContent = self.ammo;
  $('ammoValue').classList.toggle('low', self.ammo <= Math.ceil(weapon.mag * 0.2));
  $('reloadFill').style.width = `${(self.reloadPct || 0) * 100}%`;
  $('reloadHint').textContent = self.reloading ? '装填中' : self.ammo === 0 ? '需要换弹' : '就绪';
  $('slotAr').classList.toggle('active', self.weapon === 'ar');
  $('slotSg').classList.toggle('active', self.weapon === 'sg');
  $('pingValue').textContent = app.ping === null ? '-- MS' : `${app.ping} MS`;

  const showDeath = !self.alive && s.phase !== 'ended';
  $('deathOverlay').classList.toggle('show', showDeath);
  if (showDeath) {
    $('deathKiller').textContent = app.lastKiller || 'UNKNOWN';
    $('respawnValue').textContent = (Math.max(0, self.respawnIn) / 1000).toFixed(1);
  }

  const showCountdown = s.phase === 'countdown' && !app.paused;
  $('countdown').classList.toggle('show', showCountdown);
  if (showCountdown) {
    $('countdownValue').textContent = Math.max(1, s.countdown);
    $('countdownKicker').textContent = '战术部署';
    $('countdownSub').textContent = '保持警戒';
    if (app.lastCountdown !== s.countdown) {
      app.lastCountdown = s.countdown;
      audio.countdown(s.countdown === 1);
    }
  } else {
    app.lastCountdown = null;
  }

  $('hudSelfTag').textContent = `${self.name} // 蓝队`;
  if (s.phase === 'ended' && app.screen === 'match' && !app.resultShown && !app.resultTimer) {
    app.resultTimer = setTimeout(() => {
      app.resultTimer = null;
      showResult();
    }, 650);
  }
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

function showResult() {
  if (app.resultShown || !app.state) return;
  const s = app.state;
  const self = s.players.find((p) => p.id === app.selfId);
  const enemy = s.players.find((p) => p.id !== app.selfId);
  if (!self) return;
  app.resultShown = true;
  app.screen = 'result';
  app.paused = true;
  input.setEnabled(false);
  input.exitLock();
  $('crosshair3d').classList.add('off');
  $('rematchBtn').disabled = false;
  $('rematchBtn').textContent = '再来一局';
  $('rematchStatus').textContent = '';
  $('pauseOverlay').classList.add('is-hidden');

  const win = s.winner === app.selfId;
  const draw = !s.winner;
  $('resultTitle').textContent = draw ? '行动结束' : win ? '任务完成' : '行动失败';
  $('resultTitle').className = draw ? '' : win ? 'win' : 'lose';
  $('resultSub').textContent = draw
    ? '时间耗尽，双方均未达成击杀目标。'
    : win
      ? '你压制了敌方单位，灰区暂时安静。'
      : `${enemy?.name || '敌方单位'} 控制了炼狱码头。`;
  $('resultSelfScore').textContent = self.score;
  $('resultEnemyScore').textContent = enemy?.score ?? 0;
  $('resultSelfName').textContent = self.name;
  $('resultEnemyName').textContent = enemy?.name || 'VIPER-09';
  $('statKills').textContent = self.kills;
  $('statDeaths').textContent = self.deaths;
  const acc = app.session.shots > 0 ? `${Math.min(999, Math.round((app.session.hits / app.session.shots) * 100))}%` : '--';
  $('statAcc').textContent = acc;
  const used = Math.max(0, MATCH.duration - s.timeLeft);
  $('statTime').textContent = `${String(Math.floor(used / 60)).padStart(2, '0')}:${String(Math.floor(used % 60)).padStart(2, '0')}`;
  $('resultCode').textContent = `ROOM // ${app.roomCode || '----'} · ${(app.mode || 'pvp').toUpperCase()}`;
  $('result').classList.remove('is-hidden');
  $('hud').classList.remove('is-hidden');
  if (win) audio.win();
  else audio.lose();
}

function leaveToMenu() {
  if (app.net?.connected) app.net.send({ t: 'leave' });
  openMenu();
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

$('quickMatchBtn').addEventListener('click', async () => {
  audio.init();
  audio.ui();
  showSearching(true);
  if (!(await connect())) {
    showSearching(false);
    return;
  }
  app.net.send({ t: 'queue' });
});

$('cancelSearchBtn').addEventListener('click', () => {
  audio.ui();
  app.net?.send({ t: 'cancel_queue' });
  showSearching(false);
});

$('createRoomBtn').addEventListener('click', async () => {
  audio.init();
  audio.ui();
  $('joinBox').classList.add('is-hidden');
  if (!(await connect())) return;
  app.net.send({ t: 'create_room' });
});

$('joinRoomBtn').addEventListener('click', () => {
  audio.init();
  audio.ui();
  $('joinBox').classList.toggle('is-hidden');
  $('joinError').textContent = '';
  if (!$('joinBox').classList.contains('is-hidden')) {
    setTimeout(() => $('roomCodeInput').focus(), 30);
  }
});

$('closeJoinBtn').addEventListener('click', () => {
  $('joinBox').classList.add('is-hidden');
  $('joinError').textContent = '';
});

$('joinConfirmBtn').addEventListener('click', async () => {
  audio.init();
  audio.ui();
  const code = $('roomCodeInput').value.trim().toUpperCase();
  if (code.length < 4) {
    $('joinError').textContent = '请输入完整的 4 位房间码';
    return;
  }
  if (!(await connect())) return;
  $('joinError').textContent = '正在接入加密频道…';
  app.net.send({ t: 'join_room', code });
});

$('roomCodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('joinConfirmBtn').click();
  e.stopPropagation();
});
$('roomCodeInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

$('practiceBtn').addEventListener('click', async () => {
  audio.init();
  audio.ui();
  $('joinBox').classList.add('is-hidden');
  if (!(await connect())) return;
  app.net.send({ t: 'practice' });
});

$('storyBtn').addEventListener('click', () => {
  audio.init();
  audio.ui();
  toast('剧情战役「灰区协议」正在制作中 · 当前版本为 3D PvP 竞技场', false, 3600);
});

$('soundToggle').addEventListener('click', () => {
  audio.init();
  const on = audio.toggle();
  $('soundIcon').textContent = on ? '◖))' : '◖×';
  toast(on ? '音频已开启' : '音频已静音', false, 1200);
});

$('retryConnectBtn').addEventListener('click', async () => {
  $('netError').classList.add('is-hidden');
  await connect();
});

$('resumeBtn').addEventListener('click', () => {
  audio.init();
  audio.ui();
  if (app.screen === 'match') requestLock();
});
$('surrenderBtn').addEventListener('click', () => leaveToMenu());
$('backMenuBtn').addEventListener('click', () => leaveToMenu());
$('lobbyLeaveBtn').addEventListener('click', () => leaveToMenu());
$('rematchBtn').addEventListener('click', () => {
  audio.ui();
  app.net?.send({ t: 'rematch' });
  $('rematchBtn').textContent = '等待重新部署';
  $('rematchStatus').textContent = '已提交请求 · 等待对手确认…';
});

$('copyCodeBtn').addEventListener('click', async () => {
  const code = $('lobbyCode').textContent;
  try {
    await navigator.clipboard.writeText(code);
    toast(`房间码 ${code} 已复制`);
  } catch {
    toast(`房间码：${code}`, false, 4000);
  }
});

$('callsign').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[<>&"'`\\]/g, '').slice(0, 14);
  localStorage.setItem('cod2027_callsign', e.target.value);
  app.selfName = getCallsign();
  $('hudSelfName').textContent = app.selfName;
  $('hudSelfTag').textContent = `${app.selfName} // 蓝队`;
  if (app.net?.connected && app.screen === 'menu') {
    app.net.send({ t: 'hello', name: app.selfName });
  }
});
$('callsign').addEventListener('blur', (e) => {
  if (!e.target.value.trim()) {
    e.target.value = 'OPERATOR';
    localStorage.setItem('cod2027_callsign', 'OPERATOR');
    app.selfName = 'OPERATOR';
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest?.('.btn, .icon-btn')) audio.ui();
});

document.addEventListener('pointerlockerror', () => {
  if (app.screen === 'match') enterFallbackInput();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && app.screen === 'menu') {
    $('joinBox').classList.add('is-hidden');
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const saved = localStorage.getItem('cod2027_callsign');
if (saved) $('callsign').value = saved;
app.selfName = getCallsign();
$('hudSelfName').textContent = app.selfName;
$('soundIcon').textContent = audio.enabled ? '◖))' : '◖×';
if (new URLSearchParams(location.search).has('debug')) {
  window.__COD__ = { app, game, input };
}
openMenu();
requestAnimationFrame(loop);
