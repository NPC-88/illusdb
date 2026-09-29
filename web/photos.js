// Shared photo panel: up to 4 photos with roles and captions, crop / outline / sky and building picks,
// undo/redo, the expanded zoom editor and the measured silhouette. Inlined by build.py into the web tool
// (web/page.src.html) and the Figma plugin UI (figma/ui.src.html) inside their main closure. The host provides
// `state` (photos, active, main, tool, height), `$`, `D`, `toast` and a `host` object:
// { newLandmark(), isExample(), leaveExample(), message(text) }. Element ids are the same in both pages.
// ---------- photos (up to 4), crop, sky/building picks
const MAX_PHOTOS = 4;
const cv = $('photo'), ctx = cv.getContext('2d');
state.photos = []; state.active = 0; state.main = 0; state.tool = 'crop';
let hoverPt = null; // pointer position while an outline is open
let drag = null, cropBefore = null, vdrag = null, hoverVtx = null, pan = null, spaceDown = false;
const ed = $('editor'), edStage = $('edStage');
if (location.protocol === 'file:') window.__drafter = { state, $ }; // test hook for local previews only
const act = () => state.photos[state.active] || null;
const mainPhoto = () => state.photos[state.main] || state.photos[0] || null;
function addPhoto(src, name, crop, meta){
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const sm = document.createElement('canvas'), f = Math.min(1, 1200 / Math.max(im.naturalWidth, im.naturalHeight));
      sm.width = Math.round(im.naturalWidth*f); sm.height = Math.round(im.naturalHeight*f); sm.getContext('2d').drawImage(im, 0, 0, sm.width, sm.height); sm._f = f;
      state.photos.push({ img: im, src, name: name || 'photo', small: sm, crop: crop || { x:0, y:0, w:im.naturalWidth, h:im.naturalHeight }, sky: [], build: [], outline: [], draft: [], role: (meta && meta.role) || (state.photos.length ? 'angle' : 'front'), caption: (meta && meta.caption) || '', tol: 0.5, contrast: 0.3, invert: false, overlay: null });
      state.active = state.photos.length - 1; drawThumbs(); syncPhotoControls(); paintPhoto(); refreshSketch(); syncHistory(); res();
    };
    im.onerror = () => { toast('That file could not be opened as an image'); res(); };
    im.src = src;
  });
}
function drawThumbs(){
  const t = $('thumbs');
  t.innerHTML = state.photos.map((p, i) => `<div class="thumb" role="button" tabindex="0" data-i="${i}" aria-current="${i===state.active}" aria-label="Photo ${i+1}${i===state.main?', main view':''}"><img src="${p.src}" alt=""><span class="n">${i+1}</span>${i===state.main?'<span class="main">main</span>':''}<button class="x" type="button" data-x="${i}" aria-label="Remove photo ${i+1}">×</button></div>`).join('')
    + (state.photos.length < MAX_PHOTOS ? `<label class="addtile" for="file" title="Add photos" aria-label="Add photos">+</label>` : '');
  $('empty').hidden = state.photos.length > 0; cv.hidden = !state.photos.length;
  $('makeMain').disabled = !state.photos.length || state.active === state.main;
  $('expand').hidden = !state.photos.length || ed.open; $('photoMeta').hidden = !state.photos.length;
  if (ed.open) { if (!state.photos.length) closeEditor(); else $('edTitle').textContent = 'Photo ' + (state.active + 1) + (state.active === state.main ? ' · main view' : ''); }
}
$('thumbs').addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x) { removePhoto(+x.dataset.x); return; }
  const t = e.target.closest('.thumb'); if (!t) return;
  state.active = +t.dataset.i; drawThumbs(); syncPhotoControls(); paintPhoto(); refreshSketch(); if (ed.open) setZoom(1);
});
$('thumbs').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('thumb')) { e.preventDefault(); e.target.click(); } });
function removePhoto(i){
  state.photos.splice(i, 1);
  if (state.main === i) state.main = 0; else if (state.main > i) state.main--;
  state.active = Math.min(state.active, state.photos.length - 1); if (state.active < 0) state.active = 0;
  drawThumbs(); syncPhotoControls(); paintPhoto(); refreshSketch(); syncHistory();
}
$('makeMain').onclick = () => { state.main = state.active; drawThumbs(); refreshSketch(); toast('Photo ' + (state.main+1) + ' now sets the proportions'); };
$('newLandmark').onclick = () => { state.photos = []; state.active = 0; state.main = 0; host.newLandmark(); drawThumbs(); paintPhoto(); refreshSketch(); syncHistory(); host.message(''); };

