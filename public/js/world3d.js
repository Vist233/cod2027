import * as THREE from '/vendor/three.module.js';
import { WORLD, WALLS, PICKUPS, PLAYER, SPAWNS } from '/shared/game-config.js';

const TAU = Math.PI * 2;

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeFloorTexture() {
  return canvasTexture(1024, 640, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#14262f');
    g.addColorStop(0.5, '#0f1e26');
    g.addColorStop(1, '#13242c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Subtle concrete blotches.
    for (let i = 0; i < 240; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 2 + Math.random() * 34;
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '90,150,165'},${0.015 + Math.random() * 0.03})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.3 + Math.random() * 0.5), Math.random() * TAU, 0, TAU);
      ctx.fill();
    }

    // Tiles.
    const cell = 25.6;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += cell) {
      ctx.strokeStyle = x % (cell * 5) === 0 ? 'rgba(103,200,220,0.13)' : 'rgba(103,200,220,0.05)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += cell) {
      ctx.strokeStyle = y % (cell * 5) === 0 ? 'rgba(103,200,220,0.13)' : 'rgba(103,200,220,0.05)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Lane arrows.
    ctx.strokeStyle = 'rgba(120,220,240,0.12)';
    ctx.lineWidth = 3;
    for (const y of [h * 0.33, h * 0.67]) {
      ctx.beginPath();
      ctx.moveTo(w * 0.34, y);
      ctx.lineTo(w * 0.44, y);
      ctx.moveTo(w * 0.4, y - 14);
      ctx.lineTo(w * 0.44, y);
      ctx.lineTo(w * 0.4, y + 14);
      ctx.moveTo(w * 0.66, y);
      ctx.lineTo(w * 0.56, y);
      ctx.moveTo(w * 0.6, y - 14);
      ctx.lineTo(w * 0.56, y);
      ctx.lineTo(w * 0.6, y + 14);
      ctx.stroke();
    }

    // Central circle + cross.
    ctx.strokeStyle = 'rgba(92,233,255,0.1)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 18]);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 108, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 156, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(92,233,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 20, h / 2);
    ctx.lineTo(w / 2 + 20, h / 2);
    ctx.moveTo(w / 2, h / 2 - 20);
    ctx.lineTo(w / 2, h / 2 + 20);
    ctx.stroke();

    // Hazard bands near the outer walls.
    for (const [x, y, bw, bh] of [
      [30, 30, 130, 7], [w - 160, 30, 130, 7],
      [30, h - 37, 130, 7], [w - 160, h - 37, 130, 7],
    ]) {
      ctx.fillStyle = 'rgba(255,180,84,0.2)';
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      for (let i = 0; i < bw; i += 16) ctx.fillRect(x + i, y, 7, bh);
    }

    // Painted labels.
    ctx.fillStyle = 'rgba(170,230,240,0.1)';
    ctx.font = '700 28px "SF Mono", Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PIER 09', w / 2, 74);
    ctx.font = '11px "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(170,230,240,0.16)';
    ctx.fillText('SECTOR 07 / RESTRICTED', w / 2, 94);
    ctx.fillText('WEST APPROACH', 145, h / 2 - 30);
    ctx.fillText('EAST APPROACH', w - 145, h / 2 + 30);

    // Scratches.
    ctx.strokeStyle = 'rgba(180,235,245,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const a = Math.random() * TAU;
      const l = 5 + Math.random() * 36;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  });
}

