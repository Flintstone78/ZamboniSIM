// Dev verification: run `npx vite preview --port 4173` first, then
// `node scripts/verify.mjs`. Steps the simulation directly via __game.tick()
// (immune to slow headless rendering) and checks cone tipping, puck shunting,
// the finish screen and the local highscore. Reaches into runtime internals –
// TS-private is compile-time only.
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

await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const game = window.__game;
  const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k }));
  const out = {};

  // --- Cone: drive straight at one, it should tip exactly once ---
  const cone = game.obstacles.cones[0];
  game.vehicle.reset(cone.pos.x - 6, cone.pos.y, Math.PI / 2); // +x heading
  key('keydown', 'w');
  for (let i = 0; i < 300; i++) game.tick(1 / 60);
  out.coneFallen = cone.fallen;
  out.coneTip = cone.tip;
  out.coneHits = document.getElementById('cone-value').textContent;

  // --- Puck: drive at one, it should be shunted away and stay inside ---
  const puck = game.obstacles.pucks[0];
  const before = { x: puck.pos.x, y: puck.pos.y };
  game.vehicle.reset(puck.pos.x - 6, puck.pos.y, Math.PI / 2);
  for (let i = 0; i < 400; i++) game.tick(1 / 60);
  key('keyup', 'w');
  out.puckMoved = Math.hypot(puck.pos.x - before.x, puck.pos.y - before.y);
  out.puckSpeed = puck.vel.length();

  // --- Finish: paint the whole rink, overlay + record should appear ---
  localStorage.removeItem('zambonisim.best');
  game.restart();
  for (let z = -14.8; z <= 14.8; z += 1.0) {
    game.ice.liftBlade();
    for (let x = -29.8; x <= 29.8; x += 0.3) {
      game.ice.paint(x, z, Math.PI / 2, game.elapsed);
    }
  }
  game.tick(1 / 60);
  out.coverage = document.getElementById('progress-pct').textContent;
  out.finishShown = document.getElementById('finish-overlay').style.display;
  out.recordText = document.getElementById('finish-record').textContent;
  out.bestStored = localStorage.getItem('zambonisim.best');

  // --- Second finish with same score must not be a new record ---
  const best = out.bestStored;
  game.finished = false;
  game.finish();
  out.recordTextSecond = document.getElementById('finish-record').textContent;
  out.bestAfterSecond = localStorage.getItem('zambonisim.best');

  // --- Restart resets everything ---
  game.restart();
  out.afterRestart = {
    coverage: document.getElementById('progress-pct').textContent,
    cones: game.obstacles.cones.every((c) => !c.fallen),
    finishHidden: document.getElementById('finish-overlay').style.display,
  };
  return out;
});

console.log(JSON.stringify(result, null, 2));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
