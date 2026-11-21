'use strict';
// Emberfall desktop app: runs the game server locally (127.0.0.1) and shows it in its own window.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { start } = require('../server.js');

const PORT = 47821;                       // fixed so your save (stored per-origin) is always found
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');   // home-screen music starts immediately
app.setAppUserModelId('com.emberfall.shardbound');

let win = null, srv = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, show: false,
    backgroundColor: '#241338', title: 'Emberfall: Shardbound', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${PORT}/`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${PORT}`)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); } });
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    try { srv = await start({ port: PORT, host: '127.0.0.1' }); } catch (e) { console.warn('local server:', e.code || e); }
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => { if (srv) srv.close(); app.quit(); });
}
