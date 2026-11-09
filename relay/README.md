# Swapline-Vermittler (Relay)

Macht einen Haupt-PC mit Swapline von unterwegs erreichbar – **ohne Portfreigabe am Router und ohne VPN**. Haupt-PC
und Gerät (z. B. die Android-App) verbinden sich beide **nach außen** zu einem eigenen Server, auf dem dieser
Vermittler läuft; der Vermittler reicht danach nur noch Bytes durch.

```
Handy ──TLS-PSK (Ende-zu-Ende)──▶ Vermittler (eigener Server) ◀── Steuer-/Datenverbindung ── Haupt-PC
```

## Sicherheit

- **Ende-zu-Ende verschlüsselt:** Innen läuft unverändert die TLS-PSK-Verbindung zwischen Gerät und Haupt-PC (eigener
  256-Bit-Schlüssel je Gerät). Der Vermittler kennt keine Geräteschlüssel und sieht keine Inhalte – auch wer den Server
  übernimmt, kommt nicht an Chats oder Claude.
- **Kein offener Vermittler:** Haupt-PCs melden sich mit dem Kennwort des Vermittlers an, Geräte mit einer Kennung, die
  nur gekoppelte Geräte vom Haupt-PC bekommen (dialKey). Beides als HMAC über eine Zufallszahl – Kennwörter gehen nie
  über die Leitung. Die Kennung eines Geräts prüft der Haupt-PC selbst, nicht der Vermittler.
- **Begrenzungen:** Sperre nach 10 Fehlversuchen je Adresse (10 Minuten), höchstens 60 neue Verbindungen je Adresse
  und Minute, 10 s bis zur Anmeldung, höchstens 50 Haupt-PCs und 20 Verbindungen je Haupt-PC. Fehlversuche über den
  Vermittler sperren am Haupt-PC nur das betreffende Gerät, nicht alle Verbindungen über den Server.
- **Kopplung wie immer:** Neue Geräte müssen am Haupt-PC bestätigt werden.
- Keine Abhängigkeiten außer Node.js; der Vermittler speichert nichts außer seinem Protokoll.

## Einrichten auf Windows Server (z. B. 2025)

1. Node.js 20 oder neuer installieren, z. B. `winget install OpenJS.NodeJS.LTS`.
2. Den Ordner `relay/` auf den Server kopieren.
3. PowerShell **als Administrator** öffnen, in den Ordner wechseln:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
   ```
   Das Skript legt `C:\ProgramData\SwaplineRelay` an (Zugriff nur Administratoren, SYSTEM und Dienstkonto), öffnet
   TCP-Port **47821** in der Windows-Firewall, startet den Vermittler als Aufgabe beim Systemstart mit dem
   eingeschränkten Konto *Lokaler Dienst* (Neustart nach Absturz) und zeigt **einmal** das Kennwort an.
   Anderer Port: `-Port 50000`.
4. Hat der Hoster eine eigene Firewall, dort ebenfalls TCP 47821 freigeben.
5. In Swapline am PC: Fernzugriff → **Über Vermittler erreichbar** → Adresse des Servers, Port und Kennwort eintragen.
   Gekoppelte Geräte bekommen die Daten automatisch; neue Geräte über den QR-Code.

Protokoll: `C:\ProgramData\SwaplineRelay\relay.log`. Entfernen: `uninstall-windows.ps1` (als Administrator).
Aktualisieren: neues `relay.js` daneben legen und `install-windows.ps1` erneut ausführen (Kennwort bleibt).

## Einrichten auf Linux (systemd)

```ini
# /etc/systemd/system/swapline-relay.service
[Service]
ExecStart=/usr/bin/node /opt/swapline-relay/relay.js /opt/swapline-relay/relay.json
DynamicUser=yes
Restart=always
[Install]
WantedBy=multi-user.target
```
`relay.json`: `{ "port": 47821, "secret": "<mindestens 32 zufällige Zeichen>" }`

## Protokoll (für Entwickler)

Eine JSON-Zeile je Nachricht, danach durchgereichte Bytes:

| Wer | Nachricht |
|---|---|
| Vermittler → jede Verbindung | `{"t":"hello","v":1,"nonce":"…"}` |
| Haupt-PC (Steuerung) | `{"t":"host","hostId":"<16 hex>","mac":HMAC(secret,"host|nonce|hostId")}` → `{"t":"registered"}` |
| Gerät | `{"t":"dial","hostId":"…","mac":HMAC(dialKey,"dial|nonce|hostId")}` |
| Vermittler → Haupt-PC | `{"t":"incoming","id","nonce","mac","from"}` |
| Haupt-PC (Daten) | `{"t":"accept","id","mac":HMAC(secret,"accept|nonce|id")}` oder auf der Steuerung `{"t":"reject","id"}` |
| Vermittler → Gerät | `{"t":"ok"}` – ab hier TLS-PSK zwischen Gerät und Haupt-PC |

Tests: `npm test -- relay` (Vermittler, Haupt-PC und Gerät echt auf 127.0.0.1).
