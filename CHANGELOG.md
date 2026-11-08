# Changelog

Alle nennenswerten Änderungen an Swapline. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/):
**MAJOR.MINOR.PATCH** – Patch = nur Fehlerbehebungen, Minor = neue Funktionen (rückwärtskompatibel),
Major = nicht rückwärtskompatible Änderungen. Die Versionsnummer steht nur in `package.json` und gilt für
exe, Installer, ZIP, „Apps & Features“ und die Anzeige in der App.

Bis zur ersten Veröffentlichung auf GitHub bleibt die Version **0.1.0**; danach wird vor jedem Push entschieden,
ob eine neue Versionsnummer vergeben wird.

## [0.1.0] – unveröffentlicht

Erste Version.

- Chat-Oberfläche für Claude Code im Messenger-Stil: Sprechblasen, Markdown, Live-Text, Uhrzeiten,
  Rückfragen (Erlauben / Immer erlauben / Ablehnen, Fragen von Claude) als Karten.
- Projekte in der Leiste links (eigenes Bild oder Initialen, optional mit Projektordner); Projektwechsel öffnet
  den dort zuletzt angesehenen Chat. Chats umbenennen, verschieben, schließen.
- Mehrere Claude-Konten mit eigenem Konfigurationsordner; Wechsel über das Profil links unten; Chat mit anderem
  Konto fortsetzen (mit Rückfrage, weil der Verlauf kopiert wird).
- Chat-Einstellungen in einem Menü: Konto, Modell (aus dem Konto, mit Standard), Aufwand, Berechtigungen;
  „Alles erlauben“ (`--dangerously-skip-permissions`) rot hervorgehoben, einmalige Bestätigung.
- Verlauf aller Claude-Code-Sitzungen des Kontos, fortsetzbar.
- Nutzungsanzeige: 5-Stunden- und Wochenlimit, Kosten-Gegenwert (Zuwachs pro Antwort).
- Windows-Benachrichtigung bei fertiger Antwort und Rückfragen, Hinweistöne zur Auswahl.
- Werkzeug-Aufrufe im Chat: alle, kompakt oder ausgeblendet.
- Antworten von Claude und Code-Blöcke per Knopf kopieren (Markdown), ebenso die Ausgabe von Hintergrund-Aufgaben.
- Hintergrund-Aufgaben (z. B. Befehle mit `run_in_background`) als Leiste über dem Eingabefeld, mit Status und Ausgabe.
- /-Befehle mit Auswahlliste (Befehle und Skills des Kontos; /clear, /model, /rename, /login, /config führt Swapline selbst aus).
- Bilder und Dateien anhängen: Büroklammer, Strg+V (Bild) oder Ziehen ins Fenster; Bilder gehen als Bild an Claude, Dateien als Pfad.
- Eingabe-Verlauf: ↑/↓ blättert durch die letzten eigenen Nachrichten.
- Suche: offene Chats inklusive Nachrichtentext, im Verlauf Volltextsuche durch alle Sitzungen mit Ausschnitt.
- Plan-Modus: Plan als Karte mit „Plan annehmen“, „Überarbeiten lassen“ und „Ablehnen“.
- Recap (Zusammenfassung „während du weg warst“) aus Claude Code wird angezeigt.
- Sicherheitsabfrage beim Schließen, solange Claude arbeitet.
- Anmeldung nur über `claude auth login` (System-Browser); keine Zugangsdaten in Swapline.
- Installer `SWAP-Installer.exe` (pro Benutzer, ohne Admin-Rechte) und ZIP; Übernahme der Einstellungen aus
  ConsoleAI/Switchdesk.
