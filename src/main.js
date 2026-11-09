// Swapline – Hauptprozess: Fenster, Konten (Profile), Claude-Prozesse, Verlauf.
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification, safeStorage } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');

const HOME = os.homedir();
const DEFAULT_CONFIG_DIR = path.join(HOME, '.claude');
const PROFILES_ROOT = path.join(HOME, '.claude-profiles');
let STORE_FILE; // wird nach app.ready gesetzt

let win;
const sessions = new Map(); // tabId -> { proc, profileId, ... }

// IPC: jeder Kanal wird hier registriert. Die Tabelle nutzt auch der Fernzugriff des Haupt-PCs (hostDispatch),
// damit Anfragen gekoppelter Geräte durch dieselben Prüfungen laufen wie lokale Eingaben.
const H = new Map(); // Kanal -> Funktion
// Antworten an die Oberfläche: Geräteschlüssel (auch verschlüsselt) und interne Zähler aus dem Speicherstand entfernen
function publicView(v) {
  if (!v || typeof v !== 'object' || !('profiles' in v) || !('settings' in v)) return v;
  const { remoteHost, remoteHosts, sessionCost, ...rest } = v;
  return rest;
}
function handle(ch, fn) { H.set(ch, fn); ipcMain.handle(ch, async (e, ...args) => publicView(await fn(e, ...args))); }

// ---------- Persistenter Speicher ----------
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return null; }
}
function saveStore(s) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2));
}
const UPDATE_MODES = ['notify', 'auto', 'off']; // Nur benachrichtigen (Standard) / Automatisch / Aus
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
  // bis 0.1.1 wurde nach jedem Fortsetzen einer Sitzung (--resume) deren bisheriger Kostenstand erneut gezählt –
  // die überhöhten Summen einmalig zurücksetzen (Limits bleiben)
  if (!s.costFixV2) { for (const u of Object.values(s.usage)) { delete u.costUsd; delete u.days; } s.costFixV2 = true; }
  s.sessionCost ||= {}; // sessionId -> letzter total_cost_usd dieser Sitzung
  s.projects ||= [];
  s.projectGroups ||= []; // Ordner für Projekte: [{ id, name, color }], Projekt.groupId zeigt darauf
  s.activeProjectId ||= 'all';
  s.settings ||= { model: '', permissionMode: 'default', claudePath: '' };
  // Updates: früher autoUpdate (an/aus, Standard an = automatisch laden). Neuer Standard „Nur benachrichtigen“;
  // auch bisher „Automatisch“ wird darauf umgestellt, nur „Aus“ bleibt aus.
  if (!UPDATE_MODES.includes(s.settings.updateMode)) s.settings.updateMode = s.settings.autoUpdate === false ? 'off' : 'notify';
  delete s.settings.autoUpdate;
  return s;
}
// Was Geräte im Fernzugriff vom Stand sehen – ändert es sich, holen sie den Stand neu (statt erst beim Neuverbinden)
const deviceSig = s => JSON.stringify([s.profiles?.map(p => [p.id, p.name, p.color]), s.projects, s.projectGroups, s.favorites, s.remoteHost?.devices?.map(d => [d.id, d.allowBypass, d.allowProjects, d.scope])]);
let deviceSigTimer = null;
function updateStore(fn) {
  const s = getStore(), before = deviceSig(s);
  fn(s); saveStore(s);
  if (deviceSig(s) !== before) { clearTimeout(deviceSigTimer); deviceSigTimer = setTimeout(() => remoteHost?.broadcast('store-changed', null), 300); }
  return s;
}
function profileById(id) { return getStore().profiles.find(p => p.id === id); }

// ---------- Eingaben aus der Oberfläche prüfen ----------
const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const THEMES = ['system', 'light', 'dark'];
const NOTIFY = ['always', 'background', 'off']; // Benachrichtigung bei fertiger Antwort
const SOUND = ['off', 'on', 'chime', 'ping', 'drop', 'rise', 'soft', 'system']; // 'on' = Glocke (ältere Versionen)
const TOOLVIEW = ['all', 'compact', 'hidden']; // Werkzeug-Aufrufe im Chat
const NOTIFYSTAY = ['sticky', 'auto']; // Benachrichtigung bleibt bis zum Klick / verschwindet von selbst
const LANGS = ['auto', 'de', 'en', 'tr']; // Sprache der Oberfläche ('auto' = Systemsprache)
// Sprache für native Dialoge, Benachrichtigungen und Fehlertexte an die Oberfläche (wie in der Oberfläche:
// Deutsch bzw. Türkisch nur, wenn eingestellt bzw. die Systemsprache es ist). Logeinträge bleiben deutsch.
function uiLang() {
  let l = '';
  try { l = getStore().settings.language; } catch {}
  if (l === 'de' || l === 'en' || l === 'tr') return l;
  const sys = String(app.getLocale() || '').toLowerCase();
  return sys.startsWith('de') ? 'de' : sys.startsWith('tr') ? 'tr' : 'en';
}
// Türkisch: dritter Wert (Texte mit eingesetzten Werten) oder Wörterbuch der Oberfläche (Schlüssel = deutscher Text);
// fehlt beides, Englisch
const TR = require('./renderer/i18n-tr.js');
const tr = (de, en, tk) => { const l = uiLang(); return l === 'en' ? en : l === 'tr' ? (tk ?? (Object.prototype.hasOwnProperty.call(TR, de) ? TR[de] : en)) : de; };
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
function confirmBypass(e) {
  if (e?.remote) return !!e.remote.allowBypass; // gekoppeltes Gerät: Freigabe aus der Geräteliste
  if (getStore().bypassAcknowledged) return true;
  const ok = dialog.showMessageBoxSync(win, {
    type: 'warning', buttons: [tr('Abbrechen', 'Cancel'), tr('Alles erlauben', 'Allow everything')], defaultId: 0, cancelId: 0, noLink: true,
    title: tr('Alles erlauben', 'Allow everything'),
    message: tr('Claude ohne Rückfragen arbeiten lassen?', 'Let Claude work without asking?'),
    detail: tr('Claude Code wird mit --dangerously-skip-permissions gestartet. Claude führt dann Befehle aus, ändert und löscht Dateien und greift auf das Netz zu, ohne vorher zu fragen.\n\nNur in Ordnern verwenden, denen du vertraust – am besten in einer Testumgebung.\n\nDiese Warnung erscheint nur einmal. In den Einstellungen kannst du sie wieder einschalten.',
      'Claude Code will be started with --dangerously-skip-permissions. Claude will then run commands, change and delete files and access the network without asking first.\n\nOnly use this in folders you trust – ideally in a test environment.\n\nThis warning appears only once. You can turn it back on in Settings.'),
  });
  if (ok !== 1) return false;
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
const claudeMissing = () => tr('Claude Code nicht gefunden. Bitte Claude Code installieren (https://code.claude.com/docs) oder in den Einstellungen den Pfad zu claude.exe angeben.',
  'Claude Code not found. Please install Claude Code (https://code.claude.com/docs) or set the path to claude.exe in Settings.');
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
function envFor(profile, { chat = false } = {}) {
  const env = { ...process.env };
  // Variablen einer eventuell umgebenden Claude-Sitzung nicht vererben
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; delete env.CLAUDE_CODE_SSE_PORT;
  // Recaps (Zusammenfassung „während du weg warst“) nur in Chat-Sitzungen – nicht bei auth/plugin/Modell-Abfragen
  if (chat) env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY = '1'; else delete env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY;
  if (profile && !profile.isDefault) env.CLAUDE_CONFIG_DIR = profile.configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  return env;
}
function spawnClaude(args, profile, { chat, ...opts } = {}) {
  const exe = claudeExe();
  if (!exe) throw new Error(claudeMissing());
  return spawn(exe, args, { env: envFor(profile, { chat }), windowsHide: true, ...opts });
}

function authStatus(profile) {
  return new Promise(resolve => {
    if (!claudeExe()) return resolve({ loggedIn: false, claudeMissing: true, error: claudeMissing() });
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
        // commands: /-Befehle und Skills des Kontos (Name, Beschreibung, Argument-Hinweis) für die Auswahl im Eingabefeld
        const commands = (r.commands || []).filter(c => c && typeof c.name === 'string')
          .map(c => ({ name: c.name, description: String(c.description || '').slice(0, 300), argumentHint: String(c.argumentHint || '').slice(0, 80) }));
        finish({ ...base, models: r.models || [], account: r.account || null, commands });
      }
    });
    p.on('error', () => finish(base));
    p.on('close', () => finish(base));
    p.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n');
    setTimeout(() => finish(base), 45000);
  });
}
handle('profiles:models', (_e, { id, refresh }) => {
  const p = profileById(id);
  if (!p) return null;
  if (refresh || !modelCache.has(id)) {
    const pr = probeModels(p);
    modelCache.set(id, pr);
    // leeres Ergebnis (z. B. Zeitüberschreitung) nicht merken – beim nächsten Mal neu abfragen
    pr.then(r => { if (!r.models.length && modelCache.get(id) === pr) modelCache.delete(id); });
  }
  return modelCache.get(id);
});

