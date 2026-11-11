// Oberfläche von „Swapline Relay“: Status, verbundene Swapline-PCs, Zugangsdaten für Swapline, Einstellungen, Protokoll.
'use strict';
const $ = s => document.querySelector(s);
let S = null, lang = 'de', chosenAddr = '', busy = false;
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

// Haupt-PCs: nur eigene. Je PC ein eigener Einrichtungscode (eigener Schlüssel); nach dem ersten Kontakt wartet der PC auf
// „Erlauben“. Entfernen macht den Schlüssel ungültig und trennt sofort.
let newName = '';
function hostsCard() {
  const addrs = S.addresses.map(a => a.address);
  if (!chosenAddr || (!addrs.includes(chosenAddr) && !chosenAddr.includes('.'))) chosenAddr = addrs[0] || '';
  const online = new Map((S.status?.alive ? S.status.hostList || [] : []).map(h => [h.entry, h]));
  const waiting = new Map((S.status?.alive ? S.status.waiting || [] : []).map(w => [w.entry, w]));
  const addrInput = el('input', { class: 'grow mono', value: chosenAddr, placeholder: tr('Adresse oder Name des Servers', 'Server address or name'), oninput: e => { chosenAddr = e.target.value.trim(); } });
  const nameInput = el('input', { class: 'grow', value: newName, maxlength: '40', placeholder: tr('Name des PCs, z. B. Büro-PC', 'Name of the PC, e.g. office PC'), oninput: e => { newName = e.target.value; } });
  const row = e => {
    const on = online.get(e.id), w = waiting.get(e.id);
    const state = !e.approved && w ? el('span', { class: 'warn' }, tr(`wartet auf Freigabe – Kennung ${w.hostId.slice(0, 6)}…, ${w.ip}`, `waiting for approval – ID ${w.hostId.slice(0, 6)}…, ${w.ip}`))
      : !e.approved ? el('span', { class: 'muted' }, tr('Code noch nicht benutzt', 'code not used yet'))
      : on ? el('span', { class: 'ok' }, tr(`verbunden · ${on.ip} · seit ${ago(on.since)} · ${on.pipes} Verbindung(en)`, `connected · ${on.ip} · for ${ago(on.since)} · ${on.pipes} connection(s)`))
      : el('span', { class: 'muted' }, tr('erlaubt · nicht verbunden', 'allowed · not connected'));
    return el('tr', {}, el('td', {}, e.name), el('td', { class: 'mono' }, e.hostId ? e.hostId + '…' : '–'), el('td', {}, state),
      el('td', {}, !e.approved && w ? el('button', { class: 'primary', disabled: busy || !S.admin, onclick: () => act(() => window.relay.approveHost(e.id), tr('Erlaubt', 'Allowed')) }, tr('Erlauben', 'Allow')) : null,
        !e.hostId ? el('button', { disabled: busy || !S.admin, onclick: async () => { if (await window.relay.copyHostCode(e.id, chosenAddr)) toast(tr('Einrichtungscode kopiert', 'Setup code copied')); else toast(tr('Bitte eine gültige Adresse angeben', 'Please enter a valid address')); } }, tr('Code kopieren', 'Copy code')) : null,
        el('button', { class: 'danger', disabled: busy || !S.admin, onclick: () => act(() => window.relay.removeHost(e.id), tr('Entfernt', 'Removed')) }, tr('Entfernen', 'Remove'))));
  };
  return el('section', { class: 'card wide' },
    el('h2', {}, tr('Haupt-PCs (nur eigene)', 'Host PCs (own only)')),
    el('p', { class: 'muted' }, tr('Jeder PC bekommt einen eigenen Einrichtungscode. In Swapline: Fernzugriff → „Über Vermittler erreichbar“ → Code einfügen (bzw. „swapline-server relay <Code>“). Danach hier „Erlauben“. Andere Personen betreiben ihren eigenen Vermittler.',
      'Each PC gets its own setup code. In Swapline: Remote access → “Reachable via relay” → paste the code (or “swapline-server relay <code>”). Then “Allow” here. Other people run their own relay.')),
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:110px' }, tr('Adresse', 'Address')), addrInput),
    addrs.length > 1 ? el('div', { class: 'row muted' }, tr('Adressen dieses Servers: ', 'Addresses of this server: ') + S.addresses.map(a => `${a.address} (${a.name})`).join(', ')) : null,
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:110px' }, tr('Neuer PC', 'New PC')), nameInput,
      el('button', { class: 'primary', disabled: busy || !S.admin, onclick: () => act(async () => { const r = await window.relay.addHost(newName, chosenAddr); if (r?.ok) newName = ''; return r; }, tr('Einrichtungscode kopiert – in Swapline auf diesem PC einfügen', 'Setup code copied – paste it into Swapline on that PC')) }, tr('Einrichtungscode erzeugen', 'Create setup code'))),
    (S.hosts || []).length ? el('table', {}, el('tr', {}, el('th', {}, tr('Name', 'Name')), el('th', {}, tr('Kennung', 'ID')), el('th', {}, tr('Zustand', 'State')), el('th', {}, '')), ...S.hosts.map(row))
      : el('p', { class: 'muted' }, tr('Noch kein PC eingerichtet.', 'No PC set up yet.')),
    S.status?.blocked ? el('p', { class: 'muted' }, tr(`${S.status.blocked} Adresse(n) wegen Fehlversuchen vorübergehend gesperrt.`, `${S.status.blocked} address(es) temporarily blocked after failed attempts.`)) : null);
}

