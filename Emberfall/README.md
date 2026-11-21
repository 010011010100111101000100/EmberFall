# Emberfall: Shardbound — app + multiplayer

```
server.js            game + multiplayer server (no dependencies, needs Node 18+)
public/              the game (index.html, multiplayer.js, manifest, service worker, icons, music, servers.json)
electron/            desktop-app wrapper (own window, own icon, installer)
Dockerfile, deploy/  templates for hosting a regional server
```

## 1. Play right now
```
node server.js          # then open http://localhost:8787
```
Home screen → **Server** button → pick "This server" (or Auto). Open a second tab/browser to test multiplayer.
Friends on your Wi-Fi can join at `http://<your-LAN-ip>:8787`.

## 2. Install it as an app (own window + icon)
**Option A – browser install (PWA).** Open the game from `http://localhost:8787` or any `https://` host, then click
**📲 Install as App** on the home screen (or the install icon in Chrome/Edge's address bar; Safari: File → Add to Dock;
iPhone: Share → Add to Home Screen). It then opens in its own window, with the Emberfall icon, and works offline.

**Option B – real desktop app (Electron).**
```
npm install
npm run app           # run it
npm run dist          # build installer for your OS  (dist:win / dist:mac / dist:linux)
```
Installers appear in `dist/`. Build on the OS you're targeting (Windows .exe on Windows, .dmg on a Mac).

## 3. Regional servers (Asia, Australia, Europe, North America, South America, Africa)
Each region is simply **one copy of `server.js` running in that part of the world**. Players on the same server share one world.

1. Host `server.js` (or the Dockerfile) in each region — Fly.io, Render, Railway, or a cheap VPS all work. Needs HTTPS/WSS if the game page is https.
   Set env vars per copy: `REGION_NAME="Asia"  REGION_ID=asia  PORT=8080  MAX_PLAYERS=64`.
   **Run exactly one process per region** (state lives in memory).
   Fly.io example for Asia (commands not verified here — check `fly` docs if a flag differs):
   ```
   cp deploy/fly.toml fly.asia.toml      # edit app name, REGION_NAME, primary_region (sin/syd/fra/iad/gru/jnb)
   fly launch --no-deploy --copy-config --config fly.asia.toml
   fly deploy --config fly.asia.toml
   ```
2. Put the real URLs in `public/servers.json` (replace the `*.example.com` placeholders), and host the `public/` folder
   (any one of your servers already serves it).
3. In-game, the server list pings every region, shows players/ping, and **Auto** joins the nearest one.
   Servers that aren't deployed show as *Offline*. Players can also type a **custom server** address.

Optional lock-down: `ALLOWED_ORIGINS=https://yourgame.com` on a server only accepts connections from that site.

## What multiplayer does (and doesn't)
Shared live world: see other players walk around (names, levels, ⚔ when in battle), minimap dots, global chat (Enter),
player list (Tab). Your save, deck and progress stay on your own device; card battles are still one-player.
