// Gemeinsame Pfade und Einstellungen von Dienst und Oberfläche.
// Daten liegen in %ProgramData%\SwaplineRelay (Zugriff nur Administratoren, SYSTEM und Dienstkonto – die Rechte setzt
// die App, BEVOR hier etwas angelegt wird, siehe manage.js secureDir):
//   relay.json   { port, logFile, maxPipesPerHost, maxPipes }   – keine Schlüssel
//   hosts.json   { hosts: [{ id, name, key, hostId, approved, created }] }  – ein Schlüssel je Haupt-PC
//   status.json  schreibt der Dienst alle 2 s (für die Anzeige, ohne Schlüssel)
//   relay.log    Protokoll (ab 5 MB wird umbenannt in relay.log.1)
// Für Tests lässt sich der Ordner mit SWAPLINE_RELAY_DIR umlenken.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { newKey, newEntryId } = require('./core.js');

const DEFAULT_PORT = 47821;
const dataDir = () => process.env.SWAPLINE_RELAY_DIR || path.join(process.env.ProgramData || 'C:\\ProgramData', 'SwaplineRelay');
const file = name => path.join(dataDir(), name);
const int = (v, min, max, def) => (Number.isInteger(v) && v >= min && v <= max ? v : def);

function writeJson(name, obj) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = file(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file(name));
}
function readJson(name) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

// Protokolldatei nur als Dateiname im Datenordner (kein Pfad – sonst könnte relay.json den Dienst anderswo schreiben lassen)
const logName = v => (typeof v === 'string' && /^[\w.-]{1,64}$/.test(v) ? v : 'relay.log');
function readConfig() {
  const c = readJson('relay.json');
  if (!c || typeof c !== 'object') return null;
  return { port: int(c.port, 1024, 65535, DEFAULT_PORT), logFile: logName(c.logFile), maxPipesPerHost: int(c.maxPipesPerHost, 1, 100, 10), maxPipes: int(c.maxPipes, 1, 1000, 50) };
}
function writeConfig(c) {
  writeJson('relay.json', { port: c.port, logFile: logName(c.logFile), maxPipesPerHost: int(c.maxPipesPerHost, 1, 100, 10), maxPipes: int(c.maxPipes, 1, 1000, 50) });
}
// Erster Start: Einstellungen anlegen (ein altes „secret“ aus Relay 0.2 fällt dabei weg)
function ensureConfig() {
  const c = readConfig();
  if (c && !('secret' in (readJson('relay.json') || {}))) return c;
  const n = c || { port: DEFAULT_PORT, logFile: 'relay.log', maxPipesPerHost: 10, maxPipes: 50 };
  writeConfig(n);
  return n;
}

// ---------- Haupt-PCs (je einer ein eigener Schlüssel) ----------
const validEntry = e => e && /^[0-9a-f]{8}$/.test(e.id) && /^[0-9a-f]{64}$/.test(e.key) && (e.hostId == null || /^[0-9a-f]{16}$/.test(e.hostId));
function readHosts() {
  const h = readJson('hosts.json');
  return Array.isArray(h?.hosts) ? h.hosts.filter(validEntry).map(e => ({ id: e.id, name: String(e.name || '').slice(0, 40) || 'PC', key: e.key, hostId: e.hostId || null, approved: !!e.approved && !!e.hostId, created: e.created || 0 })) : [];
}
const writeHosts = list => writeJson('hosts.json', { hosts: list });
const cleanName = n => String(n || '').replace(/[\u0000-\u001f<>"]/g, '').trim().slice(0, 40) || 'PC';
// Neuer Eintrag für einen Haupt-PC → Einrichtungscode (wartet nach dem ersten Kontakt auf „Erlauben“)
function addHost(name) {
  const e = { id: newEntryId(), name: cleanName(name), key: newKey(), hostId: null, approved: false, created: Date.now() };
  writeHosts([...readHosts(), e]);
  return e;
}
// „Erlauben“: Eintrag an die gemeldete Kennung binden
function approveHost(id, hostId) {
  if (!/^[0-9a-f]{16}$/.test(hostId || '')) return false;
  const list = readHosts();
  const e = list.find(x => x.id === id);
  if (!e || (e.hostId && e.hostId !== hostId)) return false;
  e.hostId = hostId; e.approved = true;
  writeHosts(list);
  return true;
}
function removeHost(id) {
  const list = readHosts();
  if (!list.some(x => x.id === id)) return false;
  writeHosts(list.filter(x => x.id !== id));
  return true;
}
// Einrichtungscode für Swapline (am PC bzw. swapline-server): Adresse, Port, Eintrag und dessen Schlüssel
function setupCode(address, port, e) {
  return 'srelay2.' + Buffer.from(JSON.stringify({ a: address, p: port, i: e.id, k: e.key })).toString('base64url');
}

module.exports = { DEFAULT_PORT, dataDir, file, readConfig, writeConfig, ensureConfig, readHosts, writeHosts, addHost, approveHost, removeHost, setupCode, logName };
