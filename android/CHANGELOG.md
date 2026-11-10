# Changelog – Swapline für Android

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/), unabhängig von der Version der PC-App.
Tags: `android-v<Version>`.

## [0.11.0] – 2026-11-10

- Neu: **/resume** (Verlauf öffnen), **/export** (Chat mit allen Details als Markdown-Datei speichern) und **/summary**
  (Claude fasst den Chat zusammen) – stehen in der „/“-Auswahl oben.

## [0.10.0] – 2026-11-10

- Neu: **Smileys werden zu Emojis** (wie am PC) – beim Tippen nach dem Leerzeichen und beim Senden; direkt danach löschen
  stellt den Smiley wieder her. Abschaltbar unter Einstellungen → Eingabe.

## [0.9.0] – 2026-11-10

- Neu: **Bilder in Antworten von Claude** – Bild-Dateien, auf die Claude verweist, kommen vom Haupt-PC (bzw. Swapline
  Server) und erscheinen im Chat; Bilder aus dem Internet erst nach Tippen. Antippen zeigt das Bild groß. Braucht
  Swapline am PC ab 0.16.0 bzw. Swapline Server ab 0.2.0.
- Neu: Bilder, die Claude liest (z. B. Screenshots), als Vorschau in der Werkzeug-Karte.

## [0.8.0] – 2026-11-10

- Neu: **SSH-Server des Haupt-PCs** (z. B. ein VPS) erscheinen als eigene Einträge in der Auswahl oben („VPS · PC-Name“):
  neue Chats, Verlauf, Antworten und Rückfragen wie gewohnt – die Verbindung baut der Haupt-PC auf. Braucht Swapline am PC
  ab 0.15.0 und dort für dieses Gerät die Freigabe „SSH-Server“.
- Neu: **Rückfragen nach Risiko eingefärbt** – kritische Befehle rot, heikle orange, mit kurzem Grund (gleiche Regeln wie
  am PC).
- Neu: **Tabellen** in Antworten von Claude werden als Tabelle angezeigt (seitlich scrollbar), statt als Textzeilen mit „|“.

## [0.7.1] – 2026-11-10

- Behoben: **Große Chats brauchten beim Öffnen sehr lange** (über Mobilfunk teils Minuten) – die App lädt jetzt nur die
  letzten 3 eigenen Nachrichten samt Antworten; „↑ Ältere Nachrichten laden“ oben im Chat holt je 5 weitere. Der
  Haupt-PC schickt Bilder im Verlauf ohne Daten (📷 bleibt sichtbar) und kürzt lange Ausgaben (braucht Swapline am PC
  ab 0.14.1; ältere Haupt-PCs schicken weiterhin alles).
- Update-Hinweis liest jetzt die neuesten 100 statt 30 Releases – PC-, Relay- und Handy-Versionen stehen in derselben
  Liste, sonst wäre eine neue Handy-Version nach einigen PC-Releases nicht mehr angezeigt worden.

## [0.7.0] – 2026-11-09

- Neu: **Türkisch** – die App folgt der Systemsprache (Deutsch, Englisch, Türkisch).
- Neu: **„!“-Befehle** – „!git status“ im Eingabefeld führt den Befehl am Haupt-PC im Ordner des Chats aus, die Ausgabe
  erscheint als Karte, Claude sieht sie mit der nächsten Nachricht. Braucht Swapline am PC ab 0.14.0 und für dieses Gerät
  die Freigabe „Alles erlauben“ in der Geräteliste.
- Neu: **„/“-Befehle** – beim Tippen von „/“ erscheint eine Auswahl der Befehle und Skills des Kontos (wie am PC).

## [0.6.0] – 2026-11-09

- Neu: **Live-Status in der Benachrichtigung** – solange Claude arbeitet, zeigt eine stille Benachrichtigung je Chat den
  aktuellen Schritt („Denkt nach …“, „Schreibt die Antwort …“, „Befehl: npm test“, „Liest main.js“, „Wartet auf dich“)
  mit Laufzeit und Ladebalken; auf Android 16+ als **Live Update** auch oben in der Statusleiste. Verschwindet, wenn
  Claude fertig ist oder der Chat offen ist; abschaltbar in den Einstellungen.

## [0.5.0] – 2026-11-09

