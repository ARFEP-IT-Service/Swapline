// Lizenzen der Android-App: listet alle Bibliotheken der APK (Gradle releaseRuntimeClasspath) mit Lizenz und
// schreibt app/src/main/assets/licenses.txt (in der App unter „Haupt-PCs → Open-Source-Lizenzen“).
//   node tools/licenses.js            (im Ordner android/, braucht JAVA_HOME für Gradle)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const gradlew = path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const out = execFileSync(gradlew, ['--no-daemon', '-q', ':app:dependencies', '--configuration', 'releaseRuntimeClasspath'],
  { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 32 * 1024 * 1024 }); // .bat braucht unter Windows die Shell (feste Argumente)
const deps = [...new Set([...out.matchAll(/([\w.-]+:[\w.-]+):(\S+?)(?: -> (\S+))?(?: \([c*]\))?$/gm)]
  .map(m => `${m[1]}:${m[3] || m[2]}`))].sort();

// Lizenz je Gruppe (aus den POM-Angaben der Projekte)
const MIT_LIKE = { 'org.bouncycastle': 'Bouncy Castle License (MIT)', 'org.checkerframework': 'MIT License' };
const licenseOf = d => MIT_LIKE[d.split(':')[0]] || 'Apache-2.0';

// Lizenztexte aus den JARs im Gradle-Cache (BouncyCastle, Checker Framework)
function jarLicense(group, artifact) {
  const dir = path.join(os.homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', group, artifact);
  if (!fs.existsSync(dir)) return null;
  for (const ver of fs.readdirSync(dir)) for (const h of fs.readdirSync(path.join(dir, ver))) {
    for (const f of fs.readdirSync(path.join(dir, ver, h))) {
      if (!f.endsWith('.jar') || f.includes('sources')) continue;
      for (const name of ['META-INF/LICENSE.md', 'META-INF/LICENSE.txt', 'META-INF/LICENSE']) {
        try { return execFileSync('unzip', ['-p', path.join(dir, ver, h, f), name], { encoding: 'utf8' }).trim() || null; } catch {}
      }
    }
  }
  return null;
}
const bc = jarLicense('org.bouncycastle', 'bctls-jdk18on');
const checker = jarLicense('org.checkerframework', 'checker-qual');
const apache = fs.readFileSync(path.join(__dirname, 'apache-2.0.txt'), 'utf8').trim();
if (!bc || !checker) throw new Error('Lizenztext fehlt (BouncyCastle oder Checker Framework) – erst ./gradlew assembleRelease ausführen');

const groups = {};
for (const d of deps) (groups[licenseOf(d)] ||= []).push(d);
const line = '='.repeat(78);
const text = [
  'Swapline für Android – Open-Source-Lizenzen',
  'Swapline selbst: MIT License, Copyright (c) 2026 Halil Ayberk Bulut (ARFEP IT-Service) und Mitwirkende.',
  `Enthaltene Bibliotheken: ${deps.length}`,
  '',
  ...Object.entries(groups).flatMap(([lic, list]) => [line, lic, line, ...list, '']),
  line, 'Bouncy Castle License', line, bc, '',
  line, 'Checker Framework (checker-qual) – MIT License', line, checker, '',
  line, 'Apache License 2.0', line, apache, '',
].join('\n');
const dest = path.join(root, 'app', 'src', 'main', 'assets', 'licenses.txt');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, text);
console.log(`licenses.txt: ${deps.length} Bibliotheken (${Object.entries(groups).map(([k, v]) => `${k}: ${v.length}`).join(', ')})`);
