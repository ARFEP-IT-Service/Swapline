<#
  Swapline-Vermittler vom Windows Server entfernen (als Administrator):
      powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1
  Entfernt Aufgabe, Firewall-Regel und den Ordner C:\ProgramData\SwaplineRelay (inkl. Kennwort und Protokoll).
#>
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Bitte PowerShell als Administrator starten.' }
Stop-ScheduledTask -TaskName 'SwaplineRelay' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'SwaplineRelay' -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName 'Swapline-Vermittler' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$dir = Join-Path $env:ProgramData 'SwaplineRelay'
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
Write-Host 'Swapline-Vermittler entfernt.'
