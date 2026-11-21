/* Emberfall — home music, regional server browser, multiplayer, chat, app install.
   Loaded BEFORE the game script; touches game globals (S, pl, mode, human, tgAdd…) lazily. */
(() => {
'use strict';
const PROTO = 1, NAME_KEY = 'emberfall_name', SEL_KEY = 'emberfall_server', CUS_KEY = 'emberfall_custom';
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} return null; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const idOk = s => String(s).replace(/[^\w-]/g, '');
const isElectron = /Electron/i.test(navigator.userAgent);
const isLocalHost = h => /^(localhost|127\.|\[::1\]|10\.|192\.168\.)/.test(h);

// ======================================================= HOME-SCREEN MUSIC (infinite loop, home screen only)
const Music = (() => {
  const a = new Audio('assets/home-theme.mp3'); a.loop = true; a.preload = 'auto'; a.volume = 0;
  const VOL = 0.55; let want = false, armed = false, fx = 0;
  const fade = (to, ms, done) => { clearInterval(fx); const from = a.volume, t0 = performance.now();
    fx = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (to - from) * k; if (k >= 1) { clearInterval(fx); done && done(); } }, 40); };
  const play = () => a.play().then(() => { if (want) fade(VOL, 1800); }).catch(() => arm());
  const arm = () => { if (armed) return; armed = true; // browsers block sound until the first click/key — start on it
    const go = () => { armed = false; removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); if (want) play(); };
    addEventListener('pointerdown', go, true); addEventListener('keydown', go, true); };
  setInterval(() => { try { a.muted = !!mute; } catch (e) {} }, 250);       // follows the game's M / 🔊 mute
  document.addEventListener('visibilitychange', () => { if (!want) return; document.hidden ? a.pause() : play(); });
  return { get active() { return want; }, get el() { return a; },
    home() { want = true; if (a.paused) play(); else fade(VOL, 800); },
    stop() { want = false; fade(0, 900, () => { if (!want) { a.pause(); a.currentTime = 0; } }); } };
})();

// ======================================================= SERVERS / MULTIPLAYER
let servers = [], stat = {}, ready = false, probing = true, deferred = null;
let ws = null, cur = null, online = false, manual = false, fatal = false, attempt = 0, rt = 0, wasConn = false;
let myId = 0, regionName = '', pingMs = 0, onlineN = 0, lastSent = '', lastT = 0, lastDraw = performance.now();
const peers = new Map();
const here = /^https?:$/.test(location.protocol) ? { id: 'here', name: isElectron ? 'This PC' : 'This server', emoji: '🏠', url: location.origin } : null;
const PAL = [{ c1: [.75, .25, .3], c2: [.25, .2, .2], hair: [.9, .8, .3] }, { c1: [.2, .6, .4], c2: [.2, .25, .2], hair: [.15, .1, .08] }, { c1: [.55, .35, .8], c2: [.2, .15, .3], hair: [.9, .9, .95] },
  { c1: [.85, .55, .15], c2: [.3, .2, .1], hair: [.4, .2, .1] }, { c1: [.25, .6, .8], c2: [.15, .2, .3], hair: [.95, .5, .2] }, { c1: [.8, .8, .75], c2: [.35, .35, .4], hair: [.2, .2, .25], cape: [.2, .3, .7] }];

