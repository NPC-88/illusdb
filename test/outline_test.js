// node test/outline_test.js  → drives the Outline tool and undo/redo in test/out/preview.html (run build.py first)
// Needs Playwright: npm i -g playwright, then NODE_PATH=$(npm root -g) node test/outline_test.js
const path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto('file://' + path.join(__dirname, 'out/preview.html')); await pg.waitForTimeout(1200);
  const P = () => pg.evaluate(() => { const { state, $ } = window.__drafter, p = state.photos[state.active]; return { outline: p.outline.length, draft: p.draft.length, crop: p.crop, tol: p.tol, sk: $('sk').toDataURL() }; });
  const box = await pg.locator('#photo').boundingBox();
  const at = (u, v) => [box.x + box.width * u, box.y + box.height * v];
  const before = await P();

  // trace a tower outline inside the example crop and close it by clicking the first point
  await pg.click('#toolSeg button[data-t=outline]');
  const pts = [[0.45, 0.1], [0.62, 0.35], [0.62, 0.85], [0.3, 0.85], [0.3, 0.35]];
  for (const [u, v] of pts) { await pg.mouse.click(...at(u, v)); await pg.waitForTimeout(60); }
  let s = await P(); assert.equal(s.draft, 5, 'five open points');
  await pg.mouse.move(...at(0.5, 0.6)); await pg.screenshot({ path: path.join(__dirname, 'out/outline_open.png') });
  await pg.mouse.click(...at(...pts[0])); await pg.waitForTimeout(400);
  s = await P(); assert.equal(s.outline, 1); assert.equal(s.draft, 0);
  assert.notEqual(s.sk, before.sk, 'silhouette follows the outline');
  await pg.screenshot({ path: path.join(__dirname, 'out/outline_closed.png') });

  // undo reopens it, Backspace drops a point, redo is cleared by a new edit
  await pg.keyboard.press('Control+z'); s = await P(); assert.equal(s.outline, 0); assert.equal(s.draft, 5);
  await pg.keyboard.press('Control+Shift+z'); s = await P(); assert.equal(s.outline, 1);
  await pg.click('#undo'); await pg.keyboard.press('Backspace'); s = await P(); assert.equal(s.draft, 4);
  assert.ok(await pg.isDisabled('#redo'), 'new edit clears redo');
  // double-click closes, Esc drops an open outline
  await pg.mouse.dblclick(...at(0.35, 0.2)); s = await P(); assert.equal(s.outline, 1); assert.equal(s.draft, 0);
  await pg.mouse.click(...at(0.4, 0.4)); await pg.keyboard.press('Escape'); s = await P(); assert.equal(s.draft, 0);

  // crop drag = one step; slider drag = one step
  await pg.click('#toolSeg button[data-t=crop]');
  const crop0 = (await P()).crop;
  await pg.mouse.move(...at(0.2, 0.05)); await pg.mouse.down(); await pg.mouse.move(...at(0.5, 0.5), { steps: 5 }); await pg.mouse.move(...at(0.7, 0.9), { steps: 5 }); await pg.mouse.up();
  assert.notDeepEqual((await P()).crop, crop0);
  await pg.click('#undo'); assert.deepEqual((await P()).crop, crop0, 'undo restores the crop');
  await pg.click('#redo');
  await pg.locator('#skTol').scrollIntoViewIfNeeded(); const tol0 = (await P()).tol, sl = await pg.locator('#skTol').boundingBox();
  await pg.mouse.move(sl.x + sl.width * tol0, sl.y + sl.height / 2); await pg.mouse.down(); await pg.mouse.move(sl.x + sl.width * 0.8, sl.y + sl.height / 2, { steps: 6 }); await pg.mouse.up();
  assert.notEqual((await P()).tol, tol0); await pg.click('#undo'); assert.equal((await P()).tol, tol0, 'one undo per slider drag');
  // undo all the way back to the start
  while (!(await pg.isDisabled('#undo'))) await pg.click('#undo');
  s = await P(); assert.equal(s.outline, 0); assert.equal(s.draft, 0); assert.deepEqual(s.crop, before.crop);

  // narrow layout still fits
  await pg.setViewportSize({ width: 400, height: 900 }); await pg.waitForTimeout(200);
  assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth) <= 400, 'no horizontal scroll on mobile');
  assert.deepEqual(errs, []);
  console.log('outline + undo/redo: all checks passed'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
