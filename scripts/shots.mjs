// Dev visual check: run `npx vite preview --port 4173` first, then
// `node scripts/shots.mjs [outDir] [shot,shot,...]`. Waits for the zamboni
// model to load, stages a set of gameplay moments by driving the simulation
// directly (__game.tick), and saves a screenshot of each.
import { chromium } from 'playwright';

const outDir = process.argv[2] || '/tmp';
const only = process.argv[3]?.split(',');

const SHOTS = {
  // The very first view of a run: in the open bay, looking out at the gate
  start: { level: 'eu4', run: (g) => { for (let i = 0; i < 90; i++) g.tick(1 / 60); } },
  // Mid-turn at speed on the ice: camera swing + body roll
  turn: {
    level: 'eu3',
    run: (g, key) => {
      g.vehicle.reset(-10, -2, Math.PI / 2);
      key('KeyW', 1);
      for (let i = 0; i < 120; i++) g.tick(1 / 60);
      key('KeyA', 1);
      for (let i = 0; i < 40; i++) g.tick(1 / 60);
    },
  },
  // First-person from the driver's seat, blade down, spray flying
  fpv: {
    level: 'eu2',
    run: (g, key) => {
      g.vehicle.reset(-20, 0, Math.PI / 2);
      key('KeyW', 1);
      key('Space', 1); key('Space', 0);
      key('KeyC', 1); key('KeyC', 0);
      for (let i = 0; i < 100; i++) g.tick(1 / 60);
    },
  },
  // Overview from above after laying a few strips
  top: {
    level: 'eu1',
    run: (g, key) => {
      for (let z = -10; z <= 2; z += 2.2) {
        g.ice.liftBlade();
        for (let x = -26; x <= 26; x += 0.4) g.ice.paint(x, z, Math.PI / 2, 1);
      }
      g.vehicle.reset(0, 4, Math.PI / 2);
      key('KeyC', 1); key('KeyC', 0); key('KeyC', 1); key('KeyC', 0);
      for (let i = 0; i < 60; i++) g.tick(1 / 60);
    },
  },
  // Parking bonus: cars rolling in, one turning into its stall
  parking: {
    level: 'parking',
    run: (g) => {
      g.vehicle.reset(-12, 0, Math.PI / 2);
      for (let i = 0; i < 60 * 9.2; i++) g.tick(1 / 60);
    },
  },
  // Pause menu over the game
  pause: {
    level: 'eu4',
    run: (g, key) => {
      for (let i = 0; i < 90; i++) g.tick(1 / 60);
      key('Escape', 1); key('Escape', 0);
      for (let i = 0; i < 10; i++) g.tick(1 / 60);
    },
  },
};

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/404|jsonblob|Failed to fetch|net::/i.test(t)) errors.push(t);
});

for (const [name, shot] of Object.entries(SHOTS)) {
  if (only && !only.includes(name)) continue;
  await page.goto(`http://localhost:4173/?autostart=1&level=${shot.level}`, { waitUntil: 'networkidle' });
  // Wait for the GLB zamboni to replace the procedural fallback
  const t0 = Date.now();
  await page.waitForFunction(() => window.__game?.zamboni.group.userData.modelLoaded, null, { timeout: 120000 })
    .catch(() => console.log(`  (${name}: model not loaded – procedural fallback in shot)`));
  const loadS = ((Date.now() - t0) / 1000).toFixed(1);
  await page.evaluate(`(${shot.run.toString()})(window.__game, (code, down) =>
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })))`);
  await page.evaluate(() => window.__game.update(0)); // render the staged state
  await page.screenshot({ path: `${outDir}/shot_${name}.png` });
  console.log(`${name.padEnd(8)} saved (model ready after ${loadS}s)`);
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