// ---------- undo / redo for photo edits (crop, outline, picks, silhouette sliders)
// Each entry is a snapshot of one photo's edit state taken just before a change.
const HIST_MAX = 100, hist = { undo: [], redo: [] };
const snapPhoto = p => structuredClone({ crop: p.crop, sky: p.sky, build: p.build, outline: p.outline, draft: p.draft, tol: p.tol, contrast: p.contrast, invert: p.invert });
const sameSnap = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function record(p, snap){ if (!p) return; hist.undo.push({ p, s: snap || snapPhoto(p) }); if (hist.undo.length > HIST_MAX) hist.undo.shift(); hist.redo = []; syncHistory(); }
function syncHistory(){
  for (const list of [hist.undo, hist.redo]) for (let i = list.length - 1; i >= 0; i--) if (!state.photos.includes(list[i].p)) list.splice(i, 1); // drop removed photos, in place
  $('undo').disabled = !hist.undo.length; $('redo').disabled = !hist.redo.length;
}
function stepHistory(from, to){
  syncHistory(); const e = from.pop(); if (!e) return;
  const p = e.p, switched = state.photos.indexOf(p) !== state.active; to.push({ p, s: snapPhoto(p) });
  Object.assign(p, structuredClone(e.s)); p.overlay = null;
  state.active = state.photos.indexOf(p); drag = null; cropBefore = null;
  drawThumbs(); syncPhotoControls(); paintPhoto(); refreshSketch(); syncHistory(); if (ed.open && switched) setZoom(1);
}
const undo = () => stepHistory(hist.undo, hist.redo), redo = () => stepHistory(hist.redo, hist.undo);
$('undo').onclick = undo; $('redo').onclick = redo;

// tool: crop / outline / pick sky / pick building
const TOOL_HINT = { crop: 'Drag across the photo to crop to the landmark. Leave out trees, cars and neighbouring buildings.', outline: 'Click around the landmark to trace its outline. Click the first point, double-click or press Enter to close it. Everything outside counts as sky. Drag any point to adjust it. Draw several outlines for separate parts; Backspace removes the last point, Esc drops an open outline. Expand the photo for precise work.', sky: 'Click on sky areas (clouds too, and sky seen through arches). Each click teaches the silhouette what sky looks like here.', build: 'Click on parts of the building that get mistaken for sky, such as pale stone, glass or a roof in shadow.' };
$('toolSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; state.tool = b.dataset.t; [...$('toolSeg').children].forEach(x => x.setAttribute('aria-pressed', String(x===b))); $('toolHint').textContent = TOOL_HINT[state.tool]; cv.style.cursor = state.tool === 'crop' || state.tool === 'outline' ? 'crosshair' : 'copy'; paintPhoto(); };
$('clearPicks').onclick = () => { const p = act(); if (!p || !(p.sky.length || p.build.length)) return; record(p); p.sky = []; p.build = []; paintPhoto(); refreshSketch(); };
$('clearOutline').onclick = () => { const p = act(); if (!p || !(p.outline.length || p.draft.length)) return; record(p); p.outline = []; p.draft = []; paintPhoto(); refreshSketch(); };
function closeDraft(p){ if (!p || p.draft.length < 3) return false; record(p); p.outline.push(p.draft); p.draft = []; paintPhoto(); refreshSketch(); return true; }
function sampleLab(p, nx, ny){
  const sm = p.small, f = sm._f, g = sm.getContext('2d');
  const x = Math.max(0, Math.round(nx*f) - 3), y = Math.max(0, Math.round(ny*f) - 3);
  const d = g.getImageData(x, y, Math.min(7, sm.width - x), Math.min(7, sm.height - y)).data;
  let r = 0, gg = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i+1]; b += d[i+2]; n++; }
  return D.toLab(r/n, gg/n, b/n);
}

