// Swapline – Oberfläche: Konten, Chats, Favoriten, Verlauf, Nachrichten.
'use strict';

const BRAND = {
  company: 'ARFEP IT-Service',
  city: 'Göttingen',
  website: 'https://arfep.de/',
  contact: 'https://arfep.de/#kontakt',
  repo: 'https://github.com/ARFEP-IT-Service/Swapline',
  logo: dark => `assets/arfep/${dark ? 'logo-white' : 'logo-ink'}.svg`,
};
let VERSION = ''; // aus package.json, kommt beim Start vom Hauptprozess (store:get → appVersion)
const COLORS = ['#1581FF', '#7C5CFF', '#22C55E', '#F97316', '#E5007E', '#06B6D4', '#EAB308', '#64748B'];

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
// replaceChildren ohne leere Einträge (null/false würden sonst als Text „null“ erscheinen)
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
const icon = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = d; return s; };
const ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

marked.setOptions({ gfm: true, breaks: true });
// Bilder: Ziel nicht als src (der Browser lädt nichts selbst), sondern als data-src für hydrateImages – auch Windows-Pfade,
// die DOMPurify als unbekanntes Schema verwerfen würde
const escAttr = v => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
marked.use({ renderer: { image({ href, text }) {
  const src = String(href || '').trim();
  if (/^data:image\//i.test(src)) return false; // eingebettete Bilder wie bisher
  return `<img data-src="${escAttr(src.slice(0, 1000))}" alt="${escAttr(text)}">`;
} } });
// Links in Claude-Antworten: nur https (öffnet im Browser). file:, UNC (//host), relative und andere
// Ziele werden entfernt. Bilder: data:-URL direkt; Datei- und Internet-Bilder lädt nie der Browser, sondern sie werden
// als data-src gemerkt und über den Hauptprozess geprüft nachgeladen (hydrateImages).
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.hasAttribute('href')) {
    const href = node.getAttribute('href').trim();
    if (/^https:\/\/[^/\\]/i.test(href)) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    else { node.removeAttribute('href'); node.setAttribute('title', _('Link entfernt: {href}', { href: href.slice(0, 120) })); }
  }
  if (node.tagName === 'IMG' && !/^data:image\//i.test(node.getAttribute('src') || '')) {
    const src = (node.getAttribute('src') || node.getAttribute('data-src') || '').trim();
    if (!src || /^(javascript|vbscript|data|blob):/i.test(src)) node.remove();
    else { node.setAttribute('data-src', src.slice(0, 1000)); node.removeAttribute('src'); }
  }
  for (const attr of ['src', 'srcset', 'action', 'formaction', 'xlink:href', 'poster', 'background']) {
    if ((node.tagName !== 'IMG' || attr !== 'src') && node.hasAttribute(attr)) node.removeAttribute(attr);
  }
});
const md = text => DOMPurify.sanitize(marked.parse(text || ''), { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'picture', 'link', 'meta', 'base'], FORBID_ATTR: ['srcset', 'style', 'background'] });

// ---------- Zustand ----------
let store = null;              // aus dem Hauptprozess
const status = {};             // profileId -> auth status
let view = 'chats';
let tabs = [];                 // Chats
let activeTabId = null;
let lastOpened = {}; // projectId (oder "all") -> zuletzt geöffneter Chat
let historyCache = {};         // profileId -> Liste

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const LS_TABS = 'swapline.tabs.v1';
function saveTabs() {
  try {
    localStorage.setItem(LS_TABS, JSON.stringify({
      activeTabId, lastOpened,
      tabs: tabs.filter(t => !t.mirror).map(t => ({ id: t.id, host: t.host || null, hostProjectId: t.hostProjectId || null, title: t.title, profileId: t.profileId, projectId: t.projectId, cwd: t.cwd, sessionId: t.sessionId, model: t.model, effort: t.effort, permissionMode: t.permissionMode, updated: t.updated, preview: t.preview })),
    }));
  } catch {}
}
function loadTabs() {
  try {
    // einmalige Übernahme der Chat-Liste aus früheren Namen der App (Switchdesk, ConsoleAI)
    for (const legacy of ['switchdesk.tabs.v1', 'consoleai.tabs.v1']) {
      if (!localStorage.getItem(LS_TABS) && localStorage.getItem(legacy)) localStorage.setItem(LS_TABS, localStorage.getItem(legacy));
      localStorage.removeItem(legacy);
    }
    return JSON.parse(localStorage.getItem(LS_TABS)) || { tabs: [] };
  } catch { return { tabs: [] }; }
}

const profile = id => store.profiles.find(p => p.id === id);
const activeProfile = () => profile(store.activeProfileId) || store.profiles[0];
const currentTab = () => tabs.find(t => t.id === activeTabId);

// ---------- Geteilte Ansicht (zwei Chats nebeneinander) ----------
let panes = [], focusedPane = 0, paneTemplate = null;
function swapPane(i) { // ohne Neuzeichnen: IDs, offener Chat und Anhänge der Hälfte i werden „aktiv“
  if (i === focusedPane || !panes[i]) return;
  const old = panes[focusedPane];
  old.tabId = activeTabId; old.attachments = attachments;
  for (const e of old.root.querySelectorAll('[data-pid]')) e.removeAttribute('id');
  focusedPane = i;
  const p = panes[i];
  for (const e of p.root.querySelectorAll('[data-pid]')) e.id = e.dataset.pid;
  activeTabId = p.tabId; attachments = p.attachments || [];
}
function focusPane(i) {
  if (i === focusedPane) return;
  swapPane(i);
  panes.forEach((p, j) => p.root.classList.toggle('focused', j === i));
  closeMenus(); closeCommandPopup();
  renderList(); renderProjectHead();
}
function withPane(p, fn) {
  const i = panes.indexOf(p), prev = focusedPane;
  if (i < 0 || i === prev) return fn();
  swapPane(i);
  try { return fn(); } finally { swapPane(prev); }
}
const paneTabId = (p, j) => (j === focusedPane ? activeTabId : p.tabId);
const paneOf = t => panes.find((p, j) => paneTabId(p, j) === t.id);
const shownInPane = id => panes.some((p, j) => paneTabId(p, j) === id);
function rerenderTab(t) { const p = paneOf(t); if (p) withPane(p, renderChat); }
function renderPaneButtons() {
  $('#chat').classList.toggle('split', panes.length > 1);
  panes.forEach((p, j) => {
    const b = p.root.querySelector('.pane-btn');
    const close = panes.length > 1;
    b.title = close ? _('Diese Hälfte schließen') : _('Zweiten Chat daneben öffnen (Strg+#)');
    b.replaceChildren(icon(close ? ICONS.x : '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'));
    b.onclick = e => { e.stopPropagation(); close ? closePane(j) : openSplit(); };
  });
}
function openSplit(tabId = null) {
  if (panes.length > 1) { if (tabId) { focusPane(1); openTab(tabId); } return; }
  const root = paneTemplate.cloneNode(true);
  $('#chat').append(root);
  translateStatic(root);
  panes.push({ root, tabId: null, attachments: [] });
  bindPane(root);
  focusPane(1);
  renderPaneButtons();
  if (tabId) openTab(tabId); else renderChat();
}
function closePane(i) {
  if (panes.length < 2) return;
  if (focusedPane === i) focusPane(i === 0 ? 1 : 0);
  const p = panes[i];
  panes.splice(i, 1);
  if (focusedPane > i) focusedPane--;
  p.root.remove();
  panes.forEach((x, j) => x.root.classList.toggle('focused', j === focusedPane));
  renderPaneButtons(); renderList();
}
const initials = name => (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
// Avatar: eigenes Bild (Projekte, data:-URL aus dem Hauptprozess) oder Initialen auf Farbe
const avatar = (p, cls = '') => p?.icon
  ? el('div', { class: 'avatar img ' + cls }, el('img', { src: p.icon, alt: '' }))
  : el('div', { class: 'avatar ' + cls, style: `background:${p?.color || '#64748B'}` }, initials(p?.name));
// Eigenes Bild je Chat: verkleinert (96 px) und nur auf diesem PC gespeichert – auch für Chats von Haupt-PCs
const LS_CHAT_ICONS = 'swapline.chatIcons.v1';
const chatIcons = (() => { try { return JSON.parse(localStorage.getItem(LS_CHAT_ICONS)) || {}; } catch { return {}; } })();
const chatIconKey = t => (t.mirror ? t.host + '|m|' + t.hostTab : t.id);
const chatIcon = t => chatIcons[chatIconKey(t)] || null;
const chatAvatar = (t, cls = '') => (chatIcon(t) ? avatar({ icon: chatIcon(t) }, cls) : avatar(profileOf(t), cls));
function saveChatIcons() { try { localStorage.setItem(LS_CHAT_ICONS, JSON.stringify(chatIcons)); } catch { toast(_('Bild konnte nicht gespeichert werden (Speicher voll)')); } }
function shrinkIcon(src, size = 96) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const s = Math.min(img.naturalWidth || size, img.naturalHeight || size);
      c.getContext('2d').drawImage(img, ((img.naturalWidth || size) - s) / 2, ((img.naturalHeight || size) - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
async function pickChatIcon(t) {
  const r = await api.projects.pickIcon();
  if (r?.error) return toast(r.error);
  if (!r?.icon) return;
  const small = await shrinkIcon(r.icon);
  if (!small) return toast(_('Bild konnte nicht gelesen werden'));
  chatIcons[chatIconKey(t)] = small; saveChatIcons();
  renderList(); rerenderTab(t);
}
function removeChatIcon(t) { delete chatIcons[chatIconKey(t)]; saveChatIcons(); renderList(); rerenderTab(t); }
const baseName = p => (p || '').split(/[\\/]/).filter(Boolean).pop() || p || 'Home';

// Uhrzeit an Nachrichten: heute nur HH:MM, sonst mit Datum
function msgTime(ts) {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return _('Gestern');
  if (now - d < 6 * 864e5) return d.toLocaleDateString(locale(), { weekday: 'short' });
  return d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function isDark() {
  const th = store?.settings?.theme || 'system';
  return th === 'dark' || (th === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme() {
  const th = store.settings.theme || 'system';
  if (th === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', th);
  renderUsage();
}

// ---------- Kontoleiste & Kopf ----------
// ---------- Projektleiste (links) & Konto-Knopf (links unten) ----------
const activeProjectId = () => store.activeProjectId || 'all';
const project = id => (store.projects || []).find(x => x.id === id);
// Ansicht: 'all', eine Projekt-ID oder 'host:<id>' (alle Chats eines Haupt-PCs)
const hostOfView = pid => (typeof pid === 'string' && pid.startsWith('host:') ? pid.slice(5) : null);
const tabInProject = (t, pid) => pid === 'all' || (hostOfView(pid) ? t.host === hostOfView(pid) && inHostProject(t.host, t.cwd, t.hostProjectId) : t.projectId === pid);
// Projekte eines Haupt-PCs/Servers: Filter in dessen Ansicht (Zugehörigkeit über den Projektordner)
const hostProjectFilter = {}; // Haupt-PC -> Projekt-ID oder null (alle)
const within = (cwd, dir) => { const n = x => String(x || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); const a = n(cwd), b = n(dir); return !!b && (a === b || a.startsWith(b + '/')); };
function inHostProject(host, cwd, projectId) {
  const f = hostProjectFilter[host];
  if (!f) return true;
  const p = hostStores[host]?.projects?.find(x => x.id === f);
  return !p || projectId === p.id || within(cwd, p.cwd);
}

// ---------- Chats von Haupt-PCs (Fernzugriff) ----------
// Ein Chat mit t.host läuft auf diesem Haupt-PC; seine Anfragen gehen über den Hauptprozess genau dorthin.
// Konten, Modelle und Status eines Haupt-PCs werden unter „Haupt-PC|Konto“ geführt (Konto-IDs können doppelt sein).
const hostStores = {}; // Haupt-PC-ID -> Stand vom Haupt-PC (Konten, Ordner, Freigabe …)
const pkey = (host, id) => (host ? host + '|' + id : id);
const tk = t => pkey(t.host, t.profileId);
const hostProfiles = host => (host ? hostStores[host]?.profiles || [] : store.profiles);
const profileOf = t => hostProfiles(t.host).find(p => p.id === t.profileId);
const hostInfo = id => remoteState?.hosts?.find(h => h.id === id);
const hostName = id => hostInfo(id)?.name || hostStores[id]?.hostName || _('Haupt-PC');
// Symbol eines Haupt-PCs: eigenes Bild oder Initialen auf Farbe, mit kleinem Bildschirm-Zeichen
const hostAvatar = (h, cls = '') => {
  const a = h?.icon ? avatar({ icon: h.icon }, 'host ' + cls) : el('div', { class: 'avatar host ' + cls, style: `background:${h?.color || '#475569'}` }, initials(h?.name));
  a.append(el('span', { class: 'host-mark' }, icon(h?.kind === 'ssh' ? SERVER : MONITOR)));
  return a;
};
const hostConnected = id => hostInfo(id)?.state === 'connected';
function tapi(x) {
  const host = typeof x === 'string' ? x : x?.host;
  if (!host) return api;
  const call = (ch, ...args) => api.remote.call(host, ch, args);
  return {
    session: {
      send: (tab, content) => call('session:send', { tab, content }),
      bash: (tab, command) => call('session:bash', { tab, command }), bashStop: id => call('session:bashStop', id),
      respond: (tabId, requestId, response) => call('session:respond', { tabId, requestId, response }),
      interrupt: id => call('session:interrupt', id), restart: id => call('session:restart', id), close: id => call('session:close', id),
      confirmBypass: id => call('session:confirmBypass', id),
    },
    images: { file: (cwd, path) => call('files:image', { cwd, path }), web: url => call('web:image', url) },
    history: { list: pid => call('history:list', pid), loadSession: d => call('history:loadSession', d), search: (pid, q) => call('history:search', { profileId: pid, query: q }) },
    profiles: { status: id => call('profiles:status', id), models: (id, refresh) => call('profiles:models', { id, refresh }) },
    readTaskOutput: f => call('task:readOutput', f),
  };
}
const dismissedMirrors = new Set(); // vom Gerät geschlossene Spiegel-Chats (bis der Haupt-PC sie schließt)
function syncMirrors(host, list) {
  if (!Array.isArray(list)) return;
  const ids = new Set(list.map(x => x.id));
  for (const t of [...tabs]) {
    if (!t.mirror || t.host !== host || ids.has(t.hostTab)) continue;
    tabs.splice(tabs.indexOf(t), 1);
    dismissedMirrors.delete(host + '|' + t.hostTab);
    if (activeTabId === t.id) { activeTabId = null; renderChat(); }
    panes.forEach((p, j) => { if (j !== focusedPane && p.tabId === t.id) { p.tabId = null; withPane(p, renderChat); } });
  }
  for (const x of list) {
    if (dismissedMirrors.has(host + '|' + x.id)) continue;
    const t = tabs.find(y => y.mirror && y.host === host && y.hostTab === x.id);
    if (!t) {
      tabs.push(makeTab({ host, hostTab: x.id, mirror: true, projectId: mirrorProjects[host + '|' + x.id] || null, title: x.title, profileId: x.profileId, cwd: x.cwd, sessionId: x.sessionId,
        model: x.model, effort: x.effort, permissionMode: x.permissionMode, updated: x.updated, preview: x.preview, running: x.running, loaded: !x.sessionId }));
    } else {
      Object.assign(t, { title: x.title || t.title, preview: x.preview || t.preview, updated: Math.max(t.updated || 0, x.updated || 0), sessionId: t.sessionId || x.sessionId,
        model: x.model, effort: x.effort, permissionMode: x.permissionMode });
      if (!t.attached) t.running = x.running;
    }
  }
  renderList(); renderRail();
  if (currentTab()?.mirror) renderChatChip(currentTab());
}
api.remote.onTabs(({ host, list }) => syncMirrors(host, list));
api.remote.onStoreChanged(({ host }) => { if (hostConnected(host)) refreshHost(host); });
api.onStoreChanged(async () => { store = await api.getStore(); renderRail(); renderList(); });
async function attachMirror(t) {
  if (!t.mirror || t.attached || !hostConnected(t.host)) return;
  const r = await api.remote.call(t.host, 'session:attach', [{ tabId: t.id, hostTab: t.hostTab }]);
  if (r) { t.attached = true; t.running = !!r.running; setTyping(t); if (t.id === activeTabId) updateComposer(); }
}
async function refreshHost(id) {
  for (const t of tabs) if (t.host === id && t.mirror) t.attached = false; // nach (Wieder-)Verbindung neu beitreten
  syncMirrors(id, await api.remote.call(id, 'tabs:list', []));
  const r = await api.remote.call(id, 'store:get', []);
  if (!r) return;
  hostStores[id] = r;
  await Promise.all(r.profiles.map(async p => { status[pkey(id, p.id)] = await tapi(id).profiles.status(p.id); }));
  renderRail(); renderList();
  const t = currentTab();
  if (t?.host === id) { if (!t.loaded || t.mirror) openTab(t.id); else renderChat(); }
}
const SERVER = '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>';
const MONITOR = '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>';
const GLOBE = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"/>';

function renderRail() {
  const pid = activeProjectId();
  $('#rail-all').classList.toggle('active', pid === 'all');
  const busyIn = id => tabs.some(t => t.projectId === id && (t.unread || t.running || bgRunning(t)));
  // Projekte, teils in Ordnern (auf-/zuklappbar; Zustand nur auf diesem Gerät gespeichert)
  const groups = store.projectGroups || [], projects = store.projects || [];
  const inGroup = p => groups.some(g => g.id === p.groupId);
  const groupNodes = groups.map(g => {
    const kids = projects.filter(p => p.groupId === g.id);
    const open = !collapsedGroups.has(g.id);
    const busy = kids.some(p => busyIn(p.id));
    return el('div', { class: 'rail-group-wrap' + (open ? ' open' : '') },
      el('button', {
        class: 'rail-profile rail-group' + (open ? ' open' : '') + (!open && kids.some(p => p.id === pid) ? ' active' : ''),
        title: g.name + '\n' + (kids.length === 1 ? _('1 Projekt') : _('{n} Projekte', { n: kids.length })) + '\n' + _('Klicken: auf-/zuklappen · Rechtsklick: bearbeiten · Projekt hierher ziehen'),
        onclick: () => toggleGroup(g.id),
        oncontextmenu: e => { e.preventDefault(); openGroupForm(g); },
        ondragover: e => { if ([...e.dataTransfer.types].includes('text/project')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
        ondragleave: e => e.currentTarget.classList.remove('drop'),
        ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('drop'); const id = e.dataTransfer.getData('text/project'); if (id) moveProjectToGroup(id, g.id); },
      }, el('div', { class: 'avatar group', style: `background:${g.color}` }, icon(ICONS.folder)),
        !open && kids.length ? el('span', { class: 'count' }, String(kids.length)) : null,
        busy && !open ? el('span', { class: 'badge on' }) : null),
      open && kids.length ? el('div', { class: 'rail-group-kids' }, ...kids.map(projButton)) : null);
  });
  $('#rail-projects').replaceChildren(...groupNodes, ...projects.filter(p => !inGroup(p)).map(projButton));
  renderRailHosts();
  function projButton(pr) { return el('button', {
    class: 'rail-profile' + (pr.id === pid ? ' active' : ''),
    title: pr.name + (pr.cwd ? '\n' + pr.cwd : '') + '\n' + _('Rechtsklick: bearbeiten'),
    onclick: () => switchProject(pr.id),
    oncontextmenu: e => { e.preventDefault(); openProjectForm(pr); },
    draggable: 'true',
    ondragstart: e => e.dataTransfer.setData('text/project', pr.id),
    ondragover: e => { if ([...e.dataTransfer.types].some(x => x === 'text/chat' || x === 'text/project')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    ondragleave: e => e.currentTarget.classList.remove('drop'),
    ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('drop'); onRailDrop(e, pr.id); },
  }, avatar(pr), busyIn(pr.id) ? el('span', { class: 'badge on' }) : null); }

  // Konto-Knopf unten: Avatar des aktiven Kontos mit Status-Punkt
  const p = activeProfile(), st = status[p.id];
  $('#btn-account').replaceChildren(avatar(p), el('span', { class: 'badge ' + (st ? (st.loggedIn ? 'on' : 'off') : '') }));
  $('#btn-account').title = _('Konto: {name}', { name: p.name }) + (st?.email ? '\n' + st.email : '') + (st && !st.loggedIn ? '\n(' + stateText(st) + ')' : '') + '\n' + _('Klicken zum Wechseln');
  renderProjectHead();
}

function renderProjectHead() {
  const pid = activeProjectId(), pr = project(pid), hv = hostOfView(pid);
  if (hv) {
    const av = hostAvatar(hostInfo(hv) || { name: hostName(hv) }, 'lg');
    av.id = 'ph-avatar';
    $('#ph-avatar').replaceWith(av);
    $('#ph-name').textContent = hostName(hv);
    const count = tabs.filter(t => t.host === hv).length;
    $('#ph-sub').textContent = (hostConnected(hv) ? _('Haupt-PC · verbunden') : _('Haupt-PC · nicht verbunden')) + ' · ' + (count === 1 ? _('1 Chat') : _('{n} Chats', { n: count }));
    $('#ph-sub').title = hostInfo(hv) ? hostInfo(hv).address + ':' + hostInfo(hv).port : '';
    $('#btn-project-edit').hidden = true;
    renderHostProjects(hv);
    return;
  }
  $('#host-projects').hidden = true;
  const av = pr ? avatar(pr, 'lg') : el('div', { class: 'avatar lg globe' }, icon(GLOBE));
  av.id = 'ph-avatar';
  $('#ph-avatar').replaceWith(av);
  $('#ph-name').textContent = pr ? pr.name : _('Allgemein');
  const count = tabs.filter(t => tabInProject(t, pid)).length;
  $('#ph-sub').textContent = pr ? (pr.cwd || _('ohne festen Ordner')) + ' · ' + (count === 1 ? _('1 Chat') : _('{n} Chats', { n: count })) : _('Alle Chats · {n}', { n: count });
  $('#ph-sub').title = pr?.cwd || '';
  $('#btn-project-edit').hidden = !pr;
}

async function switchProject(id) {
  store = await api.projects.setActive(id);
  historyCache = {};
  // Gehört der offene Chat nicht zum gewählten Projekt: den dort zuletzt geöffneten (sonst zuletzt aktiven) Chat öffnen,
  // sonst die leere Startansicht zeigen
  const t = currentTab();
  if (!t || !tabInProject(t, id)) {
    const last = tabs.find(x => x.id === lastOpened[id] && tabInProject(x, id));
    const next = last || tabs.filter(x => tabInProject(x, id)).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
    if (next) return openTab(next.id);
    activeTabId = null; saveTabs(); renderChat();
  }
  renderRail(); renderList();
}

// Chat auf ein Projekt ziehen = verschieben; Projekt auf Projekt ziehen = Reihenfolge ändern
// Projekt-Ordner: auf-/zuklappen (nur Ansicht, je Gerät), Projekte hinein- bzw. herausschieben
const LS_GROUPS = 'swapline.railGroups.v1';
const collapsedGroups = new Set((() => { try { return JSON.parse(localStorage.getItem(LS_GROUPS)) || []; } catch { return []; } })());
function toggleGroup(id) {
  collapsedGroups.has(id) ? collapsedGroups.delete(id) : collapsedGroups.add(id);
  try { localStorage.setItem(LS_GROUPS, JSON.stringify([...collapsedGroups])); } catch {}
  renderRail();
}
async function moveProjectToGroup(projectId, groupId) {
  const r = await api.projects.update(projectId, { groupId: groupId || null });
  if (r?.rejected) return toast(r.rejected);
  store = r;
  if (groupId) collapsedGroups.delete(groupId);
  renderRail();
}
function openGroupForm(g = {}) {
  let color = g.color || '#64748B';
  const name = el('input', { type: 'text', value: g.name || '', placeholder: _('z. B. Kunden, Privat, Archiv') });
  const colors = el('div', { class: 'colors' });
  const drawColors = () => colors.replaceChildren(...COLORS.map(c => el('button', { class: c === color ? 'sel' : '', style: `background:${c}`, onclick: () => { color = c; drawColors(); } })));
  drawColors();
  const save = async () => {
    if (!name.value.trim()) return name.focus();
    const r = g.id ? await api.projects.groupUpdate(g.id, { name: name.value.trim(), color }) : await api.projects.groupAdd({ name: name.value.trim(), color });
    if (r?.rejected) return toast(r.rejected);
    store = r; m.close(); renderRail();
  };
  const n = (store.projects || []).filter(p => p.groupId === g.id).length;
  const m = modal('project', g.id ? _('Ordner bearbeiten') : _('Neuer Ordner'),
    el('p', { class: 'hint' }, _('Ein Ordner fasst Projekte in der Leiste zusammen. Projekte per Ziehen auf den Ordner oder im Projekt unter „Ordner“ zuordnen.')),
    el('label', { class: 'field' }, el('span', {}, _('Name')), name),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Farbe')), colors),
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'primary', onclick: save }, g.id ? _('Speichern') : _('Ordner anlegen')),
      g.id ? el('button', { class: 'ghost danger', style: 'margin-left:auto', onclick: async () => {
        if (!confirm(_('Ordner „{name}“ löschen?', { name: g.name }) + (n ? '\n\n' + _('Die Projekte darin bleiben erhalten und stehen danach wieder einzeln in der Leiste.') : ''))) return;
        const r = await api.projects.groupRemove(g.id);
        if (r?.rejected) return toast(r.rejected);
        store = r; m.close(); renderRail();
      } }, _('Ordner löschen')) : null));
  name.focus();
  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}
// Gekoppelte Haupt-PCs in der Leiste – wie Projekte: ein Klick zeigt deren Chats, die eigenen bleiben offen
// Haupt-PCs/Server in der Leiste mit ihren Projekten und Ordnern – auf- und zuklappbar wie eigene Ordner.
// Klick auf den Haupt-PC: öffnen und aufklappen; erneuter Klick (wenn schon offen): zuklappen.
const LS_HOSTS_OPEN = 'swapline.railHostsOpen.v1';
const openHosts = new Set((() => { try { return JSON.parse(localStorage.getItem(LS_HOSTS_OPEN)) || []; } catch { return []; } })());
const saveOpenHosts = () => { try { localStorage.setItem(LS_HOSTS_OPEN, JSON.stringify([...openHosts])); } catch {} };
function clickHost(id) {
  const view = 'host:' + id;
  if (activeProjectId() === view && !hostProjectFilter[id] && openHosts.has(id)) { openHosts.delete(id); saveOpenHosts(); return renderRail(); }
  openHosts.add(id); saveOpenHosts();
  delete hostProjectFilter[id]; historyCache = {};
  if (activeProjectId() === view) { renderList(); renderRail(); renderProjectHead(); } else switchProject(view);
}
function pickHostProject(host, projectId) {
  hostProjectFilter[host] = projectId; historyCache = {};
  if (activeProjectId() === 'host:' + host) { renderList(); renderRail(); renderProjectHead(); } else switchProject('host:' + host);
}
function renderRailHosts() {
  const hosts = remoteState?.hosts || [], pid = activeProjectId();
  $('#rail-hosts-sep').hidden = !hosts.length;
  $('#rail-hosts').replaceChildren(...hosts.map(h => {
    const hs = hostStores[h.id], open = openHosts.has(h.id) && !!hs?.projects?.length;
    const inView = pid === 'host:' + h.id, filter = hostProjectFilter[h.id];
    const busyIn = cwd => tabs.some(t => t.host === h.id && (t.running || t.unread) && (!cwd || within(t.cwd, cwd)));
    const projBtn = p => el('button', {
      class: 'rail-profile' + (inView && filter === p.id ? ' active' : ''),
      title: p.name + (p.cwd ? '\n' + p.cwd : '') + '\n' + hostName(h.id) + (hs.canEditProjects ? '\n' + _('Rechtsklick: bearbeiten') : ''),
      onclick: () => pickHostProject(h.id, p.id),
      oncontextmenu: e => { e.preventDefault(); if (hs.canEditProjects) openHostProjectForm(h.id, p); },
    }, avatar(p), p.cwd && busyIn(p.cwd) ? el('span', { class: 'badge on' }) : null);
    const groups = hs?.projectGroups || [], projects = hs?.projects || [];
    const groupNodes = groups.filter(g => projects.some(p => p.groupId === g.id)).map(g => {
      const key = 'host:' + h.id + ':' + g.id, gOpen = !collapsedGroups.has(key), kids = projects.filter(p => p.groupId === g.id);
      return el('div', { class: 'rail-group-wrap' + (gOpen ? ' open' : '') },
        el('button', { class: 'rail-profile rail-group' + (gOpen ? ' open' : '') + (!gOpen && inView && kids.some(p => p.id === filter) ? ' active' : ''), title: g.name, onclick: () => toggleGroup(key) },
          el('div', { class: 'avatar group', style: `background:${g.color}` }, icon(ICONS.folder)), !gOpen ? el('span', { class: 'count' }, String(kids.length)) : null),
        gOpen ? el('div', { class: 'rail-group-kids' }, ...kids.map(projBtn)) : null);
    });
    return el('div', { class: 'rail-host-wrap' + (open ? ' open' : '') },
      el('button', {
        class: 'rail-profile' + (inView && !filter ? ' active' : ''),
        title: (h.kind === 'ssh' ? _('Server: {name}', { name: h.name }) : _('Haupt-PC: {name}', { name: h.name })) + '\n' + h.address + ':' + h.port + '\n' + (h.state === 'connected' ? _('verbunden') : h.error || _('nicht verbunden'))
          + (hs?.projects?.length ? '\n' + _('Klicken: öffnen · erneut klicken: Projekte zuklappen') : ''),
        onclick: () => clickHost(h.id),
        oncontextmenu: e => { e.preventDefault(); openHostForm(h); },
      }, hostAvatar(h),
        el('span', { class: 'badge ' + (h.state === 'connected' ? (busyIn() ? 'on busy' : 'on') : 'off') }),
        !open && hs?.projects?.length ? el('span', { class: 'count' }, String(hs.projects.length)) : null),
      open ? el('div', { class: 'rail-group-kids' }, ...groupNodes, ...projects.filter(p => !groups.some(g => g.id === p.groupId)).map(projBtn)) : null);
  }));
}

function openHostForm(h) {
  let color = h.color || '#475569', img = h.icon || null;
  const name = el('input', { type: 'text', value: h.name });
  const colors = el('div', { class: 'colors' });
  const preview = el('div', { class: 'folder-row' });
  const draw = () => {
    colors.replaceChildren(...COLORS.map(c => el('button', { class: c === color ? 'sel' : '', style: `background:${c}`, onclick: () => { color = c; draw(); } })));
    fill(preview, hostAvatar({ name: name.value || h.name, color, icon: img }, 'lg'),
      el('span', { class: 'hint', style: 'flex:1' }, img ? _('eigenes Bild') : _('Initialen auf Farbe')),
      el('button', { class: 'ghost', onclick: async () => { const r = await api.projects.pickIcon(); if (r?.error) return toast(r.error); if (r?.icon) { img = r.icon; draw(); } } }, _('Bild wählen …')),
      img ? el('button', { class: 'ghost', onclick: () => { img = null; draw(); } }, _('Entfernen')) : null);
  };
  draw();
  name.addEventListener('input', draw);
  const save = async () => {
    remoteState = h.kind === 'ssh' ? await api.remote.ssh.update({ id: h.id.slice(4), name: name.value.trim() || h.name, color }) : await api.remote.hostUpdate({ id: h.id, name: name.value.trim() || h.name, color, icon: img });
    m.close(); renderRail(); renderList();
  };
  const m = modal('project', _('Haupt-PC anpassen'),
    el('p', { class: 'hint' }, _('Name, Farbe und Bild gelten nur für die Anzeige auf diesem PC.')),
    el('label', { class: 'field' }, el('span', {}, _('Name')), name),
    h.kind === 'ssh' ? null : el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Bild (optional)')), preview),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Farbe')), colors),
    el('div', { class: 'row', style: 'margin-top:16px' }, el('button', { class: 'primary', onclick: save }, _('Speichern'))));
}

function renderHostProjects(host) {
  const box = $('#host-projects'), hs = hostStores[host];
  const projects = hs?.projects || [], groups = hs?.projectGroups || [];
  box.hidden = !projects.length && !hs?.canEditProjects;
  if (box.hidden) return;
  const cur = hostProjectFilter[host] || null;
  const pick = id => pickHostProject(host, id);
  const chip = p => el('button', { class: 'hp-chip' + (cur === p.id ? ' sel' : ''), title: p.cwd || '', onclick: () => pick(cur === p.id ? null : p.id),
    oncontextmenu: e => { e.preventDefault(); if (hs.canEditProjects) openHostProjectForm(host, p); } }, avatar(p, 'sm'), el('span', {}, p.name));
  const inGroup = p => groups.some(g => g.id === p.groupId);
  fill(box,
    el('button', { class: 'hp-chip plain' + (!cur ? ' sel' : ''), onclick: () => pick(null) }, _('Alle')),
    ...projects.filter(p => !inGroup(p)).map(chip),
    ...groups.filter(g => projects.some(p => p.groupId === g.id)).flatMap(g => [el('div', { class: 'hp-group' }, g.name), ...projects.filter(p => p.groupId === g.id).map(chip)]),
    hs.canEditProjects ? el('button', { class: 'hp-chip plain hp-add', onclick: () => openHostProjectForm(host) }, _('+ Projekt')) : null,
    hs.canEditProjects ? el('button', { class: 'hp-chip plain hp-add', onclick: () => openHostGroupForm(host) }, _('+ Ordner')) : null);
}
// Projekt auf dem Haupt-PC anlegen/ändern (nur mit Gerätefreigabe; Ordner nur aus den freigegebenen)
function openHostProjectForm(host, pr = {}) {
  const hs = hostStores[host];
  let color = pr.color || COLORS[(hs.projects || []).length % COLORS.length];
  const name = el('input', { type: 'text', value: pr.name || '', placeholder: _('z. B. Glassbed, Website, Verein') });
  const colors = el('div', { class: 'colors' });
  const drawColors = () => colors.replaceChildren(...COLORS.map(c => el('button', { class: c === color ? 'sel' : '', style: `background:${c}`, onclick: () => { color = c; drawColors(); } })));
  drawColors();
  const isServer = hostInfo(host)?.kind === 'ssh';
  // Server: Pfad frei eingeben (Vorschläge aus den bekannten Ordnern), Haupt-PC: nur freigegebene Ordner
  const folder = isServer
    ? el('input', { type: 'text', value: pr.cwd || '', placeholder: _('/home/ich/projekt'), list: 'srv-folders' })
    : el('select', {}, hs.scope.limited ? null : el('option', { value: '' }, _('kein Ordner – wird pro Chat gewählt')),
      ...(hs.allowedFolders || []).map(f => el('option', { value: f, selected: f === pr.cwd }, f)));
  const folderList = isServer ? el('datalist', { id: 'srv-folders' }, ...(hs.allowedFolders || []).map(f => el('option', { value: f }))) : null;
  const mkdir = el('input', { type: 'checkbox' });
  const group = el('select', {}, el('option', { value: '' }, _('Kein Ordner')), ...(hs.projectGroups || []).map(g => el('option', { value: g.id, selected: g.id === pr.groupId }, g.name)));
  const save = async () => {
    if (!name.value.trim()) return name.focus();
    const data = { name: name.value.trim(), color, cwd: folder.value.trim(), groupId: group.value || null, ...(isServer && mkdir.checked ? { mkdir: true } : {}) };
    const r = await api.remote.call(host, pr.id ? 'projects:update' : 'projects:add', [pr.id ? { id: pr.id, patch: data } : data]);
    if (r?.error) return toast(r.error);
    if (!r) return toast(isServer ? _('Ordner ungültig – bitte als /absoluter/pfad angeben') : _('Am Haupt-PC nicht erlaubt – Freigabe „Projekte anlegen“ fehlt oder Ordner nicht freigegeben'));
    hostStores[host] = r; m.close(); renderProjectHead(); renderList();
  };
  const m = modal('project', pr.id ? _('Projekt auf „{name}“ bearbeiten', { name: hostName(host) }) : _('Neues Projekt auf „{name}“', { name: hostName(host) }),
    el('label', { class: 'field' }, el('span', {}, _('Name')), name),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Farbe')), colors),
    el('label', { class: 'field' }, el('span', {}, isServer ? _('Projektordner auf dem Server') : _('Projektordner auf dem Haupt-PC')), folder, folderList),
    isServer ? el('label', { class: 'row', style: 'gap:8px' }, mkdir, _('Ordner auf dem Server anlegen, falls er fehlt')) : null,
    (hs.projectGroups || []).length ? el('label', { class: 'field' }, el('span', {}, _('Ordner in der Leiste')), group) : null,
    el('div', { class: 'row', style: 'margin-top:16px' }, el('button', { class: 'primary', onclick: save }, pr.id ? _('Speichern') : _('Projekt anlegen')),
      pr.id && hs.canRemoveProjects ? el('button', { class: 'ghost danger', style: 'margin-left:auto', onclick: async () => {
        if (!confirm(_('Projekt „{name}“ aus der Liste entfernen? Der Ordner auf dem Server bleibt erhalten.', { name: pr.name }))) return;
        const r = await api.remote.call(host, 'projects:remove', [{ id: pr.id }]);
        if (r && !r.error) { hostStores[host] = r; if (hostProjectFilter[host] === pr.id) delete hostProjectFilter[host]; m.close(); renderProjectHead(); renderList(); }
      } }, _('Projekt entfernen')) : null));
  name.focus();
}
function openHostGroupForm(host) {
  let color = '#64748B';
  const name = el('input', { type: 'text', placeholder: _('z. B. Kunden, Privat, Archiv') });
  const colors = el('div', { class: 'colors' });
  const drawColors = () => colors.replaceChildren(...COLORS.map(c => el('button', { class: c === color ? 'sel' : '', style: `background:${c}`, onclick: () => { color = c; drawColors(); } })));
  drawColors();
  const m = modal('project', _('Neuer Ordner auf „{name}“', { name: hostName(host) }),
    el('label', { class: 'field' }, el('span', {}, _('Name')), name),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Farbe')), colors),
    el('div', { class: 'row', style: 'margin-top:16px' }, el('button', { class: 'primary', onclick: async () => {
      if (!name.value.trim()) return name.focus();
      const r = await api.remote.call(host, 'projects:groupAdd', [{ name: name.value.trim(), color }]);
      if (!r || r.error) return toast(_('Am Haupt-PC nicht erlaubt – Freigabe „Projekte anlegen“ fehlt'));
      hostStores[host] = r; m.close(); renderProjectHead();
    } }, _('Ordner anlegen'))));
  name.focus();
}

async function onRailDrop(e, targetId) {
  const chatId = e.dataTransfer.getData('text/chat');
  if (chatId) return moveChatToProject(chatId, targetId);
  const pid = e.dataTransfer.getData('text/project');
  if (pid && pid !== targetId) {
    // auf ein Projekt gezogen: in dessen Ordner (bzw. aus dem Ordner heraus) und davor einreihen
    const target = project(targetId), moved = project(pid);
    if (target && moved && (target.groupId || null) !== (moved.groupId || null)) { const r = await api.projects.update(pid, { groupId: target.groupId || null }); if (r?.rejected) return toast(r.rejected); store = r; }
    const ids = store.projects.map(x => x.id).filter(x => x !== pid);
    ids.splice(ids.indexOf(targetId), 0, pid);
    store = await api.projects.reorder(ids);
    renderRail();
  }
}
const LS_MIRROR_PROJECTS = 'swapline.mirrorProjects.v1';
const mirrorProjects = (() => { try { return JSON.parse(localStorage.getItem(LS_MIRROR_PROJECTS)) || {}; } catch { return {}; } })();
function moveChatToProject(chatId, projectId) {
  const t = tabs.find(x => x.id === chatId);
  if (!t) return;
  t.projectId = projectId === 'all' ? null : projectId;
  if (t.mirror) { // gespiegelte Chats werden nicht gespeichert – ihre Projekt-Zuordnung schon
    if (t.projectId) mirrorProjects[t.host + '|' + t.hostTab] = t.projectId; else delete mirrorProjects[t.host + '|' + t.hostTab];
    try { localStorage.setItem(LS_MIRROR_PROJECTS, JSON.stringify(mirrorProjects)); } catch {}
  }
  saveTabs(); renderRail(); renderList();
  toast(projectId === 'all' ? _('Chat ist jetzt ohne Projekt') : _('Chat verschoben nach „{name}“', { name: project(projectId).name }));
}

function openProjectForm(pr = {}) {
  let color = pr.color || COLORS[(store.projects || []).length % COLORS.length];
  let cwd = pr.cwd || '';
  const name = el('input', { type: 'text', value: pr.name || '', placeholder: _('z. B. Glassbed, Website, Verein') });
  const groupSel = el('select', {}, el('option', { value: '' }, _('Kein Ordner')), ...(store.projectGroups || []).map(g => el('option', { value: g.id, selected: g.id === pr.groupId }, g.name)));
  const colors = el('div', { class: 'colors' });
  const drawColors = () => colors.replaceChildren(...COLORS.map(c => el('button', { class: c === color ? 'sel' : '', style: `background:${c}`, onclick: () => { color = c; drawColors(); } })));
  drawColors();
  const folder = el('div', { class: 'folder-row' });
  const drawFolder = () => fill(folder,
    el('span', { class: 'mono ' + (cwd ? '' : 'muted') }, cwd || _('kein Ordner – wird pro Chat gewählt')),
    el('button', { class: 'ghost', onclick: async () => { const d = await api.pickFolder(); if (d) { cwd = d; if (!name.value.trim()) name.value = baseName(d); drawFolder(); } } }, _('Wählen …')),
    cwd ? el('button', { class: 'ghost', onclick: () => { cwd = ''; drawFolder(); } }, _('Entfernen')) : null);
  drawFolder();
  // Projektbild (SVG, PNG, JPG, WebP, GIF, ICO bis 512 KB) – gewählt über den Datei-Dialog des Hauptprozesses
  let icon = pr.icon || null;
  const iconRow = el('div', { class: 'folder-row' });
  const drawIcon = () => fill(iconRow,
    avatar({ name: name.value || pr.name || '?', color, icon }, 'lg'),
    el('span', { class: 'hint', style: 'flex:1' }, icon ? _('eigenes Bild') : _('Initialen auf Farbe')),
    el('button', { class: 'ghost', onclick: async () => {
      const r = await api.projects.pickIcon();
      if (r?.error) return toast(r.error);
      if (r?.icon) { icon = r.icon; drawIcon(); }
    } }, _('Bild wählen …')),
    icon ? el('button', { class: 'ghost', onclick: () => { icon = null; drawIcon(); } }, _('Entfernen')) : null);
  drawIcon();
  name.addEventListener('input', () => { if (!icon) drawIcon(); });
  colors.addEventListener('click', () => { if (!icon) setTimeout(drawIcon); });
  const save = async () => {
    if (!name.value.trim()) return name.focus();
    const data = { name: name.value.trim(), color, cwd, icon, groupId: groupSel.value || null };
    store = pr.id ? await api.projects.update(pr.id, data) : await api.projects.add(data);
    m.close(); renderRail(); renderList();
  };
  const m = modal('project', pr.id ? _('Projekt bearbeiten') : _('Neues Projekt'),
    el('label', { class: 'field' }, el('span', {}, _('Name')), name),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Bild (optional)')), iconRow),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Farbe')), colors),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Projektordner (neue Chats starten hier)')), folder),
    (store.projectGroups || []).length ? el('label', { class: 'field' }, el('span', {}, _('Ordner in der Leiste')), groupSel) : null,
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'primary', onclick: save }, pr.id ? _('Speichern') : _('Projekt anlegen')),
      pr.id ? el('button', { class: 'ghost danger', style: 'margin-left:auto', onclick: async () => {
        const n = tabs.filter(t => t.projectId === pr.id).length;
        const kept = n === 1 ? _('Der Chat bleibt erhalten und landet unter „Allgemein“.') : _('Die {n} Chats bleiben erhalten und landen unter „Allgemein“.', { n });
        if (!confirm(_('Projekt „{name}“ löschen?', { name: pr.name }) + (n ? '\n\n' + kept : ''))) return;
        tabs.forEach(t => { if (t.projectId === pr.id) t.projectId = null; });
        saveTabs();
        store = await api.projects.remove(pr.id); m.close(); renderRail(); renderList();
      } }, _('Projekt löschen')) : null));
  name.focus();
  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

