// Nach dem Signieren des Installers: Prüfsumme (sha512) und Größe in dist/latest.yml neu eintragen.
// Ohne diesen Schritt lehnt das Auto-Update den signierten Installer ab (Prüfsumme passt nicht).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dist = path.join(__dirname, '..', 'dist');
const ymlFile = path.join(dist, 'latest.yml');
let yml = fs.readFileSync(ymlFile, 'utf8');
const name = (yml.match(/^path:\s*(.+)$/m) || [])[1]?.trim();
if (!name) { console.error('latest.yml: kein path-Eintrag'); process.exit(1); }
const buf = fs.readFileSync(path.join(dist, name));
const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
yml = yml.replace(/^(\s*-?\s*sha512:\s*).+$/gm, `$1${sha512}`).replace(/^(\s*size:\s*)\d+$/gm, `$1${buf.length}`);
fs.writeFileSync(ymlFile, yml);
console.log(`latest.yml: ${name} · ${buf.length} Bytes · sha512 ${sha512.slice(0, 16)}…`);
