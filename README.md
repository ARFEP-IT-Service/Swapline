<img src="src/renderer/assets/swapline.svg" alt="Swapline" width="96" height="96">

# Swapline

**Claude Code im Messenger-Stil – mit Kontowechsel per Klick.**

Swapline ist eine Windows-Desktop-App für [Claude Code](https://code.claude.com/docs). Statt im Terminal chattest du wie in einer Nachrichten-App: Sprechblasen, Markdown, einklappbare Werkzeug-Aufrufe, Rückfragen als Buttons. Mehrere Claude-Konten (Pro, Max, Team, Enterprise) liegen nebeneinander und lassen sich mit einem Klick wechseln, ohne erneute Anmeldung.

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
- [Claude Code](https://code.claude.com/docs) installiert (`claude --version`). Fehlt es, zeigt Swapline „Claude Code nicht gefunden“.

## Installation

**Mit Installer (empfohlen):** `SWAP-Installer.exe` starten. Swapline wird ohne Admin-Rechte für den aktuellen Benutzer nach `%LOCALAPPDATA%\Programs\swapline` installiert, mit Verknüpfung im Startmenü und auf dem Desktop, und startet danach. Ein Update ist einfach der neuere Installer – er ersetzt die vorhandene Version im selben Ordner; deinstalliert wird über **Einstellungen → Apps → Installierte Apps → Swapline**. Einstellungen und Konten bleiben dabei erhalten.

**Ohne Installer:** `Swapline-<Version>-windows.zip` in einen festen Ordner entpacken und `Swapline.exe` starten.

> **Hinweis:** Installer und exe sind nicht digital signiert. Windows SmartScreen zeigt deshalb beim ersten Start „Der Computer wurde durch Windows geschützt“. Über **Weitere Informationen → Trotzdem ausführen** startet die App.

Das bestehende Claude-Code-Konto erscheint als „Standard“. Weitere Konten: Profil links unten → **Konto hinzufügen** → Name eingeben → Claude Code öffnet deinen Standard-Browser mit der Anmeldeseite von Anthropic → dort anmelden. Ist im Browser schon ein anderes Claude-Konto angemeldet, ein privates Fenster verwenden. Verlangt Claude Code einen Code, öffnet Swapline auf Wunsch ein Konsolenfenster mit `claude auth login`, in das du den Code selbst eingibst.

## Daten und Anmeldung

- **Anmeldung:** ausschließlich über `claude auth login`, also Anthropics eigenen Ablauf im System-Browser. Swapline zeigt keine Anmeldeseite an, liest dabei keine Ausgabe und sieht weder Passwort noch Code noch Token.
- **Zugangsdaten:** Swapline liest, speichert oder überträgt keine Zugangsdaten oder Tokens. Claude Code legt sie selbst in seinem Konfigurationsordner ab; Swapline legt pro Konto nur fest, welcher Ordner das ist (Umgebungsvariable `CLAUDE_CONFIG_DIR`).
- **Anfragen an Claude:** laufen immer über das unveränderte, installierte Claude-Code-Programm (`claude -p --input-format stream-json …`). Der Programmcode von Swapline baut selbst keine Netzverbindungen auf (keine Telemetrie, keine Updates, keine Remote-Bilder); https-Links öffnet es im Standard-Browser.
- **Verlauf:** Swapline liest die Sitzungsdateien von Claude Code (`<Konfigurationsordner>/projects/…/*.jsonl`), um alte Chats anzuzeigen und fortzusetzen.
- **Chat in ein anderes Konto übertragen:** kopiert die Sitzungsdatei (gesamter Verlauf inkl. Dateiinhalten und Befehlsausgaben) in den Ordner des anderen Kontos – keine Zugangsdaten. Vorher fragt Swapline nach. Nicht zwischen Firmen- und Privatkonten übertragen.
- **Lokal gespeichert** (`%APPDATA%\Swapline`): Konten-, Projekt- und App-Einstellungen, Chat-Liste mit Titeln, Nutzungswerte, Fehlerprotokoll `swapline.log`.

## Entwicklung

```bash
npm install
npm start                 # App aus dem Quellcode starten
npm run dist              # licenses/ erzeugen, bauen, prüfen → dist/SWAP-Installer.exe + dist/Swapline-<Version>-windows.zip
```

`npm run dist` sammelt die Lizenztexte (`tools/collect-licenses.js`), baut mit electron-builder den Installer (NSIS, pro Benutzer) und die Ordner-Variante als ZIP und prüft danach, dass jedes gebündelte Paket einen Lizenztext hat (`tools/check-bundle.js`).

Testprofil, damit die echten Einstellungen unberührt bleiben (wirkt nur beim Start aus dem Quellcode, nicht in der gebauten App):

```bash
SWAPLINE_PROFILE=test npm start
```

| Datei | Inhalt |
|---|---|
| `src/main.js` | Hauptprozess: Konten, Start von Claude Code pro Chat, Verlauf, Nutzung, Prüfung aller Eingaben der Oberfläche |
| `src/preload.js` | Brücke zwischen Oberfläche und Hauptprozess |
| `src/renderer/` | Oberfläche (HTML/CSS/JS ohne Framework), Markdown über marked + DOMPurify |
| `tools/` | Lizenzsammlung, Bundle-Prüfung |
| `src/renderer/assets/swapline.ico`, `.svg` | App-Icon (exe, Fenster, Taskleiste, Benachrichtigungen, README) |

## Versionen

Swapline folgt [Semantic Versioning](https://semver.org/lang/de/) (MAJOR.MINOR.PATCH). Die Nummer steht nur in `package.json`; Änderungen je Version in [CHANGELOG.md](CHANGELOG.md).

## Lizenz

[MIT](LICENSE) – Copyright (c) 2026 Halil Ayberk Bulut (ARFEP IT-Service) and Swapline contributors.

Drittkomponenten (Electron, Chromium, FFmpeg, marked, DOMPurify) siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); die Volltexte liegen im Release im Ordner `licenses/`. Das ARFEP-Logo in `src/renderer/assets/arfep/` steht **nicht** unter MIT (siehe [NOTICE](src/renderer/assets/arfep/NOTICE.md)).

Inoffizielles Projekt, nicht mit Anthropic verbunden. „Claude“ und „Claude Code“ sind Marken von Anthropic, PBC.

Impressum / Legal notice: arfep.de/impressum
