// Swapline – Hauptprozess: Fenster, Konten (Profile), Claude-Prozesse, Verlauf.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

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
  // bis 0.2.x wurden kumulierte Sitzungskosten mehrfach addiert – die falschen Summen einmalig zurücksetzen
  if (!s.costFixV1) { for (const u of Object.values(s.usage)) { delete u.costUsd; delete u.days; } s.costFixV1 = true; }
  s.projects ||= [];
  s.activeProjectId ||= 'all';
  s.settings ||= { model: '', permissionMode: 'default', claudePath: '' };
  return s;
}
function updateStore(fn) { const s = getStore(); fn(s); saveStore(s); return s; }
function profileById(id) { return getStore().profiles.find(p => p.id === id); }

// ---------- Eingaben aus der Oberfläche prüfen ----------
const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const THEMES = ['system', 'light', 'dark'];
const NOTIFY = ['always', 'background', 'off']; // Benachrichtigung bei fertiger Antwort
const SOUND = ['on', 'off'];
const TOOLVIEW = ['all', 'compact', 'hidden']; // Werkzeug-Aufrufe im Chat
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isModel = v => v === '' || (typeof v === 'string' && /^[a-z0-9][a-z0-9.\-[\]]{0,63}$/i.test(v));
// Netzwerkpfade (UNC, \\server\… oder //server/…) werden nie geprüft oder benutzt – schon die Existenzprüfung
// würde eine SMB-Anmeldung auslösen.
const isUnc = p => typeof p === 'string' && /^(\\\\|\/\/)/.test(p);
const isDir = p => typeof p === 'string' && p !== '' && !isUnc(p) && path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isDirectory();
const cleanName = (v, fallback) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f"<>|&^%]/g, '').trim().slice(0, 40) : '') || fallback;
const cleanColor = (v, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
// "Alles erlauben" muss einmal im Hauptprozess bestätigt werden (nativer Dialog) – die Oberfläche allein reicht
// nicht. Die Zustimmung wird dauerhaft gespeichert (bypassAcknowledged, nur hier gesetzt); in den Einstellungen
// lässt sich die Warnung wieder einschalten.
function confirmBypass() {
  if (getStore().bypassAcknowledged) return true;
  const r = dialog.showMessageBoxSync(win, {
    type: 'warning', buttons: ['Abbrechen', 'Alles erlauben'], defaultId: 0, cancelId: 0, noLink: true,
    title: 'Alles erlauben',
    message: 'Claude ohne Rückfragen arbeiten lassen?',
    detail: 'Claude Code wird mit --dangerously-skip-permissions gestartet. Claude führt dann Befehle aus, ändert und löscht Dateien und greift auf das Netz zu, ohne vorher zu fragen.\n\nNur in Ordnern verwenden, denen du vertraust – am besten in einer Testumgebung.\n\nDiese Warnung erscheint nur einmal. In den Einstellungen kannst du sie wieder einschalten.',
  });
  if (r !== 1) return false;
  updateStore(s => { s.bypassAcknowledged = true; });
  return true;
}

// Ordner, die als Arbeitsordner erlaubt sind: alles, was der Hauptprozess selbst über einen Dialog,
// ein Projekt, einen Favoriten oder den Verlauf von Claude Code gesehen hat. Wird gespeichert, damit
// wiederhergestellte Chats nach einem Neustart gültig bleiben.
const folderKey = p => path.resolve(p).toLowerCase();
function rememberFolder(p) {
  if (!isDir(p)) return;
  const s = getStore();
  s.knownFolders ||= [];
  if (!s.knownFolders.some(x => folderKey(x) === folderKey(p))) { s.knownFolders.push(path.resolve(p)); saveStore(s); }
}
function isAllowedCwd(p) {
  if (!isDir(p)) return false;
  const s = getStore();
  const k = folderKey(p);
  return k === folderKey(HOME) || (s.knownFolders || []).some(x => folderKey(x) === k)
    || (s.projects || []).some(x => x.cwd && folderKey(x.cwd) === k) || (s.favorites || []).some(x => folderKey(x.path) === k);
}

// ---------- Claude starten ----------
const CLAUDE_MISSING = 'Claude Code nicht gefunden. Bitte Claude Code installieren (https://code.claude.com/docs) oder in den Einstellungen den Pfad zu claude.exe angeben.';
let resolvedClaude; // Ergebnis von where.exe (einmal pro App-Start)
const isClaudeExePath = p => typeof p === 'string' && !isUnc(p) && path.isAbsolute(p) && path.basename(p).toLowerCase() === 'claude.exe' && fs.existsSync(p) && fs.statSync(p).isFile();
// Reihenfolge: Pfad aus den Einstellungen (nur eine Datei namens claude.exe) → ~/.local/bin/claude.exe → where.exe.
// Rückgabe null, wenn nichts gefunden wird. Gestartet wird immer ohne Shell.
function claudeExe() {
  const custom = getStore().settings.claudePath;
  if (isClaudeExePath(custom)) return custom;
  const local = path.join(HOME, '.local', 'bin', 'claude.exe');
  if (isClaudeExePath(local)) return local;
  if (resolvedClaude === undefined) {
    resolvedClaude = null;
    try {
      const out = execFileSync('where.exe', ['claude'], { cwd: HOME, encoding: 'utf8', windowsHide: true, timeout: 5000 });
      resolvedClaude = out.split(/\r?\n/).map(x => x.trim()).find(isClaudeExePath) || null;
    } catch {}
  }
  return resolvedClaude;
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
  if (!exe) throw new Error(CLAUDE_MISSING);
  return spawn(exe, args, { env: envFor(profile), windowsHide: true, ...opts });
}

function authStatus(profile) {
  return new Promise(resolve => {
    if (!claudeExe()) return resolve({ loggedIn: false, claudeMissing: true, error: CLAUDE_MISSING });
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
    if (!claudeExe()) return resolve(base);
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
  const s = { proc, tab: { ...tab }, stderr: '', pending: new Map(), lastCost: 0 }; // pending: offene Berechtigungsanfragen der CLI; lastCost: letzter Sitzungsstand der Kosten
  sessions.set(tab.id, s);

  readline.createInterface({ input: proc.stdout }).on('line', line => {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'system' && m.subtype === 'init') s.tab.sessionId = m.session_id;
    if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
      s.pending.set(m.request_id, { toolName: m.request.tool_name, input: m.request.input, suggestions: m.request.permission_suggestions || null });
    }
    if (m.type === 'rate_limit_event') recordLimits(tab.profileId, m.rate_limit_info);
    // total_cost_usd ist der Stand der ganzen laufenden Sitzung (kumuliert) – gezählt wird nur der Zuwachs seit dem letzten Ergebnis
    if (m.type === 'result' && typeof m.total_cost_usd === 'number') {
      const delta = m.total_cost_usd >= s.lastCost ? m.total_cost_usd - s.lastCost : m.total_cost_usd;
      s.lastCost = m.total_cost_usd;
      m.swapline_cost_delta = delta;
      recordCost(tab.profileId, delta);
    }
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
      out.push({ type: o.type, message: o.message, timestamp: o.timestamp, fromHistory: true });
    }
  }
  return out;
}

// Sitzung in ein anderes Konto kopieren, damit sie dort mit --resume fortgesetzt werden kann
// Sitzungsdatei <configDir>/projects/<ordner>/<uuid>.jsonl finden. Die Session-ID muss eine UUID sein,
// und jeder Pfad muss nach dem Auflösen innerhalb von <configDir>/projects liegen (kein Path Traversal).
function inside(base, p) { const b = path.resolve(base) + path.sep; return path.resolve(p).startsWith(b); }
function findSessionFile(profile, sessionId, cwd) {
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return null;
  const root = path.join(profile.configDir, 'projects');
  const candidates = [path.join(root, encodeCwd(typeof cwd === 'string' && cwd ? cwd : HOME), sessionId + '.jsonl')];
  try { for (const d of fs.readdirSync(root)) candidates.push(path.join(root, d, sessionId + '.jsonl')); } catch {}
  return candidates.find(f => inside(root, f) && fs.existsSync(f) && fs.statSync(f).isFile()) || null;
}
function copySessionToProfile(sessionId, cwd, fromProfile, toProfile) {
  if (fromProfile.configDir === toProfile.configDir) return true;
  const src = findSessionFile(fromProfile, sessionId, cwd);
  if (!src) return false;
  const dstRoot = path.join(toProfile.configDir, 'projects');
  const dstDir = path.join(dstRoot, encodeCwd(typeof cwd === 'string' && cwd ? cwd : HOME));
  const dst = path.join(dstDir, sessionId + '.jsonl');
  if (!inside(dstRoot, dst)) return false;
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

// ---------- IPC ----------
// appVersion kommt aus package.json (einzige Quelle der Versionsnummer) und wird nicht gespeichert
ipcMain.handle('store:get', () => ({ ...getStore(), appVersion: app.getVersion() }));

ipcMain.handle('profiles:add', (_e, { name, color } = {}) => {
  name = cleanName(name, 'Neues Konto'); color = cleanColor(color, '#22c55e');
  const slug = (name || 'konto').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'konto';
  const id = slug + '-' + crypto.randomBytes(3).toString('hex');
  const configDir = path.join(PROFILES_ROOT, id);
  fs.mkdirSync(configDir, { recursive: true });
  return updateStore(s => { s.profiles.push({ id, name: name || 'Neues Konto', color: color || '#22c55e', configDir }); });
});
ipcMain.handle('profiles:update', (_e, { id, patch }) => updateStore(s => {
  const p = s.profiles.find(x => x.id === id); if (p && patch) Object.assign(p, { name: cleanName(patch.name, p.name), color: cleanColor(patch.color, p.color) });
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
  if (!exe) { loginEvent(id, { state: 'error', error: CLAUDE_MISSING }); return false; }
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
  const p = profileById(id); if (!p || !claudeExe()) return res(false);
  spawnClaude(['auth', 'logout'], p).on('close', () => res(true));
}));
// claude.exe direkt in einem eigenen Konsolenfenster starten (Argument-Array, keine Shell, kein Kontoname in Befehlszeilen)
ipcMain.handle('profiles:openTerminal', (_e, { id, cwd }) => {
  const p = profileById(id);
  const exe = claudeExe();
  if (!p || !exe) return false;
  spawn(exe, [], { env: envFor(p), cwd: isAllowedCwd(cwd) ? cwd : HOME, detached: true, windowsHide: false, stdio: 'ignore' }).unref();
  return true;
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
  if (r.canceled || !r.filePaths[0]) return null;
  if (isUnc(r.filePaths[0])) return null;
  rememberFolder(r.filePaths[0]);
  return r.filePaths[0];
});
// Nur bekannte Schlüssel mit gültigen Werten; alles andere wird abgelehnt.
ipcMain.handle('settings:set', (_e, patch) => {
  const ok = {};
  const reject = why => { logError('settings:set abgelehnt: ' + why); return { ...getStore(), rejected: why }; };
  if (!patch || typeof patch !== 'object') return reject('kein Objekt');
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'model' && isModel(v)) ok.model = v;
    else if (k === 'effort' && EFFORTS.includes(v)) ok.effort = v;
    else if (k === 'theme' && THEMES.includes(v)) ok.theme = v;
    else if (k === 'notify' && NOTIFY.includes(v)) ok.notify = v;
    else if (k === 'sound' && SOUND.includes(v)) ok.sound = v;
    else if (k === 'toolView' && TOOLVIEW.includes(v)) ok.toolView = v;
    else if (k === 'permissionMode' && MODES.includes(v)) {
      if (v === 'bypassPermissions' && !confirmBypass()) return reject('Bypass nicht bestätigt');
      ok.permissionMode = v;
    } else if (k === 'claudePath' && v === '') { ok.claudePath = ''; resolvedClaude = undefined; } // setzen nur über settings:pickClaude
    else return reject(`Schlüssel/Wert nicht erlaubt: ${String(k).slice(0, 40)}`);
  }
  return updateStore(s => { Object.assign(s.settings, ok); });
});
// claudePath nur über einen Datei-Dialog im Hauptprozess
ipcMain.handle('settings:pickClaude', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'claude.exe auswählen', properties: ['openFile'], filters: [{ name: 'claude.exe', extensions: ['exe'] }] });
  if (r.canceled || !r.filePaths[0]) return getStore();
  if (!isClaudeExePath(r.filePaths[0])) return { ...getStore(), rejected: 'Datei heißt nicht claude.exe' };
  resolvedClaude = undefined;
  return updateStore(s => { s.settings.claudePath = r.filePaths[0]; });
});

