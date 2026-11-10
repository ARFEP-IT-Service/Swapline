#!/usr/bin/env node
// Swapline Server – Swapline-Haupt-PC ohne Fenster für einen eigenen Linux-Server (z. B. VPS). Das Handy koppelt sich
// direkt oder über den Vermittler; Claude Code läuft hier. Befehle siehe „swapline-server help“.
'use strict';
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const C = require('./lib/config.js');
const VERSION = require('./package.json').version;

const de = /^de/i.test(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '');
const tr = (d, e) => (de ? d : e);
const [cmd, ...rest] = process.argv.slice(2);

const HELP = tr(`Swapline Server ${VERSION}

  swapline-server run                      Dienst starten (macht systemd, siehe install.sh)
  swapline-server status                   Zustand, Adressen, Geräte, Ordner, Vermittler
  swapline-server pair                     Handy koppeln: QR-Code mit der Swapline-App scannen, hier bestätigen
  swapline-server devices                  gekoppelte Geräte
  swapline-server devices remove <Name>    Gerät entfernen
  swapline-server devices bypass <Name> on|off   „Alles erlauben“ und „!“-Befehle für das Gerät
  swapline-server folders add <Ordner>     Ordner für neue Chats freigeben (auch Unterordner)
  swapline-server folders remove <Ordner>
  swapline-server relay <Einrichtungscode> Über den Vermittler erreichbar (Code aus „Swapline Relay“)
  swapline-server relay off

Bei Claude anmelden: einmal „claude auth login“ als dieser Benutzer.`,
`Swapline Server ${VERSION}

  swapline-server run                      start the service (done by systemd, see install.sh)
  swapline-server status                   state, addresses, devices, folders, relay
  swapline-server pair                     pair a phone: scan the QR code with the Swapline app, confirm here
  swapline-server devices                  paired devices
  swapline-server devices remove <name>    remove a device
  swapline-server devices bypass <name> on|off   “Allow everything” and “!” commands for the device
  swapline-server folders add <folder>     allow a folder for new chats (including subfolders)
  swapline-server folders remove <folder>
  swapline-server relay <setup code>       reachable via the relay (code from “Swapline Relay”)
  swapline-server relay off

Sign in to Claude: run “claude auth login” once as this user.`);

// Verbindung zum laufenden Dienst; Antworten zeilenweise
function connect(onMsg) {
  return new Promise((resolve, reject) => {
    const s = net.connect(C.controlPath(), () => resolve(s));
    s.on('error', e => reject(new Error(tr('Dienst läuft nicht (systemctl --user start swapline-server)', 'Service is not running (systemctl --user start swapline-server)') + ` – ${e.code || e.message}`)));
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { onMsg(JSON.parse(l), s); } catch {} } });
  });
}
async function request(op) {
  let done;
  const p = new Promise(r => { done = r; });
  const s = await connect(m => done(m));
  s.write(JSON.stringify(op) + '\n');
  const m = await p;
  s.end();
  if (m.error) throw new Error(m.error);
  return m;
}

function qr(text) {
  const q = require(require.resolve('qrcode-generator', { paths: [path.join(__dirname, 'node_modules'), path.join(__dirname, '..', 'node_modules')] }))(0, 'M');
  q.addData(text);
  q.make();
  return q.createASCII(1, 2);
}

