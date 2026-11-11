// Swapline-Vermittler (Relay): verbindet Geräte (z. B. die Android-App) mit einem Haupt-PC, ohne Portfreigabe am Router
// des PCs. PC und Gerät bauen beide eine Verbindung NACH AUSSEN zum Vermittler auf; der Vermittler reicht danach nur
// noch Bytes durch. Darin läuft unverändert die TLS-PSK-Verbindung zwischen Gerät und PC (Ende-zu-Ende) – der
// Vermittler kennt keine Geräteschlüssel und sieht keine Inhalte.
//
// Nur eigene Haupt-PCs (ab Relay 0.3.0): jeder Haupt-PC hat einen EIGENEN Schlüssel (Eintrag in hosts.json, angelegt in
// der Relay-App als Einrichtungscode). Beim ersten Kontakt bindet sich der Eintrag an die Kennung (hostId) dieses PCs
// und wartet auf „Erlauben“ in der Relay-App; erst dann wird der PC angemeldet. Entfernen = Schlüssel ungültig.
// Ein gemeinsames Kennwort gibt es nicht mehr.
//
// Anmeldung ohne Schlüssel auf der Leitung (HMAC-SHA256 über eine Zufallszahl des Vermittlers):
//   Vermittler → jede neue Verbindung:  {"t":"hello","v":2,"nonce":"<hex>"}
//   Haupt-PC (Steuerverbindung):         {"t":"host","key":"<Eintrag>","hostId":"<hex16>","mac":HMAC(Schlüssel, "host|nonce|hostId")}
//   Haupt-PC (Datenverbindung):          {"t":"accept","id":"<id>","mac":HMAC(Schlüssel, "accept|nonce|id")}
//   Gerät:                               {"t":"dial","hostId":"<hex16>","who":"<Geräte-ID|pair>","mac":HMAC(dialKey, "dial|nonce|hostId|who")}
// Die Prüfung des Geräts übernimmt der Haupt-PC (nur er kennt die dialKeys – je Gerät einer): der Vermittler meldet
// {"t":"incoming","id","nonce","mac","who","from"}; der PC antwortet mit einer Datenverbindung (accept) oder {"t":"reject","id"}.
//
// Benutzt von der App „Swapline Relay“ (Dienst + Oberfläche, relay/app) und von relay/relay.js (Start ohne App, z. B. Linux).
'use strict';
const net = require('node:net');
const crypto = require('node:crypto');

const HEX16 = /^[0-9a-f]{16}$/;
const ENTRY = /^[0-9a-f]{8}$/;
const WHO = /^([0-9a-f]{16}|pair)$/;
const MAX_LINE = 4096;            // Anmeldezeile
const AUTH_TIMEOUT = 10_000;      // so lange darf eine neue Verbindung bis zur Anmeldung brauchen
const DIAL_TIMEOUT = 15_000;      // so lange wartet ein Gerät auf den Haupt-PC
const FAIL_WINDOW = 10 * 60_000, FAIL_LIMIT = 10;  // fehlgeschlagene Anmeldungen je Adresse, dann Sperre
const RATE_WINDOW = 60_000, RATE_LIMIT = 60;       // neue Verbindungen je Adresse und Minute

const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const newKey = () => crypto.randomBytes(32).toString('hex');
const newEntryId = () => crypto.randomBytes(4).toString('hex');

