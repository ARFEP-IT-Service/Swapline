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
function launcher() {
  const exe = process.execPath;
  const svc = process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'app.asar.unpacked', 'service.js'))
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'service.js')
    : path.join(__dirname, 'service.js');
  const q = s => "'" + s.replace(/'/g, "''") + "'";
  return { exe, svc, arg: `-NoProfile -NonInteractive -WindowStyle Hidden -Command "& { $env:ELECTRON_RUN_AS_NODE='1'; & ${q(exe)} ${q(svc)} }"` };
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

async function install() {
  const cfg = P.ensureConfig();
  const l = launcher();
  await ps(`
    $dir = $env:SR_DIR
    New-Item -ItemType Directory -Force $dir | Out-Null
    # Zugriff: Administratoren (S-1-5-32-544) und SYSTEM (S-1-5-18) voll, Lokaler Dienst (S-1-5-19) ändern, sonst niemand
    & icacls $dir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
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

module.exports = { TASK, RULE, isAdmin, serviceState, install, uninstall, start, stop, restart, setFirewall, removeFirewall, launcher };
