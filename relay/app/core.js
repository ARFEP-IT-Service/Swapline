// Swapline-Vermittler (Relay): verbindet Geräte (z. B. die Android-App) mit einem Haupt-PC, ohne Portfreigabe am Router
// des PCs. PC und Gerät bauen beide eine Verbindung NACH AUSSEN zum Vermittler auf; der Vermittler reicht danach nur
// noch Bytes durch. Darin läuft unverändert die TLS-PSK-Verbindung zwischen Gerät und PC (Ende-zu-Ende) – der
// Vermittler kennt keine Geräteschlüssel und sieht keine Inhalte.
//
// Anmeldung ohne Passwort auf der Leitung (HMAC-SHA256 über eine Zufallszahl des Vermittlers):
//   Vermittler → jede neue Verbindung:  {"t":"hello","v":1,"nonce":"<hex>"}
//   Haupt-PC (Steuerverbindung):         {"t":"host","hostId":"<hex16>","mac":HMAC(secret, "host|nonce|hostId")}
//   Haupt-PC (Datenverbindung):          {"t":"accept","id":"<id>","mac":HMAC(secret, "accept|nonce|id")}
//   Gerät:                               {"t":"dial","hostId":"<hex16>","mac":HMAC(dialKey, "dial|nonce|hostId")}
// Die Prüfung des Geräts übernimmt der Haupt-PC (nur er kennt den dialKey): der Vermittler meldet
// {"t":"incoming","id","nonce","mac","from"}; der PC antwortet mit einer Datenverbindung (accept) oder {"t":"reject","id"}.
// Danach bekommt das Gerät {"t":"ok"} und beide Verbindungen werden 1:1 verbunden.
//
// Benutzt von der App „Swapline Relay“ (Dienst + Oberfläche, relay/app) und von relay/relay.js (Start ohne App, z. B. Linux).
'use strict';
const net = require('node:net');
const crypto = require('node:crypto');

const HEX16 = /^[0-9a-f]{16}$/;
const MAX_LINE = 4096;            // Anmeldezeile
const AUTH_TIMEOUT = 10_000;      // so lange darf eine neue Verbindung bis zur Anmeldung brauchen
const DIAL_TIMEOUT = 15_000;      // so lange wartet ein Gerät auf den Haupt-PC
const FAIL_WINDOW = 10 * 60_000, FAIL_LIMIT = 10;  // fehlgeschlagene Anmeldungen je Adresse, dann Sperre
const RATE_WINDOW = 60_000, RATE_LIMIT = 60;       // neue Verbindungen je Adresse und Minute

const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function createRelay({ secret, maxHosts = 50, maxPipesPerHost = 20, log = () => {} }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('secret: mindestens 32 Zeichen');
  const hosts = new Map();    // hostId -> { socket, write, pipes: Set }
  const pending = new Map();  // id -> { device, hostId, timer }
  const fails = new Map(), rate = new Map();
  const recent = (m, ip, win) => (m.get(ip) || []).filter(t => Date.now() - t < win);
  const note = (m, ip, win) => m.set(ip, [...recent(m, ip, win), Date.now()]);
  const addr = s => String(s.remoteAddress || '').replace(/^::ffff:/, '');
  const send = (s, o) => { if (!s.destroyed) s.write(JSON.stringify(o) + '\n'); };
  const fail = (s, ip, why) => { note(fails, ip, FAIL_WINDOW); log(`abgelehnt ${ip}: ${why}`); s.destroy(); };

  // Erste Zeile lesen; Rest (falls schon mitgekommen) bleibt im Socket
  function firstLine(s, cb) {
    let buf = Buffer.alloc(0);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
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
    send(s, { t: 'hello', v: 1, nonce });
    firstLine(s, m => {
      clearTimeout(timer);
      if (!m) return fail(s, ip, 'ungültige Anmeldung');
      if (m.t === 'host') return onHost(s, ip, nonce, m);
      if (m.t === 'accept') return onAccept(s, ip, nonce, m);
      if (m.t === 'dial') return onDial(s, ip, nonce, m);
      fail(s, ip, 'unbekannt');
    });
  }

  function onHost(s, ip, nonce, m) {
    if (!HEX16.test(m.hostId || '') || !same(m.mac, hmac(secret, `host|${nonce}|${m.hostId}`))) return fail(s, ip, 'Haupt-PC: falsche Anmeldung');
    if (!hosts.has(m.hostId) && hosts.size >= maxHosts) { send(s, { t: 'error', error: 'voll' }); return s.end(); }
    hosts.get(m.hostId)?.socket.destroy(); // nur eine Steuerverbindung je Haupt-PC
    const h = { socket: s, pipes: new Set(), ip, since: Date.now() };
    hosts.set(m.hostId, h);
    s.setKeepAlive(true, 30_000);
    s.resume();
    send(s, { t: 'registered' });
    log(`Haupt-PC ${m.hostId.slice(0, 6)}… verbunden (${ip})`);
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
    s.on('close', () => { if (hosts.get(m.hostId) === h) { hosts.delete(m.hostId); log(`Haupt-PC ${m.hostId.slice(0, 6)}… getrennt`); } });
  }

  function onDial(s, ip, nonce, m) {
    const h = HEX16.test(m.hostId || '') && hosts.get(m.hostId);
    if (!h) { send(s, { t: 'error', error: 'offline' }); return s.end(); }
    if (h.pipes.size + [...pending.values()].filter(p => p.hostId === m.hostId).length >= maxPipesPerHost) { send(s, { t: 'error', error: 'voll' }); return s.end(); }
    if (typeof m.mac !== 'string' || !/^[0-9a-f]{64}$/.test(m.mac)) return fail(s, ip, 'Gerät: ungültig');
    const id = crypto.randomBytes(8).toString('hex');
    // Prüfung durch den Haupt-PC; schlägt sie fehl, zählt das als Fehlversuch dieser Adresse
    const timer = setTimeout(() => { if (pending.delete(id)) fail(s, ip, 'Gerät: keine Antwort / abgelehnt'); }, DIAL_TIMEOUT);
    pending.set(id, { device: s, hostId: m.hostId, timer, ip });
    s.on('close', () => { const p = pending.get(id); if (p) { clearTimeout(p.timer); pending.delete(id); } });
    send(h.socket, { t: 'incoming', id, nonce, mac: m.mac, from: ip });
  }

  function onAccept(s, ip, nonce, m) {
    const p = typeof m.id === 'string' && pending.get(m.id);
    if (!p || !same(m.mac, hmac(secret, `accept|${nonce}|${m.id}`))) return fail(s, ip, 'Datenverbindung: falsche Anmeldung');
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
  return {
    server,
    listen: (port, host) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); }); }),
    close: () => { for (const h of hosts.values()) { h.socket.destroy(); for (const p of h.pipes) { p.a.destroy(); p.b.destroy(); } } server.close(); },
    stats: () => ({ hosts: hosts.size, pipes: [...hosts.values()].reduce((n, h) => n + h.pipes.size, 0), pending: pending.size }),
    // Für die Oberfläche: angemeldete Haupt-PCs (Kennung gekürzt), gesperrte Adressen
    details: () => ({
      hosts: [...hosts.entries()].map(([id, h]) => ({ id: id.slice(0, 6), ip: h.ip, since: h.since, pipes: h.pipes.size })),
      blocked: [...fails.keys()].filter(ip => recent(fails, ip, FAIL_WINDOW).length >= FAIL_LIMIT).length,
    }),
  };
}

module.exports = { createRelay, hmac };

