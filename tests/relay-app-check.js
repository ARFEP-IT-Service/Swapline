// App „Swapline Relay“: Dienst-Teil (relay/app/service.js) so starten wie die Windows-Aufgabe – mit dem Node der App
// (ELECTRON_RUN_AS_NODE) in einem Testordner – und prüfen: Einstellungen ohne Schlüssel, Einträge je Haupt-PC (Erlauben,
// Entfernen), status.json, Protokoll, Beenden mit dem Elternprozess. Wird von tests/run.js gestartet, Ergebnis als JSON.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const P = require(path.join(root, 'relay', 'app', 'paths.js'));
const { createRelayLink } = require(path.join(root, 'src', 'relay-link.js'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-relay-test-'));
  process.env.SWAPLINE_RELAY_DIR = dir;
  try {
    // Einstellungen: kein gemeinsames Kennwort mehr (ein altes aus Relay 0.2 fällt beim Start weg)
    fs.writeFileSync(path.join(dir, 'relay.json'), JSON.stringify({ port: 47821, secret: 'a'.repeat(48) }));
    const c1 = P.ensureConfig();
    check('Relay-App: altes gemeinsames Kennwort wird beim Start entfernt', !('secret' in JSON.parse(fs.readFileSync(path.join(dir, 'relay.json'), 'utf8'))) && c1.port === 47821 && c1.maxPipesPerHost === 10 && c1.maxPipes === 50);
    check('Relay-App: Protokolldatei nur als Name im Datenordner', P.logName('..\\x.log') === 'relay.log' && P.logName('C:/x.log') === 'relay.log' && P.logName('mein.log') === 'mein.log');
    // Einträge je Haupt-PC: eigener Schlüssel, Code srelay2, „Erlauben“ bindet die Kennung
    const e1 = P.addHost('Büro <PC>'), e2 = P.addHost('Laptop');
    const code = P.setupCode('relay.example', 47821, e1);
    const dec = JSON.parse(Buffer.from(code.slice(8), 'base64url').toString());
    check('Relay-App: Einrichtungscode je PC (srelay2, eigener Schlüssel)', code.startsWith('srelay2.') && dec.i === e1.id && dec.k === e1.key && e1.key !== e2.key && e1.name === 'Büro PC' && !P.readHosts()[0].approved, JSON.stringify({ i: dec.i, a: dec.a, n: e1.name }));
    check('Relay-App: „Erlauben“ nur mit gültiger Kennung', !P.approveHost(e1.id, 'xyz') && !P.approveHost('ffffffff', 'a'.repeat(16)));
    check('Relay-App: Entfernen löscht den Eintrag', P.removeHost(e2.id) && P.readHosts().length === 1 && !P.removeHost(e2.id));
    // freier Port für den Test
    const free = await new Promise(r => { const sv = net.createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => r(p)); }); });
    P.writeConfig({ ...c1, port: free });

    // Dienst starten wie die Aufgabe (ohne Fenster, Node der App)
    const proc = spawn(electron, [path.join(root, 'relay', 'app', 'service.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SWAPLINE_RELAY_DIR: dir }, stdio: 'ignore', windowsHide: true });
    const okStatus = await until(() => readJson(path.join(dir, 'status.json'))?.listening === true);
    const st = readJson(path.join(dir, 'status.json'));
    check('Relay-App: Dienst läuft und schreibt status.json', okStatus && st.pid === proc.pid, JSON.stringify(st));

    // Haupt-PC mit dem Einrichtungscode anmelden: wartet zuerst auf „Erlauben“
    const port = free;
    const hostId = crypto.randomBytes(8).toString('hex');
    const link = createRelayLink({ onSocket: s => s.destroy() });
    link.use({ address: '127.0.0.1', port, keyId: e1.id, key: e1.key, hostId, verifyDial: () => false });
    const waits = await until(() => readJson(path.join(dir, 'status.json'))?.waiting?.some(w => w.entry === e1.id && w.hostId === hostId));
    check('Relay-App: neuer PC erscheint als „wartet auf Freigabe“', waits && link.state === 'pending', link.state + ' ' + JSON.stringify(readJson(path.join(dir, 'status.json'))?.waiting));
    check('Relay-App: „Erlauben“ bindet die Kennung', P.approveHost(e1.id, hostId) && P.readHosts()[0].approved && P.readHosts()[0].hostId === hostId);
    await new Promise(r => setTimeout(r, 2200)); // Dienst übernimmt hosts.json alle 2 s
    link.use({ address: '127.0.0.1', port, keyId: e1.id, key: e1.key, hostId, verifyDial: () => false });
    const signedIn = await until(() => readJson(path.join(dir, 'status.json'))?.hosts === 1);
    const st2 = readJson(path.join(dir, 'status.json'));
    check('Relay-App: angemeldeter Swapline-PC erscheint im Status', signedIn && st2.hostList?.[0]?.ip && /^[0-9a-f]{6}$/.test(st2.hostList[0].id) && st2.hostList[0].entry === e1.id, JSON.stringify(st2?.hostList));
    check('Relay-App: Schlüssel steht nicht im Status', !JSON.stringify(st2).includes(e1.key));
    // Entfernen in der App: Dienst trennt den PC
    P.removeHost(e1.id);
    const dropped = await until(() => readJson(path.join(dir, 'status.json'))?.hosts === 0, 8000);
    check('Relay-App: entfernter PC wird getrennt', dropped && link.state !== 'connected', link.state);
    link.use(null);

    const log = fs.readFileSync(path.join(dir, 'relay.log'), 'utf8');
    check('Relay-App: Protokoll ohne Schlüssel', /gestartet/.test(log) && /Haupt-PC .*verbunden/.test(log) && /wartet auf Freigabe/.test(log) && !log.includes(e1.key), log.split('\n').slice(-3).join(' | '));

    proc.kill();
    check('Relay-App: Dienst endet sauber', await until(() => proc.exitCode !== null || proc.signalCode !== null, 5000));

    // genau wie die Windows-Aufgabe: PowerShell mit dem Startbefehl aus manage.js. Die exe ist ein Fensterprogramm –
    // der Dienst muss trotzdem weiterlaufen (0.1.0: PowerShell endete sofort, Dienst beendete sich nach 3 s)
    if (process.platform === 'win32') {
      const M = require(path.join(root, 'relay', 'app', 'manage.js'));
      fs.rmSync(path.join(dir, 'status.json'), { force: true });
      const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const task = spawn(psExe, [M.launcher(electron).arg], { windowsVerbatimArguments: true, env: { ...process.env, SWAPLINE_RELAY_DIR: dir }, stdio: 'ignore', windowsHide: true });
      const up = await until(() => readJson(path.join(dir, 'status.json'))?.listening === true, 15000);
      const svcPid = readJson(path.join(dir, 'status.json'))?.pid;
      await new Promise(r => setTimeout(r, 7000));
      const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
      check('Relay-App: Start wie die Aufgabe – Dienst läuft nach 7 s noch', up && svcPid && alive(svcPid) && task.exitCode === null, `pid ${svcPid}, ps ${task.exitCode}`);
      task.kill();
      check('Relay-App: Aufgabe gestoppt → Dienst endet mit', await until(() => !alive(svcPid), 8000));
      if (svcPid && alive(svcPid)) process.kill(svcPid);
    }

    // ohne gültige Einstellungen: Dienst startet nicht und meldet es
    fs.writeFileSync(path.join(dir, 'relay.json'), 'kaputt');
    const p2 = spawn(electron, [path.join(root, 'relay', 'app', 'service.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SWAPLINE_RELAY_DIR: dir }, stdio: 'ignore', windowsHide: true });
    await until(() => p2.exitCode !== null, 8000);
    check('Relay-App: ungültige Einstellungen → Dienst startet nicht, Hinweis im Status', p2.exitCode === 1 && /Einstellungen/.test(readJson(path.join(dir, 'status.json'))?.lastError || ''), readJson(path.join(dir, 'status.json'))?.lastError);
  } catch (e) {
    check('Relay-App-Test', false, e.stack || e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
})();
