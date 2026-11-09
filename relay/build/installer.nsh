; Installer-Ergänzungen für „Swapline Relay“:
; - vor dem Kopieren: laufenden Dienst anhalten (eine laufende EXE lässt sich nicht ersetzen)
; - nach dem Kopieren: Startbefehl der Aufgabe angleichen und Dienst wieder starten, falls er eingerichtet ist
; - beim Deinstallieren (nicht bei einem Update): Aufgabe und Firewall-Regel entfernen; Kennwort/Protokoll bleiben
!define SR_PS '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command'

!macro customInit
  nsExec::Exec '${SR_PS} "Stop-ScheduledTask -TaskName SwaplineRelay -ErrorAction SilentlyContinue; Start-Sleep -Seconds 4"'
  Pop $0
!macroend

!macro customInstall
  ; Startbefehl der Aufgabe an die neue Version angleichen (0.1.0 startete den Dienst in einer Schleife neu)
  nsExec::Exec '"$INSTDIR\${PRODUCT_FILENAME}.exe" --repair-service'
  Pop $0
  nsExec::Exec '${SR_PS} "if (Get-ScheduledTask -TaskName SwaplineRelay -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName SwaplineRelay }"'
  Pop $0
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec '${SR_PS} "Stop-ScheduledTask -TaskName SwaplineRelay -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName SwaplineRelay -Confirm:$$false -ErrorAction SilentlyContinue; Get-NetFirewallRule -DisplayName Swapline-Vermittler -ErrorAction SilentlyContinue | Remove-NetFirewallRule"'
    Pop $0
  ${endIf}
!macroend
