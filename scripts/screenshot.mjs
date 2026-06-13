// Dev verification: serves nothing itself – run `npx vite preview --port 4173`
// first, then `node scripts/screenshot.mjs`. The headless software renderer is
// far slower than real time, so we advance the simulation deterministically via
// __game.tick() (which also drives the camera) and only rely on the render loop
// to paint the current state for each screenshot.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });

// Splash then menu screenshots
await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/splash.png' });
await page.keyboard.press('Enter'); // dismiss splash into the level menu
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/menu.png' });

// Autostart into the SHL arena, then drive a resurfacing lap via tick()
await page.goto('http://localhost:4173/?autostart=1&level=eu4', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Reveal shot from inside the equipment room (sim barely advanced)
await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 50; i++) g.tick(1 / 60);
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/start.png' });

// Drive out of the garage and lay a boustrophedon of clean ice
const stats = await page.evaluate(() => {
  const g = window.__game;
  const press = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  const release = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  const tick = (n) => { for (let i = 0; i < n; i++) g.tick(1 / 60); };

  press('KeyW');
  tick(150);            // exit the garage onto the rink
  press('Space');       // blade down
  // Snake up and down the rink a few times to resurface a big patch
  for (let lap = 0; lap < 3; lap++) {
    tick(260);          // run the length
    press('KeyA'); tick(70); release('KeyA'); // u-turn
    tick(260);
    press('KeyD'); tick(70); release('KeyD');
  }
  release('KeyW');
  tick(30);
  return { coverage: g.ice.coverage, painted: g.ice.paintedCells };
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/chase.png' });

// Cycle cameras: chase -> fpv -> top
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' })));
await page.evaluate(() => { window.__game.tick(1 / 60); });
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/fpv.png' });

await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' })));
await page.evaluate(() => { window.__game.tick(1 / 60); });
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/top.png' });

console.log('coverage:', (stats.coverage * 100).toFixed(1) + '%', 'painted:', stats.painted);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
