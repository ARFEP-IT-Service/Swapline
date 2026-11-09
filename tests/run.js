// Testlauf für Swapline: startet die App (unverpackt) je Testdatei in einem eigenen Testprofil,
// führt die Tests in der Oberfläche aus und gibt eine Tabelle aus. Exitcode 1 bei Fehlern.
//
//   npm test                 alle Tests (ohne Netz, ohne Claude-Aufrufe)
//   npm test -- security     nur Dateien, deren Name "security" enthält
//
// Das Testprofil nutzt ein eigenes Konto in einem Temp-Ordner – echte Konten und Einstellungen bleiben unberührt.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const filter = process.argv[2] || '';
const files = fs.readdirSync(path.join(__dirname, 'ui')).filter(f => f.endsWith('.test.js') && f.includes(filter)).sort();
const helpers = fs.readFileSync(path.join(__dirname, 'ui', '_helpers.js'), 'utf8');
const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

let failed = 0, passed = 0;

// Übersetzungen (ohne App): jeder Text, der in app.js über _('…') bzw. N_('…') angezeigt wird, und jeder
// feste Text aus index.html (data-i18n, title, placeholder, aria-label) braucht einen Eintrag im englischen
// Wörterbuch EN in src/renderer/i18n.js. Schlüssel ist der deutsche Text.
function checkTranslations() {
  const vm = require('vm');
  const dir = path.join(root, 'src', 'renderer');
  const i18n = fs.readFileSync(path.join(dir, 'i18n.js'), 'utf8');
  const { EN } = vm.runInNewContext(i18n + '\n;({ EN })', { navigator: { language: 'de' }, document: { documentElement: {} } });
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const keys = new Map(); // Text -> Fundstelle
  for (const m of app.matchAll(/\bN?_\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.set(vm.runInNewContext(`'${m[1]}'`), 'app.js');
  for (const m of html.matchAll(/\s(?:title|placeholder|aria-label)="([^"]*)"/g)) if (m[1].trim()) keys.set(m[1], 'index.html');
  for (const m of html.matchAll(/<[^>]*\sdata-i18n\b[^>]*>([^<]*)</g)) if (m[1].trim()) keys.set(m[1].trim(), 'index.html');
  const results = [];
  const missing = [...keys].filter(([k]) => !Object.prototype.hasOwnProperty.call(EN, k));
  results.push({ name: `Übersetzungen: alle ${keys.size} Texte haben einen englischen Eintrag`, ok: !missing.length, detail: missing.map(([k, f]) => `${f}: ${JSON.stringify(k)}`).join('\n      ') });
  // _() nur mit festem Text in einfachen Anführungszeichen (Template-Strings und Variablen würden die Prüfung umgehen)
  const dynamic = [...app.matchAll(/\b_\(\s*[`"]/g)].length;
  results.push({ name: 'Übersetzungen: _() nur mit festen Texten in einfachen Anführungszeichen', ok: !dynamic, detail: `${dynamic} Aufruf(e) mit " oder \`` });
  // Platzhalter müssen in beiden Sprachen gleich sein
  const ph = s => [...s.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort().join(',');
  const badPh = Object.entries(EN).filter(([de, en]) => ph(de) !== ph(en));
  results.push({ name: 'Übersetzungen: gleiche Platzhalter {…} in Deutsch und Englisch', ok: !badPh.length, detail: badPh.map(([k]) => JSON.stringify(k)).join('\n      ') });
  const unused = Object.keys(EN).filter(k => !keys.has(k));
  if (unused.length) console.log(`  (Hinweis: ${unused.length} ungenutzte Einträge in EN: ${unused.slice(0, 10).map(k => JSON.stringify(k)).join(', ')})`);
  return results;
}
if (!filter || 'i18n'.includes(filter)) { // npm test -- i18n: nur diese Prüfung
  console.log('\ni18n');
  let results;
  try { results = checkTranslations(); } catch (e) { results = [{ name: 'Übersetzungen prüfen', ok: false, detail: e.message }]; }
  for (const r of results) {
    if (r.ok) passed++; else failed++;
    console.log(`  ${r.ok ? '✓' : '✕'} ${r.name}${r.ok ? '' : '\n      ' + r.detail}`);
  }
}

for (const file of files) {
  const name = path.basename(file, '.test.js');
  const profile = `ci-${name}`;
  const userData = path.join(appData, `Swapline-${profile}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-test-'));
  const configDir = path.join(work, 'claude-config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });
  // Testkonto mit eigenem (leerem) Konfigurationsordner; Benachrichtigungen aus, damit nichts aufpoppt
  fs.writeFileSync(path.join(userData, 'swapline.json'), JSON.stringify({
    profiles: [{ id: 'test', name: 'Testkonto', color: '#1581FF', configDir }], activeProfileId: 'test',
    favorites: [], usage: {}, projects: [], activeProjectId: 'all', costFixV1: true, knownFoldersSeeded: true, knownFolders: [work],
    // language: 'de' – die Prüfungen erwarten deutsche Texte, auch auf Rechnern mit englischem System
    settings: { model: '', permissionMode: 'default', claudePath: '', theme: 'system', notify: 'off', sound: 'off', autoUpdate: true, language: 'de' },
  }));
  // kleines Bild außerhalb des App-Ordners: die Oberfläche darf es nicht laden
  fs.writeFileSync(path.join(work, 'probe.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  const script = path.join(work, 'test.js');
  // In eine Funktion gekapselt, damit Hilfsnamen nicht mit globalen Namen der Oberfläche kollidieren
  const body = fs.readFileSync(path.join(__dirname, 'ui', file), 'utf8');
  fs.writeFileSync(script, `(async () => {\n${helpers.replace('__WORK__', JSON.stringify(work))}\nreturn await (\n${body}\n);\n})()`);
  const out = path.join(work, 'result.json');
  const t0 = Date.now();
  spawnSync(electron, ['.'], {
    cwd: root, timeout: 180000, stdio: 'ignore',
    env: { ...process.env, SWAPLINE_PROFILE: profile, SWAPLINE_TEST_JS: script, SWAPLINE_TEST_OUT: out, SWAPLINE_SCREENSHOT_DELAY: '1500' },
  });
  let result;
  try { result = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { result = { error: 'Kein Ergebnis (App abgestürzt oder Zeitüberschreitung)' }; }
  console.log(`\n${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!Array.isArray(result)) { failed++; console.log('  ✕ ' + (result?.error || 'ungültiges Ergebnis')); }
  else for (const r of result) {
    if (r.ok) passed++; else failed++;
    console.log(`  ${r.ok ? '✓' : '✕'} ${r.name}${r.ok ? '' : '  → ' + (r.detail || '')}`);
  }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