// canvas resolution follows the displayed size: 900 px wide in the card, up to the photo's own pixels when expanded
function paintPhoto(){
  const p = act(); if (!p) { cv.hidden = true; return; }
  const im = p.img, nw = im.naturalWidth, nh = im.naturalHeight;
  let sc = Math.min(1, 900 / nw);
  if (ed.open) { const cssW = parseFloat(cv.style.width) || 900; sc = Math.min(1, cssW * (window.devicePixelRatio || 1) / nw, 8192 / Math.max(nw, nh), Math.sqrt(40e6 / (nw * nh))); }
  const cw = Math.max(1, Math.round(nw*sc)), ch = Math.max(1, Math.round(nh*sc));
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  cv._sc = sc;
  const cssW = cv.getBoundingClientRect().width || cv.clientWidth, k = cssW ? cv.width / cssW : 1; // canvas px per css px: handles stay the same size at any zoom
  ctx.drawImage(im, 0, 0, cv.width, cv.height);
  const c = p.crop, x=c.x*sc, y=c.y*sc, w=c.w*sc, h=c.h*sc;
  if ($('skOverlay').checked && p.overlay) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(p.overlay, x, y, w, h); ctx.restore(); }
  ctx.fillStyle = 'rgba(9,15,27,.55)';
  ctx.fillRect(0,0,cv.width,y); ctx.fillRect(0,y+h,cv.width,cv.height-y-h); ctx.fillRect(0,y,x,h); ctx.fillRect(x+w,y,cv.width-x-w,h);
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5*k; ctx.strokeRect(x,y,w,h);
  const dot = (q, fill) => { ctx.beginPath(); ctx.arc(q.nx*sc, q.ny*sc, 5*k, 0, Math.PI*2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5*k; ctx.strokeStyle = '#fff'; ctx.stroke(); };
  p.sky.forEach(q => dot(q, '#00B3FF')); p.build.forEach(q => dot(q, '#EC0016'));
  // outlines: closed ones white, the open one blue with a rubber band to the pointer
  const path = (pts, close) => { ctx.beginPath(); pts.forEach((q, i) => ctx[i ? 'lineTo' : 'moveTo'](q.nx*sc, q.ny*sc)); if (close) ctx.closePath(); };
  const line = (col) => { ctx.lineJoin = 'round'; ctx.lineWidth = 3.5*k; ctx.strokeStyle = 'rgba(10,15,27,.7)'; ctx.stroke(); ctx.lineWidth = 1.75*k; ctx.strokeStyle = col; ctx.stroke(); };
  const vtx = (q, r, fill, on) => { ctx.beginPath(); ctx.arc(q.nx*sc, q.ny*sc, (on ? r + 2 : r)*k, 0, Math.PI*2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.25*k; ctx.strokeStyle = '#0a0f1b'; ctx.stroke(); };
  const hv = hoverVtx && hoverVtx.p === p ? hoverVtx : null;
  p.outline.forEach(poly => { path(poly, true); ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fill(); line('#fff'); poly.forEach((q, i) => vtx(q, 3, '#fff', hv && hv.list === poly && hv.i === i)); });
  if (p.draft.length) {
    const pts = state.tool === 'outline' && hoverPt && !vdrag ? [...p.draft, hoverPt] : p.draft;
    path(pts, false); line('#00B3FF');
    if (pts.length > p.draft.length && p.draft.length >= 2) { path([hoverPt, p.draft[0]], false); ctx.setLineDash([4*k,4*k]); ctx.lineWidth = 1.25*k; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke(); ctx.setLineDash([]); }
    p.draft.forEach((q, i) => vtx(q, i === 0 && p.draft.length >= 3 ? 6 : 3, i === 0 ? '#fff' : '#00B3FF', hv && hv.list === p.draft && hv.i === i));
  }
}
let paintQueued = false;
const requestPaint = () => { if (paintQueued) return; paintQueued = true; requestAnimationFrame(() => { paintQueued = false; paintPhoto(); }); };
function evPos(e){ const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width / cv._sc, y: (e.clientY - r.top) / r.height * cv.height / cv._sc }; }
const cssToPhoto = (px) => px / (cv.getBoundingClientRect().width / cv.width) / cv._sc; // n css px → photo px
function nearVertex(p, q){ // closest outline point within 9 css px: { list, i }
  const r = cssToPhoto(9); let best = null, bd = r;
  for (const list of [...p.outline, p.draft]) list.forEach((v, i) => { const d = Math.hypot(q.x - v.nx, q.y - v.ny); if (d < bd) { bd = d; best = { p, list, i }; } });
  return best;
}
const clampPt = (p, q) => ({ nx: Math.max(0, Math.min(p.img.naturalWidth, q.x)), ny: Math.max(0, Math.min(p.img.naturalHeight, q.y)) });
cv.addEventListener('pointerdown', e => {
  const p = act(); if (!p) return;
  if (ed.open && (spaceDown || e.button === 1)) { // pan the expanded view
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    pan = { x: e.clientX, y: e.clientY, sl: edStage.scrollLeft, st: edStage.scrollTop }; edStage.classList.add('panning'); return;
  }
  if (e.button !== 0) return;
  const q = evPos(e);
  if (state.tool === 'outline') {
    e.preventDefault();
    const d = p.draft;
    if (d.length >= 3 && Math.hypot(q.x - d[0].nx, q.y - d[0].ny) < cssToPhoto(12)) { closeDraft(p); return; }
    const hit = nearVertex(p, q);
    if (hit) { cv.setPointerCapture(e.pointerId); vdrag = Object.assign(hit, { before: snapPhoto(p), moved: false }); return; } // drag a point (a click on the last point does nothing, so double-clicks are safe)
    record(p); d.push(clampPt(p, q)); paintPhoto(); return;
  }
  if (state.tool !== 'crop') { record(p); const pick = { nx: q.x, ny: q.y, lab: sampleLab(p, q.x, q.y) }; (state.tool === 'sky' ? p.sky : p.build).push(pick); paintPhoto(); refreshSketch(); return; }
  cv.setPointerCapture(e.pointerId); drag = q; cropBefore = snapPhoto(p);
});
cv.addEventListener('dblclick', e => { if (state.tool === 'outline') { e.preventDefault(); closeDraft(act()); } });
cv.addEventListener('pointerleave', () => { if (hoverPt || hoverVtx) { hoverPt = null; hoverVtx = null; requestPaint(); } });
cv.addEventListener('pointermove', e => {
  if (pan) { edStage.scrollLeft = pan.sl - (e.clientX - pan.x); edStage.scrollTop = pan.st - (e.clientY - pan.y); return; }
  const p = act(); if (!p) return;
  if (vdrag) { const q = evPos(e); vdrag.list[vdrag.i] = clampPt(p, q); vdrag.moved = true; if (p.outline.includes(vdrag.list)) p.overlay = null; requestPaint(); return; }
  if (state.tool === 'outline') {
    const q = evPos(e), hv = nearVertex(p, q);
    const changed = !!hv !== !!hoverVtx || (hv && (hv.list !== hoverVtx.list || hv.i !== hoverVtx.i));
    hoverVtx = hv; cv.style.cursor = hv ? 'move' : 'crosshair';
    if (p.draft.length) { hoverPt = { nx: q.x, ny: q.y }; requestPaint(); } else if (changed) requestPaint();
    return;
  }
  if(!drag) return; const q = evPos(e), im = p.img;
  const x0 = Math.max(0, Math.min(drag.x, q.x)), y0 = Math.max(0, Math.min(drag.y, q.y));
  const x1 = Math.min(im.naturalWidth, Math.max(drag.x, q.x)), y1 = Math.min(im.naturalHeight, Math.max(drag.y, q.y));
  if (x1-x0 > 8 && y1-y0 > 8) { p.crop = { x:x0, y:y0, w:x1-x0, h:y1-y0 }; p.overlay = null; requestPaint(); } });