// Projekte (Gruppen für Chats, optional mit Ordner)
// Projektbild: per Datei-Dialog im Hauptprozess gewählt, geprüft und als data:-URL gespeichert.
// In der Oberfläche wird es nur als <img> angezeigt – auch eine SVG kann dort keinen Code ausführen
// und nichts nachladen.
const ICON_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon' };
const ICON_MAX = 1024 * 1024;
const ICON_RE = /^data:image\/(png|jpeg|webp|gif|svg\+xml|x-icon);base64,[A-Za-z0-9+/]+=*$/;
const cleanIcon = v => (typeof v === 'string' && v.length <= ICON_MAX * 1.4 && ICON_RE.test(v) ? v : null);
function looksLikeImage(buf, ext) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (ext === 'png') return hex.startsWith('89504e470d0a1a0a');
  if (ext === 'jpg' || ext === 'jpeg') return hex.startsWith('ffd8ff');
  if (ext === 'gif') return hex.startsWith('47494638');
  if (ext === 'webp') return hex.startsWith('52494646') && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  if (ext === 'ico') return hex.startsWith('00000100');
  if (ext === 'svg') return /<svg[\s>]/i.test(buf.subarray(0, 4096).toString('utf8'));
  return false;
}
ipcMain.handle('projects:pickIcon', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Bild für das Projekt wählen', properties: ['openFile'], filters: [{ name: 'Bilder', extensions: Object.keys(ICON_TYPES) }] });
  const file = r.filePaths?.[0];
  if (r.canceled || !file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (isUnc(file) || !ICON_TYPES[ext]) return { error: 'Dateityp nicht unterstützt' };
  const size = fs.statSync(file).size;
  if (size > ICON_MAX) return { error: 'Bild ist größer als 1 MB' };
  const buf = fs.readFileSync(file);
  if (!looksLikeImage(buf, ext)) return { error: 'Datei ist kein gültiges Bild' };
  return { icon: `data:${ICON_TYPES[ext]};base64,${buf.toString('base64')}` };
});
ipcMain.handle('projects:add', (_e, { name, color, cwd, icon } = {}) => updateStore(s => {
  name = cleanName(name, 'Projekt'); color = cleanColor(color, '#1581FF'); cwd = isAllowedCwd(cwd) ? cwd : ''; // nur per Dialog gesehene Ordner
  const id = 'p-' + crypto.randomBytes(4).toString('hex');
  const pr = { id, name: name || 'Projekt', color: color || '#1581FF', cwd: cwd || '' };
  if (cleanIcon(icon)) pr.icon = cleanIcon(icon);
  s.projects.push(pr);
  s.activeProjectId = id;
}));
ipcMain.handle('projects:update', (_e, { id, patch }) => updateStore(s => {
  const p = s.projects.find(x => x.id === id);
  if (p && patch) {
    if ('name' in patch) p.name = cleanName(patch.name, p.name);
    if ('color' in patch) p.color = cleanColor(patch.color, p.color);
    if ('cwd' in patch) p.cwd = isAllowedCwd(patch.cwd) ? patch.cwd : '';
    if ('icon' in patch) { if (cleanIcon(patch.icon)) p.icon = cleanIcon(patch.icon); else delete p.icon; }
  }
}));
ipcMain.handle('projects:remove', (_e, id) => updateStore(s => {
  s.projects = s.projects.filter(x => x.id !== id);
  if (s.activeProjectId === id) s.activeProjectId = 'all';
}));
ipcMain.handle('projects:setActive', (_e, id) => updateStore(s => { s.activeProjectId = id; }));
ipcMain.handle('projects:reorder', (_e, ids) => updateStore(s => {
  s.projects.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}));

