// Bilder in Antworten (src/chat-core.js): Bild-Dateien nur aus erlaubten Ordnern und nur echte Bilder, Bilder aus dem
// Internet nur über https und nur von öffentlichen Adressen. Ohne Netz. Wird von tests/run.js gestartet, Ergebnis als JSON.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const c = require(path.join(__dirname, '..', 'src', 'chat-core.js'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-img-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-img-other-'));
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.mkdirSync(path.join(d, 'out'));
    fs.writeFileSync(path.join(d, 'out', 'chart.png'), png);
    fs.writeFileSync(path.join(d, 'tarn.png'), 'kein Bild, nur Text');
    fs.writeFileSync(path.join(d, 'geheim.txt'), 'geheim');
    fs.writeFileSync(path.join(other, 'fremd.png'), png);

    const r = c.readImage('out/chart.png', d, [d]);
    check('Bilder: relativer Pfad im Ordner des Chats', r.media === 'image/png' && Buffer.from(r.data, 'base64').equals(png), JSON.stringify(r).slice(0, 80));
    check('Bilder: absoluter Pfad im erlaubten Ordner', !!c.readImage(path.join(d, 'out', 'chart.png'), '', [d]).data);
    check('Bilder: außerhalb der erlaubten Ordner abgelehnt', c.readImage(path.join(other, 'fremd.png'), d, [d]).error === 'nicht freigegeben'
      && c.readImage('../' + path.basename(other) + '/fremd.png', d, [d]).error === 'nicht freigegeben');
    check('Bilder: nur Bilddateien (Endung und Inhalt)', c.readImage('geheim.txt', d, [d]).error === 'kein Bild' && c.readImage('tarn.png', d, [d]).error === 'kein Bild');
    check('Bilder: Netzwerkpfade und Unsinn abgelehnt', c.readImage('\\\\server\\share\\a.png', d, [d]).error === 'Netzwerkpfad');
    check('Bilder: relativer Pfad ohne Ordner abgelehnt', !!c.readImage('out/chart.png', '', [d]).error);
    try {
      fs.symlinkSync(path.join(other, 'fremd.png'), path.join(d, 'link.png'));
      check('Bilder: Verknüpfung nach außen abgelehnt', c.readImage('link.png', d, [d]).error === 'nicht freigegeben');
    } catch { /* Windows ohne Rechte für Verknüpfungen: Fall entfällt */ }

    // SSH-Server: das Skript, das Swapline dort ausführt – hier mit einer lokalen Bash (Git Bash bzw. Linux)
    const bash = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find(f => fs.existsSync(f)) : '/bin/bash';
    if (bash) {
      const { execFileSync } = require('node:child_process');
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-ssh-home-'));
      // volle Pfade (GitHub-Windows liefert Temp-Ordner als 8.3-Kurznamen wie RUNNER~1, die Git Bash nicht auflöst)
      const posix = p => { const full = fs.realpathSync.native(p); return process.platform === 'win32' ? execFileSync(bash, ['-c', 'cygpath -u ' + JSON.stringify(full)], { encoding: 'utf8' }).trim() : full; };
      fs.mkdirSync(path.join(home, 'bilder')); fs.writeFileSync(path.join(home, 'bilder', 'qr.png'), png); fs.writeFileSync(path.join(home, 'notiz.png'), 'text');
      const run = (folders, cwd, file) => c.serverImageResult(execFileSync(bash, ['-c', c.serverImageScript(folders, cwd, file)], { encoding: 'utf8', env: { ...process.env, HOME: posix(home) } }), file);
      const proj = posix(d);
      const okHome = run([proj], '', '~/bilder/qr.png');
      const okProj = run([proj], proj, 'out/chart.png');
      const outside = run([proj], proj, posix(path.join(other, 'fremd.png')));
      const fake = run([proj], '', '~/notiz.png');
      check('Bilder per SSH: Server-Ordner und Home ja, außerhalb und Fälschung nein', okHome.media === 'image/png' && okProj.media === 'image/png' && outside.error === 'nicht freigegeben' && fake.error === 'kein Bild',
        JSON.stringify([okHome.error, okProj.error, outside, fake]));
      check('Bilder per SSH: Anführungszeichen im Pfad können nichts ausführen', run([proj], proj, "x'; touch pwned; '.png").error === 'nicht gefunden' && !fs.existsSync(path.join(d, 'pwned')));
      fs.rmSync(home, { recursive: true, force: true });
    }

    check('Bilder: öffentliche und private Adressen', c.publicIp('8.8.8.8') && c.publicIp('2001:4860:4860::8888')
      && !c.publicIp('192.168.178.1') && !c.publicIp('10.0.0.1') && !c.publicIp('127.0.0.1') && !c.publicIp('100.64.1.2') && !c.publicIp('169.254.1.1')
      && !c.publicIp('::1') && !c.publicIp('fd00::1') && !c.publicIp('::ffff:192.168.0.1'));
    const http = await c.fetchWebImage('http://example.com/a.png');
    const local = await c.fetchWebImage('https://127.0.0.1/a.png');
    const creds = await c.fetchWebImage('https://user:pw@example.com/a.png');
    check('Bilder aus dem Internet: nur https, nie das eigene Netz, keine Zugangsdaten in der Adresse', http.error === 'nur https' && local.error === 'keine öffentliche Adresse' && creds.error === 'nur https', JSON.stringify([http, local, creds]));
  } catch (e) {
    check('Bilder', false, e.stack || e.message);
  } finally {
    fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify(results));
})();
