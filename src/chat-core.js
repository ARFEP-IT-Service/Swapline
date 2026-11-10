// Gemeinsamer Kern für Swapline am PC (src/main.js) und den Server-Dienst (server/): was beide gleich machen müssen –
// Nachrichten und Antworten an Claude prüfen, Startparameter der CLI, Sitzungsdateien lesen, Verlauf in Seiten.
// Nur Node, keine Electron-Abhängigkeiten.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Startparameter für einen Chat (stream-json, Rückfragen über stdio)
function claudeArgs(tab) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-prompt-tool', 'stdio', '--include-partial-messages'];
  if (tab.sessionId) args.push('--resume', tab.sessionId);
  if (tab.model) args.push('--model', tab.model);
  // "Alles erlauben" = --dangerously-skip-permissions (keine Rückfragen, wie im Terminal)
  if (tab.permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
  else if (tab.permissionMode && tab.permissionMode !== 'default') args.push('--permission-mode', tab.permissionMode);
  if (tab.effort) args.push('--effort', tab.effort);
  return args;
}

// Antwort auf eine Rückfrage der CLI: die Eingabe des Werkzeugs darf nicht verändert werden (Ausnahme: Antworten auf eine
// Frage), Regeln nur exakt so, wie die CLI sie vorgeschlagen hat, und nie ein Moduswechsel. → { out } oder { error }
function checkResponse(req, response) {
  if (!response || !['allow', 'deny'].includes(response.behavior)) return { error: 'ungültige Antwort' };
  if (response.behavior === 'deny') {
    // Claude liest den Text: Standard immer Englisch
    return { out: { behavior: 'deny', message: String(response.message || 'Declined.').slice(0, 500) } };
  }
  let input = req.input;
  if (req.toolName === 'AskUserQuestion') {
    const { answers, ...rest } = response.updatedInput || {};
    if (!same(rest, req.input)) return { error: 'Eingabe verändert' };
    const clean = {};
    for (const [k, v] of Object.entries(answers || {})) if (typeof v === 'string') clean[String(k).slice(0, 500)] = v.slice(0, 2000);
    input = { ...req.input, answers: clean };
  } else if (!same(response.updatedInput, req.input)) return { error: 'Eingabe verändert' };
  const out = { behavior: 'allow', updatedInput: input };
  if (response.updatedPermissions != null) {
    const perms = response.updatedPermissions;
    if (!req.suggestions || !same(perms, req.suggestions) || perms.some(x => x?.type === 'setMode')) return { error: 'Regeln nicht wie vorgeschlagen' };
    out.updatedPermissions = req.suggestions;
  }
  return { out };
}

// ---------- Verlauf aus <configDir>/projects lesen ----------
function encodeCwd(cwd) { return cwd.replace(/[^a-zA-Z0-9]/g, '-'); }

function readHead(file, bytes = 65536) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}

function readTail(file, bytes = 65536) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

function listSessions(root, untitled, limit = 200) {
  const items = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return []; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(root, d, f);
      try { items.push({ file: full, mtime: fs.statSync(full).mtimeMs, sessionId: f.slice(0, -6) }); } catch {}
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items.slice(0, limit).map(it => {
    let text = '';
    try { text = readHead(it.file) + '\n' + readTail(it.file, 32768); } catch {}
    const { title, cwd, firstPrompt } = parseSessionHead(text);
    return { sessionId: it.sessionId, file: it.file, mtime: it.mtime, cwd, title: title || firstPrompt.slice(0, 80) || untitled };
  }).filter(h => h.cwd || h.title !== untitled);
}
function parseSessionHead(text) {
  let title = '', cwd = '', firstPrompt = '';
  {
    {
      for (const line of text.split('\n')) {
        if (!line.startsWith('{')) continue;
        if (line.includes('"ai-title"') || line.includes('"custom-title"')) {
          try { const o = JSON.parse(line); title = o.customTitle || o.aiTitle || title; } catch {}
        } else if (!cwd && line.includes('"cwd"')) {
          try { const o = JSON.parse(line); if (o.cwd) cwd = o.cwd; } catch {}
        }
        if (!firstPrompt && line.includes('"type":"user"')) {
          try {
            const o = JSON.parse(line);
            const c = o.message?.content;
            if (typeof c === 'string' && !c.startsWith('<')) firstPrompt = c;
          } catch {}
        }
      }
    }
  }
  return { title, cwd, firstPrompt };
}