ipcMain.handle('history:list', (_e, profileId) => {
  const p = profileById(profileId);
  if (!p) return [];
  const list = listHistory(p);
  for (const h of list) if (h.cwd) rememberFolder(h.cwd); // Ordner aus Claude Codes eigenem Verlauf
  return list;
});
ipcMain.handle('history:loadSession', (_e, { profileId, sessionId, cwd } = {}) => {
  const p = profileById(profileId);
  if (!p) return [];
  const file = findSessionFile(p, sessionId, cwd);
  if (!file) { if (sessionId && !UUID_RE.test(String(sessionId))) logError('history:loadSession abgelehnt: ungültige Session-ID'); return []; }
  return loadTranscript(file);
});

// Tab-Daten aus der Oberfläche werden vollständig geprüft, bevor Claude gestartet wird
function validTab(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || !/^[a-z0-9]{6,40}$/i.test(t.id)) return null;
  if (!profileById(t.profileId)) return null;
  if (t.sessionId != null && !UUID_RE.test(t.sessionId)) return null;
  if (!isModel(t.model || '') || !EFFORTS.includes(t.effort || '') || !MODES.includes(t.permissionMode || 'default')) return null;
  if (t.cwd && !isAllowedCwd(t.cwd)) return null;
  return { id: t.id, profileId: t.profileId, cwd: t.cwd || '', sessionId: t.sessionId || null, model: t.model || '', effort: t.effort || '', permissionMode: t.permissionMode || 'default' };
}
ipcMain.handle('session:confirmBypass', () => confirmBypass());
// Warnung zu „Alles erlauben“ wieder einschalten (nur in diese sichere Richtung von der Oberfläche aus möglich)
ipcMain.handle('settings:resetBypassWarning', () => updateStore(s => { delete s.bypassAcknowledged; }));
ipcMain.handle('session:send', (_e, { tab: rawTab, content }) => {
  const tab = validTab(rawTab);
  if (!tab || typeof content !== 'string') {
    logError('session:send abgelehnt: ungültige Tab-Daten');
    if (rawTab?.cwd && typeof rawTab.id === 'string') send(rawTab.id, { type: 'app_error', message: 'Dieser Arbeitsordner ist nicht freigegeben. Bitte den Ordner über „Neuer Chat“ oder ein Projekt neu wählen.' });
    return false;
  }
  if (tab.permissionMode === 'bypassPermissions' && !confirmBypass()) {
    send(tab.id, { type: 'app_error', message: '„Alles erlauben“ wurde nicht bestätigt – Nachricht nicht gesendet.' });
    return false;
  }
  if (!claudeExe()) { send(tab.id, { type: 'app_error', message: CLAUDE_MISSING }); return false; }
  let s = sessions.get(tab.id);
  if (!s) s = startSession(tab);
  writeTo(tab.id, { type: 'user', message: { role: 'user', content } });
  return true;
});
// Antwort auf eine Berechtigungsanfrage. Nur offene Anfragen dieser CLI werden beantwortet; die Eingabe des
// Werkzeugs darf nicht verändert werden (Ausnahme: Antworten auf eine Frage), Regeln nur exakt so, wie die CLI
// sie vorgeschlagen hat, und nie ein Moduswechsel.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ipcMain.handle('session:respond', (_e, { tabId, requestId, response } = {}) => {
  const s = sessions.get(tabId);
  const req = s?.pending.get(requestId);
  const reject = why => { logError('session:respond abgelehnt: ' + why); return false; };
  if (!req) return reject('keine offene Anfrage');
  if (!response || !['allow', 'deny'].includes(response.behavior)) return reject('ungültige Antwort');
  let out;
  if (response.behavior === 'deny') {
    out = { behavior: 'deny', message: String(response.message || 'Abgelehnt.').slice(0, 500) };
  } else {
    let input = req.input;
    if (req.toolName === 'AskUserQuestion') {
      const { answers, ...rest } = response.updatedInput || {};
      if (!same(rest, req.input)) return reject('Eingabe verändert');
      const clean = {};
      for (const [k, v] of Object.entries(answers || {})) if (typeof v === 'string') clean[String(k).slice(0, 500)] = v.slice(0, 2000);
      input = { ...req.input, answers: clean };
    } else if (!same(response.updatedInput, req.input)) return reject('Eingabe verändert');
    out = { behavior: 'allow', updatedInput: input };
    if (response.updatedPermissions != null) {
      const perms = response.updatedPermissions;
      if (!req.suggestions || !same(perms, req.suggestions) || perms.some(x => x?.type === 'setMode')) return reject('Regeln nicht wie vorgeschlagen');
      out.updatedPermissions = req.suggestions;
    }
  }
  s.pending.delete(requestId);
  writeTo(tabId, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: out } });
  return true;
});
ipcMain.handle('session:interrupt', (_e, tabId) => {
  writeTo(tabId, { type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'interrupt' } });
});
// Einstellungen ändern -> Prozess beenden; die nächste Nachricht startet mit --resume neu
ipcMain.handle('session:restart', (_e, tabId) => { stopSession(tabId); return true; });
ipcMain.handle('session:close', (_e, tabId) => { stopSession(tabId); return true; });
// Übertragung eines Chats in ein anderes Konto – nur nach ausdrücklicher Bestätigung im Hauptprozess
ipcMain.handle('session:moveProfile', (_e, { sessionId, cwd, fromProfileId, toProfileId } = {}) => {
  const from = profileById(fromProfileId), to = profileById(toProfileId);
  if (!from || !to) return { ok: false, error: 'Konto unbekannt' };
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) { logError('session:moveProfile abgelehnt: ungültige Session-ID'); return { ok: false, error: 'ungültige Session-ID' }; }
  if (from.configDir === to.configDir) return { ok: true };
  const r = dialog.showMessageBoxSync(win, {
    type: 'warning', buttons: ['Abbrechen', 'Übertragen'], defaultId: 0, cancelId: 0, noLink: true,
    title: 'Chat in anderes Konto übertragen',
    message: `Chat in Konto „${to.name}“ übertragen?`,
    detail: `Der gesamte Verlauf inkl. Dateiinhalten und Befehlsausgaben wird in Konto „${to.name}“ kopiert. Nicht zwischen Firmen- und Privatkonten übertragen.`,
  });
  if (r !== 1) return { ok: false, cancelled: true };
  try { return { ok: copySessionToProfile(sessionId, cwd, from, to) }; } catch (e) { logError('Übertragung: ' + e.message); return { ok: false, error: e.message }; }
});
// Nur existierende Ordner im Explorer öffnen – nie Dateien oder Programme
// Fenster nach vorne holen (Klick auf eine Benachrichtigung) bzw. in der Taskleiste blinken lassen
ipcMain.handle('app:focus', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});
ipcMain.handle('app:attention', () => { if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true); });
ipcMain.handle('shell:openPath', (_e, p) => {
  if (!isDir(p)) { logError('openPath abgelehnt (kein Ordner): ' + String(p).slice(0, 200)); return false; }
  shell.openPath(p);
  return true;
});

