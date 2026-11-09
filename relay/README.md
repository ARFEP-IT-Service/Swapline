# Swapline Relay (Vermittler)

Macht einen Haupt-PC mit Swapline von unterwegs erreichbar – **ohne Portfreigabe am Router und ohne VPN**. Haupt-PC
und Gerät (z. B. die Android-App) verbinden sich beide **nach außen** zu einem eigenen Server, auf dem *Swapline Relay*
läuft; der Vermittler reicht danach nur noch Bytes durch.

```
Handy ──TLS-PSK (Ende-zu-Ende)──▶ Swapline Relay (eigener Server) ◀── Steuer-/Datenverbindung ── Haupt-PC
```

## Einrichten (Windows Server, z. B. 2025)

1. `Swapline-Relay-Setup-<Version>.exe` aus den [Releases](https://github.com/ARFEP-IT-Service/Swapline/releases) (Tags
   `relay-v…`) auf dem Server installieren (für alle Benutzer). Node.js ist nicht nötig.
2. **Swapline Relay** öffnen – Windows fragt nach Administratorrechten (für Dienst und Firewall).
3. **Als Dienst einrichten** klicken: Der Vermittler startet ab jetzt mit Windows, auch ohne Anmeldung, mit dem
   eingeschränkten Konto *Lokaler Dienst*; die Windows-Firewall wird für TCP **47821** geöffnet.
4. Hat der Hoster eine eigene Firewall, dort ebenfalls TCP 47821 freigeben.
5. **Einrichtungscode kopieren** (Adresse des Servers vorher prüfen) und in Swapline am PC unter Fernzugriff →
   **Über Vermittler erreichbar** einfügen. Steht dort „verbunden“, ist es geschafft – gekoppelte Geräte bekommen die
   Daten automatisch, neue Geräte über den QR-Code.

Das Fenster zeigt außerdem, welche Swapline-PCs angemeldet sind, wie viele Verbindungen laufen, das Protokoll, Port
und Firewall. **Neues Kennwort** trennt alle PCs, bis dort der neue Einrichtungscode eingefügt ist. **Updates** sucht die App
beim Öffnen und alle 6 Stunden; ein Klick auf „Jetzt aktualisieren“ lädt das Setup von GitHub, vergleicht es mit
`SHA256SUMS.txt` aus demselben Release und installiert es still. Der Dienst ist dabei nur wenige Sekunden weg, Kennwort,
Port und Protokoll bleiben, die App öffnet sich danach wieder. Beim Deinstallieren werden
Dienst und Firewall-Regel entfernt, Kennwort und Protokoll bleiben in `C:\ProgramData\SwaplineRelay`.

## Sicherheit

- **Ende-zu-Ende verschlüsselt:** Innen läuft unverändert die TLS-PSK-Verbindung zwischen Gerät und Haupt-PC (eigener
  256-Bit-Schlüssel je Gerät). Der Vermittler kennt keine Geräteschlüssel und sieht keine Inhalte – auch wer den Server
  übernimmt, kommt nicht an Chats oder Claude.
- **Kein offener Vermittler:** Haupt-PCs melden sich mit dem Kennwort an, Geräte mit einer Kennung, die nur gekoppelte
  Geräte vom Haupt-PC bekommen (dialKey). Beides als HMAC über eine Zufallszahl – nichts davon geht über die Leitung.
  Die Kennung eines Geräts prüft der Haupt-PC selbst.
- **Begrenzungen:** Sperre nach 10 Fehlversuchen je Adresse (10 Minuten), höchstens 60 neue Verbindungen je Adresse und
  Minute, 10 s bis zur Anmeldung, höchstens 50 Haupt-PCs und 20 Verbindungen je Haupt-PC. Fehlversuche über den
  Vermittler sperren am Haupt-PC nur das betreffende Gerät.
- **Wenig Rechte:** Der Dienst läuft als *Lokaler Dienst*; der Datenordner ist nur für Administratoren, SYSTEM und das
  Dienstkonto lesbar (über SIDs, funktioniert auch auf deutschsprachigem Windows). Das Kennwort steht nur in
  `relay.json`, nie in Status oder Protokoll; das Fenster zeigt es nur auf Klick.

## Ohne App (z. B. Linux, systemd)

```ini
# /etc/systemd/system/swapline-relay.service
[Service]
ExecStart=/usr/bin/node /opt/swapline-relay/relay.js /opt/swapline-relay/relay.json
DynamicUser=yes
Restart=always
[Install]
WantedBy=multi-user.target
```
Dazu `relay.js` und den Ordner `app/` kopieren. `relay.json`: `{ "port": 47821, "secret": "<mindestens 32 zufällige Zeichen>" }`.
In Swapline dann Adresse, Port und Kennwort einzeln eintragen.

## Entwicklung

```
npm run relay:start      # Fenster aus dem Quellcode (ohne Adminrechte: nur Anzeige)
npm run relay:dist       # Installer und ZIP nach dist-relay/
npm test -- relay        # Vermittler, Relay-App (Dienst) und Fernzugriff, echt auf 127.0.0.1
```
`SWAPLINE_RELAY_DIR` lenkt den Datenordner um (Tests). Version in `app/package.json`, Tags `relay-v<Version>`,
Änderungen in [CHANGELOG.md](CHANGELOG.md).

### Protokoll

Eine JSON-Zeile je Nachricht, danach durchgereichte Bytes:

| Wer | Nachricht |
|---|---|
| Vermittler → jede Verbindung | `{"t":"hello","v":1,"nonce":"…"}` |
| Haupt-PC (Steuerung) | `{"t":"host","hostId":"<16 hex>","mac":HMAC(secret,"host|nonce|hostId")}` → `{"t":"registered"}` |
| Gerät | `{"t":"dial","hostId":"…","mac":HMAC(dialKey,"dial|nonce|hostId")}` |
| Vermittler → Haupt-PC | `{"t":"incoming","id","nonce","mac","from"}` |
| Haupt-PC (Daten) | `{"t":"accept","id","mac":HMAC(secret,"accept|nonce|id")}` oder auf der Steuerung `{"t":"reject","id"}` |
| Vermittler → Gerät | `{"t":"ok"}` – ab hier TLS-PSK zwischen Gerät und Haupt-PC |