// Kontomenü (links unten)
function openAccountMenu() {
  closeMenus();
  const r = $('#btn-account').getBoundingClientRect();
  const menu = el('div', { class: 'popmenu', id: 'account-menu', style: `left:${r.right + 10}px; bottom:${window.innerHeight - r.bottom}px` },
    el('div', { class: 'pm-title' }, _('Konto wechseln')),
    ...store.profiles.map(p => {
      const st = status[p.id];
      return el('button', { class: 'pm-item' + (p.id === store.activeProfileId ? ' sel' : ''), onclick: () => { closeMenus(); switchProfile(p.id); } },
        el('span', { class: 'pm-av' }, avatar(p, 'sm'), el('span', { class: 'badge ' + (st ? (st.loggedIn ? 'on' : 'off') : '') })),
        el('span', { class: 'pm-text' }, el('b', {}, p.name), el('small', {}, stateText(st))),
        p.id === store.activeProfileId ? el('span', { class: 'pm-check' }, '✓') : null);
    }),
    el('div', { class: 'pm-sep' }),
    el('button', { class: 'pm-item', onclick: () => { closeMenus(); openAddProfile(); } }, el('span', { class: 'pm-ic' }, '+'), _('Konto hinzufügen')),
    el('button', { class: 'pm-item', onclick: () => { closeMenus(); openAccounts(); } }, el('span', { class: 'pm-ic' }, '⚙'), _('Konten verwalten')));
  document.body.append(menu);
}
function closeMenus() { document.querySelectorAll('.popmenu').forEach(x => x.remove()); }
document.addEventListener('mousedown', e => { if (!e.target.closest('.popmenu') && !e.target.closest('#btn-account') && !e.target.closest('#btn-add-project') && !e.target.closest('#ch-settings') && !e.target.closest('#bgbar')) closeMenus(); });

// Rechtsklick auf einen Chat: in Projekt verschieben / schließen
function openChatMenu(e, t) {
  e.preventDefault(); closeMenus();
  const items = [el('div', { class: 'pm-title' }, _('Verschieben nach'))];
  items.push(el('button', { class: 'pm-item' + (!t.projectId ? ' sel' : ''), onclick: () => { closeMenus(); moveChatToProject(t.id, 'all'); } },
    el('span', { class: 'pm-av' }, el('div', { class: 'avatar sm globe' }, icon(GLOBE))), _('Allgemein (ohne Projekt)')));
  for (const pr of store.projects || []) items.push(el('button', { class: 'pm-item' + (t.projectId === pr.id ? ' sel' : ''), onclick: () => { closeMenus(); moveChatToProject(t.id, pr.id); } },
    el('span', { class: 'pm-av' }, avatar(pr, 'sm')), pr.name));
  items.push(el('button', { class: 'pm-item', onclick: () => { closeMenus(); openProjectForm(); } }, el('span', { class: 'pm-ic' }, '+'), _('Neues Projekt …')));
  items.push(el('div', { class: 'pm-sep' }), el('button', { class: 'pm-item', onclick: () => { closeMenus(); openBeside(t.id); } }, el('span', { class: 'pm-ic' }, '◫'), _('Daneben öffnen')));
  items.push(el('button', { class: 'pm-item', onclick: async () => { closeMenus(); if (activeTabId !== t.id) await openTab(t.id); renameChat(); } }, el('span', { class: 'pm-ic' }, '✎'), _('Umbenennen …')));
  if (!t.host && t.sessionId && remoteState?.host?.devices.length) items.push(el('button', { class: 'pm-item', onclick: () => { closeMenus(); openShareChat(t); } }, el('span', { class: 'pm-ic' }, '🖥'), _('Für Gerät freigeben …')));
  items.push(el('button', { class: 'pm-item', onclick: () => { closeMenus(); pickChatIcon(t); } }, el('span', { class: 'pm-ic' }, '🖼'), _('Bild für den Chat wählen …')));
  if (chatIcon(t)) items.push(el('button', { class: 'pm-item', onclick: () => { closeMenus(); removeChatIcon(t); } }, el('span', { class: 'pm-ic' }, '⌫'), _('Bild entfernen')));
  items.push(el('button', { class: 'pm-item danger', onclick: () => { closeMenus(); closeTab(t.id); } }, el('span', { class: 'pm-ic' }, '×'), _('Chat schließen')));
  const menu = el('div', { class: 'popmenu', style: `left:${e.clientX}px; top:${e.clientY}px` }, ...items);
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - r.height - 8) + 'px';
}

// Statuszeile eines Kontos – unterscheidet „Claude Code fehlt“ von „nicht angemeldet“
function stateText(st, long = false) {
  if (!st) return _('wird geprüft …');
  if (st.claudeMissing) return _('Claude Code nicht gefunden');
  if (st.loggedIn) return [st.email, planLabel(st), long ? st.orgName : null].filter(Boolean).join(' · ');
  return _('Nicht angemeldet');
}
const badgeClass = st => 'badge ' + (st ? (st.loggedIn ? 'on' : 'off') : '');
function planLabel(st) {
  const map = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
  return st.subscriptionType ? (map[st.subscriptionType] || st.subscriptionType) : (st.authMethod === 'console' ? 'API' : '');
}

async function refreshStatus(id) {
  const ids = id ? [id] : store.profiles.map(p => p.id);
  await Promise.all(ids.map(async pid => { status[pid] = await api.profiles.status(pid); }));
  if (Object.values(status).some(s => s?.claudeMissing)) toast(_('Claude Code nicht gefunden – siehe Einstellungen'));
  renderRail();
  if ($('.modal.accounts')) renderAccountsList();
}

// Konto links wählen: wird aktives Konto UND der offene Chat schreibt ab jetzt über dieses Konto weiter
async function switchProfile(id) {
  store = await api.profiles.setActive(id);
  historyCache = {};
  const st = status[id];
  const t = currentTab();
  if (t && !t.host && t.profileId !== id) {
    // Übertragung abgelehnt -> aktives Konto bleibt das des Chats
    if ((await moveTabToProfile(t, id)) === false) store = await api.profiles.setActive(t.profileId);
  } else if (st && !st.loggedIn) toast(st.claudeMissing ? _('Claude Code nicht gefunden') : _('„{name}“ ist nicht angemeldet', { name: profile(id).name }));
  else toast(_('Konto: {name}', { name: profile(id).name }));
  renderRail(); renderList(); renderUsage();
}

// Chat auf ein anderes Konto umziehen (Verlauf wird mitgenommen und mit --resume fortgesetzt)
async function moveTabToProfile(t, to) {
  if (t.profileId === to) return;
  if (t.mirror || (t.host && t.sessionId)) { toast(_('Bei Chats eines Haupt-PCs lässt sich das Konto nur vor der ersten Nachricht wechseln')); return false; }
  if (t.running) {
    t.pendingProfile = to;
    toast(_('Wechsel zu „{name}“ nach dieser Antwort', { name: profile(to).name }));
    rerenderTab(t);
    return;
  }
  t.pendingProfile = null;
  if (t.sessionId) {
    // Der Hauptprozess fragt vorher nach (Verlauf inkl. Dateiinhalten wird kopiert)
    const r = await api.session.moveProfile({ sessionId: t.sessionId, cwd: t.cwd, fromProfileId: t.profileId, toProfileId: to });
    if (r?.cancelled) { toast(_('Übertragung abgebrochen – der Chat bleibt im bisherigen Konto')); rerenderTab(t); return false; }
    if (!r?.ok) { toast(_('Verlauf konnte nicht übernommen werden – der Chat startet neu')); t.sessionId = null; }
  }
  const st = status[pkey(t.host, to)];
  await changeTab({ profileId: to }, _('Weiter mit Konto „{name}“', { name: hostProfiles(t.host).find(p => p.id === to)?.name || '?' }) + (st?.email ? ' (' + st.email + ')' : '') + (st && !st.loggedIn ? ' – ' + _('nicht angemeldet!') : ''), t);
}

