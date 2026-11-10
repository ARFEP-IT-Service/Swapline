// Nachbau von Claude Code für Tests (stream-json über stdin/stdout): meldet init, fragt bei jeder Nachricht einmal nach
// „Bash: echo hi“ und antwortet nach der Erlaubnis mit dem Text der Nachricht. „auth status --json“ → angemeldet.
'use strict';
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args[0] === 'auth') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const sid = '11111111-2222-4333-8444-' + String(Date.now()).slice(-12).padStart(12, '0');
out({ type: 'system', subtype: 'init', session_id: sid, model: 'test', cwd: process.cwd() });
let last = '';
readline.createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'user') {
    const c = m.message.content;
    last = typeof c === 'string' ? c : c.filter(b => b.type === 'text').map(b => b.text).join('\n');
    out({ type: 'control_request', request_id: 'req1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'echo hi' }, permission_suggestions: null } });
  } else if (m.type === 'control_response') {
    const ok = m.response?.response?.behavior === 'allow';
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: (ok ? 'erlaubt: ' : 'abgelehnt: ') + last }] } });
    out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0 });
  }
});
