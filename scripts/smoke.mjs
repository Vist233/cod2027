import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.BASE_URL || 'http://localhost:2027';
const shots = process.env.SHOTS_DIR || path.join(ROOT, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

function watch(page, label) {
  page.on('pageerror', (err) => errors.push(`${label} PAGEERROR: ${err.stack || err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${label} CONSOLE: ${msg.text()}`);
  });
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
watch(page, 'practice');
await page.goto(`${BASE_URL}/?debug=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/3d-menu.png`, fullPage: true });

await page.fill('#callsign', 'NOVA');
await page.click('#practiceBtn');
await page.waitForSelector('#hud:not(.is-hidden)', { timeout: 10000 });
await page.waitForTimeout(300);
await page.click('#resumeBtn');
await page.waitForTimeout(3600);
const locked = await page.evaluate(() => !!document.pointerLockElement);
const timer = await page.textContent('#matchTimer');
await page.screenshot({ path: `${shots}/3d-practice.png` });

const ammoBefore = await page.textContent('#ammoValue');
await page.mouse.down();
await page.waitForTimeout(500);
await page.mouse.up();
await page.waitForTimeout(250);
const ammoAfter = await page.textContent('#ammoValue');

await page.mouse.down({ button: 'right' });
await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/3d-ads.png` });
await page.mouse.up({ button: 'right' });

await page.keyboard.press('Digit2');
await page.waitForTimeout(350);
const shotgun = await page.textContent('#weaponName');
await page.keyboard.press('Digit1');
await page.waitForTimeout(200);
await page.keyboard.down('KeyW');
await page.waitForTimeout(500);
await page.keyboard.up('KeyW');
await page.waitForTimeout(250);

console.log('practice:', { locked, timer, ammoBefore, ammoAfter, shotgun });

// Let the AI close in, face it, and grab a combat frame.
let faced = false;
for (let i = 0; i < 30; i++) {
  const info = await page.evaluate(() => {
    const { app } = window.__COD__;
    if (!app.state) return null;
    const self = app.state.players.find((p) => p.id === app.selfId);
    const enemy = app.state.players.find((p) => p.id !== app.selfId);
    if (!self || !enemy || !self.alive) return null;
    app.yaw = Math.atan2(enemy.y - self.y, enemy.x - self.x);
    app.pitch = Math.atan2(110 - 165, Math.hypot(enemy.x - self.x, enemy.y - self.y));
    return {
      d: Math.round(Math.hypot(enemy.x - self.x, enemy.y - self.y)),
      selfHp: self.hp,
      enemyHp: enemy.hp,
      hot: document.getElementById('crosshair3d').classList.contains('hot'),
    };
  }).catch(() => null);
  if (info && !faced && info.d < 700 && info.hot) {
    faced = true;
    await page.mouse.down();
    await page.waitForTimeout(450);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/3d-combat.png` });
    console.log('combat:', info);
    break;
  }
  await page.waitForTimeout(350);
}

// Private room with two clients.
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
watch(a, 'host');
watch(b, 'guest');
await a.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
await b.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
await a.fill('#callsign', 'ALPHA');
await b.fill('#callsign', 'BRAVO');
await a.click('#createRoomBtn');
await a.waitForSelector('#lobby:not(.is-hidden)', { timeout: 8000 });
const code = (await a.textContent('#lobbyCode')).trim();
await a.screenshot({ path: `${shots}/3d-lobby.png` });

await b.click('#joinRoomBtn');
await b.fill('#roomCodeInput', code);
await b.click('#joinConfirmBtn');
await a.waitForSelector('#hud:not(.is-hidden)', { timeout: 8000 });
await b.waitForSelector('#hud:not(.is-hidden)', { timeout: 8000 });
await a.waitForTimeout(300);
await b.waitForTimeout(300);
await a.click('#resumeBtn');
await b.click('#resumeBtn');
await a.waitForTimeout(1400);
await b.waitForTimeout(1400);
const pvp = {
  code,
  locks: await Promise.all([
    a.evaluate(() => !!document.pointerLockElement),
    b.evaluate(() => !!document.pointerLockElement),
  ]),
  names: [await a.textContent('#hudEnemyName'), await b.textContent('#hudEnemyName')],
};
await a.screenshot({ path: `${shots}/3d-pvp-a.png` });
await b.screenshot({ path: `${shots}/3d-pvp-b.png` });
console.log('pvp:', pvp);

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
