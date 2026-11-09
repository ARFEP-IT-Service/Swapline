// Vermittler (relay/relay.js) + Haupt-PC-Anbindung (src/relay-link.js) + Fernzugriff (src/remote.js), alles echt auf
// 127.0.0.1: Gerät koppelt und arbeitet nur über den Vermittler. Wird von tests/run.js gestartet, Ergebnis als JSON.
'use strict';
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { createRelay, hmac } = require(path.join(__dirname, '..', 'relay', 'relay.js'));
const { createRelayLink, readLine } = require(path.join(__dirname, '..', 'src', 'relay-link.js'));
const remote = require(path.join(__dirname, '..', 'src', 'remote.js'));

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };
const OPTS = { ciphers: 'ECDHE-PSK-CHACHA20-POLY1305', minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' };

// Gerät: über den Vermittler zum Haupt-PC, danach TLS-PSK auf derselben Verbindung
async function dialRelay(port, hostId, dialKey) {
  const s = net.connect(port, '127.0.0.1');
  await new Promise((res, rej) => { s.once('connect', res); s.once('error', rej); });
  const hello = await readLine(s);
  s.write(JSON.stringify({ t: 'dial', hostId, mac: hmac(dialKey, `dial|${hello.nonce}|${hostId}`) }) + '\n');
  const r = await readLine(s).catch(e => ({ t: 'error', error: e.message }));
  if (r.t !== 'ok') { s.destroy(); throw new Error(r.error || 'abgelehnt'); }
  return s;
}
function tlsOver(socket, identity, psk) {
  return new Promise((resolve, reject) => {
    const t = tls.connect({ ...OPTS, socket, pskCallback: () => ({ psk, identity }), checkServerIdentity: () => undefined }, () => resolve(t));
    t.once('error', reject);
  });
}
function lines(t) {
  const q = []; let buf = '', wait = null;
  t.setEncoding('utf8');
  t.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { q.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } if (wait && q.length) { const w = wait; wait = null; w(q.shift()); } });
  return () => new Promise(r => (q.length ? r(q.shift()) : (wait = r)));
}

