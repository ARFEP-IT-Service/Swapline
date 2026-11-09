// Oberfläche: Chats, Projekte, Eingabe, Anhänge, Karten, Anzeige-Optionen (ohne Netz, ohne Claude-Aufrufe)
(async () => {
  const input = $('#input');
  const t = makeTab({ title: 'Testchat' }); tabs.push(t); await openTab(t.id);
  check('Chat öffnet sich', $('#ch-title').textContent === 'Testchat' && !$('#chat-view').hidden);

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