// ---------- Modelle & Aufwand ----------
const modelInfo = {}; // profileId -> { models, effortLevel, ... }
const EFFORT_LABEL = { low: N_('Niedrig'), medium: N_('Mittel'), high: N_('Hoch'), xhigh: N_('Sehr hoch'), max: N_('Maximum') };
const effortName = l => (EFFORT_LABEL[l] ? _(EFFORT_LABEL[l]) : l);
async function loadModels(pid, refresh = false, host = null) {
  const k = pkey(host, pid);
  if (modelInfo[k] && !refresh) return modelInfo[k];
  const info = await tapi(host).profiles.models(pid, refresh);
  if (info?.models?.length) modelInfo[k] = info; // leere Antwort nicht merken
  return info;
}
function modelEntry(pid, value) {
  const list = modelInfo[pid]?.models || [];
  return list.find(m => m.value === (value || 'default'));
}
const shortModel = m => (m?.description?.split('·')[0] || m?.displayName || '').trim();
function defaultModelName(pid) {
  const d = modelEntry(pid, 'default');
  const settingsModel = modelInfo[pid]?.settingsModel;
  if (settingsModel) return modelEntry(pid, settingsModel)?.displayName || settingsModel;
  return d ? shortModel(d) : '';
}
function effortLevelsFor(pid, model) {
  const m = modelEntry(pid, model);
  if (!m) return ['low', 'medium', 'high', 'xhigh', 'max'];
  return m.supportsEffort ? (m.supportedEffortLevels || []) : [];
}
// ---------- Chat-Einstellungen: ein Knopf oben rechts, Menü wie beim Konto ----------
const MODES = [
  { value: 'default', label: N_('Nachfragen'), desc: N_('Claude fragt vor Befehlen und Änderungen') },
  { value: 'acceptEdits', label: N_('Änderungen erlauben'), desc: N_('Dateien ändern ohne Rückfrage, Befehle mit') },
  { value: 'plan', label: N_('Nur planen'), desc: N_('Claude liest und plant, ändert nichts') },
  { value: 'bypassPermissions', label: N_('⚠ Alles erlauben'), desc: N_('keine Rückfragen (--dangerously-skip-permissions)') },
];
function modelLabel(t) {
  if (!t.model) return defaultModelName(tk(t)) || _('Standard');
  return modelEntry(tk(t), t.model)?.displayName || t.model;
}
function effortLabel(t) {
  if (!effortLevelsFor(tk(t), t.model).length) return '';
  if (t.effort) return effortName(t.effort);
  const d = modelInfo[tk(t)]?.effortLevel;
  return d ? effortName(d) : 'Auto';
}
function renderChatChip(t) {
  const p = profileOf(t);
  const bypass = t.permissionMode === 'bypassPermissions';
  const eff = effortLabel(t);
  const chip = $('#ch-settings');
  chip.classList.toggle('risk', bypass);
  chip.replaceChildren(
    avatar(p, 'sm'),
    el('span', { class: 'cc-text' },
      el('b', {}, p?.name || '?'), el('span', { class: 'cc-sep' }, '·'), modelLabel(t),
      eff ? [el('span', { class: 'cc-sep' }, '·'), eff] : null,
      bypass ? [el('span', { class: 'cc-sep' }, '·'), el('span', { class: 'cc-warn' }, _('⚠ Alles erlaubt'))] : null),
    icon('<path d="m6 9 6 6 6-6"/>'));
  const mode = MODES.find(m => m.value === (t.permissionMode || 'default'));
  const email = status[tk(t)]?.email;
  const std = ' (' + _('Standard') + ')';
  chip.title = [
    _('Konto: {name}', { name: p?.name || '?' }) + (email ? ' (' + email + ')' : ''),
    _('Modell: {m}', { m: modelLabel(t) }) + (t.model ? '' : std),
    _('Aufwand: {e}', { e: eff || '–' }) + (t.effort ? '' : std),
    _('Berechtigungen: {m}', { m: mode ? _(mode.label) : '' }),
  ].join('\n');
}

let showAllModels = false;
function openChatSettingsMenu() {
  const t = currentTab(); if (!t) return;
  closeMenus();
  const chip = $('#ch-settings');
  const r = chip.getBoundingClientRect();
  const done = () => closeMenus();
  const check = on => (on ? el('span', { class: 'pm-check' }, '✓') : null);

  // Konto
  const items = [el('div', { class: 'pm-title' }, _('Konto für diesen Chat'))];
  for (const p of hostProfiles(t.host)) {
    const st = status[pkey(t.host, p.id)];
    items.push(el('button', { class: 'pm-item' + (p.id === t.profileId ? ' sel' : ''), onclick: async () => {
      done();
      await moveTabToProfile(t, p.id);
      if (!t.host) store = await api.profiles.setActive(t.profileId);
      renderRail(); renderList(); renderUsage();
    } },
      el('span', { class: 'pm-av' }, avatar(p, 'sm'), el('span', { class: 'badge ' + (st ? (st.loggedIn ? 'on' : 'off') : '') })),
      el('span', { class: 'pm-text' }, el('b', {}, p.name), el('small', {}, stateText(st))),
      check(p.id === t.profileId)));
  }

  // Modell (die wichtigsten zuerst, ältere hinter "Weitere")
  items.push(el('div', { class: 'pm-sep' }), el('div', { class: 'pm-title' }, _('Modell')));
  const list = (modelInfo[tk(t)]?.models || []).filter(m => m.value !== 'default');
  const def = modelEntry(tk(t), 'default');
  const setModel = (value, label) => {
    done();
    const patch = { model: value };
    if (t.effort && !effortLevelsFor(tk(t), value).includes(t.effort)) patch.effort = '';
    changeTab(patch, _('Modell: {m}', { m: label }));
  };
  items.push(el('button', { class: 'pm-item' + (!t.model ? ' sel' : ''), onclick: () => setModel('', _('Standard') + ' · ' + (defaultModelName(tk(t)) || '')) },
    el('span', { class: 'pm-text' }, el('b', {}, _('Standard') + ' · ' + (defaultModelName(tk(t)) || _('laut Konto'))), el('small', {}, def?.description || _('Empfehlung von Claude für dieses Konto'))),
    check(!t.model)));
  const main = list.slice(0, 4), more = list.slice(4);
  const modelItem = m => el('button', { class: 'pm-item' + (t.model === m.value ? ' sel' : ''), onclick: () => setModel(m.value, m.displayName) },
    el('span', { class: 'pm-text' }, el('b', {}, m.displayName), m.description ? el('small', {}, m.description) : null), check(t.model === m.value));
  main.forEach(m => items.push(modelItem(m)));
  if (more.length) {
    if (showAllModels || more.some(m => m.value === t.model)) more.forEach(m => items.push(modelItem(m)));
    else items.push(el('button', { class: 'pm-more', onclick: e => { e.stopPropagation(); showAllModels = true; openChatSettingsMenu(); } }, _('Weitere Modelle ({n}) …', { n: more.length })));
  }
  if (!list.length) items.push(el('div', { class: 'pm-note' }, _('Modelle werden geladen …')));

  // Aufwand als Segment-Leiste
  const levels = effortLevelsFor(tk(t), t.model);
  const defEff = modelInfo[tk(t)]?.effortLevel;
  const defEffName = defEff ? effortName(defEff) : _('automatisch');
  items.push(el('div', { class: 'pm-sep' }), el('div', { class: 'pm-title' }, _('Aufwand')));
  if (levels.length) {
    const seg = el('div', { class: 'pm-seg' },
      el('button', { class: !t.effort ? 'sel' : '', title: _('Standard: {e}', { e: defEffName }), onclick: () => { done(); changeTab({ effort: '' }, _('Aufwand: Standard ({e})', { e: defEffName })); } }, _('Standard')),
      ...levels.map(l => el('button', { class: t.effort === l ? 'sel' : '', onclick: () => { done(); changeTab({ effort: l }, _('Aufwand: {e}', { e: effortName(l) })); } }, effortName(l))));
    items.push(seg, el('div', { class: 'pm-note' }, _('Standard für dieses Konto: {e}', { e: defEff ? effortName(defEff) : _('automatisch (Claude entscheidet)') })));
  } else items.push(el('div', { class: 'pm-note' }, _('Dieses Modell hat keine Aufwandsstufen.')));

  // Berechtigungen
  items.push(el('div', { class: 'pm-sep' }), el('div', { class: 'pm-title' }, _('Berechtigungen')));
  for (const m of MODES) {
    const on = (t.permissionMode || 'default') === m.value;
    items.push(el('button', { class: 'pm-item' + (on ? ' sel' : '') + (m.value === 'bypassPermissions' ? ' risk' : ''), onclick: async () => {
      done();
      if (on) return;
      // Warnung und Bestätigung kommen als nativer Dialog aus dem Hauptprozess
      if (m.value === 'bypassPermissions' && !(await tapi(t).session.confirmBypass(t.id))) return;
      changeTab({ permissionMode: m.value }, m.value === 'bypassPermissions' ? _('⚠ Alles erlauben: keine Rückfragen mehr (--dangerously-skip-permissions)') : _('Berechtigungen: {m}', { m: _(m.label) }));
    } }, el('span', { class: 'pm-text' }, el('b', {}, _(m.label)), el('small', {}, _(m.desc))), check(on)));
  }

  // Sonstiges
  if (!t.host) items.push(el('div', { class: 'pm-sep' }),
    el('button', { class: 'pm-item', onclick: () => { done(); api.profiles.openTerminal(t.profileId, t.cwd); } }, el('span', { class: 'pm-ic' }, '›_'), _('Im Terminal öffnen')),
    t.cwd ? el('button', { class: 'pm-item', onclick: () => { done(); api.openPath(t.cwd); } }, el('span', { class: 'pm-ic' }, '📁'), _('Ordner im Explorer öffnen')) : null);

  const menu = el('div', { class: 'popmenu chat-menu', id: 'chat-menu', style: `top:${r.bottom + 8}px; right:${Math.max(8, window.innerWidth - r.right)}px` }, ...items);
  document.body.append(menu);
  chip.classList.add('open');
  new MutationObserver((_, obs) => { if (!document.body.contains(menu)) { chip.classList.remove('open'); obs.disconnect(); } }).observe(document.body, { childList: true });
}

// ---------- Seitenleiste ----------
let searchState = { key: '', loading: false, results: [] };
// Suchbegriff im Ausschnitt hervorheben (als Text-Knoten, kein HTML)
function highlight(text, q) {
  const out = el('span');
  const lower = (text || '').toLowerCase();
  let i = 0, j;
  while ((j = lower.indexOf(q, i)) >= 0) { out.append(text.slice(i, j), el('mark', {}, text.slice(j, j + q.length))); i = j + q.length; }
  out.append(text.slice(i));
  return out;
}
let publishTimer = null, lastPublished = '';
function publishTabs() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    const list = tabs.filter(t => !t.host).map(t => ({ id: t.id, title: t.title, profileId: t.profileId, cwd: t.cwd, sessionId: t.sessionId, model: t.model, effort: t.effort, permissionMode: t.permissionMode, running: !!(t.running || bgRunning(t)), updated: t.updated, preview: t.preview }));
    const json = JSON.stringify(list);
    if (json === lastPublished) return;
    lastPublished = json;
    api.remote.publishTabs(list);
  }, 400);
}
let searchTimer = null;
function renderList() {
  publishTabs();
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#list');
  const match = (...s) => !q || s.some(x => (x || '').toLowerCase().includes(q));
  let nodes = [];

  if (view === 'chats') {
    const pid = activeProjectId();
    // Suche: Titel, Ordner, Vorschau und der Text der Nachrichten offener Chats
    const inMessages = t => q && t.items.some(it => (it.kind === 'me' || it.kind === 'ai') && (it.text || '').toLowerCase().includes(q));
    const items = tabs.filter(t => tabInProject(t, pid) && (match(t.title, t.cwd, t.preview) || inMessages(t))).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    nodes = items.map(t => {
      const p = profileOf(t);
      const pr = pid === 'all' ? project(t.projectId) : null;
      const av = chatAvatar(t);
      return el('div', { class: 'item' + (t.id === activeTabId ? ' active' : shownInPane(t.id) ? ' active-other' : ''), onclick: () => openTab(t.id),
        oncontextmenu: e => openChatMenu(e, t), draggable: 'true', ondragstart: e => e.dataTransfer.setData('text/chat', t.id),
        title: _('Konto: {name}', { name: p?.name || '?' }) + (pr ? '\n' + _('Projekt: {name}', { name: pr.name }) : '') + '\n' + _('Rechtsklick oder auf ein Projekt ziehen zum Verschieben') },
        av,
        el('div', { class: 'meta' },
          el('div', { class: 'row1' }, el('span', { class: 'title' }, t.title || _('Neuer Chat')), el('span', { class: 'time' }, fmtTime(t.updated))),
          el('div', { class: 'sub' }, t.host ? el('span', { class: 'host-tag' }, '🖥 ' + hostName(t.host) + ' · ') : '', t.preview || baseName(t.cwd))),
        t.running ? el('span', { class: 'busy', title: _('arbeitet …') }) : bgRunning(t) ? el('span', { class: 'busy bg', title: _('Hintergrund-Aufgabe läuft …') }) : t.unread ? el('span', { class: 'unread' }) : null,
        el('button', { class: 'close', title: _('Chat schließen'), onclick: e => { e.stopPropagation(); closeTab(t.id); } }, icon(ICONS.x)));
    });
    if (!nodes.length) nodes = [el('div', { class: 'list-empty' }, q ? _('Keine Treffer in offenen Chats.') : pid === 'all' ? _('Noch keine Chats. Klicke auf + für einen neuen Chat.') : _('Noch keine Chats in diesem Projekt. Klicke auf + oder ziehe einen Chat auf das Projekt links.'))];
    if (q.length >= 2) nodes.push(el('button', { class: 'search-all', onclick: () => { view = 'history'; setSeg(); renderList(); } }, '🔎 ' + _('„{q}“ in allen Sitzungen suchen', { q })));
  }

  if (view === 'favorites') {
    nodes = store.favorites.filter(f => match(f.name, f.path)).map(f =>
      el('div', { class: 'item', onclick: () => newChat(f.path), title: _('Neuen Chat in diesem Ordner starten') },
        el('div', { class: 'folder-ic' }, icon(ICONS.folder)),
        el('div', { class: 'meta' }, el('div', { class: 'title' }, f.name), el('div', { class: 'sub mono' }, f.path)),
        el('button', { class: 'close', title: _('Favorit entfernen'), onclick: async e => { e.stopPropagation(); store = await api.favorites.remove(f.path); renderList(); } }, icon(ICONS.x))));
    nodes.push(el('div', { style: 'padding:10px' }, el('button', { class: 'ghost', style: 'width:100%', onclick: async () => { store = await api.favorites.add(); renderList(); } }, _('+ Ordner hinzufügen'))));
  }

  if (view === 'history') {
    const hv = hostOfView(activeProjectId());
    const pid = hv ? 'host:' + hv : store.activeProfileId; // Cache-Schlüssel; beim Haupt-PC: Verlauf aller freigegebenen Konten
    const pr = project(activeProjectId());
    const inProject = h => (hv ? inHostProject(hv, h.cwd) : !pr?.cwd || (h.cwd || '').toLowerCase().startsWith(pr.cwd.toLowerCase()));
    // Volltextsuche (ab 2 Zeichen): durchsucht die Nachrichten aller Sitzungen des Kontos im Hauptprozess
    if (q.length >= 2) {
      const key = pid + '|' + q;
      if (searchState.key !== key) {
        searchState = { key, loading: true, results: [] };
        const s0 = searchState;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => { const r = hv ? await hostHistory(hv, 'search', q) : await api.history.search(pid, q); if (searchState === s0) { s0.results = r; s0.loading = false; if (view === 'history') renderList(); } }, 250);
      }
      if (searchState.loading) { list.replaceChildren(el('div', { class: 'list-empty' }, _('Durchsuche alle Sitzungen …'))); return; }
      const hits = searchState.results.filter(inProject);
      nodes = hits.map(h => el('div', { class: 'item search-hit', onclick: () => resumeFromHistory(h), title: h.cwd },
        el('div', { class: 'folder-ic' }, icon(ICONS.clock)),
        el('div', { class: 'meta' },
          el('div', { class: 'row1' }, el('span', { class: 'title' }, h.title), el('span', { class: 'time' }, fmtTime(h.when || h.mtime))),
          el('div', { class: 'snippet' }, highlight(h.snippet, q)),
          el('div', { class: 'sub mono' }, (h.hits === 1 ? _('1 Treffer') : _('{n} Treffer', { n: h.hits })) + ' · ' + baseName(h.cwd)))));
      if (!nodes.length) nodes = [el('div', { class: 'list-empty' }, _('Keine Nachricht mit „{q}“ gefunden.', { q }))];
      list.replaceChildren(...nodes);
      renderRail();
      return;
    }
    if (!historyCache[pid]) {
      list.replaceChildren(el('div', { class: 'list-empty' }, _('Verlauf wird geladen …')));
      (hv ? hostHistory(hv, 'list') : api.history.list(pid)).then(h => { historyCache[pid] = h; if (view === 'history') renderList(); });
      return;
    }
    const items = historyCache[pid].filter(h => inProject(h) && match(h.title, h.cwd));
    let lastGroup = '';
    for (const h of items) {
      const g = groupLabel(h.mtime);
      if (g !== lastGroup) { nodes.push(el('div', { class: 'list-section' }, g)); lastGroup = g; }
      nodes.push(el('div', { class: 'item', onclick: () => resumeFromHistory(h), title: h.cwd },
        el('div', { class: 'folder-ic' }, icon(ICONS.clock)),
        el('div', { class: 'meta' },
          el('div', { class: 'row1' }, el('span', { class: 'title' }, h.title), el('span', { class: 'time' }, fmtTime(h.mtime))),
          el('div', { class: 'sub mono' }, isLive(h) ? el('span', { class: 'live' }, '● ' + _('läuft gerade') + ' · ') : '', baseName(h.cwd)))));
    }
    if (!items.length) nodes = [el('div', { class: 'list-empty' }, q ? _('Keine Treffer.') : _('Für dieses Konto gibt es noch keinen Verlauf.'))];
  }
  list.replaceChildren(...nodes);
  renderRail();
}
// Verlauf eines Haupt-PCs: alle freigegebenen Konten zusammen, neueste zuerst
async function hostHistory(host, kind, q) {
  if (!hostConnected(host) || !hostStores[host]) return [];
  const lists = await Promise.all(hostStores[host].profiles.map(async p =>
    (await (kind === 'search' ? tapi(host).history.search(p.id, q) : tapi(host).history.list(p.id))).map(h => ({ ...h, host, profileId: p.id }))));
  return lists.flat().sort((a, b) => (b.when || b.mtime) - (a.when || a.mtime));
}
// Sitzung wurde in den letzten 2 Minuten geschrieben und ist in der App nicht offen -> läuft vermutlich im Terminal
const isLive = h => Date.now() - h.mtime < 120000 && !tabs.some(t => t.sessionId === h.sessionId && t.running);
function groupLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return _('Heute');
  const days = Math.floor((now - d) / 864e5);
  if (days < 7) return _('Diese Woche');
  if (days < 31) return _('Diesen Monat');
  return d.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
}

// Nutzung: Limits aus rate_limit_event + Kosten aus result
function renderUsage() {
  const box = $('#usage');
  const p = activeProfile();
  const u = store.usage?.[p.id] || {};
  const lim = u.limits;
  const rows = [];
  const bar = (label, util, resets) => {
    const pct = Math.round((util || 0) * 100);
    const cls = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : '';
    rows.push(el('div', { class: 'u-row' }, el('span', { class: 'u-label' }, label),
      el('span', { class: 'u-val', title: resets ? _('Zurückgesetzt: {t}', { t: new Date(resets * 1000).toLocaleString(locale()) }) : '' },
        _('{n} %', { n: pct }) + (resets ? ' · ' + resetIn(resets) : ''))));
    rows.push(el('div', { class: 'bar' }, el('i', { class: cls, style: `width:${Math.min(100, pct)}%` })));
  };
  const w = lim?.unifiedWindows;
  if (w?.five_hour) bar(_('5-Stunden-Limit'), w.five_hour.utilization, w.five_hour.resetsAt);
  if (w?.seven_day) bar(_('Wochenlimit'), w.seven_day.utilization, w.seven_day.resetsAt);
  if (!w) rows.push(el('div', { class: 'u-row' }, el('span', { class: 'u-label' }, _('Limits')), el('span', { class: 'u-val muted' }, _('nach der ersten Nachricht'))));
  const today = u.days?.[new Date().toISOString().slice(0, 10)] || 0;
  rows.push(el('div', { class: 'u-row', title: _('Geschätzter API-Gegenwert laut Claude Code. Bei Abos zahlst du das nicht zusätzlich.') },
    el('span', { class: 'u-label' }, _('Gegenwert heute / gesamt')),
    el('span', { class: 'u-val' }, `$${today.toFixed(2)} / $${(u.costUsd || 0).toFixed(2)}`)));
  rows.push(el('div', { class: 'brand' }, el('span', {}, `Swapline ${VERSION} · by`), el('img', { src: BRAND.logo(isDark()), alt: 'ARFEP' })));
  box.replaceChildren(...rows);
}
function resetIn(sec) {
  const m = Math.max(0, Math.round((sec * 1000 - Date.now()) / 60000));
  if (m < 60) return _('in {m} Min', { m });
  const h = Math.floor(m / 60);
  return h < 48 ? _('in {h} Std {m} Min', { h, m: m % 60 }) : _('in {d} T', { d: Math.round(h / 24) });
}

// ---------- Chats ----------
function makeTab(o) {
  return {
    id: uid(), title: '', profileId: store.activeProfileId, projectId: project(activeProjectId()) ? activeProjectId() : null, cwd: '', sessionId: null,
    model: store.settings.model || '', effort: store.settings.effort || '', permissionMode: store.settings.permissionMode || 'default',
    items: [], running: false, unread: false, updated: Date.now(), preview: '', loaded: true, ...o,
  };
}

async function newChat(cwd) {
  const host = cwd === undefined ? hostOfView(activeProjectId()) : null;
  if (host) {
    const hs = hostStores[host];
    if (!hostConnected(host) || !hs) return toast(_('Haupt-PC „{name}“ ist nicht verbunden', { name: hostName(host) }));
    if (!hs.scope.newChats) return toast(_('Neue Chats sind für dieses Gerät nicht freigegeben – nur die geteilten Chats im Verlauf.'));
  }
  let profileId = host ? hostStores[host].activeProfileId || hostStores[host].profiles[0]?.id : store.activeProfileId;
  if (cwd === undefined) { const picked = await pickFolderModal(host); if (picked === null) return; ({ cwd, profileId } = picked); }
  const t = makeTab(host ? { cwd, profileId, host, projectId: null, hostProjectId: hostProjectFilter[host] || null, model: hostStores[host].settings.model, effort: hostStores[host].settings.effort, permissionMode: hostStores[host].settings.permissionMode } : { cwd, profileId });
  tabs.push(t);
  view = 'chats'; setSeg();
  openTab(t.id);
  saveTabs();
}

async function resumeFromHistory(h) {
  const existing = tabs.find(t => t.sessionId === h.sessionId && (t.host || null) === (h.host || null));
  if (existing) { view = 'chats'; setSeg(); return openTab(existing.id); }
  const t = makeTab({ title: h.title, cwd: h.cwd, sessionId: h.sessionId, updated: h.mtime, loaded: false, ...(h.host ? { host: h.host, profileId: h.profileId, projectId: null } : {}) });
  if (isLive(h)) t.items.push({ kind: 'sys', error: true, text: _('Achtung: Diese Sitzung wird gerade woanders benutzt (z. B. im Terminal).\nBitte dort zuerst beenden, bevor du hier weiterschreibst – sonst arbeiten zwei Claude-Prozesse gleichzeitig an derselben Sitzung.') });
  tabs.push(t);
  view = 'chats'; setSeg();
  openTab(t.id);
  saveTabs();
}

function closeTab(id) {
  const t = tabs.find(x => x.id === id);
  if (t?.running && !t.mirror && !confirm(_('Claude arbeitet noch in diesem Chat. Trotzdem schließen?'))) return;
  tapi(t).session.close(id);
  if (t?.mirror) dismissedMirrors.add(t.host + '|' + t.hostTab);
  tabs = tabs.filter(x => x.id !== id);
  if (activeTabId === id) activeTabId = null;
  panes.forEach((p, j) => { if (j !== focusedPane && p.tabId === id) { p.tabId = null; withPane(p, renderChat); } });
  saveTabs(); renderList(); renderChat();
}

const HISTORY_TURNS = 3, OLDER_TURNS = 5;
// Ältere Nachrichten eines Haupt-PC-Chats vor die angezeigten setzen; die Ansicht bleibt an derselben Stelle
async function loadOlder(t) {
  if (t.olderFrom == null || t.loadingOlder) return;
  t.loadingOlder = true; renderMessages(null);
  const r = await tapi(t).history.loadSession({ profileId: t.profileId, sessionId: t.sessionId, cwd: t.cwd, turns: OLDER_TURNS, before: t.olderFrom }).catch(() => null);
  t.loadingOlder = false;
  if (!r || !Array.isArray(r.msgs)) { toast(_('Ältere Nachrichten konnten nicht geladen werden')); renderMessages(null); return; }
  const box = $('#messages'), fromBottom = box.scrollHeight - box.scrollTop;
  const shown = t.items; t.items = [];
  for (const m of r.msgs) ingest(t, m, true);
  t.items.push(...shown);
  t.olderFrom = r.start > 0 ? r.start : null;
  if (t.id === activeTabId) renderMessages(fromBottom);
}

