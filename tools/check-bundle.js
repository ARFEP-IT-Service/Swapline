// Prüft nach dem Build: Jedes im App-Archiv gebündelte npm-Paket hat einen Lizenztext in licenses/,
// und licenses/ enthält kein Paket, das nicht gebündelt ist. Außerdem: ffmpeg.dll liegt als eigene,
// austauschbare Datei neben der exe, und LICENSE/THIRD_PARTY_NOTICES.md/licenses/ sind dabei.
'use strict';
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const files = asar.listPackage(path.join(unpacked, 'resources', 'app.asar')).map(f => f.replace(/\\/g, '/'));
const bundled = new Set();
for (const f of files) {
  const m = f.match(/^\/node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/);
  if (m) bundled.add(m[1]);
}
const listed = new Set(Object.keys(require(path.join(root, 'licenses', 'packages.json')).npm));
const errors = [];
for (const p of bundled) if (!listed.has(p)) errors.push(`gebündelt, aber ohne Lizenzeintrag: ${p}`);
for (const p of listed) if (!bundled.has(p)) errors.push(`Lizenzeintrag, aber nicht gebündelt: ${p}`);
for (const f of ['Switchdesk.exe', 'ffmpeg.dll', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/FFmpeg-LGPL-2.1.txt', 'licenses/Chromium-LICENSES.chromium.html']) {
  if (!fs.existsSync(path.join(unpacked, f))) errors.push(`fehlt im Build: ${f}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Bundle ok: ${bundled.size} npm-Pakete gebündelt = ${listed.size} mit Lizenz (${[...bundled].join(', ')})`);
