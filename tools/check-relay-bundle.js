// Prüft nach dem Build von „Swapline Relay“: Lizenz, Hinweise zu Drittkomponenten und deren Volltexte liegen neben
// der exe (Installer und zip enthalten denselben Ordner), ffmpeg.dll als eigene Datei.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const unpacked = path.join(root, 'dist-relay', 'win-unpacked');
const errors = [];
for (const f of ['Swapline Relay.exe', 'ffmpeg.dll', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/Electron-45.2.3.txt', 'licenses/Chromium-LICENSES.chromium.html',
  'licenses/FFmpeg-LGPL-2.1.txt', 'licenses/Installer-NSIS-COPYING.txt', 'licenses/Installer-electron-builder-26.18.0.txt']) {
  if (!fs.existsSync(path.join(unpacked, f))) errors.push(`fehlt im Build: ${f}`);
}
// nur die Texte der Relay-Bestandteile, keine npm-Pakete der PC-App
for (const f of fs.existsSync(path.join(unpacked, 'licenses')) ? fs.readdirSync(path.join(unpacked, 'licenses')) : []) {
  if (!fs.readFileSync(path.join(root, 'relay', 'THIRD_PARTY_NOTICES.md'), 'utf8').includes('licenses/' + f)) errors.push(`nicht in relay/THIRD_PARTY_NOTICES.md genannt: licenses/${f}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Relay-Bundle ok: LICENSE, THIRD_PARTY_NOTICES.md und Lizenztexte neben der exe');