async function openTab(id) {
  const other = panes.findIndex((p, j) => j !== focusedPane && p.tabId === id);
  if (other >= 0) { focusPane(other); return; }
  activeTabId = id;
  const t = currentTab();
  if (t) { lastOpened.all = t.id; if (t.projectId) lastOpened[t.projectId] = t.id; }
  if (t) {
    t.unread = false;
    await attachMirror(t);
    if (!t.loaded && (!t.host || hostConnected(t.host))) {
      t.loaded = true;
      // Chats eines Haupt-PCs: nur die letzten Nachrichten, ältere über „Ältere Nachrichten laden“ (über Fernzugriff
      // dauerte der ganze Verlauf großer Chats sonst Minuten)
      const r = await tapi(t).history.loadSession({ profileId: t.profileId, sessionId: t.sessionId, cwd: t.cwd, ...(t.host ? { turns: HISTORY_TURNS } : {}) });
      const msgs = Array.isArray(r) ? r : Array.isArray(r?.msgs) ? r.msgs : [];
      t.olderFrom = !Array.isArray(r) && r?.start > 0 ? r.start : null;
      const live = t.items; t.items = [];
      for (const m of msgs) ingest(t, m, true);
      if (msgs.length) t.items.push({ kind: 'sys', text: _('Bisheriger Verlauf – ab hier geht es weiter') });
      t.items.push(...live);
    }
  }
  // Die Kontoleiste zeigt immer das Konto des offenen Chats
  if (t && !t.host && t.profileId !== store.activeProfileId && profileOf(t)) {
    store = await api.profiles.setActive(t.profileId);
    historyCache = {};
    renderRail(); renderUsage();
  }
  saveTabs(); renderList(); renderChat();
  $('#input').focus({ preventScroll: true });
}

function setSeg() { document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('active', b.dataset.view === view)); }

// ---------- Chatfenster ----------
function renderChat() {
  const t = currentTab();
  $('#empty').hidden = !!t;
  $('#chat-view').hidden = !t;
  $('#bgbar').hidden = true;
  if (!t) return;
  renderBgBar(t);
  const p = profileOf(t);
  const chAv = chatAvatar(t); chAv.id = 'ch-avatar'; chAv.dataset.pid = 'ch-avatar';
  $('#ch-avatar').replaceWith(chAv);
  $('#ch-title').textContent = t.title || _('Neuer Chat');
  $('#ch-cwd').textContent = t.cwd || _('~ (Benutzerordner)');
  $('#ch-cwd').title = t.cwd ? _('Ordner im Explorer öffnen') : '';
  renderChatChip(t);
  if (!modelInfo[tk(t)] && (!t.host || hostConnected(t.host))) loadModels(t.profileId, false, t.host).then(() => { if (currentTab() === t) renderChatChip(t); });
  renderMessages();
  updateComposer();
}

function updateComposer() {
  const t = currentTab(); if (!t) return;
  $('#btn-stop').hidden = !t.running;
}

// Werkzeug-Aufrufe im Chat: alle zeigen, kompakt (aufeinanderfolgende Aufrufe als eine aufklappbare Zeile)
// oder ausblenden. Rückfragen, Fragen und Fehlermeldungen sind keine Werkzeug-Aufrufe und bleiben immer sichtbar.
const toolView = () => store.settings.toolView || 'all';
function makeToolGroup() {
  return el('details', { class: 'tool-group' },
    el('summary', {}, el('span', { class: 'tg-state' }), el('span', { class: 'tg-count' }), el('span', { class: 'tg-names' })),
    el('div', { class: 'tg-body' }));
}
function updateToolGroup(g) {
  if (!g) return;
  const tools = [...g.querySelectorAll('.tg-body > .tool')];
  const names = [...new Set(tools.map(x => x.dataset.label))];
  const running = tools.some(x => x.querySelector('.t-state.run')), failed = tools.some(x => x.querySelector('.t-state.err'));
  g.querySelector('.tg-state').className = 'tg-state ' + (running ? 'run' : failed ? 'err' : 'ok');
  g.querySelector('.tg-state').textContent = running ? '' : failed ? '✕' : '⚙';
  g.querySelector('.tg-count').textContent = tools.length === 1 ? _('1 Schritt') : _('{n} Schritte', { n: tools.length });
  g.querySelector('.tg-names').textContent = names.slice(0, 4).join(', ') + (names.length > 4 ? ' …' : '');
}
// Element eines Werkzeug-Aufrufs vor `anchor` einsetzen – im Kompaktmodus in die laufende Gruppe
function placeTool(el0, anchor, parent) {
  const prev = anchor ? anchor.previousElementSibling : parent.lastElementChild;
  let g = prev?.classList.contains('tool-group') ? prev : null;
  if (!g) { g = makeToolGroup(); anchor ? anchor.before(g) : parent.append(g); }
  g.querySelector('.tg-body').append(el0);
  updateToolGroup(g);
}
// keepFromBottom: Abstand zum Ende beibehalten (nach dem Nachladen älterer Nachrichten), null = Stelle nicht ändern
function renderMessages(keepFromBottom) {
  const t = currentTab(); if (!t) return;
  const box = $('#messages');
  const keepTop = keepFromBottom === null ? box.scrollTop : null;
  const wrap = el('div', { class: 'msg-wrap' });
  if (t.olderFrom != null) wrap.append(el('div', { class: 'older' }, el('button', { class: 'ghost', disabled: !!t.loadingOlder, onclick: () => loadOlder(t) },
    t.loadingOlder ? _('Lade …') : '↑ ' + _('Ältere Nachrichten laden'))));
  const mode = toolView();
  for (const it of t.items) {
    if (it.kind === 'tool' && mode === 'hidden') { it.el = null; continue; }
    it.el = renderItem(t, it);
    if (!it.el) continue;
    if (it.kind === 'tool' && mode === 'compact') placeTool(it.el, null, wrap); else wrap.append(it.el);
  }
  t.typingEl = el('div', { class: 'typing', hidden: !(t.running && !t.streamItem) }, el('i'), el('i'), el('i'));
  wrap.append(t.typingEl);
  box.replaceChildren(wrap);
  if (keepTop != null) { box.scrollTop = keepTop; return; }
  if (typeof keepFromBottom === 'number') { const set = () => (box.scrollTop = box.scrollHeight - keepFromBottom); set(); requestAnimationFrame(set); return; }
  // nach dem Layout (Schriften, Markdown) noch einmal ganz nach unten
  box.scrollTop = box.scrollHeight;
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; setTimeout(() => (box.scrollTop = box.scrollHeight), 120); });
}

function appendItem(t, it) {
  t.items.push(it);
  if (t.id !== activeTabId) { const p = paneOf(t); if (p) withPane(p, () => appendItem(t, it)); return; }
  const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  if (it.kind === 'tool' && toolView() === 'hidden') { it.el = null; return; }
  it.el = renderItem(t, it);
  if (it.el && it.kind === 'tool' && toolView() === 'compact') placeTool(it.el, t.typingEl);
  else if (it.el) { it.el.classList.add('enter'); t.typingEl.before(it.el); }
  if (nearBottom || it.kind === 'me' || it.kind === 'perm' || it.kind === 'question') box.scrollTop = box.scrollHeight;
}
function refreshItem(t, it) {
  if (t.id !== activeTabId) { const p = paneOf(t); if (p) withPane(p, () => refreshItem(t, it)); return; }
  if (!it.el) return;
  const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  if (it.kind === 'ai') updateAiBubble(it); // Blase bleibt stehen, nur der Inhalt wechselt
  else { const n = renderItem(t, it); it.el.replaceWith(n); it.el = n; updateToolGroup(n.closest('.tool-group')); }
  if (nearBottom) box.scrollTop = box.scrollHeight;
}
// Während des Schreibens: offene Codeblöcke vorläufig schließen, damit das Layout nicht springt
function streamingMarkdown(text) {
  const fences = (text.match(/^\s*(```|~~~)/gm) || []).length;
  return fences % 2 ? text + '\n```' : text;
}
function updateAiBubble(it) {
  const b = it.el?.querySelector('.bubble');
  if (!b) return;
  b.innerHTML = md(it.streaming ? streamingMarkdown(it.text) : it.text);
  b.classList.toggle('streaming', !!it.streaming);
  if (!it.streaming) { enhanceCode(b); const t = tabs.find(x => x.items.includes(it)); if (t) hydrateImages(t, b); }
}
// Bilder in Antworten: Dateien (absolut oder relativ zum Ordner des Chats) gleich laden, Internet-Bilder erst auf Klick
// (sonst erfährt eine fremde Seite, wann der Chat geöffnet wird). Geladen wird immer über den Haupt-PC (geprüft).
const imageCache = new Map();
function hydrateImages(t, root) {
  for (const img of root.querySelectorAll('img[data-src]')) {
    // marked kodiert Pfade (z. B. \ → %5C, Leerzeichen → %20) – für die Prüfung im Hauptprozess zurückwandeln
    let src = img.dataset.src; if (/%[0-9a-f]{2}/i.test(src)) try { src = decodeURI(src); } catch {}
    const alt = img.getAttribute('alt') || '';
    const key = (t.host || '') + '|' + (t.cwd || '') + '|' + src;
    const show = url => { img.src = url; img.classList.add('md-img'); img.onclick = () => showImage(url, alt); };
    const fail = why => img.replaceWith(el('span', { class: 'img-missing' }, '🖼 ' + (alt || src.split(/[\\/]/).pop()) + ' – ' + why));
    const load = async web => {
      const r = await (web ? tapi(t).images.web(src) : tapi(t).images.file(t.cwd || '', src)).catch(() => null);
      if (!r?.data || !IMG_TYPES.includes(r.media)) return fail(r?.error ? _('nicht anzeigbar ({e})', { e: r.error }) : _('nicht anzeigbar'));
      const url = `data:${r.media};base64,${r.data}`;
      imageCache.set(key, url); if (imageCache.size > 60) imageCache.delete(imageCache.keys().next().value);
      show(url);
    };
    if (imageCache.has(key)) { show(imageCache.get(key)); continue; }
    if (/^https:\/\//i.test(src)) {
      let host = ''; try { host = new URL(src).hostname; } catch {}
      const btn = el('button', { class: 'ghost img-load', title: src }, '🖼 ' + _('Bild von {host} laden', { host }));
      btn.onclick = () => { btn.replaceWith(img); load(true); };
      img.replaceWith(btn);
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src) && !/^file:/i.test(src)) img.remove(); // http:, ftp: … nie
    else load(false);
  }
}
// Bild groß anzeigen
function showImage(url, alt) {
  modal('image-view', alt || _('Bild'), el('img', { src: url, alt: alt || '' }));
}
function setTyping(t) {
  if (t.typingEl && shownInPane(t.id)) t.typingEl.hidden = !(t.running && !t.streamItem);
}

function renderItem(t, it) {
  switch (it.kind) {
    case 'me': return el('div', {}, el('div', { class: 'msg me' }, el('div', { class: 'bubble' },
      it.images?.length ? el('div', { class: 'bubble-imgs' }, it.images.map(src => el('img', { src, alt: _('Bild') }))) : null,
      it.files?.length ? el('div', { class: 'bubble-files' }, it.files.map(n => el('span', {}, '📄 ' + n))) : null,
      emojiOn() ? emojify(it.text) : it.text)),
      it.time ? el('div', { class: 'msg-time' }, msgTime(it.time) + (it.from ? ' · ' + _('von {name}', { name: it.from }) : '')) : null);
    case 'ai': {
      const b = el('div', { class: 'bubble md' + (it.streaming ? ' streaming' : ''), html: md(it.streaming ? streamingMarkdown(it.text) : it.text) });
      if (!it.streaming) { enhanceCode(b); hydrateImages(t, b); }
      // Fußzeile: Uhrzeit + Kopieren (kopiert den Text der Antwort als Markdown)
      return el('div', { class: 'ai-block' }, el('div', { class: 'msg ai' }, b),
        el('div', { class: 'ai-foot' },
          it.time ? el('span', { class: 'msg-time left' }, msgTime(it.time)) : null,
          el('button', { class: 'copy-answer', title: _('Antwort kopieren (Markdown)'), onclick: e => copyText(it.text, e.currentTarget) }, _('Kopieren'))));
    }
    case 'tool': return renderTool(it);
    case 'bash': return renderBash(t, it);
    case 'perm': return renderPerm(t, it);
    case 'question': return renderQuestion(t, it);
    case 'plan': return renderPlan(t, it);
    case 'recap': return el('div', { class: 'recap' }, el('div', { class: 'recap-head' }, '※ Recap', it.time ? el('span', { class: 'muted' }, ' · ' + msgTime(it.time)) : null), el('div', { class: 'recap-body' }, it.text));
    case 'sys': return el('div', { class: 'sys' + (it.error ? ' err' : '') }, el('span', {}, it.text));
    case 'result': return el('div', { class: 'result-line' }, it.text);
  }
  return null;
}

// Text in die Zwischenablage, mit kurzer Bestätigung am Knopf
async function copyText(text, btn) {
  if (!(await api.copyText(text || ''))) return toast(_('Kopieren nicht möglich'));
  if (btn) { const old = btn.textContent; btn.textContent = _('✓ Kopiert'); btn.classList.add('done'); setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1400); }
}
function enhanceCode(root) {
  root.querySelectorAll('pre').forEach(pre => {
    const btn = el('button', { class: 'copy', onclick: () => copyText(pre.querySelector('code')?.innerText || pre.innerText, btn) }, _('Kopieren'));
    pre.append(btn);
  });
}

function toolSummary(name, input = {}) {
  const short = p => (p || '').replace(/^.*[\\/](?=[^\\/]+[\\/][^\\/]+$)/, '…/');
  switch (name) {
    case 'Bash': case 'PowerShell': return input.description || input.command;
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return short(input.file_path || input.notebook_path);
    case 'Glob': return input.pattern;
    case 'Grep': return `${input.pattern}${input.path ? '  in ' + short(input.path) : ''}`;
    case 'WebFetch': return input.url;
    case 'WebSearch': return input.query;
    case 'Task': case 'Agent': return input.description;
    case 'TodoWrite': return _('{done}/{total} erledigt', { done: (input.todos || []).filter(x => x.status === 'completed').length, total: (input.todos || []).length });
    default: { const v = Object.values(input).find(x => typeof x === 'string'); return v || ''; }
  }
}
const TOOL_LABEL = { Bash: N_('Befehl'), PowerShell: 'PowerShell', Read: N_('Liest'), Write: N_('Schreibt'), Edit: N_('Bearbeitet'), Glob: N_('Sucht Dateien'), Grep: N_('Durchsucht'), WebFetch: N_('Webseite'), WebSearch: N_('Websuche'), Task: N_('Agent'), Agent: N_('Agent'), TodoWrite: N_('Aufgaben') };
const toolLabel = name => (TOOL_LABEL[name] ? _(TOOL_LABEL[name]) : name);

function renderTool(it) {
  const state = it.result == null ? 'run' : it.isError ? 'err' : 'ok';
  const d = el('details', { class: 'tool', 'data-label': toolLabel(it.name) },
    el('summary', {},
      el('span', { class: 't-state ' + state }, state === 'ok' ? '✓' : state === 'err' ? '✕' : ''),
      el('span', { class: 't-name' }, toolLabel(it.name)),
      el('span', { class: 't-sum' }, toolSummary(it.name, it.input)),
      it.images?.length ? el('span', { class: 't-thumbs' }, it.images.map(u => el('img', { src: u, alt: '', onclick: e => { e.preventDefault(); e.stopPropagation(); showImage(u); } }))) : null));
  if (it.name === 'TodoWrite' && Array.isArray(it.input?.todos)) {
    d.open = true;
    d.append(el('ul', { class: 'todo-list' }, it.input.todos.map(x =>
      el('li', { class: x.status === 'completed' ? 'done' : x.status === 'in_progress' ? 'doing' : '' },
        (x.status === 'completed' ? '☑ ' : x.status === 'in_progress' ? '▸ ' : '☐ ') + (x.content || x.activeForm || '')))));
    return d;
  }
  d.addEventListener('toggle', () => {
    if (!d.open || d.querySelector('.t-body')) return;
    const body = el('div', { class: 't-body' });
    if (it.name === 'Edit' && it.input) {
      body.append(el('div', { class: 't-label' }, _('Vorher')), el('pre', {}, it.input.old_string || ''), el('div', { class: 't-label' }, _('Nachher')), el('pre', {}, it.input.new_string || ''));
    } else {
      body.append(el('div', { class: 't-label' }, _('Eingabe')), el('pre', {}, (it.name === 'Bash' || it.name === 'PowerShell') ? it.input?.command : JSON.stringify(it.input, null, 2)));
    }
    if (it.result != null) body.append(el('div', { class: 't-label' }, it.isError ? _('Fehler') : _('Ergebnis')), el('pre', {}, truncate(it.result, 20000)));
    d.append(body);
  });
  return d;
}
// „!“-Befehl: Karte mit Befehl, Status und Ausgabe (offen, solange er läuft)
function renderBash(t, it) {
  const state = it.state !== 'done' ? 'run' : Number(it.code) ? 'err' : 'ok';
  const d = el('details', { class: 'tool bash', open: true },
    el('summary', {},
      el('span', { class: 't-state ' + state }, state === 'ok' ? '✓' : state === 'err' ? '✕' : ''),
      el('span', { class: 't-name' }, '!'),
      el('span', { class: 't-sum' }, it.command),
      state === 'run' ? el('button', { class: 'ghost small', onclick: e => { e.preventDefault(); tapi(t).session.bashStop(t.id); } }, _('Stopp')) : null),
    el('div', { class: 't-body' },
      state === 'run' ? el('div', { class: 't-label' }, _('läuft …')) : null,
      it.output ? el('pre', {}, truncate(it.output, 20000)) : state === 'run' ? null : el('div', { class: 't-label' }, _('(keine Ausgabe)')),
      state !== 'run' ? el('div', { class: 't-label' }, (Number(it.code) ? _('Beendet mit Code {n}', { n: it.code }) + ' · ' : '') + _('Claude sieht die Ausgabe mit deiner nächsten Nachricht') + (it.from ? ' · ' + _('von {name}', { name: it.from }) : '')) : null));
  return d;
}
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + '\n' + _('… ({n} Zeichen gekürzt)', { n: s.length - n }) : s);

// Einstufung der Rückfrage (src/renderer/risk.js): Text zum Grund
const RISK_REASON = {
  delete: [N_('löscht rekursiv oder erzwungen'), N_('löscht Dateien')],
  git: [N_('überschreibt den Git-Verlauf oder verwirft Änderungen'), N_('ändert den Git-Verlauf oder das Repository auf dem Server')],
  script: [N_('lädt ein Skript aus dem Netz und führt es aus')], system: [N_('greift ins System ein (Admin-Rechte, Datenträger, Neustart)')],
  database: [N_('löscht Datenbank-Inhalte')], publish: [N_('veröffentlicht etwas (z. B. npm publish)')], secret: [N_('betrifft Zugangsdaten oder Systemdateien')],
  install: [null, N_('installiert Pakete')], network: [null, N_('greift aufs Netz zu')], process: [null, N_('beendet Prozesse oder Dienste')],
  permissions: [null, N_('ändert Dateirechte')], config: [null, N_('ändert Projekt- oder Werkzeug-Einstellungen')],
};
function riskBadge(risk) {
  if (risk.level === 'normal') return null;
  const r = RISK_REASON[risk.reason] || [];
  const why = (risk.level === 'critical' ? r[0] : r[1]) || r[0] || r[1];
  return el('div', { class: 'risk-badge ' + risk.level }, (risk.level === 'critical' ? _('⚠ Kritisch') : _('Vorsicht')) + (why ? ' – ' + _(why) : ''));
}
function renderPerm(t, it) {
  const risk = permRisk(it.toolName, it.input);
  const card = el('div', { class: 'card' + (it.answered ? ' done' : '') + (risk.level !== 'normal' ? ' risk-' + risk.level : '') },
    it.answered ? null : riskBadge(risk),
    el('h4', {}, TOOL_LABEL[it.toolName] ? _('Darf Claude „{tool}“ ausführen?', { tool: toolLabel(it.toolName) }) : _('Darf Claude {tool} ausführen?', { tool: it.toolName })),
    it.description ? el('div', { class: 'muted' }, it.description) : null,
    el('pre', {}, (it.toolName === 'Bash' || it.toolName === 'PowerShell') ? it.input?.command : it.input?.file_path ? it.input.file_path + (it.input.new_string != null ? '\n\n− ' + (it.input.old_string || '') + '\n+ ' + it.input.new_string : '') : JSON.stringify(it.input, null, 2)));
  if (it.answered) card.append(el('div', { class: 'muted' }, it.answered));
  else card.append(el('div', { class: 'actions' },
    el('button', { class: 'primary', onclick: () => answerPerm(t, it, 'allow') }, _('Erlauben')),
    it.suggestions?.length && !it.suggestions.some(x => x?.type === 'setMode') ? el('button', { class: 'ghost', onclick: () => answerPerm(t, it, 'always'), title: _('Regel in den Projekteinstellungen speichern') }, _('Immer erlauben')) : null,
    el('button', { class: 'ghost danger', onclick: () => answerPerm(t, it, 'deny') }, _('Ablehnen'))));
  return card;
}
// Antworten und Nachrichten an Claude laufen über diese beiden Funktionen (Tests können sie abfangen)
function claudeRespond(t, requestId, resp) { return tapi(t).session.respond(t.id, requestId, resp); }
function claudeSend(t, content) { return tapi(t).session.send(plainTab(t), content); }
function answerPerm(t, it, how) {
  if (how === 'deny') {
    claudeRespond(t, it.requestId, { behavior: 'deny', message: CLAUDE_TEXT.denied });
    it.answered = _('✕ Abgelehnt');
  } else {
    const resp = { behavior: 'allow', updatedInput: it.input };
    if (how === 'always' && it.suggestions) resp.updatedPermissions = it.suggestions;
    claudeRespond(t, it.requestId, resp);
    it.answered = how === 'always' ? _('✓ Immer erlaubt') : _('✓ Erlaubt');
  }
  refreshItem(t, it);
}

// Plan-Karte (Modus „Nur planen“): Plan als Markdown, annehmen / überarbeiten lassen / ablehnen.
// Annehmen beendet in Claude Code den Plan-Modus; Swapline stellt den Chat dann auf „Nachfragen“.
function renderPlan(t, it) {
  const card = el('div', { class: 'card plan' + (it.answered ? ' done' : '') }, el('h4', {}, _('📋 Plan von Claude')));
  const body = el('div', { class: 'md plan-body', html: md(it.input?.plan || '') });
  card.append(body);
  if (it.answered) { card.append(el('div', { class: 'muted', style: 'margin-top:8px' }, it.answered)); return card; }
  const feedback = el('textarea', { class: 'plan-feedback', rows: '2', placeholder: _('Optional: Was soll Claude am Plan ändern?') });
  const answer = (resp, label, mode) => {
    claudeRespond(t, it.requestId, resp);
    it.answered = label;
    if (mode) { t.permissionMode = mode; saveTabs(); renderChatChip(t); }
    refreshItem(t, it);
  };
  card.append(feedback, el('div', { class: 'actions', style: 'margin-top:10px' },
    el('button', { class: 'primary', onclick: () => answer({ behavior: 'allow', updatedInput: it.input }, _('✓ Plan angenommen – Claude setzt ihn um (Berechtigungen: Nachfragen)'), 'default') }, _('Plan annehmen')),
    el('button', { class: 'ghost', onclick: () => { if (!feedback.value.trim()) return feedback.focus(); answer({ behavior: 'deny', message: CLAUDE_TEXT.planRevise + feedback.value.trim() }, _('✎ Überarbeitung gewünscht: {text}', { text: feedback.value.trim() })); } }, _('Überarbeiten lassen')),
    el('button', { class: 'ghost danger', onclick: () => answer({ behavior: 'deny', message: CLAUDE_TEXT.planRejected }, _('✕ Plan abgelehnt')) }, _('Ablehnen'))));
  return card;
}
function renderQuestion(t, it) {
  const card = el('div', { class: 'card' + (it.answered ? ' done' : '') }, el('h4', {}, _('Claude hat eine Frage')));
  if (it.answered) { card.append(el('div', { class: 'muted' }, it.answered)); return card; }
  const answers = it.answers ||= {};
  for (const q of it.input.questions || []) {
    card.append(el('div', { class: 'q' }, q.question));
    for (const o of q.options || []) {
      const chosen = q.multiSelect ? (answers[q.question] || []).includes(o.label) : answers[q.question] === o.label;
      card.append(el('button', { class: 'opt' + (chosen ? ' sel' : ''), onclick: () => {
        if (q.multiSelect) { const a = new Set(answers[q.question] || []); a.has(o.label) ? a.delete(o.label) : a.add(o.label); answers[q.question] = [...a]; }
        else answers[q.question] = o.label;
        refreshItem(t, it);
      } }, o.label, o.description ? el('small', {}, o.description) : null));
    }
    const other = el('input', { class: 'other', type: 'text', placeholder: _('Andere Antwort …'), value: typeof answers[q.question] === 'string' && !(q.options || []).some(o => o.label === answers[q.question]) ? answers[q.question] : '' });
    other.addEventListener('input', () => { answers[q.question] = other.value; });
    card.append(other);
  }
  card.append(el('div', { class: 'actions', style: 'margin-top:10px' },
    el('button', { class: 'primary', onclick: () => {
      const out = {};
      for (const [k, v] of Object.entries(answers)) out[k] = Array.isArray(v) ? v.join(', ') : v;
      claudeRespond(t, it.requestId, { behavior: 'allow', updatedInput: { ...it.input, answers: out } });
      it.answered = Object.entries(out).map(([k, v]) => `${k} → ${v}`).join('\n');
      refreshItem(t, it);
    } }, _('Antworten')),
    el('button', { class: 'ghost danger', onclick: () => {
      claudeRespond(t, it.requestId, { behavior: 'deny', message: CLAUDE_TEXT.questionSkipped });
      it.answered = _('✕ Übersprungen'); refreshItem(t, it);
    } }, _('Überspringen'))));
  return card;
}

