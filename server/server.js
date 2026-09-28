// DB Signature Graphics Drafter – team server
// Serves the drafter page behind a team password and forwards draft requests to the
// Anthropic API with the company key. No dependencies: Node 20+.
//
// Env:
//   ANTHROPIC_API_KEY  (required) company key from the Claude Console
//   ANTHROPIC_WORKSPACE_ID  needed when the key is not scoped to a workspace (wrkspc_…)
//   TEAM_PASSWORD      (required) shared password for the team
//   SESSION_SECRET     (recommended) random string used to sign login cookies
//   MODEL              default model            (default: claude-sonnet-5)
//   MODEL_COMPLEX      "Most capable" model      (default: claude-opus-5-5)
//   DRAFTS_PER_HOUR    per person/IP limit       (default: 30)
//   DRAFTS_PER_DAY     whole-team daily limit    (default: 300)
//   PORT               (default: 3000)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('../core/dbsig-core.js');

const CFG = {
  key: process.env.ANTHROPIC_API_KEY || '',
  workspace: process.env.ANTHROPIC_WORKSPACE_ID || '',
  password: process.env.TEAM_PASSWORD || '',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  model: process.env.MODEL || 'claude-sonnet-5',
  modelComplex: process.env.MODEL_COMPLEX || 'claude-opus-5-5',
  perHour: +(process.env.DRAFTS_PER_HOUR || 30),
  perDay: +(process.env.DRAFTS_PER_DAY || 300),
  port: +(process.env.PORT || 3000),
  apiBase: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
};
if (!CFG.key) console.warn('[warn] ANTHROPIC_API_KEY is not set – drafting will fail');
if (!CFG.password) console.warn('[warn] TEAM_PASSWORD is not set – nobody can sign in');

const PAGE = path.join(__dirname, 'public', 'index.html');
const COOKIE = 'sgd_session';
const DAY = 86400000, HOUR = 3600000;