function norm(u) {
  u = String(u || '').trim().replace(/\/+$/, ''); if (!u) return null;
  if (!/^(https?|wss?):\/\//i.test(u)) u = (isLocalHost(u) ? 'http://' : 'https://') + u;
  const http = u.replace(/^ws/i, 'http'); try { new URL(http); } catch (e) { return null; }
  return { http, ws: http.replace(/^http/, 'ws') + '/ws' };
}
const custom = () => { try { return JSON.parse(LS(CUS_KEY) || '[]').filter(s => s && s.id && norm(s.url)); } catch (e) { return []; } };
const all = () => { const L = servers.map(s => ({ ...s, id: idOk(s.id) })).filter(s => s.id && norm(s.url));
  if (here && !L.some(s => new URL(norm(s.url).http).host === location.host)) L.push(here);
  return [...L, ...custom()].map(s => ({ ...s, u: norm(s.url) })); };

async function probe(s) {
  const one = async () => { const c = new AbortController(), to = setTimeout(() => c.abort(), 4000), t0 = performance.now();
    try { const r = await fetch(s.u.http + '/status', { cache: 'no-store', signal: c.signal }), j = await r.json(); if (j.game !== 'emberfall') throw 0; return { ms: performance.now() - t0, j }; } finally { clearTimeout(to); } };
  try { await one(); const r = await one(); stat[s.id] = r.j.v === PROTO ? { ok: true, ping: Math.max(1, Math.round(r.ms)), online: r.j.online, max: r.j.max, name: r.j.name } : { ok: false, old: true }; }
  catch (e) { stat[s.id] = { ok: false }; }
}
async function probeAll() { probing = true; await Promise.all(all().map(probe)); probing = false; chip(); }
function resolve() {
  const sel = LS(SEL_KEY) || 'auto'; if (sel === 'offline') return null; const L = all();
  if (sel === 'auto') { const ok = L.filter(s => stat[s.id]?.ok && stat[s.id].online < stat[s.id].max);
    const far = ok.filter(s => !(s.id === 'here' && isLocalHost(location.hostname))).sort((a, b) => stat[a.id].ping - stat[b.id].ping)[0];
    return far || (!isElectron && ok.find(s => s.id === 'here')) || null; }   // plain localhost/LAN run: fall back to this host
  const s = L.find(x => x.id === sel); return s && stat[s.id]?.ok ? s : null;
}
const myName = () => { let n = (LS(NAME_KEY) || '').trim(); if (!n) { n = 'Shardbound' + (100 + Math.random() * 900 | 0); LS(NAME_KEY, n); } return n; };

function chipText() {
  const sel = LS(SEL_KEY) || 'auto', s = resolve();
  if (sel === 'offline') return '📴 Offline · single-player';
  if (s) { const t = stat[s.id]; return `${s.emoji || '🌐'} ${esc(s.name)} · ${t.ping} ms · ${t.online}/${t.max} online`; }
  return probing ? '🌐 Finding nearest server…' : (sel === 'auto' ? '📴 No servers reachable · single-player' : '📴 Server offline · single-player');
}
function chip() { const b = document.querySelector('.mp-srv'); if (b) b.innerHTML = chipText() + ' ▾'; }

function rowHTML(id, emoji, name, sub, st, sel) {
  const pc = st && st.ok ? (st.ping < 90 ? 'g' : st.ping < 200 ? 'y' : 'r') : '';
  const right = st ? (st.ok ? `<span class="p ${pc}">${st.ping} ms</span>` : `<span class="p x">${st.old ? 'Outdated' : 'Offline'}</span>`) : '';
  return `<div class="srv${sel ? ' sel' : ''}${st && !st.ok ? ' off' : ''}" onclick="Net.pick('${id}')"><span class="e">${emoji}</span><span class="n"><b>${esc(name)}</b><small>${sub}</small></span>${right}</div>`;
}
function listHTML() {
  const sel = LS(SEL_KEY) || 'auto', L = all(), a = resolve();
  let h = rowHTML('auto', '✨', 'Auto — nearest region', probing ? 'Measuring…' : a ? `Will join ${esc(a.name)}` : 'No servers reachable', null, sel === 'auto');
  const best = L.filter(s => stat[s.id]?.ok).sort((x, y) => stat[x.id].ping - stat[y.id].ping)[0];
  for (const s of L) { const t = stat[s.id]; const sub = !t ? 'Checking…' : t.ok ? `${t.online}/${t.max} players${t.online >= t.max ? ' · FULL' : ''}${best && best.id === s.id && L.length > 1 ? ' · ★ fastest' : ''}` : (t.old ? 'Needs an update' : 'Not reachable');
    h += rowHTML(s.id, s.emoji || '🌐', s.name, sub, t, sel === s.id); }
  return h + rowHTML('offline', '📴', 'Offline', 'Single-player, no connection', null, sel === 'offline');
}

function open() {
  clearTimeout(rt); setPill();
  let w; try { w = new WebSocket(cur.u.ws); } catch (e) { return retry(); }
  ws = w; const to = setTimeout(() => { try { w.close(); } catch (e) {} }, 8000);
  w.onopen = () => { clearTimeout(to); w.send(JSON.stringify({ t: 'join', v: PROTO, name: myName(), lv: lvl(), x: pl.x, z: pl.z })); };
  w.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
  w.onclose = () => { clearTimeout(to); if (ws !== w) return; ws = null; online = false; peers.clear(); setPill(); if (!manual && !fatal) retry(); };
  w.onerror = () => {};
}
function retry() { attempt++; setPill(); if (attempt === 2) toast('⚠ Can’t reach the server — retrying…'); rt = setTimeout(open, Math.min(10000, 1000 * attempt)); }
function onMsg(m) {
  switch (m.t) {
    case 'welcome': myId = m.id; online = true; attempt = 0; regionName = m.region; peers.clear(); m.players.forEach(addPeer);
      toast(wasConn ? '🌐 Reconnected' : `🌐 Connected to ${m.region} — ${m.players.length + 1} online`); wasConn = true; sendPing(); setPill(); break;
    case 'join': addPeer(m.p); break;
    case 'leave': peers.delete(m.id); break;
    case 's': for (const r of m.p) { const p = peers.get(r[0]); if (p) { p.tx = r[1]; p.tz = r[2]; p.ta = r[3]; p.mv = r[4]; p.st = r[5]; p.lv = r[6]; } } break;
    case 'chat': chatLine(m.name, m.m, m.id === myId); break;
    case 'sys': chatLine('', m.m, false, true); break;
    case 'pong': pingMs = Math.round(performance.now() - m.ts); onlineN = m.online; setPill(); break;
    case 'full': fatal = true; toast('Server is full — playing offline. Pick another on the home screen.'); break;
    case 'err': fatal = true; toast('⚠ ' + m.m); break;
  }
}
const addPeer = p => peers.set(p.id, { ...p, tx: p.x, tz: p.z, ta: p.a, seen: 0 });
const sendPing = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })); };

