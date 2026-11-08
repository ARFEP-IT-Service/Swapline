// ConsoleAI – Hauptprozess: Fenster, Konten (Profile), Claude-Prozesse, Verlauf.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');

const HOME = os.homedir();
const DEFAULT_CONFIG_DIR = path.join(HOME, '.claude');
const PROFILES_ROOT = path.join(HOME, '.claude-profiles');
let STORE_FILE; // wird nach app.ready gesetzt

let win;
const sessions = new Map(); // tabId -> { proc, profileId, ... }

// ---------- Persistenter Speicher ----------
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return null; }
}
function saveStore(s) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2));
}
function getStore() {
  let s = loadStore();
  if (!s) {
    s = {
      profiles: [{ id: 'default', name: 'Standard', color: '#1581FF', configDir: DEFAULT_CONFIG_DIR, isDefault: true }],
      activeProfileId: 'default',
      favorites: [],
      usage: {}, // profileId -> { costUsd, limits }
      settings: { model: '', permissionMode: 'default', claudePath: '', theme: 'system' },
    };
    saveStore(s);
  }
  s.usage ||= {};
  s.projects ||= [];
  s.activeProjectId ||= 'all';
  s.settings ||= { model: '', permissionMode: 'default', claudePath: '' };
  return s;
}
function updateStore(fn) { const s = getStore(); fn(s); saveStore(s); return s; }
function profileById(id) { return getStore().profiles.find(p => p.id === id); }

// ---------- Claude starten ----------
function claudeExe() {
  const custom = getStore().settings.claudePath;
  if (custom && fs.existsSync(custom)) return custom;
  const local = path.join(HOME, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  if (fs.existsSync(local)) return local;
  return 'claude';
}
function envFor(profile) {
  const env = { ...process.env };
  // Variablen einer eventuell umgebenden Claude-Sitzung nicht vererben
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; delete env.CLAUDE_CODE_SSE_PORT;
  if (profile && !profile.isDefault) env.CLAUDE_CONFIG_DIR = profile.configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  return env;
}
function spawnClaude(args, profile, opts = {}) {
  const exe = claudeExe();
  return spawn(exe, args, { env: envFor(profile), shell: exe === 'claude', windowsHide: true, ...opts });
}

function authStatus(profile) {
  return new Promise(resolve => {
    const p = spawnClaude(['auth', 'status', '--json'], profile);
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', e => resolve({ loggedIn: false, error: e.message }));
    p.on('close', () => {
      try { resolve(JSON.parse(out)); } catch { resolve({ loggedIn: false }); }
    });
    setTimeout(() => { try { p.kill(); } catch {} }, 15000);
  });
}

// ---------- Modelle & Standards pro Konto ----------
// Die CLI beantwortet die Steuer-Anfrage `initialize` mit den verfügbaren Modellen (inkl. Standardmodell)
// und dem Konto – ohne eine Nachricht zu senden, also ohne Tokens zu verbrauchen.
const modelCache = new Map(); // profileId -> Promise
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
function probeModels(profile) {
  return new Promise(resolve => {
    const settings = readJson(path.join(profile.configDir, 'settings.json'));
    const base = { models: [], account: null, effortLevel: settings.effortLevel || '', settingsModel: settings.model || '' };
    const p = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio'], profile, { cwd: HOME });
    let done = false;
    const finish = r => { if (done) return; done = true; try { p.kill(); } catch {} resolve(r); };
    readline.createInterface({ input: p.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.type === 'control_response' && m.response?.request_id === 'models') {
        const r = m.response.response || {};
        finish({ ...base, models: r.models || [], account: r.account || null });
      }
    });
    p.on('error', () => finish(base));
    p.on('close', () => finish(base));
    p.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n');
    setTimeout(() => finish(base), 20000);
  });
}
ipcMain.handle('profiles:models', (_e, { id, refresh }) => {
  const p = profileById(id);
  if (!p) return null;
  if (refresh || !modelCache.has(id)) modelCache.set(id, probeModels(p));
  return modelCache.get(id);
});

// ---------- Sitzungen (ein Claude-Prozess pro Chat-Tab) ----------
function send(tabId, msg) { if (win && !win.isDestroyed()) win.webContents.send('claude:event', { tabId, msg }); }

