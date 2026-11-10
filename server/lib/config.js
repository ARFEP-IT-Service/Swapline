// Swapline Server – Einstellungen und Daten. Liegen in ~/.config/swapline-server (bzw. $XDG_CONFIG_HOME, für Tests
// $SWAPLINE_SERVER_DIR), Ordner nur für den Benutzer (0700), Dateien 0600. Gerätschlüssel stehen dort im Klartext –
// geschützt durch die Dateirechte des Benutzerkontos (Linux hat kein DPAPI wie Windows).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PORT = 47820;
const dataDir = () => process.env.SWAPLINE_SERVER_DIR
  || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'swapline-server');
const file = name => path.join(dataDir(), name);

function ensureDir() {
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dataDir(), 0o700); } catch {}
}

// config.json: { port, folders[], devices[], hostId, dialKey, relay: { address, port, secret } | null, claudePath }
function load() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file('config.json'), 'utf8')); } catch {}
  return {
    port: Number.isInteger(c.port) && c.port >= 1024 && c.port <= 65535 ? c.port : DEFAULT_PORT,
    folders: Array.isArray(c.folders) ? c.folders.filter(f => typeof f === 'string' && path.isAbsolute(f)) : [],
    devices: Array.isArray(c.devices) ? c.devices : [],
    hostId: /^[0-9a-f]{16}$/.test(c.hostId || '') ? c.hostId : crypto.randomBytes(8).toString('hex'),
    dialKey: /^[0-9a-f]{64}$/.test(c.dialKey || '') ? c.dialKey : crypto.randomBytes(32).toString('hex'),
    relay: c.relay && typeof c.relay.address === 'string' && Number.isInteger(c.relay.port) && typeof c.relay.secret === 'string' ? c.relay : null,
    claudePath: typeof c.claudePath === 'string' ? c.claudePath : '',
  };
}

function save(c) {
  ensureDir();
  const tmp = file('config.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file('config.json'));
  try { fs.chmodSync(file('config.json'), 0o600); } catch {}
}

// Steuerung zwischen Befehlszeile und Dienst: Unix-Socket (nur der Benutzer), unter Windows (Tests) eine Named Pipe
function controlPath() {
  if (process.platform === 'win32') return '\\\\.\\pipe\\swapline-server-' + crypto.createHash('sha256').update(dataDir()).digest('hex').slice(0, 16);
  return file('control.sock');
}

module.exports = { DEFAULT_PORT, dataDir, file, ensureDir, load, save, controlPath };
