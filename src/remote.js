// Fernzugriff: Swapline auf einem anderen PC („Gerät“) nutzt Chats und Konten dieses PCs („Haupt-PC“).
//
// Verbindung: TLS 1.2 mit vorab geteiltem Schlüssel je Gerät (TLS-PSK, ECDHE-PSK-CHACHA20-POLY1305). Der Schlüssel
// ist zugleich Ausweis und Verschlüsselung – beide Seiten prüfen sich gegenseitig, ohne Zertifikate. Er entsteht
// beim Koppeln: der Haupt-PC zeigt einen Einmal-Code (128 Bit, 5 Minuten gültig), das Gerät meldet sich damit,
// der Haupt-PC bestätigt im nativen Dialog und schickt über die verschlüsselte Verbindung einen eigenen
// 256-Bit-Schlüssel für das Gerät. Gespeichert wird er auf beiden Seiten nur verschlüsselt (Windows-DPAPI über
// safeStorage). Anmeldedaten der Claude-Konten verlassen den Haupt-PC nie: das Gerät schickt nur Anfragen, die
// der Haupt-PC mit denselben Prüfungen wie lokale Eingaben ausführt.
//
// Nachrichten: eine JSON-Zeile je Nachricht. Gerät → Haupt-PC: {t:'req', id, ch, args}. Haupt-PC → Gerät:
// {t:'res', id, ok, value | error} und {t:'evt', kind, data}.
'use strict';
const tls = require('node:tls');
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');

const TLS_OPTS = { ciphers: 'ECDHE-PSK-CHACHA20-POLY1305', minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' };
const DEFAULT_PORT = 47820;
const PAIR_TTL = 5 * 60 * 1000;
const MAX_FRAME = 48 * 1024 * 1024;          // größte Nachricht (Bilder als base64)
const CALL_TIMEOUT = 120 * 1000;
const FAIL_WINDOW = 10 * 60 * 1000, FAIL_LIMIT = 10; // so viele fehlgeschlagene Anmeldungen je Adresse, dann Sperre
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';     // Crockford-Base32 (ohne I, L, O, U)
const DEVICE_ID_RE = /^[0-9a-f]{16}$/;

// ---------- Hilfen ----------
function b32encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch); if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const pairDialKey = secret => crypto.createHash('sha256').update('swapline-pair-dial-v1').update(secret).digest('hex'); // wie src/relay-link.js
const pairKey = secret => crypto.createHash('sha256').update('swapline-pair-v1').update(secret).digest();
const formatCode = c => c.match(/.{1,4}/g).join('-');

// Eine JSON-Zeile je Nachricht; zu große oder kaputte Nachrichten beenden die Verbindung
function lineChannel(socket, onMessage) {
  let buf = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buf += chunk;
    if (buf.length > MAX_FRAME) { socket.destroy(); return; }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { socket.destroy(); return; }
      if (m && typeof m === 'object') onMessage(m);
    }
  });
  return obj => { if (!socket.destroyed) socket.write(JSON.stringify(obj) + '\n'); };
}

// Adressen, unter denen dieser PC erreichbar ist (zur Anzeige beim Koppeln; Tailscale = 100.64.0.0/10)
function localAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal || a.family !== 'IPv4') continue;
      const [x, y] = a.address.split('.').map(Number);
      out.push({ address: a.address, name, tailscale: x === 100 && y >= 64 && y <= 127 });
    }
  }
  return out;
}