// Externe Links nur über https in den Standard-Browser
function openExternalSafe(url) {
  let u;
  try { u = new URL(url); } catch { logError('Link abgelehnt (ungültig): ' + String(url).slice(0, 200)); return false; }
  if (u.protocol !== 'https:') { logError('Link abgelehnt (nur https erlaubt): ' + u.protocol); return false; }
  shell.openExternal(u.href);
  return true;
}

// ---------- Fehlerprotokoll (userData/swapline.log) ----------
function logError(msg) {
  try {
    const file = path.join(app.getPath('userData'), 'swapline.log');
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
    title: 'Swapline',
    icon: path.join(__dirname, 'renderer', 'assets', 'swapline.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('focus', () => win.flashFrame(false));
  win.webContents.on('render-process-gone', (_e, d) => {
    logError(`Oberfläche abgestürzt: ${d.reason} (Code ${d.exitCode})`);
    if (d.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload();
  });
  win.webContents.on('unresponsive', () => logError('Oberfläche reagiert nicht'));
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) logError(`Renderer: ${message} (${path.basename(sourceId || '')}:${line})`);
  });
  // Das Fenster zeigt nur die eigene index.html. Jede andere Navigation (file:, UNC, http, relative Links …)
  // wird blockiert; https-Links öffnen sich im Standard-Browser, alles andere wird abgelehnt.
  const indexUrl = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] === indexUrl) return;
    e.preventDefault();
    openExternalSafe(url);
  });
  win.webContents.on('will-redirect', (e, url) => { if (url.split('#')[0] !== indexUrl) e.preventDefault(); });
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  // Keine Gerätezugriffe (Kamera, Mikrofon, Standort, Benachrichtigungen ausgenommen)
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));
}

