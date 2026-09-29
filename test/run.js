// node test/run.js  → renders PNG previews + validation report into test/out
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const C = require('../core/dbsig-core.js');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });

function barsToPNG(res, file, S = 4, photo) {
  const pad = 3, W = (res.W + pad * 2) * S, H = (res.H + pad * 2) * S;
  const pw = photo ? Math.round(photo.width * H / photo.height) : 0;
  const png = new PNG({ width: W + pw, height: H });
  png.data.fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x % S === 0 || y % S === 0) { const i = (y * png.width + x) * 4; png.data[i] = png.data[i + 1] = png.data[i + 2] = 240; }
  for (const b of res.bars) for (let y = (b.y + pad) * S; y < (b.y + b.h + pad) * S; y++) for (let x = (b.x + pad) * S; x < (b.x + b.w + pad) * S; x++) { const i = (y * png.width + x) * 4; png.data[i] = 20; png.data[i + 1] = 20; png.data[i + 2] = 30; }
  if (photo) for (let y = 0; y < H; y++) for (let x = 0; x < pw; x++) {
    const sx = Math.floor(x / pw * photo.width), sy = Math.floor(y / H * photo.height), j = (sy * photo.width + sx) * 4, i = (y * png.width + W + x) * 4;
    png.data[i] = photo.data[j]; png.data[i + 1] = photo.data[j + 1]; png.data[i + 2] = photo.data[j + 2];
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

// 1. ground truth examples through the validator
const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/examples_dp.json')));
console.log('--- validator on DB reference graphics');
for (const [k, g] of Object.entries(ex)) {
  if (k.startsWith('22')) continue;
  const W = Math.max(...g.map((t) => t[0] + t[2])), H = Math.max(...g.map((t) => t[1] + t[3]));
  const bars = g.map(([x, y, w, h]) => ({ x, y: H - y - h, w, h, band: 0 }));
  const v = C.validate({ W, H, bars });
  const by = {}; v.issues.forEach((i) => (by[i.rule] = (by[i.rule] || 0) + 1));
  console.log(k, `bars=${bars.length}`, JSON.stringify(by));
}

// 2. example scene
const r = C.fromScene(C.EXAMPLE_SCENE);
console.log('--- example scene', r.W, r.H, r.bars.length, JSON.stringify(C.validate(r).issues.map((i) => i.rule)));
barsToPNG(r, path.join(out, 'scene_example.png'));
// detail levels: the worked example must pass every rule at each level and lose parts as the level drops
let prevBars = 0;
for (const d of [1, 2, 3]) {
  const w = C.fromScene(C.WORKED_EXAMPLE, { detail: d }), v = C.validate(w);
  console.log(`--- worked example, detail ${d}: ${w.bars.length} bars, ${w.bands.length} rows, ${v.errors} errors, ${v.warns} warnings`);
  if (v.issues.length || w.bars.length <= prevBars) { console.error('detail level check failed'); process.exitCode = 1; }
  prevBars = w.bars.length;
  barsToPNG(w, path.join(out, `worked_detail_${d}.png`));
}
fs.writeFileSync(path.join(out, 'scene_example.svg'), C.toSVG(r));

// 3. trace on photos given on the command line
for (const f of process.argv.slice(2)) {
  const img = PNG.sync.read(fs.readFileSync(f));
  const opt = { height: img.height > img.width * 1.6 ? 150 : 90 };
  const t = C.trace(img, opt);
  const v = C.validate(t);
  console.log('trace', path.basename(f), t.W, t.H, 'bars', t.bars.length, 'bands', t.bands.map((b) => b.y0 + '-' + b.y1 + (b.shift ? 's' : '')).join(','), 'errors', v.errors, 'warns', v.warns);
  barsToPNG(t, path.join(out, 'trace_' + path.basename(f)), 4, img);
}
