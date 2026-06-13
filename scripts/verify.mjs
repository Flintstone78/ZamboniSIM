// Dev verification: run `npx vite preview --port 4173` first, then
// `node scripts/verify.mjs`. Steps the simulation directly via __game.tick()
// (immune to slow headless rendering) and checks the gate, cone tipping, puck
// shunting, the finish/stars flow, the local highscore and that restart resets
// everything. Reaches into runtime internals – TS-private is compile-time only.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});

await page.goto('http://localhost:4173/?autostart=1&level=shl', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const g = window.__game;
  const out = {};

  // --- Gate opens shortly after the level starts (~1.3s) ---
  for (let i = 0; i < 120; i++) g.tick(1 / 60);
  out.gateOpens = g.gate.isOpen;

  // --- Cone: drive straight at one, it should tip exactly once ---
  const cone = g.obstacles.cones[0];
  g.vehicle.reset(cone.pos.x - 6, cone.pos.y, Math.PI / 2); // +x heading
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  for (let i = 0; i < 300; i++) g.tick(1 / 60);
  out.coneFallen = cone.fallen;
  out.coneHits = document.getElementById('cone-value').textContent;

  // --- Puck: drive at one, it should be shunted away and stay inside ---
  const puck = g.obstacles.pucks[0];
  const before = { x: puck.pos.x, y: puck.pos.y };
  g.vehicle.reset(puck.pos.x - 6, puck.pos.y, Math.PI / 2);
  for (let i = 0; i < 400; i++) g.tick(1 / 60);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  out.puckMoved = +Math.hypot(puck.pos.x - before.x, puck.pos.y - before.y).toFixed(2);

  // --- Finish: paint the whole rink; overlay, stars + record should appear ---
  localStorage.removeItem('zambonisim.best');
  localStorage.removeItem('zambonisim.progress');
  g.startLevel('shl');
  for (let z = -14.5; z <= 14.5; z += 0.5) {
    g.ice.liftBlade();
    for (let x = -29.5; x <= 29.5; x += 0.3) g.ice.paint(x, z, Math.PI / 2, 1);
  }
  g.tick(1 / 60); // coverage >= goal triggers the finish
  out.coverage = document.getElementById('progress-pct').textContent;
  out.finishShown = document.getElementById('finish-overlay').style.display;
  out.stars = document.getElementById('finish-stars').textContent;
  out.recordText = document.getElementById('finish-record').textContent;
  out.bestStored = localStorage.getItem('zambonisim.best');
  out.progressStored = localStorage.getItem('zambonisim.progress');

  // --- Restart the same level resets everything ---
  g.startLevel('shl');
  g.tick(1 / 60);
  out.afterRestart = {
    coverage: document.getElementById('progress-pct').textContent,
    cones: g.obstacles.cones.filter((c) => c.active).every((c) => !c.fallen),
    finishHidden: document.getElementById('finish-overlay').style.display,
  };
  return out;
});

console.log(JSON.stringify(result, null, 2));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
