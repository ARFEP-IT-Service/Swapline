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
for (const f of ['Swapline.exe', 'ffmpeg.dll', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/FFmpeg-LGPL-2.1.txt', 'licenses/Chromium-LICENSES.chromium.html']) {
  if (!fs.existsSync(path.join(unpacked, f))) errors.push(`fehlt im Build: ${f}`);
}
// Installer heißt Swapline-Setup-<Version>.exe, latest.yml (Auto-Update) verweist genau darauf
const version = require(path.join(root, 'package.json')).version;
const setup = `Swapline-Setup-${version}.exe`;
if (!fs.existsSync(path.join(root, 'dist', setup))) errors.push(`fehlt im Build: dist/${setup}`);
try {
  const yml = fs.readFileSync(path.join(root, 'dist', 'latest.yml'), 'utf8');
  if (!new RegExp(`^path: ${setup.replace(/\./g, '\\.')}$`, 'm').test(yml) || !yml.includes(`url: ${setup}`)) errors.push(`latest.yml verweist nicht auf ${setup}`);
  if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}$`, 'm').test(yml)) errors.push(`latest.yml hat nicht die Version ${version}`);
} catch { errors.push('fehlt im Build: dist/latest.yml'); }
if (fs.existsSync(path.join(root, 'dist', 'SWAP-Installer.exe'))) errors.push('alter Installername dist/SWAP-Installer.exe liegt noch im Build');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Installer ok: dist/${setup}, latest.yml verweist darauf`);
console.log(`Bundle ok: ${bundled.size} npm-Pakete gebündelt = ${listed.size} mit Lizenz (${[...bundled].join(', ')})`);
