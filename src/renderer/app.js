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
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
// replaceChildren ohne leere Einträge (null/false würden sonst als Text „null“ erscheinen)
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
const icon = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = d; return s; };
const ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

marked.setOptions({ gfm: true, breaks: true });
// Links in Claude-Antworten: nur https (öffnet im Browser). file:, UNC (//host), relative und andere
// Ziele werden entfernt. Bilder nur als data:-URL – keine Remote- oder Datei-Bilder.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.hasAttribute('href')) {
    const href = node.getAttribute('href').trim();
    if (/^https:\/\/[^/\\]/i.test(href)) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    else { node.removeAttribute('href'); node.setAttribute('title', 'Link entfernt: ' + href.slice(0, 120)); }
  }
  if (node.tagName === 'IMG' && !/^data:image\//i.test(node.getAttribute('src') || '')) node.remove();
  for (const attr of ['src', 'srcset', 'action', 'formaction', 'xlink:href', 'poster', 'background']) {
    if (node.tagName !== 'IMG' && node.hasAttribute(attr)) node.removeAttribute(attr);
  }
});
const md = text => DOMPurify.sanitize(marked.parse(text || ''), { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'video', 'audio', 'source'] });

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
      tabs: tabs.map(t => ({ id: t.id, title: t.title, profileId: t.profileId, projectId: t.projectId, cwd: t.cwd, sessionId: t.sessionId, model: t.model, effort: t.effort, permissionMode: t.permissionMode, updated: t.updated, preview: t.preview })),
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
const initials = name => (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
// Avatar: eigenes Bild (Projekte, data:-URL aus dem Hauptprozess) oder Initialen auf Farbe
const avatar = (p, cls = '') => p?.icon
  ? el('div', { class: 'avatar img ' + cls }, el('img', { src: p.icon, alt: '' }))
  : el('div', { class: 'avatar ' + cls, style: `background:${p?.color || '#64748B'}` }, initials(p?.name));
const baseName = p => (p || '').split(/[\\/]/).filter(Boolean).pop() || p || 'Home';

// Uhrzeit an Nachrichten: heute nur HH:MM, sonst mit Datum
function msgTime(ts) {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Gestern';
  if (now - d < 6 * 864e5) return d.toLocaleDateString('de-DE', { weekday: 'short' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
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
const tabInProject = (t, pid) => pid === 'all' || t.projectId === pid;
const GLOBE = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"/>';

function renderRail() {
  const pid = activeProjectId();
  $('#rail-all').classList.toggle('active', pid === 'all');
  const busyIn = id => tabs.some(t => t.projectId === id && (t.unread || t.running));
  $('#rail-projects').replaceChildren(...(store.projects || []).map(pr => el('button', {
    class: 'rail-profile' + (pr.id === pid ? ' active' : ''),
    title: pr.name + (pr.cwd ? '\n' + pr.cwd : '') + '\nRechtsklick: bearbeiten',
    onclick: () => switchProject(pr.id),
    oncontextmenu: e => { e.preventDefault(); openProjectForm(pr); },
    draggable: 'true',
    ondragstart: e => e.dataTransfer.setData('text/project', pr.id),
    ondragover: e => { if ([...e.dataTransfer.types].some(x => x === 'text/chat' || x === 'text/project')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    ondragleave: e => e.currentTarget.classList.remove('drop'),
    ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('drop'); onRailDrop(e, pr.id); },
  }, avatar(pr), busyIn(pr.id) ? el('span', { class: 'badge on' }) : null)));

  // Konto-Knopf unten: Avatar des aktiven Kontos mit Status-Punkt
  const p = activeProfile(), st = status[p.id];
  $('#btn-account').replaceChildren(avatar(p), el('span', { class: 'badge ' + (st ? (st.loggedIn ? 'on' : 'off') : '') }));
  $('#btn-account').title = `Konto: ${p.name}${st?.email ? '\n' + st.email : ''}${st && !st.loggedIn ? '\n(' + stateText(st) + ')' : ''}\nKlicken zum Wechseln`;
  renderProjectHead();
}

function renderProjectHead() {
  const pid = activeProjectId(), pr = project(pid);
  const av = pr ? avatar(pr, 'lg') : el('div', { class: 'avatar lg globe' }, icon(GLOBE));
  av.id = 'ph-avatar';
  $('#ph-avatar').replaceWith(av);
  $('#ph-name').textContent = pr ? pr.name : 'Allgemein';
  const count = tabs.filter(t => tabInProject(t, pid)).length;
  $('#ph-sub').textContent = pr ? `${pr.cwd || 'ohne festen Ordner'} · ${count} Chat${count === 1 ? '' : 's'}` : `Alle Chats · ${count}`;
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
async function onRailDrop(e, targetId) {
  const chatId = e.dataTransfer.getData('text/chat');
  if (chatId) return moveChatToProject(chatId, targetId);
  const pid = e.dataTransfer.getData('text/project');
  if (pid && pid !== targetId) {
    const ids = store.projects.map(x => x.id).filter(x => x !== pid);
    ids.splice(ids.indexOf(targetId), 0, pid);
    store = await api.projects.reorder(ids);
    renderRail();
  }
}
function moveChatToProject(chatId, projectId) {
  const t = tabs.find(x => x.id === chatId);
  if (!t) return;
  t.projectId = projectId === 'all' ? null : projectId;
  saveTabs(); renderRail(); renderList();
  toast(projectId === 'all' ? 'Chat ist jetzt ohne Projekt' : `Chat verschoben nach „${project(projectId).name}“`);
}

function openProjectForm(pr = {}) {
  let color = pr.color || COLORS[(store.projects || []).length % COLORS.length];
  let cwd = pr.cwd || '';
  const name = el('input', { type: 'text', value: pr.name || '', placeholder: 'z. B. Glassbed, Website, Verein' });
  const colors = el('div', { class: 'colors' });
  const drawColors = () => colors.replaceChildren(...COLORS.map(c => el('button', { class: c === color ? 'sel' : '', style: `background:${c}`, onclick: () => { color = c; drawColors(); } })));
  drawColors();
  const folder = el('div', { class: 'folder-row' });
  const drawFolder = () => fill(folder,
    el('span', { class: 'mono ' + (cwd ? '' : 'muted') }, cwd || 'kein Ordner – wird pro Chat gewählt'),
    el('button', { class: 'ghost', onclick: async () => { const d = await api.pickFolder(); if (d) { cwd = d; if (!name.value.trim()) name.value = baseName(d); drawFolder(); } } }, 'Wählen …'),
    cwd ? el('button', { class: 'ghost', onclick: () => { cwd = ''; drawFolder(); } }, 'Entfernen') : null);
  drawFolder();
  // Projektbild (SVG, PNG, JPG, WebP, GIF, ICO bis 1 MB) – gewählt über den Datei-Dialog des Hauptprozesses
  let icon = pr.icon || null;
  const iconRow = el('div', { class: 'folder-row' });
  const drawIcon = () => fill(iconRow,
    avatar({ name: name.value || pr.name || '?', color, icon }, 'lg'),
    el('span', { class: 'hint', style: 'flex:1' }, icon ? 'eigenes Bild' : 'Initialen auf Farbe'),
    el('button', { class: 'ghost', onclick: async () => {
      const r = await api.projects.pickIcon();
      if (r?.error) return toast(r.error);
      if (r?.icon) { icon = r.icon; drawIcon(); }
    } }, 'Bild wählen …'),
    icon ? el('button', { class: 'ghost', onclick: () => { icon = null; drawIcon(); } }, 'Entfernen') : null);
  drawIcon();
  name.addEventListener('input', () => { if (!icon) drawIcon(); });
  colors.addEventListener('click', () => { if (!icon) setTimeout(drawIcon); });
  const save = async () => {
    if (!name.value.trim()) return name.focus();
    const data = { name: name.value.trim(), color, cwd, icon };
    store = pr.id ? await api.projects.update(pr.id, data) : await api.projects.add(data);
    m.close(); renderRail(); renderList();
  };
  const m = modal('project', pr.id ? 'Projekt bearbeiten' : 'Neues Projekt',
    el('label', { class: 'field' }, el('span', {}, 'Name'), name),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, 'Bild (optional)'), iconRow),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, 'Farbe'), colors),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, 'Projektordner (neue Chats starten hier)'), folder),
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'primary', onclick: save }, pr.id ? 'Speichern' : 'Projekt anlegen'),
      pr.id ? el('button', { class: 'ghost danger', style: 'margin-left:auto', onclick: async () => {
        const n = tabs.filter(t => t.projectId === pr.id).length;
        if (!confirm(`Projekt „${pr.name}“ löschen?${n ? `\n\nDie ${n} Chat(s) bleiben erhalten und landen unter „Allgemein“.` : ''}`)) return;
        tabs.forEach(t => { if (t.projectId === pr.id) t.projectId = null; });
        saveTabs();
        store = await api.projects.remove(pr.id); m.close(); renderRail(); renderList();
      } }, 'Projekt löschen') : null));
  name.focus();
  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

// Kontomenü (links unten)
function openAccountMenu() {
  closeMenus();
  const r = $('#btn-account').getBoundingClientRect();
  const menu = el('div', { class: 'popmenu', id: 'account-menu', style: `left:${r.right + 10}px; bottom:${window.innerHeight - r.bottom}px` },
    el('div', { class: 'pm-title' }, 'Konto wechseln'),
    ...store.profiles.map(p => {
      const st = status[p.id];
      return el('button', { class: 'pm-item' + (p.id === store.activeProfileId ? ' sel' : ''), onclick: () => { closeMenus(); switchProfile(p.id); } },
        el('span', { class: 'pm-av' }, avatar(p, 'sm'), el('span', { class: 'badge ' + (st ? (st.loggedIn ? 'on' : 'off') : '') })),
        el('span', { class: 'pm-text' }, el('b', {}, p.name), el('small', {}, stateText(st))),
        p.id === store.activeProfileId ? el('span', { class: 'pm-check' }, '✓') : null);
    }),
    el('div', { class: 'pm-sep' }),
    el('button', { class: 'pm-item', onclick: () => { closeMenus(); openAddProfile(); } }, el('span', { class: 'pm-ic' }, '+'), 'Konto hinzufügen'),
    el('button', { class: 'pm-item', onclick: () => { closeMenus(); openAccounts(); } }, el('span', { class: 'pm-ic' }, '⚙'), 'Konten verwalten'));
  document.body.append(menu);
}
function closeMenus() { document.querySelectorAll('.popmenu').forEach(x => x.remove()); }
document.addEventListener('mousedown', e => { if (!e.target.closest('.popmenu') && !e.target.closest('#btn-account') && !e.target.closest('#ch-settings') && !e.target.closest('#bgbar')) closeMenus(); });

