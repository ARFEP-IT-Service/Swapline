// Erzeugt licenses/ mit den Volltexten aller Bestandteile, die Swapline ausliefert:
// Electron, Chromium (inkl. aller Chromium-Drittkomponenten), FFmpeg (LGPL-2.1) und jedes
// Produktions-npm-Paket. Bricht ab, wenn für ein Paket kein Lizenztext gefunden wird.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'licenses');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

const electronDir = path.join(root, 'node_modules', 'electron');
const electronVersion = require(path.join(electronDir, 'package.json')).version;
const copy = (src, name) => { fs.copyFileSync(src, path.join(out, name)); return name; };

const written = [];
written.push(copy(path.join(electronDir, 'dist', 'LICENSE'), `Electron-${electronVersion}.txt`));
written.push(copy(path.join(electronDir, 'dist', 'LICENSES.chromium.html'), 'Chromium-LICENSES.chromium.html'));
written.push(copy(path.join(__dirname, 'licenses', 'LGPL-2.1.txt'), 'FFmpeg-LGPL-2.1.txt'));
// Nur im Installer (Swapline-Setup-<Version>.exe): NSIS-Stub und die NSIS-Skripte von electron-builder
written.push(copy(path.join(__dirname, 'licenses', 'NSIS-COPYING.txt'), 'Installer-NSIS-COPYING.txt'));
const builderVersion = require(path.join(root, 'node_modules', 'electron-builder', 'package.json')).version;
written.push(copy(path.join(root, 'node_modules', 'electron-builder', 'LICENSE'), `Installer-electron-builder-${builderVersion}.txt`));

// Produktions-Abhängigkeiten (direkt + indirekt) laut npm
const tree = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }));
const pkgs = new Map();
(function walk(deps) {
  for (const [name, info] of Object.entries(deps || {})) {
    if (!pkgs.has(name)) pkgs.set(name, info.version);
    walk(info.dependencies);
  }
})(tree.dependencies);

const missing = [];
for (const [name, version] of pkgs) {
  const dir = path.join(root, 'node_modules', name);
  const files = fs.readdirSync(dir).filter(f => /^(licen[cs]e|copying|notice)/i.test(f));
  if (!files.length) {
    // Pakete ohne eigene Lizenzdatei: hinterlegter Text in tools/licenses/npm/<name>.txt (Lizenz laut package.json)
    const fallback = path.join(__dirname, 'licenses', 'npm', name.replace('/', '__') + '.txt');
    if (fs.existsSync(fallback)) written.push(copy(fallback, `${name.replace(/[@/]/g, (c) => (c === '/' ? '__' : ''))}-${version}.txt`));
    else missing.push(name);
    continue;
  }
  for (const f of files) {
    const suffix = files.length > 1 ? '-' + f.replace(/\.[a-z]+$/i, '') : '';
    written.push(copy(path.join(dir, f), `${name.replace(/[@/]/g, (c) => (c === '/' ? '__' : ''))}-${version}${suffix}.txt`));
  }
}
if (missing.length) { console.error('Kein Lizenztext gefunden für: ' + missing.join(', ')); process.exit(1); }

fs.writeFileSync(path.join(out, 'packages.json'), JSON.stringify({ electron: electronVersion, npm: Object.fromEntries(pkgs) }, null, 2) + '\n');
console.log(`licenses/: ${written.length} Dateien (Electron ${electronVersion}, ${pkgs.size} npm-Pakete)`);
