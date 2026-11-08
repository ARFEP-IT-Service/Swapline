// Gemeinsame Hilfen für die Oberflächentests (wird jeder Testdatei vorangestellt).
// Jede Testdatei ist ein async-Ausdruck, der die Liste der Ergebnisse zurückgibt: return T;
const T = [];
const check = (name, ok, detail = '') => T.push({ name, ok: !!ok, detail: ok ? '' : String(detail) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WORK = __WORK__; // eigener Temp-Ordner des Testlaufs (als Arbeitsordner freigegeben)
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
const key = (target, k, opts = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
const typeInto = (input, v) => { input.value = v; input.setSelectionRange(v.length, v.length); input.dispatchEvent(new Event('input')); };
