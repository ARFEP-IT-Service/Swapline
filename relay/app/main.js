// „Swapline Relay“ – Oberfläche zur Verwaltung des Vermittlers (Dienst, Kennwort, Port, Firewall, Protokoll).
// Der Vermittler selbst läuft als Dienst (service.js), unabhängig davon, ob dieses Fenster offen ist.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const P = require('./paths.js');
const M = require('./manage.js');
const U = require('./update.js');

const DEV = !app.isPackaged;
const de = () => (app.getLocale() || '').toLowerCase().startsWith('de');
const tr = (d, e) => (de() ? d : e);
app.setAppUserModelId(DEV ? 'de.arfep.swapline.relay.dev' : 'de.arfep.swapline.relay');
if (!process.argv.includes('--repair-service') && !app.requestSingleInstanceLock()) app.quit();

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 760, minWidth: 760, minHeight: 560, title: 'Swapline Relay', backgroundColor: '#0f1115', show: false,
    icon: path.join(__dirname, 'renderer', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Nur Entwicklung/Tests: Bildschirmfoto des Fensters speichern und beenden
  if (DEV && process.env.SWAPLINE_RELAY_SHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      fs.writeFileSync(process.env.SWAPLINE_RELAY_SHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    }, Number(process.env.SWAPLINE_RELAY_SHOT_DELAY) || 8000));
  }
}
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
// Fenster braucht Administratorrechte (Dienst, Firewall, geschützter Datenordner): einmal mit Windows-Abfrage neu
// starten. Abgelehnt → Fenster läuft trotzdem, nur ohne Verwaltungsknöpfe.
function relaunchElevated() {
  return new Promise(resolve => {
    app.releaseSingleInstanceLock();
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    require('node:child_process').execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', "Start-Process -FilePath $env:SR_EXE -ArgumentList '--elevated' -Verb RunAs"],
      { env: { ...process.env, SR_EXE: process.execPath }, windowsHide: true }, err => resolve(!err));
  });
}
app.whenReady().then(async () => {
  // Aufruf aus dem Installer (läuft dort schon als Administrator): Aufgabe nach einem Update angleichen, ohne Fenster
  if (process.argv.includes('--repair-service')) {
    try { await M.repair(); } catch {}
    return app.exit(0);
  }
  if (!DEV && !process.argv.includes('--elevated') && !(await M.isAdmin())) {
    if (await relaunchElevated()) return app.quit();
    app.requestSingleInstanceLock();
  }
  try { P.ensureConfig(); } catch {}
  if (await M.isAdmin()) M.repair().catch(() => {});
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// Adressen dieses Servers (zur Anzeige und für den Einrichtungscode)
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (!a.internal && a.family === 'IPv4') out.push({ address: a.address, name });
  // öffentliche Adressen zuerst, dann lokales Netz, virtuelle Adapter (VPN, Hyper-V …) zuletzt
  const priv = a => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a.address);
  const virt = a => /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Docker|Radmin|Hamachi|ZeroTier|Tailscale|VPN/i.test(a.name);
  const rank = a => (virt(a) ? 2 : priv(a) ? 1 : 0);
  return out.sort((x, y) => rank(x) - rank(y));
}
const validHost = a => typeof a === 'string' && a.length <= 253 && (require('node:net').isIP(a) > 0 || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(a));