// ---------- Nachrichten von Claude verarbeiten ----------
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => c.type === 'text' ? c.text : c.type === 'image' ? _('[Bild]') : '').join('\n');
  return '';
}
// Feste Texte, die Claude liest (Antworten auf Rückfragen, Platzhalter bei Anhängen): immer Englisch,
// unabhängig von der Sprache der Oberfläche – die Oberfläche zeigt ihre eigenen, übersetzten Texte.
const CLAUDE_TEXT = {
  summary: 'Summarize this conversation so far for me, in the language I have been writing in. Use Markdown with these sections: '
    + 'Goal; What was done (key steps and decisions); Changed files (paths); Commands and tests run, with results; Open points and next steps. '
    + 'Be concise. Do not use any tools and do not change anything for this.',
  denied: 'The user declined this action.',
  planRevise: 'Please revise the plan: ',
  planRejected: 'The user rejected the plan.',
  questionSkipped: 'The user does not want to answer the question.',
  seeImage: 'See attached image.',
  seeFile: 'See attached file.',
  attachedFiles: 'Attached files:',
};
const hiddenUserText = s => !s || /^\s*<(command-|local-command|system-reminder|bash-|user-memory|task-notification)/.test(s) || s.startsWith('[Request interrupted');

// „!“-Befehle im Verlauf (von Swapline oder der Claude CLI): <bash-input>…</bash-input> und <bash-stdout>…</bash-stdout>
// am Anfang des Textes werden zu Befehls-Karten; zurück kommt der übrige Text
const unescTag = s => s.replace(/<\\\/(bash-[a-z]+)>/g, '</$1>');
function takeBash(t, text, add, time) {
  let rest = String(text || '');
  const re = /^\s*(?:<bash-input>([\s\S]*?)<\/bash-input>)?\s*(?:<bash-stdout>([\s\S]*?)<\/bash-stdout>)?\s*(?:<bash-stderr>([\s\S]*?)<\/bash-stderr>)?/;
  for (let i = 0; i < 20; i++) {
    const m = re.exec(rest);
    if (!m || !m[0].trim()) break;
    const out = [m[2], m[3]].filter(x => x && x.trim()).map(unescTag).join('\n');
    const last = t.items[t.items.length - 1];
    if (m[1] == null && last?.kind === 'bash' && !last.output) last.output = out; // CLI: Ausgabe als eigene Nachricht
    else add({ kind: 'bash', id: 'h' + i + (time || ''), time, command: unescTag(m[1] || ''), state: 'done', output: out, code: /exit code (\d+)/.exec(m[3] || '')?.[1] || 0 });
    rest = rest.slice(m[0].length);
  }
  return rest;
}

function ingest(t, m, fromHistory = false) {
  const add = it => (fromHistory ? t.items.push(it) : appendItem(t, it));
  switch (m.type) {
    // Fernzugriff: Nachricht wurde auf dem anderen PC geschrieben (gleicher Chat, gleicher Claude-Prozess)
    case 'swapline_user': {
      const text = String(m.content?.text || '') || (m.content?.images ? _('[Bild]') : '');
      add({ kind: 'me', text, time: Date.now(), from: String(m.from || '').slice(0, 40), images: [] });
      t.running = true; t.updated = Date.now(); t.preview = text.replace(/\s+/g, ' ').slice(0, 90);
      if (!t.title) t.title = text.replace(/\s+/g, ' ').slice(0, 60);
      setTyping(t); updateComposer(); renderList();
      return;
    }
    case 'swapline_bash': {
      const it = t.items.find(x => x.kind === 'bash' && x.id === m.id);
      const data = { command: String(m.command || ''), state: m.state === 'done' ? 'done' : 'running', code: m.code, output: typeof m.output === 'string' ? m.output : '', from: String(m.from || '').slice(0, 40) };
      if (it) { Object.assign(it, data); refreshItem(t, it); }
      else add({ kind: 'bash', id: String(m.id || ''), time: Date.now(), ...data });
      t.updated = Date.now();
      return;
    }
    case 'swapline_answered': {
      const it = t.items.find(x => x.requestId === m.requestId && !x.answered);
      if (it) { it.answered = m.behavior === 'deny' ? _('✕ Abgelehnt auf {name}', { name: m.from }) : _('✓ Beantwortet auf {name}', { name: m.from }); refreshItem(t, it); }
      return;
    }
    case 'system':
      if (m.subtype === 'init') {
        const changed = t.sessionId !== m.session_id;
        t.sessionId = m.session_id;
        t.modelName = m.model;
        if (changed) saveTabs();
      } else if (m.subtype === 'compact_boundary') add({ kind: 'sys', text: _('Unterhaltung wurde zusammengefasst') });
      else if (['task_started', 'task_updated', 'task_notification', 'background_tasks_changed'].includes(m.subtype)) trackTask(t, m);
      else if (m.subtype === 'away_summary' && m.content) add({ kind: 'recap', text: m.content, time: Date.parse(m.timestamp) || Date.now() });
      break;

    case 'stream_event': {
      const ev = m.event;
      if (m.parent_tool_use_id) break; // Text von Unter-Agenten nicht in den Hauptchat
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        if (!t.streamItem) { t.streamItem = { kind: 'ai', text: '', streaming: true, time: Date.now() }; appendItem(t, t.streamItem); setTyping(t); }
        t.streamItem.text += ev.delta.text;
        scheduleStreamRender(t);
      }
      break;
    }

    case 'assistant': {
      if (m.parent_tool_use_id) break;
      for (const block of m.message?.content || []) {
        if (block.type === 'text' && block.text?.trim()) {
          if (t.streamItem) { t.streamItem.text = block.text; t.streamItem.streaming = false; refreshItem(t, t.streamItem); t.streamItem = null; }
          else add({ kind: 'ai', text: block.text, time: fromHistory ? Date.parse(m.timestamp) || null : Date.now() });
          t.preview = block.text.replace(/\s+/g, ' ').slice(0, 90);
        } else if (block.type === 'tool_use') {
          if (block.name === 'AskUserQuestion') continue; // erscheint als Frage-Karte
          add({ kind: 'tool', id: block.id, name: block.name, input: block.input, result: fromHistory ? '' : null });
        }
      }
      if (!fromHistory) setTyping(t);
      break;
    }

    case 'user': {
      const c = m.message?.content;
      if (typeof c === 'string') {
        const rest = takeBash(t, c, add, Date.parse(m.timestamp) || null);
        if (!hiddenUserText(rest)) add({ kind: 'me', text: rest, time: Date.parse(m.timestamp) || null });
        break;
      }
      if (!Array.isArray(c)) break;
      for (const block of c) {
        if (block.type === 'tool_result') {
          // Hintergrund-Befehl: Pfad der Ausgabedatei steht im Ergebnis des Aufrufs
          const outFile = /Output is being written to: (.+?\.output)/.exec(textOf(block.content))?.[1];
          const task = outFile && Object.values(t.tasks || {}).find(x => x.toolUseId === block.tool_use_id);
          if (task) { task.output = outFile; renderBgBar(t); }
          const tool = [...t.items].reverse().find(x => x.kind === 'tool' && x.id === block.tool_use_id);
          if (tool) {
            tool.result = textOf(block.content) || _('(keine Ausgabe)');
            if (Array.isArray(block.content)) tool.images = block.content.filter(x => x?.type === 'image' && x.source?.type === 'base64' && x.source.data && IMG_TYPES.includes(x.source.media_type))
              .slice(0, 4).map(x => `data:${x.source.media_type};base64,${x.source.data}`);
            tool.isError = !!block.is_error;
            if (!fromHistory) refreshItem(t, tool);
          }
        } else if (block.type === 'text' && fromHistory) {
          const rest = takeBash(t, block.text, add, Date.parse(m.timestamp) || null);
          if (hiddenUserText(rest)) continue;
          // Bilder derselben Nachricht (aus dem Verlauf) mit anzeigen
          const images = c.filter(b => b.type === 'image' && b.source?.type === 'base64' && b.source.data && IMG_TYPES.includes(b.source.media_type)).map(b => `data:${b.source.media_type};base64,${b.source.data}`);
          add({ kind: 'me', text: rest, time: Date.parse(m.timestamp) || null, images });
        }
      }
      break;
    }

    case 'control_request': {
      const r = m.request;
      if (r?.subtype !== 'can_use_tool') break;
      if (r.tool_name === 'AskUserQuestion') add({ kind: 'question', requestId: m.request_id, input: r.input });
      else if (r.tool_name === 'ExitPlanMode') add({ kind: 'plan', requestId: m.request_id, input: r.input });
      else add({ kind: 'perm', requestId: m.request_id, toolName: r.tool_name, input: r.input, description: r.description, suggestions: r.permission_suggestions });
      notifyIfHidden(t, r.tool_name === 'AskUserQuestion' ? _('Claude hat eine Frage') : r.tool_name === 'ExitPlanMode' ? _('Claude hat einen Plan vorgelegt') : _('Claude braucht deine Erlaubnis'));
      break;
    }

    case 'result': {
      t.running = false;
      if (t.streamItem) { t.streamItem.streaming = false; t.streamItem = null; }
      const secs = ((m.duration_ms || 0) / 1000).toFixed(1);
      // Kosten dieser Antwort (Zuwachs, vom Hauptprozess berechnet) – total_cost_usd ist der Stand der ganzen Sitzung
      const c1 = typeof m.swapline_cost_delta === 'number' ? m.swapline_cost_delta : null;
      const cost = c1 != null ? ` · $${c1.toFixed(3)}` : '';
      if (m.is_error || (m.subtype && m.subtype !== 'success')) {
        add({ kind: 'sys', error: true, text: m.result || errorLabel(m.subtype) });
      }
      add({ kind: 'result', text: `${m.is_error ? '✕' : '✓'} ${secs} s${cost}${t.modelName ? ' · ' + t.modelName : ''}` });
      t.updated = Date.now();
      // Alle offenen Werkzeuge als erledigt markieren
      t.items.forEach(x => { if (x.kind === 'tool' && x.result == null) { x.result = ''; refreshItem(t, x); } });
      setTyping(t); updateComposer(); saveTabs(); renderList();
      notifyIfHidden(t, m.is_error ? _('Fehler: {e}', { e: String(m.result || errorLabel(m.subtype)).slice(0, 120) }) : (t.preview || _('Antwort ist fertig')));
      if (t.pendingProfile) moveTabToProfile(t, t.pendingProfile);
      break;
    }

    case 'app_error':
      t.running = false;
      add({ kind: 'sys', error: true, text: m.message });
      setTyping(t); updateComposer(); renderList();
      break;

    case 'app_exit':
      if (t.running) {
        t.running = false;
        const tail = (m.stderr || '').trim().split('\n').slice(-6).join('\n');
        add({ kind: 'sys', error: true, text: _('Claude wurde beendet (Code {code}).', { code: m.code }) + (tail ? '\n' + tail : '') + (/login|auth|401/i.test(tail) ? '\n' + _('Bitte das Konto unter „Konten verwalten“ anmelden.') : '') });
        setTyping(t); updateComposer(); renderList();
      }
      break;
  }
}
// ---------- Hintergrund-Aufgaben (z. B. Befehle mit run_in_background, Agenten im Hintergrund) ----------
// Claude Code meldet task_started / task_updated / task_notification / background_tasks_changed.
const TASK_TYPES = { local_bash: N_('Befehl'), local_agent: N_('Agent'), remote_agent: N_('Agent (Cloud)') };
// Chat gilt auch nach dem Ende der Antwort als aktiv, solange eine Hintergrund-Aufgabe läuft
const bgRunning = t => Object.values(t.tasks || {}).some(x => x.status === 'running');
let bgDoneHideMs = 4000; // so lange bleibt eine erfolgreich beendete Hintergrund-Aufgabe sichtbar
function trackTask(t, m) {
  t.tasks ||= {};
  if (m.subtype === 'background_tasks_changed') {
    // Liste der laufenden Aufgaben: alles, was nicht mehr drin ist, gilt als beendet
    const running = new Set((m.tasks || []).map(x => x.task_id));
    for (const x of m.tasks || []) t.tasks[x.task_id] ||= { id: x.task_id, desc: x.description, type: x.task_type, status: 'running', start: Date.now() };
    for (const task of Object.values(t.tasks)) if (task.status === 'running' && !running.has(task.id)) task.status = 'completed';
  } else {
    const task = (t.tasks[m.task_id] ||= { id: m.task_id, status: 'running', start: Date.now() });
    if (m.description) task.desc = m.description;
    if (m.task_type) task.type = m.task_type;
    if (m.tool_use_id) task.toolUseId = m.tool_use_id;
    if (m.subtype === 'task_updated' && m.patch?.status) { task.status = m.patch.status; if (m.patch.end_time) task.end = m.patch.end_time; }
    if (m.subtype === 'task_notification') { task.status = m.status || task.status; task.summary = m.summary; if (m.output_file) task.output = m.output_file; task.end ||= Date.now(); }
  }
  // erfolgreich beendete Aufgaben nach kurzer Zeit aus der Leiste nehmen – fehlgeschlagene bleiben, bis man sie entfernt
  for (const task of Object.values(t.tasks)) {
    if (task.status !== 'completed' || task.hideTimer) continue;
    task.hideTimer = setTimeout(() => {
      if (t.tasks?.[task.id]?.status !== 'completed') return;
      delete t.tasks[task.id];
      renderBgBar(t);
    }, bgDoneHideMs);
  }
  renderBgBar(t);
  renderList(); renderRail();
}
const taskIcon = s => (s === 'running' ? el('span', { class: 'spinner sm' }) : el('span', { class: 'bg-ic ' + (s === 'completed' ? 'ok' : 'err') }, s === 'completed' ? '✓' : '✕'));
function taskDuration(task) {
  const s = Math.round(((task.end || Date.now()) - task.start) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
function renderBgBar(t) {
  if (t.id !== activeTabId) { const p = paneOf(t); if (p) withPane(p, () => renderBgBar(t)); return; }
  const bar = $('#bgbar');
  const list = Object.values(t.tasks || {});
  bar.hidden = !list.length;
  if (!list.length) return;
  const running = list.filter(x => x.status === 'running').length, done = list.length - running;
  const failed = list.filter(x => x.status !== 'running' && x.status !== 'completed').length;
  fill(bar, el('button', { class: 'bg-chip' + (running ? ' running' : ''), onclick: () => ($('#bg-menu') ? closeMenus() : openBgMenu(t)) },
    running ? el('span', { class: 'spinner sm' }) : el('span', { class: 'bg-ic ' + (failed ? 'err' : 'ok') }, failed ? '✕' : '✓'),
    running ? (running === 1 ? _('1 Hintergrund-Aufgabe läuft') : _('{n} Hintergrund-Aufgaben laufen', { n: running })) : '',
    running && done ? ' · ' : '',
    done ? _('{n} beendet', { n: done }) : '',
    el('span', { class: 'bg-hint' }, ' – ' + _('anzeigen'))));
}
function openBgMenu(t) {
  closeMenus();
  const r = $('#bgbar').getBoundingClientRect();
  const list = Object.values(t.tasks || {}).sort((a, b) => b.start - a.start);
  const items = [el('div', { class: 'pm-title' }, _('Hintergrund-Aufgaben'))];
  for (const task of list) {
    items.push(el('div', { class: 'bg-item' },
      taskIcon(task.status),
      el('div', { class: 'pm-text' },
        el('b', {}, task.desc || task.id),
        el('small', {}, [TASK_TYPES[task.type] ? _(TASK_TYPES[task.type]) : task.type || _('Aufgabe'), task.status === 'running' ? _('läuft seit {d}', { d: taskDuration(task) }) : (task.summary || task.status) + ' · ' + taskDuration(task)].join(' · '))),
      task.output ? el('button', { class: 'ghost', onclick: () => { closeMenus(); showTaskOutput(task, t); } }, _('Ausgabe')) : null));
  }
  if (list.some(x => x.status !== 'running')) items.push(el('div', { class: 'pm-sep' }), el('button', { class: 'pm-item', onclick: () => {
    for (const [id, x] of Object.entries(t.tasks)) if (x.status !== 'running') delete t.tasks[id];
    closeMenus(); renderBgBar(t);
  } }, el('span', { class: 'pm-ic' }, '🧹'), _('Beendete entfernen')));
  const menu = el('div', { class: 'popmenu bg-menu', id: 'bg-menu', style: `left:${r.left}px; bottom:${window.innerHeight - r.top + 6}px` }, ...items);
  document.body.append(menu);
}
async function showTaskOutput(task, t) {
  const pre = el('pre', { class: 'task-output' }, _('Wird geladen …'));
  const info = el('div', { class: 'hint' });
  const load = async () => {
    const r = await tapi(t).readTaskOutput(task.output);
    pre.textContent = r.error ? r.error : (r.text || _('(noch keine Ausgabe)'));
    const kb = Math.round((r.size || 0) / 1024 * 10) / 10;
    info.textContent = r.error ? '' : (r.truncated ? _('Letzte 64 KB von {kb} KB', { kb }) : kb + ' KB') + ' · ' + (task.status === 'running' ? _('läuft noch') : _('beendet'));
    pre.scrollTop = pre.scrollHeight;
  };
  modal('task-out', task.desc || _('Ausgabe'), info, pre,
    el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'ghost', onclick: load }, _('Aktualisieren')), el('button', { class: 'ghost', onclick: e => copyText(pre.textContent, e.currentTarget) }, _('Kopieren'))));
  load();
}
function errorLabel(sub) {
  return { error_max_turns: _('Maximale Anzahl an Schritten erreicht.'), error_during_execution: _('Fehler während der Ausführung (oder abgebrochen).') }[sub] || _('Fehler: {e}', { e: sub });
}

function scheduleStreamRender(t) {
  if (t._raf) return;
  // höchstens ~15× pro Sekunde neu zeichnen
  t._raf = setTimeout(() => { t._raf = null; if (t.streamItem) refreshItem(t, t.streamItem); }, 66);
}
// Windows-Benachrichtigung (fertige Antwort, Rückfrage) – je nach Einstellung immer, nur wenn der Chat
// nicht im Blick ist, oder nie; optional mit eigenem Ton. Klick holt Swapline nach vorne und öffnet den Chat.
function notifyIfHidden(t, text) {
  if (!shownInPane(t.id)) { t.unread = true; renderList(); }
  const mode = store.settings.notify || 'background';
  const inView = document.hasFocus() && shownInPane(t.id);
  if (!document.hasFocus()) api.attention(); // Taskleiste blinkt
  if (mode === 'off' || (mode === 'background' && inView)) return;
  // Benachrichtigung über den Hauptprozess (bleibt je nach Einstellung bis zum Klick stehen)
  api.notify({ title: t.title || 'Swapline', body: text, tabId: t.id, silent: soundSetting() !== 'system' });
  playSound(); // Windows-Standard kommt über die Benachrichtigung selbst (silent: false)
}
// Kurzer Hinweiston (zwei weiche Töne), erzeugt per Web Audio – keine Tondatei nötig
// Hinweistöne, erzeugt per Web Audio (keine Tondateien). Je Ton: Liste von Noten
// { f: Frequenz, to: Ziel-Frequenz (Gleiten), at: Start (s), d: Dauer (s), v: Lautstärke, w: Wellenform }
const SOUNDS = {
  chime: { label: N_('Glocke'), notes: [{ f: 880, at: 0, d: 0.45 }, { f: 1318.5, at: 0.14, d: 0.45 }] },
  ping: { label: 'Ping', notes: [{ f: 1568, at: 0, d: 0.28, w: 'triangle', v: 0.22 }] },
  drop: { label: N_('Tropfen'), notes: [{ f: 1250, to: 420, at: 0, d: 0.22, v: 0.22 }] },
  rise: { label: N_('Aufsteigend'), notes: [{ f: 1046.5, at: 0, d: 0.3 }, { f: 1318.5, at: 0.1, d: 0.3 }, { f: 1568, at: 0.2, d: 0.45 }] },
  soft: { label: N_('Dezent'), notes: [{ f: 523.25, at: 0, d: 0.9, v: 0.1 }, { f: 784, at: 0.05, d: 0.9, v: 0.05 }] },
};
const soundSetting = () => ({ on: 'chime' })[store.settings.sound] || store.settings.sound || 'off'; // „on“ aus 0.2–0.4 = Glocke
let audioCtx;
function playSound(name = soundSetting()) {
  const s = SOUNDS[name]; if (!s) return;
  try {
    audioCtx ||= new AudioContext();
    const now = audioCtx.currentTime;
    for (const n of s.notes) {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = n.w || 'sine';
      osc.frequency.setValueAtTime(n.f, now + n.at);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, now + n.at + n.d);
      gain.gain.setValueAtTime(0, now + n.at);
      gain.gain.linearRampToValueAtTime(n.v ?? 0.18, now + n.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.at + n.d);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + n.at); osc.stop(now + n.at + n.d + 0.05);
    }
  } catch {}
}

api.onEvent(({ tabId, msg }) => {
  const t = tabs.find(x => x.id === tabId);
  if (t) ingest(t, msg);
});
// Klick auf eine Windows-Benachrichtigung: passenden Chat öffnen
// ---------- Updates ----------
// Hinweis unten links, sobald eine neue Version verfügbar (bzw. im Modus „Automatisch“ geladen) ist;
// Details und Schalter in den Einstellungen
let updateInfo = { status: 'idle' }, updateDismissed = '';
function updateText(st = updateInfo) {
  if (!st.supported) return _('Automatische Updates gibt es nur in der installierten App (Swapline-Setup-<Version>.exe).');
  return {
    idle: _('Noch nicht geprüft.'), checking: _('Suche nach Updates …'),
    downloading: _('Lade Version {v} … {p} %', { v: st.version || '', p: st.percent || 0 }),
    available: _('Version {v} ist verfügbar.', { v: st.version }),
    ready: _('Version {v} ist bereit – wird beim Neustart installiert.', { v: st.version }),
    latest: _('Swapline ist aktuell ({v}).', { v: VERSION }),
    error: _('Update-Prüfung fehlgeschlagen: {e}', { e: st.error || _('unbekannter Fehler') }),
  }[st.status] || '';
}
function showUpdate(st) {
  updateInfo = st;
  const info = $('#update-info'); if (info) info.textContent = updateText(st);
  const ready = st.status === 'ready', avail = st.status === 'available';
  const btn = $('#update-restart'); if (btn) { btn.hidden = !(ready || avail); btn.textContent = ready ? _('Jetzt neu starten') : _('Herunterladen'); }
  $('#update-banner')?.remove();
  if (!(ready || avail) || updateDismissed === st.version) return;
  document.body.append(el('div', { id: 'update-banner' },
    el('span', {}, avail ? _('Version {v} verfügbar', { v: st.version }) : el('span', {}, el('b', {}, `Swapline ${st.version}`), ' ' + _('ist geladen – jetzt neu starten?'))),
    el('button', { class: 'primary', onclick: installUpdate }, ready ? _('Jetzt neu starten') : _('Herunterladen')),
    ready ? el('button', { class: 'ghost', title: _('Später – wird beim nächsten Beenden installiert'), onclick: () => { updateDismissed = st.version; $('#update-banner')?.remove(); toast(_('Das Update wird beim nächsten Beenden installiert')); } }, _('Später'))
      : el('button', { class: 'ghost', title: _('Später'), onclick: () => { updateDismissed = st.version; $('#update-banner')?.remove(); } }, icon(ICONS.x))));
}
// „Herunterladen“ lädt nur; neu gestartet wird erst nach Klick auf „Jetzt neu starten“
async function installUpdate() {
  if (updateInfo.status === 'available') {
    if (await api.update.download()) toast(_('Update wird geladen – danach kannst du neu starten'));
    else toast(_('Update ist nicht mehr verfügbar'));
    return;
  }
  if (tabs.some(t => t.running || bgRunning(t)) && !confirm(_('Claude arbeitet noch. Trotzdem neu starten und das Update installieren?'))) return;
  if (!(await api.update.install())) toast(_('Update ist nicht mehr verfügbar'));
}
api.update.onStatus(showUpdate);
api.update.state().then(showUpdate);

api.onNotifyClick(tabId => { if (tabs.some(x => x.id === tabId)) { view = 'chats'; setSeg(); openTab(tabId); } });
api.onUsage(u => { store.usage = u; renderUsage(); });