// ---------- Erweiterungen (Plugins) – nur über die offiziellen Befehle `claude plugin …` ----------
function runClaude(profile, args, timeoutMs = 120000) {
  return new Promise(resolve => {
    if (!claudeExe()) return resolve({ code: -1, out: '', err: claudeMissing() });
    const p = spawnClaude(args, profile, { cwd: HOME });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, timeoutMs);
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
handle('ext:list', async (_e, profileId) => {
  const p = profileById(profileId);
  if (!p) return { error: tr('Konto unbekannt', 'Unknown account') };
  const r = await runClaude(p, ['plugin', 'list', '--json', '--available'], 60000);
  try {
    const j = JSON.parse(r.out);
    const installed = (Array.isArray(j) ? j : j.installed || []).map(x => ({ id: x.id, version: x.version, enabled: !!x.enabled, scope: x.scope, installedAt: x.installedAt, mcp: Object.keys(x.mcpServers || {}) }));
    const available = (j.available || []).map(x => ({ id: x.pluginId || x.id, name: x.name, description: String(x.description || '').slice(0, 400), installs: x.installCount || x.installs || null }));
    return { installed, available };
  } catch { return { error: (r.err || r.out || tr('Keine Antwort von Claude Code', 'No response from Claude Code')).trim().split('\n').pop().slice(0, 300) }; }
});
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,100}@[a-z0-9][a-z0-9._-]{0,100}$/i;
handle('ext:action', async (_e, { profileId, action, id } = {}) => {
  const p = profileById(profileId);
  if (!p || !['install', 'uninstall', 'enable', 'disable'].includes(action) || typeof id !== 'string' || !PLUGIN_ID_RE.test(id)) return { ok: false, error: tr('Ungültige Anfrage', 'Invalid request') };
  // Jede Änderung bestätigt der Nutzer im nativen Dialog – Aktivieren startet Hooks/MCP-Server, Deaktivieren kann Schutz-Hooks abschalten
  const LABEL = {
    install: [tr('Plugin installieren', 'Install plugin'), tr('Installieren', 'Install')],
    uninstall: [tr('Plugin entfernen', 'Remove plugin'), tr('Entfernen', 'Remove')],
    enable: [tr('Plugin aktivieren', 'Enable plugin'), tr('Aktivieren', 'Enable')],
    disable: [tr('Plugin deaktivieren', 'Disable plugin'), tr('Deaktivieren', 'Disable')],
  }[action];
  const ok = dialog.showMessageBoxSync(win, {
    type: action === 'install' || action === 'enable' ? 'warning' : 'question', buttons: [tr('Abbrechen', 'Cancel'), LABEL[1]], defaultId: 0, cancelId: 0, noLink: true,
    title: LABEL[0], message: `${LABEL[1]}: ${id}`,
    detail: action === 'install' || action === 'enable'
      ? tr(`Plugins erweitern Claude Code um Befehle, Skills, Hooks oder MCP-Server und können dabei Code auf deinem PC ausführen. Nur Plugins verwenden, denen du vertraust.\n\nKonto: ${p.name}`,
        `Plugins extend Claude Code with commands, skills, hooks or MCP servers and can run code on your PC. Only use plugins you trust.\n\nAccount: ${p.name}`,
        `Eklentiler Claude Code'a komutlar, beceriler (skills), kancalar (hooks) veya MCP sunucuları ekler ve bilgisayarınızda kod çalıştırabilir. Yalnızca güvendiğiniz eklentileri kullanın.\n\nHesap: ${p.name}`)
      : action === 'uninstall'
        ? tr(`Das Plugin wird für das Konto „${p.name}“ entfernt.`, `The plugin will be removed for the account “${p.name}”.`, `Eklenti “${p.name}” hesabı için kaldırılacak.`)
        : tr(`Das Plugin wird für das Konto „${p.name}“ deaktiviert.`, `The plugin will be disabled for the account “${p.name}”.`, `Eklenti “${p.name}” hesabı için devre dışı bırakılacak.`),
  });
  if (ok !== 1) return { ok: false, cancelled: true };
  const r = await runClaude(p, ['plugin', action, id]);
  modelCache.delete(profileId); // Befehlsliste neu laden
  const msg = (r.out + '\n' + r.err).trim().split('\n').filter(Boolean).slice(-3).join(' · ').slice(0, 400);
  return r.code === 0 ? { ok: true, message: msg } : { ok: false, error: msg || tr(`Fehler (Code ${r.code})`, `Error (code ${r.code})`, `Hata (kod ${r.code})`) };
});

// ---------- Sitzungen (ein Claude-Prozess pro Chat-Tab) ----------
function send(tabId, msg) {
  const r = remoteTabs.get(tabId);
  if (r) return remoteHost?.push(r.deviceId, 'claude', { tabId: r.tabId, msg });
  if (win && !win.isDestroyed()) win.webContents.send('claude:event', { tabId, msg });
  pushAttached(tabId, msg);
}

// Ausgabedateien von Hintergrund-Aufgaben, die die CLI im Stream gemeldet hat – nur diese darf task:readOutput lesen
const seenOutputs = new Set();
const OUTPUT_RE = /(?:Output is being written to:\s*|"output_file":")((?:[^"\\]|\\.)+?\.output)/g;
function collectOutputs(line, s) {
  if (!line.includes('.output')) return;
  for (const m of line.matchAll(OUTPUT_RE)) {
    let p; try { p = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    const key = path.resolve(p.trim()).toLowerCase();
    if (seenOutputs.size < 5000) seenOutputs.add(key);
    if (s && s.outputs.size < 500) s.outputs.add(key); // je Sitzung: ein eingeschränktes Gerät liest nur Ausgaben seiner Chats
  }
}
// Laufende Hintergrund-Aufgaben einer Sitzung (task_started … task_notification / background_tasks_changed)
function trackBgTask(s, m) {
  if (m.subtype === 'background_tasks_changed') s.tasks = new Set((m.tasks || []).map(x => x.task_id));
  else if (m.subtype === 'task_started' && m.task_id) s.tasks.add(m.task_id);
  else if (m.subtype === 'task_notification' && m.task_id) s.tasks.delete(m.task_id);
  else if (m.subtype === 'task_updated' && m.task_id && m.patch?.status && m.patch.status !== 'running') s.tasks.delete(m.task_id);
}
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

  const proc = tab.ssh ? spawnSsh(tab.ssh, claudeOnServer(args, tab.cwd)) : spawnClaude(args, profile, { chat: true, cwd: tab.cwd && fs.existsSync(tab.cwd) ? tab.cwd : HOME });
  // lastCost: letzter Kostenstand der Sitzung. Beim Fortsetzen (--resume) startet Claude Code mit den bisherigen Kosten
  // der Sitzung, deshalb gilt der zuletzt gesehene Stand dieser Sitzung als Ausgangswert.
  const s = { proc, tab: { ...tab }, stderr: '', pending: new Map(), lastCost: (tab.sessionId && getStore().sessionCost[tab.sessionId]) || 0, tasks: new Set(), outputs: new Set() }; // pending: offene Berechtigungsanfragen der CLI
  sessions.set(tab.id, s);

  readline.createInterface({ input: proc.stdout }).on('line', line => {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch { return; }
    collectOutputs(line, s);
    if (m.type === 'system' && m.subtype === 'init') {
      // neue statt fortgesetzter Sitzung (z. B. Verlauf nicht gefunden): Kosten beginnen bei 0
      if (m.session_id !== s.tab.sessionId) s.lastCost = getStore().sessionCost[m.session_id] || 0;
      s.tab.sessionId = m.session_id;
    }
    if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
      s.pending.set(m.request_id, { toolName: m.request.tool_name, input: m.request.input, suggestions: m.request.permission_suggestions || null, description: typeof m.request.description === 'string' ? m.request.description : '' });
    }
    if (m.type === 'rate_limit_event' && !tab.ssh) recordLimits(tab.profileId, m.rate_limit_info);
    // total_cost_usd ist der Stand der ganzen Sitzung (kumuliert, inkl. fortgesetzter Teile) – gezählt wird nur der Zuwachs
    if (m.type === 'result') s.busy = false;
    if (m.type === 'system') trackBgTask(s, m);
    if (m.type === 'result' && typeof m.total_cost_usd === 'number') {
      const delta = m.total_cost_usd >= s.lastCost ? m.total_cost_usd - s.lastCost : m.total_cost_usd;
      s.lastCost = m.total_cost_usd;
      m.swapline_cost_delta = delta;
      if (!tab.ssh) recordCost(tab.profileId, delta, s.tab.sessionId, m.total_cost_usd); // Server-Kosten gehören zum Konto auf dem Server
    }
    send(tab.id, m);
  });
  proc.stderr.on('data', d => { s.stderr = (s.stderr + d).slice(-4000); });
  proc.on('error', e => send(tab.id, { type: 'app_error', message: tr(`Claude konnte nicht gestartet werden: ${e.message}`, `Could not start Claude: ${e.message}`, `Claude başlatılamadı: ${e.message}`) }));
  proc.on('close', code => {
    if (code) logError(`Claude beendet mit Code ${code} (Chat ${tab.id}, Sitzung ${s.tab.sessionId || '-'}): ${s.stderr.trim().split('\n').slice(-5).join(' | ')}`);
    if (sessions.get(tab.id) === s) sessions.delete(tab.id);
    const hint = code && tab.ssh ? serverExitMessage(s.stderr) : null; // Server per SSH: Ursache verständlich melden
    if (hint) send(tab.id, { type: 'app_error', message: hint });
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

const SESSION_COST_MAX = 500; // so viele Sitzungen merkt sich Swapline (älteste fallen heraus)
function recordCost(profileId, cost, sessionId, total) {
  updateStore(st => {
    if (sessionId && UUID_RE.test(sessionId)) {
      delete st.sessionCost[sessionId]; // neu einfügen = zuletzt benutzt
      st.sessionCost[sessionId] = total;
      const ids = Object.keys(st.sessionCost);
      for (const id of ids.slice(0, Math.max(0, ids.length - SESSION_COST_MAX))) delete st.sessionCost[id];
    }
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
function pushUsage() {
  remoteHost?.broadcast('usage', getStore().usage);
  if (win && !win.isDestroyed()) win.webContents.send('usage:update', getStore().usage);
}

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
  const untitled = tr('(ohne Titel)', '(untitled)');
  return items.slice(0, limit).map(it => {
    let text = '';
    try { text = readHead(it.file) + '\n' + readTail(it.file, 32768); } catch {}
    const { title, cwd, firstPrompt } = parseSessionHead(text);
    return { sessionId: it.sessionId, file: it.file, mtime: it.mtime, cwd, title: title || firstPrompt.slice(0, 80) || untitled };
  }).filter(h => h.cwd || h.title !== untitled);
}
function parseSessionHead(text) {
  let title = '', cwd = '', firstPrompt = '';
  {
    {
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
    }
  }
  return { title, cwd, firstPrompt };
}

// Nachrichten einer alten Sitzung für die Anzeige laden
function loadTranscript(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return transcriptFromText(text);
}
function transcriptFromText(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if ((o.type === 'user' || o.type === 'assistant') && o.message && !o.isSidechain && !o.isMeta) {
      out.push({ type: o.type, message: o.message, timestamp: o.timestamp, fromHistory: true });
    } else if (o.type === 'system' && o.subtype === 'away_summary' && typeof o.content === 'string') {
      out.push({ type: 'system', subtype: 'away_summary', content: o.content, timestamp: o.timestamp, fromHistory: true });
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
handle('store:get', () => ({ ...getStore(), appVersion: app.getVersion() }));

handle('profiles:add', (_e, { name, color } = {}) => {
  name = cleanName(name, 'Neues Konto'); color = cleanColor(color, '#22c55e');
  const slug = (name || 'konto').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'konto';
  const id = slug + '-' + crypto.randomBytes(3).toString('hex');
  const configDir = path.join(PROFILES_ROOT, id);
  fs.mkdirSync(configDir, { recursive: true });
  return updateStore(s => { s.profiles.push({ id, name: name || 'Neues Konto', color: color || '#22c55e', configDir }); });
});
handle('profiles:update', (_e, { id, patch }) => updateStore(s => {
  const p = s.profiles.find(x => x.id === id); if (p && patch) Object.assign(p, { name: cleanName(patch.name, p.name), color: cleanColor(patch.color, p.color) });
}));
handle('profiles:remove', (_e, id) => updateStore(s => {
  const p = s.profiles.find(x => x.id === id);
  if (!p || p.isDefault) return;
  s.profiles = s.profiles.filter(x => x.id !== id);
  if (s.activeProfileId === id) s.activeProfileId = 'default';
}));
handle('profiles:setActive', (_e, id) => updateStore(s => { s.activeProfileId = id; }));
handle('profiles:status', (_e, id) => { const p = profileById(id); return p ? authStatus(p) : { loggedIn: false }; });

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

handle('profiles:login', (_e, id) => {
  const p = profileById(id);
  if (!p) return false;
  cancelLogin(id);
  const exe = claudeExe();
  if (!exe) { loginEvent(id, { state: 'error', error: claudeMissing() }); return false; }
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
    else loginEvent(id, { state: 'error', error: tr(`Anmeldung nicht abgeschlossen (Code ${code}).`, `Sign-in not completed (code ${code}).`, `Oturum açma tamamlanmadı (kod ${code}).`) });
  });
  return true;
});
// Falls die CLI einen Code verlangt: sichtbares Konsolenfenster mit `claude auth login`.
// Kein cmd-String – die exe wird direkt mit Argument-Array gestartet; der Nutzer tippt den Code dort selbst ein.
handle('profiles:loginConsole', (_e, id) => {
  const p = profileById(id);
  const exe = claudeExe();
  if (!p || !exe) return false;
  cancelLogin(id);
  const proc = spawn(exe, ['auth', 'login'], { env: envFor(p), detached: true, windowsHide: false, stdio: 'ignore' });
  proc.unref();
  return true;
});
handle('profiles:loginCancel', (_e, id) => cancelLogin(id));
handle('profiles:logout', (_e, id) => new Promise(res => {
  const p = profileById(id); if (!p || !claudeExe()) return res(false);
  spawnClaude(['auth', 'logout'], p).on('close', () => res(true));
}));
// claude.exe direkt in einem eigenen Konsolenfenster starten (Argument-Array, keine Shell, kein Kontoname in Befehlszeilen)
handle('profiles:openTerminal', (_e, { id, cwd }) => {
  const p = profileById(id);
  const exe = claudeExe();
  if (!p || !exe) return false;
  spawn(exe, [], { env: envFor(p), cwd: isAllowedCwd(cwd) ? cwd : HOME, detached: true, windowsHide: false, stdio: 'ignore' }).unref();
  return true;
});

handle('favorites:add', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: tr('Projektordner als Favorit hinzufügen', 'Add project folder as favorite') });
  if (r.canceled || !r.filePaths[0]) return getStore();
  const dir = r.filePaths[0];
  return updateStore(s => { if (!s.favorites.some(f => f.path === dir)) s.favorites.push({ path: dir, name: path.basename(dir) }); });
});
handle('favorites:remove', (_e, dir) => updateStore(s => { s.favorites = s.favorites.filter(f => f.path !== dir); }));
handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  if (isUnc(r.filePaths[0])) return null;
  rememberFolder(r.filePaths[0]);
  return r.filePaths[0];
});
// Nur bekannte Schlüssel mit gültigen Werten; alles andere wird abgelehnt.
handle('settings:set', (_e, patch) => {
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
    else if (k === 'notifyStay' && NOTIFYSTAY.includes(v)) ok.notifyStay = v;
    else if (k === 'updateMode' && UPDATE_MODES.includes(v)) ok.updateMode = v;
    else if (k === 'language' && LANGS.includes(v)) ok.language = v;
    else if (k === 'permissionMode' && MODES.includes(v)) {
      if (v === 'bypassPermissions' && !confirmBypass()) return reject('Bypass nicht bestätigt');
      ok.permissionMode = v;
    } else if (k === 'claudePath' && v === '') { ok.claudePath = ''; resolvedClaude = undefined; } // setzen nur über settings:pickClaude
    else return reject(`Schlüssel/Wert nicht erlaubt: ${String(k).slice(0, 40)}`);
  }
  const r = updateStore(s => { Object.assign(s.settings, ok); });
  if (ok.updateMode) { applyUpdateMode(); if (ok.updateMode !== 'off') checkForUpdates(); }
  return r;
});
// claudePath nur über einen Datei-Dialog im Hauptprozess
handle('settings:pickClaude', async () => {
  const r = await dialog.showOpenDialog(win, { title: tr('claude.exe auswählen', 'Choose claude.exe'), properties: ['openFile'], filters: [{ name: 'claude.exe', extensions: ['exe'] }] });
  if (r.canceled || !r.filePaths[0]) return getStore();
  if (!isClaudeExePath(r.filePaths[0])) return { ...getStore(), rejected: tr('Datei heißt nicht claude.exe', 'The file is not named claude.exe') };
  resolvedClaude = undefined;
  return updateStore(s => { s.settings.claudePath = r.filePaths[0]; });
});

