// Gemeinsame Pfade und Einstellungen von Dienst und Oberfläche.
// Daten liegen in %ProgramData%\SwaplineRelay (Zugriff nur Administratoren, SYSTEM und Dienstkonto):
//   relay.json  { port, secret, logFile }   – Kennwort nur hier, nie in der Oberfläche gespeichert
//   status.json                             – schreibt der Dienst alle 2 s (für die Anzeige)
//   relay.log                               – Protokoll (ab 5 MB wird umbenannt in relay.log.1)
// Für Tests lässt sich der Ordner mit SWAPLINE_RELAY_DIR umlenken.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PORT = 47821;
const dataDir = () => process.env.SWAPLINE_RELAY_DIR || path.join(process.env.ProgramData || 'C:\\ProgramData', 'SwaplineRelay');
const file = name => path.join(dataDir(), name);

// Kennwort: 48 Zeichen aus einem Alphabet ohne Verwechsler (≈ 280 Bit)
function newSecret() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  while (out.length < 48) { const b = crypto.randomBytes(1)[0]; if (b < 256 - (256 % abc.length)) out += abc[b % abc.length]; }
  return out;
}

function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(file('relay.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (typeof c.secret === 'string' && c.secret.length >= 32) return { port: Number.isInteger(c.port) ? c.port : DEFAULT_PORT, secret: c.secret, logFile: c.logFile || 'relay.log' };
  } catch {}
  return null;
}
function writeConfig(c) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = file('relay.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify({ port: c.port, secret: c.secret, logFile: c.logFile || 'relay.log' }, null, 2));
  fs.renameSync(tmp, file('relay.json'));
}
// Erster Start: Einstellungen mit neuem Kennwort anlegen
function ensureConfig() {
  return readConfig() || (() => { const c = { port: DEFAULT_PORT, secret: newSecret(), logFile: 'relay.log' }; writeConfig(c); return c; })();
}

module.exports = { DEFAULT_PORT, dataDir, file, newSecret, readConfig, writeConfig, ensureConfig };
