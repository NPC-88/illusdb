/*!
 * DB Signature Graphics – shared core
 * Rules source: "Signature Graphics" guideline + "Konstruktion" sheet (DB / Strichpunkt).
 * Used unchanged by the web tool and the Figma plugin.
 *
 * Coordinate system: 1 unit = 1 dp. Internally rows run top-down (y=0 is the top of
 * the graphic, y=H is the baseline). AI "scenes" are written bottom-up (y=0 = ground)
 * and converted on rasterisation.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. The rules (single source of truth)
  // ---------------------------------------------------------------------------
  const RULES = {
    base: 96,            // Grundfläche 96 × 96 dp (ideal size)
    safe: 3,             // Schutzraum 3 dp to every edge
    live: 90,            // 96 − 2 × 3 → usable height at ideal size
    stroke: 2,           // Strichstärke 2 dp
    hGap: 2,             // horizontaler Abstand 2 dp  → column pitch 4 dp
    pitch: 4,
    rowShift: 2,         // rows/elements may be offset horizontally by 2 dp
    minLen: 4,           // Mindestlänge eines Strichs 4 dp
    vGapIdeal: 1,        // vertikaler Abstand 1 dp (ideal)
    vGapRecommended: 4,  // bewusst gesetzte vertikale Lücken 4 dp
    verticalOnly: true,  // only vertical lines – no horizontal or diagonal strokes
    tallMax: 190,        // Extremformen: towers in the examples reach ~150–190 dp
    colors: {
      'DB Red': '#EC0016',
      'Transitional Lilac': '#AA99FF',
      'Cold Black': '#090F1B',
      'Clear White': '#FFFFFF',
      'Grey 300': '#C9CCD2',
      'Grey 200': '#E0E1E4'
    }
  };

  // ---------------------------------------------------------------------------
  // 2. Small helpers
  // ---------------------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const snapW = (w) => Math.max(6, Math.ceil((w - 2) / 4) * 4 + 2); // widths of 4n+2 keep both row phases symmetric

  function pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // ---------------------------------------------------------------------------
  // 3. Scene (AI plan) → coverage sampler
  //    Scene coordinates: dp, origin bottom-left, y up.
  // ---------------------------------------------------------------------------
  function shapeHit(s, x, y) {
    switch (s.type) {
      case 'rect':
        return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
      case 'poly':
        return pointInPoly(x, y, s.points || []);
      case 'ellipse': {
        const dx = (x - s.cx) / s.rx, dy = (y - s.cy) / s.ry;
        return dx * dx + dy * dy <= 1;
      }
      case 'dome': { // upper half ellipse sitting on y = s.y
        if (y < s.y) return false;
        const dx = (x - s.cx) / s.rx, dy = (y - s.y) / s.ry;
        return dx * dx + dy * dy <= 1;
      }
      case 'spire': // triangle: base centred on cx at y, width w, height h
        return pointInPoly(x, y, [[s.cx - s.w / 2, s.y], [s.cx + s.w / 2, s.y], [s.cx, s.y + s.h]]);
      case 'gable':
        return pointInPoly(x, y, [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w / 2, s.y + s.h]]);
      case 'arch': { // rect with a round top: x,y (bottom-left), w, h (total height)
        const r = s.w / 2, cx = s.x + r, spring = s.y + s.h - r;
        if (x < s.x || x >= s.x + s.w || y < s.y) return false;
        if (y < spring) return true;
        const dx = x - cx, dy = y - spring;
        return dx * dx + dy * dy <= r * r;
      }
      case 'pointed': { // Gothic (equilateral) pointed arch: x,y (bottom-left), w, h (total height, apex included)
        if (x < s.x || x >= s.x + s.w || y < s.y || y > s.y + s.h) return false;
        const rise = Math.min(s.h, s.w * 0.866), spring = s.y + s.h - rise;
        if (y < spring) return true;
        const d = (y - spring) / rise * s.w * 0.866; // height above the springing on a true equilateral arch
        return Math.abs(x - (s.x + s.w / 2)) <= Math.sqrt(Math.max(0, s.w * s.w - d * d)) - s.w / 2;
      }
      case 'windows': { // grid of openings inside x,y,w,h; "top": flat (default) | round | pointed
        if (x < s.x || x >= s.x + s.w || y < s.y || y >= s.y + s.h) return false;
        const cols = Math.max(1, s.cols | 0), rows = Math.max(1, s.rows | 0);
        const cw = s.w / cols, rh = s.h / rows;
        const fx = s.fillX != null ? s.fillX : 0.5, fy = s.fillY != null ? s.fillY : 0.6;
        if (s.top === 'round' || s.top === 'pointed') { // each opening is an arch standing in its cell
          const ow = cw * fx, oh = rh * fy, u = ((x - s.x) % cw) - cw / 2, v = ((y - s.y) % rh) - (rh - oh) / 2;
          return shapeHit({ type: s.top === 'round' ? 'arch' : 'pointed', x: -ow / 2, y: 0, w: ow, h: oh }, u, v);
        }
        const lx = ((x - s.x) % cw) / cw, ly = ((y - s.y) % rh) / rh;
        return Math.abs(lx - 0.5) <= fx / 2 && Math.abs(ly - 0.5) <= fy / 2;
      }
      default:
        return false;
    }
  }

  /** Normalise an AI scene: clamp numbers, fix width to 4n+2, centre content. */
  function normalizeScene(scene) {
    const sc = JSON.parse(JSON.stringify(scene || {}));
    sc.height = clamp(Math.round(sc.height || RULES.live), 24, RULES.tallMax);
    const rawW = clamp(Math.round(sc.width || sc.height), 10, 400);
    sc.width = snapW(rawW);
    sc.offsetX = (sc.width - rawW) / 2;
    sc.shapes = (sc.shapes || []).filter((s) => s && s.type);
    for (const s of sc.shapes) if (!s.op) s.op = s.type === 'windows' ? 'cut' : 'add';
    sc.bands = Array.isArray(sc.bands) ? sc.bands : [];
    return sc;
  }

  /** Returns fn(xCentre, yCentreTopDown) → 0/1 for a normalised scene. */
  function sceneSampler(sc) {
    return function (x, yTop) {
      const xs = x - sc.offsetX, ys = sc.height - yTop; // to scene coords (bottom-up)
      let v = 0;
      for (const s of sc.shapes) {
        if (s.op === 'offset' || s.op === 'pier') continue;
        if (shapeHit(s, xs, ys)) { v = s.op === 'cut' ? 0 : 1; continue; }
        const g = +s.gap || 0; // "gap": clear a margin around the part so it reads in front of what is behind it
        if (g > 0 && s.op !== 'cut') {
          const d = g * 0.7071;
          if (shapeHit(s, xs - g, ys) || shapeHit(s, xs + g, ys) || shapeHit(s, xs, ys - g) || shapeHit(s, xs, ys + g) ||
              shapeHit(s, xs - d, ys - d) || shapeHit(s, xs + d, ys - d) || shapeHit(s, xs - d, ys + d) || shapeHit(s, xs + d, ys + d)) v = 0;
        }
      }
      return v;
    };
  }

  /** Detail level of a shape or band: 1 essential, 2 standard, 3 fine. Untagged masses are 1, untagged openings 2. */
  const levelOf = (s) => { const l = Math.round(+s.level); return l >= 1 && l <= 3 ? l : (s.op || (s.type === 'windows' ? 'cut' : 'add')) === 'cut' ? 2 : 1; };
  const bandLevel = (d) => { const l = Math.round(+d.level); return l >= 1 && l <= 3 ? l : 1; };

  /** Bottom-up scene bands: a band above the detail level merges into the band below it (the lowest one into the band above). */
  function mergeFineBands(list, detail) {
    const src = list.slice().sort((a, b) => a.from - b.from), out = [];
    let merged = false, pending = null;
    for (const d of src) {
      if (bandLevel(d) <= detail) { const t = Object.assign({}, d); if (pending != null) { t.from = pending; pending = null; } out.push(t); continue; }
      merged = true;
      if (out.length) out[out.length - 1].to = Math.max(out[out.length - 1].to, d.to);
      else pending = pending == null ? d.from : pending;
    }
    if (pending != null && out.length) out[0].from = Math.min(out[0].from, pending);
    return { bands: out.length ? out : src.slice(0, 1).map((d) => Object.assign({}, d, { level: 1 })), merged };
  }

  /** fn(x, yTop) → true inside an "offset" region (bars there use the other 2 dp phase), or null if the scene has none. */
  function offsetSampler(sc) {
    const regs = sc.shapes.filter((s) => s.op === 'offset');
    if (!regs.length) return null;
    return (x, yTop) => { const xs = x - sc.offsetX, ys = sc.height - yTop; return regs.some((s) => shapeHit(s, xs, ys)); };
  }

  /** Pier regions: [{ shift, inside(x, yTop) }]. Bars in a pier run straight through the row gaps on the pier's own phase. */
  function pierRegions(sc) {
    return sc.shapes.filter((s) => s.op === 'pier').map((s) => ({
      shift: s.shift ? RULES.rowShift : 0,
      inside: (x, yTop) => shapeHit(s, x - sc.offsetX, sc.height - yTop)
    }));
  }

  /** Scene bands (bottom-up {from,to,shift,level}) → top-down band list. */
  function sceneBands(sc, detail) {
    const H = sc.height;
    const m = mergeFineBands(sc.bands, detail == null ? 3 : detail);
    let b = m.bands
      .map((d) => ({ y0: H - Math.round(d.to), y1: H - Math.round(d.from), shift: d.shift ? RULES.rowShift : 0, level: bandLevel(d) }))
      .map((d) => ({ y0: clamp(d.y0, 0, H), y1: clamp(d.y1, 0, H), shift: d.shift, level: d.level }))
      .filter((d) => d.y1 - d.y0 >= 2)
      .sort((a, b) => a.y0 - b.y0);
    return fillBands(b, H); // merged rows keep the shift of the row they joined
  }

  /** Make bands contiguous from 0..H (gaps get the neighbour's opposite shift). */
  function fillBands(b, H) {
    const out = [];
    let y = 0;
    for (const d of b) {
      if (d.y0 > y) out.push({ y0: y, y1: d.y0, shift: d.shift ? 0 : RULES.rowShift, level: 1 });
      const y0 = Math.max(y, d.y0);
      if (d.y1 > y0) out.push({ y0, y1: d.y1, shift: d.shift, level: d.level || 1 });
      y = Math.max(y, d.y1);
    }
    if (y < H) out.push({ y0: y, y1: H, shift: out.length ? (out[out.length - 1].shift ? 0 : RULES.rowShift) : 0, level: 1 });
    return out.length ? out : [{ y0: 0, y1: H, shift: 0, level: 1 }];
  }

  // ---------------------------------------------------------------------------
  // 4. Coverage grid (1 dp cells) – used for band detection and by the trace engine
  // ---------------------------------------------------------------------------
  function gridFromSampler(W, H, sampler) {
    const g = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = sampler(x + 0.5, y + 0.5);
    return g;
  }

  /**
   * Automatic band boundaries from silhouette width changes (+ optional edge profile).
   * Returns top-down bands with alternating shift, bottom band shift 0.
   */
  function detectBands(grid, W, H, opts) {
    const o = Object.assign({ minBand: 8, maxBands: 5, sensitivity: 0.5, edge: null }, opts || {});
    if (o.maxBands <= 1) return [{ y0: 0, y1: H, shift: 0 }];
    const w = new Float32Array(H), l = new Float32Array(H), r = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let n = 0, lo = W, hi = -1;
      for (let x = 0; x < W; x++) if (grid[y * W + x] >= 0.5) { n++; if (x < lo) lo = x; hi = x; }
      w[y] = n; l[y] = lo; r[y] = hi;
    }
    const score = new Float32Array(H);
    let maxW = 1; for (let y = 0; y < H; y++) maxW = Math.max(maxW, w[y]);
    for (let y = 2; y < H - 1; y++) {
      if (w[y] === 0) continue;
      const a = Math.max(w[y - 1], w[y - 2]);
      let s = Math.abs(w[y] - a) / maxW;
      s += (Math.abs(l[y] - l[y - 2]) + Math.abs(r[y] - r[y - 2])) / (2 * maxW) * 0.5;
      if (o.edge) s += o.edge[y] * 0.8;
      score[y] = s;
    }
    const thr = 0.28 * (1.2 - o.sensitivity);
    const cands = [];
    for (let y = 2; y < H - 1; y++) if (score[y] >= thr) cands.push({ y, s: score[y] });
    cands.sort((a, b) => b.s - a.s);
    const picked = [];
    for (const c of cands) {
      if (picked.length >= o.maxBands - 1) break;
      if (c.y < o.minBand * 0.5 || H - c.y < o.minBand) continue;
      if (picked.every((p) => Math.abs(p - c.y) >= o.minBand)) picked.push(c.y);
    }
    picked.sort((a, b) => a - b);
    const cuts = [0, ...picked, H];
    const bands = [];
    for (let i = 0; i < cuts.length - 1; i++) bands.push({ y0: cuts[i], y1: cuts[i + 1], shift: 0 });
    // alternate from the bottom: bottom band shift 0
    for (let i = bands.length - 1, k = 0; i >= 0; i--, k++) bands[i].shift = k % 2 ? RULES.rowShift : 0;
    return bands;
  }

  // ---------------------------------------------------------------------------
  // 5. Renderer: sampler + bands → vertical 2 dp bars that obey the rules
  // ---------------------------------------------------------------------------
  /**
   * @param {number} W width in dp (4n+2 recommended)
   * @param {number} H height in dp
   * @param {(x:number,y:number)=>number} cover coverage (0..1) at a point, top-down
   * @param {{y0:number,y1:number,shift:number}[]} bands top-down, contiguous
   * @returns {{W:number,H:number,bars:{x:number,y:number,w:number,h:number,band:number}[],bands:any[]}}
   */
  function render(W, H, cover, bands, opts) {
    const o = Object.assign({ threshold: 0.5, sample: 'avg', rowGap: RULES.vGapIdeal }, opts || {});
    o.rowGap = o.rowGap >= 4 ? RULES.vGapRecommended : RULES.vGapIdeal;
    const bars = [], off = o.offset; // off(x, y): inside an offset region the bars move to the other 2 dp phase
    const covered = (x, y) => { const a = cover(x + 0.5, y + 0.5), b = cover(x + 1.5, y + 0.5); return (o.sample === 'max' ? Math.max(a, b) : (a + b) / 2) >= o.threshold; };
    bands.forEach((band, bi) => {
      const top = band.y0 > 0 ? band.y0 + o.rowGap : band.y0; // 1 dp gap between rows (4 dp as a deliberate gap)
      const column = (x, alt) => {
        // column cells: coverage of the 2 dp wide column per dp row. A row-phase column steps aside inside an offset
        // region; an other-phase column only exists where it and both its neighbours are inside one (keeps the 2 dp gap).
        const on = [];
        for (let y = top; y < band.y1; y++) {
          const yc = y + 0.5, inOff = off ? off(x + 1, yc) : false;
          const here = alt ? inOff && off(x - 1, yc) && off(x + 3, yc) : !inOff;
          on.push(here && covered(x, y) ? 1 : 0);
        }
        for (const r of cleanRuns(toRuns(on, top), top, band.y1)) bars.push({ x, y: r[0], w: RULES.stroke, h: r[1] - r[0], band: bi });
      };
      for (let x = band.shift; x + RULES.stroke <= W; x += RULES.pitch) column(x, false);
      if (off) for (let x = (band.shift + RULES.rowShift) % RULES.pitch; x + RULES.stroke <= W; x += RULES.pitch) column(x, true);
    });
    const out = o.piers && o.piers.length ? withPiers(W, H, bars, bands, o.piers, covered) : bars;
    out.sort((a, b) => a.band - b.band || a.x - b.x || a.y - b.y);
    return { W, H, bars: out, bands };
  }

  /** Continuous pier bars (ignore row gaps), then trim the row bars around them so every rule still holds. */
  function withPiers(W, H, bars, bands, piers, covered) {
    const bandAt = (y) => { const i = bands.findIndex((b) => y >= b.y0 && y < b.y1); return i < 0 ? bands.length - 1 : i; };
    const pbars = [];
    for (const p of piers) for (let x = p.shift; x + RULES.stroke <= W; x += RULES.pitch) {
      const on = []; let any = false;
      for (let y = 0; y < H; y++) { const v = p.inside(x + 1, y + 0.5) && covered(x, y) ? 1 : 0; on.push(v); any = any || !!v; }
      if (!any) continue;
      for (const r of cleanRuns(toRuns(on, 0), 0, H)) if (!pbars.some((q) => Math.abs(q.x - x) < RULES.pitch && q.y < r[1] && r[0] < q.y + q.h))
        pbars.push({ x, y: r[0], w: RULES.stroke, h: r[1] - r[0], band: bandAt(r[0]), pier: true });
    }
    const out = [];
    for (const b of bars) {
      const keep = new Uint8Array(b.h).fill(1);
      for (const q of pbars) {
        const dx = Math.abs(q.x - b.x); if (dx >= RULES.pitch) continue;
        const m = dx === 0 ? RULES.vGapIdeal : 0; // same column: keep a 1 dp gap; neighbour column: no vertical overlap
        for (let y = Math.max(b.y, q.y - m); y < Math.min(b.y + b.h, q.y + q.h + m); y++) keep[y - b.y] = 0;
      }
      if (keep.every(Boolean)) { out.push(b); continue; }
      for (const r of toRuns(keep, b.y)) if (r[1] - r[0] >= RULES.minLen) out.push({ x: b.x, y: r[0], w: b.w, h: r[1] - r[0], band: b.band });
    }
    return out.concat(pbars);
  }

  function toRuns(on, off) {
    const runs = [];
    let s = -1;
    for (let i = 0; i <= on.length; i++) {
      if (i < on.length && on[i]) { if (s < 0) s = i; }
      else if (s >= 0) { runs.push([s + off, i + off]); s = -1; }
    }
    return runs;
  }

  /** Enforce: gaps are 1 dp or ≥ 4 dp; bars ≥ 4 dp. */
  function cleanRuns(runs, lo, hi) {
    const R = RULES;
    // gaps
    for (let i = 0; i < runs.length - 1; i++) {
      const a = runs[i], b = runs[i + 1];
      const g = b[0] - a[1];
      if (g === 2) a[1] += 1;                       // 2 → 1
      else if (g === 3) {                           // 3 → 4 if the lower bar can afford it, else → 1
        if (b[1] - b[0] - 1 >= R.minLen) b[0] += 1; else a[1] += 2;
      }
    }
    // short bars: extend down into the gap (keeping ≥1 dp), else up, else drop
    const out = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      let len = r[1] - r[0];
      if (len < R.minLen) {
        const next = runs[i + 1] ? runs[i + 1][0] : hi;
        const room = next - r[1] - (runs[i + 1] ? R.vGapIdeal : 0);
        const need = R.minLen - len;
        if (room >= need && (runs[i + 1] ? next - (r[1] + need) !== 2 && next - (r[1] + need) !== 3 : true)) r[1] += need;
        else {
          const prev = out.length ? out[out.length - 1][1] : lo;
          const roomUp = r[0] - prev - (out.length ? R.vGapIdeal : 0);
          if (roomUp >= need) r[0] -= need; else continue;
        }
      }
      out.push(r);
    }
    // final pass: any 2–3 dp gap left after dropping → close to 1 dp by trimming the upper bar's end
    for (let i = 0; i < out.length - 1; i++) {
      const g = out[i + 1][0] - out[i][1];
      if (g === 2 || g === 3) out[i][1] += g - 1;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 6. Validator – checks any bar list against the construction rules
  // ---------------------------------------------------------------------------
  function validate(result) {
    const R = RULES, issues = [];
    const { bars, W, H } = result;
    const add = (level, rule, msg, bar) => issues.push({ level, rule, msg, bar });
    for (const b of bars) {
      if (b.w !== R.stroke) add('error', 'stroke', `Bar width ${b.w} dp (must be ${R.stroke})`, b);
      if (!Number.isInteger(b.x) || !Number.isInteger(b.y) || !Number.isInteger(b.h)) add('error', 'grid', 'Off the 1 dp grid', b);
      if (b.h < R.minLen) add('error', 'minLen', `Bar ${b.h} dp long (min ${R.minLen})`, b);
      if (b.x < 0 || b.x + b.w > W || b.y < 0 || b.y + b.h > H) add('error', 'bounds', 'Outside the drawing area', b);
    }
    // vertical gaps within a column
    const cols = new Map();
    for (const b of bars) { if (!cols.has(b.x)) cols.set(b.x, []); cols.get(b.x).push(b); }
    for (const [, list] of cols) {
      list.sort((a, b) => a.y - b.y);
      for (let i = 0; i < list.length - 1; i++) {
        const g = list[i + 1].y - (list[i].y + list[i].h);
        if (g <= 0) add('error', 'overlap', 'Bars touch/overlap vertically', list[i]);
        else if (g === 2 || g === 3) add('warn', 'vGap', `Vertical gap ${g} dp (use 1 or ≥ 4)`, list[i]);
      }
    }
    // horizontal spacing between vertically overlapping bars
    const sorted = bars.slice().sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length && sorted[j].x < a.x + a.w + R.hGap; j++) {
        const b = sorted[j];
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (overlapY > 0 && b.x !== a.x) add('error', 'hGap', `Horizontal gap ${b.x - a.x - a.w} dp (min ${R.hGap})`, a);
      }
    }
    const errors = issues.filter((i) => i.level === 'error').length;
    const warns = issues.length - errors;
    return { ok: errors === 0, errors, warns, issues };
  }

  // ---------------------------------------------------------------------------
  // 7. Output: SVG
  // ---------------------------------------------------------------------------
  function toSVG(result, opts) {
    const o = Object.assign({ color: RULES.colors['DB Red'], safeArea: true, scale: 1, title: 'DB Signature Graphic', background: null, groupBands: true }, opts || {});
    const pad = o.safeArea ? RULES.safe : 0;
    const vw = result.W + pad * 2, vh = result.H + pad * 2;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw * o.scale}" height="${vh * o.scale}" viewBox="0 0 ${vw} ${vh}">`;
    s += `<title>${esc(o.title)}</title>`;
    if (o.background) s += `<rect width="${vw}" height="${vh}" fill="${o.background}"/>`;
    s += `<g id="${esc(o.title.replace(/\s+/g, '-'))}" fill="${o.color}" transform="translate(${pad} ${pad})">`;
    if (o.groupBands) {
      const nb = result.bands.length;
      for (let i = 0; i < nb; i++) {
        const bs = result.bars.filter((b) => b.band === i);
        if (!bs.length) continue;
        s += `<g id="row-${nb - i}">`;
        for (const b of bs) s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
        s += `</g>`;
      }
    } else for (const b of result.bars) s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
    return s + `</g></svg>`;
  }

  // ---------------------------------------------------------------------------
  // 8. Engine A – AI plan (scene JSON from Claude) → graphic
  // ---------------------------------------------------------------------------
  /**
   * Engine A with designer adjustments. `mods` never touch the construction rules;
   * they reshape the plan (openings, rows, parts, symmetry) before the renderer runs.
   */
  const DEFAULT_MODS = { detail: 3, openingSize: 1, density: 1, simplify: 0, rowDelta: 0, rowOffset: true, rowGap: 1, plinth: false, hidden: [], mirror: 'off' };

  function fromScene(scene, mods) {
    const m = Object.assign({}, DEFAULT_MODS, (scene && scene.render) || {}, mods || {});
    const sc = normalizeScene(applyShapeMods(scene, m));
    const W = sc.width, H = sc.height;
    let sampler = sceneSampler(sc), offset = offsetSampler(sc), piers = pierRegions(sc);
    if (m.mirror === 'left' || m.mirror === 'right') {
      const half = W / 2, mir = (f) => f && (m.mirror === 'left' ? (x, y) => f(x > half ? W - x : x, y) : (x, y) => f(x < half ? W - x : x, y));
      sampler = mir(sampler); offset = mir(offset); piers = piers.map((p) => ({ shift: p.shift, inside: mir(p.inside) }));
    }
    let bands = sc.bands.length ? sceneBands(sc, m.detail) : detectBands(gridFromSampler(W, H, sampler), W, H);
    bands = applyRowMods(bands, H, m);
    const res = render(W, H, sampler, bands, { rowGap: m.rowGap, offset, piers });
    res.scene = sc;
    res.mods = m;
    res.openings = sc._openings;
    res.detail = sc._detail;
    return res;
  }

  /** Area of ONE opening of a cut shape (for "simplify": smallest go first). */
  function openingArea(s) {
    switch (s.type) {
      case 'windows': return (s.w / Math.max(1, s.cols | 0)) * (s.fillX != null ? s.fillX : 0.5) * (s.h / Math.max(1, s.rows | 0)) * (s.fillY != null ? s.fillY : 0.6);
      case 'rect': case 'arch': case 'pointed': return s.w * s.h;
      case 'ellipse': return Math.PI * s.rx * s.ry;
      case 'dome': return Math.PI * s.rx * s.ry / 2;
      case 'gable': case 'spire': return s.w * s.h / 2;
      case 'poly': { const p = s.points || []; let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); }
      default: return 0;
    }
  }

  function scaleOpening(s, f) {
    const t = Object.assign({}, s);
    const r1 = (v) => Math.round(v * 10) / 10;
    switch (t.type) {
      case 'windows':
        t.fillX = clamp((t.fillX != null ? t.fillX : 0.5) * f, 0.15, 0.95);
        t.fillY = clamp((t.fillY != null ? t.fillY : 0.6) * f, 0.15, 0.95);
        break;
      case 'arch': case 'pointed': { const cx = t.x + t.w / 2; t.w = r1(t.w * f); t.h = r1(t.h * f); t.x = r1(cx - t.w / 2); break; } // stays on its base
      case 'rect': { const cx = t.x + t.w / 2, cy = t.y + t.h / 2; t.w = r1(t.w * f); t.h = r1(t.h * f); t.x = r1(cx - t.w / 2); t.y = t.y <= 0.5 ? t.y : r1(cy - t.h / 2); break; }
      case 'ellipse': case 'dome': t.rx = r1(t.rx * f); t.ry = r1(t.ry * f); break;
      case 'gable': { const cx = t.x + t.w / 2; t.w = r1(t.w * f); t.h = r1(t.h * f); t.x = r1(cx - t.w / 2); break; }
      case 'spire': t.w = r1(t.w * f); t.h = r1(t.h * f); break;
      case 'poly': {
        const p = t.points || []; if (!p.length) break;
        const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        t.points = p.map((q) => [r1(cx + (q[0] - cx) * f), r1(cy + (q[1] - cy) * f)]);
        break;
      }
    }
    return t;
  }

  function applyShapeMods(scene, m) {
    const sc = JSON.parse(JSON.stringify(scene || {}));
    const hidden = new Set(m.hidden || []);
    let shapes = (sc.shapes || []).map((s, i) => (s && s.type ? Object.assign({}, s, { _i: i }) : null)).filter(Boolean);
    shapes = shapes.filter((s) => !hidden.has(s._i));
    const detail = clamp(Math.round(m.detail == null ? 3 : m.detail), 1, 3);
    const byLevel = [0, 0, 0, 0]; shapes.forEach((s) => byLevel[levelOf(s)]++);
    sc._detail = { level: detail, hidden: shapes.filter((s) => levelOf(s) > detail).length, byLevel: byLevel.slice(1),
      bandsByLevel: [1, 2, 3].map((l) => (sc.bands || []).filter((d) => bandLevel(d) === l).length) };
    shapes = shapes.filter((s) => levelOf(s) <= detail);
    const isCut = (s) => (s.op || (s.type === 'windows' ? 'cut' : 'add')) === 'cut';
    shapes = shapes.map((s) => {
      if (!isCut(s)) return s;
      let t = s;
      if (t.type === 'windows' && m.density !== 1) {
        t = Object.assign({}, t, { cols: Math.max(1, Math.round((t.cols || 1) * m.density)), rows: Math.max(1, Math.round((t.rows || 1) * m.density)) });
      }
      if (m.openingSize !== 1) t = scaleOpening(t, m.openingSize);
      return t;
    });
    const cuts = shapes.filter(isCut).sort((a, b) => openingArea(a) - openingArea(b));
    const drop = new Set(cuts.slice(0, Math.round(clamp(m.simplify, 0, 1) * cuts.length)).map((s) => s._i));
    sc._openings = { total: cuts.length, kept: cuts.length - drop.size };
    sc.shapes = shapes.filter((s) => !drop.has(s._i));
    return sc;
  }

  function alternate(bands) {
    for (let i = bands.length - 1, k = 0; i >= 0; i--, k++) bands[i].shift = k % 2 ? RULES.rowShift : 0;
    return bands;
  }

  function applyRowMods(bands, H, m) {
    let b = bands.map((x) => Object.assign({}, x));
    let changed = false;
    const minBand = 6;
    for (let n = m.rowDelta; n < 0 && b.length > 1; n++) { // merge the thinnest row into its thinner neighbour
      let i = 0; b.forEach((x, k) => { if (x.y1 - x.y0 < b[i].y1 - b[i].y0) i = k; });
      const j = i === 0 ? 1 : i === b.length - 1 ? i - 1 : ((b[i - 1].y1 - b[i - 1].y0) <= (b[i + 1].y1 - b[i + 1].y0) ? i - 1 : i + 1);
      const lo = Math.min(i, j), hi = Math.max(i, j);
      b.splice(lo, 2, { y0: b[lo].y0, y1: b[hi].y1, shift: b[hi].shift, level: Math.min(b[lo].level || 1, b[hi].level || 1) });
      changed = true;
    }
    for (let n = 0; n < m.rowDelta; n++) { // split the tallest row in the middle
      let i = 0; b.forEach((x, k) => { if (x.y1 - x.y0 > b[i].y1 - b[i].y0) i = k; });
      const h = b[i].y1 - b[i].y0; if (h < minBand * 2) break;
      const mid = b[i].y0 + Math.round(h / 2);
      b.splice(i, 1, { y0: b[i].y0, y1: mid, shift: 0, level: b[i].level || 1 }, { y0: mid, y1: b[i].y1, shift: 0, level: b[i].level || 1 });
      changed = true;
    }
    if (m.plinth) {
      const ph = H >= 120 ? 8 : 6, last = b[b.length - 1];
      if (last && last.y1 - last.y0 >= ph + minBand) {
        b.splice(b.length - 1, 1, { y0: last.y0, y1: H - ph, shift: 0, level: last.level || 1 }, { y0: H - ph, y1: H, shift: 0, level: 1 });
        changed = true;
      }
    }
    if (changed) alternate(b);
    if (!m.rowOffset) b.forEach((x) => (x.shift = 0));
    return b;
  }

  /** Write the adjustments into the plan itself (used before a Claude revision). */
  function bakeScene(scene, mods) {
    const m = Object.assign({}, DEFAULT_MODS, (scene && scene.render) || {}, mods || {});
    const res = fromScene(scene, m);
    const sc = res.scene, H = sc.height;
    const out = JSON.parse(JSON.stringify(scene));
    out.shapes = sc.shapes.map((s) => { const t = Object.assign({}, s); delete t._i; return t; });
    out.bands = res.bands.slice().reverse().map((b) => Object.assign({ from: H - b.y1, to: H - b.y0, shift: b.shift ? 2 : 0 }, b.level > 1 ? { level: b.level } : {}));
    out.render = { mirror: m.mirror, rowGap: m.rowGap };
    return out;
  }

  // ---------------------------------------------------------------------------
  // 9. Engine B – trace + snap (no AI): photo pixels → coverage → graphic
  // ---------------------------------------------------------------------------
  /**
   * Rasterise designer outlines (even-odd scanline fill) at working resolution.
   * @param {Array<Array<{u:number,v:number}>>} polys polygons in crop-normalised coords (0..1, y down)
   * @returns {Uint8Array|null} 1 = inside any polygon; null when there is no usable polygon
   */
  function outlineMask(polys, Wp, Hp, offPx, cw) {
    const list = (polys || []).filter((p) => p && p.length >= 3);
    if (!list.length) return null;
    const m = new Uint8Array(Wp * Hp);
    for (const poly of list) {
      const pts = poly.map((q) => [offPx + q.u * cw, q.v * Hp]);
      for (let y = 0; y < Hp; y++) {
        const yc = y + 0.5, xs = [];
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          const [xa, ya] = pts[a], [xb, yb] = pts[b];
          if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) / (yb - ya) * (xb - xa));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2)
          for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(Wp, Math.ceil(xs[k + 1] - 0.5)); x++) m[y * Wp + x] = 1;
      }
    }
    return m;
  }

  /**
   * @param {{width:number,height:number,data:Uint8ClampedArray}} img RGBA, already cropped to the building
   * @param {object} opts height (dp), skyTol (0..1), detail (0..1), bands (max), sensitivity, plinth
   */
  function trace(img, opts) {
    const o = Object.assign({ height: RULES.live, skyTol: 0.5, detail: 0.5, bands: 4, sensitivity: 0.5, invert: false, plinth: false }, opts || {});
    const H = clamp(Math.round(o.height), 24, RULES.tallMax);
    const PX = 4;                                 // working resolution: px per dp
    const Hp = H * PX;
    const rawWdp = img.width / img.height * H;
    const W = snapW(rawWdp + 4);                  // 4 dp spare for the phase search
    const Wp = W * PX;
    const offPx = Math.round((W - rawWdp) / 2 * PX);
    const cw = Math.max(1, Wp - 2 * offPx);
    // resample (area average) to working res
    const lab = new Float32Array(Wp * Hp * 3).fill(-1), valid = new Uint8Array(Wp * Hp);
    const sx = img.width / cw, sy = img.height / Hp;
    for (let y = 0; y < Hp; y++) {
      for (let x = offPx; x < offPx + cw; x++) {
        const x0 = Math.floor((x - offPx) * sx), x1 = Math.max(x0 + 1, Math.floor((x - offPx + 1) * sx));
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y0; yy < y1 && yy < img.height; yy += Math.max(1, (y1 - y0) >> 2))
          for (let xx = x0; xx < x1 && xx < img.width; xx += Math.max(1, (x1 - x0) >> 2)) {
            const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
          }
        const L = toLab(r / n, g / n, b / n), k = (y * Wp + x) * 3;
        lab[k] = L[0]; lab[k + 1] = L[1]; lab[k + 2] = L[2]; valid[y * Wp + x] = 1;
      }
    }
    // --- sky model: designer picks if given, else the top rows + top corners
    const med = (arr) => { const a = arr.slice().sort((p, q) => p - q); return a[a.length >> 1]; };
    const skyPicks = (o.skySamples || []).filter((q) => q && q.lab), bPicks = (o.buildSamples || []).filter((q) => q && q.lab);
    let skyCols;
    if (skyPicks.length) skyCols = skyPicks.map((q) => q.lab);
    else {
      const samples = [];
      const topRows = Math.max(2, Math.round(Hp * 0.04));
      for (let y = 0; y < topRows; y++) for (let x = offPx; x < offPx + cw; x += 2) samples.push(y * Wp + x);
      for (let y = 0; y < Hp * 0.35; y += 2) { samples.push(y * Wp + offPx); samples.push(y * Wp + offPx + cw - 1); }
      skyCols = [[0, 1, 2].map((c) => med(samples.map((i) => lab[i * 3 + c])))];
    }
    const cdist = (i, cols) => {
      let best = 1e9;
      for (const c of cols) { const d0 = lab[i * 3] - c[0], d1 = lab[i * 3 + 1] - c[1], d2 = lab[i * 3 + 2] - c[2]; const d = d0 * d0 * 0.6 + d1 * d1 + d2 * d2; if (d < best) best = d; }
      return Math.sqrt(best);
    };
    const dist = new Float32Array(Wp * Hp);
    const dl = [];
    for (let i = 0; i < Wp * Hp; i++) {
      if (!valid[i]) { dist[i] = 0; continue; }
      dist[i] = cdist(i, skyCols);
      if (bPicks.length) { // two-class: compare with the building picks
        const db = cdist(i, bPicks.map((q) => q.lab));
        dist[i] = dist[i] / Math.max(1e-3, dist[i] + db) * 100; // 0 = sky-like … 100 = building-like
      }
      dl.push(dist[i]);
    }
    let thr = bPicks.length ? 50 * (0.55 + (1 - o.skyTol) * 0.9) : otsu(dl) * (0.45 + (1 - o.skyTol) * 1.1); // skyTol ↑ → more is building
    // --- sky = low distance region connected to the top edge / sides / sky picks (flood fill)
    const isSky = new Uint8Array(Wp * Hp);
    const stack = [];
    // designer outline (polygons in crop-normalised u/v): outside is sky, inside is building unless flooded from a sky pick
    const inside = outlineMask(o.outline, Wp, Hp, offPx, cw);
    if (inside) for (let i = 0; i < Wp * Hp; i++) if (valid[i] && !inside[i]) isSky[i] = 1;
    const seed = (i) => { if (i >= 0 && i < Wp * Hp && valid[i] && !isSky[i] && dist[i] < thr) { isSky[i] = 1; stack.push(i); } };
    if (!inside) {
      for (let x = offPx; x < offPx + cw; x++) seed(x);
      for (let y = 0; y < Hp * 0.4; y++) { seed(y * Wp + offPx); seed(y * Wp + offPx + cw - 1); }
    }
    for (const q of skyPicks) if (q.u != null) { const x = Math.round(offPx + q.u * (cw - 1)), y = Math.round(q.v * (Hp - 1)); const i = y * Wp + x; if (valid[i] && !isSky[i]) { isSky[i] = 1; stack.push(i); } }
    while (stack.length) {
      const i = stack.pop(), x = i % Wp, y = (i / Wp) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < Wp - 1 ? i + 1 : -1, y > 0 ? i - Wp : -1, y < Hp - 1 ? i + Wp : -1];
      for (const j of nb) if (j >= 0 && valid[j] && !isSky[j] && dist[j] < thr) { isSky[j] = 1; stack.push(j); }
    }
    let cov = new Float32Array(Wp * Hp);
    for (let i = 0; i < Wp * Hp; i++) cov[i] = valid[i] && !isSky[i] ? 1 : 0;
    if (o.invert && !inside) for (let i = 0; i < Wp * Hp; i++) cov[i] = valid[i] ? 1 - cov[i] : 0; // the outline already says what is sky
    // --- keep only building parts that stand on the ground (drops clouds, birds, floating specks); an outline is explicit, so skip it
    if (o.groundOnly !== false && !inside) {
      const keep = new Uint8Array(Wp * Hp), st = [];
      for (let x = 0; x < Wp; x++) { const i = (Hp - 1) * Wp + x; if (cov[i]) { keep[i] = 1; st.push(i); } }
      while (st.length) {
        const i = st.pop(), x = i % Wp, y = (i / Wp) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < Wp - 1 ? i + 1 : -1, y > 0 ? i - Wp : -1, y < Hp - 1 ? i + Wp : -1])
          if (j >= 0 && cov[j] && !keep[j]) { keep[j] = 1; st.push(j); }
      }
      let kept = 0; for (let i = 0; i < Wp * Hp; i++) kept += keep[i];
      if (kept > Wp * Hp * 0.02) for (let i = 0; i < Wp * Hp; i++) cov[i] = keep[i] ? cov[i] : 0;
    }
    // remove specks: morphological open then close (radius ~1 dp)
    cov = morph(cov, Wp, Hp, PX, 'open');
    cov = morph(cov, Wp, Hp, PX, 'close');
    // --- interior detail: openings darker than their surroundings
    const detail = clamp(o.detail, 0, 1);
    if (detail > 0.02) {
      const Lc = new Float32Array(Wp * Hp);
      for (let i = 0; i < Wp * Hp; i++) Lc[i] = lab[i * 3];
      const R = PX * 6;
      const mean = boxBlur(Lc, Wp, Hp, R), sq = boxBlur(Lc.map((v) => v * v), Wp, Hp, R);
      const k = 1.6 - detail * 1.3;
      const hole = new Float32Array(Wp * Hp);
      for (let i = 0; i < Wp * Hp; i++) {
        if (!cov[i]) continue;
        const sd = Math.sqrt(Math.max(0, sq[i] - mean[i] * mean[i]));
        if (Lc[i] < mean[i] - k * Math.max(4, sd)) hole[i] = 1;
      }
      let h2 = morph(hole, Wp, Hp, PX, 'open');         // only openings ≥ ~2 dp survive
      h2 = keepBlobs(h2, Wp, Hp, PX * 3, PX * 4);       // → rectangles ≥ 3 dp wide, ≥ 4 dp tall
      // do not punch holes in the outer 2 dp of the silhouette
      const er = morph(cov, Wp, Hp, PX * 2, 'erode');
      for (let i = 0; i < Wp * Hp; i++) if (h2[i] && er[i]) cov[i] = 0;
    }
    // --- dp grid for band detection + edge profile (horizontal architectural lines)
    const grid = new Float32Array(W * H);
    const edge = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let e = 0, n = 0;
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let yy = 0; yy < PX; yy++) for (let xx = 0; xx < PX; xx++) s += cov[(y * PX + yy) * Wp + x * PX + xx];
        grid[y * W + x] = s / (PX * PX);
        if (y > 0 && grid[y * W + x] > 0.5) {
          const a = lab[(y * PX * Wp + x * PX) * 3], b = lab[((y * PX - PX) * Wp + x * PX) * 3];
          if (a >= 0 && b >= 0) { e += Math.abs(a - b); n++; }
        }
      }
      edge[y] = n ? e / n / 40 : 0;
    }
    let bands = detectBands(grid, W, H, { maxBands: o.bands, sensitivity: o.sensitivity, edge });
    if (o.plinth && H > 30) {
      const ph = 8;
      bands = bands.filter((b) => b.y0 < H - ph).map((b) => ({ ...b, y1: Math.min(b.y1, H - ph) }));
      const last = bands[bands.length - 1];
      bands.push({ y0: H - ph, y1: H, shift: last && last.shift ? 0 : RULES.rowShift });
    }
    const makeCover = (dx) => (x, y) => {
      const xi = Math.floor((x - dx) * PX), yi = clamp(Math.floor(y * PX), 0, Hp - 1);
      if (xi < 0 || xi >= Wp) return 0;
      let s = 0;
      for (let d = -1; d <= 1; d++) s += cov[yi * Wp + clamp(xi + d, 0, Wp - 1)];
      return s / 3;
    };
    // phase search: slide the image 0–3 dp under the column grid, keep the most faithful result
    let best = null;
    for (const dx of [-2, -1, 0, 1]) {
      const res = render(W, H, makeCover(dx), bands, { sample: 'max' });
      const solid = new Uint8Array(W * H);
      for (const b of res.bars) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x - 1; x < b.x + b.w + 1; x++) if (x >= 0 && x < W) solid[y * W + x] = 1;
      let inter = 0, uni = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const xs = x - dx; const g = xs >= 0 && xs < W ? grid[y * W + xs] >= 0.5 : false;
        const sb = solid[y * W + x] === 1;
        if (g && sb) inter++; if (g || sb) uni++;
      }
      const score = uni ? inter / uni : 0;
      if (!best || score > best.score) { best = res; best.score = score; }
    }
    best.debug = { cov, Wp, Hp, PX, lab, valid, W, H };
    return best;
  }

  function toLab(r, g, b) {
    const f = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
    const R = f(r), G = f(g), B = f(b);
    let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const h = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    X = h(X); Y = h(Y); Z = h(Z);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  function otsu(vals) {
    if (!vals.length) return 20;
    let max = 0; for (const v of vals) if (v > max) max = v;
    const bins = 64, hist = new Float64Array(bins);
    for (const v of vals) hist[Math.min(bins - 1, Math.floor(v / (max + 1e-6) * bins))]++;
    const tot = vals.length; let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, bi = 0;
    for (let i = 0; i < bins; i++) {
      wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break;
      sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; bi = i; }
    }
    return (bi + 0.5) / bins * max;
  }
  function boxBlur(a, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) { let s = 0, n = 0; for (let x = -r; x < W; x++) { if (x + r < W) { s += a[y * W + x + r]; n++; } if (x - r - 1 >= 0) { s -= a[y * W + x - r - 1]; n--; } if (x >= 0) tmp[y * W + x] = s / n; } }
    for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let y = -r; y < H; y++) { if (y + r < H) { s += tmp[(y + r) * W + x]; n++; } if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * W + x]; n--; } if (y >= 0) out[y * W + x] = s / n; } }
    return out;
  }
  function morph(a, W, H, r, op) {
    const b = boxBlur(a, W, H, Math.max(1, r >> 1));
    const er = (src) => src.map((v) => (v > 0.999 ? 1 : 0));
    const di = (src) => src.map((v) => (v > 0.001 ? 1 : 0));
    if (op === 'erode') return er(b);
    if (op === 'dilate') return di(b);
    if (op === 'open') return di(boxBlur(er(b), W, H, Math.max(1, r >> 1)));
    if (op === 'close') return er(boxBlur(di(b), W, H, Math.max(1, r >> 1)));
    return a;
  }
  function keepBlobs(a, W, H, minW, minH) {
    const lab = new Int32Array(W * H), out = new Float32Array(W * H);
    let id = 0;
    for (let i = 0; i < W * H; i++) {
      if (!a[i] || lab[i]) continue;
      id++; const st = [i]; lab[i] = id; const px = [];
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      while (st.length) {
        const j = st.pop(); px.push(j); const x = j % W, y = (j / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1])
          if (k >= 0 && a[k] && !lab[k]) { lab[k] = id; st.push(k); }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw >= minW && bh >= minH * 0.5 && bw < W * 0.6 && bh < H * 0.6 && px.length > bw * bh * 0.35) {
        // openings become clean rectangles, at least minW wide and minH tall
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const hw = Math.max(bw, minW) / 2, hh = Math.max(bh, minH) / 2;
        for (let y = Math.max(0, Math.round(cy - hh)); y < Math.min(H, Math.round(cy + hh)); y++)
          for (let x = Math.max(0, Math.round(cx - hw)); x < Math.min(W, Math.round(cx + hw)); x++) out[y * W + x] = 1;
      }
    }
    return out;
  }

  /**
   * A text "sketch" of the cropped photo for Claude: silhouette + tone on a coarse dp grid.
   * Used when the viewer cannot send images, and as extra measurement context when it can.
   * One character = cell × cell dp. '.' = sky/background, 0–9 = building tone (0 darkest, 9 lightest).
   */
  function sketch(img, opts) {
    const o = Object.assign({ height: RULES.live, cell: 2, skyTol: 0.5, invert: false, contrast: 0.3, skySamples: [], buildSamples: [] }, opts || {});
    const t = trace(img, { height: o.height, skyTol: o.skyTol, invert: o.invert, detail: 0, bands: 1, skySamples: o.skySamples, buildSamples: o.buildSamples, outline: o.outline });
    const { cov, Wp, Hp, PX, lab, valid, W, H } = t.debug;
    const c = o.cell, cp = c * PX;
    // columns that actually hold photo pixels
    let x0 = Wp, x1 = 0;
    for (let x = 0; x < Wp; x++) if (valid[x]) { if (x < x0) x0 = x; x1 = x; }
    const cols = Math.max(1, Math.round((x1 - x0 + 1) / cp)), rows = Math.round(Hp / cp);
    // tone range inside the building
    const Ls = [];
    for (let i = 0; i < Wp * Hp; i += 3) if (cov[i] && valid[i]) Ls.push(lab[i * 3]);
    Ls.sort((a, b) => a - b);
    const pct = (p) => Ls.length ? Ls[Math.min(Ls.length - 1, Math.floor(p * Ls.length))] : 50;
    const lo = pct(0.02), hi = pct(0.98), span = Math.max(8, hi - lo), mid = (pct(0.5) - lo) / span;
    const gain = 1 + clamp(o.contrast, 0, 1) * 5;   // contrast ↑ → tones pushed to the extremes, only strong features stay
    const lines = [];
    let filled = 0;
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let q = 0; q < cols; q++) {
        let n = 0, b = 0, L = 0;
        for (let y = r * cp; y < Math.min(Hp, (r + 1) * cp); y++) for (let x = x0 + q * cp; x < Math.min(x1 + 1, x0 + (q + 1) * cp); x++) {
          const i = y * Wp + x; n++; if (cov[i]) { b++; L += lab[i * 3]; }
        }
        if (!n || b / n < 0.5) line += '.';
        else { const v = clamp(0.5 + ((L / b - lo) / span - mid) * gain, 0, 0.999); line += String(Math.floor(v * 10)); filled++; }
      }
      lines.push(line);
    }
    return { text: lines.join('\n'), cols, rows, cell: c, widthDp: Math.round(cols * c), heightDp: Math.round(rows * c), coverage: filled / (cols * rows), mask: { cov, Wp, Hp, x0, x1 } };
  }

  /**
   * Measured features of the cropped photo, for Claude: openings (windows, arches, portals) grouped
   * into rows, towers/spires from the skyline profile, and strong horizontal lines (cornices, eaves).
   * Coordinates: dp, origin bottom-left of the crop, same frame as sketch().
   */
  function analyze(img, opts) {
    const o = Object.assign({ height: RULES.live, skyTol: 0.5, invert: false, contrast: 0.3, skySamples: [], buildSamples: [] }, opts || {});
    const t = trace(img, { height: o.height, skyTol: o.skyTol, invert: o.invert, detail: 0, bands: 1, skySamples: o.skySamples, buildSamples: o.buildSamples, outline: o.outline });
    const { cov, Wp, Hp, PX, lab, valid } = t.debug;
    let x0 = Wp, x1 = 0;
    for (let x = 0; x < Wp; x++) if (valid[x]) { if (x < x0) x0 = x; x1 = x; }
    const toX = (px) => Math.round((px - x0) / PX * 10) / 10, toY = (py) => Math.round((Hp - py) / PX * 10) / 10;
    const r1 = (v) => Math.round(v * 10) / 10;
    // --- openings: pixels clearly darker than their neighbourhood, inside the building (not at its edge)
    const L = new Float32Array(Wp * Hp); for (let i = 0; i < Wp * Hp; i++) L[i] = lab[i * 3];
    const R = PX * 5, mean = boxBlur(L, Wp, Hp, R), sq = boxBlur(L.map((v) => v * v), Wp, Hp, R);
    const inner = morph(cov, Wp, Hp, PX * 2, 'erode');
    const k = 0.45 + clamp(o.contrast, 0, 1) * 1.3;
    const hole = new Float32Array(Wp * Hp);
    for (let i = 0; i < Wp * Hp; i++) {
      if (!inner[i]) continue;
      const sd = Math.sqrt(Math.max(0, sq[i] - mean[i] * mean[i]));
      if (L[i] < mean[i] - k * Math.max(3, sd)) hole[i] = 1;
    }
    const h2 = morph(hole, Wp, Hp, 2, 'open');
    const seen = new Int32Array(Wp * Hp), rects = [];
    let bx0 = Wp, bx1 = 0, by0 = Hp; // building bbox
    for (let i = 0; i < Wp * Hp; i++) if (cov[i]) { const x = i % Wp, y = (i / Wp) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; }
    const bw = Math.max(1, bx1 - bx0), bh = Math.max(1, Hp - by0);
    for (let i = 0; i < Wp * Hp; i++) {
      if (!h2[i] || seen[i]) continue;
      const st = [i]; seen[i] = 1; let n = 0, ax = Wp, bx = 0, ay = Hp, byy = 0;
      while (st.length) {
        const j = st.pop(); n++; const x = j % Wp, y = (j / Wp) | 0;
        if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > byy) byy = y;
        for (const q of [x > 0 ? j - 1 : -1, x < Wp - 1 ? j + 1 : -1, y > 0 ? j - Wp : -1, y < Hp - 1 ? j + Wp : -1]) if (q >= 0 && h2[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
      const w = bx - ax + 1, h = byy - ay + 1;
      if (w < PX * 1.2 || h < PX * 2 || w > bw * 0.45 || h > bh * 0.5 || n < w * h * 0.4) continue;
      rects.push({ px: { x: ax, y: ay, w, h }, x: toX(ax), y: toY(byy + 1), w: r1(w / PX), h: r1(h / PX), cx: (ax + bx) / 2, cy: (ay + byy) / 2 });
    }
    // --- group openings into rows (similar centre height)
    rects.sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const r of rects) {
      const row = rows.find((g) => Math.abs(g.cy - r.cy) < Math.max(PX * 2, g.h * 0.45) && Math.abs(g.h - r.px.h) < g.h * 0.8);
      if (row) { row.items.push(r); row.cy = row.items.reduce((s2, q) => s2 + q.cy, 0) / row.items.length; row.h = row.items.reduce((s2, q) => s2 + q.px.h, 0) / row.items.length; }
      else rows.push({ cy: r.cy, h: r.px.h, items: [r] });
    }
    const med = (arr) => { const a = arr.slice().sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 0; };
    const rowOut = rows.filter((g) => g.items.length >= 2).map((g) => {
      const it = g.items.sort((a, b) => a.x - b.x);
      const xs = it.map((q) => q.x), gaps = xs.slice(1).map((x, i) => x - xs[i]);
      return { count: it.length, y: r1(med(it.map((q) => q.y))), h: r1(med(it.map((q) => q.h))), w: r1(med(it.map((q) => q.w))), xFrom: r1(xs[0]), xTo: r1(it[it.length - 1].x + it[it.length - 1].w), pitch: r1(med(gaps)) };
    }).filter((r) => r.count >= 3 || r.h >= 6).sort((a, b) => b.count - a.count).slice(0, 8).sort((a, b) => a.y - b.y);
    const singles = rows.filter((g) => g.items.length === 1).map((g) => g.items[0]).filter((q) => q.w * q.h >= 16)
      .sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 8).map((q) => ({ x: q.x, y: q.y, w: q.w, h: q.h }));
    // --- skyline profile per 2 dp column (height of the building top above ground)
    const colW = PX * 2, profile = [];
    for (let x = x0; x <= x1; x += colW) {
      let top = Hp;
      for (let y = 0; y < Hp && top === Hp; y++) for (let xx = x; xx < Math.min(x1 + 1, x + colW); xx++) if (cov[y * Wp + xx]) { top = y; break; }
      profile.push(Math.round((Hp - top) / PX));
    }
    // towers/spires: local maxima clearly above their surroundings
    const peaks = [];
    for (let i = 0; i < profile.length; i++) {
      const v = profile[i]; if (!v) continue;
      let l = i, r = i; while (l > 0 && profile[l - 1] >= v - 2) l--; while (r < profile.length - 1 && profile[r + 1] >= v - 2) r++;
      if (i !== l) continue; // report each plateau once
      const around = Math.max(Math.min(...profile.slice(Math.max(0, l - 6), l).concat([v])), Math.min(...profile.slice(r + 1, r + 7).concat([v])));
      const prom = v - around;
      if (prom >= 6) peaks.push({ x: (l + r + 1) / 2 * 2, top: v, width: (r - l + 1) * 2, prominence: prom });
    }
    peaks.sort((a, b) => b.prominence - a.prominence);
    for (let i = peaks.length - 1; i >= 0; i--) if (peaks.slice(0, i).some((q) => Math.abs(q.x - peaks[i].x) < Math.max(q.width, 6))) peaks.splice(i, 1);
    // --- horizontal lines: strong vertical gradient across the building width
    const lines = [], score = [];
    for (let y = PX; y < Hp - PX; y++) {
      let e = 0, n = 0;
      for (let x = x0; x <= x1; x += 2) { const i = y * Wp + x; if (!cov[i] || !cov[i - PX * Wp]) continue; e += Math.abs(L[i] - L[i - PX * Wp]); n++; }
      score.push({ y, s: n > (x1 - x0) * 0.15 ? e / n : 0 });
    }
    score.sort((a, b) => b.s - a.s);
    for (const c of score) { if (lines.length >= 6 || c.s < 8) break; if (lines.every((q) => Math.abs(q - c.y) > PX * 4)) lines.push(c.y); }
    return {
      widthDp: Math.round((x1 - x0 + 1) / PX), heightDp: Math.round(Hp / PX),
      rows: rowOut, singles, peaks: peaks.slice(0, 5), lines: lines.map(toY).sort((a, b) => a - b), profile,
      rects: rects.map((q) => q.px), frame: { x0, x1, Wp, Hp }
    };
  }

  function featuresText(f) {
    if (!f) return '';
    const L = [];
    L.push(`Measured on the photo (dp, origin bottom-left of the crop, ${f.widthDp} × ${f.heightDp} dp):`);
    L.push('- Skyline profile, building height above ground every 2 dp from left to right: ' + f.profile.join(' '));
    if (f.peaks.length) L.push('- Towers / spires / high points: ' + f.peaks.map((p) => `x≈${p.x} (width ≈${p.width}) up to ${p.top}`).join('; '));
    if (f.lines.length) L.push('- Strong horizontal lines (cornices, eaves, floor bands) at y ≈ ' + f.lines.join(', '));
    if (f.rows.length) L.push('- Rows of openings (windows, arcades): ' + f.rows.map((r) => `${r.count} openings at y≈${r.y} (each ≈${r.w} wide × ${r.h} tall), from x≈${r.xFrom} to ${r.xTo}, pitch ≈${r.pitch}`).join('; '));
    if (f.singles.length) L.push('- Larger single openings (portals, rose windows, big arches): ' + f.singles.map((q) => `${q.w}×${q.h} at x≈${q.x}, y≈${q.y}`).join('; '));
    L.push('These measurements are automatic and can include shadows, trees or people. Use them for positions and rhythm; keep only what belongs to the building.');
    return L.join('\n');
  }

  /** SVG path of a shape's outline in plan coordinates (y up), for hover highlighting in the front ends. */
  function shapePath(s){
    const n = (v) => Math.round(v*100)/100;
    switch (s.type) {
      case 'rect': case 'windows': return `M${n(s.x)} ${n(s.y)}h${n(s.w)}v${n(s.h)}h${n(-s.w)}Z`;
      case 'poly': return (s.points||[]).map((p,i)=>(i?'L':'M')+n(p[0])+' '+n(p[1])).join('') + 'Z';
      case 'gable': return `M${n(s.x)} ${n(s.y)}L${n(s.x+s.w)} ${n(s.y)}L${n(s.x+s.w/2)} ${n(s.y+s.h)}Z`;
      case 'spire': return `M${n(s.cx-s.w/2)} ${n(s.y)}L${n(s.cx+s.w/2)} ${n(s.y)}L${n(s.cx)} ${n(s.y+s.h)}Z`;
      case 'ellipse': return `M${n(s.cx-s.rx)} ${n(s.cy)}a${n(s.rx)} ${n(s.ry)} 0 1 0 ${n(2*s.rx)} 0a${n(s.rx)} ${n(s.ry)} 0 1 0 ${n(-2*s.rx)} 0Z`;
      case 'dome': return `M${n(s.cx-s.rx)} ${n(s.y)}a${n(s.rx)} ${n(s.ry)} 0 0 0 ${n(2*s.rx)} 0Z`;
      case 'arch': { const r=s.w/2, sp=s.y+s.h-r; return `M${n(s.x)} ${n(s.y)}V${n(sp)}a${n(r)} ${n(r)} 0 0 0 ${n(s.w)} 0V${n(s.y)}Z`; }
      case 'pointed': { const rise=Math.min(s.h, s.w*0.866), sp=s.y+s.h-rise; return `M${n(s.x)} ${n(s.y)}V${n(sp)}Q${n(s.x)} ${n(sp+rise*0.6)} ${n(s.x+s.w/2)} ${n(s.y+s.h)}Q${n(s.x+s.w)} ${n(sp+rise*0.6)} ${n(s.x+s.w)} ${n(sp)}V${n(s.y)}Z`; }
      default: return '';
    }
  }

  // ---------------------------------------------------------------------------
  // 10. The AI prompt (Engine A)
  // ---------------------------------------------------------------------------
  const EXAMPLE_SCENE = {
    analysis: {
      photos: 'Photo 1: west front, frontal, lower storey partly hidden by trees.',
      structure: 'Nave front between two equal towers; each tower has two stages and a spire; one pointed portal.',
      symmetry: 'Symmetric about the portal axis.',
      rows: 'Plinth 0–6, nave 6–46, cornice 46–52, tower stages 52–74 and 74–96, spires 96–120.'
    },
    landmark: 'Example – twin-tower church',
    confidence: 'high',
    width: 70, height: 120,
    bands: [
      { from: 0, to: 6, shift: 0, level: 1 },
      { from: 6, to: 46, shift: 2, level: 1 },
      { from: 46, to: 52, shift: 0, level: 1 },
      { from: 52, to: 74, shift: 2, level: 1 },
      { from: 74, to: 96, shift: 0, level: 2 },
      { from: 96, to: 120, shift: 0, level: 1 }
    ],
    shapes: [
      { type: 'rect', x: 0, y: 0, w: 70, h: 46, level: 1, note: 'nave / main body' },
      { type: 'rect', x: 2, y: 46, w: 20, h: 50, level: 1, note: 'left tower' },
      { type: 'rect', x: 48, y: 46, w: 20, h: 50, level: 1, note: 'right tower' },
      { type: 'spire', cx: 12, y: 96, w: 20, h: 24, level: 1, note: 'left spire' },
      { type: 'spire', cx: 58, y: 96, w: 20, h: 24, level: 1, note: 'right spire' },
      { type: 'gable', x: 22, y: 46, w: 26, h: 16, level: 1, note: 'central gable' },
      { type: 'pointed', x: 27, y: 0, w: 16, h: 26, op: 'cut', level: 1, note: 'portal' },
      { type: 'windows', x: 4, y: 60, w: 16, h: 28, cols: 2, rows: 2, fillX: 0.5, fillY: 0.6, top: 'pointed', level: 2, note: 'tower openings L' },
      { type: 'windows', x: 50, y: 60, w: 16, h: 28, cols: 2, rows: 2, fillX: 0.5, fillY: 0.6, top: 'pointed', level: 2, note: 'tower openings R' },
      { type: 'rect', x: 0, y: 0, w: 2, h: 46, op: 'pier', shift: 0, level: 3, note: 'corner buttress L' },
      { type: 'rect', x: 68, y: 0, w: 2, h: 46, op: 'pier', shift: 0, level: 3, note: 'corner buttress R' }
    ],
    retained: ['two west towers with spires', 'central gable', 'arched portal'],
    uncertain: [],
    cleanup: []
  };

  /** A DB designer's graphic (St. Petri Dom, Bremen) rebuilt as a plan: the techniques of the rich detail level. */
  const WORKED_EXAMPLE = {"landmark":"St. Petri Dom, Bremen","confidence":"high","width":86,"height":180,"bands":[{"from":0,"to":31,"shift":0,"level":1,"note":"portals + plinth"},{"from":31,"to":48,"shift":2,"level":1,"note":"facade, rose window"},{"from":48,"to":60,"shift":0,"level":2,"note":"facade top"},{"from":60,"to":76,"shift":0,"level":1,"note":"tower stage 1, gable"},{"from":76,"to":87,"shift":0,"level":3,"note":"tower stage 2"},{"from":87,"to":101,"shift":0,"level":2,"note":"tower stage 3"},{"from":101,"to":115,"shift":0,"level":2,"note":"belfry"},{"from":115,"to":125,"shift":2,"level":1,"note":"spire base tier"},{"from":125,"to":180,"shift":0,"level":1,"note":"spire tiers"}],"shapes":[{"type":"rect","x":0,"y":0,"w":86,"h":60,"level":1,"note":"west front"},{"type":"rect","x":4,"y":60,"w":26,"h":65,"level":1,"note":"left tower"},{"type":"rect","x":56,"y":60,"w":26,"h":65,"level":1,"note":"right tower"},{"type":"rect","x":8,"y":125,"w":18,"h":17,"level":1,"note":"left spire tier"},{"type":"rect","x":12,"y":142,"w":10,"h":19,"level":1,"note":"left spire top"},{"type":"rect","x":16,"y":161,"w":2,"h":19,"level":1,"note":"left finial"},{"type":"rect","x":60,"y":125,"w":18,"h":17,"level":1,"note":"right spire tier"},{"type":"rect","x":64,"y":142,"w":10,"h":19,"level":1,"note":"right spire top"},{"type":"rect","x":68,"y":161,"w":2,"h":19,"level":1,"note":"right finial"},{"type":"poly","points":[[31,60],[55,60],[55,67],[51,67],[51,70],[47,70],[47,76],[39,76],[39,70],[35,70],[35,67],[31,67]],"level":1,"note":"stepped central gable"},{"type":"ellipse","cx":43,"cy":45,"rx":9.5,"ry":9,"op":"cut","level":1,"note":"rose window"},{"type":"windows","x":3,"y":0,"w":80,"h":20,"cols":4,"rows":1,"fillX":0.65,"fillY":1,"top":"pointed","level":2,"note":"four pointed portals"},{"type":"windows","x":9,"y":101,"w":16,"h":9,"cols":2,"rows":1,"fillX":0.5,"fillY":1,"level":2,"note":"belfry lancets L"},{"type":"windows","x":61,"y":101,"w":16,"h":9,"cols":2,"rows":1,"fillX":0.5,"fillY":1,"level":2,"note":"belfry lancets R"},{"type":"rect","x":0,"y":0,"w":2,"h":59,"op":"pier","shift":0,"level":2,"note":"buttress L runs through"},{"type":"rect","x":84,"y":0,"w":2,"h":59,"op":"pier","shift":0,"level":2,"note":"buttress R runs through"},{"type":"rect","x":4,"y":60,"w":2,"h":55,"op":"pier","shift":0,"level":2,"note":"tower frame L outer"},{"type":"rect","x":28,"y":60,"w":2,"h":55,"op":"pier","shift":0,"level":2,"note":"tower frame L inner"},{"type":"rect","x":56,"y":60,"w":2,"h":55,"op":"pier","shift":0,"level":2,"note":"tower frame R inner"},{"type":"rect","x":80,"y":60,"w":2,"h":55,"op":"pier","shift":0,"level":2,"note":"tower frame R outer"},{"type":"rect","x":29,"y":48,"w":29,"h":12,"op":"offset","level":2,"note":"nave front panel"},{"type":"rect","x":30,"y":31,"w":2,"h":29,"op":"pier","shift":2,"level":3,"note":"nave pier L"},{"type":"rect","x":54,"y":31,"w":2,"h":29,"op":"pier","shift":2,"level":3,"note":"nave pier R"},{"type":"rect","x":41,"y":76,"w":4,"h":4,"level":2,"note":"gable finial"},{"type":"rect","x":39,"y":76,"w":8,"h":4,"op":"offset","level":2,"note":"gable finial offset"},{"type":"rect","x":12,"y":60,"w":10,"h":11,"op":"offset","level":3,"note":"tracery panel L1"},{"type":"rect","x":8,"y":71,"w":18,"h":5,"op":"offset","level":3,"note":"tracery head L1"},{"type":"rect","x":64,"y":60,"w":10,"h":11,"op":"offset","level":3,"note":"tracery panel R1"},{"type":"rect","x":60,"y":71,"w":18,"h":5,"op":"offset","level":3,"note":"tracery head R1"},{"type":"rect","x":12,"y":87,"w":10,"h":9,"op":"offset","level":3,"note":"tracery panel L2"},{"type":"rect","x":8,"y":96,"w":18,"h":5,"op":"offset","level":3,"note":"tracery head L2"},{"type":"rect","x":64,"y":87,"w":10,"h":9,"op":"offset","level":3,"note":"tracery panel R2"},{"type":"rect","x":60,"y":96,"w":18,"h":5,"op":"offset","level":3,"note":"tracery head R2"},{"type":"windows","x":7,"y":31,"w":32,"h":3,"cols":4,"rows":1,"fillX":0.5,"fillY":1,"level":3,"note":"arcade frieze L"},{"type":"windows","x":47,"y":31,"w":32,"h":3,"cols":4,"rows":1,"fillX":0.5,"fillY":1,"level":3,"note":"arcade frieze R"},{"type":"rect","x":13,"y":119,"w":8,"h":6,"op":"cut","level":3,"note":"spire base opening L"},{"type":"rect","x":65,"y":119,"w":8,"h":6,"op":"cut","level":3,"note":"spire base opening R"},{"type":"rect","x":11,"y":132,"w":4,"h":1,"op":"cut","level":3,"note":"spire tick L"},{"type":"rect","x":19,"y":132,"w":4,"h":1,"op":"cut","level":3,"note":"spire tick L"},{"type":"rect","x":15,"y":137,"w":4,"h":1,"op":"cut","level":3,"note":"spire tick L"},{"type":"rect","x":63,"y":132,"w":4,"h":1,"op":"cut","level":3,"note":"spire tick R"},{"type":"rect","x":71,"y":132,"w":4,"h":1,"op":"cut","level":3,"note":"spire tick R"},{"type":"rect","x":67,"y":137,"w":4,"h":1,"op":"cut","level":3,"note":"spire tick R"}],"retained":["twin towers with stepped spires and finials","stepped central gable","rose window","four pointed portals","buttresses and tower frames running through the rows"],"uncertain":[],"cleanup":[]};

  const PHOTO_ROLES = { front: 'front view', side: 'side view', back: 'back view', angle: 'another angle', detail: 'detail close-up', aerial: 'aerial / high view' };

  function buildPrompt(opts) {
    const o = Object.assign({ height: null, notes: '', previous: null, feedback: '', landmark: '', sketch: null, hasPhoto: true, photoCount: 1, photos: null, features: null }, opts || {});
    const R = RULES;
    const lines = [
      'You are the drafting assistant for Deutsche Bahn "Signature Graphics": city landmarks drawn ONLY with vertical 2 dp bars.',
      'The attached photo shows a building or landmark. Plan a simplified, recognisable construction of it as JSON. A deterministic renderer turns your plan into the final artwork, so you describe AREAS, not lines.',
      '',
      'HOW THE RENDERER DRAWS (so you know what survives):',
      `- Every filled area is filled with vertical bars ${R.stroke} dp wide on a ${R.pitch} dp pitch (${R.stroke} dp bar, ${R.hGap} dp gap). Horizontal or diagonal lines do not exist.`,
      `- The drawing is split into horizontal ROWS ("bands"). Consecutive bands are separated by a ${R.vGapIdeal} dp gap and may be shifted sideways by ${R.rowShift} dp (shift 0 or 2). This offset is the main tool to separate architectural parts: plinth, main body, cornice/attic, roof, tower stages, lantern, spire.`,
      `- Silhouettes appear as the stepped tops of bars. Openings (cut shapes) appear as gaps in bars. Anything narrower than ~4 dp or shorter than ${R.minLen} dp disappears. Openings should be at least 4 dp tall and cover at least one bar (≥ 3 dp wide).`,
      '',
      'STYLE RULES (DB guideline):',
      `- Base size 96 × 96 dp with 3 dp safe area → a normal building is ${R.live} dp tall. Very tall towers may be up to ${R.tallMax} dp tall (height), very wide buildings up to ~180 dp wide; keep a harmonious relation to a 90 dp building.`,
      '- Clear, stable, functional. Prioritise recognisability over completeness. Detail must follow the architecture and the grid, never random texture ("flimmery").',
      '- Keep only features that identify the landmark: overall silhouette, roofline, towers, domes, spires, arches, dominant window rhythm, distinctive entrance. Drop ornament, sculpture, texture, shadows, perspective distortion.',
      '- Remove foreground clutter (trees, cars, people, street furniture, neighbouring buildings) unless it is part of the landmark.',
      '- Draw a frontal, flat elevation even if the photo is in perspective. Symmetric buildings must be symmetric.',
      '- Detail density must be even across the building (both towers, all bays at the same level of detail).',
      '- The graphic must sit on a flat baseline (y = 0) so it can be combined with other landmarks into a skyline.',
      '',
      'COORDINATES: dp, integers, origin bottom-left, y points UP. x from 0 to width, y from 0 to height.',
      '',
      'SHAPES (later shapes paint over earlier ones; op "add" fills, op "cut" removes; default op is "add", "windows" default "cut"):',
      '- {"type":"rect","x","y","w","h"}',
      '- {"type":"poly","points":[[x,y],...]}   any outline, e.g. a stepped gable, a pitched roof, a bridge deck',
      '- {"type":"gable","x","y","w","h"}      triangle on base x..x+w at y',
      '- {"type":"spire","cx","y","w","h"}     triangle centred on cx',
      '- {"type":"dome","cx","y","rx","ry"}    upper half-ellipse sitting on y',
      '- {"type":"ellipse","cx","cy","rx","ry"}',
      '- {"type":"arch","x","y","w","h"}       rect with a round top (use op "cut" for portals, arcades, bridge arches)',
      '- {"type":"pointed","x","y","w","h"}    rect with a Gothic pointed top (lancets, Gothic portals, pointed arcades)',
      '- {"type":"windows","x","y","w","h","cols","rows","fillX","fillY","top"}  regular grid of openings; fillX/fillY = opening size as fraction of each cell (0.3–1); "top": "flat" (default), "round" or "pointed"',
      'Add a short "note" to each shape saying which part it is, and a "level" (see DETAIL LEVELS).',
      'Two more ops shape the bar pattern itself (they do not fill or cut; the area must already be filled):',
      '- op "offset" (usually on a rect): bars inside move to the OTHER 2 dp phase of their row. This frames an element inside a stage: a tracery panel or window group inside a tower, the nave front between two towers, the finial on a gable. The region must be at least 3 bars (≥ 10 dp) wide; its outermost row bars step aside so the 2 dp gap holds.',
      '- op "pier" with "shift": 0 or 2 (a rect 2 dp wide over one bar column): that bar runs straight through the row gaps from the bottom to the top of the rect. Use it for corner buttresses, tower corners and frame bars. Put it exactly on a bar: x ≡ shift (mod 4), width 2. Bars of the rows next to it are trimmed automatically.',
      'Optional "gap": 4 on an added shape clears a 4 dp margin around it (removing the neighbouring bars), so the part reads IN FRONT of what lies behind it (a gable in front of a roof, a tower in front of a nave). Only use it when the part rises ABOVE what is behind it; otherwise the cleared margin leaves loose fragments.',
      '',
      'GRID ALIGNMENT (this decides whether the result looks clean or noisy):',
      '- Use a width of the form 4n+2 (e.g. 70, 90, 110, 134, 146). Then bars sit at x = 0, 4, 8, 12 … in rows with shift 0 and at x = 2, 6, 10 … in rows with shift 2, each 2 dp wide. Symmetric buildings stay symmetric because bar x mirrors to (width − 2 − x).',
      '- An opening removes every bar whose 2 dp strip lies fully inside it. One-bar opening around a bar at x: cut from x−1 to x+3. Two-bar opening (bars x and x+4): cut from x−1 to x+7. Keep at least one bar between openings. For a regular rhythm use a "windows" grid whose cell width is a multiple of 4 (8 = 1 bar + 1 opening bar, 12 = 2 opening bars + 1 pier).',
      '- An arcade of round arches: pitch 12 dp, arch "x" = 3 + 12·i, "w" 8 → two bars removed per arch, one pier bar between arches.',
      '- Step a stepped gable or tower by 4 dp per side and level, so each step removes exactly one bar on each side.',
      '- Keep roof areas as few, calm bands. Many small cuts in a roof or gable read as noise; prefer 1–2 openings per gable level.',
      '',
      'BANDS: list of {"from","to","shift","level"} in y-up dp covering 0..height with no gaps. Put band borders where the architecture changes (cornices, roof lines, tower stages, spire tiers, bridge deck). The bottom band has shift 0. Neighbouring bands usually alternate 0 and 2; keep the same shift where one continuous element (a spire, a tower stage with offset panels inside) spans both.',
      '',
      'DETAIL LEVELS (the designer switches between them with a slider, without asking you again):',
      '- Tag every shape and every band with "level": 1 = essential (silhouette, main masses, the 4–6 main rows, the one opening that identifies the building, e.g. a rose window or the main portal), 2 = standard (portals, main window rows, tower stages, buttresses/frames), 3 = rich (the craft a DB designer adds: tracery panels as offset regions, lancets, spire tier openings, 1 dp breaks, friezes, extra rows).',
      '- Each level must look finished on its own: level 1 alone is a clean, calm silhouette; 1+2 is a balanced standard graphic; 1+2+3 is the rich version. A band above the chosen level merges into the band below it, so level-1 bands must still describe the main architecture.',
      '- Always deliver all three levels. For ornate landmarks (Gothic, Romanesque, Baroque, historic town halls) make level 3 generous: DB designers typically use a row every 10–17 dp in towers and façades (8–12 rows for a 150–190 dp church). Plain modern buildings may have almost nothing at level 3.',
      '',
      'TECHNIQUES FROM DB DESIGNERS (use them where the architecture has them):',
      '- Spires and towers as stepped TIERS: stacked rects that narrow by one bar per side every 14–20 dp, ending in a 1-bar finial (a 2 dp wide rect on the tower axis). Crisper than one triangle.',
      '- Frames: tower corners and buttresses as "pier" bars that run through all row gaps; the inner bars break at every row.',
      '- Tracery: inside a tower stage an "offset" rect (panel) with a wider "offset" rect on top (head) reads as a framed Gothic window; single-bar lancets are cuts 4 dp wide centred on one bar.',
      '- Gothic portals: "pointed" cuts 3 bars wide (w 12–13), about 20 dp tall; round portals: "arch".',
      '- Rose window: an "ellipse" cut about 18–20 dp across, crossing a row border.',
      '- Friezes: a 3–4 dp tall "windows" row that removes every other bar.',
      '- Tiny breaks: 1 dp tall cuts across one or two bars (spire tiers, cornices). Use sparingly, symmetric, level 3.',
      '',
      'WORKED EXAMPLE of the rich level, rebuilt from a DB designer graphic (St. Petri Dom, Bremen, 86 × 180 dp, 9 rows at level 3). Learn the techniques and the density, not the building:',
      JSON.stringify(WORKED_EXAMPLE),
      '',
      'Reply with ONLY one JSON object in exactly this format (this example is a generic church, not your building; it is short, yours should use all levels):',
      JSON.stringify(EXAMPLE_SCENE),
      '',
      '"analysis" comes FIRST, before any shape: note briefly what you read from the photos ("photos"), which parts the building has and how they stack ("structure": stages, tiers, bays), "symmetry", and where the rows go ("rows"). One or two sentences each.',
      '"retained": which features you kept. "uncertain": parts that were unclear/obstructed/too ornate and got a conservative guess. "cleanup": concrete suggestions for the designer. "confidence": high | medium | low (low for ornate Baroque, heavy obstruction, poor photo).'
    ];
    if (!o.hasPhoto) {
      lines[1] = 'You cannot see the photo in this request. Instead you get the landmark name (if known) and a measured SKETCH of the cropped photo (below). Plan a simplified, recognisable construction of the building as JSON, using the sketch for proportions and positions and your own knowledge of the landmark for its characteristic features. A deterministic renderer turns your plan into the final artwork, so you describe AREAS, not lines.';
    }
    const photos = (Array.isArray(o.photos) ? o.photos : []).slice(0, 8), n = o.hasPhoto ? Math.max(o.photoCount || 1, photos.length || 1) : 0;
    const clip = (t) => String(t || '').replace(/[\u0000-\u001f"]+/g, ' ').trim().slice(0, 120);
    const role = (q, i) => (PHOTO_ROLES[q && q.role] || (i ? 'another angle' : 'front view')) + (q && clip(q.caption) ? ` – designer: "${clip(q.caption)}"` : '');
    if (n > 1) {
      lines.push('', `PHOTOS: you get ${n} photos of the SAME landmark, in this order:`);
      for (let i = 0; i < n; i++) lines.push(`- Photo ${i + 1}: ${role(photos[i], i)}${i === 0 ? ' – MAIN VIEW: the sketch and measurements below come from it; follow its proportions and viewpoint' : ''}`);
      lines.push(
        'How to combine them:',
        '- Cross-check before you plan: a feature seen in two or more photos is architecture; something seen in only one may be clutter, a reflection or a neighbouring building.',
        '- Draw the elevation of the MAIN view. The other views tell you what the main view hides (behind trees, scaffolding, perspective), how parts repeat (number of bays, equal towers) and how deep things are. Never mix viewpoints into one elevation.',
        '- Detail close-ups feed levels 2 and 3: count the openings, read the window and tracery shapes and the tier structure there, then place them on the matching part of the main view at its scale.',
        '- In "analysis.photos" say in a few words what each photo contributed.');
    } else if (n === 1 && photos[0] && (clip(photos[0].caption) || (photos[0].role && photos[0].role !== 'front'))) {
      lines.push('', 'About the photo: ' + role(photos[0], 0) + '.');
    }
    if (o.landmark) lines.push('', 'Landmark: ' + o.landmark + (o.hasPhoto ? '' : ' (use what you know about its elevation: towers, roofline, domes, spires, openings)'));
    if (o.sketch) {
      const k = o.sketch;
      lines.push('',
        `SKETCH of the cropped photo, measured on the dp grid. It is ${k.widthDp} dp wide and ${k.heightDp} dp tall; each character is ${k.cell} × ${k.cell} dp. Row 1 is the TOP of the drawing, the last row is the ground (y = 0). "." = sky or background, digits 0–9 = building tone (0 darkest, 9 lightest; dark patches inside the building are usually openings, roofs or shadow).`,
        'The sketch comes from automatic sky separation: trust its outline and proportions, but it can include foreground clutter (trees, people, neighbouring buildings) and perspective distortion. Correct those; draw a frontal, simplified elevation.',
        'Use the sketch size as your width and height unless a target height is given (then scale proportionally).',
        '```', k.text, '```');
    }
    if (o.features) lines.push('', typeof o.features === 'string' ? o.features : featuresText(o.features), 'Window rhythm matters: when rows of openings are measured, reproduce them with "windows" shapes (matching count, height and position) unless they are too fine for the grid, in which case keep fewer, larger openings with the same rhythm.');
    if (o.height) lines.push('', `Target height: ${o.height} dp.`);
    if (o.notes) lines.push('', 'Designer notes about this building: ' + o.notes);
    if (o.previous) {
      lines.push('', 'This is a REVISION. Your previous plan was:', JSON.stringify(o.previous), '', 'Designer feedback to apply: ' + (o.feedback || '(none – improve fidelity and rule compliance)'), 'Return the full revised JSON object.');
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // exports
  // ---------------------------------------------------------------------------
  const API = { shapePath, PHOTO_ROLES, WORKED_EXAMPLE, pierRegions, offsetSampler, levelOf, bandLevel, mergeFineBands, analyze, featuresText, toLab, sketch, DEFAULT_MODS, applyShapeMods, applyRowMods, bakeScene, openingArea, RULES, normalizeScene, sceneSampler, sceneBands, fillBands, gridFromSampler, detectBands, render, validate, toSVG, fromScene, trace, buildPrompt, EXAMPLE_SCENE, cleanRuns };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.DBSig = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