async function main() {
  switch (cmd) {
    case 'run': {
      const { startDaemon } = require('./lib/daemon.js');
      const d = startDaemon();
      await d.start();
      const bye = () => { d.stop(); process.exit(0); };
      process.on('SIGTERM', bye); process.on('SIGINT', bye);
      return;
    }
    case 'status': {
      const st = await request({ op: 'status' });
      console.log(`Swapline Server ${st.version} – ${tr('Port', 'port')} ${st.port}`);
      console.log(tr('Adressen: ', 'Addresses: ') + (st.addresses.join(', ') || '–'));
      console.log('Claude Code: ' + (st.claude || tr('nicht gefunden', 'not found')));
      console.log(tr('Vermittler: ', 'Relay: ') + (st.relay ? `${st.relay.address}:${st.relay.port} – ${st.relay.state}${st.relay.detail ? ' (' + st.relay.detail + ')' : ''}` : tr('aus', 'off')));
      console.log(tr('Ordner für neue Chats: ', 'Folders for new chats: ') + (st.folders.join(', ') || tr('nur das Home-Verzeichnis', 'home directory only')));
      console.log(tr('Geräte: ', 'Devices: ') + (st.devices.map(d => `${d.name}${d.connected ? ' ●' : ''}${d.allowBypass ? ' [' + tr('Alles erlauben', 'allow everything') + ']' : ''}`).join(', ') || '–'));
      return;
    }
    case 'pair': {
      let resolveEnd;
      const ended = new Promise(r => { resolveEnd = r; });
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const s = await connect((m, sock) => {
        if (m.error) { console.error(m.error); resolveEnd(1); }
        else if (m.code) {
          console.log(qr(m.link));
          console.log(tr('In der Swapline-App: Haupt-PC koppeln → QR-Code scannen.', 'In the Swapline app: Pair host PC → Scan QR code.'));
          console.log(tr('Oder Kopplungslink (anderer PC: „Mit einem Haupt-PC verbinden“):', 'Or pairing link (other PC: “Connect to a host PC”):'));
          console.log(m.link);
          console.log(tr(`Code: ${m.code} – gültig 5 Minuten, nur einmal. Abbrechen mit Strg+C.`, `Code: ${m.code} – valid for 5 minutes, once. Cancel with Ctrl+C.`));
        } else if (m.event === 'confirm') {
          rl.question(tr(`Gerät „${m.name}“ (${m.address}) koppeln? Nur eigene Geräte! [j/N] `, `Pair device “${m.name}” (${m.address})? Own devices only! [y/N] `), a => {
            sock.write(JSON.stringify({ op: 'confirm', id: m.id, ok: /^(j|ja|y|yes)$/i.test(a.trim()) }) + '\n');
          });
        } else if (m.event === 'paired') { console.log(tr(`✓ „${m.name}“ ist gekoppelt.`, `✓ “${m.name}” is paired.`)); resolveEnd(0); }
      });
      s.write(JSON.stringify({ op: 'pair' }) + '\n');
      const code = await ended;
      rl.close(); s.end();
      process.exit(code);
      return;
    }
    case 'devices': {
      const [sub, name, val] = rest;
      if (sub === 'remove') { await request({ op: 'device-remove', device: name }); console.log(tr('Entfernt.', 'Removed.')); return; }
      if (sub === 'bypass') { await request({ op: 'device-bypass', device: name, on: val === 'on' }); console.log('OK'); return; }
      const st = await request({ op: 'status' });
      for (const d of st.devices) console.log(`${d.connected ? '●' : '○'} ${d.name}  (${d.id})  ${d.allowBypass ? tr('„Alles erlauben“ an', '“Allow everything” on') : ''}`);
      if (!st.devices.length) console.log(tr('Noch kein Gerät gekoppelt – swapline-server pair', 'No device paired yet – swapline-server pair'));
      return;
    }
    case 'folders': {
      const [sub, dir] = rest;
      if (sub === 'add') { await request({ op: 'folder-add', path: path.resolve(dir || '.') }); console.log('OK'); return; }
      if (sub === 'remove') { await request({ op: 'folder-remove', path: path.resolve(dir || '.') }); console.log('OK'); return; }
      const st = await request({ op: 'status' });
      console.log(st.folders.join('\n') || tr('Keine – neue Chats nur im Home-Verzeichnis.', 'None – new chats only in the home directory.'));
      return;
    }
    case 'relay': {
      await request({ op: 'relay', code: rest[0] === 'off' ? null : rest[0] });
      console.log('OK');
      return;
    }
    case 'version': case '--version': console.log(VERSION); return;
    default: console.log(HELP);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
