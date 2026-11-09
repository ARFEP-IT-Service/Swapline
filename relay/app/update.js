// Eingebautes Update von „Swapline Relay“: neueste Version unter den GitHub-Releases „relay-v…“ finden, das Setup
// herunterladen und mit SHA256SUMS.txt aus demselben Release prüfen. Nur öffentliche GitHub-Adressen, keine Anmeldung.
'use strict';
const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');

const REPO = 'ARFEP-IT-Service/Swapline';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const RELEASES = `https://github.com/${REPO}/releases/`;
const MAX_SETUP = 400 * 1024 * 1024;
// Downloads beginnen bei github.com und werden auf GitHubs Datei-Server umgeleitet – nur dorthin folgen
const allowedHost = h => h === 'github.com' || h === 'api.github.com' || /^[a-z0-9-]+\.githubusercontent\.com$/.test(h);

const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

// Aus der Release-Liste der API: neueste Relay-Version über `current`, mit Setup und Prüfsummen – sonst null
function pickUpdate(releases, current) {
  if (!Array.isArray(releases)) return null;
  const best = releases.filter(r => r && !r.draft && !r.prerelease && /^relay-v\d+\.\d+\.\d+$/.test(r.tag_name))
    .map(r => ({ r, version: r.tag_name.slice(7) })).sort((a, b) => cmp(b.version, a.version))[0];
  if (!best || cmp(best.version, current) <= 0) return null;
  const asset = name => (best.r.assets || []).find(a => a && a.name === name);
  const setup = asset(`Swapline-Relay-Setup-${best.version}.exe`), sums = asset('SHA256SUMS.txt');
  const okUrl = u => typeof u === 'string' && u.startsWith(`https://github.com/${REPO}/releases/download/${best.r.tag_name}/`);
  const url = typeof best.r.html_url === 'string' && best.r.html_url.startsWith(RELEASES) ? best.r.html_url : RELEASES + 'tag/' + best.r.tag_name;
  if (!setup || !sums || !okUrl(setup.browser_download_url) || !okUrl(sums.browser_download_url)) return { version: best.version, url, setup: null };
  return { version: best.version, url, setup: { name: setup.name, url: setup.browser_download_url, size: setup.size }, sums: sums.browser_download_url };
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
function get(url, { file, max = 4e6, onProgress, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('Ungültige Adresse')); }
    if (u.protocol !== 'https:' || !allowedHost(u.hostname)) return reject(new Error('Download nur von GitHub'));
    const req = https.get(u, { headers: { 'User-Agent': 'Swapline-Relay', Accept: file ? 'application/octet-stream' : 'application/vnd.github+json' }, timeout: 30000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Zu viele Umleitungen'));
        return resolve(get(new URL(res.headers.location, u).href, { file, max, onProgress, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('GitHub: HTTP ' + res.statusCode)); }
      const total = Number(res.headers['content-length']) || 0;
      if (total > max) { res.resume(); return reject(new Error('Datei zu groß')); }
      let got = 0;
      const chunks = [];
      const out = file ? fs.createWriteStream(file, { flags: 'wx' }) : null;
      res.on('data', c => {
        got += c.length;
        if (got > max) { req.destroy(new Error('Datei zu groß')); return; }
        if (out) out.write(c); else chunks.push(c);
        if (onProgress && total) onProgress(got / total);
      });
      res.on('end', () => {
        if (!out) return resolve(Buffer.concat(chunks).toString('utf8'));
        out.end(() => resolve(file));
      });
      res.on('error', e => { out?.destroy(); reject(e); });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

const sha256File = f => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(f).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

async function check(current) {
  return pickUpdate(JSON.parse(await get(API)), current);
}

// Setup herunterladen und prüfen; liefert den Pfad nur, wenn die Prüfsumme stimmt
async function download(info, dir, onProgress) {
  if (!info?.setup) throw new Error('Kein Setup im Release');
  const want = hashFor(await get(info.sums), info.setup.name);
  if (!want) throw new Error('Keine Prüfsumme für ' + info.setup.name);
  const file = require('node:path').join(dir, info.setup.name);
  await get(info.setup.url, { file, max: MAX_SETUP, onProgress });
  const have = await sha256File(file);
  if (have !== want) { fs.rmSync(file, { force: true }); throw new Error('Prüfsumme stimmt nicht – Update abgebrochen'); }
  return { file, sha256: have };
}

module.exports = { pickUpdate, hashFor, allowedHost, check, download, sha256File, cmp };