// ---------- Haupt-PC ----------
// ctx: { getDevices(), saveDevices(list), encrypt(buf), decrypt(str), confirmPair({ name, address }) → Promise<bool>,
//        dispatch(device, ch, args) → Promise<value>, log(msg), onChange() }
function createHost(ctx) {
  let server = null, pairing = null, listenPort = null;
  const conns = new Map();   // deviceId -> { socket, write }
  const fails = new Map();   // address -> [Zeitpunkte]

  const blocked = addr => (fails.get(addr) || []).filter(t => Date.now() - t < FAIL_WINDOW).length >= FAIL_LIMIT;
  // Adresse für Sperre und Protokoll: bei Verbindungen über den Vermittler die Adresse des Geräts („relay:…“), sonst die
  // Gegenstelle – sonst würde ein Fremder über den Vermittler alle Geräte aussperren
  const addrOf = sock => sock?.swaplineAddr || sock?._parent?.swaplineAddr || sock?.remoteAddress;
  const noteFail = addr => fails.set(addr, [...(fails.get(addr) || []).filter(t => Date.now() - t < FAIL_WINDOW), Date.now()]);

  function keyFor(identity) {
    if (identity === 'pair') return pairing && Date.now() < pairing.expires ? pairing.key : null;
    if (!DEVICE_ID_RE.test(identity)) return null;
    const d = ctx.getDevices().find(x => x.id === identity);
    if (!d) return null;
    try { return Buffer.from(ctx.decrypt(d.keyEnc), 'base64'); } catch { return null; }
  }

  function onSecure(socket) {
    const identity = socket.swaplineIdentity;
    const addr = addrOf(socket);
    if (identity === 'pair') return handlePairing(socket, addr);
    const device = ctx.getDevices().find(x => x.id === identity);
    if (!device) return socket.destroy();
    conns.get(device.id)?.socket.destroy(); // nur eine Verbindung je Gerät
    const write = lineChannel(socket, msg => {
      if (msg.t !== 'req' || typeof msg.ch !== 'string') return;
      const dev = ctx.getDevices().find(x => x.id === device.id); // aktueller Stand (z. B. Rechte geändert, entfernt)
      if (!dev) return socket.destroy();
      Promise.resolve().then(() => ctx.dispatch(dev, msg.ch, Array.isArray(msg.args) ? msg.args : []))
        .then(value => write({ t: 'res', id: msg.id, ok: true, value: value === undefined ? null : value }),
          e => write({ t: 'res', id: msg.id, ok: false, error: String(e?.message || e).slice(0, 300) }));
    });
    conns.set(device.id, { socket, write });
    ctx.saveDevices(ctx.getDevices().map(d => (d.id === device.id ? { ...d, lastSeen: Date.now(), lastAddress: addr } : d)));
    ctx.log(`Fernzugriff: Gerät „${device.name}“ verbunden (${addr})`);
    ctx.onChange();
    socket.on('close', () => { if (conns.get(device.id)?.socket === socket) { conns.delete(device.id); ctx.onChange(); } });
    socket.on('error', () => {});
  }

  function handlePairing(socket, addr) {
    const p = pairing;
    pairing = null; // Code gilt genau einmal – auch wenn das Koppeln abgelehnt wird
    ctx.onChange();
    socket.on('error', () => {});
    socket.setTimeout(PAIR_TTL, () => socket.destroy());
    const write = lineChannel(socket, async msg => {
      if (msg.t !== 'pair' || !p) return socket.destroy();
      const name = String(msg.name || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'Gerät';
      // Bestätigung am Haupt-PC: true/false oder { ok, rights } – Rechte nur, wenn dort einzeln angehakt (Standard: alle aus)
      const answer = await ctx.confirmPair({ name, address: addr });
      const ok = answer === true || answer?.ok === true;
      if (!ok) { ctx.log(`Fernzugriff: Kopplung von „${name}“ (${addr}) abgelehnt`); write({ t: 'pair-denied' }); return socket.end(); }
      if (socket.destroyed) return ctx.log(`Fernzugriff: Kopplung von „${name}“ abgebrochen (Verbindung weg)`); // kein verwaister Eintrag
      const r = (answer && typeof answer === 'object' && answer.rights) || {};
      const id = crypto.randomBytes(8).toString('hex');
      const key = crypto.randomBytes(32);
      const dialKey = crypto.randomBytes(32).toString('hex'); // eigener Schlüssel dieses Geräts für den Vermittler
      ctx.saveDevices([...ctx.getDevices(), { id, name, createdAt: Date.now(), lastSeen: null, lastAddress: addr,
        allowBypass: r.allowBypass === true, allowBang: r.allowBang === true, allowProjects: r.allowProjects === true, allowServers: r.allowServers === true,
        keyEnc: ctx.encrypt(key.toString('base64')), dialKeyEnc: ctx.encrypt(dialKey) }]);
      ctx.log(`Fernzugriff: Gerät „${name}“ (${addr}) gekoppelt`);
      write({ t: 'paired', deviceId: id, key: key.toString('base64'), dialKey, hostName: os.hostname().slice(0, 40) });
      socket.end();
      ctx.onChange();
    });
  }

  return {
    get running() { return !!server; },
    get port() { return listenPort; },
    connected: id => conns.has(id),
    start(port = DEFAULT_PORT, bind = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        if (server) return resolve(listenPort);
        const srv = tls.createServer({
          ...TLS_OPTS,
          pskCallback: (socket, identity) => { const k = keyFor(identity); if (k) socket.swaplineIdentity = identity; return k; },
          handshakeTimeout: 15000,
        }, onSecure);
        srv.on('connection', sock => { if (blocked(addrOf(sock))) sock.destroy(); });
        srv.on('tlsClientError', (e, sock) => {
          const a = addrOf(sock);
          if (a) noteFail(a);
          ctx.log(`Fernzugriff: Anmeldung abgelehnt (${a || '?'}): ${e.code || e.message}`);
        });
        srv.once('error', reject);
        srv.listen(port, bind, () => { server = srv; listenPort = srv.address().port; srv.removeListener('error', reject); srv.on('error', e => ctx.log('Fernzugriff: ' + e.message)); resolve(listenPort); });
      });
    },
    stop() {
      for (const c of conns.values()) c.socket.destroy();
      conns.clear(); pairing = null;
      if (server) { server.close(); server = null; listenPort = null; }
    },
    startPairing() {
      const secret = crypto.randomBytes(16);
      pairing = { key: pairKey(secret), dialKey: pairDialKey(secret), expires: Date.now() + PAIR_TTL };
      ctx.onChange();
      return { code: formatCode(b32encode(secret)), expires: pairing.expires };
    },
    cancelPairing() { pairing = null; ctx.onChange(); },
    // dialKey für das Koppeln über den Vermittler (aus dem Einmal-Code abgeleitet), nur solange ein Code gilt
    pairDialKey() { return pairing && Date.now() < pairing.expires ? pairing.dialKey : null; },
    get pairingExpires() { return pairing && Date.now() < pairing.expires ? pairing.expires : null; },
    // Verbindung, die der Vermittler (src/relay-link.js) hergestellt hat: wie eine direkte Verbindung annehmen
    adopt(socket, from) {
      if (!server) return socket.destroy();
      socket.swaplineAddr = 'relay:' + (String(from || '').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || '?');
      server.emit('connection', socket);
    },
    disconnect(id) { conns.get(id)?.socket.destroy(); conns.delete(id); },
    // Ereignis an ein Gerät (z. B. Ausgabe eines Chats) bzw. an alle verbundenen Geräte
    push(id, kind, data) { conns.get(id)?.write({ t: 'evt', kind, data }); },
    broadcast(kind, data) { for (const c of conns.values()) c.write({ t: 'evt', kind, data }); },
  };
}