function startSession(tab) {
  const profile = profileById(tab.profileId);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-prompt-tool', 'stdio', '--include-partial-messages'];
  if (tab.sessionId) args.push('--resume', tab.sessionId);
  if (tab.model) args.push('--model', tab.model);
  // "Alles erlauben" = --dangerously-skip-permissions (keine Rückfragen, wie im Terminal)
  if (tab.permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
  else if (tab.permissionMode && tab.permissionMode !== 'default') args.push('--permission-mode', tab.permissionMode);
  if (tab.effort) args.push('--effort', tab.effort);

  const proc = spawnClaude(args, profile, { cwd: tab.cwd && fs.existsSync(tab.cwd) ? tab.cwd : HOME });
  const s = { proc, tab: { ...tab }, stderr: '' };
  sessions.set(tab.id, s);

  readline.createInterface({ input: proc.stdout }).on('line', line => {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'system' && m.subtype === 'init') s.tab.sessionId = m.session_id;
    if (m.type === 'rate_limit_event') recordLimits(tab.profileId, m.rate_limit_info);
    if (m.type === 'result' && typeof m.total_cost_usd === 'number') recordCost(tab.profileId, m.total_cost_usd);
    send(tab.id, m);
  });
  proc.stderr.on('data', d => { s.stderr = (s.stderr + d).slice(-4000); });
  proc.on('error', e => send(tab.id, { type: 'app_error', message: `Claude konnte nicht gestartet werden: ${e.message}` }));
  proc.on('close', code => {
    if (code) logError(`Claude beendet mit Code ${code} (Chat ${tab.id}, Sitzung ${s.tab.sessionId || '-'}): ${s.stderr.trim().split('\n').slice(-5).join(' | ')}`);
    if (sessions.get(tab.id) === s) sessions.delete(tab.id);
    send(tab.id, { type: 'app_exit', code, stderr: code ? s.stderr : '' });
  });
  return s;
}

function writeTo(tabId, obj) {
  const s = sessions.get(tabId);
  if (s && s.proc.stdin.writable) s.proc.stdin.write(JSON.stringify(obj) + '\n');
}

function stopSession(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  sessions.delete(tabId);
  try { s.proc.stdin.end(); } catch {}
  setTimeout(() => { try { s.proc.kill(); } catch {} }, 1500);
}

function recordCost(profileId, cost) {
  updateStore(st => {
    const u = (st.usage[profileId] ||= {});
    u.costUsd = (u.costUsd || 0) + cost;
    const day = new Date().toISOString().slice(0, 10);
    u.days ||= {};
    u.days[day] = (u.days[day] || 0) + cost;
  });
  pushUsage();
}
function recordLimits(profileId, info) {
  if (!info) return;
  updateStore(st => { (st.usage[profileId] ||= {}).limits = { ...info, seenAt: Date.now() }; });
  pushUsage();
}
function pushUsage() { if (win && !win.isDestroyed()) win.webContents.send('usage:update', getStore().usage); }

// ---------- Verlauf aus <configDir>/projects lesen ----------
function encodeCwd(cwd) { return cwd.replace(/[^a-zA-Z0-9]/g, '-'); }

function readHead(file, bytes = 65536) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}
function readTail(file, bytes = 65536) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

function listHistory(profile, limit = 200) {
  const root = path.join(profile.configDir, 'projects');
  const items = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return []; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(root, d, f);
      try { items.push({ file: full, mtime: fs.statSync(full).mtimeMs, sessionId: f.slice(0, -6) }); } catch {}
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items.slice(0, limit).map(it => {
    let title = '', cwd = '', firstPrompt = '';
    try {
      const text = readHead(it.file) + '\n' + readTail(it.file, 32768);
      for (const line of text.split('\n')) {
        if (!line.startsWith('{')) continue;
        if (line.includes('"ai-title"') || line.includes('"custom-title"')) {
          try { const o = JSON.parse(line); title = o.customTitle || o.aiTitle || title; } catch {}
        } else if (!cwd && line.includes('"cwd"')) {
          try { const o = JSON.parse(line); if (o.cwd) cwd = o.cwd; } catch {}
        }
        if (!firstPrompt && line.includes('"type":"user"')) {
          try {
            const o = JSON.parse(line);
            const c = o.message?.content;
            if (typeof c === 'string' && !c.startsWith('<')) firstPrompt = c;
          } catch {}
        }
      }
    } catch {}
    return { sessionId: it.sessionId, file: it.file, mtime: it.mtime, cwd, title: title || firstPrompt.slice(0, 80) || '(ohne Titel)' };
  }).filter(h => h.cwd || h.title !== '(ohne Titel)');
}