// ---- HUD: connection pill, players panel, chat ----
const css = document.createElement('style');
css.textContent = `
.mp-name{margin:0 0 12px}.mp-name input,#curl,#mp-in{font:600 16px var(--ui);color:var(--gold2);background:#0d0620cc;border:1px solid #ffc46877;border-radius:10px;padding:9px 14px;outline:none;user-select:text;-webkit-user-select:text;width:260px;text-align:center}
.mp-name input:focus,#curl:focus,#mp-in:focus{border-color:var(--gold);box-shadow:0 0 14px #ffb34766}
.mp-srv{font-size:15px!important;min-width:300px;background:linear-gradient(180deg,#1f3a5c,#0e1d33)!important;border-color:#7fd8ff99!important;color:#d8f2ff!important}
.mp-srv:hover{background:linear-gradient(180deg,#2c5280,#14294a)!important;box-shadow:0 6px 16px #000a,0 0 14px #7fd8ff55!important}
.mp-sm{font-size:14px!important;padding:7px 16px!important}.mp-hint{font:14px var(--ui);color:var(--mut);text-align:center!important;margin:0 0 14px}
#modal{align-items:flex-start!important}#modal>div{margin:auto}
.mp-list{display:flex;flex-direction:column;gap:7px;text-align:left;max-height:min(44vh,400px);overflow:auto;padding:2px 6px 2px 2px}
.srv{display:flex;align-items:center;gap:14px;padding:8px 16px;border-radius:12px;cursor:pointer;background:linear-gradient(180deg,#2a1a50d4,#130a2ae0);border:1px solid #ffc46833;transition:transform .1s,border-color .1s,background .1s}
.srv:hover{transform:translateX(3px);border-color:#ffc468aa;background:linear-gradient(180deg,#3a2470,#1c0f3c)}.srv.sel{border-color:var(--gold);box-shadow:0 0 16px #ffb34744,inset 0 0 0 1px #ffc46855}
.srv.off{opacity:.5;cursor:not-allowed}.srv .e{font-size:26px}.srv .n{flex:1}.srv .n b{display:block;font:700 16px var(--disp);letter-spacing:1px;color:var(--gold2)}.srv small{font:12px var(--ui);color:var(--mut)}
.srv .p{font:700 14px var(--ui)}.p.g{color:#7ee08a}.p.y{color:#ffd24a}.p.r{color:#ff9a7a}.p.x{color:#ff7a7a}
.mp-custom{display:flex;gap:8px;justify-content:center;margin:16px 0 4px}#curl{width:330px;text-align:left;font-weight:400}
#mp-pill{position:fixed;top:218px;right:14px;z-index:3;font:600 12px var(--ui);padding:4px 12px;border-radius:12px;cursor:pointer;background:#130a2ad8;border:1px solid #7fd8ff77;color:#d8f2ff;display:none}
#mp-pill.bad{border-color:#ff7a7a99;color:#ffb0a0}
#mp-players{position:fixed;top:250px;right:14px;z-index:6;width:250px;max-height:50vh;overflow:auto;padding:10px 14px;font:13px var(--ui);display:none}
#mp-players h4{margin:0 0 6px;font:700 14px var(--disp);letter-spacing:1px;color:var(--gold2)}#mp-players div{display:flex;justify-content:space-between;gap:8px;padding:2px 0}#mp-players small{color:var(--mut)}
#mp-chat{position:fixed;left:14px;bottom:14px;width:min(360px,40vw);z-index:4;display:none;pointer-events:none}
#mp-log{display:flex;flex-direction:column;gap:2px;margin-bottom:6px;font:600 14px var(--ui);text-shadow:0 1px 3px #000,0 0 8px #000}
#mp-log .l{padding:2px 10px;border-radius:8px;background:#130a2a99;transition:opacity 1.2s;word-break:break-word}#mp-log .l.old{opacity:0}#mp-chat.open #mp-log .l.old{opacity:1}
#mp-log b{color:#8fe6ff}#mp-log .me b{color:var(--gold)}#mp-log .sys{color:var(--mut);font-style:italic;font-weight:400}
#mp-in{display:none;width:100%;text-align:left;font-weight:400;pointer-events:auto}#mp-chat.open #mp-in{display:block}`;
document.head.appendChild(css);
const mk = (tag, id, cls) => { const e = document.createElement(tag); e.id = id; if (cls) e.className = cls; document.body.appendChild(e); return e; };
const pill = mk('div', 'mp-pill'), panel = mk('div', 'mp-players', 'box'), chat = mk('div', 'mp-chat'), log = document.createElement('div'), inp = document.createElement('input');
log.id = 'mp-log'; inp.id = 'mp-in'; inp.maxLength = 120; inp.placeholder = 'Say something…  Enter = send · Esc = cancel'; inp.autocomplete = 'off'; chat.append(log, inp);