// Projekte (Gruppen für Chats, optional mit Ordner)
// Projektbild: per Datei-Dialog im Hauptprozess gewählt, geprüft und als data:-URL gespeichert.
// In der Oberfläche wird es nur als <img> angezeigt – auch eine SVG kann dort keinen Code ausführen
// und nichts nachladen.
const ICON_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon' };
const ICON_MAX = 512 * 1024;
const PROJECTS_MAX = 100;
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
handle('projects:pickIcon', async () => {
  const r = await dialog.showOpenDialog(win, { title: tr('Bild für das Projekt wählen', 'Choose an image for the project'), properties: ['openFile'], filters: [{ name: tr('Bilder', 'Images'), extensions: Object.keys(ICON_TYPES) }] });
  const file = r.filePaths?.[0];
  if (r.canceled || !file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (isUnc(file) || !ICON_TYPES[ext]) return { error: tr('Dateityp nicht unterstützt', 'File type not supported') };
  let buf;
  try { if (fs.statSync(file).size > ICON_MAX) return { error: tr('Bild ist größer als 512 KB', 'Image is larger than 512 KB') }; buf = fs.readFileSync(file); } catch { return { error: tr('Datei kann nicht gelesen werden', 'Cannot read the file') }; }
  if (!looksLikeImage(buf, ext)) return { error: tr('Datei ist kein gültiges Bild', 'The file is not a valid image') };
  return { icon: `data:${ICON_TYPES[ext]};base64,${buf.toString('base64')}` };
});
const validGroup = (s, id) => typeof id === 'string' && s.projectGroups.some(g => g.id === id);
handle('projects:add', (_e, { name, color, cwd, icon, groupId } = {}) => updateStore(s => {
  if (s.projects.length >= PROJECTS_MAX) return;
  name = cleanName(name, 'Projekt'); color = cleanColor(color, '#1581FF'); cwd = isAllowedCwd(cwd) ? cwd : ''; // nur per Dialog gesehene Ordner
  const id = 'p-' + crypto.randomBytes(4).toString('hex');
  const pr = { id, name: name || 'Projekt', color: color || '#1581FF', cwd: cwd || '' };
  if (cleanIcon(icon)) pr.icon = cleanIcon(icon);
  if (validGroup(s, groupId)) pr.groupId = groupId;
  s.projects.push(pr);
  s.activeProjectId = id;
}));
handle('projects:update', (_e, { id, patch }) => updateStore(s => {
  const p = s.projects.find(x => x.id === id);
  if (p && patch) {
    if ('name' in patch) p.name = cleanName(patch.name, p.name);
    if ('color' in patch) p.color = cleanColor(patch.color, p.color);
    if ('cwd' in patch) p.cwd = isAllowedCwd(patch.cwd) ? patch.cwd : '';
    if ('icon' in patch) { if (cleanIcon(patch.icon)) p.icon = cleanIcon(patch.icon); else delete p.icon; }
    if ('groupId' in patch) { if (validGroup(s, patch.groupId)) p.groupId = patch.groupId; else delete p.groupId; }
  }
}));
handle('projects:remove', (_e, id) => updateStore(s => {
  s.projects = s.projects.filter(x => x.id !== id);
  if (s.activeProjectId === id) s.activeProjectId = 'all';
}));
handle('projects:setActive', (_e, id) => updateStore(s => { s.activeProjectId = id; }));
// Projekt-Ordner (nur Gruppierung in der Leiste – Chats und Ordner auf der Platte bleiben unberührt)
handle('projects:groupAdd', (_e, { name, color } = {}) => updateStore(s => {
  if (s.projectGroups.length >= 50) return;
  s.projectGroups.push({ id: 'g-' + crypto.randomBytes(4).toString('hex'), name: cleanName(name, 'Ordner') || 'Ordner', color: cleanColor(color, '#64748B') });
}));
handle('projects:groupUpdate', (_e, { id, patch } = {}) => updateStore(s => {
  const g = s.projectGroups.find(x => x.id === id);
  if (!g || !patch) return;
  if ('name' in patch) g.name = cleanName(patch.name, g.name) || g.name;
  if ('color' in patch) g.color = cleanColor(patch.color, g.color);
}));
handle('projects:groupRemove', (_e, id) => updateStore(s => {
  s.projectGroups = s.projectGroups.filter(x => x.id !== id);
  for (const p of s.projects) if (p.groupId === id) delete p.groupId; // Projekte bleiben, nur ohne Ordner
}));
handle('projects:reorder', (_e, ids) => updateStore(s => {
  s.projects.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}));

// Volltextsuche in den Sitzungen eines Kontos: Nachrichten von dir und Claude (keine Werkzeug-Ausgaben).
// Liefert je Sitzung die Anzahl Treffer und einen Ausschnitt um den ersten Treffer.
let searchGen = 0;
const SEARCH_FILE_MAX = 50 * 1024 * 1024;
handle('history:search', async (_e, { profileId, query } = {}) => {
  const gen = ++searchGen; // eine neuere Suche bricht diese ab
  const p = profileById(profileId);
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!p || q.length < 2) return [];
  const textOfMsg = m => {
    const c = m?.content;
    if (typeof c === 'string') return c.startsWith('<') ? '' : c;
    return Array.isArray(c) ? c.filter(b => b.type === 'text' && !String(b.text).startsWith('<')).map(b => b.text).join('\n') : '';
  };
  const results = [];
  for (const h of listHistory(p, 400)) {
    if (gen !== searchGen) return [];
    try { if ((await fs.promises.stat(h.file)).size > SEARCH_FILE_MAX) continue; } catch { continue; }
    let hits = 0, snippet = '', when = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(h.file, 'utf8'), crlfDelay: Infinity });
    try { for await (const line of rl) {
      if (gen !== searchGen) { rl.close(); return []; }
      if (!line.toLowerCase().includes(q)) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain || o.isMeta) continue;
      const text = textOfMsg(o.message), i = text.toLowerCase().indexOf(q);
      if (i < 0) continue;
      hits++;
      if (!snippet) { snippet = (i > 40 ? '…' : '') + text.slice(Math.max(0, i - 40), i + q.length + 80).replace(/\s+/g, ' ') + '…'; when = Date.parse(o.timestamp) || h.mtime; }
    } } catch { continue; }
    if (hits) results.push({ ...h, hits, snippet, when });
    if (results.length >= 60) break;
  }
  for (const r of results) if (r.cwd) rememberFolder(r.cwd);
  return results;
});
handle('history:list', (_e, profileId) => {
  const p = profileById(profileId);
  if (!p) return [];
  const list = listHistory(p);
  for (const h of list) if (h.cwd) rememberFolder(h.cwd); // Ordner aus Claude Codes eigenem Verlauf
  return list;
});
handle('history:loadSession', (_e, { profileId, sessionId, cwd } = {}) => {
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
handle('session:confirmBypass', e => confirmBypass(e));
// Warnung zu „Alles erlauben“ wieder einschalten (nur in diese sichere Richtung von der Oberfläche aus möglich)
handle('settings:resetBypassWarning', () => updateStore(s => { delete s.bypassAcknowledged; }));
// Nachrichteninhalt: Text oder Liste aus Text- und Bild-Blöcken (Bilder als base64, nur png/jpeg/gif/webp, je max. 5 MB)
const IMAGE_MEDIA = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
function validContent(c) {
  if (typeof c === 'string') return c.length <= 2e6;
  if (!Array.isArray(c) || !c.length || c.length > 20) return false;
  return c.every(b => (b?.type === 'text' && typeof b.text === 'string' && b.text.length <= 2e6)
    || (b?.type === 'image' && b.source?.type === 'base64' && IMAGE_MEDIA.includes(b.source.media_type)
      && typeof b.source.data === 'string' && b.source.data.length <= 7e6 && /^[A-Za-z0-9+/]+=*$/.test(b.source.data)));
}
// Anhänge über den Datei-Dialog: Bilder werden eingelesen (base64), andere Dateien nur als Pfad übergeben
handle('attach:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: tr('Dateien anhängen', 'Attach files'), properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  const out = [];
  for (const file of r.filePaths.slice(0, 10)) {
    if (isUnc(file)) continue;
    const ext = path.extname(file).slice(1).toLowerCase();
    const media = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext];
    try {
      const size = fs.statSync(file).size;
      if (media && size <= 5 * 1024 * 1024) out.push({ kind: 'image', name: path.basename(file), media, data: fs.readFileSync(file).toString('base64') });
      else out.push({ kind: 'file', name: path.basename(file), path: file, size });
    } catch { /* nicht lesbar: überspringen */ }
  }
  return out;
});
handle('session:send', (_e, { tab: rawTab, content }) => {
  const tab = validTab(rawTab);
  if (!tab || !validContent(content)) {
    logError('session:send abgelehnt: ungültige Tab-Daten');
    if (rawTab?.cwd && typeof rawTab.id === 'string') send(rawTab.id, { type: 'app_error', message: tr('Dieser Arbeitsordner ist nicht freigegeben. Bitte den Ordner über „Neuer Chat“ oder ein Projekt neu wählen.', 'This working folder is not approved. Please choose the folder again via “New chat” or a project.') });
    return false;
  }
  if (tab.permissionMode === 'bypassPermissions' && !confirmBypass(_e)) {
    send(tab.id, { type: 'app_error', message: tr('„Alles erlauben“ wurde nicht bestätigt – Nachricht nicht gesendet.', '“Allow everything” was not confirmed – message not sent.') });
    return false;
  }
  if (!claudeExe()) { send(tab.id, { type: 'app_error', message: claudeMissing() }); return false; }
  let s = sessions.get(tab.id);
  if (!s) s = startSession(tab);
  s.busy = true; // Claude arbeitet an einer Antwort (bis zum result)
  writeTo(tab.id, { type: 'user', message: { role: 'user', content: withBashContext(tab.id, content) } });
  if (!_e?.remote) pushAttached(tab.id, { type: 'swapline_user', content: userEcho(content), from: os.hostname().slice(0, 40) });
  return true;
});
// Antwort auf eine Berechtigungsanfrage. Nur offene Anfragen dieser CLI werden beantwortet; die Eingabe des
// Werkzeugs darf nicht verändert werden (Ausnahme: Antworten auf eine Frage), Regeln nur exakt so, wie die CLI
// sie vorgeschlagen hat, und nie ein Moduswechsel.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
handle('session:respond', (_e, { tabId, requestId, response } = {}) => {
  const s = sessions.get(tabId);
  const req = s?.pending.get(requestId);
  const reject = why => { logError('session:respond abgelehnt: ' + why); return false; };
  if (!req) return reject('keine offene Anfrage');
  if (!response || !['allow', 'deny'].includes(response.behavior)) return reject('ungültige Antwort');
  let out;
  if (response.behavior === 'deny') {
    // Claude liest den Text: Standard immer Englisch
    out = { behavior: 'deny', message: String(response.message || 'Declined.').slice(0, 500) };
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
  send(tabId, { type: 'swapline_answered', requestId, behavior: out.behavior, from: _e?.remote ? _e.remote.name : os.hostname().slice(0, 40) });
  return true;
});
handle('session:interrupt', (_e, tabId) => {
  stopBash(tabId);
  writeTo(tabId, { type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'interrupt' } });
});
// ---------- „!“-Befehle (wie in der Claude CLI) ----------
// „!npm test“ führt den Befehl direkt im Ordner des Chats aus – ohne Claude. Die Ausgabe erscheint im Chat und geht mit
// der nächsten Nachricht an Claude, im Format der CLI (<bash-input>/<bash-stdout>). Shell wie bei Claude Code unter
// Windows: Git Bash, sonst PowerShell. Der Befehl ist ausdrücklich vom Nutzer – geprüft werden Chat, Ordner und Länge.
const BASH_TIMEOUT = 120000, BASH_MAX = 30000;
const bashRuns = new Map();    // Chat -> laufender Prozess
const bashContext = new Map(); // Chat -> Ausgaben für die nächste Nachricht an Claude
function bashShell() {
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const env = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const bash = [env, ...pf.map(p => path.join(p, 'Git', 'bin', 'bash.exe'))].find(p => p && !isUnc(p) && fs.existsSync(p));
  if (bash) return { exe: bash, args: cmd => ['-c', cmd], name: 'bash' };
  return { exe: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: cmd => ['-NoProfile', '-NonInteractive', '-Command', cmd], name: 'powershell' };
}
function withBashContext(tabId, content) {
  const ctx = bashContext.get(tabId);
  if (!ctx?.length) return content;
  bashContext.delete(tabId);
  const pre = ctx.join('\n');
  if (typeof content === 'string') return pre + '\n\n' + content;
  return [{ type: 'text', text: pre }, ...content];
}
function stopBash(tabId) {
  const p = bashRuns.get(tabId);
  if (p?.pid) spawn('taskkill', ['/T', '/F', '/PID', String(p.pid)], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
}
const escTag = s => s.replace(/<\/(bash-[a-z]+)>/g, '<\\/$1>'); // Ausgabe darf die Markierung nicht vorzeitig schließen
handle('session:bashStop', (_e, tabId) => { if (typeof tabId === 'string') stopBash(tabId); return true; });
handle('session:bash', (_e, { tab: rawTab, command } = {}) => {
  const tab = validTab(rawTab);
  if (!tab || typeof command !== 'string' || !command.trim() || command.length > 8000 || command.includes('\0')) return false;
  if (bashRuns.has(tab.id)) return { error: tr('Es läuft schon ein Befehl in diesem Chat', 'A command is already running in this chat') };
  const cwd = tab.cwd && fs.existsSync(tab.cwd) ? tab.cwd : HOME;
  const sh = bashShell();
  const id = crypto.randomBytes(6).toString('hex');
  const from = _e?.remote ? _e.remote.name : os.hostname().slice(0, 40);
  send(tab.id, { type: 'swapline_bash', id, command, state: 'running', shell: sh.name, from });
  let out = '', cut = false;
  const p = spawn(sh.exe, sh.args(command), { cwd, windowsHide: true });
  bashRuns.set(tab.id, p);
  const take = d => { if (out.length < BASH_MAX) out += d.toString('utf8'); else cut = true; };
  p.stdout.on('data', take); p.stderr.on('data', take);
  const timer = setTimeout(() => stopBash(tab.id), BASH_TIMEOUT);
  const done = code => {
    if (bashRuns.get(tab.id) !== p) return;
    clearTimeout(timer); bashRuns.delete(tab.id);
    if (out.length > BASH_MAX) { out = out.slice(0, BASH_MAX); cut = true; }
    const output = out.replace(/\r\n/g, '\n').replace(/\s+$/, '') + (cut ? '\n' + '[… output truncated]' : '');
    const list = bashContext.get(tab.id) || [];
    list.push(`<bash-input>${escTag(command)}</bash-input>\n<bash-stdout>${escTag(output)}</bash-stdout>` + (code ? `\n<bash-stderr>exit code ${code}</bash-stderr>` : ''));
    bashContext.set(tab.id, list.slice(-10));
    send(tab.id, { type: 'swapline_bash', id, command, state: 'done', code: code ?? -1, output, shell: sh.name, from });
  };
  p.on('close', code => done(code));
  p.on('error', e => { out += e.message; done(-1); });
  return true;
});
// Einstellungen ändern -> Prozess beenden; die nächste Nachricht startet mit --resume neu
handle('session:restart', (_e, tabId) => { stopSession(tabId); return true; });
handle('session:close', (_e, tabId) => { stopSession(tabId); return true; });
// Übertragung eines Chats in ein anderes Konto – nur nach ausdrücklicher Bestätigung im Hauptprozess
handle('session:moveProfile', (_e, { sessionId, cwd, fromProfileId, toProfileId } = {}) => {
  const from = profileById(fromProfileId), to = profileById(toProfileId);
  if (!from || !to) return { ok: false, error: tr('Konto unbekannt', 'Unknown account') };
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) { logError('session:moveProfile abgelehnt: ungültige Session-ID'); return { ok: false, error: tr('ungültige Session-ID', 'invalid session ID') }; }
  if (from.configDir === to.configDir) return { ok: true };
  const ok = dialog.showMessageBoxSync(win, {
    type: 'warning', buttons: [tr('Abbrechen', 'Cancel'), tr('Übertragen', 'Transfer')], defaultId: 0, cancelId: 0, noLink: true,
    title: tr('Chat in anderes Konto übertragen', 'Transfer chat to another account'),
    message: tr(`Chat in Konto „${to.name}“ übertragen?`, `Transfer chat to account “${to.name}”?`, `Sohbet “${to.name}” hesabına aktarılsın mı?`),
    detail: tr(`Der gesamte Verlauf inkl. Dateiinhalten und Befehlsausgaben wird in Konto „${to.name}“ kopiert. Nicht zwischen Firmen- und Privatkonten übertragen.`,
      `The entire history, including file contents and command output, will be copied to account “${to.name}”. Do not transfer between work and personal accounts.`,
      `Dosya içerikleri ve komut çıktıları dahil tüm geçmiş “${to.name}” hesabına kopyalanır. İş ve kişisel hesaplar arasında aktarmayın.`),
  });
  if (ok !== 1) return { ok: false, cancelled: true };
  try { return { ok: copySessionToProfile(sessionId, cwd, from, to) }; } catch (e) { logError('Übertragung: ' + e.message); return { ok: false, error: e.message }; }
});
// Nur existierende Ordner im Explorer öffnen – nie Dateien oder Programme
// Fenster nach vorne holen (Klick auf eine Benachrichtigung) bzw. in der Taskleiste blinken lassen
// Windows-Benachrichtigung über Electron: kann bis zum Klick stehen bleiben (timeoutType 'never').
// Klick holt Swapline nach vorne und meldet der Oberfläche, welcher Chat geöffnet werden soll.
const liveNotes = new Set(); // Referenzen halten, sonst räumt der Garbage Collector die Klick-Behandlung weg
handle('notify:show', (_e, { title, body, tabId, silent } = {}) => {
  if (!Notification.isSupported()) return false;
  const sticky = (getStore().settings.notifyStay || 'sticky') === 'sticky';
  const n = new Notification({
    title: String(title || 'Swapline').slice(0, 120), body: String(body || '').slice(0, 300), silent: silent !== false,
    icon: path.join(__dirname, 'renderer', 'assets', 'swapline.ico'), timeoutType: sticky ? 'never' : 'default',
  });
  liveNotes.add(n);
  const done = () => liveNotes.delete(n);
  n.on('click', () => {
    done();
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (typeof tabId === 'string') win.webContents.send('notify:click', tabId); }
  });
  n.on('close', done);
  n.show();
  return true;
});
handle('app:focus', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});
// Windows-Konsolenprogramme (ping, dir …) schreiben in der OEM-Codepage 850 statt UTF-8. Ist der Text kein
// gültiges UTF-8, wird er als CP850 gelesen, damit Umlaute stimmen.
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';
function decodeConsole(buf) {
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  let out = '';
  for (const b of buf) out += b < 0x80 ? String.fromCharCode(b) : CP850[b - 0x80];
  return out;
}
// Ausgabe einer Hintergrund-Aufgabe lesen – nur *.output-Dateien, die Claude Code in seinem eigenen
// Temp-Ordner (%TEMP%\claude\…\tasks\) anlegt; höchstens die letzten 64 KB
handle('task:readOutput', (_e, file) => {
  if (typeof file !== 'string' || isUnc(file) || !file.toLowerCase().endsWith('.output')) return { error: tr('Keine Ausgabedatei', 'Not an output file') };
  if (!seenOutputs.has(path.resolve(file).toLowerCase())) return { error: tr('Pfad nicht erlaubt', 'Path not allowed') };
  let p, st;
  try {
    // Junctions/Symlinks auflösen (auch 8.3-Kurznamen), danach erneut prüfen; Hardlinks ablehnen
    const base = fs.realpathSync.native(path.join(os.tmpdir(), 'claude')).toLowerCase() + path.sep;
    p = fs.realpathSync.native(file);
    st = fs.lstatSync(p);
    if (!p.toLowerCase().startsWith(base) || path.basename(path.dirname(p)).toLowerCase() !== 'tasks' || !st.isFile() || st.nlink !== 1) return { error: tr('Pfad nicht erlaubt', 'Path not allowed') };
  } catch { return { error: tr('Ausgabe nicht (mehr) vorhanden', 'Output no longer available') }; }
  try {
    const size = st.size, max = 64 * 1024;
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size, max));
      fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - max));
      return { text: decodeConsole(buf), truncated: size > max, size };
    } finally { fs.closeSync(fd); }
  } catch { return { error: tr('Ausgabe nicht (mehr) vorhanden', 'Output no longer available') }; }
});
// Text in die Zwischenablage (Kopieren-Knöpfe) – nur Schreiben, höchstens 5 MB; Lesen gibt es nicht
handle('clipboard:write', (_e, text) => { if (typeof text !== 'string') return false; clipboard.writeText(text.slice(0, 5 * 1024 * 1024)); return true; });
handle('app:attention', () => { if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true); });
handle('shell:openPath', (_e, p) => {
  if (!isDir(p)) { logError('openPath abgelehnt (kein Ordner): ' + String(p).slice(0, 200)); return false; }
  // Testlauf (nur unverpackt): Prüfung wie sonst, aber kein Explorer-Fenster öffnen
  if (!(DEV && process.env.SWAPLINE_TEST_JS)) shell.openPath(p);
  return true;
});

// Diktieren: startet die Windows-Spracheingabe (Windows + H) im fokussierten Eingabefeld von Swapline.
// Fester Befehl ohne Eingaben von außen; drückt nur die Tastenkombination, liest und speichert nichts.
const DICTATE_PS = '$s=\'using System;using System.Runtime.InteropServices;public static class K{[DllImport("user32.dll")]public static extern void keybd_event(byte v,byte s,uint f,UIntPtr e);}\';'
  + 'Add-Type -TypeDefinition $s;$z=[UIntPtr]::Zero;[K]::keybd_event(0x5B,0,0,$z);[K]::keybd_event(0x48,0,0,$z);[K]::keybd_event(0x48,0,2,$z);[K]::keybd_event(0x5B,0,2,$z)';
