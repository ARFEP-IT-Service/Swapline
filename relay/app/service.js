// Dienst-Teil von „Swapline Relay“: läuft ohne Fenster als Windows-Aufgabe beim Systemstart (Konto „Lokaler Dienst“).
// Gestartet mit dem Node der App (ELECTRON_RUN_AS_NODE=1 „Swapline Relay.exe“ …\resources\app.asar\service.js).
// Schreibt alle 2 s status.json für die Oberfläche und das Protokoll nach relay.log.
'use strict';
const fs = require('node:fs');
const { createRelay } = require('./core.js');
const P = require('./paths.js');

const cfg = P.readConfig();
const logFile = P.file(cfg?.logFile || 'relay.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.1');
    fs.appendFileSync(logFile, line + '\n');
  } catch {}
  if (process.stdout.isTTY) console.log(line);
}

const started = Date.now();
let listening = false, lastError = '';
function writeStatus(relay) {
  const st = relay ? relay.stats() : { hosts: 0, pipes: 0, pending: 0 };
  const det = relay ? relay.details() : { hosts: [], blocked: 0 };
  const status = { pid: process.pid, started, updated: Date.now(), port: cfg?.port, listening, lastError, ...st, hostList: det.hosts, blocked: det.blocked };
  try { const tmp = P.file('status.json.tmp'); fs.writeFileSync(tmp, JSON.stringify(status)); fs.renameSync(tmp, P.file('status.json')); } catch {}
}

if (!cfg) {
  lastError = 'Keine gültigen Einstellungen (relay.json) – bitte die App „Swapline Relay“ öffnen.';
  log(lastError);
  writeStatus(null);
  process.exit(1);
}

const relay = createRelay({ secret: cfg.secret, log });
relay.listen(cfg.port, '0.0.0.0').then(port => {
  listening = true;
  log(`Swapline-Vermittler gestartet – Port ${port}`);
  writeStatus(relay);
}, e => {
  lastError = e.code === 'EADDRINUSE' ? `Port ${cfg.port} ist belegt` : e.message;
  log('Start fehlgeschlagen: ' + lastError);
  writeStatus(relay);
  process.exit(1);
});
setInterval(() => writeStatus(relay), 2000).unref?.();

// Beendet sich mit dem Elternprozess (Aufgabe gestoppt), damit kein verwaister Dienst weiterläuft
const parent = process.ppid;
// (nur „Prozess gibt es nicht“ zählt – z. B. fehlende Berechtigung heißt: läuft noch)
setInterval(() => { try { process.kill(parent, 0); } catch (e) { if (e.code === 'ESRCH') { log('Beendet (Aufgabe gestoppt)'); process.exit(0); } } }, 3000);

const stop = () => { log('Beendet'); listening = false; writeStatus(relay); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
