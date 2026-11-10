// Swapline Server (server/): der echte Dienst mit nachgebautem Claude Code (tests/fake-claude.js) in einem Testordner –
// Koppeln mit Bestätigung im Terminal, Stand, Chat mit Rückfrage, Verlauf, „!“-Befehle, Upload, Ordner, Vermittler-Code.
// Nur 127.0.0.1. Wird von tests/run.js gestartet, Ergebnis als JSON.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swapline-server-test-'));
process.env.SWAPLINE_SERVER_DIR = path.join(tmp, 'config');
process.env.SWAPLINE_SERVER_CLAUDE = path.join(__dirname, 'fake-claude.js');
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
const work = path.join(tmp, 'projekt');
fs.mkdirSync(work, { recursive: true });

const root = path.join(__dirname, '..');
const remote = require(path.join(root, 'src', 'remote.js'));
const C = require(path.join(root, 'server', 'lib', 'config.js'));
const { startDaemon } = require(path.join(root, 'server', 'lib', 'daemon.js'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 30)); } return false; };

// Befehlszeile nachbauen: Zeilen an den Steuer-Socket, Antworten sammeln
function ctl(onMsg) {
  return new Promise((resolve, reject) => {
    const s = net.connect(C.controlPath(), () => resolve(s));
    s.on('error', reject);
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); onMsg(JSON.parse(l), s); } });
  });
}
async function op(o) { let r; const p = new Promise(x => { r = x; }); const s = await ctl(m => r(m)); s.write(JSON.stringify(o) + '\n'); const m = await p; s.end(); return m; }

