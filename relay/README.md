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
5. Unter **Haupt-PCs** einen Namen eingeben (z. B. „Büro-PC“) und **Einrichtungscode erzeugen** – der Code (Adresse des
   Servers vorher prüfen) liegt in der Zwischenablage. Er gilt nur für **einen** PC.
6. Den Code in Swapline am PC unter Fernzugriff → **Über Vermittler erreichbar** einfügen. Der PC meldet sich und steht in
   der Relay-App als „wartet auf Freigabe“ (mit Kennung und Adresse) – dort **Erlauben** klicken. Steht in Swapline
   „verbunden“, ist es geschafft: gekoppelte Geräte bekommen die Daten automatisch, neue Geräte über den QR-Code.

Der Vermittler ist **nur für eigene Haupt-PCs**: jeder PC hat einen eigenen Schlüssel, und ein neuer PC kommt erst nach
„Erlauben“ durch. **Entfernen** trennt einen PC sofort, sein Code ist danach ungültig. Andere Nutzer betreiben ihren eigenen
Vermittler. Das Fenster zeigt außerdem die angemeldeten PCs, wie viele Verbindungen laufen, Grenzen (Verbindungen je PC und
insgesamt), das Protokoll, Port und Firewall. **Updates** sucht die App beim Öffnen und alle 6 Stunden; ein Klick auf
„Jetzt aktualisieren“ lädt das Setup von GitHub in einen Ordner, den nur Administratoren beschreiben dürfen, vergleicht es
mit `SHA256SUMS.txt` aus demselben Release (direkt vor dem Start noch einmal) und installiert es still. Der Dienst ist dabei
nur wenige Sekunden weg, Einträge, Port und Protokoll bleiben, die App öffnet sich danach wieder. Beim Deinstallieren
werden Dienst und Firewall-Regel entfernt, Einträge und Protokoll bleiben in `C:\ProgramData\SwaplineRelay`.

**Von 0.2 auf 0.3:** Das gemeinsame Kennwort gibt es nicht mehr; alte Einrichtungscodes (`srelay1.…`) werden abgelehnt.
Nach dem Update für jeden eigenen PC einen Code erzeugen, in Swapline (ab 0.19.0) bzw. `swapline-server relay <Code>`
(ab 0.3.0) einfügen und in der Relay-App „Erlauben“ klicken.

## Sicherheit

- **Ende-zu-Ende verschlüsselt:** Innen läuft unverändert die TLS-PSK-Verbindung zwischen Gerät und Haupt-PC (eigener
  256-Bit-Schlüssel je Gerät). Der Vermittler kennt keine Geräteschlüssel und sieht keine Inhalte – auch wer den Server
  übernimmt, kommt nicht an Chats oder Claude.
- **Kein offener Vermittler:** Jeder Haupt-PC meldet sich mit seinem eigenen Schlüssel an; der Eintrag bindet sich beim
  ersten Kontakt an die Kennung dieses PCs (ein kopierter Code nützt auf einem anderen PC nichts) und gilt erst nach
  „Erlauben“. Geräte melden sich mit ihrem eigenen Schlüssel an (dialKey, je Gerät einer, kommt vom Haupt-PC beim
  Koppeln); ein am Haupt-PC entferntes Gerät wird schon beim Vermittler abgewiesen. Alles als HMAC über eine Zufallszahl –
  kein Schlüssel geht über die Leitung. Die Kennung eines Geräts prüft der Haupt-PC selbst.
- **Begrenzungen:** Sperre nach 10 Fehlversuchen je Adresse (10 Minuten), höchstens 60 neue Verbindungen je Adresse und
  Minute, 10 s bis zur Anmeldung, höchstens 300 gleichzeitige Verbindungen, Verbindungen je PC (Standard 10) und
  insgesamt (Standard 50) in der App einstellbar. Fehlversuche über den Vermittler sperren am Haupt-PC nur das
  betreffende Gerät.
- **Wenig Rechte:** Der Dienst läuft als *Lokaler Dienst*; der Datenordner ist nur für Administratoren, SYSTEM und das
  Dienstkonto lesbar (über SIDs, funktioniert auch auf deutschsprachigem Windows); die Rechte werden gesetzt, bevor eine
  Datei mit Schlüsseln entsteht. Die Schlüssel stehen nur in `hosts.json`, nie in Status oder Protokoll; das Fenster zeigt
  sie nicht an (nur „Code kopieren“).
- **Lizenzen:** `LICENSE`, `THIRD_PARTY_NOTICES.md` und die Lizenztexte (Electron, Chromium, FFmpeg, NSIS) liegen neben der
  exe.

## Ohne App (z. B. Linux, systemd)

```ini
# /etc/systemd/system/swapline-relay.service
[Service]
Environment=SWAPLINE_RELAY_DIR=/var/lib/swapline-relay
ExecStart=/usr/bin/node /opt/swapline-relay/relay.js run
StateDirectory=swapline-relay
DynamicUser=yes
Restart=always
[Install]
WantedBy=multi-user.target
```
Dazu `relay.js` und den Ordner `app/` kopieren. Haupt-PCs verwalten (mit demselben `SWAPLINE_RELAY_DIR`; der Dienst
übernimmt Änderungen nach höchstens 2 s):

```
node relay.js add Büro-PC relay.example.com   # Eintrag anlegen, gibt den Einrichtungscode aus
node relay.js list                            # Einträge, wartende PCs (Kennung, Adresse)
node relay.js approve <Eintrag>               # „Erlauben“
node relay.js remove <Eintrag>                # entfernen – der PC wird getrennt
```

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
| Vermittler → jede Verbindung | `{"t":"hello","v":2,"nonce":"…"}` |
| Haupt-PC (Steuerung) | `{"t":"host","key":"<Eintrag, 8 hex>","hostId":"<16 hex>","mac":HMAC(Schlüssel,"host|nonce|hostId")}` → `{"t":"registered"}`, `{"t":"error","error":"pending"}` (wartet auf „Erlauben“) oder `"veraltet"` (Code ohne Eintrag) |
| Gerät | `{"t":"dial","hostId":"…","who":"<Geräte-ID>\|pair","mac":HMAC(dialKey,"dial|nonce|hostId|who")}` |
| Vermittler → Haupt-PC | `{"t":"incoming","id","nonce","mac","who","from"}` |
| Haupt-PC (Daten) | `{"t":"accept","id","mac":HMAC(Schlüssel,"accept|nonce|id")}` oder auf der Steuerung `{"t":"reject","id"}` |
| Vermittler → Gerät | `{"t":"ok"}` – ab hier TLS-PSK zwischen Gerät und Haupt-PC; sonst `{"t":"error","error":"offline"\|"voll"\|"abgelehnt"}` |

Einrichtungscode: `srelay2.` + base64url von `{"a":Adresse,"p":Port,"i":Eintrag,"k":Schlüssel}`. Beim Koppeln über den
Vermittler gilt als dialKey `SHA-256("swapline-pair-dial-v1" ‖ Einmal-Code)` mit `who = "pair"` – der Kopplungslink
enthält keinen Schlüssel.
