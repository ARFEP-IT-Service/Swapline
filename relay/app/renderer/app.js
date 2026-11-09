// Oberfläche von „Swapline Relay“: Status, verbundene Swapline-PCs, Zugangsdaten für Swapline, Einstellungen, Protokoll.
'use strict';
const $ = s => document.querySelector(s);
let S = null, lang = 'de', shownSecret = '', chosenAddr = '', busy = false;
const tr = (d, e) => (lang === 'de' ? d : e);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500); }
const ago = ms => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`; };

async function act(fn, ok) {
  if (busy) return;
  busy = true; render();
  try {
    const r = await fn();
    if (r?.error) toast(r.error); else if (ok && r !== false) toast(ok);
  } finally { busy = false; await refresh(true); }
}

function statusCard() {
  const st = S.status, svc = S.service || {};
  const running = st?.alive && st.listening;
  const installed = !!svc.task;
  const state = running ? tr(`Läuft seit ${ago(st.started)} · Port ${st.port}`, `Running for ${ago(st.started)} · port ${st.port}`)
    : installed ? (st?.lastError || tr('Gestoppt', 'Stopped')) : tr('Noch nicht als Dienst eingerichtet', 'Not set up as a service yet');
  return el('section', { class: 'card' },
    el('h2', {}, tr('Status', 'Status')),
    el('div', { class: 'row' }, el('span', { class: 'dot ' + (running ? 'ok' : installed ? 'err' : 'warn') }), el('span', { class: 'big' }, state)),
    el('div', { class: 'row muted' }, running ? tr(`${st.hosts} Swapline-PC(s) angemeldet · ${st.pipes} aktive Verbindung(en)`, `${st.hosts} Swapline PC(s) signed in · ${st.pipes} active connection(s)`) : ''),
    !S.admin ? el('p', { class: 'notice' }, tr('Ohne Administratorrechte gestartet – Dienst und Firewall lassen sich nicht ändern.', 'Started without administrator rights – service and firewall cannot be changed.')) : null,
    el('div', { class: 'row' },
      !installed ? el('button', { class: 'primary', disabled: busy || !S.admin, onclick: () => act(() => window.relay.install(), tr('Dienst eingerichtet und gestartet', 'Service set up and started')) }, tr('Als Dienst einrichten (startet mit Windows)', 'Set up as service (starts with Windows)')) : null,
      installed && !running ? el('button', { class: 'primary', disabled: busy || !S.admin, onclick: () => act(() => window.relay.start(), tr('Gestartet', 'Started')) }, tr('Starten', 'Start')) : null,
      installed && running ? el('button', { disabled: busy || !S.admin, onclick: () => act(() => window.relay.restart(), tr('Neu gestartet', 'Restarted')) }, tr('Neu starten', 'Restart')) : null,
      installed && running ? el('button', { disabled: busy || !S.admin, onclick: () => act(() => window.relay.stop(), tr('Gestoppt', 'Stopped')) }, tr('Stoppen', 'Stop')) : null,
      busy ? el('span', { class: 'muted' }, tr('Bitte warten …', 'Please wait …')) : null));
}

function accessCard() {
  const addrs = S.addresses.map(a => a.address);
  if (!chosenAddr || (!addrs.includes(chosenAddr) && !chosenAddr.includes('.'))) chosenAddr = addrs[0] || '';
  const addrInput = el('input', { class: 'grow mono', value: chosenAddr, placeholder: tr('Adresse oder Name des Servers', 'Server address or name'), oninput: e => { chosenAddr = e.target.value.trim(); } });
  return el('section', { class: 'card' },
    el('h2', {}, tr('Für Swapline am PC', 'For Swapline on the PC')),
    el('p', { class: 'muted' }, tr('In Swapline: Fernzugriff → „Über Vermittler erreichbar“ → Einrichtungscode einfügen. Oder Adresse, Port und Kennwort einzeln eintragen.',
      'In Swapline: Remote access → “Reachable via relay” → paste the setup code. Or enter address, port and password separately.')),
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:90px' }, tr('Adresse', 'Address')), addrInput),
    addrs.length > 1 ? el('div', { class: 'row muted' }, tr('Adressen dieses Servers: ', 'Addresses of this server: ') + S.addresses.map(a => `${a.address} (${a.name})`).join(', ')) : null,
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:90px' }, 'Port'), el('span', { class: 'mono' }, String(S.config?.port ?? '–'))),
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:90px' }, tr('Kennwort', 'Password')),
      el('span', { class: 'secret grow' }, shownSecret || '••••••••••••••••••••••••'),
      el('button', { onclick: async () => { shownSecret = shownSecret ? '' : await window.relay.showSecret(); render(); } }, shownSecret ? tr('Verbergen', 'Hide') : tr('Anzeigen', 'Show')),
      el('button', { onclick: async () => { if (await window.relay.copySecret()) toast(tr('Kennwort kopiert', 'Password copied')); } }, tr('Kopieren', 'Copy'))),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: async () => { if (await window.relay.copyCode(chosenAddr)) toast(tr('Einrichtungscode kopiert – in Swapline einfügen', 'Setup code copied – paste it into Swapline')); else toast(tr('Bitte eine gültige Adresse angeben', 'Please enter a valid address')); } }, tr('Einrichtungscode kopieren', 'Copy setup code')),
      el('button', { class: 'danger', disabled: busy, onclick: () => act(async () => { const r = await window.relay.newSecret(); if (r === true) shownSecret = ''; return r; }, tr('Neues Kennwort gilt – Swapline-PCs neu einrichten', 'New password active – set up Swapline PCs again')) }, tr('Neues Kennwort …', 'New password …'))));
}

function hostsCard() {
  const list = S.status?.alive ? S.status.hostList || [] : [];
  return el('section', { class: 'card' },
    el('h2', {}, tr('Angemeldete Swapline-PCs', 'Signed-in Swapline PCs')),
    list.length ? el('table', {}, el('tr', {}, el('th', {}, tr('Kennung', 'ID')), el('th', {}, tr('Adresse', 'Address')), el('th', {}, tr('Seit', 'Since')), el('th', {}, tr('Verbindungen', 'Connections'))),
      ...list.map(h => el('tr', {}, el('td', { class: 'mono' }, h.id + '…'), el('td', { class: 'mono' }, h.ip), el('td', {}, ago(h.since)), el('td', {}, String(h.pipes)))))
      : el('p', { class: 'muted' }, tr('Noch kein Swapline-PC angemeldet.', 'No Swapline PC signed in yet.')),
    S.status?.blocked ? el('p', { class: 'muted' }, tr(`${S.status.blocked} Adresse(n) wegen Fehlversuchen vorübergehend gesperrt.`, `${S.status.blocked} address(es) temporarily blocked after failed attempts.`)) : null);
}

function settingsCard() {
  const svc = S.service || {};
  const port = el('input', { type: 'number', min: '1024', max: '65535', value: String(S.config?.port || 47821), style: 'width:110px' });
  return el('section', { class: 'card' },
    el('h2', {}, tr('Einstellungen', 'Settings')),
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:150px' }, 'Port (TCP)'), port,
      el('button', { disabled: busy || !S.admin, onclick: () => act(() => window.relay.setPort(Number(port.value)), tr('Port geändert', 'Port changed')) }, tr('Übernehmen', 'Apply'))),
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:150px' }, tr('Windows-Firewall', 'Windows Firewall')),
      el('span', { class: 'grow' }, svc.firewall ? tr(`Regel aktiv (TCP ${svc.firewallPort})`, `Rule active (TCP ${svc.firewallPort})`) : tr('keine Regel – von außen nicht erreichbar', 'no rule – not reachable from outside')),
      el('button', { disabled: busy || !S.admin, onclick: () => act(() => window.relay.setFirewall(!svc.firewall)) }, svc.firewall ? tr('Entfernen', 'Remove') : tr('Freigeben', 'Allow'))),
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:150px' }, tr('Dienst', 'Service')),
      el('span', { class: 'grow' }, svc.task ? tr(`eingerichtet (${svc.task}) – startet mit Windows als „Lokaler Dienst“`, `set up (${svc.task}) – starts with Windows as “Local Service”`) : tr('nicht eingerichtet', 'not set up')),
      svc.task ? el('button', { class: 'danger', disabled: busy || !S.admin, onclick: () => act(() => window.relay.uninstall(), tr('Dienst entfernt', 'Service removed')) }, tr('Entfernen …', 'Remove …')) : null),
    el('p', { class: 'muted' }, tr('Hat der Hoster eine eigene Firewall, dort ebenfalls den TCP-Port freigeben.', 'If your host has its own firewall, allow the TCP port there as well.')),
    el('div', { class: 'row muted' }, tr('Daten: ', 'Data: '), el('span', { class: 'mono grow' }, S.dataDir), el('button', { onclick: () => window.relay.openDir() }, tr('Ordner öffnen', 'Open folder'))));
}

let logText = '';
function logCard() {
  return el('section', { class: 'card wide' },
    el('div', { class: 'row' }, el('h2', { class: 'grow', style: 'margin:0' }, tr('Protokoll', 'Log')), el('button', { onclick: async () => { logText = await window.relay.log(); render(); } }, tr('Aktualisieren', 'Refresh'))),
    el('pre', { class: 'log' }, logText || tr('(noch keine Einträge)', '(no entries yet)')));
}

function render() {
  if (!S) return;
  $('#sub').textContent = tr(`Vermittler für Swapline · Version ${S.version}`, `Relay for Swapline · version ${S.version}`);
  $('#main').replaceChildren(statusCard(), accessCard(), hostsCard(), settingsCard(), logCard());
  const pre = document.querySelector('pre.log'); if (pre) pre.scrollTop = pre.scrollHeight;
}

async function refresh(force) {
  const s = await window.relay.state(force);
  if (s?.error) return toast(s.error);
  S = s; lang = s.lang;
  if (document.activeElement?.tagName === 'INPUT') return; // nicht während der Eingabe neu zeichnen
  render();
}

(async () => {
  await refresh(true);
  logText = await window.relay.log(); render();
  setInterval(() => refresh(false), 3000);
  setInterval(async () => { logText = await window.relay.log(); if (document.activeElement?.tagName !== 'INPUT') render(); }, 10000);
  const u = await window.relay.checkUpdate();
  if (u) { const b = $('#update'); b.textContent = tr(`Version ${u.version} verfügbar`, `Version ${u.version} available`); b.hidden = false; b.onclick = () => window.relay.openUpdate(u.url); }
})();
