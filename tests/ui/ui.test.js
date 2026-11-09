// Oberfläche: Chats, Projekte, Eingabe, Anhänge, Karten, Anzeige-Optionen (ohne Netz, ohne Claude-Aufrufe)
(async () => {
  const input = $('#input');
  const t = makeTab({ title: 'Testchat' }); tabs.push(t); await openTab(t.id);
  check('Chat öffnet sich', $('#ch-title').textContent === 'Testchat' && !$('#chat-view').hidden);
  input.blur();
  $('#btn-mic').click();
  await new Promise(r => setTimeout(r, 50));
  check('Diktieren: Mikrofon-Knopf setzt den Fokus ins Eingabefeld', document.activeElement === input && (await api.dictate()) === true);

  // Nachrichten und Kosten
  t.items.push({ kind: 'me', text: 'Frage', time: Date.now() }, { kind: 'ai', text: '## Antwort\n- **fett**\n\n```js\nx()\n```', time: Date.now() });
  renderMessages();
  check('Antwort wird als Markdown gerendert', !!document.querySelector('.msg.ai .bubble h2') && !!document.querySelector('.md pre code'));
  check('Uhrzeit und Kopieren-Knopf unter der Antwort', !!document.querySelector('.ai-foot .msg-time') && !!document.querySelector('.copy-answer'));
  t.running = true;
  ingest(t, { type: 'result', duration_ms: 1200, total_cost_usd: 0.5, swapline_cost_delta: 0.0123 });
  check('Kostenzeile zeigt Zuwachs der Antwort', /\$0\.012/.test([...document.querySelectorAll('.result-line')].at(-1)?.textContent || ''));

  // Umbenennen
  $('#ch-title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const ti = $('#ch-title input'); ti.value = '  Neuer   Name s '; key(ti, 'Enter');
  check('Chat umbenennen (Leerzeichen bereinigt, „s“ bleibt)', t.title === 'Neuer Name s', t.title);

  // Werkzeug-Aufrufe
  const tool = (name, result = 'ok') => ({ kind: 'tool', id: Math.random().toString(36), name, input: { command: 'ls' }, result });
  t.items.push(tool('Read'), tool('Bash'), { kind: 'ai', text: 'x', time: Date.now() }, tool('Edit'));
  for (const [mode, expect] of [['all', [3, 0]], ['compact', [3, 2]], ['hidden', [0, 0]]]) {
    store = await api.setSettings({ toolView: mode }); renderMessages();
    const got = [document.querySelectorAll('#messages .tool').length, document.querySelectorAll('#messages .tool-group').length];
    check(`Werkzeug-Aufrufe „${mode}“`, JSON.stringify(got) === JSON.stringify(expect), JSON.stringify(got));
  }
  store = await api.setSettings({ toolView: 'all' });

  // Karten
  ingest(t, { type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', input: { plan: '# Plan\n1. A' } } });
  check('Plan-Karte mit drei Knöpfen', [...(document.querySelector('.card.plan')?.querySelectorAll('button') || [])].length === 3);
  ingest(t, { type: 'control_request', request_id: 'q1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Farbe?', options: [{ label: 'Blau' }, { label: 'Rot' }] }] } } });
  check('Fragen-Karte mit Antwortmöglichkeiten', document.querySelectorAll('.card .opt').length === 2);
  ingest(t, { type: 'system', subtype: 'away_summary', content: 'Ziel ist X.' });
  check('Recap wird angezeigt', /Ziel ist X/.test(document.querySelector('.recap')?.textContent || ''));
  ingest(t, { type: 'system', subtype: 'task_started', task_id: 'b1', description: 'Build', task_type: 'local_bash' });
  check('Hintergrund-Aufgabe erscheint in der Leiste', /läuft/.test($('#bgbar').textContent) && !$('#bgbar').hidden);
  t.running = false; renderList();
  check('Chat bleibt aktiv, solange eine Hintergrund-Aufgabe läuft', !!document.querySelector('#list .item.active .busy.bg'));
  ingest(t, { type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'completed', summary: 'fertig' });
  check('Hintergrund-Aufgabe beendet', /beendet/.test($('#bgbar').textContent) && !document.querySelector('#list .item.active .busy'));
  bgDoneHideMs = 150;
  ingest(t, { type: 'system', subtype: 'task_started', task_id: 'b2', description: 'Kurz', task_type: 'local_bash' });
  ingest(t, { type: 'system', subtype: 'task_started', task_id: 'b3', description: 'Fehler', task_type: 'local_bash' });
  ingest(t, { type: 'system', subtype: 'task_notification', task_id: 'b2', status: 'completed', summary: 'ok' });
  ingest(t, { type: 'system', subtype: 'task_notification', task_id: 'b3', status: 'failed', summary: 'kaputt' });
  await sleep(400);
  check('Erfolgreich beendete Aufgaben verschwinden von selbst, fehlgeschlagene bleiben', !t.tasks.b2 && t.tasks.b3?.status === 'failed' && !$('#bgbar').hidden, JSON.stringify(Object.keys(t.tasks)));
  delete t.tasks.b1; delete t.tasks.b3; renderBgBar(t);
  check('Ohne Aufgaben ist die Leiste weg', $('#bgbar').hidden);
  bgDoneHideMs = 4000;

  // Knopf „Ganz nach unten“
  for (let i = 0; i < 40; i++) t.items.push({ kind: 'ai', text: 'Zeile ' + i + '\n\n'.repeat(3) + 'Text', time: Date.now() });
  renderMessages();
  const box = $('#messages');
  box.scrollTop = 0; updateBottomBtn();
  check('Weiter oben: Knopf „Ganz nach unten“ sichtbar', !$('#btn-bottom').hidden);
  scrollToBottom(false); updateBottomBtn();
  check('Unten angekommen: Knopf wieder weg', $('#btn-bottom').hidden && box.scrollHeight - box.scrollTop - box.clientHeight < 5);

  // /-Befehle und Eingabe-Verlauf
  typeInto(input, '/ren');
  check('/-Befehle: Liste mit Treffer', (document.querySelector('#cmd-popup .cmd-name')?.textContent || '').startsWith('/rename'));
  key(input, 'Escape');
  check('/-Befehle: Esc schließt die Liste', !$('#cmd-popup'));
  rememberInput('eins'); rememberInput('zwei');
  typeInto(input, ''); key(input, 'ArrowUp'); const a = input.value; key(input, 'ArrowUp'); const b = input.value; key(input, 'ArrowDown'); key(input, 'ArrowDown');
  check('Eingabe-Verlauf ↑↑↓↓', a === 'zwei' && b === 'eins' && input.value === '', JSON.stringify([a, b, input.value]));

  // Anhänge
  const cv = document.createElement('canvas'); cv.width = cv.height = 8;
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  await addFiles([new File([blob], 'bild.png', { type: 'image/png' })]);
  check('Bild-Anhang erscheint', attachments.length === 1 && !!document.querySelector('#attachbar img'));
  attachments = []; renderAttachments();

  // Projekte
  store = await api.projects.add({ name: 'A' }); const A = store.projects.at(-1).id;
  store = await api.projects.add({ name: 'Leer' }); const L = store.projects.at(-1).id;
  const ta = makeTab({ title: 'In A', projectId: A, updated: 5 }); tabs.push(ta);
  await switchProject(A);
  check('Projektwechsel öffnet Chat des Projekts', activeTabId === ta.id);
  await switchProject(L);
  check('Leeres Projekt zeigt Startansicht', activeTabId === null && !$('#empty').hidden);
  await switchProject('all');

  // Projekt-Ordner in der Leiste
  store = await api.projects.groupAdd({ name: 'Kunden', color: '#1581FF' }); const G = store.projectGroups.at(-1).id;
  store = await api.projects.add({ name: 'Kunde A', groupId: G }); const PA = store.projects.at(-1).id;
  renderRail();
  check('Ordner in der Leiste mit Projekt darin', !!document.querySelector('.rail-group-wrap.open .rail-group-kids .rail-profile'));
  toggleGroup(G);
  check('Ordner zuklappbar, Anzahl sichtbar', !document.querySelector('.rail-group-kids') && document.querySelector('.rail-group .count')?.textContent === '1');
  toggleGroup(G);
  store = await api.projects.update(PA, { groupId: 'g-gibtsnicht' });
  check('Ungültiger Ordner wird verworfen', !store.projects.find(p => p.id === PA).groupId);
  await moveProjectToGroup(PA, G);
  check('Projekt in Ordner verschoben', store.projects.find(p => p.id === PA).groupId === G);
  store = await api.projects.groupRemove(G); renderRail();
  check('Ordner löschen behält die Projekte', store.projects.some(p => p.id === PA && !p.groupId) && !store.projectGroups.length && !document.querySelector('.rail-group'));

  // Geräte in der Leiste (gekoppelte Haupt-PCs)
  remoteState = { hosts: [{ id: 'h1', name: 'Büro PC', address: '100.64.0.5', port: 47820 }], state: 'off', host: { devices: [] } }; renderRail();
  check('Leiste zeigt den Haupt-PC wie ein Projekt (nicht verbunden)', document.querySelectorAll('#rail-hosts .rail-profile').length === 1 && !!document.querySelector('#rail-hosts .badge.off') && !$('#rail-hosts-sep').hidden);
  remoteState = { hosts: [], state: 'off', host: { devices: [] } }; renderRail();
  check('Ohne gekoppelte Haupt-PCs kein Geräte-Bereich', !$('#rail-hosts').children.length && $('#rail-hosts-sep').hidden);
  await switchProject('all'); // projects.add macht das neue Projekt aktiv

  // Suche in offenen Chats (Nachrichtentext)
  $('#search').value = 'antwort'; renderList();
  check('Suche findet Chat über Nachrichtentext', [...document.querySelectorAll('#list .item .title')].some(e => e.textContent === 'Neuer Name s'));
  $('#search').value = ''; renderList();

  // Feste Antworttexte an Claude: immer Englisch, auch bei deutscher Oberfläche
  const sentToClaude = [];
  const origRespond = claudeRespond, origSend = claudeSend;
  claudeRespond = (_t, id, resp) => { sentToClaude.push(resp); return Promise.resolve(true); };
  claudeSend = (_t, content) => { sentToClaude.push(content); return Promise.resolve(true); };
  const tc = makeTab({ title: 'Antworttexte' }); tabs.push(tc); await openTab(tc.id);
  const card = (tool, input) => { ingest(tc, { type: 'control_request', request_id: 'r' + sentToClaude.length + tool, request: { subtype: 'can_use_tool', tool_name: tool, input } }); return [...document.querySelectorAll('#messages .card')].at(-1); };
  [...card('Bash', { command: 'ls' }).querySelectorAll('button')].at(-1).click();
  [...card('ExitPlanMode', { plan: 'P' }).querySelectorAll('button')].at(-1).click();
  const pc = card('ExitPlanMode', { plan: 'P2' }); pc.querySelector('textarea').value = 'kürzer bitte'; pc.querySelectorAll('button')[1].click();
  [...card('AskUserQuestion', { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] }).querySelectorAll('button')].at(-1).click();
  check('Antworttexte an Claude auf Englisch (Ablehnen, Plan ablehnen/überarbeiten, Frage überspringen)',
    JSON.stringify(sentToClaude.map(r => r.message)) === JSON.stringify(['The user declined this action.', 'The user rejected the plan.', 'Please revise the plan: kürzer bitte', 'The user does not want to answer the question.']),
    JSON.stringify(sentToClaude.map(r => r.message)));
  check('Oberfläche zeigt dazu deutsche Texte', /Abgelehnt/.test($('#messages').textContent) && /Übersprungen/.test($('#messages').textContent));
  status[tc.profileId] = { loggedIn: true };
  sentToClaude.length = 0;
  attachments = [{ kind: 'image', name: 'a.png', media: 'image/png', data: 'iVBORw0KGgo=' }, { kind: 'file', name: 'b.txt', path: 'C:\\x\\b.txt', size: 1 }];
  $('#input').value = ''; await sendMessage();
  const sentText = sentToClaude[0]?.find?.(b => b.type === 'text')?.text || '';
  check('Platzhalter bei Anhängen an Claude auf Englisch', sentText.startsWith('See attached image.') && sentText.includes('Attached files:'), sentText);
  check('Sprechblase zeigt Platzhalter übersetzt', tc.items.at(-1).text === 'Siehe angehängtes Bild.', tc.items.at(-1).text);
  claudeRespond = origRespond; claudeSend = origSend; tc.running = false;
  tabs.splice(tabs.indexOf(tc), 1); delete status[tc.profileId];

  // Updates: neuer Standard „Nur benachrichtigen“, alte Einstellung „Automatisch“ wurde umgestellt
  check('Update-Standard: alte Einstellung autoUpdate → „Nur benachrichtigen“', store.settings.updateMode === 'notify' && !('autoUpdate' in store.settings), JSON.stringify(store.settings));

  // Eigenes Bild für einen Chat (verkleinert, nur lokal)
  const ic = makeTab({ title: 'Mit Bild' }); tabs.push(ic);
  const big = document.createElement('canvas'); big.width = 400; big.height = 300; big.getContext('2d').fillRect(0, 0, 400, 300);
  const small = await shrinkIcon(big.toDataURL('image/png'));
  const probe = await new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth + 'x' + i.naturalHeight); i.src = small; });
  check('Chat-Bild wird auf 96 px verkleinert', probe === '96x96', probe);
  chatIcons[chatIconKey(ic)] = small; renderList();
  check('Chat-Bild erscheint in der Liste', [...document.querySelectorAll('#list .item')].some(x => x.textContent.includes('Mit Bild') && x.querySelector('.avatar.img img')));
  removeChatIcon(ic);
  check('Chat-Bild entfernen', !chatIcon(ic));
  tabs.splice(tabs.indexOf(ic), 1); renderList();

  // Projekte eines Haupt-PCs/Servers als Filter
  hostStores.hx = { profiles: [{ id: 'p', name: 'P', color: '#1581FF' }], activeProfileId: 'p', projects: [{ id: 'hp1', name: 'Web', color: '#1581FF', cwd: '/srv/web' }], projectGroups: [], favorites: [], allowedFolders: ['/srv/web'], settings: { model: '', effort: '', permissionMode: 'default' }, scope: { limited: false, newChats: true }, canEditProjects: true };
  const savedRemote = remoteState;
  remoteState = { hosts: [{ id: 'hx', kind: 'ssh', name: 'VPS', address: 'ich@vps.example', port: 22, state: 'connected' }], host: { devices: [] } };
  const w1 = makeTab({ title: 'In Web', host: 'hx', profileId: 'p', cwd: '/srv/web/app' }), w2 = makeTab({ title: 'Woanders', host: 'hx', profileId: 'p', cwd: '/tmp' });
  tabs.push(w1, w2); await switchProject('host:hx');
  const listTitles = () => [...document.querySelectorAll('#list .item .title')].map(e => e.textContent);
  check('Projekte des Haupt-PCs als Filter sichtbar', !$('#host-projects').hidden && [...document.querySelectorAll('#host-projects .hp-chip span')].some(x => x.textContent === 'Web') && !!document.querySelector('#host-projects .hp-add'));
  check('Ohne Filter alle Chats des Haupt-PCs', listTitles().includes('In Web') && listTitles().includes('Woanders'));
  openHosts.add('hx'); renderRail();
  check('Leiste: Projekte des Haupt-PCs aufgeklappt', !!document.querySelector('#rail-hosts .rail-host-wrap.open .rail-group-kids .rail-profile'));
  clickHost('hx'); // schon offen und ohne Filter -> zuklappen
  check('Leiste: erneuter Klick klappt zu (Anzahl sichtbar)', !document.querySelector('#rail-hosts .rail-host-wrap.open') && document.querySelector('#rail-hosts .count')?.textContent === '1');
  clickHost('hx');
  document.querySelector('#rail-hosts .rail-group-kids .rail-profile').click();
  check('Leiste: Klick auf Projekt filtert die Chats', hostProjectFilter.hx === 'hp1' && listTitles().join() === 'In Web', listTitles().join());
  delete hostProjectFilter.hx; openHosts.delete('hx');
  hostProjectFilter.hx = 'hp1'; renderList();
  check('Filter zeigt nur Chats im Projektordner', listTitles().join() === 'In Web', listTitles().join());
  delete hostProjectFilter.hx; delete hostStores.hx; remoteState = savedRemote;
  tabs.splice(tabs.indexOf(w1), 1); tabs.splice(tabs.indexOf(w2), 1);
  await switchProject('all');
  check('In eigener Ansicht keine Haupt-PC-Projektleiste', $('#host-projects').hidden);

  // Geteilte Ansicht: zwei Chats nebeneinander
  const s1 = makeTab({ title: 'Links' }), s2 = makeTab({ title: 'Rechts' }); tabs.push(s1, s2);
  await openTab(s1.id); openSplit(s2.id); await sleep(80);
  const paneTitle = i => panes[i].root.querySelector('[data-pid="ch-title"]').textContent;
  check('Geteilte Ansicht: zwei Hälften nebeneinander', panes.length === 2 && $('#chat').classList.contains('split'));
  check('Links der erste, rechts der zweite Chat', paneTitle(0) === 'Links' && paneTitle(1) === 'Rechts', paneTitle(0) + ' | ' + paneTitle(1));
  appendItem(s1, { kind: 'ai', text: 'Antwort links', time: Date.now() });
  const paneText = i => panes[i].root.querySelector('[data-pid="messages"]').textContent;
  check('Antwort für die andere Hälfte erscheint dort und nur dort', /Antwort links/.test(paneText(0)) && !/Antwort links/.test(paneText(1)));
  check('Nur die aktive Hälfte trägt die IDs', document.querySelectorAll('#messages').length === 1 && panes[1].root.contains($('#messages')));
  await openTab(s1.id);
  check('Chat der anderen Hälfte: Fokus springt hin statt doppelt zu öffnen', focusedPane === 0 && activeTabId === s1.id && paneTitle(1) === 'Rechts');
  closePane(1);
  check('Zweite Hälfte schließen', panes.length === 1 && !$('#chat').classList.contains('split') && activeTabId === s1.id);
  tabs.splice(tabs.indexOf(s1), 1); tabs.splice(tabs.indexOf(s2), 1); renderList();

  // Einstellungen und Erweiterungen öffnen
  openSettings();
  check('Einstellungen öffnen', !!$('.modal.settings'));
  check('Updates: Hinweis im Entwicklungsmodus', /installierten App/.test($('#update-info')?.textContent || ''));
  showUpdate({ status: 'ready', version: '9.9.9', supported: true });
  check('Update bereit: Hinweis und Neustart-Knopf', /9.9.9/.test($('#update-banner')?.textContent || '') && !$('#update-restart').hidden);
  $('#update-banner button.ghost').click();
  check('Update-Hinweis lässt sich wegklicken', !$('#update-banner'));
  const modeSel = [...document.querySelectorAll('.modal.settings select')].find(s => s.querySelector('option[value="notify"]'));
  check('Einstellung Updates: Nur benachrichtigen (Standard) / Automatisch / Aus', !!modeSel && [...modeSel.options].map(o => o.value).join() === 'notify,auto,off' && modeSel.value === 'notify');
  showUpdate({ status: 'available', version: '9.9.8', supported: true });
  check('Update verfügbar: Knopf „Herunterladen“ (kein Neustart)', /Version 9\.9\.8 verfügbar/.test($('#update-banner')?.textContent || '') && $('#update-banner button.primary')?.textContent === 'Herunterladen' && $('#update-restart').textContent === 'Herunterladen');
  showUpdate({ status: 'ready', version: '9.9.8', supported: true });
  check('Update geladen: fragt „Jetzt neu starten“ oder „Später“', /jetzt neu starten\?/.test($('#update-banner')?.textContent || '') && $('#update-banner button.primary')?.textContent === 'Jetzt neu starten' && $('#update-banner button.ghost')?.textContent === 'Später');
  check('Neustart ohne geladenes Update abgelehnt', (await api.update.install()) === false && (await api.update.download()) === false);
  $('#update-banner button.ghost').click();
  check('„Später“ schließt den Hinweis ohne Neustart', !$('#update-banner'));
  showUpdate({ status: 'latest', supported: true });
  check('Kein Hinweis, wenn aktuell', !$('#update-banner') && $('#update-restart').hidden);
  $('#modal-root').replaceChildren();

  // Sprache: Englisch (feste Texte aus index.html, Einstellungen, Platzhalter) und zurück
  check('Start auf Deutsch (Testprofil language: de)', LANG === 'de' && document.documentElement.lang === 'de' && $('#search').placeholder === 'Suchen …');
  setLang('en'); translateStatic(); renderList(); openSettings();
  check('Englisch: Titel der Einstellungen', ($('.modal.settings h2')?.firstChild?.textContent || '') === 'Settings', $('.modal.settings h2')?.textContent);
  check('Englisch: Sprachauswahl als erstes Feld', ($('.modal.settings .field span')?.textContent || '') === 'Language' && !!$('.modal.settings select option[value="en"]'));
  check('Englisch: Suchfeld und Reiter', $('#search').placeholder === 'Search …' && $('#seg [data-view="history"]').textContent === 'History', $('#search').placeholder);
  check('Englisch: title-Attribute', $('#btn-settings').title === 'Settings' && $('#btn-new-chat').title === 'New chat (Ctrl+N)');
  check('Englisch: Platzhalter {v} werden ersetzt', _('Lade Version {v} … {p} %', { v: '1', p: 50 }) === 'Downloading version 1 … 50%' && _('{n} Schritte', { n: 3 }) === '3 steps');
  check('Englisch: Datumsgruppen', groupLabel(Date.now()) === 'Today' && document.documentElement.lang === 'en');
  check('Unbekannter Text bleibt deutsch', _('Gibt es nicht {x}', { x: 1 }) === 'Gibt es nicht 1');
  $('#modal-root').replaceChildren();
  setLang('de'); translateStatic(); renderList();
  check('Zurück auf Deutsch', $('#search').placeholder === 'Suchen …' && $('#btn-settings').title === 'Einstellungen' && $('#seg [data-view="history"]').textContent === 'Verlauf');
  return T;
})()