// ---------- Senden ----------
// ---------- Eingabefeld: /-Befehle, Eingabe-Verlauf, Anhänge ----------
// Befehle, die im Chat-Modus von Claude Code nicht laufen (sie brauchen das Terminal), führt Swapline selbst aus.
const LOCAL_COMMANDS = [
  { name: 'clear', description: N_('Neuen Chat beginnen'), run: () => newChat() },
  { name: 'new', description: N_('Neuen Chat beginnen'), run: () => newChat() },
  { name: 'model', description: N_('Modell, Aufwand und Berechtigungen wählen'), run: () => openChatSettingsMenu() },
  { name: 'rename', description: N_('Chat umbenennen'), run: () => renameChat() },
  { name: 'login', description: N_('Konten verwalten und anmelden'), run: () => openAccounts() },
  { name: 'config', description: N_('Einstellungen von Swapline'), run: () => openSettings() },
  { name: 'settings', description: N_('Einstellungen von Swapline'), run: () => openSettings() },
  { name: 'plugins', description: N_('Erweiterungen: Plugins installieren und verwalten'), run: () => openExtensions('installed') },
  { name: 'skills', description: N_('Skills und Befehle dieses Kontos anzeigen'), run: () => openExtensions('skills') },
  { name: 'resume', description: N_('Frühere Sitzung fortsetzen (Verlauf)'), run: () => { view = 'history'; setSeg(); renderList(); $('#search')?.focus(); } },
  { name: 'export', description: N_('Chat als Markdown-Datei speichern – mit allen Details'), run: () => exportChat() },
  { name: 'summary', description: N_('Claude fasst den Chat zusammen (Ziel, Ergebnisse, Dateien, offene Punkte)'), run: () => summaryChat() },
];
function commandList() {
  const t = currentTab();
  const cli = (modelInfo[t?.profileId]?.commands || []).filter(c => !LOCAL_COMMANDS.some(l => l.name === c.name));
  return [...LOCAL_COMMANDS.map(c => ({ ...c, description: _(c.description), local: true })), ...cli];
}
let cmdState = { open: false, items: [], index: 0 };
function updateCommandPopup() {
  const input = $('#input');
  const v = input.value, caret = input.selectionStart;
  const m = /^\/(\S*)$/.exec(v.slice(0, caret));
  if (!m || v.slice(0, caret).includes('\n')) return closeCommandPopup();
  const q = m[1].toLowerCase();
  const all = commandList();
  const items = all.filter(c => c.name.toLowerCase().startsWith(q))
    .concat(all.filter(c => !c.name.toLowerCase().startsWith(q) && (c.name + ' ' + c.description).toLowerCase().includes(q))).slice(0, 9);
  if (!items.length) return closeCommandPopup();
  cmdState = { open: true, items, index: Math.min(cmdState.index, items.length - 1) };
  let pop = $('#cmd-popup');
  if (!pop) { pop = el('div', { class: 'popmenu cmd-popup', id: 'cmd-popup' }); document.body.append(pop); }
  const r = input.getBoundingClientRect();
  pop.style.left = r.left + 'px'; pop.style.bottom = (window.innerHeight - r.top + 8) + 'px'; pop.style.width = Math.min(560, r.width) + 'px';
  fill(pop, el('div', { class: 'pm-title' }, _('Befehle · ↑↓ wählen · Enter/Tab übernehmen · Esc schließen')),
    items.map((c, i) => el('button', { class: 'pm-item' + (i === cmdState.index ? ' sel' : ''), onmousedown: e => { e.preventDefault(); applyCommand(c); } },
      el('span', { class: 'cmd-name' }, '/' + c.name, c.argumentHint ? el('span', { class: 'muted' }, ' ' + c.argumentHint) : null),
      el('span', { class: 'cmd-desc' }, c.description || ''),
      c.local ? el('span', { class: 'cmd-badge' }, 'Swapline') : null)));
}
function closeCommandPopup() { cmdState.open = false; $('#cmd-popup')?.remove(); }
function applyCommand(c) {
  const input = $('#input');
  closeCommandPopup();
  if (c.local) { input.value = ''; autosize(); return c.run(); }
  input.value = '/' + c.name + ' ';
  input.focus(); input.setSelectionRange(input.value.length, input.value.length); autosize();
}
// Eingabe-Verlauf: ↑/↓ blättert durch die letzten eigenen Nachrichten (gespeichert, höchstens 100)
const LS_HISTORY = 'swapline.inputHistory';
let inputHistory = (() => { try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; } })();
let historyPos = -1, historyDraft = '';
function rememberInput(text) {
  inputHistory = [text, ...inputHistory.filter(x => x !== text)].slice(0, 100);
  historyPos = -1;
  try { localStorage.setItem(LS_HISTORY, JSON.stringify(inputHistory)); } catch {}
}
function browseHistory(dir) {
  const input = $('#input');
  if (historyPos === -1) historyDraft = input.value;
  const next = historyPos + dir;
  if (next < -1 || next >= inputHistory.length) return false;
  historyPos = next;
  input.value = historyPos === -1 ? historyDraft : inputHistory[historyPos];
  autosize(); input.setSelectionRange(input.value.length, input.value.length);
  return true;
}
// Anhänge: Bilder (png/jpg/gif/webp bis 5 MB) gehen als Bild an Claude, andere Dateien als Pfad
let attachments = [];
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
function renderAttachments() {
  const bar = $('#attachbar');
  bar.hidden = !attachments.length;
  fill(bar, attachments.map((a, i) => el('div', { class: 'att-chip', title: a.path || a.name },
    a.kind === 'image' ? el('img', { src: `data:${a.media};base64,${a.data}`, alt: '' }) : el('span', { class: 'att-file' }, '📄'),
    el('span', { class: 'att-name' }, a.name),
    el('button', { class: 'att-x', title: _('Entfernen'), onclick: () => { attachments.splice(i, 1); renderAttachments(); } }, '×'))));
}
function readImageFile(file) {
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res({ kind: 'image', name: file.name || _('Bild') + '.png', media: file.type, data: String(fr.result).split(',')[1] });
    fr.onerror = () => res(null);
    fr.readAsDataURL(file);
  });
}
async function addFiles(fileList) {
  for (const f of [...fileList].slice(0, 10)) {
    if (IMG_TYPES.includes(f.type) && f.size <= 5 * 1024 * 1024) { const a = await readImageFile(f); if (a) attachments.push(a); continue; }
    const p = api.pathForFile(f);
    if (p) attachments.push({ kind: 'file', name: f.name, path: p, size: f.size });
    else if (IMG_TYPES.includes(f.type)) toast(_('Bild ist größer als 5 MB'));
  }
  renderAttachments();
}

async function sendMessage() {
  const t = currentTab(); if (!t) return;
  const input = $('#input');
  let text = input.value.trim();
  // Swapline-eigene Befehle (/clear, /model …) direkt ausführen
  const local = /^\/(\S+)\s*$/.exec(text) && LOCAL_COMMANDS.find(c => c.name === text.slice(1).trim());
  if (local && !attachments.length) { input.value = ''; autosize(); closeCommandPopup(); return local.run(); }
  if (!text && !attachments.length) return;
  // „!befehl“: direkt im Ordner des Chats ausführen (wie in der Claude CLI); die Ausgabe bekommt Claude mit der nächsten Nachricht
  if (text.startsWith('!') && !attachments.length) return runBang(t, text);
  if (emojiOn()) text = emojify(text);
  const st = status[tk(t)];
  if (st && !st.loggedIn) {
    if (st.claudeMissing) { toast(_('Claude Code nicht gefunden – bitte installieren oder Pfad in den Einstellungen angeben')); return openSettings(); }
    toast(_('Dieses Konto ist nicht angemeldet'));
    return openAccounts();
  }
  closeCommandPopup();
  if (text) rememberInput(text);
  // Anhänge: Bilder als Bild-Blöcke, Dateien als Pfadliste im Text (Claude liest sie selbst)
  const imgs = attachments.filter(a => a.kind === 'image'), files = t.host ? [] : attachments.filter(a => a.kind === 'file');
  if (t.host && attachments.some(a => a.kind === 'file')) toast(_('Dateien dieses PCs gehen nicht an einen Haupt-PC – nur Bilder werden mitgeschickt'));
  attachments = []; renderAttachments();
  // ohne eigenen Text: Claude bekommt einen englischen Platzhalter, die Sprechblase zeigt ihn übersetzt
  const sent = text || (imgs.length ? CLAUDE_TEXT.seeImage : CLAUDE_TEXT.seeFile);
  if (!text) text = imgs.length ? _('Siehe angehängtes Bild.') : _('Siehe angehängte Datei.');
  const fullText = files.length ? sent + '\n\n' + CLAUDE_TEXT.attachedFiles + '\n' + files.map(f => '- ' + f.path).join('\n') : sent;
  const content = imgs.length ? [...imgs.map(a => ({ type: 'image', source: { type: 'base64', media_type: a.media, data: a.data } })), { type: 'text', text: fullText }] : fullText;
  input.value = ''; autosize();
  if (!t.title) t.title = text.replace(/\s+/g, ' ').slice(0, 60);
  t.preview = text.replace(/\s+/g, ' ').slice(0, 90);
  t.updated = Date.now();
  appendItem(t, { kind: 'me', text, time: Date.now(), images: imgs.map(a => `data:${a.media};base64,${a.data}`), files: files.map(f => f.name) });
  t.running = true; setTyping(t); updateComposer();
  saveTabs(); renderList();
  $('#ch-title').textContent = t.title;
  await claudeSend(t, content);
}
async function runBang(t, text) {
  const command = text.slice(1).trim();
  if (!command) return;
  if (String(t.host || '').startsWith('ssh:')) return toast(_('„!“-Befehle gehen nur auf PCs, nicht auf SSH-Servern'));
  closeCommandPopup();
  rememberInput(text);
  const input = $('#input');
  input.value = ''; autosize(); updateBashMode();
  if (!t.title) t.title = text.replace(/\s+/g, ' ').slice(0, 60);
  t.updated = Date.now(); saveTabs(); renderList();
  const r = await tapi(t).session.bash(plainTab(t), command).catch(e => ({ error: e.message }));
  if (r?.error) toast(r.error);
  else if (r !== true) toast(_('Befehl nicht ausgeführt'));
}
// Eingabe beginnt mit „!“: Feld als Befehlszeile markieren
function updateBashMode() {
  const input = $('#input');
  input?.closest('footer')?.classList.toggle('bash-mode', input.value.startsWith('!'));
}
// Smileys → Emojis (src/renderer/emoji.js), abschaltbar in den Einstellungen
const emojiOn = () => store?.settings?.emoji !== false;
let lastEmoji = null; // letzte Umwandlung beim Tippen (Rücktaste macht sie rückgängig)
// /export: ganzer Chat als Markdown (Nachrichten, Werkzeuge mit Eingabe und Ergebnis, Rückfragen, „!“-Befehle, Zeiten, Kosten)
const fence = s => { const t = String(s ?? ''); const n = Math.max(3, ...(t.match(/`+/g) || []).map(x => x.length + 1)); return '`'.repeat(n) + '\n' + t + '\n' + '`'.repeat(n); };
const stamp = ms => (ms ? new Date(ms).toLocaleString(locale()) : '');
function chatMarkdown(t) {
  const p = profileOf(t), out = [];
  out.push('# ' + (t.title || _('Neuer Chat')), '');
  out.push(`- ${_('Konto')}: ${p?.name || t.profileId || '–'}`, `- ${_('Ordner')}: ${t.cwd || '~'}`, `- ${_('Modell')}: ${t.modelName || t.model || _('Standard')}`,
    `- ${_('Sitzung')}: ${t.sessionId || '–'}`, `- ${_('Exportiert')}: ${stamp(Date.now())} · Swapline ${VERSION}`, '', '---', '');
  for (const it of t.items) {
    switch (it.kind) {
      case 'me': out.push(`### ${_('Du')}${it.from ? ' (' + it.from + ')' : ''}${it.time ? ' · ' + stamp(it.time) : ''}`, '', it.text || '', ''); break;
      case 'ai': out.push(`### Claude${it.time ? ' · ' + stamp(it.time) : ''}`, '', it.text || '', ''); break;
      case 'tool': {
        const input = (it.name === 'Bash' || it.name === 'PowerShell') ? it.input?.command : JSON.stringify(it.input, null, 2);
        out.push(`<details><summary>🔧 ${toolLabel(it.name)}: ${String(toolSummary(it.name, it.input) || '').replace(/[<>]/g, '')}</summary>`, '', fence(input));
        if (it.result) out.push('', it.isError ? _('Fehler') + ':' : _('Ergebnis') + ':', '', fence(it.result));
        out.push('', '</details>', '');
        break;
      }
      case 'bash': out.push(`**! ${it.command}**${Number(it.code) ? ' (' + _('Beendet mit Code {n}', { n: it.code }) + ')' : ''}`, '', fence(it.output || ''), ''); break;
      case 'perm': out.push(`> ❓ ${_('Darf Claude {tool} ausführen?', { tool: it.toolName })}`, '>', ...fence((it.toolName === 'Bash' || it.toolName === 'PowerShell') ? it.input?.command : JSON.stringify(it.input, null, 2)).split('\n').map(l => '> ' + l), `> ${it.answered || _('(offen)')}`, ''); break;
      case 'question': out.push(`> ❓ ${(it.input?.questions || []).map(q => q.question).join(' · ')}`, `> ${it.answered || _('(offen)')}`, ''); break;
      case 'plan': out.push(`> 📋 ${_('Plan')}`, '>', ...String(it.input?.plan || '').split('\n').map(l => '> ' + l), `> ${it.answered || _('(offen)')}`, ''); break;
      case 'recap': out.push(`> ※ Recap: ${it.text}`, ''); break;
      case 'sys': out.push(`*${it.text}*`, ''); break;
      case 'result': out.push(`<sub>${it.text}</sub>`, ''); break;
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
async function exportChat(t = currentTab()) {
  if (!t) return;
  // Chats eines Haupt-PCs: erst den ganzen Verlauf holen
  for (let i = 0; i < 200 && t.olderFrom != null; i++) { const before = t.olderFrom; await loadOlder(t); if (t.olderFrom === before) break; }
  const r = await api.exportChat({ name: t.title || 'Chat', content: chatMarkdown(t) });
  if (r?.ok) toast(_('Gespeichert: {p}', { p: r.path })); else if (r?.error) toast(r.error);
}
// /summary: Claude fasst zusammen (fester englischer Auftrag; die Sprechblase zeigt nur „/summary“)
async function summaryChat(t = currentTab()) {
  if (!t) return;
  if (!t.sessionId && !t.items.some(x => x.kind === 'me')) return toast(_('Noch nichts zum Zusammenfassen'));
  if (t.running) return toast(_('Bitte warten, bis Claude fertig ist'));
  appendItem(t, { kind: 'me', text: '/summary', time: Date.now() });
  t.running = true; t.updated = Date.now(); setTyping(t); updateComposer(); saveTabs(); renderList();
  await claudeSend(t, CLAUDE_TEXT.summary);
}
const plainTab = t => ({ id: t.id, hostTab: t.hostTab, profileId: t.profileId, cwd: t.cwd, sessionId: t.sessionId, model: t.model, effort: t.effort, permissionMode: t.permissionMode });

function autosize() { const i = $('#input'); i.style.height = 'auto'; i.style.height = Math.min(220, i.scrollHeight) + 'px'; }

// Einstellungen eines Chats ändern -> Prozess neu starten (setzt mit --resume fort)
async function changeTab(patch, note, t = currentTab()) {
  if (!t) return;
  if (t.mirror) { toast(_('Einstellungen dieses Chats ändert der Haupt-PC')); renderChat(); return; }
  if (t.running) { toast(_('Bitte warten, bis Claude fertig ist')); renderChat(); return; }
  Object.assign(t, patch);
  await tapi(t).session.restart(t.id);
  if (note) appendItem(t, { kind: 'sys', text: note });
  saveTabs(); renderList();
  rerenderTab(t);
}

// ---------- Modals ----------
function modal(cls, title, ...body) {
  const close = () => root.replaceChildren();
  const root = $('#modal-root');
  const bg = el('div', { class: 'modal-bg', onmousedown: e => { if (e.target === bg) close(); } },
    el('div', { class: 'modal ' + cls }, el('h2', {}, title, el('button', { class: 'x', onclick: close, title: _('Schließen') }, '×')), ...body));
  root.replaceChildren(bg);
  return { close, root: bg.firstChild };
}

function pickFolderModal(host = null) {
  const hs = host ? hostStores[host] : null;
  const favorites = hs ? hs.favorites : store.favorites;
  return new Promise(resolve => {
    let done = false;
    let profileId = hs ? hs.activeProfileId || hs.profiles[0]?.id : store.activeProfileId;
    const finish = cwd => { if (done) return; done = true; m.close(); resolve({ cwd, profileId }); };
    const chips = el('div', { class: 'acc-chips' });
    const drawChips = () => chips.replaceChildren(...hostProfiles(host).map(x => el('button', {
      class: 'acc-chip' + (x.id === profileId ? ' sel' : ''), title: status[pkey(host, x.id)]?.email || '',
      onclick: () => { profileId = x.id; drawChips(); },
    }, avatar(x, 'sm'), x.name, status[pkey(host, x.id)] && !status[pkey(host, x.id)].loggedIn ? el('span', { class: 'muted' }, ' (' + _('abgemeldet') + ')') : '')));
    drawChips();
    const m = modal('pickfolder', host ? _('Neuer Chat auf „{name}“', { name: hostName(host) }) : _('Neuer Chat'),
      el('div', { class: 'hint' }, _('Mit welchem Konto?')), chips,
      el('div', { class: 'hint' }, !host && project(activeProjectId()) ? _('Projekt: {name} – in welchem Ordner soll Claude arbeiten?', { name: project(activeProjectId()).name }) : _('In welchem Ordner soll Claude arbeiten?')),
      el('div', { class: 'pick' },
        host && hostProjectFilter[host] && hs.projects?.find(x => x.id === hostProjectFilter[host])?.cwd ? (() => { const hp = hs.projects.find(x => x.id === hostProjectFilter[host]); return el('button', { class: 'proj-folder', onclick: () => finish(hp.cwd) }, avatar(hp, 'sm'), el('div', {}, _('Projektordner'), el('small', {}, hp.cwd))); })() : null,
        !host && project(activeProjectId())?.cwd ? el('button', { class: 'proj-folder', onclick: () => finish(project(activeProjectId()).cwd) }, avatar(project(activeProjectId()), 'sm'), el('div', {}, _('Projektordner'), el('small', {}, project(activeProjectId()).cwd))) : null,
        ...favorites.map(f => el('button', { onclick: () => finish(f.path) }, el('div', { class: 'folder-ic' }, icon(ICONS.star)), el('div', {}, f.name, el('small', {}, f.path)))),
        // Fernzugriff: Ordner des Haupt-PCs zur Auswahl (ein Datei-Dialog dort ginge ins Leere)
        ...(hs ? (hs.allowedFolders || []).filter(p => !favorites.some(f => f.path === p)).slice(0, 40).map(p => el('button', { onclick: () => finish(p) }, el('div', { class: 'folder-ic' }, icon(ICONS.folder)), el('div', {}, baseName(p), el('small', {}, p))))
          : [el('button', { onclick: async () => { const d = await api.pickFolder(); if (d) finish(d); } }, el('div', { class: 'folder-ic' }, icon(ICONS.folder)), el('div', {}, _('Ordner auswählen …'), el('small', {}, _('beliebiges Projekt'))))]),
        hs?.scope.limited ? null : el('button', { onclick: () => finish('') }, el('div', { class: 'folder-ic' }, '~'), el('div', {}, _('Ohne Projekt'), el('small', {}, _('im Benutzerordner'))))));
    // Schließen über × oder Hintergrund = abbrechen
    new MutationObserver((_, obs) => { if (!$('.modal.pickfolder')) { obs.disconnect(); if (!done) { done = true; resolve(null); } } }).observe($('#modal-root'), { childList: true });
  });
}

function openAccounts() {
  modal('accounts', _('Konten'),
    el('div', { class: 'hint' }, _('Jedes Konto hat einen eigenen Konfigurationsordner. Du meldest dich einmal an und kannst danach mit einem Klick links in der Leiste wechseln.')),
    el('div', { id: 'acc-list' }),
    el('div', { class: 'row', style: 'margin-top:14px' },
      el('button', { class: 'primary', onclick: openAddProfile }, _('+ Konto hinzufügen')),
      el('button', { class: 'ghost', onclick: () => refreshStatus() }, _('Status aktualisieren'))));
  renderAccountsList();
}
function renderAccountsList() {
  const box = $('#acc-list'); if (!box) return;
  box.replaceChildren(...store.profiles.map(p => {
    const st = status[p.id];
    const name = el('div', { class: 'name' }, p.name, p.id === store.activeProfileId ? el('span', { class: 'muted', style: 'font-weight:400' }, '  · ' + _('aktiv')) : '');
    return el('div', { class: 'acc' },
      avatar(p),
      el('div', { class: 'meta' },
        name,
        el('div', { class: 'info' + (st?.claudeMissing ? ' warn' : '') }, stateText(st, true)),
        el('div', { class: 'info mono', title: p.configDir }, p.configDir)),
      el('div', { class: 'btns' },
        st?.loggedIn
          ? el('button', { class: 'ghost', onclick: async () => { if (!confirm(_('Konto „{name}“ abmelden?', { name: p.name }))) return; await api.profiles.logout(p.id); refreshStatus(p.id); } }, _('Abmelden'))
          : el('button', { class: 'primary', onclick: () => startLogin(p) }, _('Anmelden')),
        el('button', { class: 'ghost', title: _('Name und Farbe ändern'), onclick: () => openEditProfile(p) }, _('Bearbeiten')),
        p.isDefault ? null : el('button', { class: 'ghost danger', onclick: async () => {
          if (!confirm(_('Konto „{name}“ aus der App entfernen?\n\nDer Ordner {dir} bleibt erhalten.', { name: p.name, dir: p.configDir }))) return;
          store = await api.profiles.remove(p.id); renderRail(); renderAccountsList(); renderList(); renderUsage();
        } }, _('Entfernen'))));
  }));
}
// Anmeldung: `claude auth login` öffnet den System-Browser (Anthropics eigener Ablauf).
// Die App zeigt nur den Stand an und fragt danach `claude auth status` ab.
const loginState = {}; // profileId -> letzter Stand
function startLogin(p) {
  loginState[p.id] = { state: 'waiting' };
  api.profiles.login(p.id);
  openLoginModal(p);
}
function openLoginModal(p) {
  modal('login', _('Anmeldung'), el('div', { id: 'login-body', 'data-id': p.id }));
  renderLoginModal();
}
function renderLoginModal() {
  const box = $('#login-body'); if (!box) return;
  const p = profile(box.dataset.id); if (!p) return;
  const ls = loginState[p.id] || {};
  const parts = [el('div', { class: 'row' }, avatar(p), el('div', {}, el('b', {}, p.name), el('div', { class: 'hint' }, p.configDir)))];
  if (ls.state === 'waiting') {
    parts.push(
      el('div', { class: 'login-state' }, el('span', { class: 'spinner' }), _('Bitte im Browser anmelden …')),
      el('p', { class: 'hint' }, _('Claude Code hat deinen Standard-Browser mit der Anmeldeseite von Anthropic geöffnet. Melde dich dort mit dem gewünschten Konto an – danach geht es hier automatisch weiter. Die App sieht und speichert dabei keine Zugangsdaten.')),
      el('p', { class: 'hint' }, _('Tipp: Ist im Browser schon ein anderes Claude-Konto angemeldet, nutze ein privates Fenster oder melde dich dort vorher ab.')),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'ghost', title: _('Öffnet ein Konsolenfenster mit „claude auth login“ – dort den Code selbst eingeben'), onclick: () => { api.profiles.loginConsole(p.id); loginState[p.id] = { state: 'console' }; renderLoginModal(); } }, _('Code verlangt? Im Konsolenfenster anmelden')),
        el('button', { class: 'ghost danger', onclick: () => cancelLoginUI(p.id) }, _('Abbrechen'))));
  }
  if (ls.state === 'console') {
    parts.push(
      el('div', { class: 'login-state' }, _('Anmeldung läuft im Konsolenfenster')),
      el('p', { class: 'hint' }, _('Folge den Anweisungen im Konsolenfenster von Claude Code und gib den Code dort ein. Danach hier auf „Status prüfen“ klicken.')),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'primary', onclick: async () => {
          const st = await api.profiles.status(p.id);
          status[p.id] = st;
          loginState[p.id] = st.loggedIn ? { state: 'done', status: st } : { state: 'console', notYet: true };
          renderRail(); renderAccountsList(); renderLoginModal();
        } }, _('Status prüfen')),
        el('button', { class: 'ghost', onclick: openAccounts }, _('Zurück'))),
      ls.notYet ? el('p', { class: 'hint', style: 'color:var(--danger)' }, _('Noch nicht angemeldet.')) : null);
  }
  if (ls.state === 'done') {
    parts.push(el('div', { class: 'login-state ok' }, _('✓ Angemeldet'), ls.status?.email ? el('span', { class: 'muted' }, ' ' + _('als {email}', { email: ls.status.email })) : ''),
      el('div', { class: 'hint' }, [planLabel(ls.status || {}), ls.status?.orgName].filter(Boolean).join(' · ')),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'primary', onclick: async () => { $('#modal-root').replaceChildren(); await switchProfile(p.id); } }, _('Zu diesem Konto wechseln')),
        el('button', { class: 'ghost', onclick: openAccounts }, _('Zur Kontenübersicht'))));
  }
  if (ls.state === 'error' || ls.state === 'cancelled') {
    parts.push(el('div', { class: 'login-state err' }, ls.state === 'cancelled' ? _('Anmeldung abgebrochen.') : _('Anmeldung fehlgeschlagen.')),
      ls.error ? el('p', { class: 'hint' }, ls.error) : null,
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'primary', onclick: () => startLogin(p) }, _('Erneut versuchen')),
        el('button', { class: 'ghost', onclick: () => { api.profiles.loginConsole(p.id); loginState[p.id] = { state: 'console' }; renderLoginModal(); } }, _('Im Konsolenfenster anmelden')),
        el('button', { class: 'ghost', onclick: openAccounts }, _('Zurück'))));
  }
  fill(box, parts);
}
function cancelLoginUI(id) { api.profiles.loginCancel(id); loginState[id] = { state: 'cancelled' }; renderLoginModal(); }
// Dialog geschlossen (×, Hintergrund, Esc) -> laufende Anmeldung abbrechen
new MutationObserver(() => {
  const open = $('#login-body')?.dataset.id;
  for (const [id, ls] of Object.entries(loginState)) {
    if (ls.state === 'waiting' && id !== open) { api.profiles.loginCancel(id); loginState[id] = { state: 'cancelled' }; }
  }
}).observe($('#modal-root'), { childList: true, subtree: true });

api.onLogin(d => {
  const prev = loginState[d.id] || {};
  if (prev.state === 'cancelled' && d.state === 'error') return;
  loginState[d.id] = { ...prev, ...d };
  if (d.state === 'done') { status[d.id] = d.status; renderRail(); renderAccountsList(); toast(_('✓ {name} angemeldet', { name: profile(d.id)?.name || '' })); }
  renderLoginModal();
});

function profileForm(initial, onSave, saveLabel) {
  let color = initial.color || COLORS[store.profiles.length % COLORS.length];
  const name = el('input', { type: 'text', value: initial.name || '', placeholder: _('z. B. Privat, Arbeit, Kunde X') });
  const colors = el('div', { class: 'colors' });
  const drawColors = () => colors.replaceChildren(...COLORS.map(c => el('button', { class: c === color ? 'sel' : '', style: `background:${c}`, onclick: () => { color = c; drawColors(); } })));
  drawColors();
  const m = modal('profile', initial.id ? _('Konto bearbeiten') : _('Neues Konto'),
    el('label', { class: 'field' }, el('span', {}, _('Name')), name),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Farbe')), colors),
    initial.id ? null : el('div', { class: 'hint' }, _('Danach öffnet Claude Code deinen Browser mit der Anmeldeseite von Anthropic. Ist dort schon ein anderes Claude-Konto angemeldet, nutze ein privates Fenster.')),
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'primary', onclick: async () => { if (!name.value.trim()) return name.focus(); await onSave({ name: name.value.trim(), color }); m.close(); } }, saveLabel)));
  name.focus();
  name.addEventListener('keydown', e => { if (e.key === 'Enter') m.root.querySelector('.primary').click(); });
}
function openAddProfile() {
  profileForm({}, async data => {
    store = await api.profiles.add(data);
    const p = store.profiles[store.profiles.length - 1];
    status[p.id] = { loggedIn: false };
    renderRail();
    startLogin(p);
  }, _('Anlegen und anmelden'));
}
function openEditProfile(p) {
  profileForm(p, async data => { store = await api.profiles.update(p.id, data); renderRail(); renderList(); renderChat(); openAccounts(); }, _('Speichern'));
}

