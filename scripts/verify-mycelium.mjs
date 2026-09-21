import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.EXPERIENCE_URL ?? 'http://127.0.0.1:4173/gh-contrib-archive';
const out = process.env.EXPERIENCE_OUT ?? '.dream-evidence';
const baseline = process.env.EXPERIENCE_BASELINE === '1';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const cases = baseline ? [{ id: 'baseline', width: 960, height: 540, look: 'midnight' }] : [
  { id: 'midnight', width: 960, height: 540, look: 'midnight' },
  { id: 'moonlit', width: 960, height: 540, look: 'moonlit' },
  { id: 'ember', width: 960, height: 540, look: 'ember' },
  { id: 'verdant', width: 960, height: 540, look: 'verdant' },
  { id: 'phone', width: 390, height: 844, look: 'midnight', mobile: true },
];
try {
  for (const spec of cases) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: spec.mobile ? 3 : 1, isMobile: !!spec.mobile, hasTouch: !!spec.mobile, reducedMotion: 'reduce', colorScheme: 'dark' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    const started = Date.now();
    const response = await page.goto(`${base}/worlds/mycelium/?capture=scene&look=${spec.look}`, { waitUntil: 'networkidle', timeout: 120000 });
    assert.equal(response.status(), 200, `${spec.id}: scene document`);
    await page.locator('canvas').first().waitFor({ timeout: 90000 });
    if (!baseline) await page.waitForFunction(() => document.querySelector('canvas')?.dataset.sceneReady === 'true', { timeout: 90000 });
    await page.waitForTimeout(baseline ? 3000 : 1000);
    const canvas = page.locator('canvas').first();
    const layout = await canvas.evaluate(c => ({ width: c.getBoundingClientRect().width, height: c.getBoundingClientRect().height, backingWidth: c.width, backingHeight: c.height, time: c.dataset.sceneTime, pixelRatio: c.dataset.pixelRatio, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    assert.ok(Math.abs(layout.width - spec.width) <= 1, `${spec.id}: viewport width`);
    assert.ok(Math.abs(layout.height - spec.height) <= 1, `${spec.id}: viewport height`);
    assert.equal(layout.overflow, false, `${spec.id}: document overflow`);
    if (spec.mobile) assert.ok(layout.backingWidth <= 390 * 1.25 + 1, 'Phone resolution cap');
    await page.screenshot({ path: path.join(out, `${spec.id}-ui.png`) });
    await canvas.evaluate(c => {
      const ancestors = new Set(); let el = c;
      while (el) { ancestors.add(el); el = el.parentElement; }
      for (const node of document.body.querySelectorAll('*')) if (!ancestors.has(node)) node.style.visibility = 'hidden';
    });
    await canvas.screenshot({ path: path.join(out, `${spec.id}.png`), animations: 'disabled', timeout: 90000 });
    assert.deepEqual(errors, [], `${spec.id}: runtime errors`);
    results.push({ id: spec.id, viewport: [spec.width, spec.height], ...layout, runtimeErrors: errors.length, elapsedMs: Date.now() - started });
    await context.close();
  }
  if (!baseline) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${base}/worlds/mycelium/`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.sceneReady === 'true');
    const clock = () => page.locator('canvas').first().getAttribute('data-scene-time');
    const a = await clock(); await page.waitForTimeout(500); assert.equal(await clock(), a, 'Reduced motion freezes scene');
    await page.getByRole('button', { name: 'Resume dream', exact: true }).tap();
    await page.waitForTimeout(1200); assert.notEqual(await clock(), a, 'Resume animates actual scene');
    await page.getByRole('button', { name: 'Pause dream', exact: true }).tap();
    await page.waitForTimeout(200); const b = await clock(); await page.waitForTimeout(600); assert.equal(await clock(), b, 'Pause freezes actual scene');
    const pause = await page.getByRole('button', { name: 'Resume dream', exact: true }).boundingBox();
    const dock = await page.getByRole('navigation', { name: 'Mobile world navigation' }).boundingBox();
    assert.ok(pause.y + pause.height <= dock.y + 1, 'Pause control clears mobile dock');
    await page.screenshot({ path: path.join(out, 'phone-controls.png') });
    await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.getByRole('button', { name: /Filters/ }).tap();
    const field = page.getByPlaceholder('search public text');
    await field.fill('latency');
    await page.getByRole('button', { name: 'Filter', exact: true }).tap();
    assert.ok(new URL(page.url()).searchParams.get('q') === 'latency', 'Phone filtering updates shareable URL');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    results.push({ id: 'phone-interactions', reducedMotion: 'pass', resume: 'pass', pause: 'pass', dockClearance: 'pass', archiveFilter: 'pass' });
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify({ baseline, results }, null, 2));
  console.log(JSON.stringify({ baseline, results }, null, 2));
}