function setPill() {
  if (!cur) { pill.style.display = 'none'; return; }
  const ok = online && ws && ws.readyState === 1; pill.className = ok ? '' : 'bad';
  pill.textContent = ok ? `🌐 ${regionName} · ${pingMs || '…'} ms · ${onlineN || peers.size + 1} online` : (attempt ? '⚠ Reconnecting…' : '🌐 Connecting…');
}
function chatLine(name, text, mine, sys) {
  const l = document.createElement('div'); l.className = 'l' + (mine ? ' me' : '') + (sys ? ' sys' : '');
  if (name) { const b = document.createElement('b'); b.textContent = name + ' '; l.append(b); } l.append(document.createTextNode(text));
  log.append(l); while (log.children.length > 8) log.firstChild.remove(); setTimeout(() => l.classList.add('old'), 9000);
}
function openChat() {
  if (!online) { toast('💬 Chat needs an online server — pick one on the home screen'); return; }
  Object.keys(keys).forEach(k => keys[k] = 0); chat.classList.add('open'); inp.value = ''; inp.focus();
}
function closeChat() { chat.classList.remove('open'); inp.blur(); }
inp.addEventListener('keydown', e => { e.stopPropagation();
  if (e.key === 'Enter') { const m = inp.value.trim(); if (m && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'chat', m })); closeChat(); }
  else if (e.key === 'Escape') closeChat(); });