// Ton-Auswahl: Vorschau beim Wechseln; „on“ aus älteren Versionen wird als Glocke angezeigt
// ---------- Erweiterungen: Plugins (installiert / verfügbar) und Skills & Befehle des aktiven Kontos ----------
let extState = { tab: 'installed', data: null, q: '', busy: '' };
async function openExtensions(tab) {
  if (tab) extState.tab = tab;
  const pid = store.activeProfileId;
  const p = profile(pid);
  const body = el('div', { class: 'ext-body' });
  const head = el('div', { class: 'ext-head' });
  modal('extensions', _('Erweiterungen'), el('div', { class: 'hint' }, _('Konto: {name} – Plugins und Skills gelten pro Konto. Änderungen wirken in neuen bzw. neu gestarteten Chats.', { name: p.name })), head, body);
  const search = el('input', { type: 'search', class: 'ext-search', placeholder: _('Suchen …'), value: extState.q });
  search.addEventListener('input', () => { extState.q = search.value; draw(); });
  const tabsEl = el('div', { class: 'seg ext-seg' });
  const drawTabs = () => fill(tabsEl, [['installed', _('Installiert')], ['available', _('Verfügbar')], ['skills', _('Skills & Befehle')]].map(([k, l]) =>
    el('button', { class: extState.tab === k ? 'active' : '', onclick: () => {
      extState.tab = k; drawTabs(); draw();
      // Befehlsliste nachladen und danach neu zeichnen, falls sie noch fehlt
      if (k === 'skills' && !modelInfo[pid]?.commands) loadModels(pid).then(() => { if (extState.tab === 'skills' && $('.modal.extensions')) draw(); });
    } }, l)));
  drawTabs();
  fill(head, tabsEl, search);
  const match = (...s) => !extState.q || s.some(x => (x || '').toLowerCase().includes(extState.q.toLowerCase()));
  const act = async (action, id) => {
    extState.busy = id; draw();
    const r = await api.extensions.action(pid, action, id);
    extState.busy = '';
    if (r.cancelled) return draw();
    toast(r.ok ? '✓ ' + id + ': ' + { install: _('installiert'), uninstall: _('entfernt'), enable: _('aktiviert'), disable: _('deaktiviert') }[action] : _('Fehler: {e}', { e: r.error }));
    extState.data = null; delete modelInfo[pid]; loadModels(pid);
    load();
  };
  function draw() {
    const d = extState.data;
    if (extState.tab === 'skills') {
      const cmds = (modelInfo[pid]?.commands || []).filter(c => match(c.name, c.description));
      const plugin = cmds.filter(c => c.name.includes(':')), own = cmds.filter(c => !c.name.includes(':'));
      const row = c => el('div', { class: 'ext-row' }, el('div', { class: 'ext-text' }, el('b', { class: 'mono' }, '/' + c.name), el('small', {}, c.description || '–')),
        el('button', { class: 'ghost', title: _('Im Eingabefeld einfügen'), onclick: () => { $('#modal-root').replaceChildren(); const i = $('#input'); if (i) { i.value = '/' + c.name + ' '; i.focus(); autosize(); } } }, _('Verwenden')));
      return fill(body, !modelInfo[pid] ? el('div', { class: 'list-empty' }, _('Wird geladen …')) : [
        el('div', { class: 'list-section' }, _('Aus Plugins ({n})', { n: plugin.length })), plugin.map(row),
        el('div', { class: 'list-section' }, _('Eingebaut und eigene Skills ({n})', { n: own.length })), own.map(row)]);
    }
    if (!d) return fill(body, el('div', { class: 'list-empty' }, _('Lade Plugins über Claude Code …')));
    if (d.error) return fill(body, el('div', { class: 'list-empty' }, _('Fehler: {e}', { e: d.error })));
    if (extState.tab === 'installed') {
      const list = d.installed.filter(x => match(x.id));
      return fill(body, list.length ? list.map(x => el('div', { class: 'ext-row' + (x.enabled ? '' : ' off') },
        el('div', { class: 'ext-text' }, el('b', {}, x.id.split('@')[0]),
          el('small', {}, [x.id.split('@')[1], x.version && x.version !== 'unknown' ? 'v' + x.version : null, x.scope === 'project' ? _('Projekt') : null, x.mcp.length ? 'MCP: ' + x.mcp.join(', ') : null, x.enabled ? _('aktiv') : _('deaktiviert')].filter(Boolean).join(' · '))),
        extState.busy === x.id ? el('span', { class: 'spinner' }) : [
          el('button', { class: 'ghost', onclick: () => act(x.enabled ? 'disable' : 'enable', x.id) }, x.enabled ? _('Deaktivieren') : _('Aktivieren')),
          el('button', { class: 'ghost danger', onclick: () => act('uninstall', x.id) }, _('Entfernen'))])) : el('div', { class: 'list-empty' }, _('Keine Plugins installiert.')));
    }
    const inst = new Set(d.installed.map(x => x.id));
    const list = d.available.filter(x => match(x.id, x.name, x.description)).slice(0, 150);
    fill(body, el('div', { class: 'hint' }, _('{n} Plugins aus den Marktplätzen von Claude Code', { n: d.available.length }) + (list.length === 150 ? ' – ' + _('zeige die ersten 150, Suche grenzt ein') : '')),
      list.map(x => el('div', { class: 'ext-row' }, el('div', { class: 'ext-text' }, el('b', {}, x.name || x.id), el('small', {}, x.description || x.id)),
        inst.has(x.id) ? el('span', { class: 'ext-badge' }, _('✓ installiert'))
          : extState.busy === x.id ? el('span', { class: 'spinner' }) : el('button', { class: 'ghost', onclick: () => act('install', x.id) }, _('Installieren')))));
  }
  async function load() {
    draw();
    if (!modelInfo[pid]) loadModels(pid).then(() => { if (extState.tab === 'skills') draw(); });
    if (!extState.data) { const d = await api.extensions.list(pid); extState.data = d; }
    if ($('.modal.extensions')) draw();
  }
  load();
}
function soundSelect() {
  const opts = [['off', _('Kein Ton')], ...Object.entries(SOUNDS).map(([k, s]) => [k, _(s.label)]), ['system', _('Windows-Standard')]];
  const e = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: soundSetting() === v }, l)));
  e.addEventListener('change', async () => {
    const r = await api.setSettings({ sound: e.value });
    if (r.rejected) { e.value = soundSetting(); return toast(_('Nicht übernommen')); }
    store = r; playSound(e.value);
  });
  return e;
}
function openSettings() {
  const s = store.settings;
  const pid = store.activeProfileId;
  const defName = defaultModelName(pid);
  const defEff = modelInfo[pid]?.effortLevel;
  const modelOpts = (modelInfo[pid]?.models || []).filter(m => m.value !== 'default').map(m => [m.value, m.displayName]);
  if (!modelOpts.length) modelOpts.push(['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']);
  const sel = (key, opts) => {
    const e = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: (s[key] || '') === v }, l)));
    e.addEventListener('change', async () => {
      const r = await api.setSettings({ [key]: e.value }); // „Alles erlauben“ bestätigt der Hauptprozess per Dialog
      store = r;
      if (r.rejected) { e.value = s[key] || ''; toast(_('Nicht übernommen')); return; }
      if (key === 'theme') applyTheme();
      if (key === 'toolView') renderMessages();
    });
    return e;
  };
  // Sprache der Oberfläche: wird beim Neuladen übernommen (sofort, wenn gerade kein Chat arbeitet)
  const langSel = el('select', {}, [['auto', _('Wie System')], ['de', 'Deutsch'], ['en', 'English'], ['tr', 'Türkçe']].map(([v, l]) => el('option', { value: v, selected: (s.language || 'auto') === v }, l)));
  langSel.addEventListener('change', async () => {
    const r = await api.setSettings({ language: langSel.value });
    if (r.rejected) { langSel.value = s.language || 'auto'; return toast(_('Nicht übernommen')); }
    store = r;
    if (!tabs.some(t => t.running || bgRunning(t))) location.reload();
    else toast(_('Sprache wird beim nächsten Start übernommen'));
  });
  // Pfad zu claude.exe nur per Datei-Dialog (der Hauptprozess prüft den Dateinamen)
  const path = el('div', { class: 'folder-row' });
  const drawPath = () => fill(path,
    el('span', { class: 'mono ' + (store.settings.claudePath ? '' : 'muted') }, store.settings.claudePath || _('automatisch (~/.local/bin/claude.exe oder PATH)')),
    el('button', { class: 'ghost', onclick: async () => { const r = await api.pickClaude(); store = r; if (r.rejected) toast(r.rejected); drawPath(); } }, _('Wählen …')),
    store.settings.claudePath ? el('button', { class: 'ghost', onclick: async () => { store = await api.setSettings({ claudePath: '' }); drawPath(); } }, _('Automatisch')) : null);
  drawPath();
  modal('settings', _('Einstellungen'),
    el('label', { class: 'field' }, el('span', {}, _('Sprache')), langSel),
    el('label', { class: 'field' }, el('span', {}, _('Darstellung')), sel('theme', [['system', _('Wie System')], ['light', _('Hell')], ['dark', _('Dunkel')]])),
    el('label', { class: 'field' }, el('span', {}, _('Modell für neue Chats')), sel('model', [['', _('Standard') + (defName ? ' · ' + defName : ' ' + _('(laut Konto)'))], ...modelOpts])),
    el('label', { class: 'field' }, el('span', {}, _('Aufwand für neue Chats')), sel('effort', [['', _('Standard') + (defEff ? ' · ' + effortName(defEff) : ' ' + _('(laut Konto)'))], ...Object.keys(EFFORT_LABEL).map(k => [k, effortName(k)])])),
    el('p', { class: 'hint' }, _('„Standard“ richtet sich nach dem Konto: Modell laut Claude-Empfehlung, Aufwand laut effortLevel in den Claude-Einstellungen des Kontos.')),
    el('label', { class: 'field' }, el('span', {}, _('Berechtigungen für neue Chats')), sel('permissionMode', [['default', _('Nachfragen')], ['acceptEdits', _('Änderungen erlauben')], ['plan', _('Nur planen')], ['bypassPermissions', _('Alles erlauben (--dangerously-skip-permissions)')]])),
    store.bypassAcknowledged ? el('div', { class: 'row' },
      el('span', { class: 'hint', style: 'flex:1' }, _('Die Warnung zu „Alles erlauben“ wurde bestätigt und erscheint nicht mehr.')),
      el('button', { class: 'ghost', onclick: async e => { store = await api.resetBypassWarning(); e.target.closest('.row').remove(); toast(_('Warnung erscheint beim nächsten Mal wieder')); } }, _('Wieder anzeigen'))) : null,
    (() => { const cb = el('input', { type: 'checkbox', checked: emojiOn() }); cb.onchange = async () => { store = await api.setSettings({ emoji: cb.checked }); renderMessages(); };
      return el('label', { class: 'row', style: 'margin:6px 0 10px' }, cb, _('Smileys in Emojis umwandeln (:D → 😄, ;) → 😉, <3 → ❤️)')); })(),
    el('label', { class: 'field' }, el('span', {}, _('Werkzeug-Aufrufe im Chat (Befehle, Lesen, Bearbeiten …)')), sel('toolView', [['all', _('Alle anzeigen')], ['compact', _('Kompakt – zu einer Zeile zusammengefasst')], ['hidden', _('Ausblenden – nur Nachrichten und Antworten')]])),
    el('label', { class: 'field' }, el('span', {}, _('Benachrichtigung bei fertiger Antwort')), sel('notify', [['background', _('Wenn der Chat nicht im Blick ist (Standard)')], ['always', _('Immer')], ['off', _('Aus')]])),
    el('div', { class: 'row' },
      el('label', { class: 'field', style: 'flex:1;margin:0' }, el('span', {}, _('Ton')), soundSelect()),
      el('label', { class: 'field', style: 'flex:1;margin:0' }, el('span', {}, _('Anzeige')), sel('notifyStay', [['sticky', _('Bleibt, bis ich klicke')], ['auto', _('Verschwindet von selbst')]])),
      el('button', { class: 'ghost', style: 'align-self:flex-end', title: _('Benachrichtigung und Ton jetzt ausprobieren'), onclick: () => {
        api.notify({ title: 'Swapline', body: _('So sieht eine Benachrichtigung aus.'), silent: soundSetting() !== 'system' });
        playSound();
      } }, _('Testen'))),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, _('Pfad zu Claude Code (claude.exe)')), path),
    el('div', { class: 'row' },
      el('label', { class: 'field', style: 'flex:1;margin:0' }, el('span', {}, _('Updates')), (() => {
        const mode = s.updateMode || 'notify';
        const e = el('select', { disabled: !updateInfo.supported }, [['notify', _('Nur benachrichtigen (Standard)')], ['auto', _('Automatisch laden und beim Neustart installieren')], ['off', _('Aus')]].map(([v, l]) => el('option', { value: v, selected: mode === v }, l)));
        e.addEventListener('change', async () => { store = await api.setSettings({ updateMode: e.value }); });
        return e;
      })()),
      el('button', { class: 'ghost', style: 'align-self:flex-end', disabled: !updateInfo.supported, onclick: () => api.update.check() }, _('Jetzt prüfen')),
      el('button', { id: 'update-restart', class: 'primary', style: 'align-self:flex-end', hidden: !['ready', 'available'].includes(updateInfo.status), onclick: installUpdate }, updateInfo.status === 'ready' ? _('Jetzt neu starten') : _('Herunterladen'))),
    el('p', { class: 'hint', id: 'update-info' }, updateText()),
    el('p', { class: 'hint' }, _('Swapline fragt dazu nur bei GitHub (github.com/ARFEP-IT-Service/Swapline) nach neuen Versionen – ohne Konto- oder Nutzungsdaten.')),
    el('div', { class: 'about' },
      el('img', { src: BRAND.logo(isDark()), alt: 'ARFEP' }),
      el('div', {},
        el('p', {}, el('b', {}, `Swapline ${VERSION}`), ' – Open Source (MIT)'),
        el('p', { class: 'muted' }, `by ${BRAND.company}, ${BRAND.city}`),
        el('p', {}, el('a', { href: BRAND.website, style: 'color:var(--accent)' }, 'arfep.de'), ' · ',
          el('a', { href: BRAND.contact, style: 'color:var(--accent)' }, _('IT-Hilfe anfragen')), ' · ',
          el('a', { href: BRAND.repo, style: 'color:var(--accent)' }, 'GitHub')))),
    el('p', { class: 'hint' }, _('Inoffizielles Projekt, nicht mit Anthropic verbunden. „Claude“ ist eine Marke von Anthropic.')));
}

