export const WORLD = { w: 1600, h: 1000 };

export const PLAYER = {
  radius: 20,
  height: 180,
  eye: 165,
  speed: 285,
  maxHp: 100,
  dashSpeed: 820,
  dashTime: 0.16,
  dashCooldown: 2.15,
  respawnTime: 2.6,
};

export const MATCH = {
  killLimit: 10,
  duration: 240,
  countdown: 3.2,
  snapshotRate: 20,
  tickRate: 60,
};

export const WEAPONS = {
  ar: {
    id: 'ar',
    name: 'KV-9 突击步枪',
    short: 'KV-9',
    damage: 13,
    rate: 105,
    mag: 30,
    reload: 1550,
    spread: 0.010,
    moveSpread: 0.016,
    pellets: 1,
    range: 1300,
    tracer: '#8df3ff',
    auto: true,
  },
  sg: {
    id: 'sg',
    name: 'M12 战术霰弹枪',
    short: 'M12',
    damage: 10,
    rate: 760,
    mag: 6,
    reload: 2150,
    spread: 0.105,
    moveSpread: 0.03,
    pellets: 7,
    range: 540,
    tracer: '#ffd479',
    auto: false,
  },
};

export const WEAPON_ORDER = ['ar', 'sg'];

const OUTER = [
  { x: 0, y: 0, w: WORLD.w, h: 36 },
  { x: 0, y: WORLD.h - 36, w: WORLD.w, h: 36 },
  { x: 0, y: 0, w: 36, h: WORLD.h },
  { x: WORLD.w - 36, y: 0, w: 36, h: WORLD.h },
];

const BASE_WALLS = [
  { x: 250, y: 170, w: 220, h: 42, type: 'wall' },
  { x: 540, y: 230, w: 70, h: 70, type: 'crate' },
  { x: 510, y: 620, w: 42, h: 210, type: 'wall' },
  { x: 200, y: 690, w: 80, h: 80, type: 'crate' },
  { x: 330, y: 430, w: 36, h: 170, type: 'wall' },
  { x: 650, y: 520, w: 64, h: 64, type: 'crate' },
  { x: 760, y: 120, w: 90, h: 38, type: 'wall' },
  { x: 690, y: 330, w: 110, h: 36, type: 'wall' },
  { x: 120, y: 336, w: 104, h: 36, type: 'wall' },
];

const MIRRORED_WALLS = BASE_WALLS.map((w) => ({
  ...w,
  x: WORLD.w - w.x - w.w,
  y: WORLD.h - w.y - w.h,
}));

export const WALLS = [
  ...OUTER.map((w) => ({ ...w, type: 'boundary' })),
  ...BASE_WALLS,
  ...MIRRORED_WALLS,
  { x: 742, y: 440, w: 116, h: 120, type: 'core' },
].map((w) => ({
  ...w,
  height:
    w.type === 'boundary' ? 620 : w.type === 'crate' ? 135 : w.type === 'core' ? 380 : 300,
}));

export const SPAWNS = [
  { x: 140, y: 240, a: 0 },
  { x: 1460, y: 760, a: Math.PI },
];

export const PICKUPS = [
  { id: 'med-n', kind: 'med', x: 800, y: 180, amount: 45, respawn: 12000 },
  { id: 'med-s', kind: 'med', x: 800, y: 820, amount: 45, respawn: 12000 },
];

export const COLORS = {
  self: '#54e6ff',
  enemy: '#ff6b57',
  ally: '#7ef0b2',
};