// ---------------------------------------------------------------- sessions
function sign(v) { return crypto.createHmac('sha256', CFG.secret).update(v).digest('base64url'); }
function makeSession() { const v = Date.now() + '.' + crypto.randomBytes(9).toString('base64url'); return v + '.' + sign(v); }
function readSession(req) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const parts = m[1].split('.'); if (parts.length !== 3) return null;
  const v = parts[0] + '.' + parts[1];
  const a = Buffer.from(sign(v)), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() - +parts[0] > 30 * DAY) return null;
  return v;
}
function isHttps(req) { return (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https'; }
function setCookie(req, res, value, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}
function passwordOk(p) {
  const a = crypto.createHash('sha256').update(String(p || '')).digest();
  const b = crypto.createHash('sha256').update(CFG.password).digest();
  return CFG.password.length > 0 && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- limits
const hits = new Map(); // key -> [timestamps]
function allow(key, max, windowMs) {
  const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'; }
const ipTag = (ip) => crypto.createHash('sha256').update(ip + CFG.secret).digest('hex').slice(0, 8);

// ---------------------------------------------------------------- helpers
function send(res, status, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY'
  });
  res.end(buf);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
function tolerantJSON(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch (e) { /* fall through */ } }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('no JSON in reply');
}

// ---------------------------------------------------------------- draft
async function draft(req, res) {
  const ip = clientIp(req);
  if (!allow('h:' + ip, CFG.perHour, HOUR)) return send(res, 429, { error: 'rate_limited', message: `Limit of ${CFG.perHour} drafts per hour reached. Try again later.` });
  if (!allow('day', CFG.perDay, DAY)) return send(res, 429, { error: 'daily_limit', message: 'The team’s daily draft limit is reached. Try again tomorrow or ask the tool owner to raise it.' });
  let body;
  try { body = await readBody(req, 24 * 1024 * 1024); } catch (e) { return send(res, e.status || 400, { error: 'bad_request', message: e.status === 413 ? 'The photo is too large. Crop tighter or use a smaller file.' : 'The request could not be read.' }); }

  const isB64 = (v) => typeof v === 'string' && v.length > 100 && v.length < 8 * 1024 * 1024 && /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 200));
  const images = (Array.isArray(body.images) ? body.images : body.image ? [body.image] : []).filter(isB64).slice(0, 4);
  const sk = body.sketch && typeof body.sketch.text === 'string' && body.sketch.text.length < 20000 ? {
    text: body.sketch.text.replace(/[^.0-9\n]/g, ''), cols: +body.sketch.cols || 0, rows: +body.sketch.rows || 0,
    cell: +body.sketch.cell || 2, widthDp: +body.sketch.widthDp || 0, heightDp: +body.sketch.heightDp || 0
  } : null;
  let previous = null;
  if (body.previous && typeof body.previous === 'object') { const s = JSON.stringify(body.previous); if (s.length < 40000) previous = body.previous; }
  const height = [90, 120, 150, 180].includes(+body.height) ? +body.height : null;
  const prompt = core.buildPrompt({
    height, landmark: str(body.landmark, 200), notes: str(body.notes, 1500), sketch: sk,
    hasPhoto: images.length > 0, photoCount: Math.max(1, images.length), previous, feedback: str(body.feedback, 1500)
  });
  const model = body.tier === 'complex' ? CFG.modelComplex : CFG.model;
  const content = [];
  images.forEach((data, i) => {
    if (images.length > 1) content.push({ type: 'text', text: i === 0 ? 'Photo 1 (main view):' : `Photo ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
  });
  content.push({ type: 'text', text: prompt });

  const t0 = Date.now();
  let r, j;
  try {
    r = await fetch(CFG.apiBase + '/v1/messages', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json', 'x-api-key': CFG.key, 'anthropic-version': '2023-06-01' }, CFG.workspace ? { 'anthropic-workspace-id': CFG.workspace } : {}),
      body: JSON.stringify({ model, max_tokens: 8000, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(180000)
    });
    j = await r.json();
  } catch (e) {
    console.error('[draft] upstream failure', e.message);
    return send(res, 502, { error: 'upstream_error', message: 'Could not reach Claude. Try again in a moment.' });
  }
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || ('HTTP ' + r.status);
    console.error('[draft] anthropic error', r.status, msg);
    const status = r.status === 429 ? 429 : 502;
    return send(res, status, { error: r.status === 429 ? 'rate_limited' : 'upstream_error', message: r.status === 429 ? 'Claude is busy right now. Try again in a minute.' : 'Claude returned an error: ' + msg });
  }
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let scene;
  try { scene = tolerantJSON(text); if (!scene || !Array.isArray(scene.shapes) || !scene.shapes.length) throw new Error('no shapes'); }
  catch (e) { return send(res, 502, { error: 'invalid_json', message: 'Claude’s answer was not a valid plan. Press Draft again.' }); }
  const u = j.usage || {};
  console.log(`[draft] ${new Date().toISOString()} user=${ipTag(ip)} model=${model} photos=${images.length} in=${u.input_tokens || 0} out=${u.output_tokens || 0} ms=${Date.now() - t0}${previous ? ' revise' : ''}`);
  send(res, 200, { scene, model, usage: { input: u.input_tokens || 0, output: u.output_tokens || 0 } });
}

// ---------------------------------------------------------------- login page
const LOGIN = (msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signature Graphics Drafter</title>
<style>:root{--p:#F4F4F6;--i:#090F1B;--i2:#454D5D;--l:#C9CCD2;--r:#EC0016;--e:#C4001A}@media(prefers-color-scheme:dark){:root{--p:#0D121C;--i:#EEF0F4;--i2:#B3B9C5;--l:#364052;--e:#FF5A6E}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--p);color:var(--i);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px}h1{font-size:24px;margin:8px 0 0;letter-spacing:-.01em}p{margin:0;color:var(--i2)}
input{font:inherit;padding:10px 12px;border:1px solid var(--l);border-radius:6px;background:transparent;color:var(--i)}button{font:inherit;font-weight:600;padding:10px 12px;border-radius:6px;border:0;background:var(--i);color:var(--p);cursor:pointer}
.e{color:var(--e);font-size:14px}input:focus-visible,button:focus-visible{outline:2px solid #0090D1;outline-offset:2px}</style></head><body>
<form method="post" action="/login"><svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><g fill="#EC0016"><rect x="3" y="14" width="2" height="17"/><rect x="7" y="8" width="2" height="23"/><rect x="11" y="4" width="2" height="12"/><rect x="11" y="17" width="2" height="14"/><rect x="15" y="1" width="2" height="30"/><rect x="19" y="4" width="2" height="12"/><rect x="19" y="17" width="2" height="14"/><rect x="23" y="8" width="2" height="23"/><rect x="27" y="14" width="2" height="17"/></g></svg>
<h1>Signature Graphics Drafter</h1><p>Strichpunkt team access. Enter the team password.</p>
<label for="pw" style="font-weight:600;font-size:14px">Team password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
${msg ? `<p class="e" role="alert">${msg}</p>` : ''}<button type="submit">Sign in</button></form></body></html>`;

function readForm(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 4096) req.destroy(); });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(d))));
  });
}

// ---------------------------------------------------------------- router
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/login') {
      const ip = clientIp(req);
      if (!allow('login:' + ip, 10, 15 * 60000)) return send(res, 429, LOGIN('Too many attempts. Wait 15 minutes.'), 'text/html; charset=utf-8');
      const f = await readForm(req);
      if (!passwordOk(f.password)) return send(res, 401, LOGIN('That password is not right.'), 'text/html; charset=utf-8');
      setCookie(req, res, makeSession(), 30 * 86400);
      res.writeHead(303, { Location: '/' }); return res.end();
    }
    if (url.pathname === '/logout') { setCookie(req, res, '', 0); res.writeHead(303, { Location: '/' }); return res.end(); }

    const session = readSession(req);
    if (req.method === 'GET' && url.pathname === '/') {
      if (!session) return send(res, 200, LOGIN(''), 'text/html; charset=utf-8');
      return send(res, 200, fs.readFileSync(PAGE), 'text/html; charset=utf-8');
    }
    if (url.pathname.startsWith('/api/')) {
      if (!session) return send(res, 401, { error: 'session_expired', message: 'Your sign-in expired. Reload the page and sign in again.' });
      if (req.method === 'POST' && url.pathname === '/api/draft') return await draft(req, res);
      if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { model: CFG.model, modelComplex: CFG.modelComplex, perHour: CFG.perHour });
    }
    send(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('[error]', e);
    if (!res.headersSent) send(res, 500, { error: 'server_error', message: 'Something went wrong on the server.' });
  }
});
server.listen(CFG.port, () => console.log(`Signature Graphics Drafter on :${CFG.port} · model ${CFG.model}`));
