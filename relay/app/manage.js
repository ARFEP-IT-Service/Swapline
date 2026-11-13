// Verwaltung des Dienstes über PowerShell (nur Windows, als Administrator): Aufgabe beim Systemstart, Firewall-Regel,
// Zugriffsrechte des Datenordners. Alle Werte gehen als Umgebungsvariablen an feste Skripte – nichts wird in Befehle
// eingesetzt. Benutzer- und Gruppennamen über SIDs (sprachunabhängig: „Administratoren“ auf deutschem Windows).
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const P = require('./paths.js');

const TASK = 'SwaplineRelay';
const RULE = 'Swapline-Vermittler';
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function ps(script, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).toString().trim().split('\n').slice(-3).join(' ').slice(0, 400))) : resolve(String(stdout).trim())));
  });
}

async function isAdmin() {
  try { return (await ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)')) === 'True'; }
  catch { return false; }
}

async function serviceState() {
  const out = await ps(`
    $t = Get-ScheduledTask -TaskName $env:SR_TASK -ErrorAction SilentlyContinue
    $f = Get-NetFirewallRule -DisplayName $env:SR_RULE -ErrorAction SilentlyContinue | Select-Object -First 1
    $port = $null; if ($f) { $port = ($f | Get-NetFirewallPortFilter).LocalPort }
    [pscustomobject]@{ task = $(if ($t) { [string]$t.State } else { $null }); firewall = [bool]$f; firewallPort = [string]$port } | ConvertTo-Json -Compress`,
  { SR_TASK: TASK, SR_RULE: RULE });
  try { return JSON.parse(out); } catch { return { task: null, firewall: false, firewallPort: '' }; }
}

// Wie der Dienst gestartet wird: Node der App (ELECTRON_RUN_AS_NODE) mit service.js – ohne Fenster, ohne Chromium
function launcher(exe = process.execPath) {
  const svc = process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'app.asar.unpacked', 'service.js'))
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'service.js')
    : path.join(__dirname, 'service.js');
  const q = s => "'" + s.replace(/'/g, "''") + "'";
  // „| Out-Null“: die .exe ist ein Fensterprogramm – ohne Pipe wartet PowerShell nicht, die Aufgabe endet sofort
  // und der Dienst beendet sich mit ihr (Neustart-Schleife alle 3 s in 0.1.0)
  return { exe, svc, arg: `-NoProfile -NonInteractive -WindowStyle Hidden -Command "& { $env:ELECTRON_RUN_AS_NODE='1'; & ${q(exe)} ${q(svc)} | Out-Null }"` };
}

async function setFirewall(port) {
  await ps(`
    Get-NetFirewallRule -DisplayName $env:SR_RULE -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $env:SR_RULE -Description 'Swapline Relay' -Direction Inbound -Protocol TCP -LocalPort ([int]$env:SR_PORT) -Action Allow -Profile Any | Out-Null`,
  { SR_RULE: RULE, SR_PORT: String(port) });
}

async function removeFirewall() {
  await ps('Get-NetFirewallRule -DisplayName $env:SR_RULE -ErrorAction SilentlyContinue | Remove-NetFirewallRule', { SR_RULE: RULE });
}

// Datenordner absichern, BEVOR darin Schlüssel angelegt werden: Besitzer Administratoren, Zugriff nur Administratoren
// (S-1-5-32-544) und SYSTEM (S-1-5-18) voll, Lokaler Dienst (S-1-5-19) ändern, keine geerbten Rechte (ProgramData erlaubt
// sonst allen Benutzern das Lesen). Hat ein normaler Benutzer den Ordner vorher angelegt, übernimmt das hier wieder.
// Rechte nur am Ordner setzen und die Dateien darin auf „geerbt“ zurücksetzen – in 0.3.0 gingen die Ordnerrechte mit /T
// auch an die Dateien, dort sind (OI)(CI) ungültig: relay.log und status.json hatten danach GAR KEINE Rechte (der Dienst
// lief, konnte aber weder Protokoll noch Status schreiben; die App zeigte „Gestoppt“).
async function secureDir(dir = P.dataDir(), { owner = true } = {}) {
  await ps(`
    $dir = $env:SR_DIR
    New-Item -ItemType Directory -Force $dir | Out-Null
    if ($env:SR_OWNER -eq '1') { & icacls $dir /setowner '*S-1-5-32-544' /T /C | Out-Null }
    & icacls $dir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'icacls (Ordner) fehlgeschlagen' }
    if (Get-ChildItem -Force $dir) {
      & icacls (Join-Path $dir '*') /reset /T /C | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'icacls (Dateien) fehlgeschlagen' }
    }`, { SR_DIR: dir, SR_OWNER: owner ? '1' : '0' });
}
// Update-Ordner: nur Administratoren und SYSTEM dürfen schreiben (auch nicht der Dienst), damit niemand das geprüfte
// Setup zwischen Prüfung und Start austauscht
async function secureUpdateDir() {
  const dir = P.file('update');
  await ps(`
    $dir = $env:SR_DIR
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    New-Item -ItemType Directory -Force $dir | Out-Null
    & icacls $dir /setowner '*S-1-5-32-544' | Out-Null
    & icacls $dir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'icacls fehlgeschlagen' }`, { SR_DIR: dir });
  return dir;
}