// ---------- Gerät (verbindet sich mit einem Haupt-PC) ----------
// Wege zum Haupt-PC: die direkten Adressen der Reihe nach (Heimnetz, Tailscale, öffentliche Adresse), danach der
// Vermittler (relay: { address, port, hostId, dialKey }) – von unterwegs ohne Portfreigabe. Über den Vermittler läuft
// dieselbe TLS-PSK-Verbindung, er sieht nur verschlüsselte Bytes.
const ROUTE_TIMEOUT = 4000, CONNECT_TIMEOUT = 15000;
const UNREACHABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTOFFLINE']);
function routesOf(t) {
  const list = (Array.isArray(t.addresses) ? t.addresses : String(t.address || '').split(',')).map(a => String(a).trim()).filter(Boolean);
  // Vermittler: als dieses Gerät (eigener dialKey) bzw. beim Koppeln als „pair“
  return [...list.map(a => ({ address: a, port: t.port })), ...(t.relay ? [{ relay: { ...t.relay, who: t.deviceId || t.relay.who || 'pair' } }] : [])];
}
// TLS-PSK-Verbindung über einen Weg – fertig erst nach erfolgreichem Handshake
async function openRoute(route, psk, identity, timeout) {
  const raw = route.relay ? await require('./relay-link').dialRelay(route.relay, timeout) : null;
  return new Promise((resolve, reject) => {
    const host = route.address;
    const s = tls.connect({ ...TLS_OPTS, ...(raw ? { socket: raw } : { host, port: route.port, servername: net.isIP(host) ? undefined : host }),
      pskCallback: () => ({ psk, identity }), checkServerIdentity: () => undefined });
    const end = (err, v) => { clearTimeout(timer); s.off('error', onErr); s.off('close', onClose); if (err) { s.destroy(); raw?.destroy(); reject(err); } else resolve(v); };
    const timer = setTimeout(() => { const e = new Error('Zeitüberschreitung'); e.code = 'ETIMEDOUT'; end(e); }, timeout);
    const onErr = e => end(e);
    const onClose = () => { const e = new Error('closed'); e.code = 'ECLOSED'; end(e); };
    s.once('secureConnect', () => { s.swaplineVia = raw ? 'relay' : host; end(null, s); });
    s.once('error', onErr); s.once('close', onClose);
  });
}
// Erster Weg, der klappt; nicht erreichbare kosten nur ein kurzes Warten. Andere Fehler (z. B. falscher Schlüssel
// oder Code) beenden die Suche – ein anderer Weg führt zum selben Haupt-PC.
async function openAny(t, psk, identity) {
  const routes = routesOf(t);
  if (!routes.length) { const e = new Error('Keine Adresse'); e.code = 'ENOTFOUND'; throw e; }
  let last;
  for (const r of routes) {
    try { return await openRoute(r, psk, identity, routes.length > 1 && !r.relay ? ROUTE_TIMEOUT : CONNECT_TIMEOUT); }
    catch (e) { last = e; if (!UNREACHABLE.has(e.code)) throw e; }
  }
  throw last;
}

