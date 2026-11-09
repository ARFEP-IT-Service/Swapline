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

// Fernzugriff-Test: zweites Konto, Projekt „Arbeit“ (= Testordner) und drei Chats:
// U1 im Projektordner, U2 in einem anderen Ordner (beide Konto test), U3 im Konto test2
function remoteSeed(work, configDir) {
  const other = work + '-other'; // neben dem Projektordner (Unterordner gehören zum Projekt)
  const config2 = path.join(work, 'claude-config-2');
  fs.mkdirSync(other, { recursive: true });
  const chat = (dir, cwd, id, title) => {
    const d = path.join(dir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, id + '.jsonl'), [
      { type: 'user', cwd, sessionId: id, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Hallo ' + title } },
      { type: 'ai-title', aiTitle: title, sessionId: id },
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  };
  chat(configDir, work, '11111111-1111-4111-8111-111111111111', 'Chat im Projekt');
  chat(configDir, other, '22222222-2222-4222-8222-222222222222', 'Chat woanders');
  chat(config2, work, '33333333-3333-4333-8333-333333333333', 'Chat im zweiten Konto');
  return {
    bypassAcknowledged: true, // Warnung zu „Alles erlauben“ schon bestätigt (sonst blockiert der native Dialog den Testlauf)
    profiles: [{ id: 'test', name: 'Testkonto', color: '#1581FF', configDir }, { id: 'test2', name: 'Zweitkonto', color: '#22C55E', configDir: config2 }],
    projects: [{ id: 'p-work', name: 'Arbeit', color: '#F59E0B', cwd: work }],
    knownFolders: [work, other],
  };
}

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
  // Türkisch (src/renderer/i18n-tr.js): jeder Text der Oberfläche und jedes tr('…') in src/main.js, gleiche Platzhalter
  const TR = require(path.join(dir, 'i18n-tr.js'));
  const mainSrc = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const mainKeys = [...mainSrc.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)].map(m => vm.runInNewContext(`'${m[1]}'`));
  const missTr = [...new Set([...keys.keys(), ...mainKeys])].filter(k => !Object.prototype.hasOwnProperty.call(TR, k));
  results.push({ name: `Übersetzungen: alle Texte haben einen türkischen Eintrag`, ok: !missTr.length, detail: missTr.map(k => JSON.stringify(k)).join('\n      ') });
  const badTr = Object.entries(TR).filter(([de, t]) => typeof t !== 'string' || !t.trim() || ph(de) !== ph(t));
  results.push({ name: 'Übersetzungen: gleiche Platzhalter {…} in Deutsch und Türkisch', ok: !badTr.length, detail: badTr.map(([k]) => JSON.stringify(k)).join('\n      ') });
  // Texte mit eingesetzten Werten (Template-Strings) brauchen Türkisch als dritten Wert
  const tpl2 = [...mainSrc.matchAll(/\btr\(`[^`]*`,\s*`[^`]*`\)/g)].length;
  results.push({ name: 'Übersetzungen: tr(`…`) in main.js mit türkischem dritten Wert', ok: !tpl2, detail: `${tpl2} Aufruf(e) nur mit Deutsch und Englisch` });
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

if (!filter || 'upnp'.includes(filter)) { // öffentliche Adresse per UPnP (nachgebauter Router, ohne Netz)
  console.log('\nupnp');
  let results;
  try { results = JSON.parse(spawnSync(process.execPath, [path.join(__dirname, 'upnp-check.js')], { encoding: 'utf8', timeout: 30000 }).stdout); }
  catch (e) { results = [{ name: 'UPnP prüfen', ok: false, detail: e.message }]; }
  for (const r of results) {
    if (r.ok) passed++; else failed++;
    console.log(`  ${r.ok ? '✓' : '✕'} ${r.name}${r.ok ? '' : '\n      ' + r.detail}`);
  }
}

if (!filter || 'relay'.includes(filter)) { // Vermittler + Haupt-PC + Gerät über den Vermittler (echt, nur 127.0.0.1)
  console.log('\nrelay');
  let results;
  try {
    results = JSON.parse(spawnSync(process.execPath, [path.join(__dirname, 'relay-check.js')], { encoding: 'utf8', timeout: 60000 }).stdout);
    results.push(...JSON.parse(spawnSync(process.execPath, [path.join(__dirname, 'relay-app-check.js')], { encoding: 'utf8', timeout: 90000 }).stdout)); // App „Swapline Relay“
    results.push(...JSON.parse(spawnSync(process.execPath, [path.join(__dirname, 'relay-update-check.js')], { encoding: 'utf8', timeout: 30000 }).stdout)); // eingebautes Update
  } catch (e) { results = [...(results || []), { name: 'Vermittler prüfen', ok: false, detail: e.message }]; }
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
    favorites: [], usage: {}, projects: [], activeProjectId: 'all', costFixV1: true, costFixV2: true, knownFoldersSeeded: true, knownFolders: [work],
    // language: 'de' – die Prüfungen erwarten deutsche Texte, auch auf Rechnern mit englischem System
    settings: { model: '', permissionMode: 'default', claudePath: '', theme: 'system', notify: 'off', sound: 'off', autoUpdate: true, language: 'de' },
    // Fernzugriff-Test: Warnung zu „Alles erlauben“ schon bestätigt (sonst blockiert der native Dialog den Testlauf)
    ...(name === 'remote' ? remoteSeed(work, configDir) : {}),
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
    env: { ...process.env, SWAPLINE_PROFILE: profile, SWAPLINE_TEST_JS: script, SWAPLINE_TEST_OUT: out, SWAPLINE_SCREENSHOT_DELAY: '1500', SWAPLINE_TEST_AUTOPAIR: '1' },
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
  fs.rmSync(work + '-other', { recursive: true, force: true });
}
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