// Nachrichten einer alten Sitzung für die Anzeige laden
function loadTranscript(file) {
  const out = [];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if ((o.type === 'user' || o.type === 'assistant') && o.message && !o.isSidechain && !o.isMeta) {
      out.push({ type: o.type, message: o.message, fromHistory: true });
    }
  }
  return out;
}

// Sitzung in ein anderes Konto kopieren, damit sie dort mit --resume fortgesetzt werden kann
function copySessionToProfile(sessionId, cwd, fromProfile, toProfile) {
  if (!sessionId || fromProfile.configDir === toProfile.configDir) return true;
  const enc = encodeCwd(cwd || HOME);
  let src = path.join(fromProfile.configDir, 'projects', enc, sessionId + '.jsonl');
  if (!fs.existsSync(src)) {
    // Fallback: in allen Projektordnern suchen
    const root = path.join(fromProfile.configDir, 'projects');
    try {
      for (const d of fs.readdirSync(root)) {
        const p = path.join(root, d, sessionId + '.jsonl');
        if (fs.existsSync(p)) { src = p; break; }
      }
    } catch {}
  }
  if (!fs.existsSync(src)) return false;
  const dstDir = path.join(toProfile.configDir, 'projects', enc);
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, path.join(dstDir, sessionId + '.jsonl'));
  return true;
}

// ---------- IPC ----------
ipcMain.handle('store:get', () => getStore());

ipcMain.handle('profiles:add', (_e, { name, color }) => {
  const slug = (name || 'konto').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'konto';
  const id = slug + '-' + crypto.randomBytes(3).toString('hex');
  const configDir = path.join(PROFILES_ROOT, id);
  fs.mkdirSync(configDir, { recursive: true });
  return updateStore(s => { s.profiles.push({ id, name: name || 'Neues Konto', color: color || '#22c55e', configDir }); });
});
ipcMain.handle('profiles:update', (_e, { id, patch }) => updateStore(s => {
  const p = s.profiles.find(x => x.id === id); if (p) Object.assign(p, { name: patch.name ?? p.name, color: patch.color ?? p.color });
}));
ipcMain.handle('profiles:remove', (_e, id) => updateStore(s => {
  const p = s.profiles.find(x => x.id === id);
  if (!p || p.isDefault) return;
  s.profiles = s.profiles.filter(x => x.id !== id);
  if (s.activeProfileId === id) s.activeProfileId = 'default';
}));
ipcMain.handle('profiles:setActive', (_e, id) => updateStore(s => { s.activeProfileId = id; }));
ipcMain.handle('profiles:status', (_e, id) => { const p = profileById(id); return p ? authStatus(p) : { loggedIn: false }; });

// ---------- Anmeldung ----------
// Nur Anthropics eigener Ablauf: `claude auth login` öffnet selbst den System-Browser und nimmt die
// Rückmeldung selbst entgegen. Die App liest dabei keine Ausgabe, sieht keine URL, keinen Code und
// kein Token und speichert nichts – sie wartet nur auf das Ende des Prozesses und fragt dann
// `claude auth status` ab.
const logins = new Map(); // profileId -> { proc }
function loginEvent(id, data) { if (win && !win.isDestroyed()) win.webContents.send('login:update', { id, ...data }); }

function cancelLogin(id) {
  const l = logins.get(id);
  if (!l) return;
  logins.delete(id);
  try { l.proc.kill(); } catch {}
}

