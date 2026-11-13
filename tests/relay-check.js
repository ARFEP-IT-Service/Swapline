// Vermittler (relay/app/core.js) + Haupt-PC-Anbindung (src/relay-link.js) + Fernzugriff (src/remote.js), alles echt auf
// 127.0.0.1: Gerät koppelt und arbeitet nur über den Vermittler. Wird von tests/run.js gestartet, Ergebnis als JSON.
// Angriffstests: fremder PC mit altem Einrichtungscode, PC ohne Freigabe, entfernter PC, entferntes Gerät, Grenzen.
'use strict';
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { createRelay, hmac } = require(path.join(__dirname, '..', 'relay', 'relay.js'));
const { createRelayLink, readLine, dialMac, checkDial, pairDialKey } = require(path.join(__dirname, '..', 'src', 'relay-link.js'));
const remote = require(path.join(__dirname, '..', 'src', 'remote.js'));

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };
const OPTS = { ciphers: 'ECDHE-PSK-CHACHA20-POLY1305', minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' };
const hex = n => crypto.randomBytes(n).toString('hex');

// Gerät: über den Vermittler zum Haupt-PC (als „who“ mit dessen dialKey), danach TLS-PSK auf derselben Verbindung
async function dialRelay(port, hostId, dialKey, who = 'pair') {
  const s = net.connect(port, '127.0.0.1');
  await new Promise((res, rej) => { s.once('connect', res); s.once('error', rej); });
  const hello = await readLine(s);
  s.write(JSON.stringify({ t: 'dial', hostId, who, mac: dialMac(dialKey, hello.nonce, hostId, who) }) + '\n');
  const r = await readLine(s).catch(e => ({ t: 'error', error: e.message }));
  if (r.t !== 'ok') { s.destroy(); throw new Error(r.error || 'abgelehnt'); }
  return s;
}
// Haupt-PC-Anmeldung von Hand (für Angriffstests): liefert die Antwort des Vermittlers
async function hostLogin(port, msg) {
  const s = net.connect(port, '127.0.0.1');
  await new Promise((res, rej) => { s.once('connect', res); s.once('error', rej); });
  const hello = await readLine(s);
  s.write(JSON.stringify(msg(hello.nonce)) + '\n');
  const r = await readLine(s).catch(e => ({ t: 'closed', error: e.message }));
  s.destroy();
  return r;
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
  // Einträge wie in hosts.json: je Haupt-PC ein eigener Schlüssel, Freigabe in der Relay-App
  const entry = { id: hex(4), name: 'Büro', key: hex(32), hostId: null, approved: false };
  let entries = [entry];
  const pendings = [];
  const relay = createRelay({ getHosts: () => entries, onPending: p => pendings.push(p) });
  const relayPort = await relay.listen(0, '127.0.0.1');

  let devices = [];
  const fails = [];
  const host = remote.createHost({
    getDevices: () => devices, saveDevices: l => { devices = l; },
    encrypt: s => Buffer.from(s).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString(),
    confirmPair: async () => ({ ok: true, rights: {} }), // Standard beim Koppeln: keine weitergehenden Rechte
    dispatch: async (dev, ch, args) => (ch === 'echo' ? { device: dev.name, args } : null),
    log: m => { if (/abgelehnt/.test(m)) fails.push(m); }, onChange: () => {},
  });
  const hostPort = await host.start(0, '127.0.0.1');
  const hostId = hex(8);
  // Prüfung beim Haupt-PC wie in src/main.js: Gerät mit seinem eigenen dialKey, Koppeln mit dem Schlüssel aus dem Code
  const verifyDial = (who, nonce, mac) => {
    if (who === 'pair') { const k = host.pairDialKey(); return !!k && checkDial(k, nonce, hostId, 'pair', mac); }
    const d = devices.find(x => x.id === who);
    return !!d?.dialKeyEnc && checkDial(Buffer.from(d.dialKeyEnc, 'base64').toString(), nonce, hostId, who, mac);
  };

  // Angriff: fremder PC mit altem Einrichtungscode (srelay1, gemeinsames Kennwort ohne Eintrag)
  const legacy = await hostLogin(relayPort, n => ({ t: 'host', hostId: hex(8), mac: hmac('x'.repeat(48), `host|${n}|00`) }));
  check('Angriff: fremder PC mit altem Einrichtungscode (srelay1) abgelehnt', legacy.t === 'error' && legacy.error === 'veraltet', JSON.stringify(legacy));
  const states = [];
  const oldLink = createRelayLink({ onSocket: () => {}, onStatus: (s, d) => states.push(s + ':' + d) });
  oldLink.use({ address: '127.0.0.1', port: relayPort, keyId: undefined, key: 'x'.repeat(48), hostId: hex(8), verifyDial: () => true });
  await until(() => states.some(s => s.startsWith('error')));
  check('Angriff: alter Code → Haupt-PC zeigt „Alter Einrichtungscode“', states.some(s => /Alter Einrichtungscode/.test(s)), states.join(' | '));
  oldLink.use(null);
  // Angriff: fremder PC rät einen Eintrag (richtige ID, falscher Schlüssel)
  const guess = await hostLogin(relayPort, n => ({ t: 'host', key: entry.id, hostId: hex(8), mac: hmac(hex(32), `host|${n}|x`) }));
  check('Angriff: fremder PC ohne Schlüssel des Eintrags abgelehnt', guess.t === 'closed', JSON.stringify(guess));

  // Eigener PC mit Einrichtungscode: wartet, bis „Erlauben“ geklickt ist
  const link = createRelayLink({ onSocket: (s, from) => host.adopt(s, from), onStatus: () => {} });
  const cfg = { address: '127.0.0.1', port: relayPort, keyId: entry.id, key: entry.key, hostId, verifyDial };
  link.use(cfg);
  await until(() => link.state === 'pending');
  check('Neuer PC wartet auf „Erlauben“ in der Relay-App', link.state === 'pending' && pendings.some(p => p.id === entry.id && p.hostId === hostId) && relay.details().waiting.length === 1, link.state + ' ' + link.detail);
  let offline = ''; try { await dialRelay(relayPort, hostId, hex(32)); } catch (e) { offline = e.message; }
  check('Vor der Freigabe kein Gerätezugang (Haupt-PC gilt als offline)', offline === 'offline', offline);
  // erlauben (wie approveHost in relay/app/paths.js): Eintrag an diese hostId binden
  entry.hostId = hostId; entry.approved = true; relay.refresh();
  link.use(cfg); // statt 15 s auf den nächsten Versuch zu warten
  check('Nach „Erlauben“ angemeldet', await until(() => link.state === 'connected'), link.state + ' ' + link.detail);
  // Angriff: anderer PC mit demselben (kopierten) Einrichtungscode, aber anderer Kennung
  const stolen = await hostLogin(relayPort, n => { const h = hex(8); return { t: 'host', key: entry.id, hostId: h, mac: hmac(entry.key, `host|${n}|${h}`) }; });
  check('Angriff: kopierter Einrichtungscode auf einem anderen PC abgelehnt (an hostId gebunden)', stolen.t === 'closed', JSON.stringify(stolen));

  // Koppeln nur über den Vermittler: dialKey aus dem Einmal-Code (nicht im Link)
  const { code } = host.startPairing();
  const secret16 = remote.b32decode(code);
  const pairKey = crypto.createHash('sha256').update('swapline-pair-v1').update(secret16).digest();
  let wrongPair = ''; try { await dialRelay(relayPort, hostId, pairDialKey(crypto.randomBytes(16)), 'pair'); } catch (e) { wrongPair = e.message; }
  check('Koppeln über den Vermittler nur mit dem Schlüssel aus dem gültigen Code', wrongPair === 'abgelehnt', wrongPair);
  const pt = await tlsOver(await dialRelay(relayPort, hostId, pairDialKey(secret16), 'pair'), 'pair', pairKey);
  const nextP = lines(pt);
  pt.write(JSON.stringify({ t: 'pair', name: 'Handy' }) + '\n');
  const paired = await nextP();
  check('Vermittler: Koppeln über den Vermittler', paired.t === 'paired' && /^[0-9a-f]{16}$/.test(paired.deviceId) && /^[0-9a-f]{64}$/.test(paired.dialKey), JSON.stringify({ t: paired.t, id: paired.deviceId }));
  check('Neues Gerät ohne angehakte Rechte: kein „Alles erlauben“, kein „!“, keine Server, keine Projekte', devices[0] && !devices[0].allowBypass && !devices[0].allowBang && !devices[0].allowServers && !devices[0].allowProjects, JSON.stringify(devices[0] && { b: devices[0].allowBypass, x: devices[0].allowBang }));
  check('Vermittler: Haupt-PC sieht die Adresse des Geräts (relay:…)', devices[0]?.lastAddress?.startsWith('relay:'), devices[0]?.lastAddress);
  pt.destroy();
  let used = ''; try { await dialRelay(relayPort, hostId, pairDialKey(secret16), 'pair'); } catch (e) { used = e.message; }
  check('Kopplungsschlüssel gilt nach dem Koppeln nicht mehr', used === 'abgelehnt', used);

  // Anfrage über den Vermittler (Ende-zu-Ende TLS-PSK mit dem Geräteschlüssel), Gerät meldet sich mit seinem dialKey
  const dt = await tlsOver(await dialRelay(relayPort, hostId, paired.dialKey, paired.deviceId), paired.deviceId, Buffer.from(paired.key, 'base64'));
  const next = lines(dt);
  dt.write(JSON.stringify({ t: 'req', id: 1, ch: 'echo', args: ['hallo'] }) + '\n');
  const res = await next();
  check('Vermittler: Anfrage und Antwort durch den Vermittler', res.t === 'res' && res.value?.device === 'Handy' && res.value.args[0] === 'hallo', JSON.stringify(res));
  check('Vermittler: Verbindung läuft als durchgereichte Leitung', relay.stats().pipes >= 1, JSON.stringify(relay.stats()));
  dt.destroy();
  // dialKey gilt nur für das eigene Gerät
  let other = ''; try { await dialRelay(relayPort, hostId, paired.dialKey, hex(8)); } catch (e) { other = e.message; }
  check('dialKey eines Geräts gilt nicht unter fremder Geräte-ID', other === 'abgelehnt', other);

  // Swapline am PC als Gerät (src/remote.js): direkte Adresse nicht erreichbar → automatisch über den Vermittler
  const closedPort = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const p2 = await remote.pair({ addresses: ['127.0.0.1'], port: closedPort, code: host.startPairing().code, name: 'Laptop', relay: { address: '127.0.0.1', port: relayPort, hostId } });
  check('Vermittler: PC koppelt über den Vermittler, wenn die Adresse nicht erreichbar ist (eigener dialKey)', p2.via === 'relay' && /^[0-9a-f]{16}$/.test(p2.deviceId) && /^[0-9a-f]{64}$/.test(p2.dialKey || '') && p2.dialKey !== paired.dialKey, JSON.stringify({ via: p2.via }));
  const route = { address: '127.0.0.1', port: relayPort, hostId, dialKey: p2.dialKey };
  const client = remote.createClient({ onEvent: () => {}, onStatus: () => {}, log: () => {} });
  client.use({ id: 'x', addresses: ['127.0.0.1'], port: closedPort, deviceId: p2.deviceId, key: Buffer.from(p2.key, 'base64'), relay: route });
  await until(() => client.state === 'connected', 15000);
  const echo = await client.call('echo', ['über Vermittler']).catch(e => ({ error: e.message }));
  check('Vermittler: PC verbindet sich über den Vermittler und arbeitet', client.via === 'relay' && echo?.device === 'Laptop' && echo.args?.[0] === 'über Vermittler', JSON.stringify({ via: client.via, echo }));
  client.use({ id: 'x', addresses: ['127.0.0.1'], port: hostPort, deviceId: p2.deviceId, key: Buffer.from(p2.key, 'base64'), relay: route });
  await until(() => client.state === 'connected', 15000);
  check('Vermittler: direkte Adresse geht vor, wenn erreichbar', client.via === '127.0.0.1', client.via);
  client.use(null);

  // falscher Geräteschlüssel über den Vermittler: Sperre trifft „relay:…“, nicht direkte Verbindungen
  for (let i = 0; i < 10; i++) { try { await tlsOver(await dialRelay(relayPort, hostId, paired.dialKey, paired.deviceId), paired.deviceId, crypto.randomBytes(32)); } catch {} }
  await new Promise(r => setTimeout(r, 300));
  const direct = await new Promise(resolve => {
    const t = tls.connect({ ...OPTS, host: '127.0.0.1', port: hostPort, pskCallback: () => ({ psk: Buffer.from(paired.key, 'base64'), identity: paired.deviceId }), checkServerIdentity: () => undefined }, () => { t.destroy(); resolve(true); });
    t.on('error', () => resolve(false));
  });
  check('Vermittler: Fehlversuche über den Vermittler sperren keine direkten Verbindungen', direct && fails.some(f => f.includes('relay:')), fails.slice(-1)[0]);

  // Angriff: entferntes Gerät – sein dialKey gilt nicht mehr
  devices = devices.filter(d => d.id !== paired.deviceId);
  let gone = ''; try { await dialRelay(relayPort, hostId, paired.dialKey, paired.deviceId); } catch (e) { gone = e.message; }
  check('Angriff: entferntes Gerät wird schon beim Vermittler abgelehnt (dialKey ungültig)', gone === 'abgelehnt', gone);

  // Grenzen: Leitungen je Haupt-PC und insgesamt
  const small = createRelay({ getHosts: () => entries, maxPipesPerHost: 1, maxPipes: 1 });
  const smallPort = await small.listen(0, '127.0.0.1');
  const held = []; // Datenverbindungen offen halten (der Haupt-PC sperrt „relay:127.0.0.1“ nach den Fehlversuchen oben)
  const link2 = createRelayLink({ onSocket: s => held.push(s), onStatus: () => {} });
  link2.use({ ...cfg, port: smallPort });
  await until(() => link2.state === 'connected');
  const first = await dialRelay(smallPort, hostId, p2.dialKey, p2.deviceId).catch(e => e);
  let full = ''; try { await dialRelay(smallPort, hostId, p2.dialKey, p2.deviceId); } catch (e) { full = e.message; }
  check('Grenze: weitere Leitung über der Grenze je Haupt-PC abgelehnt („voll“)', !(first instanceof Error) && full === 'voll', (first instanceof Error ? 'erste: ' + first.message : 'erste ok') + ' / zweite: ' + full);
  if (!(first instanceof Error)) first.destroy();
  held.forEach(x => x.destroy()); link2.use(null); small.close();

  // Angriff: PC in der Relay-App entfernt → sofort getrennt, neue Anmeldung abgelehnt
  entries = entries.filter(e => e.id !== entry.id); relay.refresh();
  await until(() => link.state !== 'connected');
  const removed = await hostLogin(relayPort, n => ({ t: 'host', key: entry.id, hostId, mac: hmac(entry.key, `host|${n}|${hostId}`) }));
  check('Angriff: entfernter PC getrennt und abgelehnt', link.state !== 'connected' && relay.stats().hosts === 0 && removed.t === 'closed', link.state + ' ' + JSON.stringify(removed));

  // Sperre nach 10 Fehlversuchen: in der Liste mit Grund und Ablauf, „Sperre aufheben“ lässt die Adresse wieder zu
  const r3 = createRelay({ getHosts: () => [entry] });
  const r3Port = await r3.listen(0, '127.0.0.1');
  for (let i = 0; i < 10; i++) await hostLogin(r3Port, n => ({ t: 'host', key: entry.id, hostId: hex(8), mac: hmac(hex(32), `host|${n}|x`) }));
  const bl = r3.details().blockedList;
  const helloBlocked = await hostLogin(r3Port, n => ({ t: 'host', key: entry.id, hostId, mac: 'x' })).catch(e => ({ t: 'closed', error: e.message }));
  check('Sperre: gesperrte Adresse mit Anzahl, Grund und Ablauf in der Liste; neue Verbindungen abgewiesen',
    bl.length === 1 && bl[0].ip === '127.0.0.1' && bl[0].count === 10 && /falsche Anmeldung/.test(bl[0].reason) && bl[0].until > Date.now() && r3.details().blocked === 1 && helloBlocked.t !== 'error', JSON.stringify(bl));
  check('Sperre aufheben: Adresse wieder zugelassen', r3.unblock('127.0.0.1') === true && r3.details().blockedList.length === 0
    && (await new Promise(res => { const s = net.connect(r3Port, '127.0.0.1'); readLine(s).then(m => { s.destroy(); res(m?.t === 'hello'); }, () => res(false)); })), JSON.stringify(r3.details()));
  check('Sperre aufheben: unbekannte Adresse → nichts', r3.unblock('192.0.2.1') === false);
  r3.close();

  // Adresse des Vermittlers versehentlich als Haupt-PC eingetragen: klare Meldung im Protokoll, Fehler beim Koppeln erkennbar
  const rlog = [];
  const r2 = createRelay({ getHosts: () => [], log: m => rlog.push(m) });
  const r2Port = await r2.listen(0, '127.0.0.1');
  let perr = {}; try { await remote.pair({ address: '127.0.0.1', port: r2Port, code: '0'.repeat(26), name: 'x' }); } catch (e) { perr = e; }
  await until(() => rlog.length > 0, 2000);
  check('Vermittler: Adresse des Vermittlers als Haupt-PC → verständlicher Hinweis', /WRONG_VERSION_NUMBER|EPROTO/.test(String(perr.code)) && rlog.some(l => /statt Anmeldung.*Kopplungslink/.test(l)), `${perr.code} | ${rlog.join(' | ')}`);
  r2.close();

  link.use(null); host.stop(); relay.close();
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
})().catch(e => { process.stdout.write(JSON.stringify([...results, { name: 'Vermittler-Test', ok: false, detail: e.stack || e.message }])); process.exit(0); });
