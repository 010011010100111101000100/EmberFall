// Emberfall service worker — makes the installed app load offline (single-player + music).
const V = 'emberfall-v1';
const PRE = ['./', 'index.html', 'multiplayer.js', 'manifest.webmanifest', 'favicon.ico', 'icons/icon-192.png', 'icons/icon-512.png', 'assets/home-theme.mp3'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(PRE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));

async function ranged(req, url) {                       // media elements ask for byte ranges; serve them from the cached full file
  const c = await caches.open(V); let r = await c.match(url);
  if (!r) { r = await fetch(url); if (!r.ok) return r; await c.put(url, r.clone()); }
  const buf = await r.arrayBuffer(), m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range')) || [];
  const s = m[1] ? +m[1] : 0, e = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(s, e + 1), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${buf.byteLength}` } });
}
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname === '/status' || url.pathname === '/ws') return;
  if (req.headers.has('range')) return e.respondWith(ranged(req, url.origin + url.pathname));
  const fresh = req.mode === 'navigate' || /\.(html|js|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  e.respondWith((async () => {
    const c = await caches.open(V);
    if (fresh) { try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch (x) { return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error(); } }
    const hit = await c.match(req); if (hit) return hit;
    const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
  })());
});
