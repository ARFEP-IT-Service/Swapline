// Swapline Server – der Dienst: Fernzugriff wie „Haupt-PC“ in Swapline (src/remote.js), optional über den Vermittler
// (src/relay-link.js). Claude Code läuft hier auf dem Server, das Handy (oder ein anderer PC) ist die Fernbedienung.
// Gleiche Prüfungen wie die PC-App (src/chat-core.js): Nachrichten, Antworten auf Rückfragen, Startparameter, Verlauf.
// Anmeldung bei Claude nur über „claude auth login“ auf dem Server – dieser Dienst speichert keine Claude-Zugangsdaten.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn, execFile } = require('node:child_process');

const src = path.join(__dirname, '..', '..', 'src');
const remote = require(path.join(src, 'remote.js'));
const { createRelayLink } = require(path.join(src, 'relay-link.js'));
const core = require(path.join(src, 'chat-core.js'));
const C = require('./config.js');
const VERSION = require('../package.json').version;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const isModel = v => v === '' || (typeof v === 'string' && /^[a-z0-9][a-z0-9.\-[\]]{0,63}$/i.test(v));
const HOME = os.homedir();
const HOST_NAME = os.hostname().slice(0, 40);
const UPLOAD_MAX = 25 * 1024 * 1024;
const BASH_TIMEOUT = 120000, BASH_MAX = 30000;
const OUTPUT_RE = /(?:Output is being written to:\s*|"output_file":")((?:[^"\\]|\\.)+?\.output)/g;

const log = msg => console.error(`[${new Date().toISOString()}] ${msg}`); // stderr: landet bei systemd im Journal

