// Bildschirmfotos für die README mit Demo-Daten (keine echten Konten, Chats oder Pfade):
//   node tools/screenshots.js            → docs/screenshots/<szene>.png
//   node tools/screenshots.js chat       → nur Szenen, deren Name "chat" enthält
// Jede Szene in tools/screenshots/*.js läuft in einem eigenen Testprofil (wie npm test) und baut
// ihre Ansicht in der Oberfläche auf; danach speichert die App ein Bildschirmfoto ihres eigenen Fensters.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const filter = process.argv[2] || '';
const sceneDir = path.join(__dirname, 'screenshots');
const outDir = path.join(root, 'docs', 'screenshots');
const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
fs.mkdirSync(outDir, { recursive: true });

const day = new Date().toISOString().slice(0, 10);
const now = Math.floor(Date.now() / 1000);
for (const file of fs.readdirSync(sceneDir).filter(f => f.endsWith('.js') && f.includes(filter)).sort()) {
  const name = path.basename(file, '.js');
  const profile = `shot-${name}`;
  const userData = path.join(appData, `Swapline-${profile}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-shot-'));
  const cfg = id => { const d = path.join(work, id); fs.mkdirSync(d, { recursive: true }); return d; };
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });
  const scene = fs.readFileSync(path.join(sceneDir, file), 'utf8');
  const theme = (scene.match(/^\/\/ theme: (\w+)/m) || [])[1] || 'dark';
  const language = (scene.match(/^\/\/ language: (\w+)/m) || [])[1] || 'de';
  fs.writeFileSync(path.join(userData, 'swapline.json'), JSON.stringify({
    profiles: [
      { id: 'arbeit', name: 'Arbeit', color: '#1581FF', configDir: cfg('arbeit') },
      { id: 'privat', name: 'Privat', color: '#22C55E', configDir: cfg('privat') },
    ],
    activeProfileId: 'arbeit', favorites: [], activeProjectId: 'all',
    projects: [
      { id: 'p-web', name: 'Webshop', color: '#F59E0B', cwd: '' },
      { id: 'p-api', name: 'Backend API', color: '#8B5CF6', cwd: '' },
      { id: 'p-doc', name: 'Doku', color: '#EC4899', cwd: '' },
    ],
    usage: { arbeit: { costUsd: 18.42, days: { [day]: 2.37 }, limits: { unifiedWindows: { five_hour: { utilization: 0.34, resetsAt: now + 2 * 3600 + 900 }, seven_day: { utilization: 0.61, resetsAt: now + 3 * 86400 } } } } },
    costFixV1: true, costFixV2: true, knownFoldersSeeded: true, knownFolders: [work],
    settings: { model: '', permissionMode: 'default', claudePath: '', theme, language, notify: 'off', sound: 'off' },
  }));
  const script = path.join(work, 'scene.js');
  fs.writeFileSync(script, `(async () => {\nconst sleep = ms => new Promise(r => setTimeout(r, ms));\n${scene}\nreturn true;\n})()`);
  const out = path.join(outDir, `${name}.png`);
  fs.rmSync(out, { force: true });
  spawnSync(electron, ['.'], {
    cwd: root, timeout: 120000, stdio: 'ignore',
    env: { ...process.env, SWAPLINE_PROFILE: profile, SWAPLINE_TEST_JS: script, SWAPLINE_SCREENSHOT: out, SWAPLINE_SCREENSHOT_DELAY: '1500' },
  });
  console.log(fs.existsSync(out) ? `✓ ${path.relative(root, out)}` : `✕ ${name}: kein Bild`);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}
