# Changelog

Alle nennenswerten Änderungen an Swapline. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/):
**MAJOR.MINOR.PATCH** – Patch = nur Fehlerbehebungen, Minor = neue Funktionen (rückwärtskompatibel),
Major = nicht rückwärtskompatible Änderungen. Die Versionsnummer steht nur in `package.json` und gilt für
exe, Installer, ZIP, „Apps & Features“ und die Anzeige in der App.

## [0.6.0] – 2026-11-08

### Neu
- Sicherheitsabfrage beim Schließen, solange Claude in einem Chat noch arbeitet („Claude arbeitet noch in 1 Chat –
  trotzdem schließen?“). Ohne laufenden Chat schließt Swapline wie bisher ohne Rückfrage.

### Geändert
- Projektwechsel wechselt auch den Chat: Es öffnet sich der im Projekt zuletzt angesehene Chat (sonst der zuletzt
  aktive); hat das Projekt keine Chats, erscheint die Startansicht. Der zuletzt geöffnete Chat je Projekt wird gespeichert.

## [0.5.0] – 2026-11-08

### Neu
- Mehrere Hinweistöne zur Auswahl: Glocke, Ping, Tropfen, Aufsteigend, Dezent und Windows-Standard
  (eigene Töne per Web Audio, ohne Tondateien). Vorschau beim Auswählen; „Hinweiston“ aus älteren Versionen
  wird als Glocke übernommen.

## [0.4.0] – 2026-11-08

### Neu
- Einstellung „Werkzeug-Aufrufe im Chat“: **Alle anzeigen** (wie bisher), **Kompakt** (aufeinanderfolgende
  Befehle/Lese-/Bearbeitungsschritte als eine aufklappbare Zeile, z. B. „3 Schritte · Liest, Durchsucht, Befehl“)
  oder **Ausblenden** (nur Nachrichten und Antworten). Rückfragen, Fragen von Claude und Fehler bleiben immer sichtbar.

## [0.3.0] – 2026-11-08

### Neu
- Uhrzeit auch bei Claudes Antworten; bei Chats aus dem Verlauf mit den echten Zeitstempeln (heute nur HH:MM, sonst mit Datum).

### Geändert
- „Alles erlauben“ fragt nur noch beim allerersten Einschalten nach; die Zustimmung wird gespeichert.
  In den Einstellungen lässt sich die Warnung mit „Wieder anzeigen“ zurückholen.
- Mehr Abstand zwischen Nachrichten, Werkzeugkarten und Antwortrunden; Trennlinie nach jeder Runde.

### Behoben
- Kosten-Gegenwert war viel zu hoch: Claude Code meldet den Kostenstand der ganzen Sitzung, Swapline hat diese
  Zwischenstände addiert. Jetzt zählt nur der Zuwachs pro Antwort; die Zeile unter einer Antwort zeigt deren
  eigene Kosten. Die bisher falschen Summen werden beim ersten Start einmalig zurückgesetzt (Limits bleiben).

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
