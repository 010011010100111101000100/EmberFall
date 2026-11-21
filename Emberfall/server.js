#!/usr/bin/env node
'use strict';
/**
 * Emberfall server — zero dependencies (Node 18+).
 *   • serves the game from ./public (with HTTP Range support for the music)
 *   • GET /status   → JSON used by the in-game server browser (players, ping)
 *   • WS  /ws       → realtime shared world (positions, chat)
 *
 * Run one copy per region. Config via env:
 *   PORT=8787  REGION_NAME="Asia"  REGION_ID=asia  MAX_PLAYERS=64  ALLOWED_ORIGINS=https://a.com,https://b.com
 */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PROTOCOL = 1, WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8' };
const NOCACHE = new Set(['.html', '.json', '.webmanifest']);

function start(opts = {}) {
  const PORT = opts.port ?? (+process.env.PORT || 8787), HOST = opts.host || process.env.HOST || '0.0.0.0';
  const MAX = +process.env.MAX_PLAYERS || 64;
  const REGION = process.env.REGION_NAME || 'Local', REGION_ID = process.env.REGION_ID || 'local';
  const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const players = new Map(); let nextId = 1;

  // ---------------------------------------------------------------- HTTP
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const headers = { 'X-Content-Type-Options': 'nosniff' };
    if (url.pathname === '/status' || url.pathname === '/healthz') {
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ game: 'emberfall', v: PROTOCOL, id: REGION_ID, name: REGION, online: players.size, max: MAX }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers); return res.end(); }
    let rel; try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, headers); return res.end('Not found'); }
      const ext = path.extname(file).toLowerCase();
      headers['Content-Type'] = MIME[ext] || 'application/octet-stream';
      headers['Cache-Control'] = NOCACHE.has(ext) || rel.endsWith('/sw.js') ? 'no-cache' : 'public, max-age=3600';
      headers['Accept-Ranges'] = 'bytes';
      let start = 0, end = st.size - 1, code = 200;
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(end, +m[2]); } else { start = Math.max(0, st.size - +m[2]); }
        if (start > end || start >= st.size) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` }); return res.end(); }
        code = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      }
      headers['Content-Length'] = end - start + 1;
      res.writeHead(code, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
    });
  });

  // ---------------------------------------------------------------- WebSocket (RFC 6455, minimal)
  function frame(op, payload) {
    const len = payload.length; let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    return Buffer.concat([h, payload]);
  }
  const send = (p, obj) => { if (p.sock.destroyed || !p.sock.writable) return; try { p.sock.write(frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)))); } catch {} };
  const broadcast = (obj, except) => { const s = JSON.stringify(obj); for (const p of players.values()) if (p !== except && p.ready) send(p, s); };
  const closeSock = (p, code = 1000) => { try { const b = Buffer.alloc(2); b.writeUInt16BE(code); p.sock.write(frame(8, b)); } catch {} p.sock.end(); setTimeout(() => p.sock.destroy(), 500); };
  const clean = (s, n) => String(s ?? '').replace(/[^\p{L}\p{N} _\-'.!?,:;()]/gu, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const num = (v, lo, hi, d = 0) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
  const pub = p => ({ id: p.id, name: p.name, lv: p.lv, x: p.x, z: p.z, a: p.a, mv: p.mv, st: p.st });

  server.on('upgrade', (req, sock) => {
    const url = new URL(req.url, 'http://x'), key = req.headers['sec-websocket-key'];
    const origin = req.headers.origin;
    if (url.pathname !== '/ws' || !key || (ORIGINS.length && origin && !ORIGINS.includes(origin))) { sock.write('HTTP/1.1 400 Bad Request\r\n\r\n'); return sock.destroy(); }
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
      crypto.createHash('sha1').update(key + WS_GUID).digest('base64') + '\r\n\r\n');
    sock.setNoDelay(true);
    const p = { sock, id: 0, ready: false, alive: true, name: 'Shardbound', lv: 1, x: 2, z: 12, a: 0, mv: 0, st: 0, dirty: false, tokens: 40, lastChat: 0 };
    let buf = Buffer.alloc(0);
    const joinTimer = setTimeout(() => { if (!p.ready) closeSock(p, 1008); }, 6000);

    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 15, fin = buf[0] & 0x80, masked = buf[1] & 0x80; let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (!masked || len > 2048 || !fin || op === 0) return closeSock(p, 1009);
        if (buf.length < off + 4 + len) return;
        const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
        for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
        buf = buf.subarray(off + 4 + len);
        if (op === 8) return closeSock(p);
        if (op === 9) { sock.write(frame(10, data)); continue; }
        if (op === 10) { p.alive = true; continue; }
        if (op === 1) onMessage(p, data.toString('utf8'));
      }
    });
    const gone = () => {
      clearTimeout(joinTimer);
      if (p.ready && players.get(p.id) === p) { players.delete(p.id); p.ready = false; broadcast({ t: 'leave', id: p.id }); broadcast({ t: 'sys', m: p.name + ' left the realm' }); }
    };
    sock.on('close', gone); sock.on('error', () => sock.destroy());
  });

  function onMessage(p, raw) {
    p.tokens -= 1; if (p.tokens < 0) return; // flood protection (refilled below)
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!p.ready) {
      if (m.t !== 'join') return;
      if (m.v !== PROTOCOL) { send(p, { t: 'err', m: 'Client/server version mismatch — refresh the game.' }); return closeSock(p, 1002); }
      if (players.size >= MAX) { send(p, { t: 'full' }); return closeSock(p, 1013); }
      p.id = nextId++; p.name = clean(m.name, 16) || 'Shardbound'; p.lv = Math.round(num(m.lv, 1, 99, 1));
      p.x = num(m.x, -360, 360, 2); p.z = num(m.z, -360, 360, 12); p.ready = true; players.set(p.id, p);
      send(p, { t: 'welcome', id: p.id, v: PROTOCOL, region: REGION, regionId: REGION_ID, max: MAX, players: [...players.values()].filter(q => q !== p).map(pub) });
      broadcast({ t: 'join', p: pub(p) }, p); broadcast({ t: 'sys', m: p.name + ' entered the realm' }, p);
      return;
    }
    switch (m.t) {
      case 'pos': p.x = num(m.x, -360, 360, p.x); p.z = num(m.z, -360, 360, p.z); p.a = num(m.a, -10, 10, p.a);
        p.mv = m.mv ? 1 : 0; p.st = m.st ? 1 : 0; p.lv = Math.round(num(m.lv, 1, 99, p.lv)); p.dirty = true; break;
      case 'chat': { const now = Date.now(); if (now - p.lastChat < 700) return; const msg = clean(m.m, 120); if (!msg) return; p.lastChat = now; broadcast({ t: 'chat', id: p.id, name: p.name, m: msg }); break; }
      case 'ping': send(p, { t: 'pong', ts: m.ts, online: players.size }); break;
    }
  }

  const tick = setInterval(() => { // 10 Hz state broadcast
    const d = []; for (const p of players.values()) { p.tokens = Math.min(40, p.tokens + 4); if (p.dirty) { d.push([p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.a.toFixed(2), p.mv, p.st, p.lv]); p.dirty = false; } }
    if (!d.length) return;
    for (const p of players.values()) { const o = d.filter(r => r[0] !== p.id); if (o.length) send(p, { t: 's', p: o }); }
  }, 100);
  const beat = setInterval(() => { for (const p of players.values()) { if (!p.alive) { p.sock.destroy(); continue; } p.alive = false; try { p.sock.write(frame(9, Buffer.alloc(0))); } catch {} } }, 20000);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      const port = server.address().port;
      console.log(`⚔  Emberfall [${REGION}] listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${port}  (max ${MAX} players)`);
      resolve({ server, port, players, close: () => { clearInterval(tick); clearInterval(beat); for (const p of players.values()) p.sock.destroy(); server.close(); } });
    });
  });
}

module.exports = { start };
if (require.main === module) {
  start().catch(e => { console.error(e.code === 'EADDRINUSE' ? 'Port already in use — set PORT=xxxx' : e); process.exit(1); });
  process.on('SIGTERM', () => process.exit(0));
}
