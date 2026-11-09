// Haupt-PC ↔ Swapline-Vermittler (relay/relay.js): hält eine Steuerverbindung nach außen zum Vermittler. Meldet sich ein
// Gerät dort, prüft DIESER PC dessen Berechtigung (HMAC mit dem dialKey, den nur gekoppelte Geräte kennen) und baut dann
// eine Datenverbindung auf. Die übergibt er an den Fernzugriff (src/remote.js) wie eine direkte Verbindung – darin läuft
// die TLS-PSK-Verbindung zum Gerät, der Vermittler sieht nur verschlüsselte Bytes.
'use strict';
const net = require('node:net');
const crypto = require('node:crypto');

const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const CONNECT_TIMEOUT = 15_000;

// Eine Zeile (JSON) lesen; was danach schon angekommen ist, bleibt im Socket
function readLine(s, timeout = CONNECT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const done = (err, v) => { clearTimeout(t); s.off('data', onData); s.off('error', onErr); s.off('close', onClose); err ? reject(err) : resolve(v); };
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const i = buf.indexOf(10);
      if (i < 0) { if (buf.length > 64 * 1024) done(new Error('Zeile zu lang')); return; }
      s.pause();
      const rest = buf.subarray(i + 1);
      if (rest.length) s.unshift(rest);
      let m; try { m = JSON.parse(buf.subarray(0, i).toString('utf8')); } catch { return done(new Error('ungültige Antwort')); }
      done(null, m);
    };
    const onErr = e => done(e);
    const onClose = () => done(new Error('Verbindung beendet'));
    const t = setTimeout(() => done(new Error('Zeitüberschreitung')), timeout);
    s.on('data', onData); s.on('error', onErr); s.on('close', onClose);
    s.resume();
  });
}

function dial(address, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: address, port, timeout: CONNECT_TIMEOUT });
    s.once('connect', () => { s.setTimeout(0); resolve(s); });
    s.once('timeout', () => { s.destroy(); reject(new Error('Zeitüberschreitung')); });
    s.once('error', reject);
  });
}

// cfg: { address, port, secret, hostId, dialKey }; onSocket(socket, from) übernimmt eine fertige Datenverbindung
function createRelayLink({ onSocket, onStatus = () => {}, log = () => {} }) {
  let cfg = null, ctrl = null, retry = null, ping = null, delay = 2000, state = 'off', detail = '';
  const setState = (s, d = '') => { state = s; detail = d; onStatus(s, d); };

  async function accept(m) {
    // nur Geräte, die den dialKey dieses PCs kennen (gekoppelte Geräte bekommen ihn über die verschlüsselte Verbindung)
    const c = cfg;
    if (!c || !same(m.mac, hmac(c.dialKey, `dial|${m.nonce}|${c.hostId}`))) {
      log(`Vermittler: Gerät ${String(m.from || '?').slice(0, 64)} abgelehnt (falsche Kennung)`);
      if (ctrl && !ctrl.destroyed) ctrl.write(JSON.stringify({ t: 'reject', id: m.id }) + '\n');
      return;
    }
    let s;
    try {
      s = await dial(c.address, c.port);
      const hello = await readLine(s);
      if (hello?.t !== 'hello' || typeof hello.nonce !== 'string') throw new Error('kein Vermittler');
      s.write(JSON.stringify({ t: 'accept', id: m.id, mac: hmac(c.secret, `accept|${hello.nonce}|${m.id}`) }) + '\n');
      s.setKeepAlive(true, 30_000);
      s.setNoDelay(true);
      onSocket(s, String(m.from || '').slice(0, 64));
    } catch (e) { s?.destroy(); log('Vermittler: Datenverbindung fehlgeschlagen – ' + e.message); }
  }

  async function connect() {
    const c = cfg;
    if (!c) return;
    setState('connecting');
    let s;
    try {
      s = await dial(c.address, c.port);
      if (cfg !== c) return s.destroy();
      const hello = await readLine(s);
      if (hello?.t !== 'hello' || typeof hello.nonce !== 'string') throw new Error('kein Swapline-Vermittler');
      s.write(JSON.stringify({ t: 'host', hostId: c.hostId, mac: hmac(c.secret, `host|${hello.nonce}|${c.hostId}`) }) + '\n');
      const r = await readLine(s);
      if (r?.t !== 'registered') throw new Error(r?.error === 'voll' ? 'Vermittler ist voll' : 'Anmeldung abgelehnt – Kennwort prüfen');
    } catch (e) {
      s?.destroy();
      if (cfg !== c) return;
      setState('error', e.message);
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 60_000);
      return;
    }
    ctrl = s; delay = 2000;
    s.setKeepAlive(true, 30_000);
    setState('connected');
    ping = setInterval(() => { if (!s.destroyed) s.write('{"t":"ping"}\n'); }, 60_000);
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', d => {
      buf += d;
      if (buf.length > 64 * 1024) return s.destroy();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.t === 'incoming' && typeof m.id === 'string' && typeof m.nonce === 'string') accept(m);
      }
    });
    s.on('error', () => {});
    s.on('close', () => {
      clearInterval(ping);
      if (ctrl === s) ctrl = null;
      if (cfg !== c) return;
      setState('error', 'Verbindung zum Vermittler getrennt');
      retry = setTimeout(connect, delay);
    });
    s.resume();
  }

  return {
    get state() { return state; },
    get detail() { return detail; },
    use(next) { // next: { address, port, secret, hostId, dialKey } oder null
      clearTimeout(retry); clearInterval(ping);
      ctrl?.destroy(); ctrl = null;
      cfg = next; delay = 2000;
      if (next) connect(); else setState('off');
    },
  };
}

module.exports = { createRelayLink, hmac, readLine };