(async () => {
  const d = startDaemon({ port: 0 });
  try {
    const port = await d.start();
    check('Server: Dienst startet', port > 0, port);

    // Ohne „pair“ im Terminal: keine Kopplung möglich
    let early = ''; try { await remote.pair({ address: '127.0.0.1', port, code: '0'.repeat(26), name: 'x' }); } catch (e) { early = e.message; }
    check('Server: ohne „swapline-server pair“ keine Kopplung', !!early, early);

    // Koppeln: Code und Link vom Dienst, Bestätigung „im Terminal“
    const asked = [];
    let pairInfo;
    const got = new Promise(r => { pairInfo = r; });
    const pairSock = await ctl((m, s) => {
      if (m.code) pairInfo(m);
      if (m.event === 'confirm') { asked.push(m.name); s.write(JSON.stringify({ op: 'confirm', id: m.id, ok: true }) + '\n'); }
    });
    pairSock.write(JSON.stringify({ op: 'pair' }) + '\n');
    const info = await got;
    check('Server: Kopplungslink wie bei Swapline am PC', /^swapline:\/\/pair\?v=1&a=.*&p=\d+&c=[0-9A-Z]{26}&n=/.test(info.link), info.link);
    const p = await remote.pair({ address: '127.0.0.1', port, code: info.code, name: 'Testhandy' });
    check('Server: Kopplung erst nach Bestätigung im Terminal', asked[0] === 'Testhandy' && /^[0-9a-f]{16}$/.test(p.deviceId));
    pairSock.end();
    const cfgFile = path.join(process.env.SWAPLINE_SERVER_DIR, 'config.json');
    if (process.platform !== 'win32') check('Server: Einstellungen nur für den Benutzer lesbar (0600)', (fs.statSync(cfgFile).mode & 0o077) === 0, (fs.statSync(cfgFile).mode & 0o777).toString(8));

    // Verbinden wie das Handy
    const events = [];
    const client = remote.createClient({ onEvent: (k, data) => events.push(data), onStatus: () => {}, log: () => {} });
    client.use({ id: 'h', address: '127.0.0.1', port, deviceId: p.deviceId, key: Buffer.from(p.key, 'base64') });
    await until(() => client.state === 'connected');
    const st = await client.call('store:get', []);
    check('Server: Stand für das Handy (Konto = Server, Erreichbarkeit)', st.profiles[0].id === 'server' && st.reach.port === port && st.allowBypass === true && Array.isArray(st.reach.addresses), JSON.stringify(st).slice(0, 200));
    check('Server: Anmeldestatus von Claude Code', (await client.call('profiles:status', ['server'])).loggedIn === true);

    // Neue Chats nur in freigegebenen Ordnern
    const tab = { id: 'tabserver1', cwd: work, sessionId: null, model: '', effort: '', permissionMode: 'default' };
    check('Server: Ordner ohne Freigabe abgelehnt', (await client.call('session:send', [{ tab, content: 'Hallo' }])) === false);
    check('Server: Ordner freigeben', (await op({ op: 'folder-add', path: work })).ok === true && (await client.call('store:get', [])).allowedFolders.includes(path.resolve(work)));

    // Chat mit Rückfrage: Erlauben → Antwort
    check('Server: Nachricht an Claude', (await client.call('session:send', [{ tab, content: 'Hallo Server' }])) === true);
    await until(() => events.some(e => e.msg?.type === 'control_request'));
    const pend = await client.call('session:pending', [{ tabId: tab.id }]);
    check('Server: Rückfrage kommt an und bleibt abrufbar', events.some(e => e.tabId === tab.id && e.msg?.type === 'control_request') && pend.requests.length === 1, JSON.stringify(pend));
    check('Server: veränderte Eingabe abgelehnt', (await client.call('session:respond', [{ tabId: tab.id, requestId: 'req1', response: { behavior: 'allow', updatedInput: { command: 'rm -rf /' } } }])) === false);
    check('Server: Erlauben', (await client.call('session:respond', [{ tabId: tab.id, requestId: 'req1', response: { behavior: 'allow', updatedInput: { command: 'echo hi' } } }])) === true);
    await until(() => events.some(e => e.msg?.type === 'result'));
    const answer = events.find(e => e.msg?.type === 'assistant')?.msg.message.content[0].text;
    check('Server: Antwort von Claude kommt beim Gerät an', answer === 'erlaubt: Hallo Server', answer);

    // „!“-Befehle: mit Freigabe, Ausgabe geht mit der nächsten Nachricht an Claude
    check('Server: „!“-Befehl', (await client.call('session:bash', [{ tab, command: 'echo bang-ok' }])) === true);
    await until(() => events.some(e => e.msg?.type === 'swapline_bash' && e.msg.state === 'done'), 30000); // PowerShell startet auf GitHub-Windows langsam
    check('Server: „!“-Ausgabe im Chat', /bang-ok/.test(events.find(e => e.msg?.type === 'swapline_bash' && e.msg.state === 'done')?.msg.output || ''));
    events.length = 0;
    await client.call('session:send', [{ tab, content: 'Weiter' }]);
    await until(() => events.some(e => e.msg?.type === 'control_request'));
    await client.call('session:respond', [{ tabId: tab.id, requestId: 'req1', response: { behavior: 'deny', message: 'nein' } }]);
    await until(() => events.some(e => e.msg?.type === 'assistant'));
    const second = events.find(e => e.msg?.type === 'assistant')?.msg.message.content[0].text || '';
    check('Server: Claude sieht die „!“-Ausgabe mit der nächsten Nachricht', /<bash-input>echo bang-ok<\/bash-input>/.test(second) && /Weiter$/.test(second), second.slice(0, 120));
    await op({ op: 'device-bypass', device: 'Testhandy', on: false });
    let noBang = ''; try { await client.call('session:bash', [{ tab, command: 'echo nein' }]); } catch (e) { noBang = e.message; }
    check('Server: ohne Freigabe kein „!“ und kein „Alles erlauben“', /nicht freigegeben/.test(noBang) && (await client.call('session:send', [{ tab: { ...tab, id: 'tabserver2', permissionMode: 'bypassPermissions' }, content: 'x' }])) === false, noBang);

    // Verlauf in Seiten aus ~/.claude/projects
    const sid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const pdir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-srv-app');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, sid + '.jsonl'), [1, 2, 3, 4].map(i => JSON.stringify({ type: 'user', cwd: '/srv/app', message: { role: 'user', content: 'Frage ' + i } })).join('\n') + '\n');
    const hist = await client.call('history:list', ['server']);
    const page = await client.call('history:loadSession', [{ profileId: 'server', sessionId: sid, turns: 2 }]);
    check('Server: Verlauf und Seiten', hist.some(h => h.sessionId === sid && !('file' in h)) && page.start === 2 && page.msgs.length === 2 && page.total === 4, JSON.stringify(page).slice(0, 120));
    check('Server: ungültige Session-ID → leer', (await client.call('history:loadSession', [{ sessionId: '../x', turns: 2 }])).msgs.length === 0);

    // Bilder: aus freigegebenen Ordnern, nur echte Bilder
    fs.writeFileSync(path.join(work, 'shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const im = await client.call('files:image', [{ cwd: work, path: 'shot.png' }]);
    const imBad = await client.call('files:image', [{ cwd: work, path: path.join(process.env.SWAPLINE_SERVER_DIR, 'config.json') }]);
    check('Server: Bilder aus dem Projektordner, keine anderen Dateien', im.media === 'image/png' && !!imBad.error, JSON.stringify(imBad));

    // Upload und gesperrte Kanäle
    const up = await client.call('files:upload', [{ name: '../böse name.txt', data: Buffer.from('Inhalt').toString('base64') }]);
    check('Server: Upload in eigenen Ordner, Name bereinigt', up.path.startsWith(path.join(process.env.SWAPLINE_SERVER_DIR, 'uploads')) && !up.name.includes('/') && fs.readFileSync(up.path, 'utf8') === 'Inhalt', up.path);
    let blocked = ''; try { await client.call('projects:remove', ['x']); } catch (e) { blocked = e.message; }
    check('Server: andere Kanäle gesperrt', /nicht verfügbar/.test(blocked) && (await client.call('task:readOutput', [path.join(tmp, 'x.output')])).error);

    // Vermittler: Einrichtungscode prüfen
    check('Server: ungültiger Einrichtungscode abgelehnt', !!(await op({ op: 'relay', code: 'srelay1.kaputt' })).error);
    const codeOk = 'srelay1.' + Buffer.from(JSON.stringify({ a: '127.0.0.1', p: 1, s: 'x'.repeat(40) })).toString('base64url');
    check('Server: Vermittler eingerichtet → im Kopplungslink und beim Gerät', (await op({ op: 'relay', code: codeOk })).ok && (await client.call('store:get', [])).reach.relay?.hostId?.length === 16);
    await op({ op: 'relay', code: null });

    // Gerät entfernen → Verbindung weg
    await op({ op: 'device-remove', device: 'Testhandy' });
    check('Server: Gerät entfernt → getrennt, Status ohne Gerät', await until(() => client.state !== 'connected', 5000) && (await op({ op: 'status' })).devices.length === 0);
    client.use(null);
  } catch (e) {
    check('Server-Test', false, e.stack || e.message);
  } finally {
    d.stop();
    setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} process.stdout.write(JSON.stringify(results)); process.exit(0); }, 300);
  }
})();