// Test-Hooks (Testprofil, Screenshot, Test-Skript) wirken nur im ungepackten Entwicklungsstand – nie in der ausgelieferten App.
const DEV = !app.isPackaged;
// Testprofil: SWAPLINE_PROFILE=<name> nutzt einen eigenen Datenordner (echte Einstellungen bleiben unberührt)
if (DEV && process.env.SWAPLINE_PROFILE) app.setPath('userData', path.join(app.getPath('appData'), 'Swapline-' + process.env.SWAPLINE_PROFILE));

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

// Einmalige Übernahme aus früheren Namen der App: zuerst %APPDATA%\Switchdesk, sonst %APPDATA%\ConsoleAI.
// Übernommen werden die Einstellungen (switchdesk.json bzw. consoleai.json → swapline.json) und die Chat-Liste
// (Local Storage). Login-Daten werden nicht übernommen, sondern in den alten Ordnern ungelesen gelöscht.
// Die alten Ordner bleiben mit einem Hinweis MOVED-TO-SWAPLINE.txt liegen; ~/.claude-profiles bleibt unverändert.
const LEGACY_APPS = [{ dir: 'Switchdesk', store: 'switchdesk.json' }, { dir: 'ConsoleAI', store: 'consoleai.json' }];
function migrateFromLegacy(appDataRoot = app.getPath('appData')) {
  const newDir = app.getPath('userData');
  const existing = LEGACY_APPS.map(l => ({ ...l, path: path.join(appDataRoot, l.dir) })).filter(l => fs.existsSync(l.path));
  if (!existing.length) return null;
  let source = null;
  try {
    for (const l of existing) purgeEmbeddedLoginData(l.path);
    if (fs.existsSync(path.join(newDir, 'swapline.json'))) return null; // schon übernommen
    source = existing.find(l => fs.existsSync(path.join(l.path, l.store)));
    if (!source) return null;
    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(path.join(source.path, source.store), path.join(newDir, 'swapline.json'));
    const ls = path.join(source.path, 'Local Storage');
    if (fs.existsSync(ls) && !fs.existsSync(path.join(newDir, 'Local Storage'))) fs.cpSync(ls, path.join(newDir, 'Local Storage'), { recursive: true });
    for (const l of existing) {
      const note = l === source ? `Die Einstellungen wurden aus diesem Ordner nach ${newDir} übernommen.` : `Swapline hat die Einstellungen aus %APPDATA%\\${source.dir} übernommen.`;
      fs.writeFileSync(path.join(l.path, 'MOVED-TO-SWAPLINE.txt'), note + ' Dieser Ordner kann gelöscht werden.\r\n');
    }
    logError(`Einstellungen übernommen aus ${source.dir}`);
  } catch (e) { logError('Übernahme alter Einstellungen: ' + e.message); }
  return source?.dir || null;
}
// Testprofil: Übernahme nur, wenn ausdrücklich ein Test-Ordner mit Altdaten angegeben ist (SWAPLINE_TEST_APPDATA)
if (!(DEV && process.env.SWAPLINE_PROFILE)) migrateFromLegacy();
else if (process.env.SWAPLINE_TEST_APPDATA) migrateFromLegacy(process.env.SWAPLINE_TEST_APPDATA);