(async () => {
  const secret = crypto.randomBytes(24).toString('hex');
  const relay = createRelay({ secret });
  const relayPort = await relay.listen(0, '127.0.0.1');

  let devices = [];
  const fails = [];
  const host = remote.createHost({
    getDevices: () => devices, saveDevices: l => { devices = l; },
    encrypt: s => Buffer.from(s).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString(),
    confirmPair: async () => true,
    dispatch: async (dev, ch, args) => (ch === 'echo' ? { device: dev.name, args } : null),
    log: m => { if (/abgelehnt/.test(m)) fails.push(m); }, onChange: () => {},
  });
  const hostPort = await host.start(0, '127.0.0.1');
  const hostId = crypto.randomBytes(8).toString('hex'), dialKey = crypto.randomBytes(32).toString('hex');

  // falsches Kennwort des Haupt-PCs: keine Anmeldung
  const states = [];
  const bad = createRelayLink({ onSocket: () => {}, onStatus: s => states.push(s) });
  bad.use({ address: '127.0.0.1', port: relayPort, secret: 'x'.repeat(48), hostId, dialKey });
  await until(() => states.includes('error'));
  check('Vermittler: Haupt-PC mit falschem Kennwort abgelehnt', states.includes('error') && !states.includes('connected'), states.join());
  bad.use(null);

  // Gerät, solange der Haupt-PC nicht angemeldet ist
  let offline = ''; try { await dialRelay(relayPort, hostId, dialKey); } catch (e) { offline = e.message; }
  check('Vermittler: Haupt-PC offline wird gemeldet', offline === 'offline', offline);

  const link = createRelayLink({ onSocket: (s, from) => host.adopt(s, from), onStatus: () => {} });
  link.use({ address: '127.0.0.1', port: relayPort, secret, hostId, dialKey });
  check('Vermittler: Haupt-PC angemeldet', await until(() => link.state === 'connected'), link.state + ' ' + link.detail);

  // Koppeln nur über den Vermittler
  const { code } = host.startPairing();
  const secret16 = remote.b32decode(code);
  const pairKey = crypto.createHash('sha256').update('swapline-pair-v1').update(secret16).digest();
  const pt = await tlsOver(await dialRelay(relayPort, hostId, dialKey), 'pair', pairKey);
  const nextP = lines(pt);
  pt.write(JSON.stringify({ t: 'pair', name: 'Handy' }) + '\n');
  const paired = await nextP();
  check('Vermittler: Koppeln über den Vermittler', paired.t === 'paired' && /^[0-9a-f]{16}$/.test(paired.deviceId), JSON.stringify(paired).slice(0, 80));
  check('Vermittler: Haupt-PC sieht die Adresse des Geräts (relay:…)', devices[0]?.lastAddress?.startsWith('relay:'), devices[0]?.lastAddress);
  pt.destroy();

  // Anfrage über den Vermittler (Ende-zu-Ende TLS-PSK mit dem Geräteschlüssel)
  const dt = await tlsOver(await dialRelay(relayPort, hostId, dialKey), paired.deviceId, Buffer.from(paired.key, 'base64'));
  const next = lines(dt);
  dt.write(JSON.stringify({ t: 'req', id: 1, ch: 'echo', args: ['hallo'] }) + '\n');
  const res = await next();
  check('Vermittler: Anfrage und Antwort durch den Vermittler', res.t === 'res' && res.value?.device === 'Handy' && res.value.args[0] === 'hallo', JSON.stringify(res));
  check('Vermittler: Verbindung läuft als durchgereichte Leitung', relay.stats().pipes >= 1, JSON.stringify(relay.stats()));
  dt.destroy();

  // Swapline am PC als Gerät (src/remote.js): direkte Adresse nicht erreichbar → automatisch über den Vermittler
  const closedPort = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const route = { address: '127.0.0.1', port: relayPort, hostId, dialKey };
  const p2 = await remote.pair({ addresses: ['127.0.0.1'], port: closedPort, code: host.startPairing().code, name: 'Laptop', relay: route });
  check('Vermittler: PC koppelt über den Vermittler, wenn die Adresse nicht erreichbar ist', p2.via === 'relay' && /^[0-9a-f]{16}$/.test(p2.deviceId), JSON.stringify({ via: p2.via }));
  const client = remote.createClient({ onEvent: () => {}, onStatus: () => {}, log: () => {} });
  client.use({ id: 'x', addresses: ['127.0.0.1'], port: closedPort, deviceId: p2.deviceId, key: Buffer.from(p2.key, 'base64'), relay: route });
  await until(() => client.state === 'connected', 15000);
  const echo = await client.call('echo', ['über Vermittler']).catch(e => ({ error: e.message }));
  check('Vermittler: PC verbindet sich über den Vermittler und arbeitet', client.via === 'relay' && echo?.device === 'Laptop' && echo.args?.[0] === 'über Vermittler', JSON.stringify({ via: client.via, echo }));
  client.use({ id: 'x', addresses: ['127.0.0.1'], port: hostPort, deviceId: p2.deviceId, key: Buffer.from(p2.key, 'base64'), relay: route });
  await until(() => client.state === 'connected', 15000);
  check('Vermittler: direkte Adresse geht vor, wenn erreichbar', client.via === '127.0.0.1', client.via);
  client.use(null);
  let wrong = ''; try { await remote.pair({ addresses: [], port: closedPort, code: '0'.repeat(26), name: 'x', relay: route }); } catch (e) { wrong = e.message; }
  check('Vermittler: falscher Code über den Vermittler wird abgelehnt', wrong === 'closed' || /alert|ECONNRESET|socket/i.test(wrong), wrong);

  // falscher dialKey: Haupt-PC lehnt ab, Vermittler verbindet nicht
  let rej = ''; try { await dialRelay(relayPort, hostId, crypto.randomBytes(32).toString('hex')); } catch (e) { rej = e.message; }
  check('Vermittler: Gerät ohne gültige Kennung abgelehnt', rej === 'abgelehnt', rej);

  // falscher Geräteschlüssel über den Vermittler: Sperre trifft „relay:…“, nicht direkte Verbindungen
  for (let i = 0; i < 10; i++) { try { await tlsOver(await dialRelay(relayPort, hostId, dialKey), paired.deviceId, crypto.randomBytes(32)); } catch {} }
  await new Promise(r => setTimeout(r, 300));
  const direct = await new Promise(resolve => {
    const t = tls.connect({ ...OPTS, host: '127.0.0.1', port: hostPort, pskCallback: () => ({ psk: Buffer.from(paired.key, 'base64'), identity: paired.deviceId }), checkServerIdentity: () => undefined }, () => { t.destroy(); resolve(true); });
    t.on('error', () => resolve(false));
  });
  check('Vermittler: Fehlversuche über den Vermittler sperren keine direkten Verbindungen', direct && fails.some(f => f.includes('relay:')), fails.slice(-1)[0]);

  // Adresse des Vermittlers versehentlich als Haupt-PC eingetragen: klare Meldung im Protokoll, Fehler beim Koppeln erkennbar
  const rlog = [];
  const r2 = createRelay({ secret, log: m => rlog.push(m) });
  const r2Port = await r2.listen(0, '127.0.0.1');
  let perr = {}; try { await remote.pair({ address: '127.0.0.1', port: r2Port, code: '0'.repeat(26), name: 'x' }); } catch (e) { perr = e; }
  await until(() => rlog.length > 0, 2000);
  check('Vermittler: Adresse des Vermittlers als Haupt-PC → verständlicher Hinweis', /WRONG_VERSION_NUMBER|EPROTO/.test(String(perr.code)) && rlog.some(l => /statt Anmeldung.*Kopplungslink/.test(l)), `${perr.code} | ${rlog.join(' | ')}`);
  r2.close();

  link.use(null); host.stop(); relay.close();
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
})().catch(e => { process.stdout.write(JSON.stringify([...results, { name: 'Vermittler-Test', ok: false, detail: e.stack || e.message }])); process.exit(0); });