- Neu: **Über Vermittler verbinden** – ist am PC ein Vermittler eingerichtet (Swapline ab 0.11.0), verbindet sich die App
  von unterwegs darüber, ohne Portfreigabe und ohne VPN. Zu Hause bleibt es die direkte Verbindung. Die Daten kommen
  automatisch vom PC; Koppeln per QR-Code geht damit auch von unterwegs. Der Status zeigt „verbunden über Vermittler“.

## [0.4.0] – 2026-11-09

- Neu: **Hintergrund-Aufgaben** wie am PC – Leiste über dem Eingabefeld („1 Hintergrund-Aufgabe läuft“), Liste mit
  Typ, Laufzeit und Status, Ausgabe eines Befehls (letzte 64 KB vom PC); beendete verschwinden nach ein paar Sekunden,
  fehlgeschlagene bleiben. Chats mit laufender Hintergrund-Aufgabe gelten in der Liste als aktiv.

## [0.3.0] – 2026-11-09

- Neu: **Dokumente an Claude** – Büroklammer im Chat → „Dokument“: beliebige Dateien vom Handy oder aus Cloud-Speichern
  (PDF, Word, Excel, Text, Code …, je bis 25 MB). Sie gehen an den Haupt-PC, Claude bekommt den Pfad (braucht Swapline
  am PC ab 0.10.0). Bilder gehen weiterhin direkt als Bild.
- Große Übertragungen: längere Wartezeit, das Lebenszeichen pausiert während einer Übertragung.

## [0.2.1] – 2026-11-09

- Behoben: Nachrichten fehlten (z. B. nur ein Bash-Aufruf, danach nichts mehr), wenn die Verbindung kurz weg war –
  App im Hintergrund, Standby oder Netzwechsel. Nach jeder Unterbrechung lädt die App den Chat vollständig vom PC neu
  und tritt allen offenen Chats wieder bei (nicht nur dem sichtbaren). Offene Rückfragen erscheinen wieder als Karte
  (braucht Swapline am PC ab 0.9.1).

## [0.2.0] – 2026-11-09

- Neu: **Im Hintergrund verbunden bleiben** – Antworten und Rückfragen melden sich auch bei geschlossener App
  (dauerhafte, stille Benachrichtigung; abschaltbar in den Einstellungen, dort auch der Hinweis zur Akku-Optimierung).
  Lebenszeichen alle 4 Minuten erkennen tote Verbindungen; beim Wechsel WLAN ↔ Mobilfunk wird sofort neu verbunden.
- Neu: **Bilder an Claude schicken** – Büroklammer im Chat: Foto aufnehmen oder aus der Galerie (bis zu 6 je Nachricht,
  auf dem Handy verkleinert). Kamera-Fotos werden nach dem Einlesen gelöscht.
- Sicherheit: Nach dem Scannen eines QR-Codes zeigt die App erst den Namen des PCs und koppelt erst auf Tippen;
  Benachrichtigungen zeigen auf dem Sperrbildschirm keine Chat-Inhalte; Diagnose-Ausgaben nur noch in Testversionen.

## [0.1.1] – 2026-11-09

- Neu: **Einstellungen** (Zahnrad oben auf der Startseite): Diktieren an/aus, „Nur auf dem Gerät erkennen“, Status der
  Spracherkennung, Berechtigungen mit Sprung in die Android-Einstellungen, Haupt-PCs, Updates, Version und Lizenzen.
- Behoben: Das Mikrofon im Chat fehlte, wenn das Handy keinen Sprachdienst meldete – es ist jetzt immer da und erklärt
  beim Antippen, was fehlt.

## [0.1.0] – 2026-11-09

Erste Version.

- Koppeln mit Swapline am PC per QR-Code oder Adresse, Port und Einmal-Code (Bestätigung am PC).
- Chats des Haupt-PCs: offene Chats live sehen und beitreten, Verlauf mit Suche, Filter nach Konto und Projekt,
  neuer Chat mit Konto, Ordner, Modell, Aufwand und Berechtigungen.
- Antworten live mit Markdown, Werkzeug-Aufrufe, Karten für Rückfragen, Fragen und Pläne; Claude anhalten.
- Diktieren ins Eingabefeld (Android-Spracherkennung, möglichst auf dem Gerät).
- Benachrichtigungen bei fertiger Antwort oder Rückfrage.
- Mehrere Adressen je Haupt-PC (Heimnetz, VPN, öffentliche Adresse), automatisch vom PC aktualisiert.
- Update-Hinweis aus den GitHub-Releases, Open-Source-Lizenzen in der App.
- Android 17: Berechtigung „Lokales Netzwerk“ für Verbindungen ins Heimnetz.