// Koppeln: { address | addresses, port, code, name, relay? } → { deviceId, key, hostName, via }
async function pair({ address, addresses, port, code, name, relay }) {
  const secret = b32decode(code);
  if (!secret || secret.length !== 16) throw new Error('code');
  // über den Vermittler mit einem aus dem Code abgeleiteten Schlüssel (kein dauerhafter Schlüssel im Kopplungslink)
  const pr = relay ? { address: relay.address, port: relay.port, hostId: relay.hostId, dialKey: pairDialKey(secret), who: 'pair' } : null;
  const sock = await openAny({ address, addresses, port, relay: pr }, pairKey(secret), 'pair');
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; sock.destroy(); err ? reject(err) : resolve(val); };
    sock.setTimeout(PAIR_TTL + 10000, () => finish(new Error('timeout')));
    sock.on('error', e => finish(e));
    sock.on('close', () => finish(new Error('closed')));
    const write = lineChannel(sock, msg => {
      if (msg.t === 'paired' && DEVICE_ID_RE.test(msg.deviceId) && typeof msg.key === 'string') finish(null, { deviceId: msg.deviceId, key: msg.key, dialKey: /^[0-9a-f]{64}$/.test(msg.dialKey || '') ? msg.dialKey : null, hostName: String(msg.hostName || '').slice(0, 40), via: sock.swaplineVia });
      else if (msg.t === 'pair-denied') finish(new Error('denied'));
    });
    write({ t: 'pair', name });
  });
}

// ctx: { onEvent(kind, data), onStatus(state, detail), log(msg) }
function createClient(ctx) {
  let target = null, sock = null, write = null, retry = null, delay = 2000, state = 'off', via = '';
  const calls = new Map();
  let nextId = 1;
  const setState = (s, detail) => { state = s; ctx.onStatus(s, detail); };

  function failAll(why) { for (const c of calls.values()) { clearTimeout(c.timer); c.reject(new Error(why)); } calls.clear(); }
  function again(t) {
    if (target !== t) return;
    setState('reconnecting');
    retry = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30000);
  }
  async function connect() {
    if (!target) return;
    const t = target;
    setState('connecting');
    let s;
    try { s = await openAny(t, t.key, t.deviceId); }
    catch (e) { if (target === t) { ctx.log(`Fernzugriff: Verbindung zu ${routesOf(t).map(r => r.relay ? 'Vermittler' : r.address).join(', ')} – ${e.code || e.message}`); again(t); } return; }
    if (target !== t) return s.destroy();
    delay = 2000;
    sock = s; via = s.swaplineVia || '';
    write = lineChannel(s, msg => {
      if (msg.t === 'res') { const c = calls.get(msg.id); if (!c) return; calls.delete(msg.id); clearTimeout(c.timer); msg.ok ? c.resolve(msg.value) : c.reject(new Error(msg.error || 'Fehler')); }
      else if (msg.t === 'evt' && typeof msg.kind === 'string') ctx.onEvent(msg.kind, msg.data);
    });
    s.setKeepAlive(true, 30000);
    s.on('error', e => { ctx.log(`Fernzugriff: Verbindung zu ${via === 'relay' ? 'Vermittler' : via} – ${e.code || e.message}`); });
    s.on('close', () => {
      if (sock !== s) return;
      sock = null; write = null; via = '';
      failAll('Verbindung zum Haupt-PC getrennt');
      again(t);
    });
    setState('connected');
  }
  return {
    get state() { return state; },
    get target() { return target; },
    // Weg der aktuellen Verbindung: Adresse oder „relay“ (Vermittler)
    get via() { return via; },
    use(t) { // t: { id, address | addresses, port, deviceId, key(Buffer), relay? } oder null
      clearTimeout(retry); retry = null;
      const old = sock; sock = null; write = null; via = ''; old?.destroy();
      failAll('Ziel gewechselt');
      target = t; delay = 2000;
      if (t) connect(); else setState('off');
    },
    // neue Wege (vom Haupt-PC gemeldet) für die nächste Verbindung – die bestehende bleibt
    setRoutes({ addresses, relay }) { if (target) Object.assign(target, { addresses, relay: relay || null }); },
    call(ch, args) {
      return new Promise((resolve, reject) => {
        if (!write || state !== 'connected') return reject(new Error('Nicht mit dem Haupt-PC verbunden'));
        const id = nextId++;
        const timer = setTimeout(() => { calls.delete(id); reject(new Error('Zeitüberschreitung')); }, CALL_TIMEOUT);
        calls.set(id, { resolve, reject, timer });
        write({ t: 'req', id, ch, args });
      });
    },
  };
}

module.exports = { createHost, createClient, pair, localAddresses, DEFAULT_PORT, DEVICE_ID_RE, b32decode, b32encode };
