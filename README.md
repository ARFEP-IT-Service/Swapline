# Switchdesk

**Claude Code im Messenger-Stil – mit Kontowechsel per Klick.**

Switchdesk ist eine Windows-Desktop-App für [Claude Code](https://docs.claude.com/en/docs/claude-code). Statt im Terminal chattest du wie in einer Nachrichten-App: Sprechblasen, Markdown, einklappbare Werkzeug-Aufrufe, Rückfragen als Buttons. Mehrere Claude-Konten (Pro, Max, Team, Enterprise) liegen nebeneinander und lassen sich mit einem Klick wechseln, ohne erneute Anmeldung.

by **ARFEP IT-Service**, Göttingen – https://arfep.de

## Funktionen

- **Konten wechseln:** Leiste links wie bei Discord/Slack, `Strg+1…9`. Jedes Konto hat einen eigenen Konfigurationsordner (`~/.claude-profiles/<konto>`), die Anmeldung erfolgt einmalig.
- **Chat mit anderem Konto fortsetzen:** Limit erreicht? Im Chat oben das Konto wechseln – der Verlauf wird übernommen.
- **Mehrere Chats gleichzeitig**, auch mit verschiedenen Konten und Ordnern. Ungelesen- und „arbeitet“-Anzeige.
- **Projekt-Favoriten:** häufige Ordner mit einem Klick öffnen.
- **Verlauf:** alle bisherigen Claude-Code-Sitzungen des Kontos (auch aus dem Terminal), gruppiert nach Datum, durchsuchbar und fortsetzbar.
- **Nutzung:** 5-Stunden- und Wochenlimit des Abos mit Reset-Zeit, geschätzter API-Gegenwert pro Tag.
- **Berechtigungen** als Karte: Erlauben / Immer erlauben / Ablehnen. Modus pro Chat: Nachfragen, Änderungen erlauben, Nur planen, Alles erlauben.
- **Modell pro Chat** (Opus, Sonnet, Haiku, Fable), Stopp-Button (`Esc`), Windows-Benachrichtigung, wenn eine Antwort fertig ist.
- Hell/Dunkel nach System oder fest eingestellt.

## Voraussetzungen

- Windows 10/11
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installiert (`claude --version`)

## Nutzung

`Switchdesk.exe` starten. Das bestehende Claude-Code-Konto erscheint als „Standard“. Weitere Konten über **+** in der Leiste: Name eingeben → es öffnet sich ein Anmeldefenster → im Browser bestätigen.

> Tipp: Vor dem Anmelden im Browser mit dem passenden claude.ai-Konto eingeloggt sein oder ein privates Fenster verwenden.

## Entwicklung

```bash
npm install
npm start                 # App aus dem Quellcode starten
npm run dist              # dist/Switchdesk.exe (portabel, eine Datei)
npm run icon              # Icon neu erzeugen (Python + Pillow)
```

Testprofil, damit die echten Einstellungen unberührt bleiben:

```bash
SWITCHDESK_PROFILE=test npm start
```

### Aufbau

| Datei | Inhalt |
|---|---|
| `src/main.js` | Hauptprozess: Konten, Start von `claude -p --input-format stream-json …` pro Chat, Verlauf, Nutzung |
| `src/preload.js` | sichere Brücke zwischen Oberfläche und Hauptprozess |
| `src/renderer/` | Oberfläche (HTML/CSS/JS ohne Framework), Markdown über marked + DOMPurify |

Switchdesk startet für jeden Chat die installierte Claude-Code-CLI im Stream-JSON-Modus und beantwortet Berechtigungsabfragen über das Steuerprotokoll (`--permission-prompt-tool stdio`). Kontowechsel funktioniert über die Umgebungsvariable `CLAUDE_CONFIG_DIR`. Es werden keine Zugangsdaten kopiert oder an Dritte gesendet.

## Lizenz

[MIT](LICENSE) – Copyright (c) 2026 Halil Ayberk Bulut (ARFEP IT-Service) and Switchdesk contributors.

Das ARFEP-Logo in `src/renderer/assets/arfep/` steht **nicht** unter MIT (siehe [NOTICE](src/renderer/assets/arfep/NOTICE.md)).

Inoffizielles Projekt, nicht mit Anthropic verbunden. „Claude“ und „Claude Code“ sind Marken von Anthropic, PBC.