// ---------- Fernzugriff ----------
// Dieser PC als Haupt-PC (andere Geräte verbinden sich) bzw. Verbindung zu einem Haupt-PC. Im Fernzugriff
// zeigt Swapline Chats und Konten des Haupt-PCs; Claude läuft dort.
let remoteState = null, pairCode = null, remoteTimer = null;
let pairQrUrl = null; // QR-Code (SVG vom Hauptprozess) für die Swapline-App auf dem Handy
let pairLinkText = null; // Kopplungslink (wie im QR-Code) für einen anderen PC
async function openRemote() {
  remoteState = await api.remote.info();
  modal('remote', _('Fernzugriff'), el('div', { id: 'remote-body' }));
  drawRemote();
  clearInterval(remoteTimer);
  // Countdown des Kopplungscodes; endet, sobald das Fenster zu ist
  remoteTimer = setInterval(() => { if (!$('.modal.remote')) { clearInterval(remoteTimer); if (pairCode) api.remote.pairCancel(); pairCode = null; return; } if (pairCode) drawRemote(); }, 1000);
}
// Freigabe je Gerät: Konten, Projekte, einzelne Chats (durchgesetzt vom Haupt-PC bei jeder Anfrage)
function scopeText(sc) {
  if (!sc || (sc.profiles === null && sc.projects === null)) return _('alles');
  const parts = [];
  if (sc.profiles !== null) parts.push(sc.profiles.length === 1 ? _('1 Konto') : _('{n} Konten', { n: sc.profiles.length }));
  if (sc.projects !== null) {
    parts.push(sc.projects.length === 1 ? _('1 Projekt') : _('{n} Projekte', { n: sc.projects.length }));
    parts.push(sc.chats.length === 1 ? _('1 Chat') : _('{n} Chats', { n: sc.chats.length }));
  }
  return parts.join(', ');
}
// Verlauf aller Konten dieses PCs (für die Chat-Auswahl): sessionId -> { title, profile, cwd }
async function allHistory() {
  const map = new Map();
  for (const p of store.profiles) for (const h of await api.history.list(p.id)) map.set(h.sessionId, { ...h, profile: p });
  return map;
}
async function openScopeEditor(d) {
  const sc = { profiles: d.scope.profiles === null ? null : [...d.scope.profiles], projects: d.scope.projects === null ? null : [...d.scope.projects], chats: [...d.scope.chats] };
  const hist = await allHistory();
  const box = el('div', {});
  const radio = (name, checked, label, onpick) => { const r = el('input', { type: 'radio', name, checked }); r.onchange = () => { onpick(); draw(); }; return el('label', { class: 'row' }, r, label); };
  const check = (checked, label, onchange, disabled = false) => { const c = el('input', { type: 'checkbox', checked, disabled }); c.onchange = () => onchange(c.checked); return el('label', { class: 'row' + (disabled ? ' muted' : '') }, c, label); };
  const toggleIn = (list, id, on) => (on ? [...new Set([...list, id])] : list.filter(x => x !== id));
  let query = '';
  function draw() {
    const picks = [...hist.values()].filter(h => !sc.chats.includes(h.sessionId) && (!query || (h.title + ' ' + h.cwd).toLowerCase().includes(query))).slice(0, 12);
    const search = el('input', { type: 'text', placeholder: _('Chat suchen …'), value: query });
    search.oninput = () => { query = search.value.trim().toLowerCase(); const pos = search.selectionStart; draw(); const s2 = box.querySelector('input[type=text]'); s2.focus(); s2.setSelectionRange(pos, pos); };
    fill(box,
      el('h3', {}, _('Konten')),
      radio('sc-acc', sc.profiles === null, _('Alle Konten'), () => { sc.profiles = null; }),
      radio('sc-acc', sc.profiles !== null, _('Nur ausgewählte Konten'), () => { sc.profiles ??= store.profiles.map(p => p.id); }),
      sc.profiles !== null ? el('div', { class: 'scope-list' }, ...store.profiles.map(p => check(sc.profiles.includes(p.id), [avatar(p, 'sm'), p.name], on => { sc.profiles = toggleIn(sc.profiles, p.id, on); }))) : null,
      el('h3', { style: 'margin-top:14px' }, _('Projekte und Chats')),
      radio('sc-cont', sc.projects === null, _('Alle Projekte und Chats'), () => { sc.projects = null; }),
      radio('sc-cont', sc.projects !== null, _('Nur ausgewählte Projekte und Chats'), () => { sc.projects ??= []; }),
      sc.projects !== null ? el('div', { class: 'scope-list' },
        el('p', { class: 'hint' }, _('Projekte: alle Chats in ihrem Ordner, neue Chats nur dort. Chats: nur diese einzelnen Chats fortsetzen.')),
        ...(store.projects.length ? store.projects.map(pr => check(sc.projects.includes(pr.id), [avatar(pr, 'sm'), pr.name, el('small', { class: 'muted' }, ' ' + (pr.cwd || _('(ohne Ordner – nicht freigebbar)')))], on => { sc.projects = toggleIn(sc.projects, pr.id, on); }, !pr.cwd)) : [el('p', { class: 'hint' }, _('Noch keine Projekte.'))]),
        el('div', { class: 'hint', style: 'margin-top:8px' }, _('Einzelne Chats:')),
        ...sc.chats.map(id => { const h = hist.get(id); return el('div', { class: 'dev-row' }, el('div', { class: 'grow' }, el('b', {}, h?.title || id.slice(0, 8)), el('small', {}, h ? h.profile.name + ' · ' + baseName(h.cwd) : _('nicht mehr im Verlauf'))), el('button', { class: 'ghost', onclick: () => { sc.chats = sc.chats.filter(x => x !== id); draw(); } }, '×')); }),
        search,
        ...picks.map(h => el('button', { class: 'pick-chat', onclick: () => { sc.chats = [...sc.chats, h.sessionId]; draw(); } }, '+ ', el('b', {}, h.title), el('small', { class: 'muted' }, ' · ' + h.profile.name + ' · ' + baseName(h.cwd))))) : null,
      el('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' },
        el('button', { class: 'ghost', onclick: () => openRemote() }, _('Abbrechen')),
        el('button', { class: 'primary', onclick: async () => {
          const res = await api.remote.deviceSet({ id: d.id, scope: sc });
          if (res.error) return toast(res.error);
          remoteState = res; toast(_('Freigabe gespeichert')); openRemote();
        } }, _('Speichern'))));
  }
  modal('remote scope', _('Freigabe für „{name}“', { name: d.name }), box);
  draw();
}
// Rechtsklick auf einen Chat: einzeln für ein Gerät freigeben
async function openShareChat(t) {
  remoteState = await api.remote.info();
  const box = el('div', {});
  const draw = () => fill(box, ...remoteState.host.devices.map(d => {
    const sc = d.scope, all = sc.projects === null && (sc.profiles === null || sc.profiles.includes(t.profileId));
    const viaProject = !all && sc.projects !== null && store.projects.some(p => p.cwd && sc.projects.includes(p.id) && (t.cwd || '').toLowerCase().startsWith(p.cwd.toLowerCase()));
    const accountOk = sc.profiles === null || sc.profiles.includes(t.profileId);
    const c = el('input', { type: 'checkbox', checked: all || viaProject || sc.chats.includes(t.sessionId), disabled: all || viaProject || !accountOk || sc.projects === null });
    c.onchange = async () => {
      const chats = c.checked ? [...new Set([...sc.chats, t.sessionId])] : sc.chats.filter(x => x !== t.sessionId);
      const res = await api.remote.deviceSet({ id: d.id, scope: { ...sc, chats } });
      if (res.error) toast(res.error); else remoteState = res;
      draw();
    };
    return el('label', { class: 'dev-row' }, c, el('div', { class: 'grow' }, el('b', {}, d.name),
      el('small', {}, all ? _('hat Zugriff auf alles') : !accountOk ? _('Konto dieses Chats nicht freigegeben') : viaProject ? _('freigegeben über das Projekt') : _('Freigabe: {s}', { s: scopeText(sc) }))));
  }));
  modal('remote', _('Chat „{name}“ freigeben', { name: t.title || _('Neuer Chat') }), el('p', { class: 'hint' }, _('Gekoppelte Geräte, die nur ausgewählte Inhalte sehen, können diesen Chat dann fortsetzen.')), box);
  draw();
}
// Vermittler: Erreichbarkeit von unterwegs ohne Portfreigabe (eigener Server mit relay/relay.js)
function relaySection(h) {
  const r = h.relay || {};
  const on = el('input', { type: 'checkbox', checked: !!r.enabled });
  const addr = el('input', { type: 'text', placeholder: _('Adresse des Vermittlers (IP oder Name)'), value: r.address || '', style: 'flex:1' });
  const port = el('input', { type: 'number', min: '1', max: '65535', value: String(r.port || 47821), style: 'width:100px' });
  const state = r.state === 'connected' ? _('verbunden') : r.state === 'connecting' ? _('verbinde …') : r.state === 'pending' ? _('wartet auf „Erlauben“ in Swapline Relay') : r.state === 'error' ? (r.detail || _('Fehler')) : _('aus');
  const save = async () => {
    remoteState = await api.remote.relaySet({ enabled: on.checked, address: addr.value, port: Number(port.value) });
    if (remoteState.error) toast(remoteState.error);
    drawRemote();
  };
  on.onchange = save;
  const code = el('input', { type: 'text', placeholder: _('Einrichtungscode aus „Swapline Relay“ einfügen'), style: 'flex:1', autocomplete: 'off' });
  const useCode = async () => {
    remoteState = await api.remote.relayCode(code.value);
    code.value = '';
    toast(remoteState.error || _('Vermittler eingerichtet'));
    drawRemote();
  };
  return el('div', { class: 'relay-box' },
    el('div', { class: 'row' }, el('label', { class: 'row' }, on, _('Über Vermittler erreichbar (ohne Portfreigabe)')),
      el('span', { class: 'hint', style: r.state === 'error' ? 'color:var(--danger)' : r.state === 'pending' ? 'color:var(--warn, #D97706)' : '' }, r.enabled ? state : '')),
    el('p', { class: 'hint' }, _('Eigener Server mit der App „Swapline Relay“. Die Verbindung bleibt Ende-zu-Ende verschlüsselt; der Vermittler sieht keine Inhalte.')),
    r.legacy ? el('p', { class: 'hint', style: 'color:var(--danger)' }, _('Der alte Einrichtungscode gilt nicht mehr. In Swapline Relay (ab 0.3.0) unter „Haupt-PCs“ einen Code für diesen PC erzeugen, hier einfügen und dort „Erlauben“ klicken.')) : null,
    el('div', { class: 'row' }, code, el('button', { class: 'primary', onclick: useCode }, _('Übernehmen'))),
    r.hasKey ? el('div', {}, el('p', { class: 'hint' }, _('Adresse ändern (z. B. anderer DNS-Name):')),
      el('div', { class: 'row' }, addr, port, el('button', { class: 'ghost', onclick: save }, _('Speichern')))) : null);
}
function drawRemote() {
  const box = $('#remote-body'); if (!box || !remoteState) return;
  const r = remoteState, h = r.host;
  if (!r.available) return fill(box, el('p', { class: 'hint' }, _('Fernzugriff braucht den verschlüsselten Windows-Speicher – er ist auf diesem PC nicht verfügbar.')));
  if (!h.pairingExpires) { pairCode = null; pairQrUrl = null; pairLinkText = null; }
  const portIn = el('input', { type: 'number', min: '1024', max: '65535', value: String(h.port), style: 'width:100px' });
  const setHost = async enabled => { remoteState = await api.remote.hostSet({ enabled, port: Number(portIn.value) }); if (remoteState.error) toast(remoteState.error); drawRemote(); };
  const toggle = el('input', { type: 'checkbox', checked: h.enabled });
  toggle.onchange = () => setHost(toggle.checked);
  portIn.onchange = () => { if (h.enabled) setHost(true); };
  const left = h.pairingExpires ? Math.max(0, Math.round((h.pairingExpires - Date.now()) / 1000)) : 0;
  const relayOk = h.running && h.relay?.enabled && h.relay.state === 'connected';
  const host = [
    el('h3', {}, _('Dieser PC als Haupt-PC')),
    el('p', { class: 'hint' }, _('Andere eigene Geräte mit Swapline können sich verbinden und alle Chats und Konten dieses PCs nutzen; Claude läuft dabei hier. Die Verbindung ist verschlüsselt, jedes Gerät wird einmal mit einem Code gekoppelt.')),
    el('div', { class: 'row' }, el('label', { class: 'row' }, toggle, _('Fernzugriff erlauben')), el('span', { class: 'hint' }, _('Port')), portIn,
      h.enabled && !h.running ? el('span', { class: 'hint', style: 'color:var(--danger)' }, _('nicht gestartet')) : null),
    h.enabled ? null : el('p', { class: 'hint' }, _('Für den Zugriff von anderen Geräten – auch von unterwegs über einen Vermittler – zuerst „Fernzugriff erlauben“. Am Router muss dafür nichts geöffnet werden.')),
    h.running ? el('p', { class: 'hint' }, _('Erreichbar unter: {list} · Port {port}', { list: h.addresses.map(a => a.address + (a.tailscale ? ' (Tailscale)' : '')).join(', ') || '–', port: h.listenPort })) : null,
    relayOk ? el('p', { class: 'hint', style: 'color:var(--ok)' }, _('Von unterwegs: über Vermittler ✓ – keine Portfreigabe nötig')) : null,
    h.running && h.publicAddress && !relayOk ? el('p', { class: 'hint' }, h.publicAddress.address
      ? _('Internet: {ip} – von unterwegs nur mit Portfreigabe {port} (TCP) am Router auf diesen PC.', { ip: h.publicAddress.address, port: h.listenPort })
      : h.publicAddress.found ? _('Internet: Der Anschluss hat keine eigene öffentliche IPv4-Adresse (z. B. DS-Lite) – von unterwegs nur per VPN (z. B. Tailscale).')
        : _('Internet: Öffentliche Adresse nicht ermittelt (Router ohne UPnP-Statusinformationen).')) : null,
    h.running ? relaySection(h) : null,
    h.running && !relayOk ? el('p', { class: 'hint' }, _('Übers Internet: am besten mit Tailscale (beide PCs im selben Tailnet, Adresse 100.x.x.x). Alternativ am Router den Port weiterleiten und die öffentliche Adresse oder einen DynDNS-Namen verwenden.')) : null,
    h.running ? (pairCode && left > 0
      ? el('div', {}, el('p', { class: 'hint' }, _('Auf dem anderen Gerät unter „Mit einem Haupt-PC verbinden“ eingeben (noch {s} s gültig, nur einmal):', { s: left })),
        el('div', { class: 'row' }, el('div', { class: 'pair-code' }, pairCode), el('button', { class: 'ghost', onclick: () => { api.copyText(pairCode); toast(_('Code kopiert')); } }, _('Kopieren')),
          pairLinkText ? el('button', { class: 'ghost', title: _('Enthält Adressen und Vermittler – am anderen PC unter „Mit einem Haupt-PC verbinden“ einfügen'), onclick: () => { api.copyText(pairLinkText); toast(_('Kopplungslink kopiert')); } }, _('Kopplungslink kopieren')) : null,
          el('button', { class: 'ghost', onclick: async () => { await api.remote.pairCancel(); pairCode = null; pairQrUrl = null; remoteState = await api.remote.info(); drawRemote(); } }, _('Abbrechen'))),
        pairQrUrl ? el('div', { class: 'pair-qr' }, el('img', { src: pairQrUrl, alt: _('QR-Code zum Koppeln') }), el('p', { class: 'hint' }, _('Oder mit der Swapline-App auf dem Handy scannen (Haupt-PC koppeln → QR-Code scannen).'))) : null)
      : el('button', { class: 'primary', onclick: async () => { const p = await api.remote.pairStart(); if (p.error) return toast(p.error); pairCode = p.code; pairLinkText = typeof p.link === 'string' && p.link.startsWith('swapline://pair?') ? p.link : null; pairQrUrl = typeof p.qr === 'string' && p.qr.startsWith('data:image/svg+xml;base64,') ? p.qr : null; remoteState = await api.remote.info(); drawRemote(); } }, _('Gerät koppeln …'))) : null,
    ...h.devices.map(d => {
      const bypass = el('input', { type: 'checkbox', checked: d.allowBypass });
      bypass.onchange = async () => { remoteState = await api.remote.deviceSet({ id: d.id, allowBypass: bypass.checked }); drawRemote(); };
      const bang = el('input', { type: 'checkbox', checked: d.allowBang });
      bang.onchange = async () => { remoteState = await api.remote.deviceSet({ id: d.id, allowBang: bang.checked }); drawRemote(); };
      const projAllow = el('input', { type: 'checkbox', checked: d.allowProjects });
      projAllow.onchange = async () => { remoteState = await api.remote.deviceSet({ id: d.id, allowProjects: projAllow.checked }); drawRemote(); };
      const srvAllow = el('input', { type: 'checkbox', checked: d.allowServers });
      srvAllow.onchange = async () => { remoteState = await api.remote.deviceSet({ id: d.id, allowServers: srvAllow.checked }); drawRemote(); };
      return el('div', { class: 'dev-row' }, el('span', { class: 'dot' + (d.connected ? ' on' : '') }),
        el('div', { class: 'grow' }, el('b', {}, d.name), el('small', {}, d.connected ? _('verbunden') : d.lastSeen ? _('zuletzt {t}', { t: new Date(d.lastSeen).toLocaleString(locale()) }) : _('noch nie verbunden'), d.lastAddress ? ' · ' + d.lastAddress : ''),
          el('small', {}, _('Freigabe: {s}', { s: scopeText(d.scope) }))),
        el('button', { class: 'ghost', onclick: () => openScopeEditor(d) }, _('Freigabe …')),
        el('label', { class: 'row risk-right', title: _('Darf Chats mit „Alles erlauben“ (--dangerously-skip-permissions) starten') }, bypass, _('„Alles erlauben“')),
        el('label', { class: 'row risk-right', title: _('Darf „!“-Befehle direkt auf diesem PC ausführen (ohne Claude, ohne Rückfrage)') }, bang, _('„!“-Befehle')),
        el('label', { class: 'row', title: _('Darf auf diesem PC Projekte und Ordner anlegen und umbenennen (nicht löschen)') }, projAllow, _('Projekte anlegen')),
        el('label', { class: 'row', title: _('Darf die SSH-Server dieses PCs nutzen (Chats laufen über diesen PC, der PC muss an sein)') }, srvAllow, _('SSH-Server')),
        el('button', { class: 'ghost danger', onclick: async () => { if (!confirm(_('Gerät „{name}“ entfernen? Es kann sich danach nicht mehr verbinden.', { name: d.name }))) return; remoteState = await api.remote.deviceRemove(d.id); drawRemote(); } }, _('Entfernen')));
    }),
  ];
  const addr = el('input', { type: 'text', placeholder: _('Adresse (IP oder Name)'), style: 'flex:1' });
  const port = el('input', { type: 'number', min: '1024', max: '65535', value: '47820', style: 'width:100px' });
  const code = el('input', { type: 'text', placeholder: _('Kopplungscode oder Kopplungslink'), style: 'flex:1;font-family:ui-monospace,Consolas,monospace', autocomplete: 'off' });
  // Kopplungslink enthält Adressen, Port und Vermittler – dann braucht es keine Adresse
  code.oninput = () => { const link = code.value.trim().startsWith('swapline://'); addr.disabled = link; port.disabled = link; };
  const pairBtn = el('button', { class: 'primary', onclick: async () => {
    pairBtn.disabled = true; pairBtn.textContent = _('Warte auf Bestätigung am Haupt-PC …');
    const v = code.value.trim();
    const res = await api.remote.pair(v.startsWith('swapline://') ? { link: v } : { address: addr.value, port: Number(port.value), code: v });
    remoteState = res;
    if (res.error) { toast(res.error); drawRemote(); return; }
    toast(_('Gekoppelt'));
    drawRemote();
  } }, _('Koppeln'));
  const client = [
    el('h3', { style: 'margin-top:16px' }, _('Mit einem Haupt-PC verbinden')),
    ...r.hosts.filter(x => x.kind !== 'ssh').map(x => el('div', { class: 'dev-row' }, el('span', { class: 'dot' + (x.state === 'connected' ? ' on' : '') }),
      el('div', { class: 'grow' }, el('b', {}, x.name), el('small', {}, `${x.address}:${x.port}` + (x.relay ? ' · ' + _('Vermittler') : '') + ' · ' + (x.state === 'connected' ? (x.via === 'relay' ? _('verbunden über Vermittler') : _('verbunden')) : x.state === 'connecting' || x.state === 'reconnecting' ? _('verbinde …') : _('nicht verbunden')))),
      el('button', { class: 'primary', onclick: () => { $('#modal-root').replaceChildren(); switchProject('host:' + x.id); } }, _('Chats zeigen')),
      el('button', { class: 'ghost danger', onclick: async () => {
        if (!confirm(_('Haupt-PC „{name}“ entfernen?', { name: x.name }))) return;
        remoteState = await api.remote.hostRemove(x.id);
        delete hostStores[x.id];
        if (activeProjectId() === 'host:' + x.id) await switchProject('all');
        drawRemote(); renderRail();
      } }, _('Entfernen')))),
    el('p', { class: 'hint' }, _('Am Haupt-PC unter Fernzugriff „Gerät koppeln …“ wählen. Im selben Netz: Adresse und Code eingeben. Von unterwegs: dort „Kopplungslink kopieren“ und den Link hier einfügen – er enthält Adressen und Vermittler.')),
    el('div', { class: 'row' }, addr, port), el('div', { class: 'row', style: 'margin-top:6px' }, code, pairBtn),
  ];
  fill(box, ...host, ...client, ...sshSection(r));
}
// Server per SSH (z. B. VPS mit Ubuntu): Claude Code läuft dort, Swapline verbindet sich mit dem SSH-Schlüssel
function sshSection(r) {
  const servers = r.hosts.filter(x => x.kind === 'ssh');
  const name = el('input', { type: 'text', placeholder: _('Name (z. B. VPS)'), style: 'flex:1' });
  const user = el('input', { type: 'text', placeholder: _('Benutzer'), style: 'width:120px' });
  const addr = el('input', { type: 'text', placeholder: _('Adresse (IP oder Name)'), style: 'flex:1' });
  const port = el('input', { type: 'number', min: '1', max: '65535', value: '22', style: 'width:80px' });
  const folders = el('textarea', { rows: '2', placeholder: _('Ordner auf dem Server, je Zeile einer (z. B. /home/ich/projekt)'), style: 'width:100%' });
  const lines = v => v.split('\n').map(x => x.trim()).filter(Boolean);
  const stateText = x => (x.state === 'connected' ? _('verbunden') : x.state === 'checking' ? _('prüfe …') : x.error || _('nicht verbunden'));
  return [
    el('h3', { style: 'margin-top:16px' }, _('Server per SSH (z. B. VPS)')),
    el('p', { class: 'hint' }, _('Claude Code läuft auf dem Server; Swapline verbindet sich mit deinem SSH-Schlüssel (keine Passwörter, nichts wird gespeichert). Auf dem Server einmal „Claude anmelden“ wählen und im Terminal anmelden.')),
    r.sshAvailable ? null : el('p', { class: 'hint', style: 'color:var(--danger)' }, _('Der SSH-Client von Windows fehlt: Einstellungen → System → Optionale Features → „OpenSSH-Client“ hinzufügen.')),
    ...servers.map(x => {
      const ed = el('textarea', { rows: '2', style: 'width:100%' }); ed.value = (x.folders || []).join('\n');
      return el('div', { class: 'dev-row', style: 'flex-wrap:wrap' }, el('span', { class: 'dot' + (x.state === 'connected' ? ' on' : '') }),
        el('div', { class: 'grow' }, el('b', {}, x.name), el('small', {}, `${x.address}:${x.port} · ` + stateText(x))),
        el('button', { class: 'primary', onclick: () => { $('#modal-root').replaceChildren(); switchProject('host:' + x.id); } }, _('Chats zeigen')),
        el('button', { class: 'ghost', onclick: async () => { await api.remote.ssh.test(x.id.slice(4)); } }, _('Prüfen')),
        el('button', { class: 'ghost', title: _('Öffnet ein Terminal-Fenster mit „claude auth login“ auf dem Server'), onclick: () => api.remote.ssh.terminal(x.id.slice(4), true) }, _('Claude anmelden')),
        el('button', { class: 'ghost', onclick: () => api.remote.ssh.terminal(x.id.slice(4), false) }, _('Terminal öffnen')),
        el('button', { class: 'ghost danger', onclick: async () => {
          if (!confirm(_('Server „{name}“ entfernen? Laufende Chats dort werden beendet.', { name: x.name }))) return;
          remoteState = await api.remote.ssh.remove(x.id.slice(4)); delete hostStores[x.id];
          if (activeProjectId() === 'host:' + x.id) await switchProject('all');
          drawRemote(); renderRail();
        } }, _('Entfernen')),
        el('div', { style: 'flex-basis:100%' }, el('div', { class: 'hint' }, _('Ordner auf dem Server, je Zeile einer:')), ed,
          el('button', { class: 'ghost', onclick: async () => { const res = await api.remote.ssh.update({ id: x.id.slice(4), folders: lines(ed.value) }); if (res.error) return toast(res.error); remoteState = res; delete hostStores[x.id]; refreshHost(x.id); toast(_('Gespeichert')); } }, _('Ordner speichern'))));
    }),
    el('div', { class: 'row', style: 'margin-top:8px' }, name, user),
    el('div', { class: 'row', style: 'margin-top:6px' }, addr, port),
    el('div', { style: 'margin-top:6px' }, folders),
    el('div', { class: 'row', style: 'margin-top:6px;justify-content:flex-end' }, el('button', { class: 'primary', disabled: !r.sshAvailable, onclick: async () => {
      const res = await api.remote.ssh.add({ name: name.value, user: user.value.trim(), host: addr.value.trim(), port: Number(port.value), folders: lines(folders.value) });
      if (res.error) return toast(res.error);
      remoteState = res; toast(_('Server hinzugefügt – Verbindung wird geprüft')); drawRemote(); renderRail();
    } }, _('Server hinzufügen'))),
  ];
}
api.remote.onStatus(info => {
  const before = remoteState;
  remoteState = info;
  // Haupt-PC (wieder) verbunden: dessen Konten, Ordner und Freigabe neu laden
  for (const h of info.hosts) if (h.state === 'connected' && before?.hosts?.find(x => x.id === h.id)?.state !== 'connected') refreshHost(h.id);
  renderRail(); renderList();
  if ($('.modal.remote')) drawRemote();
});

// Knopf „Ganz nach unten“: erscheint, sobald man ein Stück nach oben gescrollt hat
const scrollToBottom = (smooth = true) => { const box = $('#messages'); box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };
function updateBottomBtn() { const box = $('#messages'); $('#btn-bottom').hidden = box.scrollHeight - box.scrollTop - box.clientHeight < 300; }
document.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'End' && !$('#chat-view').hidden) { e.preventDefault(); scrollToBottom(); } });

// ---------- Ereignisse ----------
// Ereignisse je Chat-Hälfte; Klick oder Fokus in eine Hälfte macht sie zur aktiven
const paneByRoot = root => panes.find(p => p.root === root);
function bindPane(root) {
  const q = id => root.querySelector(`[data-pid="${id}"]`);
  root.addEventListener('mousedown', () => focusPane(panes.indexOf(paneByRoot(root))), true);
  root.addEventListener('focusin', () => focusPane(panes.indexOf(paneByRoot(root))), true);
  q('messages').addEventListener('scroll', () => withPane(paneByRoot(root), updateBottomBtn), { passive: true });
  // ganz oben angekommen: ältere Nachrichten eines Haupt-PC-Chats nachladen
  q('messages').addEventListener('scroll', () => withPane(paneByRoot(root), () => { const t = currentTab(); if (t?.olderFrom != null && $('#messages').scrollTop < 60) loadOlder(t); }), { passive: true });
  q('btn-bottom').onclick = () => scrollToBottom();
  q('btn-empty-new').onclick = () => newChat();
  q('btn-send').onclick = sendMessage;
  q('btn-stop').onclick = () => { const t = currentTab(); if (t) tapi(t).session.interrupt(t.id); };
  q('input').addEventListener('input', autosize);
  q('input').addEventListener('input', updateBashMode);
  q('input').addEventListener('input', e => {
    const input = e.target;
    if (!emojiOn() || input.value.startsWith('!') || !/^insert/.test(e.inputType || '')) return;
    const r = emojifyAtCursor(input.value, input.selectionStart);
    if (!r) return;
    input.value = r.text; input.setSelectionRange(r.cursor, r.cursor);
    lastEmoji = { ...r.undo, text: r.text, cursor: r.cursor };
  });
  q('input').addEventListener('keydown', e => {
    const input = e.target, u = lastEmoji;
    if (e.key !== 'Backspace' || !u || input.value !== u.text || input.selectionStart !== u.cursor || input.selectionEnd !== u.cursor) { if (e.key.length === 1 || e.key === 'Backspace') lastEmoji = null; return; }
    e.preventDefault();
    input.value = u.text.slice(0, u.start) + u.original + u.text.slice(u.start + u.emoji.length);
    const c = u.start + u.original.length + 1;
    input.setSelectionRange(c, c);
    lastEmoji = null;
  });
  q('input').addEventListener('input', () => { cmdState.index = cmdState.open ? cmdState.index : 0; updateCommandPopup(); });
  q('input').addEventListener('blur', () => setTimeout(closeCommandPopup, 150));
  // Diktieren: Eingabefeld fokussieren, dann startet Windows die Spracheingabe (wie Windows + H) – der Text erscheint
  // live im Feld und wird nicht automatisch gesendet
  q('btn-mic').onclick = async () => {
    q('input').focus();
    if (!(await api.dictate())) toast(_('Spracheingabe konnte nicht gestartet werden – alternativ Windows + H drücken.'));
  };
  q('btn-attach').onclick = async () => { const r = await api.pickAttachments(); if (r?.length) { attachments.push(...r); renderAttachments(); } };
  q('chat-view').addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); focusPane(panes.indexOf(paneByRoot(root))); $('#chat-view').classList.add('dropping'); } });
  q('chat-view').addEventListener('dragleave', e => { if (e.target === q('chat-view') || !e.relatedTarget) q('chat-view').classList.remove('dropping'); });
  q('chat-view').addEventListener('drop', e => { focusPane(panes.indexOf(paneByRoot(root))); q('chat-view').classList.remove('dropping'); if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
  q('ch-title').ondblclick = renameChat; // Hinweis „Doppelklick zum Umbenennen“ steht als title in index.html
  q('ch-cwd').onclick = () => { const t = currentTab(); if (t?.cwd) api.openPath(t.cwd); };
  q('ch-settings').onclick = () => ($('#chat-menu') ? closeMenus() : openChatSettingsMenu());
  q('input').addEventListener('keydown', e => {
    const input = e.currentTarget;
    if (cmdState.open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cmdState.index = (cmdState.index + (e.key === 'ArrowDown' ? 1 : -1) + cmdState.items.length) % cmdState.items.length; return updateCommandPopup(); }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); return applyCommand(cmdState.items[cmdState.index]); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeCommandPopup(); }
    }
    // ↑ am Anfang des Feldes (bzw. leeres Feld) = vorherige Nachricht, ↓ am Ende = nächste
    // beim Blättern (Feld zeigt noch einen Verlaufseintrag) blättern ↑/↓ unabhängig von der Cursorposition weiter
    const browsing = historyPos >= 0 && input.value === inputHistory[historyPos];
    if (e.key === 'ArrowUp' && !e.shiftKey && (browsing || (input.selectionStart === 0 && input.selectionEnd === 0)) && browseHistory(1)) { e.preventDefault(); return; }
    if (e.key === 'ArrowUp' && !input.value && browseHistory(1)) { e.preventDefault(); return; }
    if (e.key === 'ArrowDown' && historyPos >= 0 && (browsing || input.selectionStart === input.value.length) && browseHistory(-1)) { e.preventDefault(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
  q('input').addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
}
function openBeside(id) {
  if (panes.length < 2) return openSplit(id);
  const other = focusedPane === 0 ? 1 : 0;
  focusPane(other);
  openTab(id);
}
$('#btn-new-chat').onclick = () => newChat();
$('#btn-add-project').onclick = () => {
  if ($('#add-menu')) return closeMenus();
  const hv = hostOfView(activeProjectId());
  closeMenus();
  const r = $('#btn-add-project').getBoundingClientRect();
  document.body.append(el('div', { class: 'popmenu', id: 'add-menu', style: `left:${r.right + 10}px; top:${r.top}px` },
    el('button', { class: 'pm-item', onclick: () => { closeMenus(); openProjectForm(); } }, el('span', { class: 'pm-ic' }, '+'), _('Neues Projekt …')),
    el('button', { class: 'pm-item', onclick: () => { closeMenus(); openGroupForm(); } }, el('span', { class: 'pm-ic' }, icon(ICONS.folder)), _('Neuer Ordner …')),
    ...(hv && hostStores[hv]?.canEditProjects ? [el('div', { class: 'pm-sep' }),
      el('button', { class: 'pm-item', onclick: () => { closeMenus(); openHostProjectForm(hv); } }, el('span', { class: 'pm-ic' }, '🖥'), _('Neues Projekt auf „{name}“ …', { name: hostName(hv) })),
      el('button', { class: 'pm-item', onclick: () => { closeMenus(); openHostGroupForm(hv); } }, el('span', { class: 'pm-ic' }, '🖥'), _('Neuer Ordner auf „{name}“ …', { name: hostName(hv) }))] : [])));
};
$('#rail-all').onclick = () => switchProject('all');
$('#rail-all').ondragover = e => { if ([...e.dataTransfer.types].includes('text/chat')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } };
$('#rail-all').ondragleave = e => e.currentTarget.classList.remove('drop');
$('#rail-all').ondrop = e => { e.preventDefault(); e.currentTarget.classList.remove('drop'); const id = e.dataTransfer.getData('text/chat'); if (id) moveChatToProject(id, 'all'); };
$('#btn-account').onclick = () => ($('#account-menu') ? closeMenus() : openAccountMenu());
$('#btn-project-edit').onclick = () => { const pr = project(activeProjectId()); if (pr) openProjectForm(pr); };
$('#btn-settings').onclick = openSettings;
$('#btn-extensions').onclick = () => openExtensions();
$('#btn-remote').onclick = () => openRemote();
$('#search').oninput = renderList;
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => { view = b.dataset.view; setSeg(); renderList(); });
// Anhänge: Knopf, Einfügen (Strg+V mit Bild) und Ziehen ins Fenster
// Chat umbenennen: Titel oben direkt bearbeiten (Enter speichert, Esc bricht ab). Gilt in Swapline;
// die Sitzungsdateien von Claude Code bleiben unverändert.
function renameChat() {
  const t = currentTab(); if (!t) return;
  const title = $('#ch-title');
  if (title.querySelector('input')) return;
  const input = el('input', { type: 'text', class: 'title-edit', value: t.title || '', maxlength: '80', placeholder: _('Name des Chats') });
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    const v = input.value.replace(/\s+/g, ' ').trim();
    if (save && v && v !== t.title) { t.title = v; saveTabs(); renderList(); toast(_('Chat umbenannt')); }
    title.textContent = t.title || _('Neuer Chat');
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
  title.replaceChildren(input);
  input.focus(); input.select();
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); }
  if (e.key === 'Escape') {
    if ($('#modal-root').children.length) return $('#modal-root').replaceChildren();
    const t = currentTab(); if (t?.running) tapi(t).session.interrupt(t.id);
  }
  if (e.ctrlKey && /^[1-9]$/.test(e.key)) { const p = store.profiles[+e.key - 1]; if (p) switchProfile(p.id); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderUsage);

// ---------- Start ----------
{
  const root = $('#chat .pane');
  paneTemplate = root.cloneNode(true);
  for (const e of paneTemplate.querySelectorAll('[data-pid]')) e.removeAttribute('id');
  paneTemplate.classList.remove('focused');
  panes = [{ root, tabId: null, attachments: [] }];
  bindPane(root);
  renderPaneButtons();
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey && (e.key === '#' || e.code === 'Backslash')) { e.preventDefault(); panes.length > 1 ? closePane(focusedPane) : openSplit(); }
});
(async function init() {
  store = await api.getStore();
  VERSION = store.appVersion || '';
  // Sprache vor dem ersten Zeichnen festlegen und die festen Texte aus index.html übersetzen
  setLang(store.settings.language || 'auto');
  translateStatic();
  applyTheme();
  const saved = loadTabs();
  tabs = (saved.tabs || []).map(t => makeTab({ ...t, loaded: !t.sessionId }));
  activeTabId = tabs.some(t => t.id === saved.activeTabId) ? saved.activeTabId : null;
  lastOpened = saved.lastOpened || {};
  renderRail(); renderList(); renderUsage();
  api.remote.info().then(r => { remoteState = r; renderRail(); for (const h of r.hosts) if (h.state === 'connected') refreshHost(h.id); });
  if (activeTabId) openTab(activeTabId); else renderChat();
  refreshStatus();
  for (const p of store.profiles) loadModels(p.id).then(() => { const t = currentTab(); if (t?.profileId === p.id) renderChatChip(t); });
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
})();