// getHosts() → [{ id, name, key, hostId, approved }] (aktueller Stand von hosts.json)
// onPending({ id, hostId, ip }) – ein PC hat sich mit einem noch nicht freigegebenen Eintrag gemeldet
function createRelay({ getHosts, onPending = () => {}, maxPipesPerHost = 10, maxPipes = 50, maxConnections = 300, log = () => {} }) {
  if (typeof getHosts !== 'function') throw new Error('getHosts fehlt');
  const hosts = new Map();    // hostId -> { socket, entry, pipes: Set, ip, since }
  const pending = new Map();  // id -> { device, hostId, timer, ip }
  const waiting = new Map();  // Eintrag -> { hostId, ip, since } – wartet auf „Erlauben“
  const fails = new Map(), rate = new Map();
  const recent = (m, ip, win) => (m.get(ip) || []).filter(t => Date.now() - t < win);
  const note = (m, ip, win) => m.set(ip, [...recent(m, ip, win), Date.now()]);
  const addr = s => String(s.remoteAddress || '').replace(/^::ffff:/, '');
  const send = (s, o) => { if (!s.destroyed) s.write(JSON.stringify(o) + '\n'); };
  const fail = (s, ip, why) => { note(fails, ip, FAIL_WINDOW); log(`abgelehnt ${ip}: ${why}`); s.destroy(); };
  const entryOf = id => (ENTRY.test(id || '') ? getHosts().find(e => e.id === id) : null);
  const entryForHost = hostId => getHosts().find(e => e.approved && e.hostId === hostId) || null;
  const openPipes = () => [...hosts.values()].reduce((n, h) => n + h.pipes.size, 0) + pending.size;
  // Sperrlisten aufräumen (sonst wachsen sie mit jeder neuen Adresse)
  const sweep = setInterval(() => { for (const m of [fails, rate]) for (const [ip] of m) if (!recent(m, ip, FAIL_WINDOW).length) m.delete(ip); }, 60_000);
  sweep.unref?.();

  // Erste Zeile lesen; Rest (falls schon mitgekommen) bleibt im Socket
  function firstLine(s, cb) {
    let buf = Buffer.alloc(0);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      // TLS statt Anmeldung (0x16 = Handshake): jemand hat den Vermittler wie einen Haupt-PC angesprochen
      if (buf[0] === 0x16) { s.off('data', onData); return cb(null, 'tls'); }
      const i = buf.indexOf(10);
      if (i < 0) { if (buf.length > MAX_LINE) s.destroy(); return; }
      s.off('data', onData);
      s.pause();
      const rest = buf.subarray(i + 1);
      if (rest.length) s.unshift(rest);
      let m; try { m = JSON.parse(buf.subarray(0, i).toString('utf8')); } catch { m = null; }
      cb(m && typeof m === 'object' ? m : null);
    };
    s.on('data', onData);
  }

  function onConnection(s) {
    const ip = addr(s);
    s.on('error', () => {});
    s.setNoDelay(true);
    if (recent(fails, ip, FAIL_WINDOW).length >= FAIL_LIMIT || recent(rate, ip, RATE_WINDOW).length >= RATE_LIMIT) return s.destroy();
    note(rate, ip, RATE_WINDOW);
    const nonce = crypto.randomBytes(16).toString('hex');
    const timer = setTimeout(() => s.destroy(), AUTH_TIMEOUT);
    send(s, { t: 'hello', v: 2, nonce });
    firstLine(s, (m, kind) => {
      clearTimeout(timer);
      if (kind === 'tls') return fail(s, ip, 'verschlüsselte Verbindung statt Anmeldung – vermutlich wurde in Swapline die Adresse des Vermittlers als Haupt-PC eingetragen (richtig: Kopplungslink vom Haupt-PC)');
      if (!m) return fail(s, ip, 'ungültige Anmeldung');
      if (m.t === 'host') return onHost(s, ip, nonce, m);
      if (m.t === 'accept') return onAccept(s, ip, nonce, m);
      if (m.t === 'dial') return onDial(s, ip, nonce, m);
      fail(s, ip, 'unbekannt');
    });
  }

  function onHost(s, ip, nonce, m) {
    // alter Einrichtungscode (gemeinsames Kennwort, Relay 0.2): gibt es nicht mehr
    if (m.key === undefined) { send(s, { t: 'error', error: 'veraltet' }); note(fails, ip, FAIL_WINDOW); log(`abgelehnt ${ip}: alter Einrichtungscode (gemeinsames Kennwort)`); return s.end(); }
    const e = entryOf(m.key);
    if (!e || !HEX16.test(m.hostId || '') || !same(m.mac, hmac(e.key, `host|${nonce}|${m.hostId}`))) return fail(s, ip, 'Haupt-PC: falsche Anmeldung');
    if (e.hostId && e.hostId !== m.hostId) return fail(s, ip, `Haupt-PC: Einrichtungscode „${e.name}“ gehört zu einem anderen PC`);
    if (!e.approved) {
      waiting.set(e.id, { hostId: m.hostId, ip, since: Date.now() });
      onPending({ id: e.id, hostId: m.hostId, ip });
      log(`Haupt-PC ${m.hostId.slice(0, 6)}… (${ip}) wartet auf Freigabe („${e.name}“)`);
      send(s, { t: 'error', error: 'pending' });
      return s.end();
    }
    waiting.delete(e.id);
    hosts.get(m.hostId)?.socket.destroy(); // nur eine Steuerverbindung je Haupt-PC (gleicher Schlüssel = gleicher Besitzer)
    const h = { socket: s, entry: e.id, pipes: new Set(), ip, since: Date.now() };
    hosts.set(m.hostId, h);
    s.setKeepAlive(true, 30_000);
    s.resume();
    send(s, { t: 'registered' });
    log(`Haupt-PC „${e.name}“ ${m.hostId.slice(0, 6)}… verbunden (${ip})`);
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', d => {
      buf += d;
      if (buf.length > 64 * 1024) return s.destroy();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg?.t === 'reject' && typeof msg.id === 'string') {
          const p = pending.get(msg.id);
          if (p?.hostId === m.hostId) { pending.delete(msg.id); clearTimeout(p.timer); note(fails, p.ip, FAIL_WINDOW); send(p.device, { t: 'error', error: 'abgelehnt' }); p.device.end(); }
        }
        else if (msg?.t === 'ping') send(s, { t: 'pong' });
      }
    });
    s.on('close', () => { if (hosts.get(m.hostId) === h) { hosts.delete(m.hostId); log(`Haupt-PC „${e.name}“ ${m.hostId.slice(0, 6)}… getrennt`); } });
  }

  function onDial(s, ip, nonce, m) {
    const h = HEX16.test(m.hostId || '') && hosts.get(m.hostId);
    if (!h) { send(s, { t: 'error', error: 'offline' }); return s.end(); }
    if (typeof m.mac !== 'string' || !/^[0-9a-f]{64}$/.test(m.mac) || !WHO.test(m.who || '')) return fail(s, ip, 'Gerät: ungültig (veraltete App?)');
    const mine = [...pending.values()].filter(p => p.hostId === m.hostId).length;
    if (h.pipes.size + mine >= maxPipesPerHost || openPipes() >= maxPipes) { send(s, { t: 'error', error: 'voll' }); return s.end(); }
    const id = crypto.randomBytes(8).toString('hex');
    // Prüfung durch den Haupt-PC; schlägt sie fehl, zählt das als Fehlversuch dieser Adresse
    const timer = setTimeout(() => { if (pending.delete(id)) fail(s, ip, 'Gerät: keine Antwort / abgelehnt'); }, DIAL_TIMEOUT);
    pending.set(id, { device: s, hostId: m.hostId, timer, ip });
    s.on('close', () => { const p = pending.get(id); if (p) { clearTimeout(p.timer); pending.delete(id); } });
    send(h.socket, { t: 'incoming', id, nonce, mac: m.mac, who: m.who, from: ip });
  }

  function onAccept(s, ip, nonce, m) {
    const p = typeof m.id === 'string' && pending.get(m.id);
    const e = p && entryForHost(p.hostId);
    if (!p || !e || !same(m.mac, hmac(e.key, `accept|${nonce}|${m.id}`))) return fail(s, ip, 'Datenverbindung: falsche Anmeldung');
    pending.delete(m.id);
    clearTimeout(p.timer);
    const h = hosts.get(p.hostId);
    if (!h) { p.device.destroy(); return s.destroy(); }
    // ab hier nur noch durchreichen (TLS zwischen Gerät und Haupt-PC)
    send(p.device, { t: 'ok' });
    s.setKeepAlive(true, 30_000); p.device.setKeepAlive(true, 30_000);
    s.pipe(p.device); p.device.pipe(s);
    s.resume(); p.device.resume();
    const pipe = { a: s, b: p.device };
    h.pipes.add(pipe);
    const end = () => { h.pipes.delete(pipe); s.destroy(); p.device.destroy(); };
    s.on('close', end); p.device.on('close', end);
  }

  const server = net.createServer(onConnection);
  server.maxConnections = maxConnections; // Obergrenze gleichzeitiger Verbindungen insgesamt
  return {
    server,
    listen: (port, host) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); }); }),
    close: () => { clearInterval(sweep); for (const h of hosts.values()) { h.socket.destroy(); for (const p of h.pipes) { p.a.destroy(); p.b.destroy(); } } server.close(); },
    // nach Änderung von hosts.json: entfernte oder nicht mehr freigegebene PCs sofort trennen
    refresh: () => {
      for (const [hostId, h] of hosts) if (!entryForHost(hostId)) { log(`Haupt-PC ${hostId.slice(0, 6)}… entfernt – getrennt`); h.socket.destroy(); for (const p of h.pipes) { p.a.destroy(); p.b.destroy(); } }
      for (const id of [...waiting.keys()]) { const e = entryOf(id); if (!e || e.approved) waiting.delete(id); }
    },
    stats: () => ({ hosts: hosts.size, pipes: [...hosts.values()].reduce((n, h) => n + h.pipes.size, 0), pending: pending.size }),
    // Für die Oberfläche: angemeldete und wartende Haupt-PCs (Kennung gekürzt), gesperrte Adressen
    details: () => ({
      hosts: [...hosts.entries()].map(([id, h]) => ({ id: id.slice(0, 6), entry: h.entry, ip: h.ip, since: h.since, pipes: h.pipes.size })),
      waiting: [...waiting.entries()].map(([entry, w]) => ({ entry, hostId: w.hostId, ip: w.ip, since: w.since })),
      blocked: [...fails.keys()].filter(ip => recent(fails, ip, FAIL_WINDOW).length >= FAIL_LIMIT).length,
    }),
  };
}

module.exports = { createRelay, hmac, newKey, newEntryId };
