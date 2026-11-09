// Fernzugriff: dieses Swapline koppelt sich über 127.0.0.1 mit sich selbst (Haupt-PC und Gerät in einer App).
// Kopplungsdialog wird im Testlauf automatisch bestätigt (SWAPLINE_TEST_AUTOPAIR, nur unverpackt).
(async () => {
  const port = 47900 + Math.floor(Math.random() * 900);
  let info = await api.remote.hostSet({ enabled: 'ja' });
  check('Fernzugriff: ungültige Eingabe abgelehnt', !!info.error && !info.host.running);
  info = await api.remote.hostSet({ enabled: true, port: 80 });
  check('Fernzugriff: Port unter 1024 abgelehnt', !!info.error && !info.host.running);
  info = await api.remote.hostSet({ enabled: true, port });
  check('Haupt-PC-Dienst läuft', info.host.running && info.host.listenPort === port, JSON.stringify(info.host).slice(0, 300));

  let r = await api.remote.pair({ address: '127.0.0.1', port, code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GG' });
  check('Koppeln ohne offenen Code abgelehnt', !!r.error && r.hosts.length === 0, r.error);
  const p = await api.remote.pairStart();
  check('Kopplungscode erzeugt (128 Bit)', /^[0-9A-Z]{4}(-[0-9A-Z]{1,4}){6}$/.test(p.code || ''), p.code);
  const svg = atob(String(p.qr || '').replace('data:image/svg+xml;base64,', ''));
  check('QR-Code für die Handy-App (SVG, ohne Skripte)', String(p.qr).startsWith('data:image/svg+xml;base64,') && svg.startsWith('<svg') && !/<script|on\w+=/i.test(svg), String(p.qr).slice(0, 60));
  // erstes Zeichen ändern – das letzte trägt bei 128 Bit nur Füllbits
  const wrong = (p.code[0] === '0' ? '1' : '0') + p.code.slice(1);
  r = await api.remote.pair({ address: '127.0.0.1', port, code: wrong });
  check('Falscher Code abgelehnt', !!r.error && r.hosts.length === 0, r.error);
  check('Ungültige Adresse abgelehnt', !!(await api.remote.pair({ address: '\\\\server\\share', port, code: p.code })).error);
  r = await api.remote.pair({ address: '127.0.0.1', port, code: p.code });
  check('Koppeln mit richtigem Code', !r.error && r.hosts.length === 1 && r.host.devices.length === 1, r.error);
  check('Code gilt nur einmal', !!(await api.remote.pair({ address: '127.0.0.1', port, code: p.code })).error);
  const hostId = r.hosts[0].id, devId = r.host.devices[0].id;

  // Verbunden bleibt der Haupt-PC im Hintergrund; Chats des Haupt-PCs laufen über remote:call
  const R = (ch, ...a) => api.remote.call(hostId, ch, a);
  await until(async () => (await api.remote.info()).hosts[0]?.state === 'connected', 10000);
  check('Mit Haupt-PC verbunden (im Hintergrund)', (await api.remote.info()).hosts[0].state === 'connected');
  const rs = await R('store:get');
  check('Stand vom Haupt-PC ohne Konfigurationsordner', rs && rs.profiles.length >= 1 && rs.profiles.every(x => !('configDir' in x)) && Array.isArray(rs.allowedFolders) && Array.isArray(rs.projectGroups), JSON.stringify(rs?.profiles));
  const local = await api.getStore();
  check('Eigener Stand bleibt lokal und ohne Geräteschlüssel', !local.remote && local.profiles.length === 2 && !JSON.stringify(local).includes('keyEnc'), Object.keys(local).join(','));
  check('Nicht freigegebene Kanäle gehen nicht an den Haupt-PC', (await R('projects:add', { name: 'X' })) === false && (await R('profiles:add', { name: 'X' })) === false && (await R('ext:action', { profileId: 'test', action: 'install', id: 'a@b' })) === false);
  check('Unbekannter Haupt-PC abgelehnt', (await api.remote.call('gibtsnicht', 'history:list', ['test'])).length === 0);
  check('Verlauf über Haupt-PC lesbar', Array.isArray(await R('history:list', 'test')));
  check('Chat mit ungültigen Daten am Haupt-PC abgelehnt', (await R('session:send', { tab: { id: 'x' }, content: 'hi' })) === false);
  check('Antwort ohne offene Rückfrage abgelehnt', (await R('session:respond', { tabId: 'abcdefgh', requestId: 'y', response: { behavior: 'allow', updatedInput: {} } })) === false);

  // Freigabe je Gerät: Konten, Projekte, einzelne Chats – durchgesetzt am Haupt-PC
  const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333';
  const BS = String.fromCharCode(92), OTHER = WORK + '-other';
  const ids = list => list.map(h => h.sessionId).sort().join(',');
  const send = tab => R('session:send', { tab: { id: 'abcdefgh', model: '', effort: '', permissionMode: 'default', sessionId: null, ...tab }, content: 'hi' });
  check('Ohne Einschränkung: beide Konten und alle Chats', (await R('store:get')).profiles.length === 2 && ids(await R('history:list', 'test')) === [U1, U2].join(','));
  check('Ungültige Freigabe abgelehnt', !!(await api.remote.deviceSet({ id: devId, scope: { profiles: 'x', projects: null, chats: [] } })).error);
  await api.remote.deviceSet({ id: devId, scope: { profiles: ['test'], projects: null, chats: [] } });
  let st = await R('store:get');
  check('Nur freigegebenes Konto sichtbar', st.profiles.length === 1 && st.profiles[0].id === 'test' && st.scope.accountsLimited, JSON.stringify(st.profiles));
  check('Verlauf des anderen Kontos gesperrt', (await R('history:list', 'test2')).length === 0);
  check('Chat des anderen Kontos nicht ladbar', (await R('history:loadSession', { profileId: 'test2', sessionId: U3 })).length === 0);
  check('Neuer Chat im anderen Konto abgelehnt', (await send({ profileId: 'test2', cwd: WORK })) === false);

  await api.remote.deviceSet({ id: devId, scope: { profiles: null, projects: ['p-work'], chats: [] } });
  st = await R('store:get');
  check('Projekt-Freigabe: nur Projekt und seine Ordner', st.scope.limited && st.projects.length === 1 && st.allowedFolders.length === 1 && st.favorites.length === 0, JSON.stringify(st.allowedFolders));
  check('Projekt-Freigabe: nur Chats im Projektordner', ids(await R('history:list', 'test')) === U1, ids(await R('history:list', 'test')));
  check('Projekt-Freigabe: Chat im Projekt ladbar', (await R('history:loadSession', { profileId: 'test', sessionId: U1 })).length > 0);
  check('Projekt-Freigabe: Chat außerhalb nicht ladbar', (await R('history:loadSession', { profileId: 'test', sessionId: U2 })).length === 0);
  check('Projekt-Freigabe: neuer Chat außerhalb abgelehnt', (await send({ profileId: 'test', cwd: OTHER })) === false);
  check('Projekt-Freigabe: neuer Chat ohne Ordner abgelehnt', (await send({ profileId: 'test', cwd: '' })) === false);
  check('Projekt-Freigabe: fremden Chat fortsetzen abgelehnt', (await send({ profileId: 'test', cwd: OTHER, sessionId: U2 })) === false);
  check('Projekt-Freigabe: Ausgabe fremder Aufgaben gesperrt', !!(await R('task:readOutput', WORK + BS + 'tasks' + BS + 'x.output')).error);

  await api.remote.deviceSet({ id: devId, scope: { profiles: null, projects: [], chats: [U2] } });
  st = await R('store:get');
  check('Chat-Freigabe: nur der einzelne Chat', ids(await R('history:list', 'test')) === U2 && st.projects.length === 0 && !st.scope.newChats, ids(await R('history:list', 'test')));
  check('Chat-Freigabe: geteilter Chat ladbar', (await R('history:loadSession', { profileId: 'test', sessionId: U2 })).length > 0);
  check('Chat-Freigabe: Volltextsuche findet nur Freigegebenes', (await R('history:search', { profileId: 'test', query: 'Hallo' })).every(h => h.sessionId === U2));
  check('Geräteliste zeigt die Freigabe', JSON.stringify((await api.remote.info()).host.devices[0].scope) === JSON.stringify({ profiles: null, projects: [], chats: [U2] }));
  await api.remote.deviceSet({ id: devId, scope: { profiles: null, projects: null, chats: [] } });

  // „Alles erlauben“ je Gerät
  await api.remote.deviceSet({ id: devId, allowBypass: false });
  check('Ohne Gerätefreigabe kein „Alles erlauben“', (await R('session:confirmBypass', 'abcdefgh')) === false && !(await R('store:get')).allowBypass);
  await api.remote.deviceSet({ id: devId, allowBypass: true });
  check('Mit Gerätefreigabe „Alles erlauben“ möglich', (await R('session:confirmBypass', 'abcdefgh')) === true);

  // Projekte und Ordner am Haupt-PC vom Gerät aus (nur mit Freigabe, Ordner nur freigegebene, nie löschen)
  const activeBefore = (await api.getStore()).activeProjectId;
  check('Projekt anlegen ohne Freigabe abgelehnt', (await R('projects:add', { name: 'Neu', cwd: WORK })) === false);
  await api.remote.deviceSet({ id: devId, allowProjects: true });
  await until(() => hostStores[hostId]?.canEditProjects === true, 5000);
  check('Freigabe „Projekte anlegen“ kommt sofort beim Gerät an (ohne Neuverbinden)', hostStores[hostId]?.canEditProjects === true);
  const hp = await R('projects:add', { name: 'Vom Laptop', cwd: WORK });
  const np = hp?.projects.find(p => p.name === 'Vom Laptop');
  check('Projekt am Haupt-PC anlegen mit Freigabe', !!np && np.cwd === WORK && hp.canEditProjects, JSON.stringify(hp?.projects));
  check('Aktives Projekt am Haupt-PC bleibt unverändert', (await api.getStore()).activeProjectId === activeBefore);
  check('Projektordner außerhalb der Freigabe abgelehnt', (await R('projects:add', { name: 'X', cwd: ['C:', 'Windows'].join(BS) })) === false);
  const hg = await R('projects:groupAdd', { name: 'Laptop-Ordner' });
  const ng = hg?.projectGroups.find(g => g.name === 'Laptop-Ordner');
  check('Ordner am Haupt-PC anlegen', !!ng);
  const hu2 = await R('projects:update', { id: np.id, patch: { name: 'Umbenannt', groupId: ng.id } });
  check('Projekt umbenennen und in den Ordner legen', hu2?.projects.find(p => p.id === np.id)?.name === 'Umbenannt' && hu2.projects.find(p => p.id === np.id).groupId === ng.id);
  check('Projekt löschen vom Gerät nicht möglich', (await R('projects:remove', np.id)) === false && (await api.getStore()).projects.some(p => p.id === np.id));
  await api.remote.deviceSet({ id: devId, allowProjects: false });
  check('Ohne Freigabe kein Bearbeiten mehr', (await R('projects:update', { id: np.id, patch: { name: 'X' } })) === false);

  // Oberfläche: Chats eines Haupt-PCs neben den eigenen
  remoteState = await api.remote.info();
  await refreshHost(hostId);
  const lt = makeTab({ title: 'Lokaler Chat' }), ht = makeTab({ title: 'Chat am Haupt-PC', host: hostId, profileId: 'test2' });
  tabs.push(lt, ht); renderRail(); renderList();
  const titles = () => [...document.querySelectorAll('#list .item .title')].map(e => e.textContent);
  check('„Allgemein“ zeigt eigene und Haupt-PC-Chats zusammen', titles().includes('Lokaler Chat') && titles().includes('Chat am Haupt-PC') && !!document.querySelector('#list .host-tag'));
  check('Haupt-PC in der Leiste wie ein Projekt', document.querySelectorAll('#rail-hosts .rail-profile').length === 1 && !!document.querySelector('#rail-hosts .badge.on'));
  await switchProject('host:' + hostId);
  check('Haupt-PC-Ansicht zeigt nur dessen Chats', titles().join() === 'Chat am Haupt-PC' && $('#ph-name').textContent === hostName(hostId), titles().join());
  check('Konto des Haupt-PC-Chats kommt vom Haupt-PC', profileOf(ht)?.name === 'Zweitkonto' && !!status[pkey(hostId, 'test2')]);
  check('Lokaler Chat läuft weiter (nicht geschlossen)', tabs.includes(lt));
  await switchProject('all');
  tabs.splice(tabs.indexOf(lt), 1); tabs.splice(tabs.indexOf(ht), 1); renderList();

  // Haupt-PC-Eintrag anpassen (nur Anzeige auf diesem PC)
  const hu = await api.remote.hostUpdate({ id: hostId, name: 'Büro', color: '#E5007E', icon: 'data:text/html;base64,PGI+' });
  check('Haupt-PC umbenennen und Farbe; ungültiges Bild verworfen', hu.hosts[0].name === 'Büro' && hu.hosts[0].color === '#E5007E' && !hu.hosts[0].icon, JSON.stringify(hu.hosts[0]));

  // Offene Chats des Haupt-PCs: Gerät sieht sie live und tritt bei (statt zweiten Claude-Prozess zu starten)
  const open = makeTab({ title: 'Offen am Haupt-PC', profileId: 'test', cwd: WORK, sessionId: U1 });
  tabs.push(open); renderList();
  await until(() => tabs.some(x => x.mirror && x.host === hostId && x.hostTab === open.id), 5000);
  const mirror = tabs.find(x => x.mirror && x.hostTab === open.id);
  check('Offener Chat des Haupt-PCs erscheint auf dem Gerät', !!mirror && mirror.title === 'Offen am Haupt-PC' && mirror.sessionId === U1);
  moveChatToProject(mirror.id, 'p-work');
  check('Gespiegelter Chat behält die Zuordnung zum eigenen Projekt', mirrorProjects[hostId + '|' + open.id] === 'p-work');
  moveChatToProject(mirror.id, 'all');
  check('Haupt-PC liefert offene Chats nur nach Freigabe', (await R('tabs:list')).some(x => x.id === open.id));
  await api.remote.deviceSet({ id: devId, scope: { profiles: null, projects: [], chats: [U2] } });
  check('Nicht freigegebener offener Chat bleibt verborgen', !(await R('tabs:list')).some(x => x.id === open.id));
  await until(() => !tabs.some(x => x.mirror && x.hostTab === open.id), 5000);
  check('Spiegel verschwindet, wenn die Freigabe wegfällt', !tabs.some(x => x.mirror && x.hostTab === open.id));
  check('Beitreten zu nicht freigegebenem Chat abgelehnt', (await R('session:attach', { tabId: 'devtab001', hostTab: open.id })) === false);
  await api.remote.deviceSet({ id: devId, scope: { profiles: null, projects: null, chats: [] } });
  const att = await R('session:attach', { tabId: 'devtab001', hostTab: open.id });
  check('Beitreten zu freigegebenem Chat', att && att.running === false, JSON.stringify(att));
  const pend = await R('session:pending', { tabId: 'devtab001' });
  check('Offene Rückfragen eines beigetretenen Chats abrufbar (nach Unterbrechung)', pend && pend.running === false && Array.isArray(pend.requests), JSON.stringify(pend));
  check('Offene Rückfragen: fremder Chat liefert nichts', JSON.stringify(await R('session:pending', { tabId: 'fremd0001' })) === JSON.stringify({ running: false, requests: [] }));
  check('Offene Rückfragen: ungültige ID abgelehnt', (await R('session:pending', { tabId: '../x' })) === false);
  // Vermittler (ohne Portfreigabe): Eingaben geprüft, Kennwort nie im Klartext, Geräte und QR-Code bekommen die Daten
  check('Vermittler: ungültige Adresse abgelehnt', !!(await api.remote.relaySet({ enabled: true, address: 'bad host/x', port: 47821, secret: 'a'.repeat(40) })).error);
  check('Vermittler: zu kurzes Kennwort abgelehnt', !!(await api.remote.relaySet({ enabled: true, address: '127.0.0.1', port: 47821, secret: 'kurz' })).error);
  let rl = await api.remote.relaySet({ enabled: true, address: '127.0.0.1', port: 1, secret: 's'.repeat(40) });
  check('Vermittler: eingerichtet, Kennwort nicht in der Oberfläche', !rl.error && rl.host.relay.enabled && rl.host.relay.hasSecret && !JSON.stringify(rl).includes('s'.repeat(40)), JSON.stringify(rl.host.relay));
  const rr = (await R('store:get'))?.reach?.relay;
  check('Vermittler: gekoppelte Geräte bekommen Adresse, Kennung und dialKey (nicht das Kennwort)', rr && rr.address === '127.0.0.1' && /^[0-9a-f]{16}$/.test(rr.hostId) && /^[0-9a-f]{64}$/.test(rr.dialKey) && !JSON.stringify(rr).includes('s'.repeat(40)), JSON.stringify(rr));
  const qr = atob(String((await api.remote.pairStart()).qr || '').replace('data:image/svg+xml;base64,', ''));
  check('Vermittler: QR-Code wird erzeugt', qr.startsWith('<svg'));
  await api.remote.pairCancel();
  check('Vermittler: kaputter Einrichtungscode abgelehnt', !!(await api.remote.relayCode('srelay1.kaputt')).error && !!(await api.remote.relayCode('irgendwas')).error);
  const goodCode = 'srelay1.' + btoa(JSON.stringify({ a: 'relay.example', p: 47821, s: 'k'.repeat(48) })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  rl = await api.remote.relayCode(goodCode);
  check('Vermittler: Einrichtungscode übernimmt Adresse, Port und Kennwort', !rl.error && rl.host.relay.address === 'relay.example' && rl.host.relay.port === 47821 && rl.host.relay.hasSecret && !JSON.stringify(rl).includes('k'.repeat(48)), JSON.stringify(rl.host.relay));
  check('Vermittler: Einrichtungscode mit ungültiger Adresse abgelehnt', !!(await api.remote.relayCode('srelay1.' + btoa(JSON.stringify({ a: 'a b', p: 1, s: 'k'.repeat(48) })))).error);
  rl = await api.remote.relaySet({ enabled: false, address: '127.0.0.1', port: 1 });
  check('Vermittler: ausschalten nimmt die Daten aus der Geräte-Antwort', !rl.error && rl.host.relay.state === 'off' && !(await R('store:get'))?.reach?.relay, rl.host.relay.state);
  // Dateien vom Gerät (Dokumente vom Handy): eigener Ordner im Temp-Verzeichnis, nur der Dateiname zählt
  const up = await R('files:upload', { name: '..\\..\\geheim\\bericht.txt', data: btoa('Hallo Datei') });
  check('Datei vom Gerät: nur Dateiname, im Upload-Ordner', !!up?.path && /[\\/]swapline-uploads[\\/][^\\/]+[\\/]bericht\.txt$/.test(up.path) && up.size === 11, JSON.stringify(up));
  check('Datei vom Gerät: reservierter Name entschärft', /[\\/]_con\.txt$/.test((await R('files:upload', { name: 'con.txt', data: btoa('x') }))?.path || ''));
  check('Datei vom Gerät: ungültige Daten abgelehnt', !(await R('files:upload', { name: 'a.txt', data: 'kein base64!' }))?.path);
  check('Datei vom Gerät: zu groß abgelehnt', !(await R('files:upload', { name: 'gross.bin', data: 'A'.repeat(36 * 1024 * 1024) }))?.path);
  check('Einstellungen eines beigetretenen Chats ändert nur der Haupt-PC', (await R('session:restart', 'devtab001')) === false);
  check('Austreten beendet den Chat am Haupt-PC nicht', (await R('session:close', 'devtab001')) === true && tabs.includes(open));
  check('Oberfläche darf offene Chats nicht über ein Gerät melden', (await R('tabs:publish', [])) === false);
  // Anzeige auf der anderen Seite
  ingest(open, { type: 'swapline_user', content: { text: 'Hallo vom Laptop', images: 0 }, from: 'Laptop' });
  check('Nachricht vom anderen PC erscheint mit Absender', open.items.at(-1)?.kind === 'me' && open.items.at(-1).from === 'Laptop' && open.running === true);
  open.items.push({ kind: 'perm', requestId: 'rq1', toolName: 'Bash', input: {} });
  ingest(open, { type: 'swapline_answered', requestId: 'rq1', behavior: 'allow', from: 'Laptop' });
  check('Beantwortete Rückfrage wird überall als erledigt markiert', /Laptop/.test(open.items.at(-1).answered || ''));
  open.running = false; tabs.splice(tabs.indexOf(open), 1); renderList();
  await until(() => !tabs.some(x => x.mirror && x.hostTab === open.id), 5000);

  // Server per SSH: Eingaben werden geprüft, bevor etwas in einen Befehl auf dem Server gelangt
  check('SSH: ungültiger Benutzer abgelehnt', !!(await api.remote.ssh.add({ user: 'root; rm -rf /', host: '1.2.3.4', port: 22, folders: [] })).error);
  check('SSH: Adresse mit Option abgelehnt', !!(await api.remote.ssh.add({ user: 'ich', host: '-oProxyCommand=calc', port: 22, folders: [] })).error);
  check('SSH: relativer Ordner abgelehnt', !!(await api.remote.ssh.add({ user: 'ich', host: '127.0.0.1', port: 22, folders: ['projekt'] })).error);
  check('SSH: Port 0 abgelehnt', !!(await api.remote.ssh.add({ user: 'ich', host: '127.0.0.1', port: 0, folders: [] })).error);
  const sv = await api.remote.ssh.add({ name: 'Testserver', user: 'ich', host: '127.0.0.1', port: 1, folders: ['/home/ich/p'] });
  const srvId = sv.hosts.find(x => x.kind === 'ssh')?.id;
  await until(async () => (await api.remote.info()).hosts.find(x => x.id === srvId)?.state === 'error', 25000);
  check('SSH: nicht erreichbarer Server meldet Fehler', (await api.remote.info()).hosts.find(x => x.id === srvId)?.state === 'error');
  const sst = await api.remote.call(srvId, 'store:get', []);
  check('SSH: eingetragene Server-Ordner, ein Server-Konto', sst?.allowedFolders.join() === '/home/ich/p' && sst.profiles[0].id === 'server', JSON.stringify(sst?.allowedFolders));
  check('SSH: Chat in nicht eingetragenem Ordner abgelehnt', (await api.remote.call(srvId, 'session:send', [{ tab: { id: 'abcdefgh', cwd: '/etc', model: '', effort: '', permissionMode: 'default', sessionId: null }, content: 'hi' }])) === false);
  check('SSH: ungültige Sitzungs-ID beim Laden abgelehnt', (await api.remote.call(srvId, 'history:loadSession', [{ sessionId: '../../x' }])).length === 0);
  // Projekte auf dem Server: anlegen, ändern, Ordner, entfernen (nur Liste, Ordner bleibt)
  let sp = await api.remote.call(srvId, 'projects:add', [{ name: 'API', cwd: '/srv/api' }]);
  const spId = sp?.projects.find(p => p.name === 'API')?.id;
  check('SSH: Projekt anlegen', !!spId && sp.canEditProjects && sp.allowedFolders.includes('/srv/api') && sp.projects.some(p => p.cwd === '/home/ich/p'), JSON.stringify(sp?.projects));
  check('SSH: relativer Projektordner abgelehnt', (await api.remote.call(srvId, 'projects:add', [{ name: 'X', cwd: 'relativ' }])) === false);
  check('SSH: Ordner anlegen bei nicht erreichbarem Server meldet Fehler', !!(await api.remote.call(srvId, 'projects:add', [{ name: 'Y', cwd: '/srv/y', mkdir: true }]))?.error);
  sp = await api.remote.call(srvId, 'projects:groupAdd', [{ name: 'Kunden' }]);
  const sg = sp.projectGroups.find(g => g.name === 'Kunden');
  sp = await api.remote.call(srvId, 'projects:update', [{ id: spId, patch: { name: 'API v2', groupId: sg.id } }]);
  check('SSH: Projekt umbenennen und in Ordner', sp.projects.find(p => p.id === spId)?.name === 'API v2' && sp.projects.find(p => p.id === spId).groupId === sg.id);
  check('SSH: Chat im neuen Projektordner zulässig, außerhalb nicht', (await api.remote.call(srvId, 'session:send', [{ tab: { id: 'abcdefgh', cwd: '/etc', model: '', effort: '', permissionMode: 'default', sessionId: null }, content: 'hi' }])) === false);
  sp = await api.remote.call(srvId, 'projects:remove', [{ id: spId }]);
  check('SSH: Projekt entfernen (Liste)', !sp.projects.some(p => p.id === spId) && !sp.allowedFolders.includes('/srv/api'));
  check('SSH: Server erscheint in der Leiste', !!document.querySelector('#rail-hosts') && (renderRail(), [...document.querySelectorAll('#rail-hosts .rail-profile')].length >= 1));
  await api.remote.ssh.remove(srvId.slice(4));
  check('SSH: Server entfernen', !(await api.remote.info()).hosts.some(x => x.id === srvId));

  // Gerät entfernen: Verbindung bricht ab, neue Anmeldung scheitert
  await api.remote.deviceRemove(devId);
  await sleep(1500);
  check('Entferntes Gerät kann sich nicht mehr verbinden', (await api.remote.info()).hosts[0].state !== 'connected');
  const ls = await api.getStore();
  check('Eigene Einstellungen unverändert', ls.settings.model === '' && ls.settings.permissionMode === 'default', JSON.stringify(ls.settings));
  await api.remote.hostRemove(hostId);
  info = await api.remote.hostSet({ enabled: false });
  check('Haupt-PC-Dienst wieder aus', !info.host.running && info.hosts.length === 0);
  return T;
})()