// Rechtsklick auf einen Chat: in Projekt verschieben / schließen
function openChatMenu(e, t) {
  e.preventDefault(); closeMenus();
  const items = [el('div', { class: 'pm-title' }, 'Verschieben nach')];
  items.push(el('button', { class: 'pm-item' + (!t.projectId ? ' sel' : ''), onclick: () => { closeMenus(); moveChatToProject(t.id, 'all'); } },
    el('span', { class: 'pm-av' }, el('div', { class: 'avatar sm globe' }, icon(GLOBE))), 'Allgemein (ohne Projekt)'));
  for (const pr of store.projects || []) items.push(el('button', { class: 'pm-item' + (t.projectId === pr.id ? ' sel' : ''), onclick: () => { closeMenus(); moveChatToProject(t.id, pr.id); } },
    el('span', { class: 'pm-av' }, avatar(pr, 'sm')), pr.name));
  items.push(el('button', { class: 'pm-item', onclick: () => { closeMenus(); openProjectForm(); } }, el('span', { class: 'pm-ic' }, '+'), 'Neues Projekt …'));
  items.push(el('div', { class: 'pm-sep' }), el('button', { class: 'pm-item', onclick: async () => { closeMenus(); if (activeTabId !== t.id) await openTab(t.id); renameChat(); } }, el('span', { class: 'pm-ic' }, '✎'), 'Umbenennen …'));
  items.push(el('button', { class: 'pm-item danger', onclick: () => { closeMenus(); closeTab(t.id); } }, el('span', { class: 'pm-ic' }, '×'), 'Chat schließen'));
  const menu = el('div', { class: 'popmenu', style: `left:${e.clientX}px; top:${e.clientY}px` }, ...items);
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - r.height - 8) + 'px';
}

// Statuszeile eines Kontos – unterscheidet „Claude Code fehlt“ von „nicht angemeldet“
const CLAUDE_MISSING_TEXT = 'Claude Code nicht gefunden';
function stateText(st, long = false) {
  if (!st) return 'wird geprüft …';
  if (st.claudeMissing) return CLAUDE_MISSING_TEXT;
  if (st.loggedIn) return [st.email, planLabel(st), long ? st.orgName : null].filter(Boolean).join(' · ');
  return 'Nicht angemeldet';
}
const badgeClass = st => 'badge ' + (st ? (st.loggedIn ? 'on' : 'off') : '');
function planLabel(st) {
  const map = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
  return st.subscriptionType ? (map[st.subscriptionType] || st.subscriptionType) : (st.authMethod === 'console' ? 'API' : '');
}

async function refreshStatus(id) {
  const ids = id ? [id] : store.profiles.map(p => p.id);
  await Promise.all(ids.map(async pid => { status[pid] = await api.profiles.status(pid); }));
  if (Object.values(status).some(s => s?.claudeMissing)) toast(CLAUDE_MISSING_TEXT + ' – siehe Einstellungen');
  renderRail();
  if ($('.modal.accounts')) renderAccountsList();
}

// Konto links wählen: wird aktives Konto UND der offene Chat schreibt ab jetzt über dieses Konto weiter
async function switchProfile(id) {
  store = await api.profiles.setActive(id);
  historyCache = {};
  const st = status[id];
  const t = currentTab();
  if (t && t.profileId !== id) {
    // Übertragung abgelehnt -> aktives Konto bleibt das des Chats
    if ((await moveTabToProfile(t, id)) === false) store = await api.profiles.setActive(t.profileId);
  } else if (st && !st.loggedIn) toast(st.claudeMissing ? CLAUDE_MISSING_TEXT : `„${profile(id).name}“ ist nicht angemeldet`);
  else toast(`Konto: ${profile(id).name}`);
  renderRail(); renderList(); renderUsage();
}

// Chat auf ein anderes Konto umziehen (Verlauf wird mitgenommen und mit --resume fortgesetzt)
async function moveTabToProfile(t, to) {
  if (t.profileId === to) return;
  if (t.running) {
    t.pendingProfile = to;
    toast(`Wechsel zu „${profile(to).name}“ nach dieser Antwort`);
    if (t.id === activeTabId) renderChat();
    return;
  }
  t.pendingProfile = null;
  if (t.sessionId) {
    // Der Hauptprozess fragt vorher nach (Verlauf inkl. Dateiinhalten wird kopiert)
    const r = await api.session.moveProfile({ sessionId: t.sessionId, cwd: t.cwd, fromProfileId: t.profileId, toProfileId: to });
    if (r?.cancelled) { toast('Übertragung abgebrochen – der Chat bleibt im bisherigen Konto'); if (t.id === activeTabId) renderChat(); return false; }
    if (!r?.ok) { toast('Verlauf konnte nicht übernommen werden – der Chat startet neu'); t.sessionId = null; }
  }
  const st = status[to];
  await changeTab({ profileId: to }, `Weiter mit Konto „${profile(to).name}“${st?.email ? ' (' + st.email + ')' : ''}${st && !st.loggedIn ? ' – nicht angemeldet!' : ''}`, t);
}