handle('dictation:start', () => new Promise(resolve => {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return resolve(false);
  if (DEV && process.env.SWAPLINE_TEST_JS) return resolve(true); // Testlauf: keine Tasten drücken
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let p;
  try { p = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DICTATE_PS], { windowsHide: true, stdio: 'ignore' }); }
  catch (e) { logError('Diktieren: ' + e.message); return resolve(false); }
  const timer = setTimeout(() => { try { p.kill(); } catch {} resolve(false); }, 15000);
  p.on('error', e => { clearTimeout(timer); logError('Diktieren: ' + e.message); resolve(false); });
  p.on('close', code => { clearTimeout(timer); if (code) logError('Diktieren: PowerShell beendet mit Code ' + code); resolve(code === 0); });
}));

// Externe Links nur über https in den Standard-Browser
function openExternalSafe(url) {
  let u;
  try { u = new URL(url); } catch { logError('Link abgelehnt (ungültig): ' + String(url).slice(0, 200)); return false; }
  if (u.protocol !== 'https:') { logError('Link abgelehnt (nur https erlaubt): ' + u.protocol); return false; }
  shell.openExternal(u.href);
  return true;
}

// ---------- Fernzugriff (Swapline ↔ Swapline, siehe src/remote.js) ----------
// Haupt-PC: nimmt Verbindungen gekoppelter Geräte an und führt deren Anfragen mit denselben Prüfungen aus wie
// lokale Eingaben – aber nur Chat-Kanäle; Konten, Projekte, Plugins und Einstellungen des Haupt-PCs bleiben
// unverändert. Gerät: bleibt mit jedem gekoppelten Haupt-PC im Hintergrund verbunden; dessen Chats laufen in der
// Oberfläche neben den eigenen, ihre Anfragen gehen über remote:call an genau diesen Haupt-PC.
const remote = require('./remote');
let remoteHost = null;
const remoteTabs = new Map(); // interne Tab-ID auf dem Haupt-PC -> { deviceId, tabId } (Chats von Geräten)

// --- Offene Chats des Haupt-PCs: Geräte sehen sie und können live beitreten ---
// Die eigene Oberfläche meldet ihre offenen Chats (tabs:publish). Ein Gerät, das einem davon beitritt, bekommt alle
// Ereignisse dieses Chats und schreibt in denselben Claude-Prozess – kein zweiter Prozess auf derselben Sitzung.
let openTabs = [];                 // [{ id, title, profileId, cwd, sessionId, model, effort, permissionMode, running, updated, preview }]
const attachedTo = new Map();      // Tab-ID am Haupt-PC -> Map(Geräte-ID -> Set(Tab-IDs am Gerät))
const attachOf = new Map();        // Geräte-ID + ':' + Tab am Gerät -> Tab-ID am Haupt-PC
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
function cleanOpenTab(t) {
  if (!t || typeof t.id !== 'string' || !/^[a-z0-9]{6,40}$/i.test(t.id) || !profileById(t.profileId)) return null;
  return {
    id: t.id, title: str(t.title, 200), profileId: t.profileId, cwd: isDir(t.cwd) ? t.cwd : '', sessionId: UUID_RE.test(t.sessionId || '') ? t.sessionId : null,
    model: isModel(t.model || '') ? t.model || '' : '', effort: EFFORTS.includes(t.effort || '') ? t.effort || '' : '', permissionMode: MODES.includes(t.permissionMode) ? t.permissionMode : 'default',
    running: !!t.running, updated: Number(t.updated) || 0, preview: str(t.preview, 200),
  };
}
function openTabsFor(dev) {
  return openTabs.filter(t => profileAllowed(dev, t.profileId) && (!contentLimited(dev) || (t.sessionId ? sessionAllowed(dev, t.profileId, t.sessionId) : folderAllowed(dev, t.cwd))));
}
function pushOpenTabs() { for (const d of getDevices()) if (remoteHost?.connected(d.id)) remoteHost.push(d.id, 'tabs', openTabsFor(d)); }
handle('tabs:publish', (e, list) => {
  if (e?.remote || !Array.isArray(list)) return false; // nur die eigene Oberfläche
  openTabs = list.slice(0, 200).map(cleanOpenTab).filter(Boolean);
  pushOpenTabs();
  return true;
});
function attach(dev, devTab, hostTab) {
  const key = dev.id + ':' + devTab;
  const prev = attachOf.get(key);
  if (prev && prev !== hostTab) detach(dev.id, devTab);
  attachOf.set(key, hostTab);
  if (!attachedTo.has(hostTab)) attachedTo.set(hostTab, new Map());
  const m = attachedTo.get(hostTab);
  if (!m.has(dev.id)) m.set(dev.id, new Set());
  m.get(dev.id).add(devTab);
}
function detach(devId, devTab) {
  const key = devId + ':' + devTab, hostTab = attachOf.get(key);
  attachOf.delete(key);
  const m = hostTab && attachedTo.get(hostTab);
  if (!m) return;
  m.get(devId)?.delete(devTab);
  if (!m.get(devId)?.size) m.delete(devId);
  if (!m.size) attachedTo.delete(hostTab);
}
function detachDevice(devId) { for (const k of [...attachOf.keys()]) if (k.startsWith(devId + ':')) detach(devId, k.slice(devId.length + 1)); }
// Ereignis eines Haupt-PC-Chats an beigetretene Geräte (außer an den Absender, der es schon anzeigt)
function pushAttached(hostTab, msg, except) {
  const m = attachedTo.get(hostTab);
  if (!m || !remoteHost) return;
  for (const [devId, set] of m) for (const devTab of set) if (except !== devId + ':' + devTab) remoteHost.push(devId, 'claude', { tabId: devTab, msg });
}
// Nachricht für die Anzeige auf den anderen Ansichten: Text und Bilder (Bilder nur als Platzhalter)
function userEcho(content) {
  if (typeof content === 'string') return { text: content.slice(0, 20000), images: 0 };
  const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n').slice(0, 20000);
  return { text, images: content.filter(b => b.type === 'image').length };
}
async function sendAttached(dev, t, content) {
  const ht = openTabsFor(dev).find(x => x.id === t.hostTab);
  if (!ht) throw new Error(tr('Dieser Chat ist am Haupt-PC nicht mehr offen oder nicht freigegeben', 'This chat is no longer open on the host PC or not shared'));
  if (typeof t.id !== 'string' || !/^[a-z0-9]{6,23}$/i.test(t.id) || !validContent(content)) return false;
  attach(dev, t.id, ht.id);
  const ok = await H.get('session:send')({ remote: dev }, { tab: { id: ht.id, profileId: ht.profileId, cwd: ht.cwd, sessionId: sessions.get(ht.id)?.tab.sessionId || ht.sessionId, model: ht.model, effort: ht.effort, permissionMode: ht.permissionMode }, content });
  if (ok) {
    const echo = { type: 'swapline_user', content: userEcho(content), from: dev.name };
    if (win && !win.isDestroyed()) win.webContents.send('claude:event', { tabId: ht.id, msg: echo });
    pushAttached(ht.id, echo, dev.id + ':' + t.id);
  }
  return ok;
}

// --- Haupt-PC ---
const getDevices = () => getStore().remoteHost?.devices || [];
const saveDevices = list => updateStore(s => { (s.remoteHost ||= { enabled: false, port: remote.DEFAULT_PORT }).devices = list; });
const encryptSecret = str => safeStorage.encryptString(str).toString('base64');
const decryptSecret = b64 => safeStorage.decryptString(Buffer.from(b64, 'base64'));
function allowedFolders() {
  const s = getStore(), seen = new Set(), out = [];
  for (const p of [...(s.knownFolders || []), ...s.projects.map(x => x.cwd), ...s.favorites.map(x => x.path)]) {
    if (!p || seen.has(folderKey(p)) || !isDir(p)) continue;
    seen.add(folderKey(p)); out.push(p);
    if (out.length >= 300) break;
  }
  return out;
}
// Was ein Gerät vom Haupt-PC sieht: keine Konfigurationsordner, keine Gerätelisten; Auswahl (Konto, Projekt,
// Modell …) je Gerät getrennt, damit das Gerät die Ansicht am Haupt-PC nicht verstellt
function remoteStoreFor(dev) {
  const s = getStore(), v = dev.view || {}, limited = contentLimited(dev);
  const profiles = s.profiles.filter(p => profileAllowed(dev, p.id)).map(({ configDir, ...p }) => p);
  const projects = limited ? s.projects.filter(p => scopeOf(dev).projects.includes(p.id)) : s.projects;
  return {
    profiles,
    activeProfileId: profiles.some(p => p.id === v.activeProfileId) ? v.activeProfileId : profiles.some(p => p.id === s.activeProfileId) ? s.activeProfileId : profiles[0]?.id || null,
    favorites: limited ? [] : s.favorites, projects,
    projectGroups: s.projectGroups.filter(g => projects.some(p => p.groupId === g.id)),
    activeProjectId: v.activeProjectId && (v.activeProjectId === 'all' || projects.some(p => p.id === v.activeProjectId)) ? v.activeProjectId : 'all',
    scope: { limited, accountsLimited: scopeOf(dev).profiles !== null, newChats: !limited || projectFolders(dev).length > 0 },
    usage: s.usage,
    settings: { model: v.model ?? s.settings.model ?? '', effort: v.effort ?? s.settings.effort ?? '', permissionMode: v.permissionMode ?? s.settings.permissionMode ?? 'default' },
    allowedFolders: limited ? projectFolders(dev) : allowedFolders(), hostName: os.hostname().slice(0, 40), hostVersion: app.getVersion(), allowBypass: !!dev.allowBypass, canEditProjects: !!dev.allowProjects,
    reach: { addresses: reachAddresses(), port: remoteHost?.port || null, relay: relayReach() },
  };
}
const setView = (dev, patch) => saveDevices(getDevices().map(d => (d.id === dev.id ? { ...d, view: { ...d.view, ...patch } } : d)));
function hostTabId(dev, id) {
  if (typeof id !== 'string' || !/^[a-z0-9]{6,23}$/i.test(id)) return null; // mit Präfix höchstens 40 Zeichen (validTab)
  const h = 'r' + dev.id + id;
  remoteTabs.set(h, { deviceId: dev.id, tabId: id });
  return h;
}
const notAllowed = () => { throw new Error(tr('Auf dem Haupt-PC nicht erlaubt (nur Chats)', 'Not allowed on the host PC (chats only)')); };
const notShared = () => { throw new Error(tr('Für dieses Gerät nicht freigegeben', 'Not shared with this device')); };

