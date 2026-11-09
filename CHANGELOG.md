# Changelog

Alle nennenswerten Änderungen an Swapline. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/):
**MAJOR.MINOR.PATCH** – Patch = nur Fehlerbehebungen, Minor = neue Funktionen (rückwärtskompatibel),
Major = nicht rückwärtskompatible Änderungen. Die Versionsnummer steht nur in `package.json` und gilt für
exe, Installer, ZIP, „Apps & Features“ und die Anzeige in der App.

Vor jedem Push wird entschieden, ob eine neue Versionsnummer vergeben wird.

## [Unveröffentlicht]

- Behoben: Der Kosten-Gegenwert verdoppelte sich nach jedem Fortsetzen eines Chats (App-Neustart, Update,
  Modell- oder Berechtigungswechsel), weil Claude Code den bisherigen Kostenstand der Sitzung mitbringt.
  Die überhöhten Summen werden einmalig zurückgesetzt.
- Behoben: Klicks auf Benachrichtigungen konnten ein leeres Electron-Fenster öffnen, wenn auf dem Rechner auch aus
  dem Quellcode gestartet wurde – Entwicklungs- und Testläufe haben jetzt eine eigene App-Kennung.

## [0.1.1] – 2026-11-09

Prüfung des automatischen Updates; keine Funktionsänderung.

## [0.1.0] – 2026-11-09

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
- Windows-Benachrichtigung bei fertiger Antwort und Rückfragen – bleibt auf Wunsch stehen, bis man sie anklickt; Klick öffnet den Chat. Hinweistöne zur Auswahl.
- Werkzeug-Aufrufe im Chat: alle, kompakt oder ausgeblendet.
- Antworten von Claude und Code-Blöcke per Knopf kopieren (Markdown), ebenso die Ausgabe von Hintergrund-Aufgaben.
- Hintergrund-Aufgaben (z. B. Befehle mit `run_in_background`) als Leiste über dem Eingabefeld, mit Status und Ausgabe.
- /-Befehle mit Auswahlliste (Befehle und Skills des Kontos; /clear, /model, /rename, /login, /config führt Swapline selbst aus).
- Bilder und Dateien anhängen: Büroklammer, Strg+V (Bild) oder Ziehen ins Fenster; Bilder gehen als Bild an Claude, Dateien als Pfad.
- Eingabe-Verlauf: ↑/↓ blättert durch die letzten eigenen Nachrichten.
- Suche: offene Chats inklusive Nachrichtentext, im Verlauf Volltextsuche durch alle Sitzungen mit Ausschnitt.
- Plan-Modus: Plan als Karte mit „Plan annehmen“, „Überarbeiten lassen“ und „Ablehnen“.
- Recap (Zusammenfassung „während du weg warst“) aus Claude Code wird angezeigt.
- Erweiterungen-Fenster (Puzzle-Symbol, /plugins, /skills): installierte Plugins aktivieren/deaktivieren/entfernen, Plugins aus den Marktplätzen suchen und installieren (über `claude plugin …`), Skills und Befehle des Kontos anzeigen.
- Sicherheitsabfrage beim Schließen, solange Claude arbeitet oder eine Hintergrund-Aufgabe läuft; solche Chats
  bleiben in Liste und Projektleiste als aktiv markiert.
- Updates aus den GitHub-Releases (nur installierte App): Standard „Nur benachrichtigen“ – Hinweis „Version X verfügbar“
  mit „Herunterladen und installieren“; wahlweise „Automatisch“ (laden, beim Neustart installieren) oder „Aus“.
- Feste Antworttexte an Claude (z. B. Ablehnung einer Aktion) immer auf Englisch, unabhängig von der Oberflächensprache.
- Oberfläche auf Deutsch und Englisch (Einstellung „Sprache“, Standard: wie System).
- Automatische Tests (`npm test`), GitHub-Workflows für Tests/Build und Release-Entwürfe
  (ohne Code-Signierung).
- Sicherheitsprüfung 2: Antworten können keine Dateien außerhalb der App oder Netzwerkfreigaben laden, Ausgaben von
  Hintergrund-Aufgaben nur aus von Claude Code gemeldeten Dateien, Bestätigung für jede Plugin-Änderung,
  Volltextsuche ohne Einfrieren.
- Anmeldung nur über `claude auth login` (System-Browser); keine Zugangsdaten in Swapline.
- Installer `Swapline-Setup-<Version>.exe` (pro Benutzer, ohne Admin-Rechte) und ZIP; Übernahme der Einstellungen aus
  ConsoleAI/Switchdesk.