// ---------- Modelle & Aufwand ----------
const modelInfo = {}; // profileId -> { models, effortLevel, ... }
const EFFORT_LABEL = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', xhigh: 'Sehr hoch', max: 'Maximum' };
async function loadModels(pid, refresh = false) {
  if (modelInfo[pid] && !refresh) return modelInfo[pid];
  const info = await api.profiles.models(pid, refresh);
  if (info) modelInfo[pid] = info;
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
  { value: 'default', label: 'Nachfragen', desc: 'Claude fragt vor Befehlen und Änderungen' },
  { value: 'acceptEdits', label: 'Änderungen erlauben', desc: 'Dateien ändern ohne Rückfrage, Befehle mit' },
  { value: 'plan', label: 'Nur planen', desc: 'Claude liest und plant, ändert nichts' },
  { value: 'bypassPermissions', label: '⚠ Alles erlauben', desc: 'keine Rückfragen (--dangerously-skip-permissions)' },
];
function modelLabel(t) {
  if (!t.model) return defaultModelName(t.profileId) || 'Standard';
  return modelEntry(t.profileId, t.model)?.displayName || t.model;
}
function effortLabel(t) {
  if (!effortLevelsFor(t.profileId, t.model).length) return '';
  if (t.effort) return EFFORT_LABEL[t.effort] || t.effort;
  const d = modelInfo[t.profileId]?.effortLevel;
  return d ? EFFORT_LABEL[d] || d : 'Auto';
}
function renderChatChip(t) {
  const p = profile(t.profileId);
  const bypass = t.permissionMode === 'bypassPermissions';
  const eff = effortLabel(t);
  const chip = $('#ch-settings');
  chip.classList.toggle('risk', bypass);
  chip.replaceChildren(
    avatar(p, 'sm'),
    el('span', { class: 'cc-text' },
      el('b', {}, p?.name || '?'), el('span', { class: 'cc-sep' }, '·'), modelLabel(t),
      eff ? [el('span', { class: 'cc-sep' }, '·'), eff] : null,
      bypass ? [el('span', { class: 'cc-sep' }, '·'), el('span', { class: 'cc-warn' }, '⚠ Alles erlaubt')] : null),
    icon('<path d="m6 9 6 6 6-6"/>'));
  const mode = MODES.find(m => m.value === (t.permissionMode || 'default'));
  chip.title = `Konto: ${p?.name}${status[t.profileId]?.email ? ' (' + status[t.profileId].email + ')' : ''}\nModell: ${modelLabel(t)}${t.model ? '' : ' (Standard)'}\nAufwand: ${eff || '–'}${t.effort ? '' : ' (Standard)'}\nBerechtigungen: ${mode?.label}`;
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
  const items = [el('div', { class: 'pm-title' }, 'Konto für diesen Chat')];
  for (const p of store.profiles) {
    const st = status[p.id];
    items.push(el('button', { class: 'pm-item' + (p.id === t.profileId ? ' sel' : ''), onclick: async () => {
      done();
      await moveTabToProfile(t, p.id);
      store = await api.profiles.setActive(t.profileId);
      renderRail(); renderList(); renderUsage();
    } },
      el('span', { class: 'pm-av' }, avatar(p, 'sm'), el('span', { class: 'badge ' + (st ? (st.loggedIn ? 'on' : 'off') : '') })),
      el('span', { class: 'pm-text' }, el('b', {}, p.name), el('small', {}, stateText(st))),
      check(p.id === t.profileId)));
  }

  // Modell (die wichtigsten zuerst, ältere hinter "Weitere")
  items.push(el('div', { class: 'pm-sep' }), el('div', { class: 'pm-title' }, 'Modell'));
  const list = (modelInfo[t.profileId]?.models || []).filter(m => m.value !== 'default');
  const def = modelEntry(t.profileId, 'default');
  const setModel = (value, label) => {
    done();
    const patch = { model: value };
    if (t.effort && !effortLevelsFor(t.profileId, value).includes(t.effort)) patch.effort = '';
    changeTab(patch, `Modell: ${label}`);
  };
  items.push(el('button', { class: 'pm-item' + (!t.model ? ' sel' : ''), onclick: () => setModel('', 'Standard · ' + (defaultModelName(t.profileId) || '')) },
    el('span', { class: 'pm-text' }, el('b', {}, `Standard · ${defaultModelName(t.profileId) || 'laut Konto'}`), el('small', {}, def?.description || 'Empfehlung von Claude für dieses Konto')),
    check(!t.model)));
  const main = list.slice(0, 4), more = list.slice(4);
  const modelItem = m => el('button', { class: 'pm-item' + (t.model === m.value ? ' sel' : ''), onclick: () => setModel(m.value, m.displayName) },
    el('span', { class: 'pm-text' }, el('b', {}, m.displayName), m.description ? el('small', {}, m.description) : null), check(t.model === m.value));
  main.forEach(m => items.push(modelItem(m)));
  if (more.length) {
    if (showAllModels || more.some(m => m.value === t.model)) more.forEach(m => items.push(modelItem(m)));
    else items.push(el('button', { class: 'pm-more', onclick: e => { e.stopPropagation(); showAllModels = true; openChatSettingsMenu(); } }, `Weitere Modelle (${more.length}) …`));
  }
  if (!list.length) items.push(el('div', { class: 'pm-note' }, 'Modelle werden geladen …'));

  // Aufwand als Segment-Leiste
  const levels = effortLevelsFor(t.profileId, t.model);
  const defEff = modelInfo[t.profileId]?.effortLevel;
  items.push(el('div', { class: 'pm-sep' }), el('div', { class: 'pm-title' }, 'Aufwand'));
  if (levels.length) {
    const seg = el('div', { class: 'pm-seg' },
      el('button', { class: !t.effort ? 'sel' : '', title: `Standard: ${defEff ? EFFORT_LABEL[defEff] || defEff : 'automatisch'}`, onclick: () => { done(); changeTab({ effort: '' }, `Aufwand: Standard (${defEff ? EFFORT_LABEL[defEff] || defEff : 'automatisch'})`); } }, 'Standard'),
      ...levels.map(l => el('button', { class: t.effort === l ? 'sel' : '', onclick: () => { done(); changeTab({ effort: l }, `Aufwand: ${EFFORT_LABEL[l] || l}`); } }, EFFORT_LABEL[l] || l)));
    items.push(seg, el('div', { class: 'pm-note' }, `Standard für dieses Konto: ${defEff ? EFFORT_LABEL[defEff] || defEff : 'automatisch (Claude entscheidet)'}`));
  } else items.push(el('div', { class: 'pm-note' }, 'Dieses Modell hat keine Aufwandsstufen.'));

  // Berechtigungen
  items.push(el('div', { class: 'pm-sep' }), el('div', { class: 'pm-title' }, 'Berechtigungen'));
  for (const m of MODES) {
    const on = (t.permissionMode || 'default') === m.value;
    items.push(el('button', { class: 'pm-item' + (on ? ' sel' : '') + (m.value === 'bypassPermissions' ? ' risk' : ''), onclick: async () => {
      done();
      if (on) return;
      // Warnung und Bestätigung kommen als nativer Dialog aus dem Hauptprozess
      if (m.value === 'bypassPermissions' && !(await api.session.confirmBypass(t.id))) return;
      changeTab({ permissionMode: m.value }, m.value === 'bypassPermissions' ? '⚠ Alles erlauben: keine Rückfragen mehr (--dangerously-skip-permissions)' : `Berechtigungen: ${m.label}`);
    } }, el('span', { class: 'pm-text' }, el('b', {}, m.label), el('small', {}, m.desc)), check(on)));
  }

  // Sonstiges
  items.push(el('div', { class: 'pm-sep' }),
    el('button', { class: 'pm-item', onclick: () => { done(); api.profiles.openTerminal(t.profileId, t.cwd); } }, el('span', { class: 'pm-ic' }, '›_'), 'Im Terminal öffnen'),
    t.cwd ? el('button', { class: 'pm-item', onclick: () => { done(); api.openPath(t.cwd); } }, el('span', { class: 'pm-ic' }, '📁'), 'Ordner im Explorer öffnen') : null);

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
function renderList() {
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
      const p = profile(t.profileId);
      const pr = pid === 'all' ? project(t.projectId) : null;
      return el('div', { class: 'item' + (t.id === activeTabId ? ' active' : ''), onclick: () => openTab(t.id),
        oncontextmenu: e => openChatMenu(e, t), draggable: 'true', ondragstart: e => e.dataTransfer.setData('text/chat', t.id),
        title: `Konto: ${p?.name || '?'}${pr ? '\nProjekt: ' + pr.name : ''}\nRechtsklick oder auf ein Projekt ziehen zum Verschieben` },
        avatar(p),
        el('div', { class: 'meta' },
          el('div', { class: 'row1' }, el('span', { class: 'title' }, t.title || 'Neuer Chat'), el('span', { class: 'time' }, fmtTime(t.updated))),
          el('div', { class: 'sub' }, t.preview || baseName(t.cwd))),
        t.running ? el('span', { class: 'busy', title: 'arbeitet …' }) : t.unread ? el('span', { class: 'unread' }) : null,
        el('button', { class: 'close', title: 'Chat schließen', onclick: e => { e.stopPropagation(); closeTab(t.id); } }, icon(ICONS.x)));
    });
    if (!nodes.length) nodes = [el('div', { class: 'list-empty' }, q ? 'Keine Treffer in offenen Chats.' : pid === 'all' ? 'Noch keine Chats. Klicke auf + für einen neuen Chat.' : 'Noch keine Chats in diesem Projekt. Klicke auf + oder ziehe einen Chat auf das Projekt links.')];
    if (q.length >= 2) nodes.push(el('button', { class: 'search-all', onclick: () => { view = 'history'; setSeg(); renderList(); } }, `🔎 „${q}“ in allen Sitzungen suchen`));
  }

  if (view === 'favorites') {
    nodes = store.favorites.filter(f => match(f.name, f.path)).map(f =>
      el('div', { class: 'item', onclick: () => newChat(f.path), title: 'Neuen Chat in diesem Ordner starten' },
        el('div', { class: 'folder-ic' }, icon(ICONS.folder)),
        el('div', { class: 'meta' }, el('div', { class: 'title' }, f.name), el('div', { class: 'sub mono' }, f.path)),
        el('button', { class: 'close', title: 'Favorit entfernen', onclick: async e => { e.stopPropagation(); store = await api.favorites.remove(f.path); renderList(); } }, icon(ICONS.x))));
    nodes.push(el('div', { style: 'padding:10px' }, el('button', { class: 'ghost', style: 'width:100%', onclick: async () => { store = await api.favorites.add(); renderList(); } }, '+ Ordner hinzufügen')));
  }

  if (view === 'history') {
    const pid = store.activeProfileId;
    const pr = project(activeProjectId());
    const inProject = h => !pr?.cwd || (h.cwd || '').toLowerCase().startsWith(pr.cwd.toLowerCase());
    // Volltextsuche (ab 2 Zeichen): durchsucht die Nachrichten aller Sitzungen des Kontos im Hauptprozess
    if (q.length >= 2) {
      const key = pid + '|' + q;
      if (searchState.key !== key) {
        searchState = { key, loading: true, results: [] };
        const s0 = searchState;
        setTimeout(async () => { const r = await api.history.search(pid, q); if (searchState === s0) { s0.results = r; s0.loading = false; if (view === 'history') renderList(); } }, 250);
      }
      if (searchState.loading) { list.replaceChildren(el('div', { class: 'list-empty' }, 'Durchsuche alle Sitzungen …')); return; }
      const hits = searchState.results.filter(inProject);
      nodes = hits.map(h => el('div', { class: 'item search-hit', onclick: () => resumeFromHistory(h), title: h.cwd },
        el('div', { class: 'folder-ic' }, icon(ICONS.clock)),
        el('div', { class: 'meta' },
          el('div', { class: 'row1' }, el('span', { class: 'title' }, h.title), el('span', { class: 'time' }, fmtTime(h.when || h.mtime))),
          el('div', { class: 'snippet' }, highlight(h.snippet, q)),
          el('div', { class: 'sub mono' }, `${h.hits} Treffer · ${baseName(h.cwd)}`))));
      if (!nodes.length) nodes = [el('div', { class: 'list-empty' }, `Keine Nachricht mit „${q}“ gefunden.`)];
      list.replaceChildren(...nodes);
      renderRail();
      return;
    }
    if (!historyCache[pid]) {
      list.replaceChildren(el('div', { class: 'list-empty' }, 'Verlauf wird geladen …'));
      api.history.list(pid).then(h => { historyCache[pid] = h; if (view === 'history') renderList(); });
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
          el('div', { class: 'sub mono' }, isLive(h) ? el('span', { class: 'live' }, '● läuft gerade · ') : '', baseName(h.cwd)))));
    }
    if (!items.length) nodes = [el('div', { class: 'list-empty' }, q ? 'Keine Treffer.' : 'Für dieses Konto gibt es noch keinen Verlauf.')];
  }
  list.replaceChildren(...nodes);
  renderRail();
}
// Sitzung wurde in den letzten 2 Minuten geschrieben und ist in der App nicht offen -> läuft vermutlich im Terminal
const isLive = h => Date.now() - h.mtime < 120000 && !tabs.some(t => t.sessionId === h.sessionId && t.running);
function groupLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Heute';
  const days = Math.floor((now - d) / 864e5);
  if (days < 7) return 'Diese Woche';
  if (days < 31) return 'Diesen Monat';
  return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
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
      el('span', { class: 'u-val', title: resets ? 'Zurückgesetzt: ' + new Date(resets * 1000).toLocaleString('de-DE') : '' },
        `${pct} %${resets ? ' · ' + resetIn(resets) : ''}`)));
    rows.push(el('div', { class: 'bar' }, el('i', { class: cls, style: `width:${Math.min(100, pct)}%` })));
  };
  const w = lim?.unifiedWindows;
  if (w?.five_hour) bar('5-Stunden-Limit', w.five_hour.utilization, w.five_hour.resetsAt);
  if (w?.seven_day) bar('Wochenlimit', w.seven_day.utilization, w.seven_day.resetsAt);
  if (!w) rows.push(el('div', { class: 'u-row' }, el('span', { class: 'u-label' }, 'Limits'), el('span', { class: 'u-val muted' }, 'nach der ersten Nachricht')));
  const today = u.days?.[new Date().toISOString().slice(0, 10)] || 0;
  rows.push(el('div', { class: 'u-row', title: 'Geschätzter API-Gegenwert laut Claude Code. Bei Abos zahlst du das nicht zusätzlich.' },
    el('span', { class: 'u-label' }, 'Gegenwert heute / gesamt'),
    el('span', { class: 'u-val' }, `$${today.toFixed(2)} / $${(u.costUsd || 0).toFixed(2)}`)));
  rows.push(el('div', { class: 'brand' }, el('span', {}, `Swapline ${VERSION} · by`), el('img', { src: BRAND.logo(isDark()), alt: 'ARFEP' })));
  box.replaceChildren(...rows);
}
function resetIn(sec) {
  const m = Math.max(0, Math.round((sec * 1000 - Date.now()) / 60000));
  if (m < 60) return `in ${m} Min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `in ${h} Std ${m % 60} Min` : `in ${Math.round(h / 24)} T`;
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
  let profileId = store.activeProfileId;
  if (cwd === undefined) { const picked = await pickFolderModal(); if (picked === null) return; ({ cwd, profileId } = picked); }
  const t = makeTab({ cwd, profileId });
  tabs.push(t);
  view = 'chats'; setSeg();
  openTab(t.id);
  saveTabs();
}

async function resumeFromHistory(h) {
  const existing = tabs.find(t => t.sessionId === h.sessionId);
  if (existing) { view = 'chats'; setSeg(); return openTab(existing.id); }
  const t = makeTab({ title: h.title, cwd: h.cwd, sessionId: h.sessionId, updated: h.mtime, loaded: false });
  if (isLive(h)) t.items.push({ kind: 'sys', error: true, text: 'Achtung: Diese Sitzung wird gerade woanders benutzt (z. B. im Terminal).\nBitte dort zuerst beenden, bevor du hier weiterschreibst – sonst arbeiten zwei Claude-Prozesse gleichzeitig an derselben Sitzung.' });
  tabs.push(t);
  view = 'chats'; setSeg();
  openTab(t.id);
  saveTabs();
}

function closeTab(id) {
  const t = tabs.find(x => x.id === id);
  if (t?.running && !confirm('Claude arbeitet noch in diesem Chat. Trotzdem schließen?')) return;
  api.session.close(id);
  tabs = tabs.filter(x => x.id !== id);
  if (activeTabId === id) activeTabId = null;
  saveTabs(); renderList(); renderChat();
}

async function openTab(id) {
  activeTabId = id;
  const t = currentTab();
  if (t) { lastOpened.all = t.id; if (t.projectId) lastOpened[t.projectId] = t.id; }
  if (t) {
    t.unread = false;
    if (!t.loaded) {
      t.loaded = true;
      const msgs = await api.history.loadSession({ profileId: t.profileId, sessionId: t.sessionId, cwd: t.cwd });
      const live = t.items; t.items = [];
      for (const m of msgs) ingest(t, m, true);
      if (msgs.length) t.items.push({ kind: 'sys', text: 'Bisheriger Verlauf – ab hier geht es weiter' });
      t.items.push(...live);
    }
  }
  // Die Kontoleiste zeigt immer das Konto des offenen Chats
  if (t && t.profileId !== store.activeProfileId && profile(t.profileId)) {
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
  const p = profile(t.profileId);
  $('#ch-avatar').replaceWith(Object.assign(avatar(p), { id: 'ch-avatar' }));
  $('#ch-title').textContent = t.title || 'Neuer Chat';
  $('#ch-cwd').textContent = t.cwd || '~ (Benutzerordner)';
  $('#ch-cwd').title = t.cwd ? 'Ordner im Explorer öffnen' : '';
  renderChatChip(t);
  if (!modelInfo[t.profileId]) loadModels(t.profileId).then(() => { if (currentTab() === t) renderChatChip(t); });
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
  g.querySelector('.tg-count').textContent = `${tools.length} ${tools.length === 1 ? 'Schritt' : 'Schritte'}`;
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
function renderMessages() {
  const t = currentTab(); if (!t) return;
  const box = $('#messages');
  const wrap = el('div', { class: 'msg-wrap' });
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
  // nach dem Layout (Schriften, Markdown) noch einmal ganz nach unten
  box.scrollTop = box.scrollHeight;
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; setTimeout(() => (box.scrollTop = box.scrollHeight), 120); });
}

function appendItem(t, it) {
  t.items.push(it);
  if (t.id !== activeTabId) return;
  const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  if (it.kind === 'tool' && toolView() === 'hidden') { it.el = null; return; }
  it.el = renderItem(t, it);
  if (it.el && it.kind === 'tool' && toolView() === 'compact') placeTool(it.el, t.typingEl);
  else if (it.el) { it.el.classList.add('enter'); t.typingEl.before(it.el); }
  if (nearBottom || it.kind === 'me' || it.kind === 'perm' || it.kind === 'question') box.scrollTop = box.scrollHeight;
}
function refreshItem(t, it) {
  if (t.id !== activeTabId || !it.el) return;
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
  if (!it.streaming) enhanceCode(b);
}
function setTyping(t) {
  if (t.id === activeTabId && t.typingEl) t.typingEl.hidden = !(t.running && !t.streamItem);
}

function renderItem(t, it) {
  switch (it.kind) {
    case 'me': return el('div', {}, el('div', { class: 'msg me' }, el('div', { class: 'bubble' },
      it.images?.length ? el('div', { class: 'bubble-imgs' }, it.images.map(src => el('img', { src, alt: 'Bild' }))) : null,
      it.files?.length ? el('div', { class: 'bubble-files' }, it.files.map(n => el('span', {}, '📄 ' + n))) : null,
      it.text)),
      it.time ? el('div', { class: 'msg-time' }, msgTime(it.time)) : null);
    case 'ai': {
      const b = el('div', { class: 'bubble md' + (it.streaming ? ' streaming' : ''), html: md(it.streaming ? streamingMarkdown(it.text) : it.text) });
      if (!it.streaming) enhanceCode(b);
      // Fußzeile: Uhrzeit + Kopieren (kopiert den Text der Antwort als Markdown)
      return el('div', { class: 'ai-block' }, el('div', { class: 'msg ai' }, b),
        el('div', { class: 'ai-foot' },
          it.time ? el('span', { class: 'msg-time left' }, msgTime(it.time)) : null,
          el('button', { class: 'copy-answer', title: 'Antwort kopieren (Markdown)', onclick: e => copyText(it.text, e.currentTarget) }, 'Kopieren')));
    }
    case 'tool': return renderTool(it);
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
  if (!(await api.copyText(text || ''))) return toast('Kopieren nicht möglich');
  if (btn) { const old = btn.textContent; btn.textContent = '✓ Kopiert'; btn.classList.add('done'); setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1400); }
}
function enhanceCode(root) {
  root.querySelectorAll('pre').forEach(pre => {
    const btn = el('button', { class: 'copy', onclick: () => copyText(pre.querySelector('code')?.innerText || pre.innerText, btn) }, 'Kopieren');
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
    case 'TodoWrite': return `${(input.todos || []).filter(x => x.status === 'completed').length}/${(input.todos || []).length} erledigt`;
    default: { const v = Object.values(input).find(x => typeof x === 'string'); return v || ''; }
  }
}
const TOOL_LABEL = { Bash: 'Befehl', PowerShell: 'PowerShell', Read: 'Liest', Write: 'Schreibt', Edit: 'Bearbeitet', Glob: 'Sucht Dateien', Grep: 'Durchsucht', WebFetch: 'Webseite', WebSearch: 'Websuche', Task: 'Agent', Agent: 'Agent', TodoWrite: 'Aufgaben' };

function renderTool(it) {
  const state = it.result == null ? 'run' : it.isError ? 'err' : 'ok';
  const d = el('details', { class: 'tool', 'data-label': TOOL_LABEL[it.name] || it.name },
    el('summary', {},
      el('span', { class: 't-state ' + state }, state === 'ok' ? '✓' : state === 'err' ? '✕' : ''),
      el('span', { class: 't-name' }, TOOL_LABEL[it.name] || it.name),
      el('span', { class: 't-sum' }, toolSummary(it.name, it.input))));
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
      body.append(el('div', { class: 't-label' }, 'Vorher'), el('pre', {}, it.input.old_string || ''), el('div', { class: 't-label' }, 'Nachher'), el('pre', {}, it.input.new_string || ''));
    } else {
      body.append(el('div', { class: 't-label' }, 'Eingabe'), el('pre', {}, (it.name === 'Bash' || it.name === 'PowerShell') ? it.input?.command : JSON.stringify(it.input, null, 2)));
    }
    if (it.result != null) body.append(el('div', { class: 't-label' }, it.isError ? 'Fehler' : 'Ergebnis'), el('pre', {}, truncate(it.result, 20000)));
    d.append(body);
  });
  return d;
}
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + `\n… (${s.length - n} Zeichen gekürzt)` : s);

function renderPerm(t, it) {
  const card = el('div', { class: 'card' + (it.answered ? ' done' : '') },
    el('h4', {}, `Darf Claude ${TOOL_LABEL[it.toolName] ? '„' + TOOL_LABEL[it.toolName] + '“' : it.toolName} ausführen?`),
    it.description ? el('div', { class: 'muted' }, it.description) : null,
    el('pre', {}, (it.toolName === 'Bash' || it.toolName === 'PowerShell') ? it.input?.command : it.input?.file_path ? it.input.file_path + (it.input.new_string != null ? '\n\n− ' + (it.input.old_string || '') + '\n+ ' + it.input.new_string : '') : JSON.stringify(it.input, null, 2)));
  if (it.answered) card.append(el('div', { class: 'muted' }, it.answered));
  else card.append(el('div', { class: 'actions' },
    el('button', { class: 'primary', onclick: () => answerPerm(t, it, 'allow') }, 'Erlauben'),
    it.suggestions?.length && !it.suggestions.some(x => x?.type === 'setMode') ? el('button', { class: 'ghost', onclick: () => answerPerm(t, it, 'always'), title: 'Regel in den Projekteinstellungen speichern' }, 'Immer erlauben') : null,
    el('button', { class: 'ghost danger', onclick: () => answerPerm(t, it, 'deny') }, 'Ablehnen')));
  return card;
}
function answerPerm(t, it, how) {
  if (how === 'deny') {
    api.session.respond(t.id, it.requestId, { behavior: 'deny', message: 'Der Nutzer hat diese Aktion abgelehnt.' });
    it.answered = '✕ Abgelehnt';
  } else {
    const resp = { behavior: 'allow', updatedInput: it.input };
    if (how === 'always' && it.suggestions) resp.updatedPermissions = it.suggestions;
    api.session.respond(t.id, it.requestId, resp);
    it.answered = how === 'always' ? '✓ Immer erlaubt' : '✓ Erlaubt';
  }
  refreshItem(t, it);
}

// Plan-Karte (Modus „Nur planen“): Plan als Markdown, annehmen / überarbeiten lassen / ablehnen.
// Annehmen beendet in Claude Code den Plan-Modus; Swapline stellt den Chat dann auf „Nachfragen“.
function renderPlan(t, it) {
  const card = el('div', { class: 'card plan' + (it.answered ? ' done' : '') }, el('h4', {}, '📋 Plan von Claude'));
  const body = el('div', { class: 'md plan-body', html: md(it.input?.plan || '') });
  card.append(body);
  if (it.answered) { card.append(el('div', { class: 'muted', style: 'margin-top:8px' }, it.answered)); return card; }
  const feedback = el('textarea', { class: 'plan-feedback', rows: '2', placeholder: 'Optional: Was soll Claude am Plan ändern?' });
  const answer = (resp, label, mode) => {
    api.session.respond(t.id, it.requestId, resp);
    it.answered = label;
    if (mode) { t.permissionMode = mode; saveTabs(); renderChatChip(t); }
    refreshItem(t, it);
  };
  card.append(feedback, el('div', { class: 'actions', style: 'margin-top:10px' },
    el('button', { class: 'primary', onclick: () => answer({ behavior: 'allow', updatedInput: it.input }, '✓ Plan angenommen – Claude setzt ihn um (Berechtigungen: Nachfragen)', 'default') }, 'Plan annehmen'),
    el('button', { class: 'ghost', onclick: () => { if (!feedback.value.trim()) return feedback.focus(); answer({ behavior: 'deny', message: 'Bitte überarbeite den Plan: ' + feedback.value.trim() }, '✎ Überarbeitung gewünscht: ' + feedback.value.trim()); } }, 'Überarbeiten lassen'),
    el('button', { class: 'ghost danger', onclick: () => answer({ behavior: 'deny', message: 'Der Nutzer hat den Plan abgelehnt.' }, '✕ Plan abgelehnt') }, 'Ablehnen')));
  return card;
}
function renderQuestion(t, it) {
  const card = el('div', { class: 'card' + (it.answered ? ' done' : '') }, el('h4', {}, 'Claude hat eine Frage'));
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
    const other = el('input', { class: 'other', type: 'text', placeholder: 'Andere Antwort …', value: typeof answers[q.question] === 'string' && !(q.options || []).some(o => o.label === answers[q.question]) ? answers[q.question] : '' });
    other.addEventListener('input', () => { answers[q.question] = other.value; });
    card.append(other);
  }
  card.append(el('div', { class: 'actions', style: 'margin-top:10px' },
    el('button', { class: 'primary', onclick: () => {
      const out = {};
      for (const [k, v] of Object.entries(answers)) out[k] = Array.isArray(v) ? v.join(', ') : v;
      api.session.respond(t.id, it.requestId, { behavior: 'allow', updatedInput: { ...it.input, answers: out } });
      it.answered = Object.entries(out).map(([k, v]) => `${k} → ${v}`).join('\n');
      refreshItem(t, it);
    } }, 'Antworten'),
    el('button', { class: 'ghost danger', onclick: () => {
      api.session.respond(t.id, it.requestId, { behavior: 'deny', message: 'Der Nutzer möchte die Frage nicht beantworten.' });
      it.answered = '✕ Übersprungen'; refreshItem(t, it);
    } }, 'Überspringen')));
  return card;
}

// ---------- Nachrichten von Claude verarbeiten ----------
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => c.type === 'text' ? c.text : c.type === 'image' ? '[Bild]' : '').join('\n');
  return '';
}
const hiddenUserText = s => !s || /^\s*<(command-|local-command|system-reminder|bash-|user-memory|task-notification)/.test(s) || s.startsWith('[Request interrupted');

function ingest(t, m, fromHistory = false) {
  const add = it => (fromHistory ? t.items.push(it) : appendItem(t, it));
  switch (m.type) {
    case 'system':
      if (m.subtype === 'init') {
        const changed = t.sessionId !== m.session_id;
        t.sessionId = m.session_id;
        t.modelName = m.model;
        if (changed) saveTabs();
      } else if (m.subtype === 'compact_boundary') add({ kind: 'sys', text: 'Unterhaltung wurde zusammengefasst' });
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
      if (typeof c === 'string') { if (!hiddenUserText(c)) add({ kind: 'me', text: c, time: Date.parse(m.timestamp) || null }); break; }
      if (!Array.isArray(c)) break;
      for (const block of c) {
        if (block.type === 'tool_result') {
          // Hintergrund-Befehl: Pfad der Ausgabedatei steht im Ergebnis des Aufrufs
          const outFile = /Output is being written to: (.+?\.output)/.exec(textOf(block.content))?.[1];
          const task = outFile && Object.values(t.tasks || {}).find(x => x.toolUseId === block.tool_use_id);
          if (task) { task.output = outFile; renderBgBar(t); }
          const tool = [...t.items].reverse().find(x => x.kind === 'tool' && x.id === block.tool_use_id);
          if (tool) {
            tool.result = textOf(block.content) || '(keine Ausgabe)';
            tool.isError = !!block.is_error;
            if (!fromHistory) refreshItem(t, tool);
          }
        } else if (block.type === 'text' && fromHistory && !hiddenUserText(block.text)) {
          // Bilder derselben Nachricht (aus dem Verlauf) mit anzeigen
          const images = c.filter(b => b.type === 'image' && b.source?.type === 'base64' && IMG_TYPES.includes(b.source.media_type)).map(b => `data:${b.source.media_type};base64,${b.source.data}`);
          add({ kind: 'me', text: block.text, time: Date.parse(m.timestamp) || null, images });
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
      notifyIfHidden(t, r.tool_name === 'AskUserQuestion' ? 'Claude hat eine Frage' : r.tool_name === 'ExitPlanMode' ? 'Claude hat einen Plan vorgelegt' : 'Claude braucht deine Erlaubnis');
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
      notifyIfHidden(t, m.is_error ? 'Fehler: ' + String(m.result || errorLabel(m.subtype)).slice(0, 120) : (t.preview || 'Antwort ist fertig'));
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
        add({ kind: 'sys', error: true, text: `Claude wurde beendet (Code ${m.code}).${tail ? '\n' + tail : ''}${/login|auth|401/i.test(tail) ? '\nBitte das Konto unter „Konten verwalten“ anmelden.' : ''}` });
        setTyping(t); updateComposer(); renderList();
      }
      break;
  }
}
// ---------- Hintergrund-Aufgaben (z. B. Befehle mit run_in_background, Agenten im Hintergrund) ----------
// Claude Code meldet task_started / task_updated / task_notification / background_tasks_changed.
const TASK_TYPES = { local_bash: 'Befehl', local_agent: 'Agent', remote_agent: 'Agent (Cloud)' };
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
  renderBgBar(t);
}
const taskIcon = s => (s === 'running' ? el('span', { class: 'spinner sm' }) : el('span', { class: 'bg-ic ' + (s === 'completed' ? 'ok' : 'err') }, s === 'completed' ? '✓' : '✕'));
function taskDuration(task) {
  const s = Math.round(((task.end || Date.now()) - task.start) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
function renderBgBar(t) {
  if (t.id !== activeTabId) return;
  const bar = $('#bgbar');
  const list = Object.values(t.tasks || {});
  bar.hidden = !list.length;
  if (!list.length) return;
  const running = list.filter(x => x.status === 'running').length, done = list.length - running;
  const failed = list.filter(x => x.status !== 'running' && x.status !== 'completed').length;
  fill(bar, el('button', { class: 'bg-chip' + (running ? ' running' : ''), onclick: () => ($('#bg-menu') ? closeMenus() : openBgMenu(t)) },
    running ? el('span', { class: 'spinner sm' }) : el('span', { class: 'bg-ic ' + (failed ? 'err' : 'ok') }, failed ? '✕' : '✓'),
    running ? (running === 1 ? '1 Hintergrund-Aufgabe läuft' : `${running} Hintergrund-Aufgaben laufen`) : '',
    running && done ? ' · ' : '',
    done ? `${done} beendet` : '',
    el('span', { class: 'bg-hint' }, ' – anzeigen')));
}
function openBgMenu(t) {
  closeMenus();
  const r = $('#bgbar').getBoundingClientRect();
  const list = Object.values(t.tasks || {}).sort((a, b) => b.start - a.start);
  const items = [el('div', { class: 'pm-title' }, 'Hintergrund-Aufgaben')];
  for (const task of list) {
    items.push(el('div', { class: 'bg-item' },
      taskIcon(task.status),
      el('div', { class: 'pm-text' },
        el('b', {}, task.desc || task.id),
        el('small', {}, [TASK_TYPES[task.type] || task.type || 'Aufgabe', task.status === 'running' ? 'läuft seit ' + taskDuration(task) : (task.summary || task.status) + ' · ' + taskDuration(task)].join(' · '))),
      task.output ? el('button', { class: 'ghost', onclick: () => { closeMenus(); showTaskOutput(task); } }, 'Ausgabe') : null));
  }
  if (list.some(x => x.status !== 'running')) items.push(el('div', { class: 'pm-sep' }), el('button', { class: 'pm-item', onclick: () => {
    for (const [id, x] of Object.entries(t.tasks)) if (x.status !== 'running') delete t.tasks[id];
    closeMenus(); renderBgBar(t);
  } }, el('span', { class: 'pm-ic' }, '🧹'), 'Beendete entfernen'));
  const menu = el('div', { class: 'popmenu bg-menu', id: 'bg-menu', style: `left:${r.left}px; bottom:${window.innerHeight - r.top + 6}px` }, ...items);
  document.body.append(menu);
}
async function showTaskOutput(task) {
  const pre = el('pre', { class: 'task-output' }, 'Wird geladen …');
  const info = el('div', { class: 'hint' });
  const load = async () => {
    const r = await api.readTaskOutput(task.output);
    pre.textContent = r.error ? r.error : (r.text || '(noch keine Ausgabe)');
    info.textContent = r.error ? '' : `${r.truncated ? 'Letzte 64 KB von ' : ''}${Math.round((r.size || 0) / 1024 * 10) / 10} KB · ${task.status === 'running' ? 'läuft noch' : 'beendet'}`;
    pre.scrollTop = pre.scrollHeight;
  };
  modal('task-out', task.desc || 'Ausgabe', info, pre,
    el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'ghost', onclick: load }, 'Aktualisieren'), el('button', { class: 'ghost', onclick: e => copyText(pre.textContent, e.currentTarget) }, 'Kopieren')));
  load();
}
function errorLabel(sub) {
  return { error_max_turns: 'Maximale Anzahl an Schritten erreicht.', error_during_execution: 'Fehler während der Ausführung (oder abgebrochen).' }[sub] || 'Fehler: ' + sub;
}

function scheduleStreamRender(t) {
  if (t._raf) return;
  // höchstens ~15× pro Sekunde neu zeichnen
  t._raf = setTimeout(() => { t._raf = null; if (t.streamItem) refreshItem(t, t.streamItem); }, 66);
}
// Windows-Benachrichtigung (fertige Antwort, Rückfrage) – je nach Einstellung immer, nur wenn der Chat
// nicht im Blick ist, oder nie; optional mit eigenem Ton. Klick holt Swapline nach vorne und öffnet den Chat.
function notifyIfHidden(t, text) {
  if (t.id !== activeTabId) { t.unread = true; renderList(); }
  const mode = store.settings.notify || 'background';
  const inView = document.hasFocus() && t.id === activeTabId;
  if (!document.hasFocus()) api.attention(); // Taskleiste blinkt
  if (mode === 'off' || (mode === 'background' && inView)) return;
  try {
    const n = new Notification(t.title || 'Swapline', { body: text, icon: 'assets/swapline.ico', silent: soundSetting() !== 'system', tag: t.id });
    n.onclick = () => { api.focusWindow(); view = 'chats'; setSeg(); openTab(t.id); };
  } catch {}
  playSound(); // Windows-Standard kommt über die Benachrichtigung selbst (silent: false)
}
// Kurzer Hinweiston (zwei weiche Töne), erzeugt per Web Audio – keine Tondatei nötig
// Hinweistöne, erzeugt per Web Audio (keine Tondateien). Je Ton: Liste von Noten
// { f: Frequenz, to: Ziel-Frequenz (Gleiten), at: Start (s), d: Dauer (s), v: Lautstärke, w: Wellenform }
const SOUNDS = {
  chime: { label: 'Glocke', notes: [{ f: 880, at: 0, d: 0.45 }, { f: 1318.5, at: 0.14, d: 0.45 }] },
  ping: { label: 'Ping', notes: [{ f: 1568, at: 0, d: 0.28, w: 'triangle', v: 0.22 }] },
  drop: { label: 'Tropfen', notes: [{ f: 1250, to: 420, at: 0, d: 0.22, v: 0.22 }] },
  rise: { label: 'Aufsteigend', notes: [{ f: 1046.5, at: 0, d: 0.3 }, { f: 1318.5, at: 0.1, d: 0.3 }, { f: 1568, at: 0.2, d: 0.45 }] },
  soft: { label: 'Dezent', notes: [{ f: 523.25, at: 0, d: 0.9, v: 0.1 }, { f: 784, at: 0.05, d: 0.9, v: 0.05 }] },
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
api.onUsage(u => { store.usage = u; renderUsage(); });

// ---------- Senden ----------
// ---------- Eingabefeld: /-Befehle, Eingabe-Verlauf, Anhänge ----------
// Befehle, die im Chat-Modus von Claude Code nicht laufen (sie brauchen das Terminal), führt Swapline selbst aus.
const LOCAL_COMMANDS = [
  { name: 'clear', description: 'Neuen Chat beginnen', run: () => newChat() },
  { name: 'new', description: 'Neuen Chat beginnen', run: () => newChat() },
  { name: 'model', description: 'Modell, Aufwand und Berechtigungen wählen', run: () => openChatSettingsMenu() },
  { name: 'rename', description: 'Chat umbenennen', run: () => renameChat() },
  { name: 'login', description: 'Konten verwalten und anmelden', run: () => openAccounts() },
  { name: 'config', description: 'Einstellungen von Swapline', run: () => openSettings() },
  { name: 'settings', description: 'Einstellungen von Swapline', run: () => openSettings() },
];
function commandList() {
  const t = currentTab();
  const cli = (modelInfo[t?.profileId]?.commands || []).filter(c => !LOCAL_COMMANDS.some(l => l.name === c.name));
  return [...LOCAL_COMMANDS.map(c => ({ ...c, local: true })), ...cli];
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
  fill(pop, el('div', { class: 'pm-title' }, 'Befehle · ↑↓ wählen · Enter/Tab übernehmen · Esc schließen'),
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
    el('button', { class: 'att-x', title: 'Entfernen', onclick: () => { attachments.splice(i, 1); renderAttachments(); } }, '×'))));
}
function readImageFile(file) {
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res({ kind: 'image', name: file.name || 'Bild.png', media: file.type, data: String(fr.result).split(',')[1] });
    fr.onerror = () => res(null);
    fr.readAsDataURL(file);
  });
}
async function addFiles(fileList) {
  for (const f of [...fileList].slice(0, 10)) {
    if (IMG_TYPES.includes(f.type) && f.size <= 5 * 1024 * 1024) { const a = await readImageFile(f); if (a) attachments.push(a); continue; }
    const p = api.pathForFile(f);
    if (p) attachments.push({ kind: 'file', name: f.name, path: p, size: f.size });
    else if (IMG_TYPES.includes(f.type)) toast('Bild ist größer als 5 MB');
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
  const st = status[t.profileId];
  if (st && !st.loggedIn) {
    if (st.claudeMissing) { toast(CLAUDE_MISSING_TEXT + ' – bitte installieren oder Pfad in den Einstellungen angeben'); return openSettings(); }
    toast('Dieses Konto ist nicht angemeldet');
    return openAccounts();
  }
  closeCommandPopup();
  if (text) rememberInput(text);
  // Anhänge: Bilder als Bild-Blöcke, Dateien als Pfadliste im Text (Claude liest sie selbst)
  const imgs = attachments.filter(a => a.kind === 'image'), files = attachments.filter(a => a.kind === 'file');
  attachments = []; renderAttachments();
  if (!text) text = imgs.length ? 'Siehe angehängtes Bild.' : 'Siehe angehängte Datei.';
  const fullText = files.length ? `${text}\n\nAngehängte Dateien:\n${files.map(f => '- ' + f.path).join('\n')}` : text;
  const content = imgs.length ? [...imgs.map(a => ({ type: 'image', source: { type: 'base64', media_type: a.media, data: a.data } })), { type: 'text', text: fullText }] : fullText;
  input.value = ''; autosize();
  if (!t.title) t.title = text.replace(/\s+/g, ' ').slice(0, 60);
  t.preview = text.replace(/\s+/g, ' ').slice(0, 90);
  t.updated = Date.now();
  appendItem(t, { kind: 'me', text, time: Date.now(), images: imgs.map(a => `data:${a.media};base64,${a.data}`), files: files.map(f => f.name) });
  t.running = true; setTyping(t); updateComposer();
  saveTabs(); renderList();
  $('#ch-title').textContent = t.title;
  await api.session.send(plainTab(t), content);
}
const plainTab = t => ({ id: t.id, profileId: t.profileId, cwd: t.cwd, sessionId: t.sessionId, model: t.model, effort: t.effort, permissionMode: t.permissionMode });

function autosize() { const i = $('#input'); i.style.height = 'auto'; i.style.height = Math.min(220, i.scrollHeight) + 'px'; }

// Einstellungen eines Chats ändern -> Prozess neu starten (setzt mit --resume fort)
async function changeTab(patch, note, t = currentTab()) {
  if (!t) return;
  if (t.running) { toast('Bitte warten, bis Claude fertig ist'); renderChat(); return; }
  Object.assign(t, patch);
  await api.session.restart(t.id);
  if (note) appendItem(t, { kind: 'sys', text: note });
  saveTabs(); renderList();
  if (t.id === activeTabId) renderChat();
}

// ---------- Modals ----------
function modal(cls, title, ...body) {
  const close = () => root.replaceChildren();
  const root = $('#modal-root');
  const bg = el('div', { class: 'modal-bg', onmousedown: e => { if (e.target === bg) close(); } },
    el('div', { class: 'modal ' + cls }, el('h2', {}, title, el('button', { class: 'x', onclick: close, title: 'Schließen' }, '×')), ...body));
  root.replaceChildren(bg);
  return { close, root: bg.firstChild };
}

function pickFolderModal() {
  return new Promise(resolve => {
    let done = false;
    let profileId = store.activeProfileId;
    const finish = cwd => { if (done) return; done = true; m.close(); resolve({ cwd, profileId }); };
    const chips = el('div', { class: 'acc-chips' });
    const drawChips = () => chips.replaceChildren(...store.profiles.map(x => el('button', {
      class: 'acc-chip' + (x.id === profileId ? ' sel' : ''), title: status[x.id]?.email || '',
      onclick: () => { profileId = x.id; drawChips(); },
    }, avatar(x, 'sm'), x.name, status[x.id] && !status[x.id].loggedIn ? el('span', { class: 'muted' }, ' (abgemeldet)') : '')));
    drawChips();
    const m = modal('pickfolder', 'Neuer Chat',
      el('div', { class: 'hint' }, 'Mit welchem Konto?'), chips,
      el('div', { class: 'hint' }, project(activeProjectId()) ? `Projekt: ${project(activeProjectId()).name} – in welchem Ordner soll Claude arbeiten?` : 'In welchem Ordner soll Claude arbeiten?'),
      el('div', { class: 'pick' },
        project(activeProjectId())?.cwd ? el('button', { class: 'proj-folder', onclick: () => finish(project(activeProjectId()).cwd) }, avatar(project(activeProjectId()), 'sm'), el('div', {}, 'Projektordner', el('small', {}, project(activeProjectId()).cwd))) : null,
        ...store.favorites.map(f => el('button', { onclick: () => finish(f.path) }, el('div', { class: 'folder-ic' }, icon(ICONS.star)), el('div', {}, f.name, el('small', {}, f.path)))),
        el('button', { onclick: async () => { const d = await api.pickFolder(); if (d) finish(d); } }, el('div', { class: 'folder-ic' }, icon(ICONS.folder)), el('div', {}, 'Ordner auswählen …', el('small', {}, 'beliebiges Projekt'))),
        el('button', { onclick: () => finish('') }, el('div', { class: 'folder-ic' }, '~'), el('div', {}, 'Ohne Projekt', el('small', {}, 'im Benutzerordner')))));
    // Schließen über × oder Hintergrund = abbrechen
    new MutationObserver((_, obs) => { if (!$('.modal.pickfolder')) { obs.disconnect(); if (!done) { done = true; resolve(null); } } }).observe($('#modal-root'), { childList: true });
  });
}

function openAccounts() {
  modal('accounts', 'Konten',
    el('div', { class: 'hint' }, 'Jedes Konto hat einen eigenen Konfigurationsordner. Du meldest dich einmal an und kannst danach mit einem Klick links in der Leiste wechseln.'),
    el('div', { id: 'acc-list' }),
    el('div', { class: 'row', style: 'margin-top:14px' },
      el('button', { class: 'primary', onclick: openAddProfile }, '+ Konto hinzufügen'),
      el('button', { class: 'ghost', onclick: () => refreshStatus() }, 'Status aktualisieren')));
  renderAccountsList();
}
function renderAccountsList() {
  const box = $('#acc-list'); if (!box) return;
  box.replaceChildren(...store.profiles.map(p => {
    const st = status[p.id];
    const name = el('div', { class: 'name' }, p.name, p.id === store.activeProfileId ? el('span', { class: 'muted', style: 'font-weight:400' }, '  · aktiv') : '');
    return el('div', { class: 'acc' },
      avatar(p),
      el('div', { class: 'meta' },
        name,
        el('div', { class: 'info' + (st?.claudeMissing ? ' warn' : '') }, stateText(st, true)),
        el('div', { class: 'info mono', title: p.configDir }, p.configDir)),
      el('div', { class: 'btns' },
        st?.loggedIn
          ? el('button', { class: 'ghost', onclick: async () => { if (!confirm(`Konto „${p.name}“ abmelden?`)) return; await api.profiles.logout(p.id); refreshStatus(p.id); } }, 'Abmelden')
          : el('button', { class: 'primary', onclick: () => startLogin(p) }, 'Anmelden'),
        el('button', { class: 'ghost', title: 'Name und Farbe ändern', onclick: () => openEditProfile(p) }, 'Bearbeiten'),
        p.isDefault ? null : el('button', { class: 'ghost danger', onclick: async () => {
          if (!confirm(`Konto „${p.name}“ aus der App entfernen?\n\nDer Ordner ${p.configDir} bleibt erhalten.`)) return;
          store = await api.profiles.remove(p.id); renderRail(); renderAccountsList(); renderList(); renderUsage();
        } }, 'Entfernen')));
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
  modal('login', 'Anmeldung', el('div', { id: 'login-body', 'data-id': p.id }));
  renderLoginModal();
}
function renderLoginModal() {
  const box = $('#login-body'); if (!box) return;
  const p = profile(box.dataset.id); if (!p) return;
  const ls = loginState[p.id] || {};
  const parts = [el('div', { class: 'row' }, avatar(p), el('div', {}, el('b', {}, p.name), el('div', { class: 'hint' }, p.configDir)))];
  if (ls.state === 'waiting') {
    parts.push(
      el('div', { class: 'login-state' }, el('span', { class: 'spinner' }), 'Bitte im Browser anmelden …'),
      el('p', { class: 'hint' }, 'Claude Code hat deinen Standard-Browser mit der Anmeldeseite von Anthropic geöffnet. Melde dich dort mit dem gewünschten Konto an – danach geht es hier automatisch weiter. Die App sieht und speichert dabei keine Zugangsdaten.'),
      el('p', { class: 'hint' }, 'Tipp: Ist im Browser schon ein anderes Claude-Konto angemeldet, nutze ein privates Fenster oder melde dich dort vorher ab.'),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'ghost', title: 'Öffnet ein Konsolenfenster mit „claude auth login“ – dort den Code selbst eingeben', onclick: () => { api.profiles.loginConsole(p.id); loginState[p.id] = { state: 'console' }; renderLoginModal(); } }, 'Code verlangt? Im Konsolenfenster anmelden'),
        el('button', { class: 'ghost danger', onclick: () => cancelLoginUI(p.id) }, 'Abbrechen')));
  }
  if (ls.state === 'console') {
    parts.push(
      el('div', { class: 'login-state' }, 'Anmeldung läuft im Konsolenfenster'),
      el('p', { class: 'hint' }, 'Folge den Anweisungen im Konsolenfenster von Claude Code und gib den Code dort ein. Danach hier auf „Status prüfen“ klicken.'),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'primary', onclick: async () => {
          const st = await api.profiles.status(p.id);
          status[p.id] = st;
          loginState[p.id] = st.loggedIn ? { state: 'done', status: st } : { state: 'console', notYet: true };
          renderRail(); renderAccountsList(); renderLoginModal();
        } }, 'Status prüfen'),
        el('button', { class: 'ghost', onclick: openAccounts }, 'Zurück')),
      ls.notYet ? el('p', { class: 'hint', style: 'color:var(--danger)' }, 'Noch nicht angemeldet.') : null);
  }
  if (ls.state === 'done') {
    parts.push(el('div', { class: 'login-state ok' }, '✓ Angemeldet', ls.status?.email ? el('span', { class: 'muted' }, ' als ' + ls.status.email) : ''),
      el('div', { class: 'hint' }, [planLabel(ls.status || {}), ls.status?.orgName].filter(Boolean).join(' · ')),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'primary', onclick: async () => { $('#modal-root').replaceChildren(); await switchProfile(p.id); } }, 'Zu diesem Konto wechseln'),
        el('button', { class: 'ghost', onclick: openAccounts }, 'Zur Kontenübersicht')));
  }
  if (ls.state === 'error' || ls.state === 'cancelled') {
    parts.push(el('div', { class: 'login-state err' }, ls.state === 'cancelled' ? 'Anmeldung abgebrochen.' : 'Anmeldung fehlgeschlagen.'),
      ls.error ? el('p', { class: 'hint' }, ls.error) : null,
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'primary', onclick: () => startLogin(p) }, 'Erneut versuchen'),
        el('button', { class: 'ghost', onclick: () => { api.profiles.loginConsole(p.id); loginState[p.id] = { state: 'console' }; renderLoginModal(); } }, 'Im Konsolenfenster anmelden'),
        el('button', { class: 'ghost', onclick: openAccounts }, 'Zurück')));
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
  if (d.state === 'done') { status[d.id] = d.status; renderRail(); renderAccountsList(); toast(`✓ ${profile(d.id)?.name} angemeldet`); }
  renderLoginModal();
});

function profileForm(initial, onSave, saveLabel) {
  let color = initial.color || COLORS[store.profiles.length % COLORS.length];
  const name = el('input', { type: 'text', value: initial.name || '', placeholder: 'z. B. Privat, Arbeit, Kunde X' });
  const colors = el('div', { class: 'colors' });
  const drawColors = () => colors.replaceChildren(...COLORS.map(c => el('button', { class: c === color ? 'sel' : '', style: `background:${c}`, onclick: () => { color = c; drawColors(); } })));
  drawColors();
  const m = modal('profile', initial.id ? 'Konto bearbeiten' : 'Neues Konto',
    el('label', { class: 'field' }, el('span', {}, 'Name'), name),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, 'Farbe'), colors),
    initial.id ? null : el('div', { class: 'hint' }, 'Danach öffnet Claude Code deinen Browser mit der Anmeldeseite von Anthropic. Ist dort schon ein anderes Claude-Konto angemeldet, nutze ein privates Fenster.'),
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
  }, 'Anlegen und anmelden');
}
function openEditProfile(p) {
  profileForm(p, async data => { store = await api.profiles.update(p.id, data); renderRail(); renderList(); renderChat(); openAccounts(); }, 'Speichern');
}

// Ton-Auswahl: Vorschau beim Wechseln; „on“ aus älteren Versionen wird als Glocke angezeigt
function soundSelect() {
  const opts = [['off', 'Kein Ton'], ...Object.entries(SOUNDS).map(([k, s]) => [k, s.label]), ['system', 'Windows-Standard']];
  const e = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: soundSetting() === v }, l)));
  e.addEventListener('change', async () => {
    const r = await api.setSettings({ sound: e.value });
    if (r.rejected) { e.value = soundSetting(); return toast('Nicht übernommen'); }
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
      if (r.rejected) { e.value = s[key] || ''; toast('Nicht übernommen'); return; }
      if (key === 'theme') applyTheme();
      if (key === 'toolView') renderMessages();
    });
    return e;
  };
  // Pfad zu claude.exe nur per Datei-Dialog (der Hauptprozess prüft den Dateinamen)
  const path = el('div', { class: 'folder-row' });
  const drawPath = () => fill(path,
    el('span', { class: 'mono ' + (store.settings.claudePath ? '' : 'muted') }, store.settings.claudePath || 'automatisch (~/.local/bin/claude.exe oder PATH)'),
    el('button', { class: 'ghost', onclick: async () => { const r = await api.pickClaude(); store = r; if (r.rejected) toast(r.rejected); drawPath(); } }, 'Wählen …'),
    store.settings.claudePath ? el('button', { class: 'ghost', onclick: async () => { store = await api.setSettings({ claudePath: '' }); drawPath(); } }, 'Automatisch') : null);
  drawPath();
  modal('settings', 'Einstellungen',
    el('label', { class: 'field' }, el('span', {}, 'Darstellung'), sel('theme', [['system', 'Wie System'], ['light', 'Hell'], ['dark', 'Dunkel']])),
    el('label', { class: 'field' }, el('span', {}, 'Modell für neue Chats'), sel('model', [['', `Standard${defName ? ' · ' + defName : ' (laut Konto)'}`], ...modelOpts])),
    el('label', { class: 'field' }, el('span', {}, 'Aufwand für neue Chats'), sel('effort', [['', `Standard${defEff ? ' · ' + (EFFORT_LABEL[defEff] || defEff) : ' (laut Konto)'}`], ...Object.entries(EFFORT_LABEL)])),
    el('p', { class: 'hint' }, '„Standard“ richtet sich nach dem Konto: Modell laut Claude-Empfehlung, Aufwand laut effortLevel in den Claude-Einstellungen des Kontos.'),
    el('label', { class: 'field' }, el('span', {}, 'Berechtigungen für neue Chats'), sel('permissionMode', [['default', 'Nachfragen'], ['acceptEdits', 'Änderungen erlauben'], ['plan', 'Nur planen'], ['bypassPermissions', 'Alles erlauben (--dangerously-skip-permissions)']])),
    store.bypassAcknowledged ? el('div', { class: 'row' },
      el('span', { class: 'hint', style: 'flex:1' }, 'Die Warnung zu „Alles erlauben“ wurde bestätigt und erscheint nicht mehr.'),
      el('button', { class: 'ghost', onclick: async e => { store = await api.resetBypassWarning(); e.target.closest('.row').remove(); toast('Warnung erscheint beim nächsten Mal wieder'); } }, 'Wieder anzeigen')) : null,
    el('label', { class: 'field' }, el('span', {}, 'Werkzeug-Aufrufe im Chat (Befehle, Lesen, Bearbeiten …)'), sel('toolView', [['all', 'Alle anzeigen'], ['compact', 'Kompakt – zu einer Zeile zusammengefasst'], ['hidden', 'Ausblenden – nur Nachrichten und Antworten']])),
    el('label', { class: 'field' }, el('span', {}, 'Benachrichtigung bei fertiger Antwort'), sel('notify', [['background', 'Wenn der Chat nicht im Blick ist (Standard)'], ['always', 'Immer'], ['off', 'Aus']])),
    el('div', { class: 'row' },
      el('label', { class: 'field', style: 'flex:1;margin:0' }, el('span', {}, 'Ton'), soundSelect()),
      el('button', { class: 'ghost', style: 'align-self:flex-end', title: 'Benachrichtigung und Ton jetzt ausprobieren', onclick: () => {
        try { new Notification('Swapline', { body: 'So sieht eine Benachrichtigung aus.', icon: 'assets/swapline.ico', silent: soundSetting() !== 'system' }); } catch {}
        playSound();
      } }, 'Testen')),
    el('div', { class: 'field' }, el('span', { class: 'hint' }, 'Pfad zu Claude Code (claude.exe)'), path),
    el('div', { class: 'about' },
      el('img', { src: BRAND.logo(isDark()), alt: 'ARFEP' }),
      el('div', {},
        el('p', {}, el('b', {}, `Swapline ${VERSION}`), ' – Open Source (MIT)'),
        el('p', { class: 'muted' }, `by ${BRAND.company}, ${BRAND.city}`),
        el('p', {}, el('a', { href: BRAND.website, style: 'color:var(--accent)' }, 'arfep.de'), ' · ',
          el('a', { href: BRAND.contact, style: 'color:var(--accent)' }, 'IT-Hilfe anfragen'), ' · ',
          el('a', { href: BRAND.repo, style: 'color:var(--accent)' }, 'GitHub')))),
    el('p', { class: 'hint' }, 'Inoffizielles Projekt, nicht mit Anthropic verbunden. „Claude“ ist eine Marke von Anthropic.'));
}

// ---------- Ereignisse ----------
$('#btn-new-chat').onclick = () => newChat();
$('#btn-empty-new').onclick = () => newChat();
$('#btn-add-project').onclick = () => openProjectForm();
$('#rail-all').onclick = () => switchProject('all');
$('#rail-all').ondragover = e => { if ([...e.dataTransfer.types].includes('text/chat')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } };
$('#rail-all').ondragleave = e => e.currentTarget.classList.remove('drop');
$('#rail-all').ondrop = e => { e.preventDefault(); e.currentTarget.classList.remove('drop'); const id = e.dataTransfer.getData('text/chat'); if (id) moveChatToProject(id, 'all'); };
$('#btn-account').onclick = () => ($('#account-menu') ? closeMenus() : openAccountMenu());
$('#btn-project-edit').onclick = () => { const pr = project(activeProjectId()); if (pr) openProjectForm(pr); };
$('#btn-settings').onclick = openSettings;
$('#search').oninput = renderList;
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => { view = b.dataset.view; setSeg(); renderList(); });
$('#btn-send').onclick = sendMessage;
$('#btn-stop').onclick = () => { const t = currentTab(); if (t) api.session.interrupt(t.id); };
$('#input').addEventListener('input', autosize);
$('#input').addEventListener('keydown', e => {
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
$('#input').addEventListener('input', () => { cmdState.index = cmdState.open ? cmdState.index : 0; updateCommandPopup(); });
$('#input').addEventListener('blur', () => setTimeout(closeCommandPopup, 150));
// Anhänge: Knopf, Einfügen (Strg+V mit Bild) und Ziehen ins Fenster
$('#btn-attach').onclick = async () => { const r = await api.pickAttachments(); if (r?.length) { attachments.push(...r); renderAttachments(); } };
$('#input').addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
});
$('#chat-view').addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('#chat-view').classList.add('dropping'); } });
$('#chat-view').addEventListener('dragleave', e => { if (e.target === $('#chat-view') || !e.relatedTarget) $('#chat-view').classList.remove('dropping'); });
$('#chat-view').addEventListener('drop', e => { $('#chat-view').classList.remove('dropping'); if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
// Chat umbenennen: Titel oben direkt bearbeiten (Enter speichert, Esc bricht ab). Gilt in Swapline;
// die Sitzungsdateien von Claude Code bleiben unverändert.
function renameChat() {
  const t = currentTab(); if (!t) return;
  const title = $('#ch-title');
  if (title.querySelector('input')) return;
  const input = el('input', { type: 'text', class: 'title-edit', value: t.title || '', maxlength: '80', placeholder: 'Name des Chats' });
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    const v = input.value.replace(/\s+/g, ' ').trim();
    if (save && v && v !== t.title) { t.title = v; saveTabs(); renderList(); toast('Chat umbenannt'); }
    title.textContent = t.title || 'Neuer Chat';
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
  title.replaceChildren(input);
  input.focus(); input.select();
}
$('#ch-title').ondblclick = renameChat;
$('#ch-title').title = 'Doppelklick zum Umbenennen';
$('#ch-cwd').onclick = () => { const t = currentTab(); if (t?.cwd) api.openPath(t.cwd); };
$('#ch-settings').onclick = () => ($('#chat-menu') ? closeMenus() : openChatSettingsMenu());
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); }
  if (e.key === 'Escape') {
    if ($('#modal-root').children.length) return $('#modal-root').replaceChildren();
    const t = currentTab(); if (t?.running) api.session.interrupt(t.id);
  }
  if (e.ctrlKey && /^[1-9]$/.test(e.key)) { const p = store.profiles[+e.key - 1]; if (p) switchProfile(p.id); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderUsage);

// ---------- Start ----------
(async function init() {
  store = await api.getStore();
  VERSION = store.appVersion || '';
  applyTheme();
  const saved = loadTabs();
  tabs = (saved.tabs || []).map(t => makeTab({ ...t, loaded: !t.sessionId }));
  activeTabId = tabs.some(t => t.id === saved.activeTabId) ? saved.activeTabId : null;
  lastOpened = saved.lastOpened || {};
  renderRail(); renderList(); renderUsage();
  if (activeTabId) openTab(activeTabId); else renderChat();
  refreshStatus();
  for (const p of store.profiles) loadModels(p.id).then(() => { const t = currentTab(); if (t?.profileId === p.id) renderChatChip(t); });
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
})();