// Eigene App-Kennung: Taskleiste gruppiert unter Swapline, Benachrichtigungen zeigen Name und Icon der App
if (process.platform === 'win32') app.setAppUserModelId('de.arfep.swapline');

app.whenReady().then(() => {
  purgeEmbeddedLoginData(app.getPath('userData'));
  // Arbeitsordner aus Claude Codes eigenem Verlauf freigeben (einmal, im Hintergrund) – damit bestehende Chats gültig bleiben
  setTimeout(() => {
    if (getStore().knownFoldersSeeded) return;
    for (const p of getStore().profiles) { try { for (const h of listHistory(p)) if (h.cwd) rememberFolder(h.cwd); } catch {} }
    updateStore(s => { s.knownFoldersSeeded = true; });
  }, 1500);
  STORE_FILE = path.join(app.getPath('userData'), 'swapline.json');
  createWindow();
  // SWAPLINE_SCREENSHOT=<datei.png>: nach dem Laden Bildschirmfoto speichern und beenden (für Tests)
  const shot = DEV && process.env.SWAPLINE_SCREENSHOT;
  if (shot) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try {
        if (DEV && process.env.SWAPLINE_TEST_JS) await win.webContents.executeJavaScript(fs.readFileSync(process.env.SWAPLINE_TEST_JS, 'utf8'));
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
    }, Number(process.env.SWAPLINE_SCREENSHOT_DELAY || 4000)));
  }
});
function cleanup() {
  for (const id of [...sessions.keys()]) stopSession(id);
  for (const id of [...logins.keys()]) cancelLogin(id);
}
app.on('window-all-closed', () => { cleanup(); app.quit(); });
app.on('will-quit', cleanup);
