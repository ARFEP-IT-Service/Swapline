# Switchdesk

**Claude Code im Messenger-Stil – mit Kontowechsel per Klick.**

Switchdesk ist eine Windows-Desktop-App für [Claude Code](https://code.claude.com/docs). Statt im Terminal chattest du wie in einer Nachrichten-App: Sprechblasen, Markdown, einklappbare Werkzeug-Aufrufe, Rückfragen als Buttons. Mehrere Claude-Konten (Pro, Max, Team, Enterprise) liegen nebeneinander und lassen sich mit einem Klick wechseln, ohne erneute Anmeldung.

by **ARFEP IT-Service**, Göttingen – https://arfep.de

## Funktionen

- **Projekte:** Leiste links mit „Allgemein“ (🌐) und eigenen Projekten; Chats per Ziehen oder Rechtsklick zuordnen, optional mit Projektordner.
- **Konten wechseln:** über das Profil links unten oder `Strg+1…9`. Jedes Konto hat einen eigenen Konfigurationsordner (`~/.claude-profiles/<konto>`), angemeldet wird einmalig.
- **Chat mit anderem Konto fortsetzen:** Konto im Chat wechseln, der Verlauf wird nach Rückfrage übernommen (siehe [Daten und Anmeldung](#daten-und-anmeldung)).
- **Mehrere Chats gleichzeitig**, auch mit verschiedenen Konten und Ordnern; Ungelesen- und „arbeitet“-Anzeige.
- **Verlauf:** alle bisherigen Claude-Code-Sitzungen des Kontos (auch aus dem Terminal), nach Datum gruppiert, durchsuchbar und fortsetzbar.
- **Nutzung:** 5-Stunden- und Wochenlimit des Abos mit Reset-Zeit, geschätzter API-Gegenwert pro Tag – beides aus der Ausgabe von Claude Code.
- **Chat-Einstellungen** in einem Menü oben rechts: Konto, Modell, Aufwand, Berechtigungen (Nachfragen, Änderungen erlauben, Nur planen, Alles erlauben).
- Rückfragen von Claude als Karten (Erlauben / Immer erlauben / Ablehnen), Stopp-Button (`Esc`), Windows-Benachrichtigung, Hell/Dunkel.

## Voraussetzungen

- Windows 10/11 (x64)
- [Claude Code](https://code.claude.com/docs) installiert (`claude --version`). Fehlt es, zeigt Switchdesk „Claude Code nicht gefunden“.

## Installation

1. `Switchdesk-0.1.0-windows.zip` herunterladen und in einen beliebigen Ordner entpacken.
2. `Switchdesk.exe` starten.

> **Hinweis:** Die exe ist nicht digital signiert. Windows SmartScreen zeigt deshalb beim ersten Start „Der Computer wurde durch Windows geschützt“. Über **Weitere Informationen → Trotzdem ausführen** startet die App.

Das bestehende Claude-Code-Konto erscheint als „Standard“. Weitere Konten: Profil links unten → **Konto hinzufügen** → Name eingeben → Claude Code öffnet deinen Standard-Browser mit der Anmeldeseite von Anthropic → dort anmelden. Ist im Browser schon ein anderes Claude-Konto angemeldet, ein privates Fenster verwenden. Verlangt Claude Code einen Code, öffnet Switchdesk auf Wunsch ein Konsolenfenster mit `claude auth login`, in das du den Code selbst eingibst.

## Daten und Anmeldung

- **Anmeldung:** ausschließlich über `claude auth login`, also Anthropics eigenen Ablauf im System-Browser. Switchdesk zeigt keine Anmeldeseite an, liest dabei keine Ausgabe und sieht weder Passwort noch Code noch Token.
- **Zugangsdaten:** Switchdesk liest, speichert oder überträgt keine Zugangsdaten oder Tokens. Claude Code legt sie selbst in seinem Konfigurationsordner ab; Switchdesk legt pro Konto nur fest, welcher Ordner das ist (Umgebungsvariable `CLAUDE_CONFIG_DIR`).
- **Anfragen an Claude:** laufen immer über das unveränderte, installierte Claude-Code-Programm (`claude -p --input-format stream-json …`). Der Programmcode von Switchdesk baut selbst keine Netzverbindungen auf (keine Telemetrie, keine Updates, keine Remote-Bilder); https-Links öffnet es im Standard-Browser.
- **Verlauf:** Switchdesk liest die Sitzungsdateien von Claude Code (`<Konfigurationsordner>/projects/…/*.jsonl`), um alte Chats anzuzeigen und fortzusetzen.
- **Chat in ein anderes Konto übertragen:** kopiert die Sitzungsdatei (gesamter Verlauf inkl. Dateiinhalten und Befehlsausgaben) in den Ordner des anderen Kontos – keine Zugangsdaten. Vorher fragt Switchdesk nach. Nicht zwischen Firmen- und Privatkonten übertragen.
- **Lokal gespeichert** (`%APPDATA%\Switchdesk`): Konten-, Projekt- und App-Einstellungen, Chat-Liste mit Titeln, Nutzungswerte, Fehlerprotokoll `switchdesk.log`.

## Entwicklung

```bash
npm install
npm start                 # App aus dem Quellcode starten
npm run dist              # licenses/ erzeugen, bauen, prüfen → dist/win-unpacked + dist/Switchdesk-0.1.0-windows.zip
npm run icon              # Icon neu erzeugen (Python + Pillow)
```

`npm run dist` sammelt die Lizenztexte (`tools/collect-licenses.js`), baut mit electron-builder die Ordner-Variante als ZIP und prüft danach, dass jedes gebündelte Paket einen Lizenztext hat (`tools/check-bundle.js`).

Testprofil, damit die echten Einstellungen unberührt bleiben (wirkt nur beim Start aus dem Quellcode, nicht in der gebauten App):

```bash
SWITCHDESK_PROFILE=test npm start
```

| Datei | Inhalt |
|---|---|
| `src/main.js` | Hauptprozess: Konten, Start von Claude Code pro Chat, Verlauf, Nutzung, Prüfung aller Eingaben der Oberfläche |
| `src/preload.js` | Brücke zwischen Oberfläche und Hauptprozess |
| `src/renderer/` | Oberfläche (HTML/CSS/JS ohne Framework), Markdown über marked + DOMPurify |
| `tools/` | Lizenzsammlung, Bundle-Prüfung, Icon |

## Lizenz

[MIT](LICENSE) – Copyright (c) 2026 Halil Ayberk Bulut (ARFEP IT-Service) and Switchdesk contributors.

Drittkomponenten (Electron, Chromium, FFmpeg, marked, DOMPurify) siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); die Volltexte liegen im Release im Ordner `licenses/`. Das ARFEP-Logo in `src/renderer/assets/arfep/` steht **nicht** unter MIT (siehe [NOTICE](src/renderer/assets/arfep/NOTICE.md)).

Inoffizielles Projekt, nicht mit Anthropic verbunden. „Claude“ und „Claude Code“ sind Marken von Anthropic, PBC.

Impressum / Legal notice: arfep.de/impressum