function readStatus() {
  try {
    const s = JSON.parse(fs.readFileSync(P.file('status.json'), 'utf8'));
    let alive = false;
    // EPERM: der Dienst läuft als „Lokaler Dienst“ – Windows verweigert dann die Abfrage, der Prozess lebt aber
    try { process.kill(s.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
    return { ...s, alive: alive && Date.now() - s.updated < 8000 };
  } catch { return null; }
}

const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => { try { return await fn(...a); } catch (err) { return { error: String(err.message || err).slice(0, 400) }; } });

let svcCache = null, svcAt = 0;
handle('state', async (force) => {
  const admin = adminOnce(); // parallel zur Dienst-Abfrage (je ein PowerShell-Aufruf)
  if (force || Date.now() - svcAt > 5000) { svcCache = await M.serviceState().catch(() => ({ task: null, firewall: false })); svcAt = Date.now(); }
  const cfg = P.readConfig();
  return {
    version: app.getVersion(), admin: await admin, dataDir: P.dataDir(),
    config: cfg ? { port: cfg.port, hasSecret: true } : null,
    service: svcCache, status: readStatus(), addresses: addresses(), lang: de() ? 'de' : 'en',
  };
});
let adminCache = null;
async function adminOnce() { if (adminCache === null) adminCache = await M.isAdmin(); return adminCache; }

// Kennwort nur auf ausdrücklichen Klick in die Oberfläche; Kopieren direkt aus dem Hauptprozess
handle('secret:show', () => P.readConfig()?.secret || '');
handle('secret:copy', () => { const s = P.readConfig()?.secret; if (s) clipboard.writeText(s); return !!s; });
handle('secret:new', async () => {
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: [tr('Abbrechen', 'Cancel'), tr('Neues Kennwort', 'New password')], defaultId: 0, cancelId: 0, noLink: true,
    title: 'Swapline Relay', message: tr('Neues Kennwort erzeugen?', 'Create a new password?'),
    detail: tr('Alle Swapline-PCs verlieren die Verbindung, bis du dort das neue Kennwort (oder den neuen Einrichtungscode) einträgst.', 'All Swapline PCs lose the connection until you enter the new password (or the new setup code) there.') });
  if (r.response !== 1) return false;
  const c = P.ensureConfig();
  P.writeConfig({ ...c, secret: P.newSecret() });
  if ((await M.serviceState()).task) await M.restart();
  return true;
});
// Einrichtungscode für Swapline am PC: Adresse, Port und Kennwort in einem Text (in Swapline einfügen)
handle('code:copy', (address) => {
  const c = P.readConfig();
  if (!c || !validHost(address)) return false;
  clipboard.writeText('srelay1.' + Buffer.from(JSON.stringify({ a: address, p: c.port, s: c.secret })).toString('base64url'));
  return true;
});
handle('port:set', async (port) => {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { error: tr('Port zwischen 1024 und 65535', 'Port between 1024 and 65535') };
  const c = P.ensureConfig();
  P.writeConfig({ ...c, port });
  const st = await M.serviceState();
  if (st.firewall) await M.setFirewall(port);
  if (st.task) await M.restart();
  svcAt = 0;
  return true;
});
handle('svc:install', async () => { await M.install(); svcAt = 0; return true; });
handle('svc:uninstall', async () => {
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: [tr('Abbrechen', 'Cancel'), tr('Entfernen', 'Remove')], defaultId: 0, cancelId: 0, noLink: true,
    title: 'Swapline Relay', message: tr('Dienst entfernen?', 'Remove service?'),
    detail: tr('Der Vermittler wird beendet und startet nicht mehr mit Windows; die Firewall-Regel wird entfernt. Kennwort und Protokoll bleiben erhalten.', 'The relay is stopped and no longer starts with Windows; the firewall rule is removed. Password and log are kept.') });
  if (r.response !== 1) return false;
  await M.uninstall(); svcAt = 0; return true;
});
handle('svc:start', async () => { await M.start(); svcAt = 0; return true; });
handle('svc:stop', async () => { await M.stop(); svcAt = 0; return true; });
handle('svc:restart', async () => { await M.restart(); svcAt = 0; return true; });
handle('firewall:set', async (on) => {
  const c = P.ensureConfig();
  if (on) await M.setFirewall(c.port); else await M.removeFirewall();
  svcAt = 0; return true;
});
handle('log:tail', () => {
  try {
    const f = P.file(P.readConfig()?.logFile || 'relay.log');
    const buf = fs.readFileSync(f);
    return buf.subarray(Math.max(0, buf.length - 64 * 1024)).toString('utf8').split('\n').slice(-300).join('\n');
  } catch { return ''; }
});
handle('dir:open', () => shell.openPath(P.dataDir()));

// Eingebautes Update (relay/app/update.js): neuere Version unter den Releases „relay-v…“ finden, Setup laden,
// Prüfsumme aus SHA256SUMS.txt vergleichen, still installieren. Der Installer hält den Dienst an, gleicht die Aufgabe an,
// startet den Dienst wieder und öffnet danach die App (--force-run).
let updateInfo = null, updating = false;
handle('update:check', async () => {
  try { updateInfo = await U.check(app.getVersion()); } catch { updateInfo = null; return { error: tr('GitHub nicht erreichbar', 'GitHub not reachable') }; }
  return updateInfo && { version: updateInfo.version, url: updateInfo.url, installable: !!updateInfo.setup };
});
handle('update:install', async () => {
  if (updating) return false;
  if (!updateInfo?.setup) return { error: tr('Kein Update gefunden', 'No update found') };
  if (!(await adminOnce())) return { error: tr('Update nur als Administrator – App neu öffnen und die Windows-Abfrage bestätigen.', 'Updating needs administrator rights – reopen the app and confirm the Windows prompt.') };
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: [tr('Abbrechen', 'Cancel'), tr('Jetzt aktualisieren', 'Update now')], defaultId: 1, cancelId: 0, noLink: true,
    title: 'Swapline Relay', message: tr(`Auf Version ${updateInfo.version} aktualisieren?`, `Update to version ${updateInfo.version}?`),
    detail: tr('Das Setup wird von GitHub geladen und geprüft. Während der Installation ist der Vermittler einige Sekunden nicht erreichbar; die Swapline-PCs verbinden sich danach von selbst neu. Kennwort, Port und Protokoll bleiben erhalten.',
      'The setup is downloaded from GitHub and verified. The relay is unreachable for a few seconds during installation; Swapline PCs reconnect on their own afterwards. Password, port and log are kept.') });
  if (r.response !== 1) return false;
  updating = true;
  const progress = p => { if (win && !win.isDestroyed()) win.webContents.send('update:progress', p); };
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-relay-update-'));
    progress(0);
    const { file } = await U.download(updateInfo, dir, progress);
    progress(1);
    // wie electron-updater: still installieren, als Update kennzeichnen, App danach wieder öffnen
    require('node:child_process').spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.quit(), 500);
    return true;
  } catch (e) {
    updating = false;
    return { error: tr('Update fehlgeschlagen: ', 'Update failed: ') + e.message };
  }
});
handle('update:open', (url) => { if (typeof url === 'string' && url.startsWith('https://github.com/ARFEP-IT-Service/Swapline/releases/')) shell.openExternal(url); return true; });
