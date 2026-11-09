// theme: dark
// Kontowechsel über das Profil links unten
status.arbeit = { loggedIn: true, email: 'team@example.com', subscriptionType: 'team', orgName: 'Beispiel GmbH' };
status.privat = { loggedIn: true, email: 'privat@example.com', subscriptionType: 'pro' };
const now = Date.now();
const t = makeTab({ title: 'Login-Fehler 401', projectId: 'p-api', cwd: '', updated: now });
t.items.push({ kind: 'me', text: 'Warum bekomme ich nach einer Stunde 401?', time: now - 5e5 }, { kind: 'ai', text: 'Das Zugriffstoken läuft nach 60 Minuten ab und wird nicht erneuert. Ich ergänze die Erneuerung kurz vor Ablauf.', time: now - 4e5 });
tabs.push(t);
await openTab(t.id);
renderRail(); renderList(); renderUsage();
openAccountMenu();
await sleep(600);
