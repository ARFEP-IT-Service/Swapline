# Mitmachen

Danke, dass du Swapline verbessern willst. Fehlerberichte, Ideen und Pull Requests sind willkommen.
*Contributions in English are welcome too.*

## Fehler melden

Bitte im Issue angeben:

- Swapline-Version (Einstellungen, unten) und Windows-Version
- Claude-Code-Version (`claude --version`)
- Was du getan hast, was passiert ist und was du erwartet hast
- Falls vorhanden, die letzten Zeilen aus `%APPDATA%\Swapline\swapline.log`

**Keine** Zugangsdaten, Tokens, Chat-Inhalte mit vertraulichen Daten oder Dateien aus `~/.claude` anhängen.
Sicherheitslücken bitte nicht öffentlich melden, sondern per E-Mail über [arfep.de](https://arfep.de).

## Entwickeln

```bash
npm install
npm start          # App aus dem Quellcode
npm test           # Tests: Sicherheit und Oberfläche (ohne Netz, ohne Claude-Aufrufe)
npm run dist       # Installer + ZIP bauen und Lizenzen prüfen
```

Zum Ausprobieren ein eigenes Testprofil verwenden, dann bleiben die echten Einstellungen unberührt:
`SWAPLINE_PROFILE=test npm start` (nur beim Start aus dem Quellcode).

## Regeln für Änderungen

- **Ein Fenster:** alles passiert in der App, keine zusätzlichen Fenster – Ausnahme sind native Bestätigungsdialoge.
- **Anmeldung nur über `claude auth login`.** Swapline liest, speichert oder überträgt keine Zugangsdaten, Tokens
  oder Cookies und zeigt keine Anmeldeseiten an.
- **Der Hauptprozess prüft alles, was aus der Oberfläche kommt** (Pfade, IDs, Einstellungen, Inhalte).
  Neue IPC-Kanäle brauchen eine Prüfung und einen Test in `tests/ui/security.test.js`.
- **Keine eigenen Netzverbindungen** außer der dokumentierten Update-Prüfung bei GitHub. Anfragen an Claude laufen
  immer über die installierte Claude-Code-CLI.
- **Keine Shell:** Prozesse nur mit Argument-Liste starten (`spawn(exe, args)`), nie `shell: true`.
- **Neue npm-Abhängigkeiten** nur, wenn nötig. `npm run dist` bricht ab, wenn ein gebündeltes Paket keinen
  Lizenztext hat.
- Code-Stil: wie der umgebende Code, Kommentare auf Deutsch, Oberfläche ohne Framework.
- `npm test` muss grün sein. Für neue Funktionen der Oberfläche einen Test in `tests/ui/ui.test.js` ergänzen.

## Tests

`tests/run.js` startet die App je Testdatei in `tests/ui/` mit einem eigenen Testprofil und einem leeren
Konfigurationsordner, führt die Tests in der Oberfläche aus und gibt eine Liste aus. Eine Testdatei ist ein
async-Ausdruck, der die Ergebnisse zurückgibt:

```js
(async () => {
  check('Beschreibung', bedingung, 'Detail bei Fehler');
  return T;
})()
```

Hilfen (`check`, `sleep`, `until`, `key`, `typeInto`, `WORK`) stehen in `tests/ui/_helpers.js`.
Nur eine Datei laufen lassen: `npm test -- security`.

## Versionen und Releases

[Semantic Versioning](https://semver.org/lang/de/). Die Version steht nur in `package.json`, Änderungen in
`CHANGELOG.md`. Ein Release entsteht durch einen Tag `vX.Y.Z`, der zu `package.json` passen muss. Der Workflow
`release.yml` testet, baut (ohne Code-Signierung), erzeugt Prüfsummen und **veröffentlicht den Release selbst**:

| Version | Release auf GitHub | Installierte Apps |
|---|---|---|
| ohne Zusatz, z. B. `0.1.2` | normaler Release, als „Latest“ markiert | bekommen das Update angeboten |
| mit Zusatz, z. B. `0.2.0-beta.1` | Pre-release, nicht „Latest“ | bekommen es nicht angeboten |

Schlägt ein Test, die Versionsprüfung oder der Build fehl, ist der Workflow rot und es entsteht kein Release.
Vor dem Tag deshalb die Version in `package.json` und den Abschnitt in `CHANGELOG.md` setzen – er wird zur
Release-Beschreibung.

## Lizenz

Mit einem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE) des Projekts veröffentlicht wird.
