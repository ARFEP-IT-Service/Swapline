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
  // erstes Zeichen ändern – das letzte trägt bei 128 Bit nur Füllbits
  const wrong = (p.code[0] === '0' ? '1' : '0') + p.code.slice(1);
  r = await api.remote.pair({ address: '127.0.0.1', port, code: wrong });
  check('Falscher Code abgelehnt', !!r.error && r.hosts.length === 0, r.error);
  check('Ungültige Adresse abgelehnt', !!(await api.remote.pair({ address: '\\\\server\\share', port, code: p.code })).error);
  r = await api.remote.pair({ address: '127.0.0.1', port, code: p.code });
  check('Koppeln mit richtigem Code', !r.error && r.hosts.length === 1 && r.host.devices.length === 1, r.error);
  check('Code gilt nur einmal', !!(await api.remote.pair({ address: '127.0.0.1', port, code: p.code })).error);
  const hostId = r.hosts[0].id, devId = r.host.devices[0].id;

  // Verbinden: Chat-Kanäle gehen ab jetzt an den Haupt-PC
  await api.remote.use(hostId);
  await until(async () => (await api.remote.info()).state === 'connected', 10000);
  check('Mit Haupt-PC verbunden', (await api.remote.info()).state === 'connected');
  const rs = await api.getStore();
  check('Stand vom Haupt-PC ohne Konfigurationsordner', rs.remote?.id === hostId && rs.profiles.length >= 1 && rs.profiles.every(x => !('configDir' in x)) && Array.isArray(rs.allowedFolders), JSON.stringify(rs.profiles));
  check('Lokale Einstellungen bleiben lokal (Sprache)', rs.settings.language === 'de');
  check('Haupt-PC-Einstellungen nicht verstellbar (Projekt anlegen)', !!(await api.projects.add({ name: 'X' })).rejected);
  check('Haupt-PC-Einstellungen nicht verstellbar (Konto anlegen)', !!(await api.profiles.add({ name: 'X' })).rejected);
  const sm = await api.setSettings({ model: 'sonnet' });
  check('Modell je Gerät wählbar', !sm.rejected && sm.settings.model === 'sonnet', JSON.stringify(sm.settings));
  check('Verlauf über Haupt-PC lesbar', Array.isArray(await api.history.list('test')));
  check('Chat mit ungültigen Daten am Haupt-PC abgelehnt', (await api.session.send({ id: 'x' }, 'hi')) === false);
  check('Antwort ohne offene Rückfrage abgelehnt', (await api.session.respond('abcdefgh', 'y', { behavior: 'allow', updatedInput: {} })) === false);
  const ea = await api.extensions.action('test', 'install', 'a@b');
  check('Plugins am Haupt-PC nicht installierbar (mit Meldung)', ea?.ok === false && /nicht erlaubt/.test(ea.error || ''), JSON.stringify(ea));

  // Freigabe je Gerät: Konten, Projekte, einzelne Chats – durchgesetzt am Haupt-PC
  const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333';
  const BS = String.fromCharCode(92), OTHER = WORK + '-other';
  const ids = list => list.map(h => h.sessionId).sort().join(',');
  check('Ohne Einschränkung: beide Konten und alle Chats', (await api.getStore()).profiles.length === 2 && ids(await api.history.list('test')) === [U1, U2].join(','));
  check('Ungültige Freigabe abgelehnt', !!(await api.remote.deviceSet({ id: devId, scope: { profiles: 'x', projects: null, chats: [] } })).error);
  await api.remote.deviceSet({ id: devId, scope: { profiles: ['test'], projects: null, chats: [] } });
  let st = await api.getStore();
  check('Nur freigegebenes Konto sichtbar', st.profiles.length === 1 && st.profiles[0].id === 'test' && st.scope.accountsLimited, JSON.stringify(st.profiles));
  check('Verlauf des anderen Kontos gesperrt', (await api.history.list('test2')).length === 0);
  check('Chat des anderen Kontos nicht ladbar', (await api.history.loadSession({ profileId: 'test2', sessionId: U3 })).length === 0);
  check('Neuer Chat im anderen Konto abgelehnt', (await api.session.send({ id: 'abcdefgh', profileId: 'test2', cwd: WORK, model: '', effort: '', permissionMode: 'default', sessionId: null }, 'hi')) === false);

  await api.remote.deviceSet({ id: devId, scope: { profiles: null, projects: ['p-work'], chats: [] } });
  st = await api.getStore();
  check('Projekt-Freigabe: nur Projekt und seine Ordner', st.scope.limited && st.projects.length === 1 && st.allowedFolders.length === 1 && st.favorites.length === 0, JSON.stringify(st.allowedFolders));
  check('Projekt-Freigabe: nur Chats im Projektordner', ids(await api.history.list('test')) === U1, ids(await api.history.list('test')));
  check('Projekt-Freigabe: Chat im Projekt ladbar', (await api.history.loadSession({ profileId: 'test', sessionId: U1 })).length > 0);
  check('Projekt-Freigabe: Chat außerhalb nicht ladbar', (await api.history.loadSession({ profileId: 'test', sessionId: U2 })).length === 0);
  check('Projekt-Freigabe: neuer Chat außerhalb abgelehnt', (await api.session.send({ id: 'abcdefgh', profileId: 'test', cwd: OTHER, model: '', effort: '', permissionMode: 'default', sessionId: null }, 'hi')) === false);
  check('Projekt-Freigabe: neuer Chat ohne Ordner abgelehnt', (await api.session.send({ id: 'abcdefgh', profileId: 'test', cwd: '', model: '', effort: '', permissionMode: 'default', sessionId: null }, 'hi')) === false);
  check('Projekt-Freigabe: fremden Chat fortsetzen abgelehnt', (await api.session.send({ id: 'abcdefgh', profileId: 'test', cwd: OTHER, model: '', effort: '', permissionMode: 'default', sessionId: U2 }, 'hi')) === false);
  check('Projekt-Freigabe: Ausgabe fremder Aufgaben gesperrt', !!(await api.readTaskOutput(WORK + BS + 'tasks' + BS + 'x.output')).error);

  await api.remote.deviceSet({ id: devId, scope: { profiles: null, projects: [], chats: [U2] } });
  st = await api.getStore();
  check('Chat-Freigabe: nur der einzelne Chat', ids(await api.history.list('test')) === U2 && st.projects.length === 0 && !st.scope.newChats, ids(await api.history.list('test')));
  check('Chat-Freigabe: geteilter Chat ladbar', (await api.history.loadSession({ profileId: 'test', sessionId: U2 })).length > 0);
  check('Chat-Freigabe: Volltextsuche findet nur Freigegebenes', (await api.history.search('test', 'Hallo')).every(h => h.sessionId === U2));
  check('Geräteliste zeigt die Freigabe', JSON.stringify((await api.remote.info()).host.devices[0].scope) === JSON.stringify({ profiles: null, projects: [], chats: [U2] }));
  await api.remote.deviceSet({ id: devId, scope: { profiles: null, projects: null, chats: [] } });

  // „Alles erlauben“ je Gerät
  await api.remote.deviceSet({ id: devId, allowBypass: false });
  check('Ohne Gerätefreigabe kein „Alles erlauben“', !!(await api.setSettings({ permissionMode: 'bypassPermissions' })).rejected);
  await api.remote.deviceSet({ id: devId, allowBypass: true });
  const sb = await api.setSettings({ permissionMode: 'bypassPermissions' });
  check('Mit Gerätefreigabe „Alles erlauben“ möglich', !sb.rejected && sb.settings.permissionMode === 'bypassPermissions', sb.rejected);

  // Gerät entfernen: Verbindung bricht ab, neue Anmeldung scheitert
  await api.remote.deviceRemove(devId);
  await sleep(1500);
  check('Entferntes Gerät kann sich nicht mehr verbinden', (await api.remote.info()).state !== 'connected');

  // zurück auf diesen PC: eigene Einstellungen unverändert
  await api.remote.use(null);
  const ls = await api.getStore();
  check('Zurück auf diesem PC, eigene Einstellungen unverändert', !ls.remote && ls.settings.model === '' && ls.settings.permissionMode === 'default', JSON.stringify(ls.settings));
  await api.remote.hostRemove(hostId);
  info = await api.remote.hostSet({ enabled: false });
  check('Haupt-PC-Dienst wieder aus', !info.host.running && info.hosts.length === 0);
  return T;
})()
