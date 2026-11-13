// „swapline-server update“: neueste Version unter den GitHub-Releases „server-v…“ finden, Paket und SHA256SUMS.txt
// herunterladen (nur von GitHub, ohne Anmeldung), Prüfsumme vergleichen, in einem privaten Temp-Ordner entpacken und
// install.sh daraus ausführen. Geräte und Einstellungen (~/.config/swapline-server) bleiben dabei unberührt.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO = 'ARFEP-IT-Service/Swapline';
// 100 statt 30: PC-, Relay-, Server- und Handy-Releases stehen in einer Liste
const API = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
const MAX_PACKAGE = 50 * 1024 * 1024;
// Downloads beginnen bei github.com und werden auf GitHubs Datei-Server umgeleitet – nur dorthin folgen
const allowedHost = h => h === 'github.com' || h === 'api.github.com' || /^[a-z0-9-]+\.githubusercontent\.com$/.test(h);
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

// Aus der Release-Liste: neueste Server-Version über `current` mit Paket und Prüfsummen – sonst null
function pickUpdate(releases, current) {
  if (!Array.isArray(releases)) return null;
  const best = releases.filter(r => r && !r.draft && !r.prerelease && /^server-v\d+\.\d+\.\d+$/.test(r.tag_name))
    .map(r => ({ r, version: r.tag_name.slice(8) })).sort((a, b) => cmp(b.version, a.version))[0];
  if (!best || cmp(best.version, current) <= 0) return null;
  const asset = name => (best.r.assets || []).find(a => a && a.name === name);
  const pkg = asset(`swapline-server-${best.version}.tar.gz`), sums = asset('SHA256SUMS.txt');
  const okUrl = u => typeof u === 'string' && u.startsWith(`https://github.com/${REPO}/releases/download/${best.r.tag_name}/`);
  if (!pkg || !sums || !okUrl(pkg.browser_download_url) || !okUrl(sums.browser_download_url)) return { version: best.version, pkg: null };
  return { version: best.version, pkg: { name: pkg.name, url: pkg.browser_download_url }, sums: sums.browser_download_url };
}

// Zeile „<sha256>  <Dateiname>“ aus SHA256SUMS.txt
function hashFor(sumsText, name) {
  for (const line of String(sumsText).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

// GET mit Umleitungen (nur GitHub), Ergebnis als Text oder in eine Datei
function get(url, { file, max = 4e6, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('Ungültige Adresse')); }
    if (u.protocol !== 'https:' || !allowedHost(u.hostname)) return reject(new Error('Download nur von GitHub'));
    const req = https.get(u, { headers: { 'User-Agent': 'Swapline-Server', Accept: file ? 'application/octet-stream' : 'application/vnd.github+json' }, timeout: 30000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Zu viele Umleitungen'));
        return resolve(get(new URL(res.headers.location, u).href, { file, max, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('GitHub: HTTP ' + res.statusCode)); }
      if (Number(res.headers['content-length']) > max) { res.resume(); return reject(new Error('Datei zu groß')); }
      let got = 0;
      const chunks = [];
      const out = file ? fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }) : null;
      res.on('data', c => {
        got += c.length;
        if (got > max) return req.destroy(new Error('Datei zu groß'));
        if (out) out.write(c); else chunks.push(c);
      });
      res.on('end', () => (out ? out.end(() => resolve(file)) : resolve(Buffer.concat(chunks).toString('utf8'))));
      res.on('error', e => { out?.destroy(); reject(e); });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

const sha256File = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const check = async current => pickUpdate(JSON.parse(await get(API)), current);

// Herunterladen, prüfen, entpacken, install.sh ausführen. log(text) für Fortschritt; liefert den Exitcode von install.sh.
async function install(info, log = () => {}) {
  if (!info?.pkg) throw new Error('Kein Paket im Release');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-server-update-')); // 0700
  try {
    const want = hashFor(await get(info.sums), info.pkg.name);
    if (!want) throw new Error('Keine Prüfsumme für ' + info.pkg.name);
    log(`Lade ${info.pkg.name} …`);
    const file = await get(info.pkg.url, { file: path.join(dir, info.pkg.name), max: MAX_PACKAGE });
    if (sha256File(file) !== want) throw new Error('Prüfsumme stimmt nicht – Update abgebrochen');
    log('Prüfsumme OK');
    // GNU tar lehnt absolute Pfade und „..“ ab; erwartet wird genau ein Ordner swapline-server-<Version>
    execFileSync('tar', ['xzf', file, '-C', dir], { stdio: 'ignore' });
    const root = path.join(dir, `swapline-server-${info.version}`);
    const script = path.join(root, 'install.sh');
    if (!fs.existsSync(script) || !fs.existsSync(path.join(root, 'server', 'swapline-server.js'))) throw new Error('Paket unvollständig');
    const r = spawnSync('sh', [script], { cwd: root, stdio: 'inherit' });
    return r.status ?? 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { pickUpdate, hashFor, allowedHost, check, install, cmp };
