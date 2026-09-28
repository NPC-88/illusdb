// node test/editor_test.js  → expanded photo editor: zoom, pan, precise outline points, vertex drag (run build.py first)
// Needs Playwright: NODE_PATH=$(npm root -g) node test/editor_test.js
const path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto('file://' + path.join(__dirname, 'out/preview.html')); await pg.waitForTimeout(1200);
  const P = () => pg.evaluate(() => { const { state } = window.__drafter, p = state.photos[state.active]; return { outline: p.outline.map((o) => o.map((q) => [q.nx, q.ny])), draft: p.draft.length, nat: [p.img.naturalWidth, p.img.naturalHeight] }; });
  const cvBox = () => pg.locator('#photo').boundingBox();

  // open with the button; controls move into the dialog
  await pg.click('#expand');
  assert.ok(await pg.evaluate(() => document.getElementById('editor').open), 'editor opens');
  assert.ok(await pg.evaluate(() => !!document.querySelector('#editor #toolSeg') && !!document.querySelector('#editor #photo') && !!document.querySelector('#editor #sk')), 'tools, photo and silhouette are in the dialog');
  const fit = await cvBox();
  assert.ok(fit.height > 700, 'photo fills the dialog height, got ' + fit.height);

  // zoom in 3× around the centre, check resolution follows
  await pg.click('#zIn'); await pg.click('#zIn'); await pg.click('#zIn');
  const z = await cvBox(); assert.ok(z.width > fit.width * 3, 'zoomed width ' + z.width);
  const res = await pg.evaluate(() => [document.getElementById('photo').width, window.__drafter.state.photos[0].img.naturalWidth]);
  assert.ok(res[0] >= Math.min(res[1], z.width) - 2, 'canvas is sharp at zoom: ' + res);
  assert.match(await pg.innerText('#zVal'), /%/);

  // place a precise triangle while zoomed: clicks land where the pointer is, in photo pixels
  await pg.keyboard.press('o');
  const st = await pg.locator('#edStage').boundingBox();
  const at = async (fx, fy) => { const r = await cvBox(); return [r.x + r.width * fx, r.y + r.height * fy]; };
  const pts = [[0.5, 0.45], [0.53, 0.5], [0.47, 0.5]];
  for (const [fx, fy] of pts) { const [x, y] = await at(fx, fy); assert.ok(x > st.x && x < st.x + st.width && y > st.y && y < st.y + st.height, 'point visible in stage'); await pg.mouse.click(x, y); await pg.waitForTimeout(40); }
  await pg.keyboard.press('Enter');
  let s = await P(); assert.equal(s.outline.length, 1); assert.equal(s.draft, 0);
  const got = s.outline[0][0]; assert.ok(Math.abs(got[0] - 0.5 * s.nat[0]) < 3 && Math.abs(got[1] - 0.45 * s.nat[1]) < 3, 'point accurate to a few photo px: ' + got);

  // drag the first point, then undo the drag
  const [vx, vy] = await at(0.5, 0.45);
  await pg.mouse.move(vx, vy); await pg.mouse.down(); await pg.mouse.move(vx + 40, vy - 30, { steps: 6 }); await pg.mouse.up();
  s = await P(); assert.ok(s.outline[0][0][0] > got[0] + 5, 'vertex moved');
  await pg.keyboard.press('Control+z'); s = await P(); assert.ok(Math.abs(s.outline[0][0][0] - got[0]) < 0.01, 'undo restores the vertex');

  // Space + drag pans the view without editing
  const before = await pg.evaluate(() => [document.getElementById('edStage').scrollLeft, document.getElementById('edStage').scrollTop]);
  await pg.keyboard.down(' '); await pg.mouse.move(st.x + 400, st.y + 400); await pg.mouse.down(); await pg.mouse.move(st.x + 250, st.y + 300, { steps: 5 }); await pg.mouse.up(); await pg.keyboard.up(' ');
  const after = await pg.evaluate(() => [document.getElementById('edStage').scrollLeft, document.getElementById('edStage').scrollTop]);
  assert.ok(after[0] > before[0] + 100 && after[1] > before[1] + 50, 'panned ' + before + ' → ' + after);
  s = await P(); assert.equal(s.outline.length, 1); assert.equal(s.draft, 0);
  await pg.screenshot({ path: path.join(__dirname, 'out/editor_zoom.png') });

  // Ctrl + wheel zooms, 0 fits
  await pg.keyboard.press('0'); assert.equal(await pg.innerText('#zVal'), 'Fit');
  await pg.mouse.move(st.x + st.width / 2, st.y + st.height / 2); await pg.keyboard.down('Control'); await pg.mouse.wheel(0, -400); await pg.keyboard.up('Control');
  assert.notEqual(await pg.innerText('#zVal'), 'Fit');

  // Done puts everything back
  await pg.click('#edClose');
  assert.ok(await pg.evaluate(() => !document.getElementById('editor').open && !!document.querySelector('#drop #photo') && !!document.querySelector('.a-in #toolSeg') && document.getElementById('photo').style.width === ''), 'layout restored');
  await pg.keyboard.press('e'); assert.ok(await pg.evaluate(() => document.getElementById('editor').open), 'E opens the editor');
  await pg.screenshot({ path: path.join(__dirname, 'out/editor_fit.png') });
  await pg.keyboard.press('Escape'); assert.ok(await pg.evaluate(() => !document.getElementById('editor').open), 'Esc closes');

  // narrow screen: dialog stacks, no horizontal page scroll
  await pg.setViewportSize({ width: 400, height: 860 }); await pg.keyboard.press('e'); await pg.waitForTimeout(200);
  assert.ok(await pg.evaluate(() => document.getElementById('editor').scrollWidth <= document.getElementById('editor').clientWidth + 1), 'dialog fits on mobile');
  await pg.screenshot({ path: path.join(__dirname, 'out/editor_mobile.png') });
  assert.deepEqual(errs, []);
  console.log('editor: all checks passed'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