ipcMain.handle('profiles:login', (_e, id) => {
  const p = profileById(id);
  if (!p) return false;
  cancelLogin(id);
  const exe = claudeExe();
  // stdin bleibt offen (die CLI wartet sonst nicht auf die Browser-Rückmeldung), wird aber nie beschrieben;
  // stdout/stderr werden verworfen, nicht gelesen.
  const proc = spawn(exe, ['auth', 'login'], { env: envFor(p), windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  const l = { proc };
  logins.set(id, l);
  loginEvent(id, { state: 'waiting' });
  proc.on('error', e => { if (logins.get(id) === l) logins.delete(id); loginEvent(id, { state: 'error', error: e.message }); });
  proc.on('close', async code => {
    if (logins.get(id) !== l) return; // abgebrochen
    logins.delete(id);
    modelCache.delete(id);
    const st = await authStatus(p);
    if (st.loggedIn) loginEvent(id, { state: 'done', status: st });
    else loginEvent(id, { state: 'error', error: `Anmeldung nicht abgeschlossen (Code ${code}).` });
  });
  return true;
});
// Falls die CLI einen Code verlangt: sichtbares Konsolenfenster mit `claude auth login`.
// Kein cmd-String – die exe wird direkt mit Argument-Array gestartet; der Nutzer tippt den Code dort selbst ein.
ipcMain.handle('profiles:loginConsole', (_e, id) => {
  const p = profileById(id);
  const exe = claudeExe();
  if (!p || !exe) return false;
  cancelLogin(id);
  const proc = spawn(exe, ['auth', 'login'], { env: envFor(p), detached: true, windowsHide: false, stdio: 'ignore' });
  proc.unref();
  return true;
});
ipcMain.handle('profiles:loginCancel', (_e, id) => cancelLogin(id));
ipcMain.handle('profiles:logout', (_e, id) => new Promise(res => {
  const p = profileById(id); if (!p) return res(false);
  spawnClaude(['auth', 'logout'], p).on('close', () => res(true));
}));
ipcMain.handle('profiles:openTerminal', (_e, { id, cwd }) => {
  const p = profileById(id);
  const exe = claudeExe();
  spawn('cmd.exe', ['/c', `title Claude - ${p.name} && "${exe}"`], {
    env: envFor(p), cwd: cwd && fs.existsSync(cwd) ? cwd : HOME, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true,
  }).unref();
});

ipcMain.handle('favorites:add', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Projektordner als Favorit hinzufügen' });
  if (r.canceled || !r.filePaths[0]) return getStore();
  const dir = r.filePaths[0];
  return updateStore(s => { if (!s.favorites.some(f => f.path === dir)) s.favorites.push({ path: dir, name: path.basename(dir) }); });
});
ipcMain.handle('favorites:remove', (_e, dir) => updateStore(s => { s.favorites = s.favorites.filter(f => f.path !== dir); }));
ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('settings:set', (_e, patch) => updateStore(s => { Object.assign(s.settings, patch); }));

// Projekte (Gruppen für Chats, optional mit Ordner)
ipcMain.handle('projects:add', (_e, { name, color, cwd }) => updateStore(s => {
  const id = 'p-' + crypto.randomBytes(4).toString('hex');
  s.projects.push({ id, name: name || 'Projekt', color: color || '#1581FF', cwd: cwd || '' });
  s.activeProjectId = id;
}));
ipcMain.handle('projects:update', (_e, { id, patch }) => updateStore(s => {
  const p = s.projects.find(x => x.id === id);
  if (p) for (const k of ['name', 'color', 'cwd']) if (k in patch) p[k] = patch[k];
}));
ipcMain.handle('projects:remove', (_e, id) => updateStore(s => {
  s.projects = s.projects.filter(x => x.id !== id);
  if (s.activeProjectId === id) s.activeProjectId = 'all';
}));
ipcMain.handle('projects:setActive', (_e, id) => updateStore(s => { s.activeProjectId = id; }));
ipcMain.handle('projects:reorder', (_e, ids) => updateStore(s => {
  s.projects.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}));

ipcMain.handle('history:list', (_e, profileId) => { const p = profileById(profileId); return p ? listHistory(p) : []; });
ipcMain.handle('history:load', (_e, file) => loadTranscript(file));
ipcMain.handle('history:loadSession', (_e, { profileId, sessionId, cwd }) => {
  const p = profileById(profileId);
  if (!p || !sessionId) return [];
  const root = path.join(p.configDir, 'projects');
  let file = path.join(root, encodeCwd(cwd || HOME), sessionId + '.jsonl');
  if (!fs.existsSync(file)) {
    try {
      for (const d of fs.readdirSync(root)) {
        const f = path.join(root, d, sessionId + '.jsonl');
        if (fs.existsSync(f)) { file = f; break; }
      }
    } catch {}
  }
  return loadTranscript(file);
});

ipcMain.handle('session:send', (_e, { tab, content }) => {
  let s = sessions.get(tab.id);
  if (!s) s = startSession(tab);
  writeTo(tab.id, { type: 'user', message: { role: 'user', content } });
  return true;
});
ipcMain.handle('session:respond', (_e, { tabId, requestId, response }) => {
  writeTo(tabId, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
});
ipcMain.handle('session:interrupt', (_e, tabId) => {
  writeTo(tabId, { type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'interrupt' } });
});
// Einstellungen ändern -> Prozess beenden; die nächste Nachricht startet mit --resume neu
ipcMain.handle('session:restart', (_e, tabId) => { stopSession(tabId); return true; });
ipcMain.handle('session:close', (_e, tabId) => { stopSession(tabId); return true; });
ipcMain.handle('session:moveProfile', (_e, { sessionId, cwd, fromProfileId, toProfileId }) => {
  const from = profileById(fromProfileId), to = profileById(toProfileId);
  if (!from || !to) return false;
  try { return copySessionToProfile(sessionId, cwd, from, to); } catch { return false; }
});
ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));

