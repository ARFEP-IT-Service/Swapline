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
  const wrong = p.code.slice(0, -1) + (p.code.endsWith('0') ? '1' : '0');
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
