// Swapline – Einstufung von Rückfragen („Darf Claude … ausführen?“): kritisch (rot), Vorsicht (orange) oder normal.
// Nur eine Anzeige-Hilfe – entschieden wird weiter per Klick. Dieselben Regeln stehen in
// android/app/src/main/java/de/arfep/swapline/model/Risk.kt; tests/risk-cases.json prüft beide.
'use strict';

// [Grund, Muster] – das erste passende Muster entscheidet, kritische zuerst
const RISK_CRITICAL = [
  ['delete', /\brm(?=[^|;&\n]*\s(?:-[a-z]*r|--recursive))(?=[^|;&\n]*\s(?:-[a-z]*f|--force))\s|\bRemove-Item\b(?=[^|;\n]*\s-Recurse)(?=[^|;\n]*\s-Force)|\b(?:rd|rmdir)\s+\/s\b|\bdel\s+(?:\/\w+\s+)*\/s\b/i],
  ['git', /\bgit\s+push\b[^|;&\n]*(?:\s--force(?:-with-lease)?\b|\s-f\b|\s--delete\b|\s\+\S)|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f|\bgit\s+filter-(?:branch|repo)\b|\bgit\s+branch\s+-D\b/i],
  ['script', /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node|iex|Invoke-Expression)\b|\biex\s*\(|\bInvoke-Expression\b/i],
  ['system', /\bsudo\b|\bdoas\b|\bmkfs|\bdd\s+if=|\bformat\s+[a-z]:|\bdiskpart\b|\bshutdown\b|\breboot\b|\bpoweroff\b|\bStop-Computer\b|\bRestart-Computer\b|\bFormat-Volume\b|\bbcdedit\b|\bvssadmin\b|\breg\s+(?:delete|add)\b|\bSet-ExecutionPolicy\b|\bchmod\s+(?:-R\s+)?0?777\b|\bchown\s+-R\b|:\(\)\s*\{|>\s*\/dev\/sd|\bkill\s+-9\s+-1\b|\btakeown\b/i],
  ['database', /\bdrop\s+(?:table|database|schema)\b|\btruncate\s+table\b/i],
  ['publish', /\b(?:npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+(?:create|delete)\b|\bgh\s+repo\s+delete\b/i],
  ['secret', /\.ssh[\\/]|\bid_(?:rsa|ed25519)\b|\.aws[\\/]credentials|\.credentials\.json|\/etc\/(?:passwd|shadow|sudoers)\b/i],
];
const RISK_MEDIUM = [
  ['delete', /\brm\s|\brmdir\b|\bdel\s|\bRemove-Item\b|\bunlink\b|\s-delete\b|\bgit\s+rm\b|\bdocker\s+(?:rm|rmi|system\s+prune|volume\s+rm)\b/i],
  ['install', /\b(?:npm|pnpm|yarn)\s+(?:i|install|add|update|upgrade)\b|\bnpx\s|\bpip3?\s+install\b|\bapt(?:-get)?\s+(?:install|remove|purge)\b|\bbrew\s+install\b|\bwinget\s+(?:install|uninstall)\b|\bchoco\s+(?:install|uninstall)\b|\bcargo\s+install\b|\bgo\s+install\b/i],
  ['git', /\bgit\s+(?:push|rebase|merge|restore|commit\s+--amend|checkout\s+--|stash\s+(?:drop|clear)|tag\s+-d)\b/i],
  ['network', /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|scp|rsync|ssh|sftp|ftp)\b/i],
  ['process', /\b(?:kill|pkill|killall|taskkill|Stop-Process|Stop-Service)\b|\bsystemctl\s+(?:stop|restart|disable)\b/i],
  ['permissions', /\b(?:chmod|chown|icacls|attrib)\b/i],
];
// Dateien: Zugangsdaten und Systemdateien kritisch, Einstellungen von Projekt und Werkzeugen Vorsicht
const RISK_FILE_CRITICAL = /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg)[\\/]|(?:^|[\\/])\.env(?:\.[\w-]+)?$|\bid_(?:rsa|ed25519)\b|credentials|(?:^|[\\/])(?:\.npmrc|\.pypirc|authorized_keys|\.bashrc|\.zshrc|\.profile)$|^\/etc\/|[\\/]Windows[\\/]|System32/i;
const RISK_FILE_MEDIUM = /[\\/]\.git[\\/]|[\\/]\.github[\\/]workflows[\\/]|[\\/]\.claude[\\/]settings|(?:^|[\\/])package\.json$/i;

function permRisk(tool, input) {
  const i = input && typeof input === 'object' ? input : {};
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = typeof i.command === 'string' ? i.command : '';
    for (const [reason, re] of RISK_CRITICAL) if (re.test(cmd)) return { level: 'critical', reason };
    for (const [reason, re] of RISK_MEDIUM) if (re.test(cmd)) return { level: 'medium', reason };
    return { level: 'normal', reason: '' };
  }
  const file = typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : '';
  if (file && ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    if (RISK_FILE_CRITICAL.test(file)) return { level: 'critical', reason: 'secret' };
    if (RISK_FILE_MEDIUM.test(file)) return { level: 'medium', reason: 'config' };
  }
  return { level: 'normal', reason: '' };
}

if (typeof module !== 'undefined') module.exports = { permRisk };
