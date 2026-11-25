// Dev profiling: run `npx vite preview --port 4173` first, then
// `node scripts/profile.mjs [outDir]`. For each level it reports draw calls,
// triangles, GPU resources, and the CPU cost of a simulation tick and a full
// frame (tick + render), then saves a chase-camera screenshot.
import { chromium } from 'playwright';

const outDir = process.argv[2] || '/tmp';
const levels = (process.env.LEVELS || 'eu1,eu2,eu3,eu4,eu5,parking').split(',');
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

for (const id of levels) {
  await page.goto(`http://localhost:4173/?autostart=1&level=${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // let GLB/textures land
  const r = await page.evaluate(() => {
    const g = window.__game;
    // Roll out of the gate onto the ice so the camera frames real gameplay
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    for (let i = 0; i < 150; i++) g.tick(1 / 60);
    const t0 = performance.now();
    const N = 240;
    for (let i = 0; i < N; i++) g.tick(1 / 60);
    const tickMs = (performance.now() - t0) / N;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    const ren = g.renderer;
    ren.info.autoReset = false;
    ren.info.reset();
    const f0 = performance.now();
    const F = 10;
    for (let i = 0; i < F; i++) g.update(1 / 60);
    const frameMs = (performance.now() - f0) / F;
    return {
      calls: Math.round(ren.info.render.calls / F),
      tris: Math.round(ren.info.render.triangles / F),
      geometries: ren.info.memory.geometries,
      textures: ren.info.memory.textures,
      programs: ren.info.programs?.length,
      tickMs: +tickMs.toFixed(3),
      frameMs: +frameMs.toFixed(1),
      objects: (() => { let n = 0; g.scene.traverse(() => n++); return n; })(),
    };
  });
  await page.screenshot({ path: `${outDir}/prof_${id}.png` });
  console.log(id.padEnd(8), JSON.stringify(r));
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
