<#
  Swapline-Vermittler auf einem Windows Server einrichten (z. B. Windows Server 2025).
  Als Administrator in PowerShell ausführen, im Ordner mit relay.js:

      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1            # Port 47821
      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Port 50000

  Was passiert:
    - kopiert relay.js nach C:\ProgramData\SwaplineRelay
    - legt dort relay.json mit einem zufälligen Kennwort an (nur beim ersten Mal; Zugriff nur für Administratoren,
      SYSTEM und das Dienstkonto)
    - öffnet den TCP-Port in der Windows-Firewall (nur diesen Port)
    - richtet eine Aufgabe ein, die den Vermittler beim Start als „Lokaler Dienst“ (eingeschränktes Konto) startet
      und nach einem Absturz neu startet
    - zeigt das Kennwort EINMAL an – in Swapline am PC unter Fernzugriff → „Über Vermittler erreichbar“ eintragen
  Voraussetzung: Node.js 20 oder neuer (z. B. winget install OpenJS.NodeJS.LTS).
  Entfernen: uninstall-windows.ps1
#>
param([int]$Port = 47821)
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Bitte PowerShell als Administrator starten.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port muss zwischen 1024 und 65535 liegen.' }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js nicht gefunden. Installieren z. B. mit:  winget install OpenJS.NodeJS.LTS  – danach PowerShell neu öffnen.' }
$major = [int]((& $node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node.js $major ist zu alt – bitte Version 20 oder neuer installieren." }

$src = Join-Path $PSScriptRoot 'relay.js'
if (-not (Test-Path $src)) { throw "relay.js nicht gefunden neben diesem Skript ($PSScriptRoot)." }
$dir = Join-Path $env:ProgramData 'SwaplineRelay'
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item $src (Join-Path $dir 'relay.js') -Force

# Zugriff: Administratoren und SYSTEM voll, Dienstkonto lesen + Protokoll schreiben, sonst niemand
& icacls $dir /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' 'NT AUTHORITY\LOCAL SERVICE:(OI)(CI)M' | Out-Null

$cfgFile = Join-Path $dir 'relay.json'
$newSecret = $null
if (-not (Test-Path $cfgFile)) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
  $newSecret = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  @{ port = $Port; secret = $newSecret; logFile = 'relay.log' } | ConvertTo-Json | Set-Content -Encoding UTF8 $cfgFile
} else {
  $cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json
  $cfg.port = $Port
  $cfg | ConvertTo-Json | Set-Content -Encoding UTF8 $cfgFile
  Write-Host 'relay.json existiert bereits – Kennwort bleibt unverändert.'
}

$rule = 'Swapline-Vermittler'
Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null

$task = 'SwaplineRelay'
Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$dir\relay.js`" `"$cfgFile`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCALSERVICE' -LogonType ServiceAccount
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Swapline-Vermittler (relay.js)' | Out-Null
Start-ScheduledTask -TaskName $task
Start-Sleep -Seconds 2

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
Write-Host ''
Write-Host "Swapline-Vermittler eingerichtet: $dir  (Port $Port, Firewall-Regel '$rule', Aufgabe '$task')"
if ($listening) { Write-Host 'Status: läuft' -ForegroundColor Green } else { Write-Host "Status: hört (noch) nicht auf Port $Port – siehe $dir\relay.log" -ForegroundColor Yellow }
if ($newSecret) {
  Write-Host ''
  Write-Host 'Kennwort (nur jetzt sichtbar – in Swapline am PC unter Fernzugriff → „Über Vermittler erreichbar“ eintragen):' -ForegroundColor Cyan
  Write-Host "  $newSecret"
}
Write-Host ''
Write-Host 'Hinweis: Steht der Server hinter einer weiteren Firewall (z. B. beim Hoster), dort ebenfalls TCP-Port' $Port 'freigeben.'
