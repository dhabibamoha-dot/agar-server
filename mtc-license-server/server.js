'use strict';
/**
 * server.js — license/auth server for "Multi Tabs Controller".
 *
 * No external packages (express/mongodb/jsonwebtoken/bcrypt are not
 * installed and can't be installed in this sandbox), so this uses only
 * Node's built-in `http`. See db.js for the swap-to-real-MongoDB note.
 *
 * Run:   node server.js
 * Env:   PORT (default 8787), ADMIN_USER, ADMIN_PASS (first-run only,
 *        used to seed the first admin account if none exists yet).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- helpers ----------
function send(res, status, body, headers) {
  const h = Object.assign(
    { 'Content-Type': 'application/json; charset=utf-8' },
    corsHeaders(),
    headers || {}
  );
  res.writeHead(status, h);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // Chromium's Private Network Access check: needed when the page calling
    // this server (e.g. the userscript on agar-ar.com) is "public" and this
    // server is reached over localhost/a private IP (local testing, or a
    // self-hosted box on a LAN). Harmless to send always.
    'Access-Control-Allow-Private-Network': 'true',
  };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) { reject(new Error('body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let s = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) s += '-';
    s += alphabet[crypto.randomInt(alphabet.length)];
  }
  return s;
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
}
async function log(type, extra) {
  await db.collection('logs').insertOne({ ts: Date.now(), type, ...extra });
  const logs = db._state().logs;
  if (logs.length > 2000) logs.splice(0, logs.length - 2000); // keep it bounded
}
function defaultPermissions() {
  return {
    lines: true, pin: true, fps: true, colors: true,
    macro: true, clip: true, alerts: true, profiles: true, recorder: true,
  };
}

// ---------- admin bootstrap ----------
async function ensureAdmin() {
  const admins = db.collection('admins');
  const count = await admins.countDocuments({});
  if (count > 0) return;
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || crypto.randomBytes(6).toString('hex');
  const { salt, hash } = auth.hashPassword(pass);
  await admins.insertOne({ username: user, salt, hash, createdAt: Date.now() });
  console.log('================================================');
  console.log(' First-run admin account created:');
  console.log('   username:', user);
  console.log('   password:', pass);
  console.log(' (set ADMIN_USER / ADMIN_PASS env vars next time to pick your own)');
  console.log('================================================');
}

// ---------- auth middleware ----------
async function requireAdmin(req) {
  const hdr = req.headers['authorization'] || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  const payload = token && auth.verify(token);
  if (!payload || payload.role !== 'admin') return null;
  return payload;
}

// ---------- routes ----------
const routes = [];
function route(method, re, handler) { routes.push({ method, re, handler }); }

// -- public: userscript login --
route('POST', /^\/api\/auth\/login$/, async (req, res, m, body) => {
  const code = (body.code || '').trim().toUpperCase();
  const deviceId = (body.deviceId || '').trim() || crypto.randomBytes(8).toString('hex');
  if (!code) return send(res, 400, { ok: false, error: 'missing_code' });

  const rec = await db.collection('codes').findOne({ code });
  const ip = clientIp(req);
  if (!rec) {
    await log('login_fail', { code, ip, reason: 'not_found' });
    return send(res, 401, { ok: false, error: 'invalid_code' });
  }
  if (!rec.active) {
    await log('login_fail', { code, ip, reason: 'revoked' });
    return send(res, 401, { ok: false, error: 'revoked' });
  }
  if (rec.expiresAt && Date.now() > rec.expiresAt) {
    await log('login_fail', { code, ip, reason: 'expired' });
    return send(res, 401, { ok: false, error: 'expired' });
  }
  const usedBy = rec.usedBy || [];
  if (!usedBy.includes(deviceId)) {
    if (rec.maxDevices && usedBy.length >= rec.maxDevices) {
      await log('login_fail', { code, ip, reason: 'device_limit' });
      return send(res, 401, { ok: false, error: 'device_limit' });
    }
    await db.collection('codes').updateOne({ code }, { $addToSet: { usedBy: deviceId } });
  }
  await db.collection('codes').updateOne({ code }, { $set: { lastLoginAt: Date.now() }, $inc: { loginCount: 1 } });

  // Session token: valid 12h at a time, re-checked against the code's own
  // expiry/active flag on every /validate call, so revoking a code kicks
  // the user out the next time the tool re-checks (every few minutes).
  const exp = Math.min(Date.now() + 12 * 3600 * 1000, rec.expiresAt || Infinity);
  const token = auth.sign({ role: 'user', code, deviceId, exp });
  await log('login_success', { code, ip, deviceId });
  send(res, 200, {
    ok: true,
    token,
    exp,
    permissions: rec.permissions || defaultPermissions(),
    expiresAt: rec.expiresAt || null,
    note: rec.note || '',
  });
});

route('POST', /^\/api\/auth\/validate$/, async (req, res, m, body) => {
  const payload = auth.verify(body.token);
  if (!payload || payload.role !== 'user') return send(res, 401, { valid: false, reason: 'bad_token' });
  const rec = await db.collection('codes').findOne({ code: payload.code });
  if (!rec || !rec.active) return send(res, 401, { valid: false, reason: 'revoked' });
  if (rec.expiresAt && Date.now() > rec.expiresAt) return send(res, 401, { valid: false, reason: 'expired' });
  send(res, 200, {
    valid: true,
    permissions: rec.permissions || defaultPermissions(),
    expiresAt: rec.expiresAt || null,
    exp: payload.exp,
  });
});

// -- admin: login --
route('POST', /^\/api\/admin\/login$/, async (req, res, m, body) => {
  const { username, password } = body;
  const rec = await db.collection('admins').findOne({ username });
  if (!rec || !auth.checkPassword(password || '', rec.salt, rec.hash)) {
    await log('admin_login_fail', { username, ip: clientIp(req) });
    return send(res, 401, { ok: false, error: 'invalid_credentials' });
  }
  const token = auth.sign({ role: 'admin', username, exp: Date.now() + 8 * 3600 * 1000 });
  send(res, 200, { ok: true, token });
});

// -- admin: codes CRUD --
route('GET', /^\/api\/admin\/codes$/, async (req, res) => {
  if (!(await requireAdmin(req))) return send(res, 401, { error: 'unauthorized' });
  const codes = await db.collection('codes').find({});
  send(res, 200, { codes: codes.sort((a, b) => b.createdAt - a.createdAt) });
});

route('POST', /^\/api\/admin\/codes$/, async (req, res, m, body) => {
  if (!(await requireAdmin(req))) return send(res, 401, { error: 'unauthorized' });
  const code = (body.code || genCode()).trim().toUpperCase();
  const existing = await db.collection('codes').findOne({ code });
  if (existing) return send(res, 409, { error: 'code_exists' });
  const durationDays = Number(body.durationDays) || 30;
  const doc = {
    code,
    createdAt: Date.now(),
    expiresAt: durationDays > 0 ? Date.now() + durationDays * 86400000 : null,
    durationDays,
    permissions: Object.assign(defaultPermissions(), body.permissions || {}),
    maxDevices: Number(body.maxDevices) || 1,
    usedBy: [],
    active: true,
    note: body.note || '',
    loginCount: 0,
  };
  const inserted = await db.collection('codes').insertOne(doc);
  send(res, 200, { ok: true, code: inserted });
});

route('PATCH', /^\/api\/admin\/codes\/([^/]+)$/, async (req, res, m, body) => {
  if (!(await requireAdmin(req))) return send(res, 401, { error: 'unauthorized' });
  const code = decodeURIComponent(m[1]).toUpperCase();
  const rec = await db.collection('codes').findOne({ code });
  if (!rec) return send(res, 404, { error: 'not_found' });
  const set = {};
  if (body.active !== undefined) set.active = !!body.active;
  if (body.note !== undefined) set.note = String(body.note);
  if (body.maxDevices !== undefined) set.maxDevices = Number(body.maxDevices);
  if (body.permissions) set.permissions = Object.assign({}, rec.permissions, body.permissions);
  if (body.extendDays) set.expiresAt = (rec.expiresAt && rec.expiresAt > Date.now() ? rec.expiresAt : Date.now()) + Number(body.extendDays) * 86400000;
  if (body.setExpiresInDays !== undefined) set.expiresAt = Number(body.setExpiresInDays) > 0 ? Date.now() + Number(body.setExpiresInDays) * 86400000 : null;
  if (body.resetDevices) set.usedBy = [];
  await db.collection('codes').updateOne({ code }, { $set: set });
  const updated = await db.collection('codes').findOne({ code });
  send(res, 200, { ok: true, code: updated });
});

route('DELETE', /^\/api\/admin\/codes\/([^/]+)$/, async (req, res, m) => {
  if (!(await requireAdmin(req))) return send(res, 401, { error: 'unauthorized' });
  const code = decodeURIComponent(m[1]).toUpperCase();
  const r = await db.collection('codes').deleteOne({ code });
  send(res, 200, { ok: r.deletedCount > 0 });
});

route('GET', /^\/api\/admin\/logs$/, async (req, res) => {
  if (!(await requireAdmin(req))) return send(res, 401, { error: 'unauthorized' });
  const logs = (await db.collection('logs').find({})).sort((a, b) => b.ts - a.ts).slice(0, 300);
  send(res, 200, { logs });
});

route('GET', /^\/api\/admin\/stats$/, async (req, res) => {
  if (!(await requireAdmin(req))) return send(res, 401, { error: 'unauthorized' });
  const codes = await db.collection('codes').find({});
  const logs = await db.collection('logs').find({});
  const now = Date.now();
  send(res, 200, {
    totalCodes: codes.length,
    activeCodes: codes.filter((c) => c.active && (!c.expiresAt || c.expiresAt > now)).length,
    expiredCodes: codes.filter((c) => c.expiresAt && c.expiresAt <= now).length,
    revokedCodes: codes.filter((c) => !c.active).length,
    totalLogins: logs.filter((l) => l.type === 'login_success').length,
    failedLogins: logs.filter((l) => l.type === 'login_fail').length,
    devicesInUse: codes.reduce((s, c) => s + (c.usedBy ? c.usedBy.length : 0), 0),
  });
});

// ---------- static file serving (admin panel) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' || urlPath === '/admin' || urlPath === '/admin/' ? '/admin.html' : urlPath;
  rel = rel.replace(/^\/+/, '');
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, { error: 'not_found' });
    const ext = path.extname(full);
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, corsHeaders()));
    res.end(data);
  });
}

// ---------- main dispatcher ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); return res.end(); }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    try {
      const body = (req.method === 'POST' || req.method === 'PATCH') ? await readBody(req) : {};
      return await r.handler(req, res, m, body);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: 'server_error' });
    }
  }
  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  send(res, 404, { error: 'not_found' });
});

ensureAdmin().then(() => {
  server.listen(PORT, () => console.log(`[license-server] listening on http://localhost:${PORT}  (admin panel: /admin)`));
});
