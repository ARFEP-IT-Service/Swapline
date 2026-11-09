# Changelog

Alle nennenswerten Änderungen an Swapline. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/):
**MAJOR.MINOR.PATCH** – Patch = nur Fehlerbehebungen, Minor = neue Funktionen (rückwärtskompatibel),
Major = nicht rückwärtskompatible Änderungen. Die Versionsnummer steht nur in `package.json` und gilt für
exe, Installer, ZIP, „Apps & Features“ und die Anzeige in der App.

Vor jedem Push wird entschieden, ob eine neue Versionsnummer vergeben wird.

## [Unveröffentlicht]

- Leiste: Projekte und Ordner von Haupt-PCs und Servern stehen links unter dem jeweiligen Eintrag – aufklappbar
  (Klick öffnet und klappt auf, erneuter Klick klappt zu), Ordner darin ebenfalls. Die mittlere Leiste scrollt bei
  vielen Einträgen, statt sie zu stauchen.

## [0.7.0] – 2026-11-09

- Fernzugriff: Änderungen am Haupt-PC (Freigaben, Projekte, Ordner, Konten) kommen sofort beim Gerät an – kein
  Neuverbinden mehr nötig. „+“ in der Leiste bietet in der Haupt-PC-Ansicht „Neues Projekt auf …“ an.
- Server per SSH: Projekte und Ordner wie bei einem Haupt-PC anlegen, umbenennen, in Ordner legen und entfernen;
  den Projektordner legt Swapline auf Wunsch auf dem Server an (mkdir -p).

## [0.6.0] – 2026-11-09

- Fernzugriff: Projekte und Ordner eines Haupt-PCs (bzw. die Ordner eines Servers) erscheinen in dessen Ansicht als
  Filter; ein neuer Chat startet im Projektordner. Mit der neuen Gerätefreigabe „Projekte anlegen“ kann ein Gerät dort
  Projekte und Ordner anlegen und umbenennen (nicht löschen, Projektordner nur aus den freigegebenen).
- Gespiegelte Haupt-PC-Chats behalten ihre Zuordnung zu eigenen Projekten.

## [0.5.0] – 2026-11-09

- Neu: **Server per SSH** (z. B. VPS mit Ubuntu) – Claude Code läuft auf dem Server, Chats und Verlauf erscheinen wie
  bei einem Haupt-PC. Anmeldung am Server nur per SSH-Schlüssel, Claude-Anmeldung auf dem Server über ein Terminal.
- Neu: **Geteilte Ansicht** – zwei Chats nebeneinander (Strg+#, Rechtsklick → „Daneben öffnen“).
- Neu: eigenes Bild für Chats; Haupt-PCs in der Leiste mit eigenem Namen, Farbe und Bild.

- Fernzugriff: Die **offenen Chats des Haupt-PCs** erscheinen auf dem Gerät (live aktualisiert, nach Freigabe).
  Öffnen = dem laufenden Chat **beitreten**: gleicher Claude-Prozess, Antworten erscheinen auf beiden PCs, Nachrichten
  und beantwortete Rückfragen werden auf der jeweils anderen Seite angezeigt (mit Absender). Kein zweiter Prozess
  mehr auf derselben Sitzung.

## [0.4.0] – 2026-11-09

- Fernzugriff: Chats eines Haupt-PCs laufen jetzt **neben** den eigenen statt die ganze Oberfläche umzuschalten.
  „Allgemein“ zeigt alle Chats zusammen; der Haupt-PC in der Leiste wirkt wie ein Projekt (nur dessen Chats und
  Verlauf, neue Chats dort). Jeder gekoppelte Haupt-PC bleibt im Hintergrund verbunden.
- Sicherheit: Geräteschlüssel (auch verschlüsselt) gehen nicht mehr an die Oberfläche.

## [0.3.0] – 2026-11-09

- Projekt-Ordner: Projekte in der Leiste in Ordnern zusammenfassen (auf-/zuklappbar, Projekte per Ziehen oder im
  Projekt zuordnen; Ordner löschen behält die Projekte).
- Gekoppelte Haupt-PCs stehen direkt in der Leiste („Dieser PC“ und je Haupt-PC ein Symbol, Klick wechselt).

## [0.2.1] – 2026-11-09

- Knopf „Ganz nach unten“ (auch Strg+Ende), sobald man im Chat nach oben gescrollt hat.
- Erfolgreich beendete Hintergrund-Aufgaben verschwinden nach ein paar Sekunden von selbst aus der Leiste;
  fehlgeschlagene bleiben sichtbar.

## [0.2.0] – 2026-11-09

- Neu: **Fernzugriff** – ein anderer eigener PC mit Swapline nutzt Chats und Konten dieses PCs, im Netzwerk oder
  übers Internet (Tailscale/VPN oder Portweiterleitung). Kopplung per Einmal-Code mit Bestätigung am Haupt-PC,
  verschlüsselt per TLS-PSK mit eigenem Schlüssel je Gerät; „Alles erlauben“ je Gerät freigebbar; Geräte entfernbar.
  Auswahl von Konto, Projekt und Modell je Gerät getrennt; Konten, Projekte, Plugins und Einstellungen des Haupt-PCs
  bleiben vom Gerät aus unverändert.
- Freigabe je Gerät: alle oder ausgewählte Konten, Projekte und einzelne Chats (auch per Rechtsklick auf einen Chat);
  der Haupt-PC setzt sie bei jeder Anfrage durch.

## [0.1.3] – 2026-11-09

- Update: „Herunterladen“ lädt nur noch. Danach fragt Swapline „Jetzt neu starten“ oder „Später“ und startet nie
  von selbst neu; mit „Später“ wird das Update beim nächsten Beenden installiert.

## [0.1.2] – 2026-11-09

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
