# Changelog – Swapline Server

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/), unabhängig von Swapline am PC, der Android-App und
Swapline Relay. Tags: `server-v<Version>`.

## [0.1.0] – 2026-11-10

Erste Version.

- Swapline als Haupt-PC ohne Fenster für einen eigenen Linux-Server: Handy (oder anderer PC) koppelt sich per QR-Code
  bzw. Kopplungslink, direkt oder über den Vermittler. Chats mit Rückfragen, Verlauf in Seiten, „!“-Befehle, Dokumente
  hochladen, Hintergrund-Ausgaben – mit denselben Prüfungen wie Swapline am PC (gemeinsamer Kern `src/chat-core.js`).
- Befehlszeile `swapline-server` (status, pair, devices, folders, relay), Installation als systemd-Benutzerdienst.
- Braucht Node.js 20+ und Claude Code mit `claude auth login` auf dem Server.
