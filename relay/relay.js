#!/usr/bin/env node
// Swapline-Vermittler ohne App (z. B. Linux/systemd). Daten im Ordner $SWAPLINE_RELAY_DIR (Standard: ./data neben
// dieser Datei): relay.json (Port, Limits), hosts.json (ein Schlüssel je Haupt-PC), status.json, relay.log.
//   node relay.js run                         Vermittler starten
//   node relay.js add <Name> <Adresse>        neuer Haupt-PC → Einrichtungscode (für genau diesen PC)
//   node relay.js list                        Haupt-PCs (wartend, erlaubt)
//   node relay.js approve <Eintrag>           wartenden PC zulassen
//   node relay.js remove <Eintrag>            PC entfernen (Schlüssel ungültig)
// Unter Windows besser die App „Swapline Relay“ (Dienst + Oberfläche). Der Vermittler selbst steht in app/core.js.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRelay, hmac } = require('./app/core.js');

module.exports = { createRelay, hmac };

if (require.main === module) {
  process.env.SWAPLINE_RELAY_DIR ||= path.join(__dirname, 'data');
  const P = require('./app/paths.js');
  fs.mkdirSync(P.dataDir(), { recursive: true, mode: 0o700 });
  const cfg = P.ensureConfig();
  const [cmd, a, b] = process.argv.slice(2);
  const status = () => { try { return JSON.parse(fs.readFileSync(P.file('status.json'), 'utf8')); } catch { return {}; } };
  if (cmd === 'add') {
    if (!a || !b) { console.error('node relay.js add <Name> <Adresse>'); process.exit(1); }
    console.log(P.setupCode(b, cfg.port, P.addHost(a)));
  } else if (cmd === 'list') {
    const w = new Map((status().waiting || []).map(x => [x.entry, x]));
    for (const e of P.readHosts()) console.log(`${e.id}  ${e.approved ? 'erlaubt  ' : w.has(e.id) ? 'WARTET   ' : 'unbenutzt'}  ${e.name}${w.has(e.id) ? `  (Kennung ${w.get(e.id).hostId.slice(0, 6)}…, ${w.get(e.id).ip})` : ''}`);
  } else if (cmd === 'approve') {
    const w = (status().waiting || []).find(x => x.entry === a);
    if (!w || !P.approveHost(a, w.hostId)) { console.error('Dieser Eintrag wartet nicht auf Freigabe (läuft der Vermittler?)'); process.exit(1); }
    console.log('Erlaubt.');
  } else if (cmd === 'remove') {
    if (!P.removeHost(a)) { console.error('Eintrag nicht gefunden'); process.exit(1); }
    console.log('Entfernt.');
  } else if (cmd === 'run' || !cmd) {
    const logFile = P.file(cfg.logFile);
    const log = msg => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      console.log(line);
      try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.1'); fs.appendFileSync(logFile, line + '\n'); } catch {}
    };
    let hosts = P.readHosts(), mtime = 0;
    const relay = createRelay({ getHosts: () => hosts, maxPipesPerHost: cfg.maxPipesPerHost, maxPipes: cfg.maxPipes, log });
    setInterval(() => {
      let m = 0; try { m = fs.statSync(P.file('hosts.json')).mtimeMs; } catch {}
      if (m !== mtime) { mtime = m; hosts = P.readHosts(); relay.refresh(); }
      try { fs.writeFileSync(P.file('status.json'), JSON.stringify({ updated: Date.now(), ...relay.stats(), waiting: relay.details().waiting })); } catch {}
    }, 2000).unref();
    relay.listen(cfg.port, process.env.SWAPLINE_RELAY_BIND || '0.0.0.0').then(port => log(`Swapline-Vermittler hört auf Port ${port}`), e => { log('Start fehlgeschlagen: ' + e.message); process.exit(1); });
  } else { console.error('Unbekannter Befehl – siehe Kopf von relay.js'); process.exit(1); }
}
