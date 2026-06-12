// Dev verification: serves nothing itself – run `npx vite preview --port 4173`
// first, then `node scripts/screenshot.mjs`. Drives the zamboni around with
// synthetic key events and saves screenshots to /tmp.
import { chromium } from 'playwright';

const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/start.png' });

// Lap 1: straight, U-turn, straight back
await page.keyboard.down('w');
await page.waitForTimeout(9000);
await page.keyboard.down('a');
await page.waitForTimeout(5500);
await page.keyboard.up('a');
await page.waitForTimeout(7000);
await page.screenshot({ path: '/tmp/chase.png' });

await page.keyboard.press('c'); // FPV
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/fpv.png' });

await page.keyboard.press('c'); // top view
await page.waitForTimeout(800);
await page.keyboard.up('w');
await page.screenshot({ path: '/tmp/top.png' });

console.log('coverage:', await page.locator('#progress-pct').textContent());
console.log('time:', await page.locator('#time-value').textContent());
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
