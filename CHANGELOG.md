# Changelog

Alle nennenswerten Änderungen an Swapline. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/):
**MAJOR.MINOR.PATCH** – Patch = nur Fehlerbehebungen, Minor = neue Funktionen (rückwärtskompatibel),
Major = nicht rückwärtskompatible Änderungen. Die Versionsnummer steht nur in `package.json` und gilt für
exe, Installer, ZIP, „Apps & Features“ und die Anzeige in der App.

## [0.2.0] – 2026-11-08

### Neu
- Eigenes Bild für Projekte (SVG, PNG, JPG, WebP, GIF, ICO bis 1 MB), gewählt über einen Datei-Dialog.
- Windows-Benachrichtigung bei fertiger Antwort und bei Rückfragen, mit Chat-Titel und Anfang der Antwort;
  Klick öffnet den Chat, Taskleiste blinkt im Hintergrund. Einstellbar: wenn der Chat nicht im Blick ist /
  immer / aus, optional mit Hinweiston, mit Testknopf.

### Geändert
- „Alles erlauben“ ist rot statt magenta hervorgehoben.
- Versionsnummer kommt nur noch aus `package.json` (vorher zusätzlich fest im Code).

### Behoben
- Bedingte Knöpfe erzeugten den Text „null“ (Projektordner, Einstellungen, Anmelde-Dialog).

## [0.1.0] – 2026-11-08

Erste installierbare Version (`SWAP-Installer.exe`, pro Benutzer nach `%LOCALAPPDATA%\Programs\swapline`).
Chat-Oberfläche für Claude Code mit Projekten, Kontowechsel, Modell-/Aufwand-/Berechtigungsauswahl, Verlauf,
Nutzungsanzeige; Anmeldung nur über `claude auth login`; Übernahme der Einstellungen aus ConsoleAI/Switchdesk.