inp.addEventListener('keyup', e => e.stopPropagation());
inp.addEventListener('blur', () => chat.classList.remove('open'));
function renderPanel() {
  const zn = p => { const z = zi(p.x, p.z); return z >= 0 ? ZN[z].n : 'The Wilds'; };
  let h = `<h4>Players online (${peers.size + 1})</h4><div><b>${esc(myName())} <small>(you)</small></b><small>Lv ${lvl()}</small></div>`;
  for (const p of peers.values()) h += `<div><span>${esc(p.name)}${p.st ? ' ⚔' : ''}<br><small>${esc(zn(p))}</small></span><small>Lv ${p.lv}</small></div>`;
  panel.innerHTML = h;
}
const togglePanel = () => { const on = panel.style.display !== 'block'; panel.style.display = on ? 'block' : 'none'; if (on) renderPanel(); };
pill.onclick = togglePanel;
addEventListener('keydown', e => {
  if (!ready || document.activeElement === inp) return;
  if (e.code === 'Enter' && !e.repeat && mode === 'play') { e.preventDefault(); document.activeElement && document.activeElement.blur(); openChat(); }
  else if (e.code === 'Tab' && cur && mode !== 'menu') { e.preventDefault(); togglePanel(); }
});

setInterval(() => {                                   // 10 Hz: send my position when it changed
  if (!ready || !online || !ws || ws.readyState !== 1 || !S) return;
  const bat = mode === 'battle', mv = bat ? 0 : (pl.mv | 0), k = [pl.x.toFixed(1), pl.z.toFixed(1), pl.a.toFixed(2), mv, bat | 0, lvl()].join(), now = performance.now();
  if (k === lastSent && now - lastT < 1500) return; lastSent = k; lastT = now;
  ws.send(JSON.stringify({ t: 'pos', x: +pl.x.toFixed(2), z: +pl.z.toFixed(2), a: +pl.a.toFixed(2), mv, st: bat | 0, lv: lvl() }));
}, 100);
setInterval(() => { if (ready && online) sendPing(); }, 5000);
setInterval(() => {                                   // UI visibility
  if (!ready) return; const inGame = !!cur && mode !== 'menu', btl = mode === 'battle';
  pill.style.display = inGame ? 'block' : 'none'; chat.style.display = inGame && !btl && online ? 'block' : 'none';
  if (!inGame || btl) panel.style.display = 'none'; else if (panel.style.display === 'block') renderPanel(); setPill();
}, 500);

