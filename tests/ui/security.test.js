// Sicherheit: Navigation, Inhalte, IPC-Prüfungen im Hauptprozess (ohne Netz, ohne Claude-Aufrufe)
(async () => {
  const BS = String.fromCharCode(92); // Backslash
  const win = ['C:', 'Windows', 'System32', 'calc.exe'].join(BS);

  // Navigation und Links
  const before = location.href;
  location.href = 'file:///C:/'; await sleep(500);
  check('Navigation zu file:///C:/ blockiert', location.href === before, location.href);
  location.href = BS + BS + '127.0.0.1' + BS + 'c$'; await sleep(400);
  check('Navigation zu UNC-Pfad blockiert', location.href === before);
  check('window.open liefert kein Fenster', !window.open('file:///C:/Windows/'));
  const div = document.createElement('div');
  div.innerHTML = md('[a](file:///C:/x) [b](//host/share) [c](../x) [d](https://arfep.de) ![i](https://example.com/a.png)');
  check('DOMPurify: nur https-Links bleiben, Bilder entfernt', JSON.stringify([...div.querySelectorAll('a')].map(a => a.getAttribute('href'))) === JSON.stringify([null, null, null, 'https://arfep.de']) && !div.querySelector('img'), div.innerHTML);
  div.innerHTML = md('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" srcset="//host/s/a.png"> <span style="background:url(//host/s/a)">x</span>');
  check('DOMPurify: srcset und style entfernt', !/srcset|style/.test(div.innerHTML), div.innerHTML);
  const loads = src => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = src; });
  check('Bild aus dem App-Ordner lädt (Gegenprobe)', await loads('assets/swapline.svg'));
  check('Datei außerhalb des App-Ordners wird nicht geladen', !(await loads('file:///' + WORK.split(BS).join('/') + '/probe.png')));
  check('file://host (SMB) wird nicht geladen', !(await loads('file://127.0.0.1/c$/probe.png')));
  check("CSP ohne Remote-Bilder (img-src 'self' data:)", /img-src 'self' data:;/.test(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content));

  // Dateien und Programme
  check('openPath auf .exe abgelehnt', (await api.openPath(win)) === false);
  check('openPath auf UNC abgelehnt', (await api.openPath(BS + BS + '127.0.0.1' + BS + 'c$')) === false);
  check('openPath auf freigegebenen Ordner erlaubt (Gegenprobe)', (await api.openPath(WORK)) === true);
  check('settings:set fremder Schlüssel abgelehnt', !!(await api.setSettings({ evil: 1 })).rejected);
  check('settings:set claudePath nur per Dialog', !!(await api.setSettings({ claudePath: win })).rejected);
  check('settings:set bypassAcknowledged nicht setzbar', !!(await api.setSettings({ bypassAcknowledged: true })).rejected);
  check('settings:set updateMode nur notify/auto/off', !!(await api.setSettings({ updateMode: 'yes' })).rejected);
  check('settings:set alter Schlüssel autoUpdate abgelehnt', !!(await api.setSettings({ autoUpdate: true })).rejected);
  const um = await api.setSettings({ updateMode: 'auto' });
  check('settings:set updateMode auto angenommen (Gegenprobe)', !um.rejected && um.settings.updateMode === 'auto');
  await api.setSettings({ updateMode: 'notify' });
  check('Update installieren ohne fertiges Update abgelehnt', (await api.update.install()) === false);
  check('settings:set gültiger Wert übernommen (Gegenprobe)', !(await api.setSettings({ theme: 'dark' })).rejected);
  check('settings:set language nur auto/de/en', !!(await api.setSettings({ language: 'fr' })).rejected);
  const langEn = await api.setSettings({ language: 'en' });
  check('settings:set language en übernommen (Gegenprobe)', !langEn.rejected && langEn.settings.language === 'en');
  await api.setSettings({ language: 'de' });

  // Sitzungen und Pfade
  check('Session-ID ..\\..\\x beim Laden abgelehnt', (await api.history.loadSession({ profileId: 'test', sessionId: '..' + BS + '..' + BS + 'x' })).length === 0);
  const mv = await api.session.moveProfile({ sessionId: '..' + BS + 'x', cwd: '', fromProfileId: 'test', toProfileId: 'test' });
  check('Session-ID ..\\x bei Übertragung abgelehnt', mv && mv.ok === false);
  check('session:send mit ungültigen Tab-Daten abgelehnt', (await api.session.send({ id: 'x' }, 'hi')) === false);
  check('session:send mit nicht freigegebenem Ordner abgelehnt', (await api.session.send({ id: 'abcdefgh', profileId: 'test', cwd: ['C:', 'Windows'].join(BS), model: '', effort: '', permissionMode: 'default', sessionId: null }, 'hi')) === false);
  check('session:send mit ungültigem Bild abgelehnt', (await api.session.send({ id: 'abcdefgh', profileId: 'test', cwd: '', model: '', effort: '', permissionMode: 'default', sessionId: null }, [{ type: 'image', source: { type: 'base64', media_type: 'text/html', data: 'PGI+' } }])) === false);
  check('session:respond ohne offene Anfrage abgelehnt', (await api.session.respond('x', 'y', { behavior: 'allow', updatedInput: {} })) === false);
  check('Ausgabe fremder Datei abgelehnt', !!(await api.readTaskOutput(['C:', 'Windows', 'win.ini'].join(BS))).error);
  check('Ausgabe .output außerhalb des Claude-Temp-Ordners abgelehnt', !!(await api.readTaskOutput(['C:', 'Users', 'Public', 'x.output'].join(BS))).error);
  check('Plugin-Aktion mit ungültiger ID abgelehnt', (await api.extensions.action('test', 'install', 'x; rm -rf /')).ok === false);
  check('Plugin-Aktion mit ungültigem Befehl abgelehnt', (await api.extensions.action('test', 'eval', 'a@b')).ok === false);
  check('Zwischenablage: nur Text', (await api.copyText({ evil: 1 })) === false);
  let readErr = null; try { await navigator.clipboard.readText(); } catch (e) { readErr = e.name; }
  check('Zwischenablage aus der Oberfläche nicht lesbar', !!readErr);

  // Projektbilder
  let s = await api.projects.add({ name: 'X', icon: 'data:text/html;base64,PHNjcmlwdD4=' });
  check('Projektbild data:text/html abgelehnt', !s.projects.at(-1).icon);
  s = await api.projects.add({ name: 'Y', icon: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  check('Projektbild SVG (data:) angenommen (Gegenprobe)', !!s.projects.at(-1).icon);
  s = await api.projects.add({ name: 'Z', cwd: ['C:', 'Windows'].join(BS) });
  check('Projektordner ohne Freigabe wird verworfen', s.projects.at(-1).cwd === '');
  return T;
})()