function endPointer(){
  if (pan) { pan = null; edStage.classList.remove('panning'); return; }
  const p = act();
  if (vdrag) { const v = vdrag; vdrag = null; if (p && v.moved) { record(p, v.before); refreshSketch(); } paintPhoto(); return; }
  if (drag) { drag = null; if (p && cropBefore && !sameSnap(cropBefore.crop, p.crop)) record(p, cropBefore); cropBefore = null; refreshSketch(); }
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
$('resetCrop').onclick = () => { const p = act(); if(!p) return; record(p); p.crop = { x:0, y:0, w:p.img.naturalWidth, h:p.img.naturalHeight }; p.overlay = null; paintPhoto(); refreshSketch(); };

// ---------- expanded editor: the same controls move into a full-screen dialog
const ED_NODES = [['thumbs','edSide'], ['photoMeta','edSide'], ['toolHint','edSide'], ['skField','edSide'], ['toolRow','edTools'], ['histRow','edTools']];
let edPlaceholders = [], zoom = 1;
function openEditor(){
  if (!act() || ed.open) return;
  edPlaceholders = ED_NODES.map(([id, to]) => { const n = $(id), ph = document.createComment(id); n.before(ph); $(to).appendChild(n); return [ph, n]; });
  const phc = document.createComment('photo'); cv.before(phc); edPlaceholders.push([phc, cv]); $('edCanvas').appendChild(cv);
  $('edAway').hidden = false; $('expand').hidden = true;
  $('edTitle').textContent = 'Photo ' + (state.active + 1) + (state.active === state.main ? ' · main view' : '');
  ed.showModal(); setZoom(1);
}
function closeEditor(){ if (ed.open) ed.close(); }
ed.addEventListener('close', () => {
  edPlaceholders.forEach(([ph, n]) => ph.replaceWith(n)); edPlaceholders = [];
  cv.style.width = ''; spaceDown = false; pan = null; edStage.classList.remove('space', 'panning');
  $('edAway').hidden = true; drawThumbs(); paintPhoto();
});
function fitWidth(){
  const p = act(); if (!p) return 1;
  const a = p.img.naturalWidth / p.img.naturalHeight, w = edStage.clientWidth - 32, h = edStage.clientHeight - 32;
  return Math.max(80, Math.min(w, h * a));
}
function setZoom(z, cx, cy){ // keep the photo point under (cx, cy) in place
  const p = act(); if (!p || !ed.open) return;
  const maxZ = Math.max(1, p.img.naturalWidth * 4 / fitWidth());
  const old = cv.getBoundingClientRect(), sr = edStage.getBoundingClientRect();
  if (cx == null) { cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
  const fx = old.width ? (cx - old.left) / old.width : .5, fy = old.height ? (cy - old.top) / old.height : .5;
  zoom = Math.max(1, Math.min(maxZ, z));
  cv.style.width = Math.round(fitWidth() * zoom) + 'px';
  paintPhoto();
  const nr = cv.getBoundingClientRect();
  edStage.scrollLeft += (nr.left + fx * nr.width) - cx; edStage.scrollTop += (nr.top + fy * nr.height) - cy;
  $('zVal').textContent = zoom <= 1.001 ? 'Fit' : Math.round(nr.width / p.img.naturalWidth * 100) + '%';
  $('zOut').disabled = zoom <= 1.001; $('zIn').disabled = zoom >= maxZ - 0.001;
}
$('expand').onclick = openEditor;
$('edClose').onclick = closeEditor;
$('zIn').onclick = () => setZoom(zoom * 1.5); $('zOut').onclick = () => setZoom(zoom / 1.5); $('zFit').onclick = () => setZoom(1);
edStage.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY); }, { passive: false });
cv.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
window.addEventListener('resize', () => { if (ed.open) setZoom(zoom); else paintPhoto(); });

