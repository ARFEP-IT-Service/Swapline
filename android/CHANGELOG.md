# Changelog – Swapline für Android

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/), unabhängig von der Version der PC-App.
Tags: `android-v<Version>`.

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
