# Swapline Server

Swapline als **Haupt-PC ohne Fenster** für einen eigenen Linux-Server, z. B. einen VPS. Claude Code läuft auf dem Server,
die [Swapline-App](../android/README.md) auf dem Handy (oder Swapline auf einem anderen PC) ist die Fernbedienung –
ganz ohne PC zu Hause. Gleiches Protokoll wie zwischen Handy und Swapline am PC: Ende-zu-Ende verschlüsselt (TLS-PSK),
direkt oder über den [Vermittler](../relay/README.md).

## Voraussetzungen

- Linux mit systemd (z. B. Ubuntu, Debian), Node.js 20 oder neuer
- [Claude Code](https://claude.com/claude-code) installiert und **einmal `claude auth login`** als derselbe Benutzer
  (Swapline Server speichert und vermittelt keine Claude-Zugangsdaten – jeder nutzt sein eigenes Konto)

## Installation

```sh
tar xzf swapline-server-<Version>.tar.gz
cd swapline-server-<Version>
./install.sh                         # als normaler Benutzer, nicht als root
swapline-server folders add ~/projekt
swapline-server pair                 # QR-Code mit der Swapline-App scannen, Kopplung hier bestätigen
```

Update: neues Paket entpacken und `./install.sh` erneut ausführen – Geräte und Einstellungen bleiben.

**Erreichbarkeit:** entweder Port 47820/TCP in der Firewall des Servers öffnen, oder ohne offenen Port über den
Vermittler: in *Swapline Relay* „Einrichtungscode kopieren“ und `swapline-server relay <Code>`.

## Befehle

| Befehl | |
|---|---|
| `swapline-server status` | Zustand, Adressen, Geräte, Ordner, Vermittler |
| `swapline-server pair` | Gerät koppeln (QR-Code und Kopplungslink, Bestätigung im Terminal) |
| `swapline-server devices` / `devices remove <Name>` | gekoppelte Geräte anzeigen bzw. entfernen |
| `swapline-server devices bypass <Name> on\|off` | „Alles erlauben“ und „!“-Befehle für das Gerät (Standard: an) |
| `swapline-server folders add\|remove <Ordner>` | Ordner für neue Chats (samt Unterordnern) |
| `swapline-server relay <Code>` / `relay off` | Vermittler einrichten bzw. abschalten |
| `journalctl --user -u swapline-server` | Protokoll |

## Sicherheit

- Koppeln geht nur, solange `swapline-server pair` im Terminal läuft, und jede Kopplung wird dort bestätigt.
  **Nur eigene Geräte koppeln** – das Teilen eines Claude-Kontos erlauben Anthropics Bedingungen nicht.
- Neue Chats nur in freigegebenen Ordnern (und im Home-Verzeichnis); Antworten auf Rückfragen werden wie in Swapline am
  PC geprüft (Eingabe unverändert, Regeln nur wie vorgeschlagen). „!“-Befehle und „Alles erlauben“ nur mit Freigabe.
- Einstellungen und Geräteschlüssel in `~/.config/swapline-server` (Ordner 0700, Dateien 0600) – geschützt über die
  Rechte des Benutzerkontos. Steuerung über einen Unix-Socket, den nur dieser Benutzer öffnen kann.
- Der Dienst läuft als dieser Benutzer, nie als root.