const Net = {
  get ready() { return ready; }, get online() { return online; }, get peerCount() { return peers.size; }, get peers() { return peers; },
  homeHTML() { ready = true;
    return `<div class="mp-name"><input id="pname" maxlength="16" placeholder="Your name" value="${esc(LS(NAME_KEY) || '')}" onkeydown="event.stopPropagation()" oninput="Net.setName(this.value)" autocomplete="off" spellcheck="false"></div>`; },
  serverHTML() { return `<button class="mp-srv" onclick="Net.browse()">${chipText()} ▾</button><br>`; },
  installHTML() { const sa = matchMedia('(display-mode: standalone)').matches || navigator.standalone; return (sa || isElectron || !here) ? '' : '<br><button class="mp-sm" onclick="Net.install()">📲 Install as App</button>'; },
  setName(v) { LS(NAME_KEY, v.replace(/[^\p{L}\p{N} _\-'.]/gu, '').slice(0, 16)); },
  async browse() {
    modal(`<h1 style="font-size:40px;letter-spacing:6px;margin-bottom:4px">SERVERS</h1><p class="mp-hint">Pick the region closest to you for the lowest lag. Everyone on a server shares one world; your save stays on your device.</p><div class="mp-list" id="mp-list">${listHTML()}</div>
      <div class="mp-custom"><input id="curl" placeholder="Custom server, e.g. play.example.com" onkeydown="event.stopPropagation();if(event.key==='Enter')Net.addCustom()"><button class="mp-sm" onclick="Net.addCustom()">Add</button></div>
      <div style="text-align:center"><button class="mp-sm" onclick="Net.browse()">⟳ Refresh</button><button class="mp-sm" onclick="menu()">Back</button></div>`);
    await probeAll(); const l = document.getElementById('mp-list'); if (l) l.innerHTML = listHTML();
  },
  pick(id) { id = idOk(id); const t = stat[id];
    if (id !== 'auto' && id !== 'offline' && !(t && t.ok)) return toast('That server isn’t reachable right now');
    LS(SEL_KEY, id); sfx('click'); menu(); },
  async addCustom() {
    const v = document.getElementById('curl').value, u = norm(v); if (!u) return toast('Enter a server address');
    const id = 'c' + Date.now().toString(36), s = { id, name: new URL(u.http).host, emoji: '🛰️', url: u.http, u }; await probe(s);
    if (!stat[id].ok) return toast('Couldn’t reach that server');
    s.name = stat[id].name && stat[id].name !== 'Local' ? stat[id].name : s.name; delete s.u;
    LS(CUS_KEY, JSON.stringify([...custom().map(({ u, ...r }) => r), s])); LS(SEL_KEY, id); menu();
  },
  connect() { this.disconnect(); fatal = false; wasConn = false; const s = resolve();
    if (!s) { cur = null; if ((LS(SEL_KEY) || 'auto') !== 'offline') toast('📴 No server reachable — playing offline'); return; }
    cur = s; manual = false; attempt = 0; regionName = s.name; open(); },
  disconnect() { manual = true; clearTimeout(rt); if (ws) { const w = ws; ws = null; try { w.close(); } catch (e) {} } online = false; cur = null; peers.clear(); closeChat(); setPill(); },
  openChat, goHome() { if (mode !== 'play') return toast('Finish what you’re doing first'); save(true); menu(); },
  install() { if (deferred) { deferred.prompt(); deferred.userChoice.finally(() => deferred = null); return; }
    modal(`<h3>Install Emberfall as an app</h3><ul><li><b>Chrome / Edge:</b> click the install icon (⊕) at the right end of the address bar, or ⋮ → <i>Install Emberfall</i>.</li><li><b>Safari on Mac:</b> File → Add to Dock.</li><li><b>iPhone / iPad:</b> Share → Add to Home Screen.</li><li><b>Android:</b> ⋮ → Install app.</li></ul><div style="text-align:center"><button onclick="menu()">Back</button></div>`); },
  draw(eye, t) {
    if (!peers.size) return; const now = performance.now(), dt = Math.min(.1, (now - lastDraw) / 1000) || .016; lastDraw = now; TCOL.ply || (TCOL.ply = '#8fe6ff');
    const arr = [...peers.values()];
    for (const p of arr) { const dx = p.tx - p.x, dz = p.tz - p.z;
      if (dx * dx + dz * dz > 900) { p.x = p.tx; p.z = p.tz; } else { const k = Math.min(1, dt * 10); p.x += dx * k; p.z += dz * k; }
      p.a += Math.atan2(Math.sin(p.ta - p.a), Math.cos(p.ta - p.a)) * Math.min(1, dt * 12); p._d = Math.hypot(p.x - eye[0], p.z - eye[2]); }
    arr.filter(p => p._d < 160).sort((a, b) => a._d - b._d).slice(0, 24).forEach(p => {
      human(p.x, p.z, p.a, PAL[p.id % PAL.length], Math.sin(t * 10 + p.id) * .28 * (p.mv ? 1 : 0), 1, 0);
      if (p._d < 75) tgAdd(p.x, hf(p.x, p.z) + 3.3, p.z, esc(p.name), 'ply', null, 'Lv ' + p.lv + (p.st ? ' ⚔' : '')); });
  },
  mm(c, X, Y, u) { for (const p of peers.values()) { c.beginPath(); c.arc(X(p.x), Y(p.z), 2.8 * u, 0, 6.3); c.fillStyle = '#8fe6ff'; c.fill(); c.lineWidth = u; c.strokeStyle = '#0a1830'; c.stroke(); } },
};
window.Net = Net; window.Music = Music;

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
(async () => {                                        // load the region list, then measure ping in the background
  try { const r = await fetch('servers.json', { cache: 'no-cache' }); servers = (await r.json()).servers || []; } catch (e) { servers = []; }
  probeAll();
})();
if ('serviceWorker' in navigator && !isElectron && /^https?:$/.test(location.protocol) && (location.protocol === 'https:' || isLocalHost(location.hostname)))
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
