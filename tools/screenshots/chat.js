// theme: dark
// Hauptansicht: Projekte, Chat-Liste, Chat mit Antwort, Werkzeug-Aufrufen und Hintergrund-Aufgabe
status.arbeit = { loggedIn: true, email: 'team@example.com', subscriptionType: 'max' };
status.privat = { loggedIn: true, email: 'privat@example.com', subscriptionType: 'pro' };
const now = Date.now(), min = 60e3;
const mk = o => { const t = makeTab({ cwd: '', ...o }); tabs.push(t); return t; };
mk({ title: 'README überarbeiten', projectId: 'p-doc', preview: 'Abschnitt „Installation“ ist fertig.', updated: now - 26 * 60 * min });
mk({ title: 'Login-Fehler 401', projectId: 'p-api', preview: 'Token wird jetzt vor Ablauf erneuert.', updated: now - 95 * min, unread: true });
mk({ title: 'Bilder als WebP', projectId: 'p-web', preview: 'Startseite lädt 41 % schneller.', updated: now - 40 * min });
const t = mk({ title: 'Rabattcodes im Warenkorb', projectId: 'p-web', updated: now - 2 * min });
const tool = (name, input, result = 'ok') => ({ kind: 'tool', id: Math.random().toString(36).slice(2), name, input, result });
t.items.push(
  { kind: 'me', text: 'Kannst du im Warenkorb Rabattcodes einbauen? Prozent und fester Betrag, Codes kommen aus der Datenbank.', time: now - 9 * min },
  tool('Grep', { pattern: 'cartTotal', path: 'src' }),
  tool('Read', { file_path: 'src/cart/total.ts' }),
  tool('Edit', { file_path: 'src/cart/total.ts', old_string: 'return sum;', new_string: 'return applyDiscount(sum, code);' }),
  tool('Bash', { command: 'npm test -- cart', description: 'Tests für den Warenkorb' }, '✓ 14 Tests bestanden'),
  { kind: 'ai', time: now - 2 * min, text: [
    'Fertig. Rabattcodes funktionieren jetzt im Warenkorb:',
    '',
    '- **Prozent** (`SOMMER10`) und **fester Betrag** (`WILLKOMMEN5`)',
    '- Codes werden beim Prüfen aus der Tabelle `discount_codes` gelesen, abgelaufene abgelehnt',
    '- Der Rabatt wird nie höher als die Zwischensumme',
    '',
    '```ts',
    'export function applyDiscount(sum: number, code?: Discount) {',
    '  if (!code) return sum;',
    "  const off = code.type === 'percent' ? sum * code.value / 100 : code.value;",
    '  return Math.max(0, sum - off);',
    '}',
    '```',
    '',
    'Alle 14 Warenkorb-Tests laufen durch. Soll ich noch ein Eingabefeld auf der Kassenseite ergänzen?',
  ].join('\n') },
);
await openTab(t.id);
ingest(t, { type: 'system', subtype: 'task_started', task_id: 'demo1', description: 'npm run dev', task_type: 'local_bash' });
renderRail(); renderList(); renderUsage();
await sleep(600);