// Freigabe je Gerät: { profiles: null | [Konto-IDs], projects: null | [Projekt-IDs], chats: [Session-IDs] }.
// profiles null = alle Konten. projects null = alle Inhalte; sonst nur Chats in den Ordnern der gewählten Projekte
// (auch Unterordner) und die einzeln freigegebenen Chats – neue Chats nur in den Projektordnern.
// Durchgesetzt wird hier bei jeder Anfrage, nicht nur in der Anzeige.
const scopeOf = dev => ({ profiles: null, projects: null, chats: [], ...(dev.scope || {}) });
const contentLimited = dev => scopeOf(dev).projects !== null;
const deviceLimited = dev => { const sc = scopeOf(dev); return sc.profiles !== null || sc.projects !== null; };
const profileAllowed = (dev, id) => !!profileById(id) && (scopeOf(dev).profiles === null || scopeOf(dev).profiles.includes(id));
const projectFolders = dev => getStore().projects.filter(p => p.cwd && scopeOf(dev).projects?.includes(p.id)).map(p => p.cwd);
function folderAllowed(dev, cwd) {
  if (!contentLimited(dev)) return true;
  if (typeof cwd !== 'string' || !cwd) return false;
  const k = folderKey(cwd);
  return projectFolders(dev).some(f => k === folderKey(f) || k.startsWith(folderKey(f) + path.sep));
}
const historyAllowed = (dev, h) => !contentLimited(dev) || scopeOf(dev).chats.includes(h.sessionId) || folderAllowed(dev, h.cwd);
// Arbeitsordner einer gespeicherten Sitzung (erste cwd-Angabe in der Sitzungsdatei)
function sessionCwd(profile, sessionId) {
  const file = findSessionFile(profile, sessionId);
  if (!file) return null;
  for (const line of readHead(file).split('\n')) {
    if (!line.includes('"cwd"')) continue;
    try { const o = JSON.parse(line); if (typeof o.cwd === 'string') return o.cwd; } catch {}
  }
  return '';
}
function sessionAllowed(dev, profileId, sessionId) {
  if (!profileAllowed(dev, profileId)) return false;
  if (!contentLimited(dev)) return true;
  if (scopeOf(dev).chats.includes(sessionId)) return true;
  const cwd = sessionCwd(profileById(profileId), sessionId);
  return cwd !== null && folderAllowed(dev, cwd);
}
function cleanScope(sc) {
  if (!sc || typeof sc !== 'object') return null;
  const st = getStore();
  const ids = (list, valid) => (list === null ? null : Array.isArray(list) ? [...new Set(list.filter(x => typeof x === 'string' && valid(x)))].slice(0, 500) : undefined);
  const profiles = ids(sc.profiles, id => st.profiles.some(p => p.id === id));
  const projects = ids(sc.projects, id => st.projects.some(p => p.id === id));
  const chats = ids(sc.chats ?? [], id => UUID_RE.test(id));
  if (profiles === undefined || projects === undefined || !chats) return null;
  return { profiles, projects, chats };
}
// Projekte und Ordner des Haupt-PCs vom Gerät aus anlegen oder ändern – nur mit Gerätefreigabe „Projekte anlegen“.
// Projektordner nur aus den für das Gerät freigegebenen Ordnern; Löschen bleibt dem Haupt-PC vorbehalten; die
// Auswahl am Haupt-PC (aktives Projekt) bleibt unverändert.
function hostProjectEdit(dev, ch, a) {
  if (!dev.allowProjects) notAllowed();
  a = a && typeof a === 'object' ? a : {};
  const folders = contentLimited(dev) ? projectFolders(dev) : allowedFolders();
  const okFolder = cwd => typeof cwd === 'string' && (cwd === '' || folders.some(f => folderKey(f) === folderKey(cwd)));
  const visible = id => remoteStoreFor(dev).projects.some(p => p.id === id);
  if (ch === 'projects:add') {
    if (!okFolder(a.cwd || '') || (contentLimited(dev) && !a.cwd)) notShared();
    let newId = null;
    updateStore(st => {
      if (st.projects.length >= PROJECTS_MAX) return;
      newId = 'p-' + crypto.randomBytes(4).toString('hex');
      const pr = { id: newId, name: cleanName(a.name, 'Projekt') || 'Projekt', color: cleanColor(a.color, '#1581FF'), cwd: a.cwd || '' };
      if (validGroup(st, a.groupId)) pr.groupId = a.groupId;
      st.projects.push(pr);
    });
    // eingeschränktes Gerät: neues Projekt gleich in seine Freigabe aufnehmen, sonst sähe es das Projekt nicht
    if (newId && contentLimited(dev)) saveDevices(getDevices().map(d => (d.id === dev.id ? { ...d, scope: { ...scopeOf(d), projects: [...scopeOf(d).projects, newId] } } : d)));
  } else if (ch === 'projects:update') {
    const patch = a.patch && typeof a.patch === 'object' ? a.patch : {};
    if (!visible(a.id)) notShared();
    if ('cwd' in patch && (!okFolder(patch.cwd) || (contentLimited(dev) && !patch.cwd))) notShared();
    updateStore(st => {
      const p = st.projects.find(x => x.id === a.id); if (!p) return;
      if ('name' in patch) p.name = cleanName(patch.name, p.name) || p.name;
      if ('color' in patch) p.color = cleanColor(patch.color, p.color);
      if ('cwd' in patch) p.cwd = patch.cwd;
      if ('groupId' in patch) { if (validGroup(st, patch.groupId)) p.groupId = patch.groupId; else delete p.groupId; }
    });
  } else if (ch === 'projects:groupAdd') {
    updateStore(st => { if (st.projectGroups.length < 50) st.projectGroups.push({ id: 'g-' + crypto.randomBytes(4).toString('hex'), name: cleanName(a.name, 'Ordner') || 'Ordner', color: cleanColor(a.color, '#64748B') }); });
  } else if (ch === 'projects:groupUpdate') {
    const patch = a.patch && typeof a.patch === 'object' ? a.patch : {};
    updateStore(st => { const g = st.projectGroups.find(x => x.id === a.id); if (!g) return; if ('name' in patch) g.name = cleanName(patch.name, g.name) || g.name; if ('color' in patch) g.color = cleanColor(patch.color, g.color); });
  }
  if (win && !win.isDestroyed()) win.webContents.send('store:changed'); // eigene Oberfläche zeigt die Änderung
  const out = remoteStoreFor(getDevices().find(d => d.id === dev.id) || dev);
  // leere Ordner sind beim Gerät sonst unsichtbar (es sieht nur Ordner mit sichtbaren Projekten) – beim Bearbeiten alle zeigen
  return { ...out, projectGroups: getStore().projectGroups };
}
// Dateien von Geräten (z. B. Dokumente vom Handy): landen in einem eigenen Ordner je Datei unter
// %TEMP%\swapline-uploads – nie in Projektordnern. Claude bekommt den Pfad (wie bei Anhängen am PC).
// Nur der Dateiname zählt (Pfadanteile, Steuer- und reservierte Zeichen fallen weg), höchstens 25 MB; ältere Uploads
// (> 7 Tage) räumt Swapline selbst weg.
const UPLOAD_MAX = 25 * 1024 * 1024;
const uploadRoot = () => path.join(os.tmpdir(), 'swapline-uploads');
function uploadName(name) {
  let n = String(name || '').split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 120);
  if (!n || /^\.+$/.test(n)) n = 'datei';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(n)) n = '_' + n;
  return n;
}
function cleanUploads() {
  const root = uploadRoot();
  let dirs; try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const p = path.join(root, d.name);
    try { if (Date.now() - fs.statSync(p).mtimeMs > 7 * 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
}
function receiveUpload(dev, a) {
  const data = a?.data;
  if (typeof data !== 'string' || data.length > Math.ceil(UPLOAD_MAX / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error(tr('Datei ungültig oder zu groß (höchstens 25 MB)', 'File invalid or too large (max. 25 MB)'));
  const buf = Buffer.from(data, 'base64');
  if (buf.length > UPLOAD_MAX) throw new Error(tr('Datei zu groß (höchstens 25 MB)', 'File too large (max. 25 MB)'));
  const name = uploadName(a?.name);
  cleanUploads();
  const dir = path.join(uploadRoot(), new Date().toISOString().slice(0, 10) + '-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf, { flag: 'wx' });
  logError(`Fernzugriff: Datei von Gerät „${dev.name}“ empfangen: ${name} (${buf.length} Bytes)`);
  return { path: file, name, size: buf.length };
}

async function hostDispatch(dev, ch, args) {
  const e = { remote: dev };
  const call = (c, ...a) => H.get(c)(e, ...a);
  const a0 = args[0];
  switch (ch) {
    case 'store:get': return remoteStoreFor(dev);
    case 'projects:add': case 'projects:update': case 'projects:groupAdd': case 'projects:groupUpdate': return hostProjectEdit(dev, ch, a0);
    case 'profiles:setActive': if (profileAllowed(dev, a0)) setView(dev, { activeProfileId: a0 }); return remoteStoreFor(dev);
    case 'projects:setActive': if (a0 === 'all' || remoteStoreFor(dev).projects.some(p => p.id === a0)) setView(dev, { activeProjectId: a0 }); return remoteStoreFor(dev);
    case 'settings:set': {
      const patch = a0 && typeof a0 === 'object' ? a0 : {}, ok = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'model' && isModel(v)) ok.model = v;
        else if (k === 'effort' && EFFORTS.includes(v)) ok.effort = v;
        else if (k === 'permissionMode' && MODES.includes(v) && (v !== 'bypassPermissions' || dev.allowBypass)) ok.permissionMode = v;
        else notAllowed();
      }
      setView(dev, ok);
      return remoteStoreFor(getDevices().find(d => d.id === dev.id) || dev);
    }
    case 'profiles:status': case 'ext:list': if (!profileAllowed(dev, a0)) notShared(); return call(ch, ...args);
    case 'profiles:models': if (!profileAllowed(dev, a0?.id)) notShared(); return call(ch, ...args);
    case 'history:list': if (!profileAllowed(dev, a0)) notShared(); return (await call(ch, ...args)).filter(h => historyAllowed(dev, h));
    case 'history:search': if (!profileAllowed(dev, a0?.profileId)) notShared(); return (await call(ch, ...args)).filter(h => historyAllowed(dev, h));
    case 'history:loadSession': if (!sessionAllowed(dev, a0?.profileId, a0?.sessionId)) notShared(); return call(ch, ...args);
    case 'task:readOutput': {
      // eingeschränkte Geräte: nur Ausgaben aus ihren eigenen Chats
      const key = typeof a0 === 'string' ? path.resolve(a0).toLowerCase() : '';
      if (deviceLimited(dev) && ![...remoteTabs].some(([k, v]) => v.deviceId === dev.id && sessions.get(k)?.outputs.has(key))) notShared();
      return call(ch, ...args);
    }
    case 'tabs:list': return openTabsFor(dev);
    case 'session:attach': {
      const ht = openTabsFor(dev).find(x => x.id === a0?.hostTab);
      if (!ht || typeof a0?.tabId !== 'string' || !/^[a-z0-9]{6,23}$/i.test(a0.tabId)) return false;
      attach(dev, a0.tabId, ht.id);
      return { running: !!sessions.get(ht.id)?.busy };
    }
    // Nach einer Unterbrechung: offene Rückfragen eines Chats des Geräts (eigener oder beigetretener Chat) – sie stehen
    // nicht in der Sitzungsdatei. Antwort im Format der CLI-Nachricht, damit das Gerät sie wie live anzeigen kann.
    case 'files:upload': return receiveUpload(dev, a0);
    case 'session:pending': {
      if (typeof a0?.tabId !== 'string' || !/^[a-z0-9]{6,23}$/i.test(a0.tabId)) return false;
      const own = 'r' + dev.id + a0.tabId;
      const id = attachOf.get(dev.id + ':' + a0.tabId) || (remoteTabs.has(own) ? own : null);
      const s = id && sessions.get(id);
      if (!s) return { running: false, requests: [] };
      return {
        running: !!s.busy,
        requests: [...s.pending].slice(0, 20).map(([rid, p]) => ({ type: 'control_request', request_id: rid,
          request: { subtype: 'can_use_tool', tool_name: p.toolName, input: p.input, permission_suggestions: p.suggestions, description: p.description || '' } })),
      };
    }
    case 'session:send': {
      const t = a0?.tab || {};
      if (typeof t.hostTab === 'string') return sendAttached(dev, t, a0.content);
      if (!profileAllowed(dev, t.profileId)) notShared();
      if (contentLimited(dev)) {
        if (t.sessionId) {
          if (!sessionAllowed(dev, t.profileId, t.sessionId)) notShared();
          const cwd = sessionCwd(profileById(t.profileId), t.sessionId);
          if (cwd && (t.cwd || '') && folderKey(cwd) !== folderKey(t.cwd)) notShared(); // fortgesetzter Chat bleibt in seinem Ordner
        } else if (!folderAllowed(dev, t.cwd)) notShared(); // neue Chats nur in freigegebenen Projektordnern
      }
      const id = hostTabId(dev, t.id);
      return id ? call(ch, { ...a0, tab: { ...t, id } }) : false;
    }
    // „!“-Befehle laufen ohne Rückfrage – deshalb nur für Geräte mit der Freigabe „Alles erlauben“
    case 'session:bash': {
      if (!dev.allowBypass) throw new Error(tr('„!“-Befehle sind für dieses Gerät nicht freigegeben – am Haupt-PC in der Geräteliste „Alles erlauben“ einschalten.', '“!” commands are not allowed for this device – turn on “Allow everything” for it in the device list on the host PC.'));
      const t = a0?.tab || {};
      if (typeof t.hostTab === 'string') {
        const ht = openTabsFor(dev).find(x => x.id === t.hostTab);
        if (!ht || typeof t.id !== 'string' || !/^[a-z0-9]{6,23}$/i.test(t.id)) return false;
        attach(dev, t.id, ht.id);
        return call(ch, { tab: { id: ht.id, profileId: ht.profileId, cwd: ht.cwd, sessionId: null, model: '', effort: '', permissionMode: 'default' }, command: a0.command });
      }
      if (!profileAllowed(dev, t.profileId)) notShared();
      if (contentLimited(dev) && !folderAllowed(dev, t.cwd)) notShared();
      const id = hostTabId(dev, t.id);
      return id ? call(ch, { tab: { ...t, id, sessionId: null, permissionMode: 'default' }, command: a0.command }) : false;
    }
    case 'session:bashStop': { const id = attachOf.get(dev.id + ':' + a0) || hostTabId(dev, a0); return id ? call(ch, id) : false; }
    case 'session:respond': { const id = attachOf.get(dev.id + ':' + a0?.tabId) || hostTabId(dev, a0?.tabId); return id ? call(ch, { ...a0, tabId: id }) : false; }
    case 'session:interrupt': { const id = attachOf.get(dev.id + ':' + a0) || hostTabId(dev, a0); return id ? call(ch, id) : false; }
    case 'session:restart': { if (attachOf.has(dev.id + ':' + a0)) return false; const id = hostTabId(dev, a0); return id ? call(ch, id) : false; } // Einstellungen eines Haupt-PC-Chats ändert nur der Haupt-PC
    case 'session:confirmBypass': { if (attachOf.has(dev.id + ':' + a0)) return !!dev.allowBypass; const id = hostTabId(dev, a0); return id ? call(ch, id) : false; }
    case 'session:close': {
      if (attachOf.has(dev.id + ':' + a0)) { detach(dev.id, a0); return true; } // nur austreten – der Chat läuft am Haupt-PC weiter
      const id = hostTabId(dev, a0); if (!id) return false; const r = call(ch, id); remoteTabs.delete(id); return r;
    }
    default: return notAllowed();
  }
}
async function confirmPairing({ name, address }) {
  if (DEV && process.env.SWAPLINE_TEST_AUTOPAIR === '1') return true; // nur Testlauf aus dem Quellcode
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: [tr('Abbrechen', 'Cancel'), tr('Koppeln', 'Pair')], defaultId: 0, cancelId: 0, noLink: true,
    title: tr('Gerät koppeln', 'Pair device'),
    message: tr(`Gerät „${name}“ koppeln?`, `Pair device “${name}”?`, `“${name}” cihazı eşleştirilsin mi?`),
    detail: tr(`Adresse: ${address}\n\nDas Gerät kann danach alle Chats und Konten dieses PCs nutzen, Claude hier Befehle ausführen lassen und – solange in der Geräteliste erlaubt – „Alles erlauben“ verwenden. Nur eigene Geräte koppeln.`,
      `Address: ${address}\n\nThe device can then use all chats and accounts of this PC, let Claude run commands here and – as long as allowed in the device list – use “Allow everything”. Only pair your own devices.`,
      `Adres: ${address}\n\nCihaz bundan sonra bu bilgisayarın tüm sohbetlerini ve hesaplarını kullanabilir, Claude'a burada komut çalıştırtabilir ve – cihaz listesinde izin verildiği sürece – “Her şeye izin ver” seçeneğini kullanabilir. Yalnızca kendi cihazlarınızı eşleştirin.`),
  });
  return r.response === 1;
}
// --- Vermittler (relay/relay.js): Erreichbarkeit ohne Portfreigabe ---
// Einstellungen: remoteHost.relay = { enabled, address, port, secretEnc, hostId, dialKeyEnc }. hostId und dialKey erzeugt
// Swapline selbst; den dialKey bekommen nur gekoppelte Geräte (über die verschlüsselte Verbindung oder den QR-Code).
const relayLinkMod = require('./relay-link');
let relayLink = null;
const RELAY_DEFAULT_PORT = 47821;
function relayCfg() {
  const r = getStore().remoteHost?.relay;
  if (!r?.enabled || !r.address || !r.secretEnc || !r.hostId || !r.dialKeyEnc) return null;
  try { return { address: r.address, port: r.port || RELAY_DEFAULT_PORT, secret: decryptSecret(r.secretEnc), hostId: r.hostId, dialKey: decryptSecret(r.dialKeyEnc) }; }
  catch { return null; }
}
function applyRelay() {
  relayLink ||= relayLinkMod.createRelayLink({
    onSocket: (s, from) => (remoteHost?.running ? remoteHost.adopt(s, from) : s.destroy()),
    onStatus: () => pushRemoteStatus(),
    log: logError,
  });
  relayLink.use(remoteHost?.running ? relayCfg() : null);
}
// Für Geräte: wie sie den PC über den Vermittler erreichen (nur wenn eingerichtet)
function relayReach() {
  const c = relayCfg();
  return c ? { address: c.address, port: c.port, hostId: c.hostId, dialKey: c.dialKey } : null;
}

async function startRemoteHost() {
  const cfg = getStore().remoteHost || {};
  if (!safeStorage.isEncryptionAvailable()) throw new Error(tr('Verschlüsselter Speicher nicht verfügbar', 'Encrypted storage not available'));
  remoteHost ||= remote.createHost({
    getDevices, saveDevices, encrypt: encryptSecret, decrypt: decryptSecret, confirmPair: confirmPairing,
    dispatch: hostDispatch, log: logError, onChange: pushRemoteStatus,
  });
  // Testlauf: nur auf diesem Rechner lauschen (keine Firewall-Abfrage)
  const bind = DEV && process.env.SWAPLINE_TEST_JS ? '127.0.0.1' : '0.0.0.0';
  await remoteHost.start(cfg.port || remote.DEFAULT_PORT, bind);
  applyRelay();
}

// --- Gerät ---
const remoteHosts = () => getStore().remoteHosts || [];
const clients = new Map(); // Haupt-PC-ID -> Verbindung (je gekoppeltem Haupt-PC eine)
// Kanäle, die die Oberfläche für Chats eines Haupt-PCs aufrufen darf (der Haupt-PC prüft zusätzlich selbst)
const REMOTE_CALLS = new Set(['store:get', 'profiles:status', 'profiles:models', 'history:list', 'history:loadSession', 'history:search', 'tabs:list', 'session:attach', 'session:pending', 'files:upload',
  'session:send', 'session:bash', 'session:bashStop', 'session:respond', 'session:interrupt', 'session:restart', 'session:close', 'session:confirmBypass', 'task:readOutput',
  'projects:add', 'projects:update', 'projects:groupAdd', 'projects:groupUpdate', 'projects:remove', 'projects:groupRemove']);
const REMOTE_FALLBACK = { 'store:get': null, 'tabs:list': [], 'session:attach': false, 'history:list': [], 'history:loadSession': [], 'history:search': [], 'task:readOutput': { error: 'offline' }, 'profiles:status': { loggedIn: false }, 'profiles:models': null };
function connectHost(h) {
  clients.get(h.id)?.use(null);
  const c = remote.createClient({
    onEvent: (kind, data) => {
      if (!win || win.isDestroyed()) return;
      if (kind === 'claude' && typeof data?.tabId === 'string' && data.msg && typeof data.msg === 'object') win.webContents.send('claude:event', { tabId: data.tabId, msg: data.msg, host: h.id });
      else if (kind === 'tabs' && Array.isArray(data)) win.webContents.send('remote:tabs', { host: h.id, list: data.slice(0, 200) });
      else if (kind === 'store-changed') win.webContents.send('remote:storeChanged', { host: h.id });
    },
    onStatus: () => pushRemoteStatus(),
    log: logError,
  });
  clients.set(h.id, c);
  try { c.use(hostTarget(h)); }
  catch (e) { logError('Fernzugriff: ' + e.message); }
}
// Wege zu einem gekoppelten Haupt-PC: Adressen (durch Komma getrennt gespeichert) und ggf. der Vermittler
function hostTarget(h) {
  let relay = null;
  if (h.relay && h.relayKeyEnc) { try { relay = { address: h.relay.address, port: h.relay.port, hostId: h.relay.hostId, dialKey: decryptSecret(h.relayKeyEnc) }; } catch {} }
  return { id: h.id, addresses: String(h.address || '').split(',').map(a => a.trim()).filter(Boolean), port: h.port, deviceId: h.deviceId, key: Buffer.from(decryptSecret(h.keyEnc), 'base64'), relay };
}
// Der Haupt-PC meldet mit store:get, wie er erreichbar ist (Adressen, Vermittler) – für die nächste Verbindung merken.
// Eine selbst eingetragene Adresse (z. B. DynDNS-Name) bleibt vorn.
function learnReach(id, reach) {
  const h = remoteHosts().find(x => x.id === id);
  if (!h || !reach) return;
  const addresses = [...new Set([...(h.manual ? [h.manual] : []), ...reach.addresses])].slice(0, 8);
  const address = addresses.length ? addresses.join(',') : h.address;
  let oldKey = null;
  try { oldKey = h.relayKeyEnc ? decryptSecret(h.relayKeyEnc) : null; } catch {}
  const r = reach.relay;
  const sameRelay = r ? !!h.relay && h.relay.address === r.address && h.relay.port === r.port && h.relay.hostId === r.hostId && oldKey === r.dialKey : !h.relay;
  if (address === h.address && sameRelay) return;
  updateStore(s => {
    const x = (s.remoteHosts || []).find(y => y.id === id);
    if (!x) return;
    x.address = address;
    if (r) { x.relay = { address: r.address, port: r.port, hostId: r.hostId }; if (!sameRelay) x.relayKeyEnc = encryptSecret(r.dialKey); }
    else { delete x.relay; delete x.relayKeyEnc; }
  });
  clients.get(id)?.setRoutes({ addresses: address.split(','), relay: r ? { address: r.address, port: r.port, hostId: r.hostId, dialKey: r.dialKey } : null });
  pushRemoteStatus();
}
// Stand eines Haupt-PCs für die Oberfläche: Namen, Bilder und Pfade werden wie lokale Eingaben geprüft
function cleanHostStore(r) {
  if (!r || typeof r !== 'object') return null;
  const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    profiles: (r.profiles || []).map(p => ({ id: str(p.id, 80), name: cleanName(p.name, '?'), color: cleanColor(p.color, '#1581FF'), isDefault: !!p.isDefault })),
    activeProfileId: str(r.activeProfileId, 80),
    projects: (r.projects || []).map(p => ({ id: str(p.id, 80), name: cleanName(p.name, '?'), color: cleanColor(p.color, '#1581FF'), cwd: str(p.cwd), ...(cleanIcon(p.icon) ? { icon: cleanIcon(p.icon) } : {}), ...(typeof p.groupId === 'string' ? { groupId: str(p.groupId, 80) } : {}) })),
    projectGroups: (r.projectGroups || []).map(g => ({ id: str(g.id, 80), name: cleanName(g.name, '?'), color: cleanColor(g.color, '#64748B') })),
    favorites: (r.favorites || []).filter(f => typeof f?.path === 'string').map(f => ({ path: str(f.path), name: cleanName(f.name, '?') })),
    allowedFolders: (r.allowedFolders || []).filter(x => typeof x === 'string').map(x => x.slice(0, 500)).slice(0, 300),
    settings: { model: isModel(r.settings?.model || '') ? r.settings?.model || '' : '', effort: EFFORTS.includes(r.settings?.effort || '') ? r.settings?.effort || '' : '', permissionMode: MODES.includes(r.settings?.permissionMode) ? r.settings.permissionMode : 'default' },
    scope: { limited: !!r.scope?.limited, accountsLimited: !!r.scope?.accountsLimited, newChats: r.scope?.newChats !== false },
    hostName: cleanName(r.hostName, ''), hostVersion: str(r.hostVersion, 40), allowBypass: !!r.allowBypass, canEditProjects: !!r.canEditProjects, canRemoveProjects: !!r.canRemoveProjects,
    // Erreichbarkeit (Adressen, Vermittler) – nur gültige Werte
    reach: {
      addresses: (Array.isArray(r.reach?.addresses) ? r.reach.addresses : []).filter(validAddress).slice(0, 8),
      relay: r.reach?.relay && validAddress(r.reach.relay.address) && Number.isInteger(r.reach.relay.port) && /^[0-9a-f]{16}$/.test(r.reach.relay.hostId) && /^[0-9a-f]{64}$/.test(r.reach.relay.dialKey)
        ? { address: r.reach.relay.address, port: r.reach.relay.port, hostId: r.reach.relay.hostId, dialKey: r.reach.relay.dialKey } : null,
    },
  };
}
handle('remote:call', async (_e, hostId, ch, args) => {
  if (typeof hostId === 'string' && hostId.startsWith('ssh:')) {
    const srv = sshServers().find(x => 'ssh:' + x.id === hostId);
    if (!srv || !REMOTE_CALLS.has(ch) || !Array.isArray(args)) return ch in REMOTE_FALLBACK ? REMOTE_FALLBACK[ch] : false;
    try { const v = await sshDispatch(srv, ch, args); if ((ch === 'store:get' || ch.startsWith('projects:')) && v && typeof v === 'object' && !v.error) { const clean = cleanHostStore(v); delete clean.reach; return clean; } return v; }
    catch (err) { if (ch.startsWith('projects:')) return { error: err.message }; throw err; }
  }
  const c = clients.get(hostId);
  if (!c || !REMOTE_CALLS.has(ch) || !Array.isArray(args)) return ch in REMOTE_FALLBACK ? REMOTE_FALLBACK[ch] : false;
  // „Alles erlauben“ zuerst auf diesem Gerät bestätigen (einmalig, wie lokal) – der Haupt-PC prüft die Gerätefreigabe
  if (ch === 'session:confirmBypass' && !confirmBypass()) return false;
  if (ch === 'session:send' && args[0]?.tab?.permissionMode === 'bypassPermissions' && !confirmBypass()) return false;
  try {
    const v = await c.call(ch, args);
    if (ch !== 'store:get' && !ch.startsWith('projects:')) return v;
    const clean = cleanHostStore(v);
    if (ch === 'store:get' && clean) { learnReach(hostId, clean.reach); delete clean.reach; } // Schlüssel des Vermittlers bleibt im Hauptprozess
    return clean;
  } catch (err) {
    if (ch === 'session:send' && typeof args[0]?.tab?.id === 'string') {
      win?.webContents.send('claude:event', { tabId: args[0].tab.id, msg: { type: 'app_error', message: tr('Haupt-PC: ', 'Host PC: ') + err.message } });
      return false;
    }
    return ch in REMOTE_FALLBACK ? REMOTE_FALLBACK[ch] : false;
  }
});

