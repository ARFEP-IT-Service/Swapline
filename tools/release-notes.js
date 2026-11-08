// Gibt den Abschnitt einer Version aus CHANGELOG.md aus (für die Release-Beschreibung auf GitHub).
//   node tools/release-notes.js v0.2.0
'use strict';
const fs = require('fs');
const path = require('path');

const version = String(process.argv[2] || '').replace(/^v/, '');
const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const start = text.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
if (!version || start < 0) { console.error(`CHANGELOG.md: kein Abschnitt für ${version || '(keine Version)'}`); process.exit(1); }
const rest = text.slice(start);
const next = rest.slice(3).search(/^## \[/m);
const section = (next < 0 ? rest : rest.slice(0, next + 3)).trim();
console.log(section.split('\n').slice(1).join('\n').trim());
console.log('\n---\nSHA-256-Prüfsummen: SHA256SUMS.txt · Lizenzen: THIRD_PARTY_NOTICES.md und Ordner licenses/');