function loadTranscript(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return transcriptFromText(text);
}

function transcriptFromText(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if ((o.type === 'user' || o.type === 'assistant') && o.message && !o.isSidechain && !o.isMeta) {
      out.push({ type: o.type, message: o.message, timestamp: o.timestamp, fromHistory: true });
    } else if (o.type === 'system' && o.subtype === 'away_summary' && typeof o.content === 'string') {
      out.push({ type: 'system', subtype: 'away_summary', content: o.content, timestamp: o.timestamp, fromHistory: true });
    }
  }
  return out;
}

// ---------- Verlauf in Seiten (für Geräte über Fernzugriff) ----------
const PAGE_HIDDEN = /^\s*<(command-|local-command|system-reminder|user-memory|task-notification)/;
function isPrompt(m) {
  if (m?.type !== 'user') return false;
  const c = m.message?.content;
  if (typeof c === 'string') return !!c.trim() && !PAGE_HIDDEN.test(c) && !c.startsWith('[Request interrupted');
  return Array.isArray(c) && c.some(b => b?.type === 'text' && typeof b.text === 'string' && b.text.trim() && !PAGE_HIDDEN.test(b.text));
}
const PAGE_CUT = 4000, PAGE_MAX_MSGS = 600;
const cutText = s => (typeof s === 'string' && s.length > PAGE_CUT ? s.slice(0, PAGE_CUT) + `\n… [${s.length - PAGE_CUT} more characters]` : s);
// Für die Anzeige auf dem Gerät verkleinern: Bilder ohne Daten, lange Ergebnisse und Eingaben gekürzt, Denkblöcke weg
function slimMessage(m) {
  const c = m.message?.content;
  if (!Array.isArray(c)) return m;
  const content = c.filter(b => b && b.type !== 'thinking' && b.type !== 'redacted_thinking').map(b => {
    if (b.type === 'image') return { type: 'image', source: { type: 'base64', media_type: b.source?.media_type || 'image/png', data: '' }, omitted: true };
    if (b.type === 'tool_result') {
      const r = Array.isArray(b.content) ? b.content.filter(x => x?.type === 'text').map(x => x.text).join('\n') : b.content;
      return { ...b, content: cutText(typeof r === 'string' ? r : '') };
    }
    if (b.type === 'tool_use' && b.input && typeof b.input === 'object') {
      return { ...b, input: Object.fromEntries(Object.entries(b.input).map(([k, v]) => [k, typeof v === 'string' ? cutText(v) : v])) };
    }
    return b;
  });
  return { ...m, message: { ...m.message, content } };
}
function pageTranscript(all, turns, before) {
  const end = Number.isInteger(before) && before >= 0 && before <= all.length ? before : all.length;
  let start = end, n = 0;
  while (start > 0) {
    start--;
    if (isPrompt(all[start]) && ++n >= turns) break;
  }
  if (end - start > PAGE_MAX_MSGS) start = end - PAGE_MAX_MSGS; // ein Abschnitt mit sehr vielen Schritten: nur dessen Ende
  return { msgs: all.slice(start, end).map(slimMessage), start, total: all.length };
}

// ---------- Nachrichteninhalt: Text oder Liste aus Text- und Bild-Blöcken (Bilder als base64, je max. 5 MB) ----------
const IMAGE_MEDIA = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
function validContent(c) {
  if (typeof c === 'string') return c.length <= 2e6;
  if (!Array.isArray(c) || !c.length || c.length > 20) return false;
  return c.every(b => (b?.type === 'text' && typeof b.text === 'string' && b.text.length <= 2e6)
    || (b?.type === 'image' && b.source?.type === 'base64' && IMAGE_MEDIA.includes(b.source.media_type)
      && typeof b.source.data === 'string' && b.source.data.length <= 7e6 && /^[A-Za-z0-9+/]+=*$/.test(b.source.data)));
}

module.exports = { same, claudeArgs, checkResponse, encodeCwd, readHead, readTail, listSessions, parseSessionHead, loadTranscript, transcriptFromText,
  isPrompt, slimMessage, pageTranscript, IMAGE_MEDIA, validContent };