// --- Status und Einstellungen ---
function remoteInfo() {
  const cfg = getStore().remoteHost || {};
  if (remoteHost?.running) refreshPublic();
  return {
    available: safeStorage.isEncryptionAvailable(),
    host: {
      enabled: !!cfg.enabled, port: cfg.port || remote.DEFAULT_PORT, running: !!remoteHost?.running, listenPort: remoteHost?.port || null,
      pairingExpires: remoteHost?.pairingExpires || null, addresses: remote.localAddresses(), hostName: os.hostname().slice(0, 40),
      publicAddress: publicAt ? { address: publicAddr?.address || null, found: !!publicAddr } : null,
      relay: { enabled: !!cfg.relay?.enabled, address: cfg.relay?.address || '', port: cfg.relay?.port || RELAY_DEFAULT_PORT, hasSecret: !!cfg.relay?.secretEnc,
        state: relayLink?.state || 'off', detail: relayLink?.detail || '' },
      devices: getDevices().map(d => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen, lastAddress: d.lastAddress, allowBypass: !!d.allowBypass, allowProjects: !!d.allowProjects, scope: scopeOf(d), connected: !!remoteHost?.connected(d.id) })),
    },
    hosts: [
      ...remoteHosts().map(h => ({ id: h.id, kind: 'swapline', name: h.name, address: String(h.address || '').split(',')[0], port: h.port, relay: !!h.relay, via: clients.get(h.id)?.via || '', color: h.color || '#475569', ...(h.icon ? { icon: h.icon } : {}), state: clients.get(h.id)?.state || 'off' })),
      ...sshServers().map(x => ({ id: 'ssh:' + x.id, kind: 'ssh', name: x.name, address: x.user + '@' + x.host, port: x.port, color: x.color || '#0EA5E9', folders: x.folders, state: sshState.get(x.id)?.state || 'off', error: sshState.get(x.id)?.error || '' })),
    ],
    sshAvailable: fs.existsSync(SSH_EXE),
  };
}
function pushRemoteStatus() { if (win && !win.isDestroyed()) win.webContents.send('remote:status', remoteInfo()); }
const validPort = p => Number.isInteger(p) && p >= 1024 && p <= 65535;
// Adresse eines Haupt-PCs: IPv4/IPv6 oder Rechnername (z. B. Tailscale-Name, DynDNS) – keine Pfade, keine Ports darin
const validAddress = a => typeof a === 'string' && a.length <= 253 && !isUnc(a) && (require('node:net').isIP(a) > 0 || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(a));

