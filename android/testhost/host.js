// Testhost für die Unit-Tests der Android-App: der echte Fernzugriff aus src/remote.js auf 127.0.0.1,
// Geräte nur im Speicher. Steuerung über stdin (eine Zeile je Befehl), Antworten als JSON-Zeilen auf stdout.
//   pair            -> {"code": "...", "port": n}   neuer Einmal-Code
//   deny            -> nächste Kopplung ablehnen
//   push <kind>     -> Ereignis an alle Geräte
'use strict';
const path = require('node:path');
const readline = require('node:readline');
const remote = require(path.join(__dirname, '..', '..', 'src', 'remote.js'));

let devices = [];
let denyNext = false;
let mute = false; // „stumm“: Anfragen bleiben unbeantwortet (tote Verbindung nachstellen)
// validContent aus src/main.js (der echte Code, nicht nachgebaut): prüft, was ein Gerät als Nachricht schickt
const mainSrc = require('node:fs').readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');
const validContent = new Function(/^const IMAGE_MEDIA = .*$/m.exec(mainSrc)[0] + '\n' + /^function validContent[\s\S]*?^}/m.exec(mainSrc)[0] + '\nreturn validContent;')();
const out = o => process.stdout.write(JSON.stringify(o) + '\n');

const host = remote.createHost({
  getDevices: () => devices,
  saveDevices: list => { devices = list; },
  encrypt: s => Buffer.from(s).toString('base64'),
  decrypt: s => Buffer.from(s, 'base64').toString(),
  confirmPair: async ({ name }) => { out({ confirm: name }); const ok = !denyNext; denyNext = false; return ok; },
  dispatch: async (dev, ch, args) => {
    if (mute) return new Promise(() => {});
    if (ch === 'echo') return { device: dev.name, args };
    if (ch === 'fail') throw new Error('absichtlich');
    if (ch === 'content') return validContent(args[0]);
    if (ch === 'session:send') { // Rauchtest: Nachricht wie der Haupt-PC prüfen und Eckdaten melden
      const c = args[0]?.content, ok = validContent(c);
      out({ sent: { ok, images: Array.isArray(c) ? c.filter(b => b.type === 'image').length : 0, text: Array.isArray(c) ? c.find(b => b.type === 'text')?.text : c } });
      return ok;
    }
    if (ch === 'big') return 'x'.repeat(Number(args[0]) || 0);
    // Beispieldaten für einen Rauchtest der App (Emulator: Adresse des PCs aus Sicht des Emulators)
    if (ch === 'store:get') return { profiles: [{ id: 'p1', name: 'Testkonto', color: '#1581FF' }], activeProfileId: 'p1',
      projects: [{ id: 'w', name: 'Webseite', color: '#F59E0B', cwd: 'C:\\Projekte\\web' }], projectGroups: [], settings: { model: '', effort: '', permissionMode: 'default' },
      allowedFolders: ['C:\\Projekte\\web'], hostName: 'TESTHOST', hostVersion: '0.9.0', allowBypass: false, scope: { newChats: true }, reach: { addresses: ['127.0.0.1'], port: null } };
    if (ch === 'tabs:list') return [{ id: 'tab123456', title: 'Offener Chat am PC', profileId: 'p1', cwd: 'C:\\Projekte\\web', sessionId: null, model: '', effort: '', permissionMode: 'default', running: false, updated: Date.now(), preview: 'Hallo vom Testhost' }];
    if (ch === 'history:list') return [{ sessionId: '11111111-2222-4333-8444-555555555555', title: 'Alter Chat', cwd: 'C:\\Projekte\\web', mtime: Date.now() - 3600e3 }];
    if (ch === 'profiles:models') return { models: [{ value: 'opus', displayName: 'Opus' }] };
    if (ch === 'session:attach') return { running: false };
    if (ch === 'history:loadSession') return [];
    throw new Error('unbekannt: ' + ch);
  },
  log: () => {},
  onChange: () => {},
});

host.start(0, '127.0.0.1').then(port => {
  out({ ready: true, port });
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const [cmd, arg] = line.trim().split(/\s+/);
    if (cmd === 'pair') out({ code: host.startPairing().code, port });
    else if (cmd === 'deny') { denyNext = true; out({ ok: true }); }
    else if (cmd === 'mute') { mute = arg !== 'off'; out({ ok: true }); }
    else if (cmd === 'push') { host.broadcast(arg || 'test', { hello: 'welt', n: 1 }); out({ ok: true }); }
    else if (cmd === 'remove') { for (const d of devices) host.disconnect(d.id); devices = []; out({ ok: true }); }
  }).on('close', () => { host.stop(); process.exit(0); });
});
