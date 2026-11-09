// App „Swapline Relay“: Dienst-Teil (relay/app/service.js) so starten wie die Windows-Aufgabe – mit dem Node der App
// (ELECTRON_RUN_AS_NODE) in einem Testordner – und prüfen: Einstellungen, status.json, Anmeldung eines Haupt-PCs,
// Protokoll, Beenden mit dem Elternprozess. Wird von tests/run.js gestartet, Ergebnis als JSON.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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
    // Einstellungen: Kennwort sicher erzeugt, gespeichert, wiederverwendet
    const c1 = P.ensureConfig(), c2 = P.ensureConfig();
    check('Relay-App: Einstellungen mit Kennwort (48 Zeichen, ohne Verwechsler)', c1.secret.length === 48 && /^[A-HJ-NP-Za-km-z2-9]+$/.test(c1.secret) && c1.secret === c2.secret && c1.port === 47821);
    check('Relay-App: neue Kennwörter sind verschieden', P.newSecret() !== P.newSecret());
    P.writeConfig({ ...c1, port: 0 }); // freier Port für den Test

    // Dienst starten wie die Aufgabe (ohne Fenster, Node der App)
    const proc = spawn(electron, [path.join(root, 'relay', 'app', 'service.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SWAPLINE_RELAY_DIR: dir }, stdio: 'ignore', windowsHide: true });
    const okStatus = await until(() => readJson(path.join(dir, 'status.json'))?.listening === true);
    const st = readJson(path.join(dir, 'status.json'));
    check('Relay-App: Dienst läuft und schreibt status.json', okStatus && st.pid === proc.pid, JSON.stringify(st));

    // tatsächlichen Port aus dem Protokoll lesen (Port 0 = zufällig) und einen Haupt-PC anmelden
    await until(() => /Port (\d+)/.test(fs.readFileSync(path.join(dir, 'relay.log'), 'utf8')));
    const port = Number(/Port (\d+)/.exec(fs.readFileSync(path.join(dir, 'relay.log'), 'utf8'))[1]);
    const link = createRelayLink({ onSocket: s => s.destroy() });
    link.use({ address: '127.0.0.1', port, secret: c1.secret, hostId: crypto.randomBytes(8).toString('hex'), dialKey: crypto.randomBytes(32).toString('hex') });
    const signedIn = await until(() => readJson(path.join(dir, 'status.json'))?.hosts === 1);
    const st2 = readJson(path.join(dir, 'status.json'));
    check('Relay-App: angemeldeter Swapline-PC erscheint im Status', signedIn && st2.hostList?.[0]?.ip && /^[0-9a-f]{6}$/.test(st2.hostList[0].id), JSON.stringify(st2?.hostList));
    check('Relay-App: Kennwort steht nicht im Status', !JSON.stringify(st2).includes(c1.secret));
    link.use(null);

    const log = fs.readFileSync(path.join(dir, 'relay.log'), 'utf8');
    check('Relay-App: Protokoll ohne Kennwort', /gestartet/.test(log) && /Haupt-PC .*verbunden/.test(log) && !log.includes(c1.secret), log.split('\n').slice(-3).join(' | '));

    proc.kill();
    check('Relay-App: Dienst endet sauber', await until(() => proc.exitCode !== null || proc.signalCode !== null, 5000));

    // ohne gültige Einstellungen: Dienst startet nicht und meldet es
    fs.writeFileSync(path.join(dir, 'relay.json'), '{"port":1,"secret":"kurz"}');
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
