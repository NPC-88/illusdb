// node test/figma_ui_test.js  → the Figma plugin UI (figma/ui.html) in a browser, with Figma and Claude simulated
// Starts test/mock_anthropic.js itself. Needs Playwright: NODE_PATH=$(npm root -g) node test/figma_ui_test.js
const path = require('path'), assert = require('assert'), { spawn } = require('child_process');
const { chromium } = require('playwright');
(async () => {
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock_anthropic.js')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 460, height: 860 } });
  const errs = [], posted = [];
  try {
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.route('https://api.anthropic.com/v1/messages', async (route) => {
      const r = await fetch('http://localhost:4010/', { method: 'POST', body: route.request().postData(), headers: { 'x-api-key': route.request().headers()['x-api-key'] } });
      route.fulfill({ status: 200, headers: { 'content-type': r.headers.get('content-type') }, body: Buffer.from(await r.arrayBuffer()) });
    });
    await pg.exposeFunction('__post', (m) => posted.push(m));
    await pg.addInitScript(() => { window.parent.postMessage = (m) => window.__post(m.pluginMessage || m); });
    await pg.goto('file://' + path.join(__dirname, '../figma/ui.html'));
    const fig = (m) => pg.evaluate((m) => window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: m } })), m);
    await fig({ type: 'settings', hasKey: true, key: 'sk-test', model: 'claude-sonnet-5', ws: '' });
    const P = () => pg.evaluate(() => { const { state } = window.__drafter, p = state.photos[state.active]; return { n: state.photos.length, active: state.active, outline: p && p.outline.length, role: p && p.role }; });

    // two photos: one uploaded, one from the Figma selection
    await pg.setInputFiles('#file', path.join(__dirname, '../data/sample_dom.jpg')); await pg.waitForTimeout(500);
    const bytes = [...require('fs').readFileSync(path.join(__dirname, '../data/rathaus_b.jpg'))];
    await pg.evaluate((bytes) => window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { type: 'selection-images', images: [{ name: 'Portal detail', bytes: new Uint8Array(bytes) }] } } })), bytes);
    await pg.waitForTimeout(500);
    let s = await P(); assert.equal(s.n, 2, 'two photos'); assert.equal(s.role, 'angle');
    await pg.selectOption('#pRole', 'detail'); await pg.fill('#pCaption', 'portal arches');

    // outline on the main photo, then undo / redo
    await pg.click('.thumb[data-i="0"]'); await pg.click('#toolSeg button[data-t=outline]');
    const box = await pg.locator('#photo').boundingBox(), at = (u, v) => [box.x + box.width * u, box.y + box.height * v];
    for (const [u, v] of [[0.3, 0.1], [0.7, 0.1], [0.7, 0.9], [0.3, 0.9]]) { await pg.mouse.click(...at(u, v)); await pg.waitForTimeout(40); }
    await pg.keyboard.press('Enter'); s = await P(); assert.equal(s.outline, 1, 'outline closed');
    await pg.click('#undo'); s = await P(); assert.equal(s.outline, 0, 'undo'); await pg.click('#redo'); s = await P(); assert.equal(s.outline, 1, 'redo');
    // silhouette preview and its sliders
    await pg.waitForTimeout(300);
    assert.ok(await pg.evaluate(() => document.getElementById('sk').width > 20), 'silhouette drawn');
    await pg.fill('#skCon', '0.6'); await pg.dispatchEvent('#skCon', 'input'); assert.equal(await pg.innerText('#skConO'), '60%');
    await pg.click('#skInv'); assert.ok(await pg.isChecked('#skInv')); await pg.click('#skInv');

    // draft: both photos go to Claude with roles and captions
    await pg.fill('#landmark', 'Kölner Dom'); await pg.click('#aRun'); await pg.waitForTimeout(2500);
    const j = JSON.parse(require('fs').readFileSync('/tmp/mock_last.json'));
    assert.equal(j.nImages, 2); assert.deepEqual(j.labels, ['Photo 1 (main view, front view):', 'Photo 2 (detail close-up):']);
    assert.ok(j.photoLines.some((l) => l.includes('designer: "portal arches"')), 'caption in prompt'); assert.ok(j.stream && j.maxTokens === 32000 && j.hasFeatures);
    assert.match(await pg.innerText('#aStatus'), /All rules pass/);
    assert.match(await pg.innerText('#aNotes'), /Read from the photos[\s\S]*detail of the portal/);

    // hover a part: its outline is highlighted in the preview
    await pg.hover('.part[data-i="1"]'); await pg.waitForTimeout(100);
    assert.ok(await pg.evaluate(() => !!document.querySelector('#aSheet path[stroke-dasharray="4 3"]')), 'hover highlight');
    await pg.screenshot({ path: path.join(__dirname, 'out/figma_ui.png'), fullPage: true });

    // detail slider, place on canvas
    await pg.fill('#mDetail', '1'); await pg.dispatchEvent('#mDetail', 'input'); assert.match(await pg.innerText('#mDetailO'), /Essential/);
    await pg.click('#place'); assert.ok(posted.some((m) => m.type === 'place-svg' && m.svg.startsWith('<svg')), 'placed');
    // expanded editor inside the plugin window
    await pg.click('#expand'); assert.ok(await pg.evaluate(() => document.getElementById('editor').open)); await pg.click('#edClose'); await pg.waitForTimeout(150);
    assert.ok(await pg.evaluate(() => !!document.querySelector('#drop #photo')));
    // new landmark clears everything
    await pg.click('#newLandmark'); s = await P(); assert.equal(s.n, 0); assert.match(await pg.innerText('#aSheet'), /No draft yet/);
    assert.deepEqual(errs, []);
    console.log('figma plugin UI: all checks passed');
  } finally { await b.close(); mock.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