handle('remote:info', () => remoteInfo());
// Einrichtungscode aus der App „Swapline Relay“: srelay1.<base64url(JSON {a: Adresse, p: Port, s: Kennwort})>
handle('remote:relayCode', (e, code) => {
  let c = null;
  try { if (typeof code === 'string' && code.length < 1000 && code.trim().startsWith('srelay1.')) c = JSON.parse(Buffer.from(code.trim().slice(8), 'base64url').toString('utf8')); } catch {}
  if (!c || typeof c.a !== 'string' || !Number.isInteger(c.p) || typeof c.s !== 'string') return { ...remoteInfo(), error: tr('Ungültiger Einrichtungscode', 'Invalid setup code') };
  return H.get('remote:relaySet')(e, { enabled: true, address: c.a, port: c.p, secret: c.s });
});
// Vermittler einrichten: Adresse und Port prüfen, Kennwort nur verschlüsselt speichern (leer = bisheriges behalten)
handle('remote:relaySet', (_e, { enabled, address, port, secret } = {}) => {
  const bad = () => ({ ...remoteInfo(), error: tr('Ungültige Eingabe', 'Invalid input') });
  if (typeof enabled !== 'boolean') return bad();
  const addr = typeof address === 'string' ? address.trim() : '';
  if (addr && !validAddress(addr)) return { ...remoteInfo(), error: tr('Ungültige Adresse', 'Invalid address') };
  if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535)) return bad();
  if (secret !== undefined && secret !== '' && (typeof secret !== 'string' || secret.length < 32 || secret.length > 200 || !/^[\x21-\x7e]+$/.test(secret)))
    return { ...remoteInfo(), error: tr('Kennwort: mindestens 32 Zeichen, ohne Leerzeichen', 'Password: at least 32 characters, no spaces') };
  updateStore(s => {
    const h = (s.remoteHost ||= { enabled: false, port: remote.DEFAULT_PORT, devices: [] });
    const r = (h.relay ||= {});
    r.enabled = enabled;
    r.address = addr;
    r.port = port || r.port || RELAY_DEFAULT_PORT;
    if (secret) r.secretEnc = encryptSecret(secret);
    r.hostId ||= crypto.randomBytes(8).toString('hex');
    r.dialKeyEnc ||= encryptSecret(crypto.randomBytes(32).toString('hex'));
  });
  if (enabled && !relayCfg()) { applyRelay(); return { ...remoteInfo(), error: tr('Adresse und Kennwort des Vermittlers angeben', 'Enter the relay address and password') }; }
  applyRelay();
  pushRemoteStatus();
  return remoteInfo();
});
handle('remote:hostSet', async (_e, { enabled, port } = {}) => {
  if (typeof enabled !== 'boolean' || (port !== undefined && !validPort(port))) return { ...remoteInfo(), error: tr('Ungültige Eingabe', 'Invalid input') };
  updateStore(s => { s.remoteHost = { ...(s.remoteHost || { devices: [] }), enabled, port: port || s.remoteHost?.port || remote.DEFAULT_PORT }; });
  remoteHost?.stop();
  relayLink?.use(null);
  let error;
  if (enabled) { try { await startRemoteHost(); } catch (err) { error = err.code === 'EADDRINUSE' ? tr('Port ist belegt', 'Port is in use') : err.message; logError('Fernzugriff: ' + err.message); } }
  pushRemoteStatus();
  return { ...remoteInfo(), error };
});
// QR-Code zum Koppeln mit der Swapline-App auf dem Handy: swapline://pair?v=1&a=<Adressen>&p=<Port>&c=<Code>&n=<Name>.
// Adressen im Heimnetz zuerst, Tailscale danach, virtuelle Adapter (WSL, Hyper-V …) zuletzt – das Handy probiert sie der Reihe nach.
// Adressen, unter denen Geräte diesen PC erreichen: Heimnetz zuerst, dann Tailscale, dann die öffentliche Adresse
// (nur mit Portfreigabe am Router), virtuelle Adapter (WSL, Hyper-V, Radmin …) zuletzt – Geräte probieren der Reihe nach.
const VIRTUAL_NIC = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Docker|Radmin|Hamachi|ZeroTier/i;
function reachAddresses() {
  const rank = a => (VIRTUAL_NIC.test(a.name) ? 3 : a.tailscale ? 1 : 0);
  const list = remote.localAddresses().map(a => ({ address: a.address, rank: rank(a) }));
  if (publicAddr?.address) list.push({ address: publicAddr.address, rank: 2 });
  return list.sort((x, y) => x.rank - y.rank).map(a => a.address).slice(0, 6);
}
// Öffentliche IPv4 vom Router (UPnP, nur im eigenen Netz; siehe src/upnp.js) – höchstens alle 10 Minuten
let publicAddr = null, publicAt = 0, publicBusy = false;
function refreshPublic(force) {
  if (publicBusy || (DEV && process.env.SWAPLINE_TEST_JS) || (!force && Date.now() - publicAt < 10 * 60 * 1000)) return;
  publicBusy = true;
  require('./upnp').externalAddress().then(r => { publicAddr = r; }, () => { publicAddr = null; })
    .finally(() => { publicBusy = false; publicAt = Date.now(); pushRemoteStatus(); });
}
// Kopplungslink: steckt im QR-Code (Handy) und lässt sich für einen anderen PC kopieren
function pairLink(code) {
  const addrs = reachAddresses();
  const rr = relayReach(); // Vermittler: Koppeln auch von unterwegs
  return 'swapline://pair?v=1&a=' + addrs.join(',') + '&p=' + remoteHost.port + '&c=' + code.replace(/-/g, '') + '&n=' + encodeURIComponent(os.hostname().slice(0, 40))
    + (rr ? '&r=' + encodeURIComponent(rr.address + ':' + rr.port) + '&h=' + rr.hostId + '&k=' + rr.dialKey : '');
}
function pairQr(url) {
  const q = require('qrcode-generator')(0, 'M');
  q.addData(url);
  q.make();
  return 'data:image/svg+xml;base64,' + Buffer.from(q.createSvgTag({ cellSize: 6, margin: 4, scalable: true })).toString('base64');
}
handle('remote:pairStart', () => {
  if (!remoteHost?.running) return { error: tr('Fernzugriff ist aus', 'Remote access is off') };
  const p = remoteHost.startPairing();
  const link = pairLink(p.code);
  return { ...p, link, qr: pairQr(link) };
});
handle('remote:pairCancel', () => { remoteHost?.cancelPairing(); return true; });
handle('remote:deviceSet', (_e, { id, allowBypass, allowProjects, scope } = {}) => {
  if (!getDevices().some(d => d.id === id)) return remoteInfo();
  const patch = {};
  if (allowBypass !== undefined) { if (typeof allowBypass !== 'boolean') return { ...remoteInfo(), error: tr('Ungültige Eingabe', 'Invalid input') }; patch.allowBypass = allowBypass; }
  if (allowProjects !== undefined) { if (typeof allowProjects !== 'boolean') return { ...remoteInfo(), error: tr('Ungültige Eingabe', 'Invalid input') }; patch.allowProjects = allowProjects; }
  if (scope !== undefined) { const sc = cleanScope(scope); if (!sc) return { ...remoteInfo(), error: tr('Ungültige Eingabe', 'Invalid input') }; patch.scope = sc; }
  saveDevices(getDevices().map(d => (d.id === id ? { ...d, ...patch } : d)));
  // Freigabe verkleinert: laufende Chats des Geräts beenden, die nicht mehr freigegeben sind
  const dev = getDevices().find(d => d.id === id);
  for (const [k, v] of remoteTabs) {
    const sess = sessions.get(k);
    if (v.deviceId !== id || !sess) continue;
    const t = sess.tab;
    const ok = profileAllowed(dev, t.profileId) && (!contentLimited(dev) || (t.sessionId ? sessionAllowed(dev, t.profileId, t.sessionId) : folderAllowed(dev, t.cwd)));
    if (!ok) { stopSession(k); remoteTabs.delete(k); }
  }
  for (const [k, hostTab] of [...attachOf]) if (k.startsWith(id + ':') && !openTabsFor(dev).some(t => t.id === hostTab)) detach(id, k.slice(id.length + 1));
  pushOpenTabs();
  return remoteInfo();
});
handle('remote:deviceRemove', (_e, id) => {
  if (!getDevices().some(d => d.id === id)) return remoteInfo();
  saveDevices(getDevices().filter(d => d.id !== id));
  remoteHost?.disconnect(id);
  detachDevice(id);
  for (const [k, v] of remoteTabs) if (v.deviceId === id) { stopSession(k); remoteTabs.delete(k); }
  logError(`Fernzugriff: Gerät ${id} entfernt`);
  return remoteInfo();
});
// Kopplungslink (wie im QR-Code): swapline://pair?v=1&a=<Adressen>&p=<Port>&c=<Code>&n=<Name>[&r=<Vermittler:Port>&h=<hostId>&k=<dialKey>]
function parsePairLink(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length > 1000 || !t.startsWith('swapline://pair?')) return null;
  const q = new URLSearchParams(t.slice('swapline://pair?'.length));
  if (q.get('v') !== '1') return null;
  const addresses = (q.get('a') || '').split(',').map(a => a.trim()).filter(Boolean).slice(0, 6);
  const port = Number(q.get('p'));
  const code = (q.get('c') || '').toUpperCase();
  if (!addresses.length || !addresses.every(validAddress) || !validPort(port) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(code)) return null;
  let relay = null;
  const r = q.get('r') || '', i = r.lastIndexOf(':');
  const ra = r.slice(0, i), rp = Number(r.slice(i + 1)), h = q.get('h') || '', k = q.get('k') || '';
  if (i > 0 && validAddress(ra) && Number.isInteger(rp) && rp >= 1 && rp <= 65535 && /^[0-9a-f]{16}$/.test(h) && /^[0-9a-f]{64}$/.test(k)) relay = { address: ra, port: rp, hostId: h, dialKey: k };
  return { addresses, port, code, name: cleanName(q.get('n') || '', ''), relay };
}
handle('remote:pair', async (_e, { address, port, code, link } = {}) => {
  let t;
  if (typeof link === 'string' && link.trim()) {
    const l = parsePairLink(link);
    if (!l) return { ...remoteInfo(), error: tr('Kopplungslink ungültig', 'Invalid pairing link') };
    t = { addresses: l.addresses, port: l.port, code: l.code, relay: l.relay, manual: null };
  } else {
    address = typeof address === 'string' ? address.trim() : '';
    if (!validAddress(address) || !validPort(port) || typeof code !== 'string' || code.length > 64) return { ...remoteInfo(), error: tr('Adresse, Port oder Code ungültig', 'Invalid address, port or code') };
    t = { addresses: [address], port, code, relay: null, manual: address };
  }
  if (!safeStorage.isEncryptionAvailable()) return { ...remoteInfo(), error: tr('Verschlüsselter Speicher nicht verfügbar', 'Encrypted storage not available') };
  try {
    const r = await remote.pair({ addresses: t.addresses, port: t.port, code: t.code, relay: t.relay, name: os.hostname().slice(0, 40) });
    const label = t.addresses[0];
    const host = { id: r.deviceId, name: cleanName(r.hostName, label) || label, address: t.addresses.join(','), port: t.port, deviceId: r.deviceId, keyEnc: encryptSecret(r.key),
      ...(t.manual ? { manual: t.manual } : {}),
      ...(t.relay ? { relay: { address: t.relay.address, port: t.relay.port, hostId: t.relay.hostId }, relayKeyEnc: encryptSecret(t.relay.dialKey) } : {}) };
    // derselbe Haupt-PC schon gekoppelt (gleiche erste Adresse und Port oder gleiche Kennung beim Vermittler): ersetzen
    const same = h => (h.port === t.port && String(h.address || '').split(',')[0] === label) || (!!t.relay && h.relay?.hostId === t.relay.hostId);
    for (const old of remoteHosts().filter(same)) { clients.get(old.id)?.use(null); clients.delete(old.id); }
    updateStore(s => { s.remoteHosts = [...(s.remoteHosts || []).filter(h => !same(h)), host]; });
    connectHost(host);
    logError(`Fernzugriff: mit Haupt-PC ${label}:${t.port} gekoppelt${r.via === 'relay' ? ' (über Vermittler)' : ''}`);
    return { ...remoteInfo(), paired: r.deviceId };
  } catch (err) {
    const msg = { code: tr('Code ungültig', 'Invalid code'), denied: tr('Am Haupt-PC abgelehnt', 'Declined on the host PC'), closed: tr('Code falsch oder abgelaufen', 'Code wrong or expired'), timeout: tr('Zeitüberschreitung', 'Timed out') }[err.message]
      || ({ ECONNREFUSED: tr('Keine Verbindung – Fernzugriff am Haupt-PC an?', 'No connection – is remote access on at the host PC?'), ETIMEDOUT: tr('Zeitüberschreitung', 'Timed out'), ENOTFOUND: tr('Adresse nicht gefunden', 'Address not found'),
        EHOSTOFFLINE: tr('Haupt-PC ist nicht beim Vermittler angemeldet', 'Host PC is not signed in at the relay'), ERELAY: tr('Vermittler hat abgelehnt', 'Relay declined') }[err.code])
      // Gegenstelle spricht kein TLS – meist die Adresse des Vermittlers statt des Haupt-PCs
      || (/WRONG_VERSION_NUMBER|EPROTO/.test(String(err.code)) ? tr('Unter dieser Adresse antwortet kein Swapline-Haupt-PC – vermutlich der Vermittler. Für den Weg über den Vermittler am Haupt-PC „Kopplungslink kopieren“ und den Link hier einfügen.', 'No Swapline host PC answers at this address – probably the relay. To connect via the relay, choose “Copy pairing link” on the host PC and paste the link here.') : null)
      || tr('Code falsch oder abgelaufen', 'Code wrong or expired');
    return { ...remoteInfo(), error: msg };
  }
});
// Name, Farbe und Bild eines Haupt-PCs in der Leiste (nur Anzeige auf diesem PC)
handle('remote:hostUpdate', (_e, { id, name, color, icon } = {}) => {
  updateStore(s => {
    const h = (s.remoteHosts || []).find(x => x.id === id);
    if (!h) return;
    if (name !== undefined) h.name = cleanName(name, h.name) || h.name;
    if (color !== undefined) h.color = cleanColor(color, h.color || '#475569');
    if (icon !== undefined) { if (cleanIcon(icon)) h.icon = cleanIcon(icon); else delete h.icon; }
  });
  pushRemoteStatus();
  return remoteInfo();
});
handle('remote:hostRemove', (_e, id) => {
  clients.get(id)?.use(null);
  clients.delete(id);
  updateStore(s => { s.remoteHosts = (s.remoteHosts || []).filter(h => h.id !== id); });
  pushRemoteStatus();
  return remoteInfo();
});

function initRemote() {
  const s = getStore();
  if ('remoteTarget' in s) updateStore(x => { delete x.remoteTarget; }); // bis 0.3.0: ganze Oberfläche umgeschaltet
  if (safeStorage.isEncryptionAvailable()) for (const h of remoteHosts()) connectHost(h);
  for (const srv of sshServers()) checkServer(srv);
  if (s.remoteHost?.enabled) startRemoteHost().catch(e => logError('Fernzugriff: ' + e.message));
}