function startDaemon({ port } = {}) {
  let cfg = C.load();
  C.save(cfg); // erzeugt hostId/dialKey beim ersten Start
  const setCfg = patch => { cfg = { ...cfg, ...patch }; C.save(cfg); };
  const projectsRoot = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'projects');

  // ---------- Ordner: neue Chats nur in eingetragenen Ordnern (und deren Unterordnern) oder im Home-Verzeichnis ----------
  const within = (cwd, f) => { const a = path.resolve(cwd), b = path.resolve(f); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
  const cwdAllowed = cwd => cwd === '' || path.resolve(cwd) === path.resolve(HOME) || cfg.folders.some(f => within(cwd, f));

  // ---------- Claude Code ----------
  function claudeExe() {
    const cands = [process.env.SWAPLINE_SERVER_CLAUDE, cfg.claudePath, path.join(HOME, '.local', 'bin', 'claude'),
      ...String(process.env.PATH || '').split(path.delimiter).map(d => path.join(d, process.platform === 'win32' ? 'claude.exe' : 'claude'))];
    return cands.find(p => p && fs.existsSync(p)) || null;
  }
  function spawnClaude(args, cwd) {
    const exe = claudeExe();
    if (!exe) throw new Error('Claude Code nicht gefunden – bitte installieren (https://claude.com/claude-code) und „claude auth login“ ausführen');
    // Testläufe: Nachbau als Node-Skript
    return exe.endsWith('.js') ? spawn(process.execPath, [exe, ...args], { cwd }) : spawn(exe, args, { cwd, env: { ...process.env } });
  }

  // ---------- Chats: je Gerät und Chat-ID ein Claude-Prozess ----------
  const sessions = new Map(); // key -> { proc, devId, tabId, tab, pending, busy, outputs, stderr }
  const keyOf = (dev, tabId) => (typeof tabId === 'string' && /^[a-z0-9]{6,23}$/i.test(tabId) ? dev.id + ':' + tabId : null);
  const emit = (s, msg) => host.push(s.devId, 'claude', { tabId: s.tabId, msg });

  function validTab(t) {
    if (!t || typeof t !== 'object') return null;
    if (typeof t.id !== 'string' || !/^[a-z0-9]{6,23}$/i.test(t.id)) return null;
    if (t.sessionId != null && !UUID_RE.test(t.sessionId)) return null;
    if (!isModel(t.model || '') || !EFFORTS.includes(t.effort || '') || !MODES.includes(t.permissionMode || 'default')) return null;
    const cwd = typeof t.cwd === 'string' ? t.cwd : '';
    if (cwd && !cwdAllowed(cwd)) return null;
    return { id: t.id, cwd, sessionId: t.sessionId || null, model: t.model || '', effort: t.effort || '', permissionMode: t.permissionMode || 'default' };
  }

  function startSession(dev, tab) {
    const key = dev.id + ':' + tab.id;
    const cwd = tab.cwd && fs.existsSync(tab.cwd) ? tab.cwd : HOME;
    const proc = spawnClaude(core.claudeArgs(tab), cwd);
    const s = { proc, devId: dev.id, tabId: tab.id, tab: { ...tab, cwd }, pending: new Map(), busy: false, outputs: new Set(), stderr: '' };
    sessions.set(key, s);
    readline.createInterface({ input: proc.stdout }).on('line', line => {
      if (!line.trim()) return;
      let m; try { m = JSON.parse(line); } catch { return; }
      for (const o of line.matchAll(OUTPUT_RE)) { try { s.outputs.add(path.resolve(JSON.parse('"' + o[1] + '"'))); } catch {} }
      if (m.type === 'system' && m.subtype === 'init') s.tab.sessionId = m.session_id;
      if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
        s.pending.set(m.request_id, { toolName: m.request.tool_name, input: m.request.input, suggestions: m.request.permission_suggestions || null, description: typeof m.request.description === 'string' ? m.request.description : '' });
      }
      if (m.type === 'result') s.busy = false;
      emit(s, m);
    });
    proc.stderr.on('data', d => { s.stderr = (s.stderr + d).slice(-4000); });
    proc.on('error', e => emit(s, { type: 'app_error', message: 'Claude: ' + e.message }));
    proc.on('close', code => {
      if (code) log(`Claude beendet mit Code ${code}: ${s.stderr.trim().split('\n').slice(-3).join(' | ')}`);
      if (sessions.get(key) === s) sessions.delete(key);
      emit(s, { type: 'app_exit', code, stderr: code ? s.stderr : '' });
    });
    return s;
  }
  const write = (s, obj) => { if (s?.proc.stdin.writable) s.proc.stdin.write(JSON.stringify(obj) + '\n'); };
  function stopSession(key) {
    const s = sessions.get(key);
    if (!s) return;
    sessions.delete(key);
    try { s.proc.stdin.end(); } catch {}
    setTimeout(() => { try { s.proc.kill(); } catch {} }, 1500);
  }

  // ---------- „!“-Befehle (nur Geräte mit Freigabe „Alles erlauben“) ----------
  const bashRuns = new Map(), bashContext = new Map();
  const escTag = s => s.replace(/<\/(bash-[a-z]+)>/g, '<\\/$1>');
  function stopBash(key) { const p = bashRuns.get(key); if (p) try { process.platform === 'win32' ? spawn('taskkill', ['/T', '/F', '/PID', String(p.pid)]) : process.kill(-p.pid, 'SIGTERM'); } catch {} }
  function withBashContext(key, content) {
    const ctx = bashContext.get(key);
    if (!ctx?.length) return content;
    bashContext.delete(key);
    const pre = ctx.join('\n');
    return typeof content === 'string' ? pre + '\n\n' + content : [{ type: 'text', text: pre }, ...content];
  }
  function runBash(dev, tab, command) {
    const key = dev.id + ':' + tab.id;
    if (bashRuns.has(key)) return { error: 'Es läuft schon ein Befehl in diesem Chat' };
    const cwd = tab.cwd && fs.existsSync(tab.cwd) ? tab.cwd : HOME;
    const shell = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]
      : [fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', ['-c', command]];
    const id = crypto.randomBytes(6).toString('hex');
    const s0 = { devId: dev.id, tabId: tab.id };
    emit(s0, { type: 'swapline_bash', id, command, state: 'running', from: HOST_NAME });
    let out = '', cut = false;
    const p = spawn(shell[0], shell[1], { cwd, detached: process.platform !== 'win32' });
    bashRuns.set(key, p);
    const take = d => { if (out.length < BASH_MAX) out += d.toString('utf8'); else cut = true; };
    p.stdout.on('data', take); p.stderr.on('data', take);
    const timer = setTimeout(() => stopBash(key), BASH_TIMEOUT);
    const done = code => {
      if (bashRuns.get(key) !== p) return;
      clearTimeout(timer); bashRuns.delete(key);
      const output = out.slice(0, BASH_MAX).replace(/\r\n/g, '\n').replace(/\s+$/, '') + (cut || out.length > BASH_MAX ? '\n[… output truncated]' : '');
      const list = bashContext.get(key) || [];
      list.push(`<bash-input>${escTag(command)}</bash-input>\n<bash-stdout>${escTag(output)}</bash-stdout>` + (code ? `\n<bash-stderr>exit code ${code}</bash-stderr>` : ''));
      bashContext.set(key, list.slice(-10));
      emit(s0, { type: 'swapline_bash', id, command, state: 'done', code: code ?? -1, output, from: HOST_NAME });
    };
    p.on('close', done);
    p.on('error', e => { out += e.message; done(-1); });
    return true;
  }

  // ---------- Verlauf ----------
  const sessionFile = id => {
    if (!UUID_RE.test(String(id || ''))) return null;
    let dirs = [];
    try { dirs = fs.readdirSync(projectsRoot()); } catch { return null; }
    for (const d of dirs) { const f = path.join(projectsRoot(), d, id + '.jsonl'); if (fs.existsSync(f)) return f; }
    return null;
  };
  function search(query) {
    const q = String(query || '').toLowerCase().slice(0, 200);
    if (q.length < 2) return [];
    return core.listSessions(projectsRoot(), '(untitled)', 400).filter(h => {
      try { return fs.readFileSync(h.file, 'utf8').toLowerCase().includes(q); } catch { return false; }
    }).slice(0, 60).map(h => ({ sessionId: h.sessionId, title: h.title, cwd: h.cwd, mtime: h.mtime, hits: 1, snippet: '', when: h.mtime }));
  }

  // ---------- Erreichbarkeit (für Geräte und den Kopplungslink) ----------
  const addresses = () => remote.localAddresses().sort((a, b) => Number(a.tailscale) - Number(b.tailscale)).map(a => a.address).slice(0, 6);
  const relayReach = () => (cfg.relay ? { address: cfg.relay.address, port: cfg.relay.port, hostId: cfg.hostId, dialKey: cfg.dialKey } : null);
  function pairLink(code) {
    const rr = relayReach();
    return 'swapline://pair?v=1&a=' + addresses().join(',') + '&p=' + host.port + '&c=' + code.replace(/-/g, '') + '&n=' + encodeURIComponent(HOST_NAME)
      + (rr ? '&r=' + encodeURIComponent(rr.address + ':' + rr.port) + '&h=' + rr.hostId + '&k=' + rr.dialKey : '');
  }
  const color = i => ['#0EA5E9', '#22C55E', '#F97316', '#7C5CFF', '#E5007E', '#EAB308'][i % 6];
  function store(dev) {
    return {
      profiles: [{ id: 'server', name: HOST_NAME, color: '#0EA5E9', isDefault: true }], activeProfileId: 'server',
      projects: cfg.folders.map((f, i) => ({ id: 'f' + i, name: path.basename(f) || f, color: color(i), cwd: f })), projectGroups: [], favorites: [],
      allowedFolders: cfg.folders, settings: { model: '', effort: '', permissionMode: 'default' },
      scope: { limited: false, accountsLimited: false, newChats: true },
      hostName: HOST_NAME, hostVersion: 'server ' + VERSION, allowBypass: !!dev.allowBypass, canEditProjects: false,
      reach: { addresses: addresses(), port: host.port, relay: relayReach() }, servers: [],
    };
  }

  // ---------- Anfragen der Geräte ----------
  const notAllowed = () => { throw new Error('Auf dem Server nicht verfügbar'); };
  async function dispatch(dev, ch, args) {
    const a0 = args[0];
    switch (ch) {
      case 'store:get': return store(dev);
      case 'profiles:status': return new Promise(resolve => {
        const exe = claudeExe();
        if (!exe) return resolve({ loggedIn: false, error: 'Claude Code nicht gefunden' });
        execFile(exe.endsWith('.js') ? process.execPath : exe, [...(exe.endsWith('.js') ? [exe] : []), 'auth', 'status', '--json'], { timeout: 25000 }, (err, out) => {
          try { resolve(JSON.parse(out)); } catch { resolve({ loggedIn: false, error: 'claude auth status: ' + (err?.message || 'keine Antwort') }); }
        });
      });
      case 'profiles:models': return { models: [], account: null, commands: [] };
      case 'tabs:list': return [];
      case 'session:attach': return false;
      case 'history:list': return core.listSessions(projectsRoot(), '(untitled)', 200).map(({ file, ...h }) => h);
      case 'history:search': return search(a0?.query);
      case 'history:loadSession': {
        const paged = Number.isInteger(a0?.turns) && a0.turns >= 1 && a0.turns <= 50;
        const f = sessionFile(a0?.sessionId);
        if (!f) return paged ? { msgs: [], start: 0, total: 0 } : [];
        const all = core.loadTranscript(f);
        return paged ? core.pageTranscript(all, a0.turns, a0.before) : all;
      }
      case 'session:send': {
        const tab = validTab(a0?.tab);
        if (!tab || !core.validContent(a0?.content)) return false;
        if (tab.permissionMode === 'bypassPermissions' && !dev.allowBypass) return false;
        const key = dev.id + ':' + tab.id;
        let s = sessions.get(key);
        if (!s) s = startSession(dev, tab);
        s.busy = true;
        write(s, { type: 'user', message: { role: 'user', content: withBashContext(key, a0.content) } });
        return true;
      }
      case 'session:respond': {
        const s = sessions.get(keyOf(dev, a0?.tabId));
        const req = s?.pending.get(a0?.requestId);
        if (!req) return false;
        const { out, error } = core.checkResponse(req, a0.response);
        if (error) { log('Antwort abgelehnt: ' + error); return false; }
        s.pending.delete(a0.requestId);
        write(s, { type: 'control_response', response: { subtype: 'success', request_id: a0.requestId, response: out } });
        emit(s, { type: 'swapline_answered', requestId: a0.requestId, behavior: out.behavior, from: dev.name });
        return true;
      }
      case 'session:pending': {
        const s = sessions.get(keyOf(dev, a0?.tabId));
        if (!s) return { running: false, requests: [] };
        return { running: !!s.busy, requests: [...s.pending].slice(0, 20).map(([rid, p]) => ({ type: 'control_request', request_id: rid,
          request: { subtype: 'can_use_tool', tool_name: p.toolName, input: p.input, permission_suggestions: p.suggestions, description: p.description } })) };
      }
      case 'session:interrupt': {
        const key = keyOf(dev, a0);
        if (!key) return false;
        stopBash(key);
        write(sessions.get(key), { type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'interrupt' } });
        return true;
      }
      case 'session:restart': case 'session:close': { const key = keyOf(dev, a0); if (key) stopSession(key); return true; }
      case 'session:confirmBypass': return !!dev.allowBypass;
      case 'session:bash': {
        if (!dev.allowBypass) throw new Error('„!“-Befehle sind für dieses Gerät nicht freigegeben (swapline-server devices bypass <Name> on)');
        const tab = validTab(a0?.tab);
        const command = a0?.command;
        if (!tab || typeof command !== 'string' || !command.trim() || command.length > 8000 || command.includes('\0')) return false;
        return runBash(dev, tab, command);
      }
      case 'session:bashStop': { const key = keyOf(dev, a0); if (key) stopBash(key); return true; }
      case 'files:upload': {
        const name = String(a0?.name || '').replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').slice(0, 120) || 'datei';
        const data = typeof a0?.data === 'string' ? a0.data : '';
        if (!/^[A-Za-z0-9+/]*=*$/.test(data) || data.length > Math.ceil(UPLOAD_MAX / 3) * 4) return { error: 'Datei zu groß oder ungültig (höchstens 25 MB)' };
        const dir = path.join(C.dataDir(), 'uploads');
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const full = path.join(dir, crypto.randomBytes(4).toString('hex') + '-' + name);
        const buf = Buffer.from(data, 'base64');
        fs.writeFileSync(full, buf, { mode: 0o600 });
        return { path: full, name, size: buf.length };
      }
      case 'task:readOutput': {
        const f = typeof a0 === 'string' ? path.resolve(a0) : '';
        if (![...sessions.values()].some(s => s.devId === dev.id && s.outputs.has(f))) return { error: 'Nicht freigegeben' };
        try {
          const size = fs.statSync(f).size, start = Math.max(0, size - 65536);
          const fd = fs.openSync(f, 'r'); const buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd);
          return { text: buf.toString('utf8'), truncated: start > 0 };
        } catch (e) { return { error: e.message }; }
      }
      case 'server:call': case 'projects:add': case 'projects:update': case 'projects:remove': return notAllowed();
      default: return notAllowed();
    }
  }

  // ---------- Kopplung: nur, solange „swapline-server pair“ im Terminal läuft – dort wird jede Kopplung bestätigt ----------
  let pairer = null; // { ask(name, address) → Promise<bool>, paired(name) }
  const host = remote.createHost({
    getDevices: () => cfg.devices,
    saveDevices: list => setCfg({ devices: list }),
    encrypt: s => s, decrypt: s => s, // Schutz über die Dateirechte (0600), siehe config.js
    confirmPair: async ({ name, address }) => {
      if (!pairer) return false;
      const ok = await pairer.ask(name, address);
      if (ok) setTimeout(() => pairer?.paired(name), 200);
      return ok;
    },
    dispatch, log, onChange: () => {},
  });

  // ---------- Vermittler ----------
  const relayLink = createRelayLink({ onSocket: (s, from) => host.adopt(s, from), onStatus: (st, d) => log(`Vermittler: ${st}${d ? ' – ' + d : ''}`), log });
  const applyRelay = () => relayLink.use(cfg.relay ? { address: cfg.relay.address, port: cfg.relay.port, secret: cfg.relay.secret, hostId: cfg.hostId, dialKey: cfg.dialKey } : null);

  // ---------- Steuerung über die Befehlszeile (nur dieser Benutzer: Unix-Socket 0600) ----------
  function control(sock) {
    let buf = '';
    const send = o => { if (!sock.destroyed) sock.write(JSON.stringify(o) + '\n'); };
    const answers = new Map();
    sock.setEncoding('utf8');
    sock.on('data', d => {
      buf += d;
      if (buf.length > 1e6) return sock.destroy();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        handle(m);
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => { if (pairer?.sock === sock) { pairer = null; host.cancelPairing(); } for (const r of answers.values()) r(false); });
    function handle(m) {
      const dev = m.device && cfg.devices.find(d => d.id === m.device || d.name === m.device);
      switch (m.op) {
        case 'status': return send({ ok: true, version: VERSION, port: host.port, addresses: addresses(), folders: cfg.folders, relay: cfg.relay ? { address: cfg.relay.address, port: cfg.relay.port, state: relayLink.state, detail: relayLink.detail } : null,
          devices: cfg.devices.map(d => ({ id: d.id, name: d.name, allowBypass: !!d.allowBypass, lastSeen: d.lastSeen, connected: host.connected(d.id) })), claude: claudeExe() });
        case 'pair': {
          if (pairer) return send({ error: 'Es läuft schon eine Kopplung' });
          const p = host.startPairing();
          pairer = {
            sock,
            ask: (name, address) => new Promise(resolve => { const id = crypto.randomBytes(4).toString('hex'); answers.set(id, resolve); send({ event: 'confirm', id, name, address }); setTimeout(() => { if (answers.delete(id)) resolve(false); }, 5 * 60 * 1000); }),
            paired: name => { send({ event: 'paired', name }); pairer = null; },
          };
          return send({ ok: true, code: p.code, expires: p.expires, link: pairLink(p.code) });
        }
        case 'confirm': { const r = answers.get(m.id); if (r) { answers.delete(m.id); r(!!m.ok); } return; }
        case 'device-remove': {
          if (!dev) return send({ error: 'Gerät nicht gefunden' });
          host.disconnect(dev.id);
          for (const k of [...sessions.keys()]) if (k.startsWith(dev.id + ':')) stopSession(k);
          setCfg({ devices: cfg.devices.filter(d => d.id !== dev.id) });
          return send({ ok: true });
        }
        case 'device-bypass': {
          if (!dev) return send({ error: 'Gerät nicht gefunden' });
          setCfg({ devices: cfg.devices.map(d => (d.id === dev.id ? { ...d, allowBypass: !!m.on } : d)) });
          return send({ ok: true });
        }
        case 'folder-add': {
          const f = typeof m.path === 'string' ? path.resolve(m.path) : '';
          if (!f || !fs.existsSync(f) || !fs.statSync(f).isDirectory()) return send({ error: 'Ordner nicht gefunden' });
          if (!cfg.folders.includes(f)) setCfg({ folders: [...cfg.folders, f] });
          host.broadcast('store-changed', {});
          return send({ ok: true });
        }
        case 'folder-remove': setCfg({ folders: cfg.folders.filter(f => f !== m.path && f !== path.resolve(String(m.path || ''))) }); host.broadcast('store-changed', {}); return send({ ok: true });
        case 'relay': {
          if (m.code == null) { setCfg({ relay: null }); applyRelay(); host.broadcast('store-changed', {}); return send({ ok: true }); }
          let r = null;
          try { const t = String(m.code).trim(); if (t.startsWith('srelay1.')) r = JSON.parse(Buffer.from(t.slice(8), 'base64url').toString('utf8')); } catch {}
          if (!r || typeof r.a !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test(r.a) || !Number.isInteger(r.p) || r.p < 1 || r.p > 65535 || typeof r.s !== 'string' || r.s.length < 32) return send({ error: 'Einrichtungscode ungültig' });
          setCfg({ relay: { address: r.a, port: r.p, secret: r.s } });
          applyRelay();
          host.broadcast('store-changed', {});
          return send({ ok: true });
        }
        default: return send({ error: 'unbekannt' });
      }
    }
  }
  const ctlPath = C.controlPath();
  if (process.platform !== 'win32') { try { fs.unlinkSync(ctlPath); } catch {} }
  const ctl = net.createServer(control);

  return {
    async start() {
      C.ensureDir();
      await host.start(port ?? cfg.port, '0.0.0.0');
      await new Promise((resolve, reject) => { ctl.once('error', reject); ctl.listen(ctlPath, resolve); });
      if (process.platform !== 'win32') fs.chmodSync(ctlPath, 0o600);
      applyRelay();
      log(`Swapline Server ${VERSION} läuft – Port ${host.port}, Claude: ${claudeExe() || 'nicht gefunden'}`);
      return host.port;
    },
    stop() { for (const k of [...sessions.keys()]) stopSession(k); relayLink.use(null); host.stop(); ctl.close(); },
    get port() { return host.port; },
  };
}

module.exports = { startDaemon };