// ---------- Fehlerprotokoll (userData/consoleai.log) ----------
function logError(msg) {
  try {
    const file = path.join(app.getPath('userData'), 'consoleai.log');
    try { if (fs.statSync(file).size > 1e6) fs.renameSync(file, file + '.old'); } catch {}
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}
process.on('uncaughtException', e => logError('Hauptprozess: ' + (e.stack || e)));
process.on('unhandledRejection', e => logError('Hauptprozess (Promise): ' + (e?.stack || e)));

// ---------- Fenster ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 560,
    backgroundColor: '#0f1115',
    title: 'ConsoleAI',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('render-process-gone', (_e, d) => {
    logError(`Oberfläche abgestürzt: ${d.reason} (Code ${d.exitCode})`);
    if (d.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload();
  });
  win.webContents.on('unresponsive', () => logError('Oberfläche reagiert nicht'));
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) logError(`Renderer: ${message} (${path.basename(sourceId || '')}:${line})`);
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

// Testprofil: CONSOLEAI_PROFILE=<name> nutzt einen eigenen Datenordner (echte Einstellungen bleiben unberührt)
if (process.env.CONSOLEAI_PROFILE) app.setPath('userData', path.join(app.getPath('appData'), 'ConsoleAI-' + process.env.CONSOLEAI_PROFILE));

// Früher (bis Auftrag 2) zeigte die App die Anmeldeseite eingebettet an und legte dabei Browser-Daten
// unter userData/Partitions/login-* sowie ein Hilfsskript login-browser.cmd ab. Beides wird beim Start
// ungelesen gelöscht.
function purgeEmbeddedLoginData(dir) {
  let removed = 0;
  try {
    const parts = path.join(dir, 'Partitions');
    for (const d of fs.existsSync(parts) ? fs.readdirSync(parts) : []) {
      if (d.startsWith('login-')) { fs.rmSync(path.join(parts, d), { recursive: true, force: true }); removed++; }
    }
    fs.rmSync(path.join(dir, 'login-browser.cmd'), { force: true });
  } catch (e) { logError('Login-Daten löschen: ' + e.message); }
  return removed;
}

app.whenReady().then(() => {
  purgeEmbeddedLoginData(app.getPath('userData'));
  STORE_FILE = path.join(app.getPath('userData'), 'consoleai.json');
  createWindow();
  // CONSOLEAI_SCREENSHOT=<datei.png>: nach dem Laden Bildschirmfoto speichern und beenden (für Tests)
  const shot = process.env.CONSOLEAI_SCREENSHOT;
  if (shot) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try {
        if (process.env.CONSOLEAI_TEST_JS) await win.webContents.executeJavaScript(fs.readFileSync(process.env.CONSOLEAI_TEST_JS, 'utf8'));
        win.show(); win.focus();
        let img;
        try { img = await win.webContents.capturePage(); } catch {
          // Rückfall: Fenster über desktopCapturer aufnehmen (klappt auch, wenn capturePage scheitert)
          const { desktopCapturer } = require('electron');
          const [w, h] = win.getContentSize();
          img = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: w, height: h + 40 } })).find(x => x.id === win.getMediaSourceId())?.thumbnail;
        }
        if (img) fs.writeFileSync(shot, img.toPNG());
      } catch (e) { logError('Screenshot-Test: ' + (e.stack || e)); }
      app.quit();
    }, Number(process.env.CONSOLEAI_SCREENSHOT_DELAY || 4000)));
  }
});
function cleanup() {
  for (const id of [...sessions.keys()]) stopSession(id);
  for (const id of [...logins.keys()]) cancelLogin(id);
}
app.on('window-all-closed', () => { cleanup(); app.quit(); });
app.on('will-quit', cleanup);