document.addEventListener('keydown', e => {
  const t = e.target, typing = t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button)$/.test(t.type));
  if (typing) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (!mod && !e.altKey) {
    if (k === 'e' && !ed.open && act()) { e.preventDefault(); openEditor(); return; }
    if (ed.open) {
      if (e.key === ' ' && !e.repeat) { e.preventDefault(); spaceDown = true; edStage.classList.add('space'); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.5); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom / 1.5); return; }
      if (e.key === '0') { e.preventDefault(); setZoom(1); return; }
      const tool = { c: 'crop', o: 'outline', s: 'sky', b: 'build' }[k];
      if (tool) { e.preventDefault(); $('toolSeg').querySelector(`[data-t="${tool}"]`).click(); return; }
    }
  }
  const p = act(); if (!p || state.tool !== 'outline' || !p.draft.length || mod) return;
  if (e.key === 'Enter') { e.preventDefault(); closeDraft(p); }
  else if (e.key === 'Escape') { e.preventDefault(); record(p); p.draft = []; hoverPt = null; paintPhoto(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); record(p); p.draft.pop(); paintPhoto(); }
});
document.addEventListener('keyup', e => { if (e.key === ' ' && spaceDown) { spaceDown = false; edStage.classList.remove('space'); } });

// ---------- measured silhouette ("sketch")
function sketchHeight(p){ if (state.height !== 'auto') return +state.height; const c = (p || mainPhoto() || {}).crop; const a = c ? c.h / c.w : 1; return a > 2.4 ? 180 : a > 1.8 ? 150 : a > 1.3 ? 120 : 90; }
function outlineFor(p){ const c = p.crop; return p.outline.map(poly => poly.map(q => ({ u: (q.nx - c.x) / c.w, v: (q.ny - c.y) / c.h }))); }
function picksFor(p, list){ const c = p.crop; return list.map(q => { const u = (q.nx - c.x) / c.w, v = (q.ny - c.y) / c.h; return (u >= 0 && u <= 1 && v >= 0 && v <= 1) ? { u, v, lab: q.lab } : { lab: q.lab }; }); }
function makeSketch(p){
  p = p || mainPhoto(); if (!p) return null;
  const k = cropCanvas(700, p);
  return D.sketch(k.getContext('2d').getImageData(0, 0, k.width, k.height), { height: sketchHeight(p), skyTol: p.tol, contrast: p.contrast, invert: p.invert, skySamples: picksFor(p, p.sky), buildSamples: picksFor(p, p.build), outline: outlineFor(p) });
}
function buildOverlay(k, f){
  const m = k.mask, w = m.x1 - m.x0 + 1, h = m.Hp, o = document.createElement('canvas'); o.width = w; o.height = h;
  const g = o.getContext('2d'), id = g.createImageData(w, h);
  const on = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 1 : m.cov[y * m.Wp + m.x0 + x] ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (!on(x, y)) { id.data[i] = 244; id.data[i+1] = 244; id.data[i+2] = 246; id.data[i+3] = 185; }          // sky: washed out
    else if (!on(x-1, y) || !on(x+1, y) || !on(x, y-1) || !on(x, y+1)) { id.data[i] = 236; id.data[i+3] = 255; } // outline in DB red
  }
  g.putImageData(id, 0, 0);
  return o;
}
function makeFeatures(p){
  p = p || mainPhoto(); if (!p) return null;
  const k = cropCanvas(700, p);
  return D.analyze(k.getContext('2d').getImageData(0, 0, k.width, k.height), { height: sketchHeight(p), skyTol: p.tol, contrast: p.contrast, invert: p.invert, skySamples: picksFor(p, p.sky), buildSamples: picksFor(p, p.build), outline: outlineFor(p) });
}
let skT;
function refreshSketch(){ clearTimeout(skT); skT = setTimeout(() => {
  const p = act(), c = $('sk');
  $('skTag').textContent = !p ? '–' : state.active === state.main ? 'main view · sets proportions' : 'extra view · Claude sees the photo';
  if (!p) { c.width = c.height = 1; $('featInfo').textContent = ''; return; }
  let k = null;
  try { k = makeSketch(p); } catch (e) { console.error(e); }
  if (!k) return;
  let f = null; try { f = makeFeatures(p); } catch (e) { console.error(e); }
  p.features = f; p.overlay = buildOverlay(k, f); paintPhoto();
  $('featInfo').textContent = f ? `${f.rects.length} openings found${f.rows.length ? ` · ${f.rows.length} window rows` : ''}${f.peaks.length ? ` · ${f.peaks.length} high points` : ''}` : '';
  const px = 4, rows = k.text.split('\n');
  c.width = k.cols * px; c.height = k.rows * px; const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '.') return; const v = +ch; const l = dark ? 28 + v * 6.5 : 14 + v * 7; g.fillStyle = `hsl(222 18% ${l}%)`; g.fillRect(x * px, y * px, px, px); }));
}, 80); }
function syncPhotoControls(){
  const p = act(), dis = !p;
  ['skTol','skCon','skInv','resetCrop','clearPicks','clearOutline'].forEach(id => $(id).disabled = dis);
  if (!p) return;
  $('pRole').value = p.role || 'angle'; $('pCaption').value = p.caption || '';
  $('skTol').value = p.tol; $('skTolO').textContent = p.tol.toFixed(2);
  $('skCon').value = p.contrast; $('skConO').textContent = Math.round(p.contrast*100) + '%';
  $('skInv').checked = p.invert;
}
let sliding = null; // the slider whose drag is already recorded
const recordSlide = (p, el) => { if (sliding !== el) { record(p); sliding = el; } };
['skTol','skCon'].forEach(id => $(id).addEventListener('change', () => { sliding = null; }));
$('skTol').addEventListener('input', e => { const p = act(); if (!p) return; recordSlide(p, e.target); p.tol = +e.target.value; $('skTolO').textContent = p.tol.toFixed(2); refreshSketch(); });
$('skCon').addEventListener('input', e => { const p = act(); if (!p) return; recordSlide(p, e.target); p.contrast = +e.target.value; $('skConO').textContent = Math.round(p.contrast*100) + '%'; refreshSketch(); });
$('skInv').addEventListener('change', e => { const p = act(); if (!p) return; record(p); p.invert = e.target.checked; refreshSketch(); });
$('skOverlay').addEventListener('change', paintPhoto);
$('pRole').addEventListener('change', e => { const p = act(); if (p) p.role = e.target.value; });
$('pCaption').addEventListener('input', e => { const p = act(); if (p) p.caption = e.target.value; });

