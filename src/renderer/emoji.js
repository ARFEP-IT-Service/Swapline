// Swapline – Smileys im eigenen Text werden zu Emojis (wie in Messenger-Apps): „:D“ → 😄, sobald danach ein Leerzeichen
// getippt oder gesendet wird. Nur einzeln stehende Smileys (Anfang oder Leerzeichen davor), nie in `Code` oder ```Blöcken```.
// Dieselbe Tabelle steht in android/app/src/main/java/de/arfep/swapline/ui/Emoji.kt; tests/emoji-cases.json prüft beide.
'use strict';

const EMOTICONS = [
  [':-)', '🙂'], [':)', '🙂'], [':-D', '😄'], [':D', '😄'], [';-)', '😉'], [';)', '😉'], [';D', '😜'],
  [':-(', '🙁'], [':(', '🙁'], [":'(", '😢'], [':-P', '😛'], [':P', '😛'], [':p', '😛'], [';P', '😜'], [';p', '😜'],
  [':-O', '😮'], [':O', '😮'], [':o', '😮'], [':*', '😘'], [':-*', '😘'], ['XD', '😆'], ['xD', '😆'],
  [':/', '😕'], [':-/', '😕'], [':|', '😐'], ['^^', '😊'], ['<3', '❤️'], ['</3', '💔'], [':+1:', '👍'], [':-1:', '👎'],
];
const EMOTICON_MAP = new Map(EMOTICONS);

// Liegt die Stelle in Code (`…` oder ```…```)? Dann nichts umwandeln.
function inCode(text, pos) {
  const before = text.slice(0, pos);
  const fences = (before.match(/```/g) || []).length;
  if (fences % 2) return true;
  const line = before.slice(before.lastIndexOf('\n') + 1).replace(/```/g, '');
  return ((line.match(/`/g) || []).length % 2) === 1;
}

// Ganzen Text umwandeln (beim Senden und für die Anzeige eigener Nachrichten)
function emojify(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/(^|\s)(\S+)(?=\s|$)/g, (m, pre, tok, off) => {
    const e = EMOTICON_MAP.get(tok);
    return e && !inCode(text, off + pre.length) ? pre + e : m;
  });
}

// Beim Tippen: wurde gerade ein Leerzeichen/Zeilenumbruch hinter einem Smiley getippt? → { text, cursor, undo } oder null
function emojifyAtCursor(text, cursor) {
  if (cursor < 2 || !/\s/.test(text[cursor - 1])) return null;
  const head = text.slice(0, cursor - 1);
  const m = /(^|\s)(\S+)$/.exec(head);
  if (!m) return null;
  const e = EMOTICON_MAP.get(m[2]);
  const start = head.length - m[2].length;
  if (!e || inCode(text, start)) return null;
  return { text: text.slice(0, start) + e + text.slice(cursor - 1), cursor: start + e.length + 1, undo: { start, emoji: e, original: m[2] } };
}

if (typeof module !== 'undefined') module.exports = { EMOTICONS, emojify, emojifyAtCursor, inCode };