function makeWallTexture(base, line, accent) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.06)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Panel seams.
    for (let x = 0; x <= w; x += 128) {
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = 'rgba(220,245,250,0.06)';
      ctx.fillRect(x + 4, 0, 2, h);
    }
    for (let y = 0; y <= h; y += 128) {
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Rivets.
    ctx.fillStyle = 'rgba(210,240,245,0.24)';
    for (let y = 18; y < h; y += 128) {
      for (let x = 18; x < w; x += 128) {
        for (const [ox, oy] of [[0, 0], [92, 0], [0, 92], [92, 92]]) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, 2.2, 0, TAU);
          ctx.fill();
        }
      }
    }

    // Warning marks.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.strokeRect(22, 22, w - 44, h - 44);
    ctx.fillStyle = accent;
    ctx.font = '700 16px "SF Mono", Menlo, monospace';
    ctx.fillText('SEC-07', 38, 58);

    // Grime.
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 2 + Math.random() * 26, 1 + Math.random() * 12, Math.random() * TAU, 0, TAU);
      ctx.fill();
    }
  });
}

function makeCrateTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4a3a24';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,190,100,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(20,14,8,0.7)';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.lineTo(w - 12, h - 12);
    ctx.moveTo(w - 12, 12);
    ctx.lineTo(12, h - 12);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,110,0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.fillStyle = 'rgba(255,200,110,0.55)';
    for (const [x, y] of [[14, 14], [w - 22, 14], [14, h - 22], [w - 22, h - 22]]) {
      ctx.beginPath();
      ctx.arc(x + 4, y + 4, 3, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(20,14,8,0.65)';
    ctx.font = '700 20px "SF Mono", Menlo, monospace';
    ctx.fillText('CARGO', 26, h / 2 + 7);
    ctx.fillStyle = 'rgba(255,190,90,0.5)';
    ctx.fillRect(24, h / 2 + 18, 78, 3);
  });
}

function makeCoreTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#24110d';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,90,60,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.strokeStyle = 'rgba(255,140,90,0.25)';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(20, 40 + i * 26);
      ctx.lineTo(w - 20, 40 + i * 26);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,90,55,0.7)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 14, 0, TAU);
    ctx.fill();
  });
}