// ---------- adding files
async function takeFiles(list){
  const files = [...(list || [])].filter(f => /^image\//.test(f.type));
  if (!files.length) { toast('Choose PNG, JPG or WebP photos'); return; }
  if (host.isExample()) { state.photos = []; state.main = 0; host.leaveExample(); }
  const room = MAX_PHOTOS - state.photos.length;
  if (room <= 0) { toast('Up to 4 photos per landmark. Remove one first.'); return; }
  for (const f of files.slice(0, room)) await addPhoto(URL.createObjectURL(f), f.name);
  if (files.length > room) toast('Up to 4 photos per landmark. Extra files were skipped.');
  host.message(state.photos.length > 1 ? 'Photo 1 is the main view. Crop each photo, then press “Draft with Claude”.' : 'Crop to the landmark, then press “Draft with Claude”. Add more photos from other angles if you have them.');
}
$('file').onchange = e => { takeFiles(e.target.files); e.target.value = ''; };
const drop = $('drop');
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault(); drop.classList.add('over');}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault(); drop.classList.remove('over');}));
drop.addEventListener('drop', e => takeFiles(e.dataTransfer.files));
document.addEventListener('paste', e => { const f=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/')).map(i=>i.getAsFile()); if(f.length) takeFiles(f); });
function cropCanvas(maxSide, p){
  p = p || act(); const im = p.img, c = p.crop, sc = Math.min(1, maxSide / Math.max(c.w, c.h));
  const k = document.createElement('canvas'); k.width = Math.max(1, Math.round(c.w*sc)); k.height = Math.max(1, Math.round(c.h*sc));
  k.getContext('2d').drawImage(im, c.x, c.y, c.w, c.h, 0, 0, k.width, k.height); return k;
}
// measured openings, rows and skyline of the main view (sent with every draft; the server re-checks every number)
function measuredFeatures(){
  try { const f = makeFeatures(); if (!f) return null; const { widthDp, heightDp, profile, lines, peaks, rows, singles } = f; return { widthDp, heightDp, profile, lines, peaks, rows, singles }; }
  catch (e) { console.error(e); return null; }
}
function photoOrder(){ const m = mainPhoto(); return m ? [m, ...state.photos.filter(p => p !== m)] : []; }
