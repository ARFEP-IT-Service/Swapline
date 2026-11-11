# Changelog – Swapline Server

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/), unabhängig von Swapline am PC, der Android-App und
Swapline Relay. Tags: `server-v<Version>`.

## [0.3.0] – 2026-11-11

- Sicherheit: Beim Koppeln fragt das Terminal **„Alles erlauben“** und **„!“-Befehle** einzeln ab (Standard: Nein).
  „!“ ist ein eigenes Recht: `swapline-server devices bang <Name> on|off`. Bereits gekoppelte Geräte behalten ihre Rechte.
- Sicherheit: Vermittler mit **eigenem Eintrag** (`srelay2` aus Swapline Relay 0.3.0, dort „Erlauben“); alte Codes
  (`srelay1`) werden abgelehnt, `status` weist darauf hin. Jedes Gerät hat einen **eigenen Vermittler-Schlüssel** –
  entfernte Geräte kommen nicht mehr durch. Der Kopplungslink enthält keinen Schlüssel mehr.
- Sicherheit: Uploads höchstens 500 MB je Gerät und Tag und 2 GB insgesamt, nach 7 Tagen gelöscht; Entfernen eines Geräts
  beendet auch seine laufenden „!“-Befehle.

## [0.2.1] – 2026-11-10

- Behoben: Bilder aus dem Internet ließen sich nicht laden („nicht erreichbar“) – gleicher Fehler wie in Swapline 0.17.0.

## [0.2.0] – 2026-11-10

- Neu: Bilder in Antworten von Claude für das Handy – Bild-Dateien aus den freigegebenen Ordnern und dem Home-Verzeichnis
  (nur echte Bilder, ≤ 10 MB), Bilder aus dem Internet nur auf Tippen (https, öffentliche Adressen).

## [0.1.0] – 2026-11-10

Erste Version.

- Swapline als Haupt-PC ohne Fenster für einen eigenen Linux-Server: Handy (oder anderer PC) koppelt sich per QR-Code
  bzw. Kopplungslink, direkt oder über den Vermittler. Chats mit Rückfragen, Verlauf in Seiten, „!“-Befehle, Dokumente
  hochladen, Hintergrund-Ausgaben – mit denselben Prüfungen wie Swapline am PC (gemeinsamer Kern `src/chat-core.js`).
- Befehlszeile `swapline-server` (status, pair, devices, folders, relay), Installation als systemd-Benutzerdienst.
- Braucht Node.js 20+ und Claude Code mit `claude auth login` auf dem Server.
