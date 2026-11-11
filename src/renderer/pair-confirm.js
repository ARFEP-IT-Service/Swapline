// Kopplung bestätigen (eigenes Fenster des Hauptprozesses, nicht die Swapline-Oberfläche): Rechte des neuen Geräts
// einzeln anhaken – alle sind zunächst aus. Texte kommen fertig übersetzt vom Hauptprozess.
'use strict';
(async () => {
  const t = await window.pairConfirm.info();
  const $ = id => document.getElementById(id);
  document.documentElement.lang = t.lang;
  $('title').textContent = t.title;
  $('addr').textContent = t.address;
  $('note').textContent = t.note;
  $('hint').textContent = t.hint;
  $('ok').textContent = t.ok;
  $('cancel').textContent = t.cancel;
  for (const r of t.rights) {
    const box = document.createElement('input');
    box.type = 'checkbox'; box.id = r.key;
    const text = document.createElement('span');
    const b = document.createElement('b'); b.textContent = r.label;
    const why = document.createElement('span'); why.className = 'why'; why.textContent = r.why;
    text.append(b, why);
    const label = document.createElement('label');
    if (r.risk) label.className = 'risk';
    label.append(box, text);
    $('rights').append(label);
  }
  const answer = ok => window.pairConfirm.answer({ ok, rights: Object.fromEntries(t.rights.map(r => [r.key, ok && document.getElementById(r.key).checked])) });
  $('ok').onclick = () => answer(true);
  $('cancel').onclick = () => answer(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') answer(false); });
  $('cancel').focus();
})();
