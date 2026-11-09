// Eingebautes Update von „Swapline Relay“ (relay/app/update.js): Auswahl des Releases, Prüfsummen, erlaubte Adressen.
// Ohne Netz – die Release-Liste ist nachgebaut. Wird von tests/run.js gestartet, Ergebnis als JSON.
'use strict';
const path = require('node:path');
const U = require(path.join(__dirname, '..', 'relay', 'app', 'update.js'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

const DL = 'https://github.com/ARFEP-IT-Service/Swapline/releases/download/';
const rel = (tag, extra = {}) => ({
  tag_name: tag, draft: false, prerelease: false, html_url: 'https://github.com/ARFEP-IT-Service/Swapline/releases/tag/' + tag,
  assets: tag.startsWith('relay-v') ? [
    { name: `Swapline-Relay-Setup-${tag.slice(7)}.exe`, browser_download_url: `${DL}${tag}/Swapline-Relay-Setup-${tag.slice(7)}.exe`, size: 90e6 },
    { name: 'SHA256SUMS.txt', browser_download_url: `${DL}${tag}/SHA256SUMS.txt`, size: 200 },
  ] : [], ...extra,
});

(async () => {
  try {
    const list = [rel('v0.11.0'), rel('android-v0.6.0'), rel('relay-v0.1.1'), rel('relay-v0.1.0'), rel('relay-v0.3.0', { draft: true }), rel('relay-v0.2.0', { prerelease: true })];
    const u = U.pickUpdate(list, '0.1.0');
    check('Relay-Update: neueste Relay-Version (ohne Entwurf, Vorabversion, PC- und Android-Releases)', u?.version === '0.1.1' && u.setup?.name === 'Swapline-Relay-Setup-0.1.1.exe' && u.sums.endsWith('/relay-v0.1.1/SHA256SUMS.txt'), JSON.stringify(u));
    check('Relay-Update: gleiche oder ältere Version → kein Update', U.pickUpdate(list, '0.1.1') === null && U.pickUpdate(list, '0.2.0') === null);
    check('Relay-Update: Versionsvergleich numerisch (0.10.0 > 0.9.0)', U.pickUpdate([rel('relay-v0.10.0'), rel('relay-v0.9.0')], '0.9.0')?.version === '0.10.0');

    const foreign = rel('relay-v0.1.1'); foreign.assets[0].browser_download_url = 'https://example.com/Swapline-Relay-Setup-0.1.1.exe';
    const f = U.pickUpdate([foreign], '0.1.0');
    check('Relay-Update: Setup von fremder Adresse → nicht installierbar', f && f.setup === null);
    const noSums = rel('relay-v0.1.1'); noSums.assets.pop();
    check('Relay-Update: ohne SHA256SUMS.txt → nicht installierbar', U.pickUpdate([noSums], '0.1.0')?.setup === null);
    const other = rel('relay-v0.1.1'); other.assets[0].browser_download_url = `${DL}relay-v0.1.0/Swapline-Relay-Setup-0.1.1.exe`;
    check('Relay-Update: Datei aus anderem Release → nicht installierbar', U.pickUpdate([other], '0.1.0')?.setup === null);
    check('Relay-Update: unsinnige Antwort → kein Update', U.pickUpdate({ message: 'rate limit' }, '0.1.0') === null);

    const h = 'a'.repeat(64), h2 = 'B'.repeat(64);
    const sums = `﻿${h}  Swapline-Relay-Setup-0.1.1.exe\r\n${h2}  Swapline-Relay-0.1.1-windows.zip\r\n`;
    check('Relay-Update: Prüfsumme aus SHA256SUMS.txt (BOM, CRLF)', U.hashFor(sums, 'Swapline-Relay-Setup-0.1.1.exe') === h && U.hashFor(sums, 'Swapline-Relay-0.1.1-windows.zip') === h2.toLowerCase());
    check('Relay-Update: keine Prüfsumme für unbekannte Datei', U.hashFor(sums, 'Swapline-Relay-Setup-0.1.exe') === null && U.hashFor('kaputt', 'x') === null);

    check('Relay-Update: nur GitHub-Adressen', U.allowedHost('github.com') && U.allowedHost('release-assets.githubusercontent.com') && U.allowedHost('objects.githubusercontent.com')
      && !U.allowedHost('github.com.example.com') && !U.allowedHost('evilgithubusercontent.com') && !U.allowedHost('a.b.githubusercontent.com') && !U.allowedHost('example.com'));
    let err1 = '', err2 = '';
    await U.download({ setup: { name: 'x.exe', url: 'https://example.com/x.exe' }, sums: 'https://example.com/SHA256SUMS.txt' }, require('node:os').tmpdir()).catch(e => { err1 = e.message; });
    await U.download({ setup: { name: 'x.exe', url: 'x' }, sums: 'http://github.com/x' }, require('node:os').tmpdir()).catch(e => { err2 = e.message; });
    check('Relay-Update: Download von fremden Adressen oder ohne HTTPS abgelehnt', /nur von GitHub/.test(err1) && /nur von GitHub/.test(err2), `${err1} | ${err2}`);
  } catch (e) {
    check('Relay-Update-Test', false, e.stack || e.message);
  }
  process.stdout.write(JSON.stringify(results));
})();
