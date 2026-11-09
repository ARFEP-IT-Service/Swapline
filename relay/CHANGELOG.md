# Changelog – Swapline Relay

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/), unabhängig von Swapline am PC und der Android-App.
Tags: `relay-v<Version>`.

## [0.1.1] – 2026-11-09

- Behoben: Der Dienst startete alle paar Sekunden neu („Beendet (Aufgabe gestoppt)“ im Protokoll) – PowerShell wartete
  in der Aufgabe nicht auf die App und beendete sich sofort. Jetzt bleibt der Dienst dauerhaft an.
- Das Update gleicht eine bereits eingerichtete Aufgabe automatisch an (auch beim Öffnen der App); Kennwort, Port und
  Protokoll bleiben erhalten.

## [0.1.0] – 2026-11-09

Erste Version.

- Vermittler für Swapline: Haupt-PCs und Geräte verbinden sich nach außen zum Server; Ende-zu-Ende verschlüsselt, der
  Vermittler sieht keine Inhalte. Anmeldung per HMAC, Sperre nach Fehlversuchen, Begrenzungen je Adresse und Haupt-PC.
- App mit Oberfläche: Status, angemeldete Swapline-PCs, Kennwort (anzeigen, kopieren, neu), **Einrichtungscode** zum
  Einfügen in Swapline, Port, Windows-Firewall, Protokoll, Update-Hinweis; Deutsch/Englisch, hell/dunkel.
- Läuft als Dienst beim Windows-Start mit dem Konto „Lokaler Dienst“ (auch ohne Anmeldung); Installer hält den Dienst
  bei Updates an und entfernt Dienst und Firewall-Regel beim Deinstallieren.
