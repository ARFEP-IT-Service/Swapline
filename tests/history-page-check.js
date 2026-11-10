// Verlauf in Seiten (history:loadSession mit turns/before): src/chat-core.js (PC-App und Server-Dienst), ohne App.
// Wird von tests/run.js gestartet, Ergebnis als JSON.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pageTranscript } = require(path.join(__dirname, '..', 'src', 'chat-core.js'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

try {
  // 6 Abschnitte: Frage, Antwort mit Werkzeug (lange Eingabe), langes Ergebnis; in Abschnitt 6 ein Bild und Denkblock
  const big = 'x'.repeat(10000);
  const all = [];
  for (let i = 1; i <= 6; i++) {
    all.push({ type: 'user', message: { role: 'user', content: i === 6 ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big } }, { type: 'text', text: 'Frage ' + i }] : 'Frage ' + i } });
    all.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: big }, { type: 'text', text: 'Antwort ' + i }, { type: 'tool_use', id: 't' + i, name: 'Write', input: { file_path: 'a.txt', content: big } }] } });
    all.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' + i, content: big }] } });
    all.push({ type: 'user', message: { role: 'user', content: '<system-reminder>intern</system-reminder>' } });
  }
  const p = pageTranscript(all, 2, undefined);
  const firstText = m => (typeof m.message.content === 'string' ? m.message.content : m.message.content.find(b => b.type === 'text')?.text);
  check('Verlauf in Seiten: nur die letzten 2 eigenen Nachrichten', p.start === 16 && p.msgs.length === 8 && firstText(p.msgs[0]) === 'Frage 5' && p.total === 24, `${p.start} ${p.msgs.length}`);
  const json = JSON.stringify(p.msgs);
  check('Verlauf in Seiten: Bilder ohne Daten, keine Denkblöcke, lange Texte gekürzt', !json.includes(big) && !json.includes('"thinking"') && json.includes('more characters') && json.includes('"omitted":true'), json.length);
  check('Verlauf in Seiten: deutlich kleiner als der ganze Verlauf', json.length < JSON.stringify(all.slice(16)).length / 3, `${json.length} vs ${JSON.stringify(all.slice(16)).length}`);
  const o = pageTranscript(all, 5, p.start);
  check('Verlauf in Seiten: ältere Nachrichten mit before', o.start === 0 && o.msgs.length === 16 && firstText(o.msgs[0]) === 'Frage 1', `${o.start} ${o.msgs.length}`);
  check('Verlauf in Seiten: Werkzeug-Aufruf und Ergebnis bleiben zusammen', p.msgs.some(m => JSON.stringify(m).includes('"tool_use_id":"t5"')) && p.msgs.some(m => JSON.stringify(m).includes('"id":"t5"')));
  const bad = pageTranscript(all, 2, -5);
  check('Verlauf in Seiten: ungültiges before = vom Ende', bad.start === 16);
  const many = Array.from({ length: 1000 }, (_, i) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Schritt ' + i }] } }));
  check('Verlauf in Seiten: Abschnitt mit sehr vielen Schritten wird begrenzt', pageTranscript([{ type: 'user', message: { content: 'los' } }, ...many], 1).msgs.length === 600);
} catch (e) {
  check('Verlauf in Seiten', false, e.stack || e.message);
}
process.stdout.write(JSON.stringify(results));