function settingsCard() {
  const svc = S.service || {};
  const port = el('input', { type: 'number', min: '1024', max: '65535', value: String(S.config?.port || 47821), style: 'width:110px' });
  const perHost = el('input', { type: 'number', min: '1', max: '100', value: String(S.config?.maxPipesPerHost || 10), style: 'width:80px' });
  const total = el('input', { type: 'number', min: '1', max: '1000', value: String(S.config?.maxPipes || 50), style: 'width:80px' });
  return el('section', { class: 'card' },
    el('h2', {}, tr('Einstellungen', 'Settings')),
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:150px' }, 'Port (TCP)'), port,
      el('button', { disabled: busy || !S.admin, onclick: () => act(() => window.relay.setPort(Number(port.value)), tr('Port geändert', 'Port changed')) }, tr('Übernehmen', 'Apply'))),
    el('div', { class: 'row' }, el('span', { class: 'muted', style: 'width:150px' }, tr('Verbindungen', 'Connections')),
      el('span', {}, tr('je PC', 'per PC')), perHost, el('span', {}, tr('gesamt', 'total')), total,
      el('button', { disabled: busy || !S.admin, onclick: () => act(() => window.relay.setLimits(Number(perHost.value), Number(total.value)), tr('Übernommen', 'Applied')) }, tr('Übernehmen', 'Apply'))),
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
  $('#main').replaceChildren(statusCard(), hostsCard(), settingsCard(), logCard());
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
  const cu = $('#check-update');
  cu.textContent = tr('Nach Updates suchen', 'Check for updates');
  cu.onclick = () => checkUpdate(true);
  checkUpdate();
  setInterval(checkUpdate, 6 * 3600e3);
})();

// Update: Banner oben rechts; Klick lädt, prüft und installiert (ohne Setup im Release: Release-Seite öffnen)
let installing = false;
async function checkUpdate(manual) {
  if (installing) return;
  const cu = $('#check-update');
  if (manual) { cu.disabled = true; cu.textContent = tr('Suche …', 'Checking …'); }
  const u = await window.relay.checkUpdate();
  if (manual) { cu.disabled = false; cu.textContent = tr('Nach Updates suchen', 'Check for updates'); }
  const b = $('#update');
  if (!u || u.error) {
    b.hidden = true;
    if (manual) toast(u?.error ? tr('Update-Prüfung fehlgeschlagen: ', 'Update check failed: ') + u.error : tr(`Swapline Relay ist aktuell (Version ${S?.version || ''})`, `Swapline Relay is up to date (version ${S?.version || ''})`));
    return;
  }
  b.textContent = u.installable ? tr(`Version ${u.version} verfügbar – jetzt aktualisieren`, `Version ${u.version} available – update now`) : tr(`Version ${u.version} verfügbar`, `Version ${u.version} available`);
  b.hidden = false;
  b.onclick = async () => {
    if (installing) return;
    if (!u.installable) return window.relay.openUpdate(u.url);
    installing = true;
    const r = await window.relay.installUpdate();
    if (r === true) { b.textContent = tr('Installiere … die App startet gleich neu', 'Installing … the app restarts shortly'); return; }
    installing = false;
    b.textContent = tr(`Version ${u.version} verfügbar – jetzt aktualisieren`, `Version ${u.version} available – update now`);
    if (r?.error) toast(r.error);
  };
}
window.relay.onUpdateProgress(p => { if (installing) $('#update').textContent = tr(`Lade Update … ${Math.round(p * 100)} %`, `Downloading update … ${Math.round(p * 100)} %`); });