async function install() {
  await secureDir();
  const cfg = P.ensureConfig();
  const l = launcher();
  await ps(`
    $dir = $env:SR_DIR
    $ls = (New-Object Security.Principal.SecurityIdentifier 'S-1-5-19').Translate([Security.Principal.NTAccount]).Value
    Unregister-ScheduledTask -TaskName $env:SR_TASK -Confirm:$false -ErrorAction SilentlyContinue
    $action = New-ScheduledTaskAction -Execute $env:SR_PS -Argument $env:SR_ARG -WorkingDirectory $dir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId $ls -LogonType ServiceAccount
    $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $env:SR_TASK -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Swapline Relay (Vermittler)' | Out-Null
    Start-ScheduledTask -TaskName $env:SR_TASK`,
  { SR_DIR: P.dataDir(), SR_TASK: TASK, SR_PS: PS, SR_ARG: l.arg });
  await setFirewall(cfg.port);
}

// Ältere Versionen haben die Aufgabe mit einem anderen Startbefehl eingerichtet: dann neu einrichten
// (Einträge der Haupt-PCs, Port und Protokoll bleiben). Ergebnis: 'none' (keine Aufgabe), 'ok' oder 'repaired'.
async function repair() {
  const cur = await ps(`
    $t = Get-ScheduledTask -TaskName $env:SR_TASK -ErrorAction SilentlyContinue
    if ($t) { [string]$t.Actions[0].Execute + [char]10 + [string]$t.Actions[0].Arguments } else { '-' }`, { SR_TASK: TASK });
  if (cur === '-') return 'none';
  if (cur === PS + '\n' + launcher().arg) return 'ok';
  await install();
  return 'repaired';
}

function statusPid() {
  try { const s = JSON.parse(fs.readFileSync(P.file('status.json'), 'utf8')); return Number.isInteger(s.pid) ? s.pid : null; } catch { return null; }
}

async function start() { await ps('Start-ScheduledTask -TaskName $env:SR_TASK', { SR_TASK: TASK }); }
// Stoppen: Aufgabe beenden und den Dienstprozess über seine PID (aus status.json) – nur, wenn es wirklich unsere App ist
async function stop() {
  const pid = statusPid();
  await ps(`
    Stop-ScheduledTask -TaskName $env:SR_TASK -ErrorAction SilentlyContinue
    if ($env:SR_PID) {
      $p = Get-Process -Id ([int]$env:SR_PID) -ErrorAction SilentlyContinue
      if ($p -and $p.Path -eq $env:SR_EXE) { Stop-Process -Id $p.Id -Force }
    }`, { SR_TASK: TASK, SR_PID: pid ? String(pid) : '', SR_EXE: process.execPath });
}
async function restart() { await stop(); await new Promise(r => setTimeout(r, 1500)); await start(); }

async function uninstall() {
  await stop();
  await ps(`
    Unregister-ScheduledTask -TaskName $env:SR_TASK -Confirm:$false -ErrorAction SilentlyContinue
    Get-NetFirewallRule -DisplayName $env:SR_RULE -ErrorAction SilentlyContinue | Remove-NetFirewallRule`, { SR_TASK: TASK, SR_RULE: RULE });
}

module.exports = { TASK, RULE, isAdmin, serviceState, secureDir, secureUpdateDir, install, repair, uninstall, start, stop, restart, setFirewall, removeFirewall, launcher };