// ---------- Server per SSH (z. B. ein VPS mit Claude Code) ----------
// Swapline startet Claude Code auf dem Server über den SSH-Client von Windows – im selben Chat-Modus wie lokal.
// Anmeldung am Server nur per SSH-Schlüssel (BatchMode, keine Passwortabfrage); Swapline speichert keine Schlüssel
// oder Passwörter. Claude meldet man auf dem Server selbst an (claude auth login, z. B. über „Terminal öffnen“).
// Alle Werte, die in den Befehl auf dem Server gelangen, sind geprüft oder in einfache Anführungszeichen gesetzt.
const SSH_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
const shq = v => "'" + String(v).replace(/'/g, "'\\''") + "'";
const sshServers = () => getStore().sshServers || [];
const COLORS_SERVER = ['#0EA5E9', '#22C55E', '#F97316', '#7C5CFF', '#E5007E', '#EAB308'];
const sshState = new Map(); // Server-ID -> { state: 'connected' | 'error' | 'checking', error }
const validSshUser = u => typeof u === 'string' && /^[a-z_][a-z0-9_.-]{0,31}$/i.test(u);
const validServerPath = p => typeof p === 'string' && p.length <= 400 && /^\/[^\0\n\r]*$/.test(p);
function sshArgs(srv, cmd, tty = false) {
  return [tty ? '-t' : '-T', '-p', String(srv.port || 22), '-o', 'BatchMode=' + (tty ? 'no' : 'yes'), '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=30', '-o', 'ConnectTimeout=15', '--', `${srv.user}@${srv.host}`, cmd];
}
const SERVER_PATH = 'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"; ';
function claudeOnServer(args, cwd) { return SERVER_PATH + 'cd ' + (cwd ? shq(cwd) : '"$HOME"') + ' && exec claude ' + args.map(shq).join(' '); }
function spawnSsh(srv, cmd) {
  if (!fs.existsSync(SSH_EXE)) throw new Error(tr('SSH-Client von Windows fehlt (Einstellungen → Apps → Optionale Features → OpenSSH-Client)', 'Windows SSH client missing (Settings → Apps → Optional features → OpenSSH Client)'));
  return spawn(SSH_EXE, sshArgs(srv, cmd), { windowsHide: true });
}
function sshRun(srv, cmd, timeout = 30000, max = 60 * 1024 * 1024) {
  return new Promise(resolve => {
    let p; try { p = spawnSsh(srv, cmd); } catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, timeout);
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', d => { out += d; if (out.length > max) { try { p.kill(); } catch {} } });
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
const sshError = r => (r.err || '').trim().split('\n').filter(Boolean).pop()?.slice(0, 300) || tr('Keine Verbindung', 'No connection');
async function checkServer(srv) {
  sshState.set(srv.id, { state: 'checking' }); pushRemoteStatus();
  const r = await sshRun(srv, SERVER_PATH + 'claude --version', 25000);
  sshState.set(srv.id, r.code === 0 ? { state: 'connected', version: r.out.trim().slice(0, 60) } : { state: 'error', error: r.code === 127 || /not found/.test(r.err) ? tr('Claude Code ist auf dem Server nicht installiert', 'Claude Code is not installed on the server') : sshError(r) });
  pushRemoteStatus();
}
// Verlauf auf dem Server: neueste Sitzungsdateien mit Kopf und Ende (nur lesen)
const SERVER_HISTORY = 'd="$HOME/.claude/projects"; [ -d "$d" ] || exit 0; ls -t "$d"/*/*.jsonl 2>/dev/null | head -n 150 | while IFS= read -r f; do printf \'\\036%s\\t%s\\n\' "$(stat -c %Y "$f" 2>/dev/null || echo 0)" "$f"; head -c 16384 "$f"; printf \'\\n\'; tail -c 16384 "$f"; printf \'\\n\'; done';
async function serverHistory(srv) {
  const r = await sshRun(srv, SERVER_HISTORY, 45000, 20 * 1024 * 1024);
  if (r.code !== 0) return [];
  const untitled = tr('(ohne Titel)', '(untitled)');
  return r.out.split('\x1e').slice(1).map(block => {
    const nl = block.indexOf('\n'), [mtime, file] = block.slice(0, nl).split('\t');
    const sessionId = (file || '').split('/').pop().replace(/\.jsonl$/, '');
    if (!UUID_RE.test(sessionId)) return null;
    const { title, cwd, firstPrompt } = parseSessionHead(block.slice(nl + 1));
    return { sessionId, mtime: Number(mtime) * 1000 || 0, cwd, title: title || firstPrompt.slice(0, 80) || untitled };
  }).filter(Boolean);
}
const serverTab = (srv, t) => {
  if (!t || typeof t.id !== 'string' || !/^[a-z0-9]{6,40}$/i.test(t.id)) return null;
  if (t.sessionId != null && !UUID_RE.test(t.sessionId)) return null;
  if (!isModel(t.model || '') || !EFFORTS.includes(t.effort || '') || !MODES.includes(t.permissionMode || 'default')) return null;
  if (t.cwd && !serverFolders(srv).includes(t.cwd)) return null; // nur eingetragene Server-Ordner und Projektordner (oder Home)
  return { id: t.id, profileId: 'server', cwd: t.cwd || '', sessionId: t.sessionId || null, model: t.model || '', effort: t.effort || '', permissionMode: t.permissionMode || 'default', ssh: srv };
};
// Projekte eines Servers: früher nur die eingetragenen Ordner – beim ersten Zugriff werden daraus Projekte
const serverProjects = srv => srv.projects || (srv.folders || []).map((f, i) => ({ id: 'f' + i, name: f.split('/').filter(Boolean).pop() || f, color: COLORS_SERVER[i % COLORS_SERVER.length], cwd: f }));
const serverFolders = srv => [...new Set([...(srv.folders || []), ...serverProjects(srv).map(p => p.cwd).filter(Boolean)])];
function serverStore(srv) {
  return {
    profiles: [{ id: 'server', name: srv.name, color: srv.color || '#0EA5E9' }], activeProfileId: 'server', favorites: [],
    projects: serverProjects(srv), projectGroups: srv.projectGroups || [],
    allowedFolders: serverFolders(srv), settings: { model: '', effort: '', permissionMode: 'default' }, scope: { limited: false, accountsLimited: false, newChats: true },
    hostName: srv.name, hostVersion: sshState.get(srv.id)?.version || '', allowBypass: true, canEditProjects: true, canRemoveProjects: true,
  };
}
// Eigener Server: Projekte und Ordner frei anlegen, ändern, entfernen (entfernt nur den Eintrag, nicht den Ordner auf dem Server).
// Auf Wunsch legt Swapline den Projektordner auf dem Server an (mkdir -p, Pfad geprüft und in Anführungszeichen).
async function serverProjectEdit(srv, ch, a) {
  a = a && typeof a === 'object' ? a : {};
  const groups = srv.projectGroups || [];
  const okGroup = id => typeof id === 'string' && groups.some(g => g.id === id);
  const save = fn => updateStore(s => { const x = s.sshServers.find(y => y.id === srv.id); if (!x) return; x.projects ||= serverProjects(x); x.projectGroups ||= []; fn(x); x.folders = serverFolders(x); });
  if (ch === 'projects:add' || ch === 'projects:update') {
    const patch = ch === 'projects:add' ? a : (a.patch && typeof a.patch === 'object' ? a.patch : {});
    if ('cwd' in patch && patch.cwd !== '' && !validServerPath(patch.cwd)) return false;
    if (patch.mkdir && patch.cwd) {
      const r = await sshRun(srv, 'mkdir -p -- ' + shq(patch.cwd), 25000);
      if (r.code !== 0) throw new Error(tr('Ordner konnte auf dem Server nicht angelegt werden: ', 'Could not create the folder on the server: ') + sshError(r));
    }
    save(x => {
      if (ch === 'projects:add') {
        if (x.projects.length >= 100) return;
        x.projects.push({ id: 'p-' + crypto.randomBytes(4).toString('hex'), name: cleanName(patch.name, 'Projekt') || 'Projekt', color: cleanColor(patch.color, '#0EA5E9'), cwd: patch.cwd || '', ...(okGroup(patch.groupId) ? { groupId: patch.groupId } : {}) });
        return;
      }
      const p = x.projects.find(y => y.id === a.id); if (!p) return;
      if ('name' in patch) p.name = cleanName(patch.name, p.name) || p.name;
      if ('color' in patch) p.color = cleanColor(patch.color, p.color);
      if ('cwd' in patch) p.cwd = patch.cwd;
      if ('groupId' in patch) { if (okGroup(patch.groupId)) p.groupId = patch.groupId; else delete p.groupId; }
    });
  } else if (ch === 'projects:remove') {
    save(x => { x.projects = x.projects.filter(p => p.id !== a.id); x.folders = (x.folders || []).filter(f => x.projects.some(p => p.cwd === f)); });
  } else if (ch === 'projects:groupAdd') {
    save(x => { if (x.projectGroups.length < 50) x.projectGroups.push({ id: 'g-' + crypto.randomBytes(4).toString('hex'), name: cleanName(a.name, 'Ordner') || 'Ordner', color: cleanColor(a.color, '#64748B') }); });
  } else if (ch === 'projects:groupUpdate') {
    const patch = a.patch && typeof a.patch === 'object' ? a.patch : {};
    save(x => { const g = x.projectGroups.find(y => y.id === a.id); if (!g) return; if ('name' in patch) g.name = cleanName(patch.name, g.name) || g.name; if ('color' in patch) g.color = cleanColor(patch.color, g.color); });
  } else if (ch === 'projects:groupRemove') {
    save(x => { x.projectGroups = x.projectGroups.filter(g => g.id !== a.id); for (const p of x.projects) if (p.groupId === a.id) delete p.groupId; });
  }
  pushRemoteStatus();
  return serverStore(sshServers().find(x => x.id === srv.id) || srv);
}
async function sshDispatch(srv, ch, args) {
  const a0 = args[0];
  switch (ch) {
    case 'store:get': return serverStore(srv);
    case 'projects:add': case 'projects:update': case 'projects:remove': case 'projects:groupAdd': case 'projects:groupUpdate': case 'projects:groupRemove':
      return serverProjectEdit(srv, ch, a0);
    case 'profiles:status': {
      const r = await sshRun(srv, SERVER_PATH + 'claude auth status --json', 25000);
      try { return JSON.parse(r.out); } catch { return { loggedIn: false, error: sshError(r) }; }
    }
    case 'profiles:models': return null;
    case 'history:list': return serverHistory(srv);
    case 'history:search': {
      const q = String(a0?.query || '').slice(0, 200);
      if (q.length < 2) return [];
      const r = await sshRun(srv, 'grep -rlis -F --include=*.jsonl -- ' + shq(q) + ' "$HOME/.claude/projects" 2>/dev/null | head -n 60', 45000);
      const hit = new Set(r.out.split('\n').map(f => f.split('/').pop().replace(/\.jsonl$/, '')));
      return (await serverHistory(srv)).filter(h => hit.has(h.sessionId)).map(h => ({ ...h, hits: 1, snippet: '', when: h.mtime }));
    }
    case 'history:loadSession': {
      if (!UUID_RE.test(a0?.sessionId || '')) return [];
      const r = await sshRun(srv, 'cat "$HOME"/.claude/projects/*/' + a0.sessionId + '.jsonl 2>/dev/null | head -c 50000000', 60000);
      return transcriptFromText(r.out);
    }
    case 'session:send': {
      const tab = serverTab(srv, a0?.tab);
      if (!tab || !validContent(a0?.content)) return false;
      if (tab.permissionMode === 'bypassPermissions' && !confirmBypass()) return false;
      let sess = sessions.get(tab.id);
      if (!sess) { try { sess = startSession(tab); } catch (e) { send(tab.id, { type: 'app_error', message: e.message }); return false; } }
      sess.busy = true;
      writeTo(tab.id, { type: 'user', message: { role: 'user', content: a0.content } });
      return true;
    }
    case 'session:respond': case 'session:interrupt': case 'session:restart': case 'session:close':
      if (!sessions.get(typeof a0 === 'string' ? a0 : a0?.tabId)?.tab.ssh && ch !== 'session:close' && ch !== 'session:restart') return false;
      return H.get(ch)({}, ...args);
    case 'session:confirmBypass': return confirmBypass();
    case 'task:readOutput': return { error: tr('Auf Servern nicht verfügbar', 'Not available on servers') };
    case 'tabs:list': return [];
    case 'session:attach': return false;
    default: return false;
  }
}
// Fehler beim Start eines Server-Chats (z. B. SSH-Schlüssel fehlt) verständlich melden
function serverExitMessage(stderr) {
  if (/Permission denied/i.test(stderr)) return tr('SSH: Anmeldung abgelehnt – ist dein SSH-Schlüssel auf dem Server eingetragen?', 'SSH: login refused – is your SSH key authorized on the server?');
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) return tr('SSH: Server-Schlüssel hat sich geändert – Verbindung abgebrochen (Sicherheit).', 'SSH: the server key has changed – connection aborted (security).');
  if (/command not found|claude: not found/i.test(stderr)) return tr('Claude Code ist auf dem Server nicht installiert oder nicht im PATH.', 'Claude Code is not installed on the server or not in PATH.');
  return null;
}

handle('ssh:add', (_e, { name, user, host, port, folders } = {}) => {
  port = port === undefined || port === '' ? 22 : Number(port);
  folders = Array.isArray(folders) ? folders.map(f => String(f).trim()).filter(Boolean) : [];
  if (!validSshUser(user) || !validAddress(String(host || '').trim()) || !Number.isInteger(port) || port < 1 || port > 65535 || folders.length > 50 || !folders.every(validServerPath))
    return { ...remoteInfo(), error: tr('Benutzer, Adresse, Port oder Ordner ungültig (Ordner als /absoluter/pfad)', 'Invalid user, address, port or folder (folders as /absolute/path)') };
  const srv = { id: 's' + crypto.randomBytes(4).toString('hex'), name: cleanName(name, '') || String(host).trim(), user, host: String(host).trim(), port, folders };
  updateStore(s => { s.sshServers = [...(s.sshServers || []), srv]; });
  checkServer(srv);
  return remoteInfo();
});
handle('ssh:update', (_e, { id, folders, name, color } = {}) => {
  const srv = sshServers().find(x => x.id === id);
  if (!srv) return remoteInfo();
  if (folders !== undefined) {
    folders = Array.isArray(folders) ? folders.map(f => String(f).trim()).filter(Boolean) : null;
    if (!folders || folders.length > 50 || !folders.every(validServerPath)) return { ...remoteInfo(), error: tr('Ordner ungültig (als /absoluter/pfad)', 'Invalid folder (as /absolute/path)') };
  }
  updateStore(s => { const x = s.sshServers.find(y => y.id === id); if (folders) x.folders = folders; if (name !== undefined) x.name = cleanName(name, x.name) || x.name; if (color !== undefined) x.color = cleanColor(color, x.color || '#0EA5E9'); });
  pushRemoteStatus();
  return remoteInfo();
});
handle('ssh:remove', (_e, id) => {
  for (const [k, v] of sessions) if (v.tab.ssh?.id === id) stopSession(k);
  updateStore(s => { s.sshServers = (s.sshServers || []).filter(x => x.id !== id); });
  sshState.delete(id);
  pushRemoteStatus();
  return remoteInfo();
});
handle('ssh:test', (_e, id) => { const srv = sshServers().find(x => x.id === id); if (srv) checkServer(srv); return true; });
// Sichtbares Terminal mit SSH zum Server (z. B. für „claude auth login“) – Eingaben macht der Nutzer selbst
handle('ssh:terminal', (_e, { id, login } = {}) => {
  const srv = sshServers().find(x => x.id === id);
  if (!srv || !fs.existsSync(SSH_EXE)) return false;
  const cmd = SERVER_PATH + (login ? 'claude auth login; ' : '') + 'exec "${SHELL:-/bin/sh}" -l';
  spawn(SSH_EXE, sshArgs(srv, cmd, true), { detached: true, windowsHide: false, stdio: 'ignore' }).unref();
  return true;
});

// ---------- Automatische Updates (nur die installierte App) ----------
// Prüft beim Start und alle 6 Stunden die GitHub-Releases von ARFEP-IT-Service/Swapline (latest.yml).
// Standard „Nur benachrichtigen“: zeigt „Version X verfügbar“, geladen und installiert wird erst auf Klick.
// „Automatisch“: lädt im Hintergrund und installiert beim Neustart. „Aus“: prüft nur über „Jetzt prüfen“.
// Das ist die einzige Netzverbindung, die Swapline selbst aufbaut (alles andere macht claude.exe).
// Die ZIP-Variante und der Entwicklungsmodus aktualisieren sich nicht selbst.
const UPDATE_SUPPORTED = app.isPackaged && process.platform === 'win32' && fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Swapline.exe'));
const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
let updater = null, updateState = { status: 'idle' }, userDownloaded = false; // userDownloaded: Update auf Klick geladen
const updateMode = () => getStore().settings.updateMode;
function applyUpdateMode() {
  if (!updater) return;
  const auto = updateMode() === 'auto';
  updater.autoDownload = auto;
  // Ein geladenes Update wird beim nächsten Beenden installiert (ohne Neustart), wenn der Nutzer es geladen hat
  updater.autoInstallOnAppQuit = auto || userDownloaded;
}
function setUpdateState(st) { updateState = st; if (win && !win.isDestroyed()) win.webContents.send('update:status', { ...st, supported: UPDATE_SUPPORTED }); }
function initUpdater() {
  if (!UPDATE_SUPPORTED) return null;
  if (updater) return updater;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { logError('Updater: ' + e.message); return null; }
  applyUpdateMode();
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.logger = null;
  updater.on('checking-for-update', () => { if (updateState.status !== 'ready') setUpdateState({ status: 'checking' }); });
  updater.on('update-available', i => setUpdateState(updater.autoDownload ? { status: 'downloading', version: i.version, percent: 0 } : { status: 'available', version: i.version }));
  updater.on('update-not-available', () => setUpdateState({ status: 'latest', checked: Date.now() }));
  updater.on('download-progress', p => setUpdateState({ status: 'downloading', version: updateState.version, percent: Math.round(p.percent || 0) }));
  // Geladen: nie selbst neu starten – die Oberfläche fragt „Jetzt neu starten / Später“
  updater.on('update-downloaded', i => setUpdateState({ status: 'ready', version: i.version }));
  updater.on('error', e => {
    logError('Updater: ' + (e?.stack || e));
    if (updateState.status !== 'ready') setUpdateState({ status: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200) });
  });
  return updater;
}
function checkForUpdates(manual = false) {
  if (!manual && updateMode() === 'off') return false;
  if (['ready', 'downloading', 'available'].includes(updateState.status)) return true;
  const u = initUpdater();
  if (!u) return false;
  u.checkForUpdates().catch(() => {}); // Fehler kommen über das 'error'-Ereignis
  return true;
}
handle('update:state', () => ({ ...updateState, supported: UPDATE_SUPPORTED }));
handle('update:check', () => checkForUpdates(true));
// Laden auf Klick („Herunterladen“). Danach fragt die Oberfläche, ob jetzt neu gestartet werden soll;
// ohne Neustart wird das Update beim nächsten Beenden installiert.
handle('update:download', () => {
  if (!updater || updateState.status !== 'available') return false;
  userDownloaded = true;
  applyUpdateMode();
  setUpdateState({ status: 'downloading', version: updateState.version, percent: 0 });
  updater.downloadUpdate().catch(() => {}); // Fehler kommen über das 'error'-Ereignis
  return true;
});
// Neu starten und installieren – nur auf ausdrücklichen Klick; läuft noch eine Antwort, fragt das Schließen-Fenster nach
handle('update:install', () => {
  if (!updater || updateState.status !== 'ready') return false;
  setImmediate(() => updater.quitAndInstall(true, true));
  return true;
});

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
  // Schließen, während Claude noch arbeitet: nachfragen (die laufende Antwort würde abgebrochen)
  let closeConfirmed = false;
  win.on('close', e => {
    const busy = [...sessions.values()].filter(x => x.busy || x.tasks?.size).length;
    if (closeConfirmed || !busy) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: [tr('Abbrechen', 'Cancel'), tr('Trotzdem schließen', 'Close anyway')], defaultId: 0, cancelId: 0, noLink: true,
      title: tr('Swapline schließen', 'Close Swapline'),
      message: busy === 1
        ? tr('Claude arbeitet noch in 1 Chat (Antwort oder Hintergrund-Aufgabe).', 'Claude is still working in 1 chat (reply or background task).')
        : tr(`Claude arbeitet noch in ${busy} Chats (Antwort oder Hintergrund-Aufgabe).`, `Claude is still working in ${busy} chats (reply or background task).`, `Claude hâlâ ${busy} sohbette çalışıyor (yanıt veya arka plan görevi).`),
      detail: tr('Beim Schließen wird die laufende Antwort abgebrochen. Bisherige Änderungen und der Verlauf bleiben erhalten – danach kannst du den Chat mit „mach weiter“ fortsetzen.',
        'Closing cancels the current reply. Changes so far and the history are kept – afterwards you can continue the chat with “continue”.'),
    });
    if (r === 1) { closeConfirmed = true; win.close(); }
  });
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
  // Keine Gerätezugriffe (Kamera, Mikrofon, Standort, Zwischenablage …), Benachrichtigungen ausgenommen.
  // Kopieren läuft über den Hauptprozess (clipboard:write), nicht über die Browser-Zwischenablage.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));
  // Datei-Zugriffe der Oberfläche nur innerhalb des App-Ordners – kein file://host (SMB/UNC) und keine fremden Dateien
  const appRoot = path.join(__dirname, '..').toLowerCase() + path.sep;
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (d, cb) => {
    let ok = false;
    try { const u = new URL(d.url); ok = !u.host && path.resolve(fileURLToPath(u)).toLowerCase().startsWith(appRoot); } catch {}
    cb({ cancel: !ok });
  });
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
// Start aus dem Quellcode (npm start, Tests) mit eigener Kennung: sonst leitet Windows Klicks auf Benachrichtigungen
// der installierten App an die Entwicklungsversion weiter
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'de.arfep.swapline' : 'de.arfep.swapline.dev');

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
  initRemote();
  if (UPDATE_SUPPORTED) { setTimeout(checkForUpdates, 15000); setInterval(checkForUpdates, UPDATE_INTERVAL); }
  // SWAPLINE_SCREENSHOT=<datei.png>: nach dem Laden Bildschirmfoto speichern und beenden (für Tests)
  // Testlauf (nur unverpackt): SWAPLINE_TEST_JS wird in der Oberfläche ausgeführt, das Ergebnis landet in
  // SWAPLINE_TEST_OUT (JSON); SWAPLINE_SCREENSHOT speichert optional ein Bildschirmfoto. Danach beendet sich die App.
  const shot = DEV && process.env.SWAPLINE_SCREENSHOT;
  const testJs = DEV && process.env.SWAPLINE_TEST_JS;
  if (shot || testJs) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try {
        if (testJs) {
          let result;
          try { result = await win.webContents.executeJavaScript(fs.readFileSync(testJs, 'utf8')); } catch (e) { result = { error: String(e.stack || e) }; }
          if (process.env.SWAPLINE_TEST_OUT) fs.writeFileSync(process.env.SWAPLINE_TEST_OUT, JSON.stringify(result ?? null, null, 2));
        }
        if (!shot) return app.quit();
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
