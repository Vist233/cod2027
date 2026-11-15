import * as THREE from '/vendor/three.module.js';
import { WORLD, WALLS, PLAYER, WEAPONS } from '/shared/game-config.js';
import { hasLineOfSight, distance } from '/shared/physics.js';
import { castShot, hasLineOfSight3D } from '/shared/raycast3d.js';
import {
  buildArena,
  updateArena,
  createSoldier,
  updateSoldier,
  createWeaponModel,
  makeFlashTexture,
  makeParticleTexture,
  makeTextSprite,
} from './world3d.js';

const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function enemyTagVisible(self, enemy) {
  const d = Math.hypot(enemy.x - self.x, enemy.y - self.y);
  if (d > 1000) return false;
  if (d < 230) return true;
  const offsets = [0, -PLAYER.radius * 0.8, PLAYER.radius * 0.8];
  const heights = [PLAYER.height * 0.9, PLAYER.eye, PLAYER.height * 0.55];
  for (const y of heights) {
    for (const ox of offsets) {
      if (hasLineOfSight3D(self.x, self.y, enemy.x + ox, enemy.y, PLAYER.eye, y)) return true;
    }
  }
  return false;
}

export class Game3D {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.mm = minimap;
    this.mctx = minimap.getContext('2d');
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = Math.min(1.75, window.devicePixelRatio || 1);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020609);
    this.scene.fog = new THREE.Fog(0x03080c, 700, 3000);

    this.camera = new THREE.PerspectiveCamera(78, this.w / this.h, 1, 5000);
    this.camera.rotation.order = 'YXZ';

    this.arena = buildArena(this.scene);
    this.enemyModels = new Map();
    this.visible = new Set();
    this.lastSeen = new Map();
    this.time = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.adsT = 0;
    this.recoil = 0;
    this.shake = 0;
    this.flashTime = 0;
    this.currentWeapon = 'ar';
    this.remote = new Map();
    this.view = null;

    this.createParticles();
    this.createEffects();
    this.createViewmodel();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  createParticles() {
    this.maxParticles = 700;
    this.particles = [];
    const geo = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleColors = new Float32Array(this.maxParticles * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 4.5,
      map: makeParticleTexture(),
      alphaTest: 0.01,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particlePoints = new THREE.Points(geo, mat);
    this.particlePoints.frustumCulled = false;
    this.scene.add(this.particlePoints);
    this.particleGeo = geo;
  }

  createViewmodel() {
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(80, this.w / this.h, 0.01, 20);
    const ambient = new THREE.AmbientLight(0xb9dce6, 0.5);
    this.viewScene.add(ambient);
    const key = new THREE.DirectionalLight(0xdff7ff, 1.3);
    key.position.set(1.5, 2, 1);
    this.viewScene.add(key);
    const rim = new THREE.PointLight(0x5ce9ff, 3, 3, 1.6);
    rim.position.set(-1, 0.5, 0.4);
    this.viewScene.add(rim);
    this.viewLight = new THREE.PointLight(0xfff0c0, 0, 3, 1.5);
    this.viewScene.add(this.viewLight);

    this.weaponGroups = {};
    for (const kind of ['ar', 'sg']) {
      const group = createWeaponModel(kind);
      group.visible = kind === 'ar';
      group.userData.base = new THREE.Vector3(0.38, -0.36, -0.95);
      group.position.copy(group.userData.base);
      group.rotation.y = 0.06;
      group.scale.setScalar(0.58);
      group.userData.flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.flashTexture,
        color: kind === 'sg' ? 0xffcf8a : 0x9ff4ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }));
      group.userData.flash.scale.set(0.42, 0.42, 1);
      group.userData.flash.position.copy(group.userData.muzzle);
      group.userData.flash.visible = false;
      this.viewScene.add(group.userData.flash);
      group.userData.flash.position.copy(group.userData.muzzle);
      // Flash is attached to the weapon so it follows recoil / ADS.
      group.add(group.userData.flash);
      this.weaponGroups[kind] = group;
      this.viewScene.add(group);
    }
  }

  createEffects() {
    this.flashTexture = makeFlashTexture();
    this.flashTexture.userData.shared = true;
    this.tracers = [];
    this.flashes = [];
    this.rings = [];
    this.texts = [];
  }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = Math.min(1.75, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = this.w / this.h;
    this.viewCamera.updateProjectionMatrix();
  }

  reset() {
    for (const e of [...this.tracers, ...this.flashes, ...this.rings, ...this.texts]) {
      this.removeEffect(e);
    }
    this.tracers = [];
    this.flashes = [];
    this.rings = [];
    this.texts = [];
    this.particles = [];
    this.particleGeo.setDrawRange(0, 0);
    this.remote.clear();
    this.visible.clear();
    this.lastSeen.clear();
    this.shake = 0;
    this.recoil = 0;
    this.bobPhase = 0;
    this.adsT = 0;
    this.flashTime = 0;
    for (const model of this.enemyModels.values()) model.visible = false;
  }

  addShake(amount) {
    this.shake = Math.min(24, this.shake + amount);
  }

  spawnParticles(x, y, z, color, count = 10, speed = 300, spread = 0.4) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const a = Math.random() * TAU;
      const p = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.25 + Math.random() * 0.85);
      this.particles.push({
        x, y, z,
        vx: Math.sin(p) * Math.cos(a) * s,
        vy: Math.abs(Math.cos(p)) * s * (0.4 + Math.random() * 0.6) + 40,
        vz: Math.sin(p) * Math.sin(a) * s,
        life: 0.25 + Math.random() * spread,
        max: 0.65,
        r: c.r,
        g: c.g,
        b: c.b,
      });
    }
  }

  addTracer(start, end, color, self) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 2) return;
    const geo = new THREE.CylinderGeometry(self ? 1.5 : 1.1, self ? 1.5 : 1.1, 1, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: self ? 0.95 : 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(start.x + dx / 2, start.y + dy / 2, start.z + dz / 2);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    mesh.quaternion.setFromUnitVectors(Y_AXIS, dir);
    mesh.scale.set(1, len, 1);
    this.scene.add(mesh);
    this.tracers.push({
      mesh,
      life: self ? 0.12 : 0.16,
      max: self ? 0.12 : 0.16,
    });
  }

  addFlash(x, y, z, color, scale = 0.8) {
    const mat = new THREE.SpriteMaterial({
      map: this.flashTexture,
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale, 1);
    this.scene.add(sprite);
    this.flashes.push({ mesh: sprite, life: 0.085, max: 0.085, scale });
  }

  addShotEvent(e, selfId) {
    const isSelf = e.id === selfId;
    const weapon = WEAPONS[e.weapon] || WEAPONS.ar;
    const start = new THREE.Vector3(e.x1, e.y1, e.z1);
    const end = new THREE.Vector3(e.x2, e.y2, e.z2);
    this.addTracer(start, end, weapon.tracer, isSelf);

    if (isSelf) {
      this.recoil = Math.min(1.6, this.recoil + (e.weapon === 'sg' ? 1.2 : 0.45));
      this.flashTime = 0.075;
      this.addShake(e.weapon === 'sg' ? 3.2 : 1.3);
    } else {
      this.addFlash(e.x1, e.y1, e.z1, e.weapon === 'sg' ? 0xffb454 : 0x9ff4ff, 0.7);
    }

    let color = '#8df3ff';
    if (e.surface === 'player') color = e.headshot ? '#ffd25e' : '#ff6252';
    else if (e.surface === 'floor') color = '#ffb454';
    else if (e.surface === 'wall') color = '#a8eaff';
    const self = this.view?.self;
    const nearSelf = e.surface === 'player' && self && distance(e.x2, e.z2, self.x, self.z) < 90;
    if (!nearSelf) {
      this.spawnParticles(e.x2, e.y2, e.z2, color, e.surface === 'player' ? 12 : 7, 240, 0.35);
      this.addFlash(e.x2, e.y2, e.z2, color, 0.55);
    }
  }

  addDamage(x, y, z, color = '#ff6252') {
    this.spawnParticles(x, y, z, color, 9, 190, 0.3);
  }

  addKill(x, z, color = '#ff6252') {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.22, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 2.5, z);
    ring.scale.set(10, 10, 1);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, life: 0.7, max: 0.7, from: 10, to: 100 });

    const text = makeTextSprite('ELIMINATED', color);
    text.position.set(x, 210, z);
    this.scene.add(text);
    this.texts.push({ sprite: text, life: 1.3, max: 1.3, vy: 42 });
    this.spawnParticles(x, 110, z, color, 24, 360, 0.55);
  }

  addPickup(x, z) {
    this.spawnParticles(x, 40, z, '#75f0b4', 16, 220, 0.4);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.18, 32),
      new THREE.MeshBasicMaterial({
        color: 0x75f0b4,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 3, z);
    ring.scale.set(8, 8, 1);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, life: 0.5, max: 0.5, from: 8, to: 52 });
  }

  addSpawn(x, z, color = '#5ce9ff') {
    this.spawnParticles(x, 90, z, color, 16, 220, 0.4);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.2, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 2.5, z);
    ring.scale.set(6, 6, 1);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, life: 0.55, max: 0.55, from: 6, to: 48 });
  }

  addDash(x, z, a) {
    for (let i = 0; i < 14; i++) {
      const ox = x - Math.cos(a) * (Math.random() * 30);
      const oz = z - Math.sin(a) * (Math.random() * 30);
      this.particles.push({
        x: ox,
        y: 8 + Math.random() * 40,
        z: oz,
        vx: -Math.cos(a) * (80 + Math.random() * 160),
        vy: 20 + Math.random() * 40,
        vz: -Math.sin(a) * (80 + Math.random() * 160),
        life: 0.25 + Math.random() * 0.2,
        max: 0.45,
        r: 0.35,
        g: 0.75,
        b: 0.85,
      });
    }
  }

  updateParticles(dt) {
    const positions = this.particlePositions;
    const colors = this.particleColors;
    let n = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 520 * dt;
      p.vx *= Math.exp(-dt * 2.4);
      p.vy *= Math.exp(-dt * 0.7);
      p.vz *= Math.exp(-dt * 2.4);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 1) {
        p.y = 1;
        p.vy *= -0.25;
        p.vx *= 0.65;
        p.vz *= 0.65;
      }
      const alpha = Math.min(1, p.life / p.max);
      positions[n * 3] = p.x;
      positions[n * 3 + 1] = p.y;
      positions[n * 3 + 2] = p.z;
      colors[n * 3] = p.r * alpha;
      colors[n * 3 + 1] = p.g * alpha;
      colors[n * 3 + 2] = p.b * alpha;
      n++;
    }
    this.particles = this.particles.filter((p) => p.life > 0).slice(0, this.maxParticles);
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.color.needsUpdate = true;
    this.particleGeo.setDrawRange(0, n);
  }

  removeEffect(e) {
    const obj = e.mesh || e.sprite;
    if (!obj) return;
    this.scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const map = obj.material.map;
      obj.material.dispose();
      if (map && !map.userData?.shared) map.dispose();
    }
  }

  updateEffects(dt) {
    for (const t of this.tracers) {
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.95;
    }
    for (const f of this.flashes) {
      f.life -= dt;
      const a = Math.max(0, f.life / f.max);
      f.mesh.material.opacity = a;
      const s = f.scale * (1.4 - a * 0.4);
      f.mesh.scale.set(s, s, 1);
    }
    for (const r of this.rings) {
      r.life -= dt;
      const p = 1 - Math.max(0, r.life / r.max);
      const size = lerp(r.from, r.to, p);
      r.mesh.scale.set(size, size, 1);
      r.mesh.material.opacity = Math.max(0, r.life / r.max) * 0.9;
    }
    for (const t of this.texts) {
      t.life -= dt;
      t.sprite.position.y += t.vy * dt;
      t.sprite.material.opacity = Math.max(0, t.life / t.max);
    }
    this.tracers = this.tracers.filter((t) => {
      if (t.life > 0) return true;
      this.removeEffect(t);
      return false;
    });
    this.flashes = this.flashes.filter((f) => {
      if (f.life > 0) return true;
      this.removeEffect(f);
      return false;
    });
    this.rings = this.rings.filter((r) => {
      if (r.life > 0) return true;
      this.removeEffect(r);
      return false;
    });
    this.texts = this.texts.filter((t) => {
      if (t.life > 0) return true;
      this.removeEffect(t);
      return false;
    });
    this.updateParticles(dt);
  }

  updateSelf(view, dt) {
    const self = view.self;
    const alive = self.alive;
    const ads = !!view.self.ads;
    this.adsT = lerp(this.adsT, ads ? 1 : 0, Math.min(1, dt * 10));
    const fov = lerp(78, 58, this.adsT);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    const moving = !!view.moving && alive;
    this.bobPhase += dt * (moving ? 9.2 : 2.2);
    const bobTarget = moving ? (ads ? 0.6 : 1) : 0;
    this.bobAmount = lerp(this.bobAmount, bobTarget, Math.min(1, dt * 8));
    const bobY = Math.sin(this.bobPhase * 2) * 2.4 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 1.8 * this.bobAmount;
    const bobRoll = Math.cos(this.bobPhase) * 0.006 * this.bobAmount;
    const strafeRoll = (view.strafe || 0) * -0.012;

    this.shake *= Math.exp(-dt * 8);
    if (this.shake < 0.05) this.shake = 0;
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const sp = (Math.random() - 0.5) * this.shake * 0.0014;

    this.camera.position.set(
      self.x + bobX * 0.5 + sx * 0.4,
      PLAYER.eye + bobY + sy * 0.4,
      self.z + sx * 0.4,
    );
    this.camera.rotation.set(
      self.pitch + sp,
      -self.yaw - Math.PI / 2,
      bobRoll + strafeRoll,
      'YXZ',
    );

    // Viewmodel.
    this.recoil *= Math.exp(-dt * 16);
    this.flashTime = Math.max(0, this.flashTime - dt);
    const weaponKind = self.weapon || 'ar';
    if (weaponKind !== this.currentWeapon) {
      this.currentWeapon = weaponKind;
      for (const [kind, group] of Object.entries(this.weaponGroups)) {
        group.visible = kind === weaponKind;
      }
    }
    const group = this.weaponGroups[weaponKind];
    if (!group) return;
    const show = alive && view.phase !== 'ended';
    for (const g of Object.values(this.weaponGroups)) g.visible = show && g === group;
    if (!show) return;

    const base = group.userData.base;
    const adsPos = weaponKind === 'sg'
      ? new THREE.Vector3(0.14, -0.2, -0.8)
      : new THREE.Vector3(0.13, -0.18, -0.78);
    const tx = lerp(base.x, adsPos.x, this.adsT) + Math.cos(this.bobPhase) * 0.006 * this.bobAmount;
    const ty = lerp(base.y, adsPos.y, this.adsT) + Math.sin(this.bobPhase * 2) * 0.006 * this.bobAmount;
    const tz = lerp(base.z, adsPos.z, this.adsT) + this.recoil * 0.09;
    group.position.x += (tx - group.position.x) * Math.min(1, dt * 12);
    group.position.y += (ty - group.position.y) * Math.min(1, dt * 12);
    group.position.z += (tz - group.position.z) * Math.min(1, dt * 18);
    group.rotation.y = lerp(0.06, 0, this.adsT);
    group.rotation.x = this.recoil * 0.055;
    const reload = self.reloading ? Math.sin(Math.min(1, self.reloadPct || 0) * Math.PI) : 0;
    group.rotation.z = reload * 0.55;
    group.position.y -= reload * 0.08;

    const flash = group.userData.flash;
    flash.visible = this.flashTime > 0;
    flash.material.opacity = this.flashTime > 0 ? 1 : 0;
    this.viewLight.position.set(
      group.position.x + group.userData.muzzle.x,
      group.position.y + group.userData.muzzle.y,
      group.position.z + group.userData.muzzle.z,
    );
    this.viewLight.intensity = this.flashTime > 0 ? 12 : 0;
  }

  updateEnemies(players, selfId, dt) {
    const seen = new Set();
    const self = players.find((p) => p.id === selfId);
    for (const p of players) {
      if (p.id === selfId) continue;
      seen.add(p.id);
      let model = this.enemyModels.get(p.id);
      if (!model) {
        model = createSoldier(p.id === selfId ? 0x5ce9ff : 0xff6b57);
        model.position.set(p.x, 0, p.y);
        this.scene.add(model);
        this.enemyModels.set(p.id, model);
      }
      model.visible = !!p.alive;
      if (!p.alive) continue;
      const prevX = model.position.x;
      const prevZ = model.position.z;
      updateSoldier(model, {
        name: p.name,
        hp: p.hp,
        yaw: p.a,
        pitch: p.pitch || 0,
        x: p.x,
        z: p.y,
        moving: distance(prevX, prevZ, p.x, p.y) > 1.2,
        dt,
        tagDistance: self ? distance(self.x, self.y, p.x, p.y) : 1200,
        showTag: !!self && self.alive && enemyTagVisible(self, p),
      });
    }
    for (const [id, model] of this.enemyModels) {
      if (!seen.has(id)) {
        model.visible = false;
      }
    }
  }

  computeVisibility(players, self) {
    this.visible.clear();
    if (!self) return;
    for (const p of players) {
      if (p.id === self.id || !p.alive) continue;
      const d = distance(self.x, self.z, p.x, p.y);
      if (d < 250 || hasLineOfSight(self.x, self.z, p.x, p.y)) {
        this.visible.add(p.id);
        this.lastSeen.set(p.id, { x: p.x, z: p.y, t: this.time });
      }
    }
  }

  isAimingAtEnemy(view) {
    if (!view?.self?.alive) return false;
    const cp = Math.cos(view.self.pitch);
    const dir = {
      x: cp * Math.cos(view.self.yaw),
      y: Math.sin(view.self.pitch),
      z: cp * Math.sin(view.self.yaw),
    };
    const result = castShot(
      view.self.x, PLAYER.eye, view.self.z,
      dir.x, dir.y, dir.z,
      1300,
      view.selfId,
      view.players,
    );
    return result.type === 'player';
  }

  drawMinimap(view) {
    const ctx = this.mctx;
    const W = this.mm.width;
    const H = this.mm.height;
    const scale = Math.min(W / WORLD.w, H / WORLD.h);
    const ox = (W - WORLD.w * scale) / 2;
    const oy = (H - WORLD.h * scale) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050c10';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    for (const w of WALLS) {
      ctx.fillStyle = w.type === 'boundary' ? '#27434d' : w.type === 'core' ? '#5d2a20' : '#1b3139';
      ctx.fillRect(w.x, w.y, w.w, w.h);
    }

    const self = view.self;
    if (self) {
      const cone = ctx.createRadialGradient(self.x, self.z, 8, self.x, self.z, 280);
      cone.addColorStop(0, 'rgba(92, 233, 255, 0.2)');
      cone.addColorStop(1, 'rgba(92, 233, 255, 0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(self.x, self.z);
      ctx.arc(self.x, self.z, 280, self.yaw - 0.55, self.yaw + 0.55);
      ctx.closePath();
      ctx.fill();
    }

    for (const kit of view.pickups || []) {
      if (!kit.active) continue;
      ctx.fillStyle = '#75f0b4';
      ctx.beginPath();
      ctx.arc(kit.x, kit.y, 7 / scale, 0, TAU);
      ctx.fill();
    }

    for (const [id, seen] of this.lastSeen) {
      if (this.visible.has(id)) continue;
      const age = this.time - seen.t;
      if (age > 5) continue;
      ctx.strokeStyle = `rgba(255, 98, 82, ${Math.max(0.15, 0.5 - age * 0.07)})`;
      ctx.lineWidth = 1.2 / scale;
      ctx.beginPath();
      ctx.arc(seen.x, seen.z, 9, 0, TAU);
      ctx.stroke();
    }

    for (const p of view.players) {
      if (p.id === view.selfId || !this.visible.has(p.id)) continue;
      ctx.fillStyle = '#ff6252';
      ctx.shadowColor = '#ff6252';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9 / scale, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (self) {
      ctx.save();
      ctx.translate(self.x, self.z);
      ctx.rotate(self.yaw);
      ctx.fillStyle = '#5ce9ff';
      ctx.shadowColor = '#5ce9ff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(13 / scale, 0);
      ctx.lineTo(-8 / scale, -7 / scale);
      ctx.lineTo(-5 / scale, 0);
      ctx.lineTo(-8 / scale, 7 / scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(92, 233, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.strokeStyle = 'rgba(92, 233, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(W * 0.5 - 4, 0);
    ctx.lineTo(W * 0.5 + 4, 0);
    ctx.moveTo(W * 0.5 - 4, H);
    ctx.lineTo(W * 0.5 + 4, H);
    ctx.stroke();
  }

  render(view, dt) {
    this.view = view;
    this.time += dt;
    const step = Math.min(0.05, dt);
    this.updateSelf(view, step);
    this.updateEnemies(view.players, view.selfId, step);
    this.computeVisibility(view.players, view.self);
    updateArena(this.arena, step, this.time, view.pickups);
    this.updateEffects(step);
    this.drawMinimap(view);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (view.self.alive && view.phase !== 'ended') {
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.viewCamera);
    }
  }
}