export function makeTextSprite(text, color = '#5ce9ff', size = 52) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = `700 ${size}px "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 58);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '18px "SF Mono", Menlo, monospace';
  ctx.fillText('KILL CONFIRMED', 256, 108);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

function createTagSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.2, 0.55, 1);
  sprite.renderOrder = 5;
  sprite.userData = { canvas, ctx, tex, lastHp: -1, lastName: '' };
  return sprite;
}

function drawTag(sprite, name, hp, hostile = true) {
  const { canvas, ctx, tex, lastHp, lastName } = sprite.userData;
  const roundedHp = Math.round(hp);
  if (roundedHp === lastHp && name === lastName) return;
  sprite.userData.lastHp = roundedHp;
  sprite.userData.lastName = name;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(2,7,10,0.72)';
  ctx.fillRect(18, 18, w - 36, h - 36);
  ctx.strokeStyle = hostile ? 'rgba(255,98,82,0.6)' : 'rgba(92,233,255,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.font = '700 30px "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = hostile ? 'rgba(255,175,160,0.98)' : 'rgba(160,246,255,0.98)';
  ctx.fillText(name, w / 2, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(64, 72, w - 128, 14);
  const pct = Math.max(0, Math.min(1, hp / 100));
  ctx.fillStyle = pct > 0.55 ? '#75f0b4' : pct > 0.25 ? '#ffb454' : '#ff6252';
  ctx.fillRect(65, 73, (w - 130) * pct, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '16px "SF Mono", Menlo, monospace';
  ctx.fillText(`${roundedHp} HP`, w / 2, 108);
  tex.needsUpdate = true;
}

export function createSoldier(color = 0xff6b57) {
  const group = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color: 0x2b3a42, roughness: 0.55, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121c21, roughness: 0.85, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 1.5,
    roughness: 0.35,
    metalness: 0.3,
  });
  const visor = new THREE.MeshStandardMaterial({
    color: 0x090d0f,
    emissive: new THREE.Color(color),
    emissiveIntensity: 2.4,
    roughness: 0.2,
    metalness: 0.6,
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.64, 0.52), armor);
  torso.position.set(0, 1.16, 0);
  group.add(torso);

  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.34), dark);
  plate.position.set(0.24, 1.2, 0);
  group.add(plate);

  const chestStrip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.08), accent);
  chestStrip.position.set(0.31, 1.26, 0.12);
  group.add(chestStrip);

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.42), armor);
  pelvis.position.set(0, 0.8, 0);
  group.add(pelvis);

  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.76, side * 0.14);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.2), dark);
    leg.position.set(0, -0.36, 0);
    pivot.add(leg);
    const knee = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.16, 0.23), accent);
    knee.position.set(0.02, -0.34, 0);
    knee.scale.set(0.55, 1, 1);
    pivot.add(knee);
    group.add(pivot);
    legs.push(pivot);
  }

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.5, 0.18), armor);
    arm.position.set(0.04, 1.16, side * 0.34);
    arm.rotation.x = side * 0.2;
    group.add(arm);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.24), accent);
    pad.position.set(0.02, 1.4, side * 0.36);
    group.add(pad);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), dark);
  head.position.set(0.01, 1.68, 0);
  group.add(head);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 12, 8, 0, TAU, 0, Math.PI * 0.58),
    armor,
  );
  helmet.position.set(0, 1.71, 0);
  group.add(helmet);

  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.28), visor);
  visorMesh.position.set(0.16, 1.69, 0);
  group.add(visorMesh);

  const gun = new THREE.Group();
  gun.position.set(0.2, 1.31, 0.23);
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.1), dark);
  gunBody.position.set(0.3, 0, 0);
  gun.add(gunBody);
  const gunAccent = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.12), accent);
  gunAccent.position.set(0.05, 0.01, 0);
  gun.add(gunAccent);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.32, 6), dark);
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.set(0.72, 0, 0);
  gun.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.08), dark);
  mag.position.set(0.24, -0.14, 0);
  gun.add(mag);
  group.add(gun);

  const tag = createTagSprite();
  tag.position.set(0, 2.18, 0);
  group.add(tag);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  group.userData = { legs, gun, tag, walk: 0, hp: 100, name: 'VIPER-09' };
  // Body geometry is modeled in meters; world coordinates are centimeters.
  group.scale.setScalar(100);
  return group;
}

export function updateSoldier(group, { name, hp, yaw, pitch, x, z, moving, dt, showTag = true, tagDistance = 900 }) {
  group.position.x += (x - group.position.x) * Math.min(1, dt * 18);
  group.position.z += (z - group.position.z) * Math.min(1, dt * 18);
  const current = group.rotation.y;
  const target = -yaw;
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  group.rotation.y = current + delta * Math.min(1, dt * 16);
  group.userData.hp = hp;
  group.userData.name = name;
  group.userData.gun.rotation.z = pitch;
  const tag = group.userData.tag;
  tag.visible = showTag;
  const tagW = Math.max(0.8, Math.min(2.8, tagDistance * 0.2));
  tag.scale.set(tagW, tagW * 0.25, 1);
  if (showTag) drawTag(tag, name, hp, true);

  if (moving) group.userData.walk += dt * 9;
  const swing = moving ? Math.sin(group.userData.walk) * 0.55 : 0;
  const [legL, legR] = group.userData.legs;
  legL.rotation.z += (swing - legL.rotation.z) * Math.min(1, dt * 14);
  legR.rotation.z += (-swing - legR.rotation.z) * Math.min(1, dt * 14);
  group.position.y = moving ? Math.abs(Math.sin(group.userData.walk)) * 1.6 : 0;
}

export function createWeaponModel(kind = 'ar') {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x5b707a, roughness: 0.4, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b262c, roughness: 0.7, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({
    color: kind === 'sg' ? 0xffb454 : 0x5ce9ff,
    emissive: kind === 'sg' ? 0xff8a2a : 0x2dd8f2,
    emissiveIntensity: 0.65,
    roughness: 0.35,
    metalness: 0.4,
  });
  const glove = new THREE.MeshStandardMaterial({ color: 0x222d31, roughness: 0.9, metalness: 0.05 });

  if (kind === 'ar') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.15, 0.52), metal);
    body.position.set(0, 0, -0.2);
    group.add(body);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.44), dark);
    rail.position.set(0, 0.1, -0.22);
    group.add(rail);
    const railGlow = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.26), accent);
    railGlow.position.set(0, 0.12, -0.24);
    group.add(railGlow);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.115, 0.3), dark);
    handguard.position.set(0, 0.005, -0.47);
    group.add(handguard);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.34, 8), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.018, -0.7);
    group.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.08, 8), dark);
    brake.rotation.x = Math.PI / 2;
    brake.position.set(0, 0.018, -0.86);
    group.add(brake);
    const brakeRing = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.018, 8), accent);
    brakeRing.rotation.x = Math.PI / 2;
    brakeRing.position.set(0, 0.018, -0.89);
    group.add(brakeRing);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.3), dark);
    stock.position.set(0, -0.015, 0.16);
    group.add(stock);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.26, 0.15), dark);
    mag.position.set(0, -0.17, -0.12);
    mag.rotation.x = 0.18;
    group.add(mag);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.19, 0.1), dark);
    grip.position.set(0, -0.14, 0.05);
    grip.rotation.x = -0.28;
    group.add(grip);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), dark);
    scope.position.set(0, 0.145, -0.16);
    group.add(scope);
    const sideStrip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.018, 0.2), accent);
    sideStrip.position.set(-0.068, 0.005, -0.33);
    group.add(sideStrip);
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.018, 0.03), accent);
    dot.position.set(0, 0.19, -0.25);
    group.add(dot);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.17, 0.5), metal);
    body.position.set(0, 0, -0.18);
    group.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.48, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.025, -0.64);
    group.add(barrel);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.2), accent);
    pump.position.set(0, -0.01, -0.47);
    group.add(pump);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.3), dark);
    stock.position.set(0, -0.02, 0.17);
    group.add(stock);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.4, 6), metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.06, -0.48);
    group.add(tube);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.09), accent);
    shell.position.set(0.1, 0.03, 0.02);
    group.add(shell);
  }

  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 0.15), glove);
  rightHand.position.set(0.015, -0.15, 0.06);
  rightHand.rotation.x = -0.2;
  group.add(rightHand);
  const rightSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 0.2), dark);
  rightSleeve.position.set(0.02, -0.18, 0.21);
  rightSleeve.rotation.x = 0.4;
  group.add(rightSleeve);
  const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.14), glove);
  leftHand.position.set(0, -0.11, kind === 'ar' ? -0.46 : -0.48);
  leftHand.rotation.x = 0.1;
  group.add(leftHand);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
    }
  });
  group.userData = { kind, muzzle: new THREE.Vector3(0, 0.018, kind === 'ar' ? -0.9 : -0.9) };
  return group;
}

export function makeParticleTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function makeFlashTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(180,245,255,0.95)');
    g.addColorStop(0.55, 'rgba(92,233,255,0.4)');
    g.addColorStop(1, 'rgba(92,233,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * 10, h / 2 + Math.sin(a) * 10);
      ctx.lineTo(w / 2 + Math.cos(a) * 52, h / 2 + Math.sin(a) * 52);
      ctx.stroke();
    }
  });
}

export function buildArena(scene) {
  const arena = { pickups: new Map(), dust: null, lamps: [] };

  const hemi = new THREE.HemisphereLight(0x8fe6f5, 0x0a1115, 1.55);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x466a76, 1.0);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xd6f2ff, 3.5);
  sun.position.set(520, 1150, 420);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1100;
  sun.shadow.camera.right = 1100;
  sun.shadow.camera.top = 1100;
  sun.shadow.camera.bottom = -1100;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 3200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1.2;
  scene.add(sun);
  arena.sun = sun;

  const fill = new THREE.DirectionalLight(0x4a8fa6, 1.35);
  fill.position.set(-500, 780, -400);
  scene.add(fill);

  const floorTex = makeFloorTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.w, WORLD.h),
    new THREE.MeshStandardMaterial({
      map: floorTex,
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.25,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(WORLD.w / 2, 0, WORLD.h / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const outerGround = new THREE.Mesh(
    new THREE.PlaneGeometry(4200, 3200),
    new THREE.MeshStandardMaterial({ color: 0x020609, roughness: 1, metalness: 0 }),
  );
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.set(WORLD.w / 2, -1.5, WORLD.h / 2);
  scene.add(outerGround);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.w, WORLD.h),
    new THREE.MeshStandardMaterial({ color: 0x04090c, roughness: 0.95, metalness: 0.1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(WORLD.w / 2, 620, WORLD.h / 2);
  scene.add(ceiling);

  const beamMat = new THREE.MeshStandardMaterial({ color: 0x0d181e, roughness: 0.7, metalness: 0.55 });
  for (let x = 100; x < WORLD.w; x += 200) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(14, 22, WORLD.h - 72), beamMat);
    beam.position.set(x, 596, WORLD.h / 2);
    scene.add(beam);
  }
  for (let z = 100; z < WORLD.h; z += 200) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(WORLD.w - 72, 12, 10), beamMat);
    beam.position.set(WORLD.w / 2, 585, z);
    scene.add(beam);
  }

  const wallMats = {
    wall: new THREE.MeshStandardMaterial({
      map: makeWallTexture('#5d6d76', 'rgba(10,18,22,0.6)', 'rgba(92,233,255,0.18)'),
      color: 0xdbe8ec,
      roughness: 0.68,
      metalness: 0.58,
    }),
    boundary: new THREE.MeshStandardMaterial({
      map: makeWallTexture('#33434b', 'rgba(4,10,13,0.75)', 'rgba(92,233,255,0.1)'),
      color: 0x9fb0b7,
      roughness: 0.78,
      metalness: 0.5,
    }),
    crate: new THREE.MeshStandardMaterial({
      map: makeCrateTexture(),
      color: 0xffd89a,
      roughness: 0.8,
      metalness: 0.15,
    }),
    core: new THREE.MeshStandardMaterial({
      map: makeCoreTexture(),
      color: 0xd08468,
      roughness: 0.5,
      metalness: 0.55,
      emissive: 0x461008,
      emissiveIntensity: 1.2,
    }),
  };

  for (const w of WALLS) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.height, w.h), wallMats[w.type]);
    mesh.position.set(w.x + w.w / 2, w.height / 2, w.y + w.h / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({
        color: w.type === 'crate' ? 0xffb454 : w.type === 'core' ? 0xff5a40 : 0x5ce9ff,
        transparent: true,
        opacity: w.type === 'crate' ? 0.24 : 0.14,
      }),
    );
    edges.position.copy(mesh.position);
    scene.add(edges);

    if (w.type === 'wall' || w.type === 'boundary') {
      const stripColor = w.type === 'boundary' ? 0x2c8fa3 : 0x5ce9ff;
      const stripMat = new THREE.MeshBasicMaterial({
        color: stripColor,
        transparent: true,
        opacity: w.type === 'boundary' ? 0.35 : 0.5,
      });
      const alongX = w.w > w.h;
      const strip = new THREE.Mesh(
        alongX
          ? new THREE.BoxGeometry(w.w * 0.5, 3, 2)
          : new THREE.BoxGeometry(2, 3, w.h * 0.5),
        stripMat,
      );
      strip.position.set(
        w.x + w.w / 2,
        Math.min(w.height - 14, 24),
        w.y + w.h / 2,
      );
      scene.add(strip);
    }
  }

  // Core reactor.
  const core = new THREE.Group();
  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(19, 18, 14),
    new THREE.MeshStandardMaterial({
      color: 0xff6a4a,
      emissive: 0xff3a20,
      emissiveIntensity: 2.4,
      roughness: 0.25,
      metalness: 0.35,
    }),
  );
  coreGlow.position.set(800, 430, 500);
  core.add(coreGlow);
  const coreRing = new THREE.Mesh(
    new THREE.TorusGeometry(34, 2.2, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0xff7a5a, transparent: true, opacity: 0.8 }),
  );
  coreRing.rotation.x = Math.PI / 2;
  coreRing.position.set(800, 430, 500);
  core.add(coreRing);

  const coreDark = new THREE.MeshStandardMaterial({ color: 0x222a2e, roughness: 0.45, metalness: 0.75 });
  const coreHot = new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.9 });
  for (const [px, pz, sx, sz] of [
    [862, 500, 7, 84],
    [738, 500, 7, 84],
    [800, 562, 84, 7],
    [800, 438, 84, 7],
  ]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(sx, 170, sz), coreDark);
    plate.position.set(px, 195, pz);
    plate.castShadow = true;
    core.add(plate);
    for (const y of [150, 195, 240]) {
      const slit = new THREE.Mesh(
        new THREE.BoxGeometry(sx === 7 ? 2.5 : 62, 5, sz === 7 ? 2.5 : 62),
        coreHot,
      );
      slit.position.set(px + (sx === 7 ? (px > 800 ? 4 : -4) : 0), y, pz + (sz === 7 ? (pz > 500 ? 4 : -4) : 0));
      core.add(slit);
    }
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(120, 10, 124), coreDark);
  cap.position.set(800, 385, 500);
  cap.castShadow = true;
  core.add(cap);
  for (const [dx, dz] of [[-48, -52], [48, -52], [-48, 52], [48, 52]]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(4, 50, 4), coreDark);
    strut.position.set(800 + dx, 405, 500 + dz);
    core.add(strut);
  }
  for (const [x, z] of [[742, 440], [858, 440], [742, 560], [858, 560]]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(3, 370, 3), coreHot);
    edge.position.set(x, 187, z);
    core.add(edge);
  }
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 185, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff5a3a,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  beam.position.set(800, 522, 500);
  core.add(beam);
  const floorGlow = new THREE.Mesh(
    new THREE.RingGeometry(98, 106, 48),
    new THREE.MeshBasicMaterial({
      color: 0xff4a2a,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.set(800, 1.8, 500);
  core.add(floorGlow);
  scene.add(core);
  arena.core = { glow: coreGlow, ring: coreRing };

  const coreLight = new THREE.PointLight(0xff4a2a, 420, 1100, 2);
  coreLight.position.set(800, 430, 500);
  scene.add(coreLight);
  arena.coreLight = coreLight;

  // Ceiling lamps.
  for (const [x, z, color] of [
    [350, 250, 0x5ce9ff],
    [1250, 750, 0x5ce9ff],
    [1250, 250, 0xffb454],
    [350, 750, 0xffb454],
  ]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(60, 4, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    lamp.position.set(x, 608, z);
    scene.add(lamp);
    const light = new THREE.PointLight(color, 430, 1100, 2);
    light.position.set(x, 570, z);
    scene.add(light);
    arena.lamps.push(light);
  }

  // Hanging cables.
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x111d22 });
  for (let i = 0; i < 10; i++) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 180 + Math.random() * 200, 4), cableMat);
    cable.position.set(120 + Math.random() * 1360, 500, 100 + Math.random() * 800);
    scene.add(cable);
  }

  // Dust motes.
  const count = 320;
  const pos = new Float32Array(count * 3);
  const vel = [];
  for (let i = 0; i < count; i++) {
    pos[i * 3] = 40 + Math.random() * (WORLD.w - 80);
    pos[i * 3 + 1] = 20 + Math.random() * 480;
    pos[i * 3 + 2] = 40 + Math.random() * (WORLD.h - 80);
    vel.push({
      x: (Math.random() - 0.5) * 4,
      y: (Math.random() - 0.5) * 3,
      z: (Math.random() - 0.5) * 4,
    });
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0x9fe8f5,
      size: 1.6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  scene.add(dust);
  arena.dust = { points: dust, vel };

  // Medical pickups.
  for (const kit of PICKUPS) {
    const group = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(36, 30, 26),
      new THREE.MeshStandardMaterial({
        color: 0x12251f,
        emissive: 0x0f4a34,
        emissiveIntensity: 0.9,
        roughness: 0.5,
        metalness: 0.4,
      }),
    );
    box.position.y = 28;
    box.castShadow = true;
    group.add(box);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x75f0b4, transparent: true, opacity: 0.95 });
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 4), crossMat);
    crossA.position.set(0, 46, 0);
    group.add(crossA);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 20), crossMat);
    crossB.position.set(0, 46, 0);
    group.add(crossB);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(30, 1.4, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0x75f0b4, transparent: true, opacity: 0.5 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 12;
    group.add(ring);
    const light = new THREE.PointLight(0x75f0b4, 18, 180, 2);
    light.position.y = 40;
    group.add(light);
    group.position.set(kit.x, 0, kit.y);
    group.userData = { ring, box, active: true };
    scene.add(group);
    arena.pickups.set(kit.id, group);
  }

  // Spawn pads.
  SPAWNS.forEach((spawn, i) => {
    const color = i === 0 ? 0x5ce9ff : 0xff6b57;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(48, 54, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(spawn.x, 1.5, spawn.y);
    scene.add(ring);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(14, 17, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(spawn.x, 1.6, spawn.y);
    scene.add(inner);
  });

  // Arena boundary trim.
  const trimMat = new THREE.MeshBasicMaterial({ color: 0x5ce9ff, transparent: true, opacity: 0.35 });
  for (const [x, z, w, d] of [
    [WORLD.w / 2, 38, WORLD.w - 80, 2],
    [WORLD.w / 2, WORLD.h - 38, WORLD.w - 80, 2],
    [38, WORLD.h / 2, 2, WORLD.h - 80],
    [WORLD.w - 38, WORLD.h / 2, 2, WORLD.h - 80],
  ]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, d), trimMat);
    trim.position.set(x, 2, z);
    scene.add(trim);
  }

  return arena;
}

export function updateArena(arena, dt, time, pickups) {
  if (arena.core) {
    arena.core.ring.rotation.z += dt * 0.7;
    arena.core.glow.material.emissiveIntensity = 1.7 + Math.sin(time * 2.4) * 0.6;
    arena.coreLight.intensity = 480 + Math.sin(time * 2.4) * 100;
  }
  const pos = arena.dust.points.geometry.attributes.position;
  for (let i = 0; i < arena.dust.vel.length; i++) {
    const v = arena.dust.vel[i];
    let x = pos.getX(i) + v.x * dt;
    let y = pos.getY(i) + v.y * dt;
    let z = pos.getZ(i) + v.z * dt;
    if (x < 30) x = WORLD.w - 30;
    if (x > WORLD.w - 30) x = 30;
    if (y < 10) y = 500;
    if (y > 510) y = 10;
    if (z < 30) z = WORLD.h - 30;
    if (z > WORLD.h - 30) z = 30;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;

  for (const kit of pickups || []) {
    const group = arena.pickups.get(kit.id);
    if (!group) continue;
    group.visible = kit.active;
    if (kit.active) {
      group.userData.ring.rotation.z += dt * 1.4;
      group.position.y = Math.sin(time * 2 + kit.x) * 2.5;
    }
  }
  for (const lamp of arena.lamps) {
    lamp.intensity = 400 + Math.sin(time * 12 + lamp.position.x) * 12;
  }
}
