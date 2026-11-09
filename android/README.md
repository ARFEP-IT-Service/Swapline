# Swapline für Android

Die Handy-App zu [Swapline](../README.md): Chats auf dem eigenen PC (**Haupt-PC**) vom Handy aus führen. Auf dem Handy
läuft **kein** Claude Code und es gibt keine Claude-Anmeldung – die App ist ein gekoppeltes Gerät wie ein zweiter PC
(siehe [Fernzugriff](../README.md#fernzugriff)). Claude, Konten und Dateien bleiben auf dem Haupt-PC.

## Funktionen

- **Koppeln per QR-Code** (oder Adresse, Port und Einmal-Code) – am Haupt-PC wird jede Kopplung bestätigt.
- **Chats des Haupt-PCs:** am PC offene Chats live sehen und beitreten, Verlauf mit Suche, Filter nach Konto und Projekt.
- **Neuer Chat** mit Konto, Ordner, Modell, Aufwand und Berechtigungen („Alles erlauben“ nur, wenn am Haupt-PC für das Gerät freigegeben).
- **Antworten live** mit Markdown und Code, Werkzeug-Aufrufe kompakt, **Rückfragen, Fragen und Pläne als Karten**, Claude anhalten.
- **Bilder an Claude:** Büroklammer im Chat – Foto aufnehmen oder aus der Galerie (bis zu 6 je Nachricht, auf dem Handy verkleinert).
- **Dokumente an Claude:** Büroklammer → „Dokument“ – beliebige Dateien (je bis 25 MB); sie landen auf dem Haupt-PC in einem eigenen Upload-Ordner, Claude bekommt den Pfad (Swapline am PC ab 0.10.0).
- **Hintergrund-Aufgaben:** Leiste über dem Eingabefeld wie am PC, mit Liste und Ausgabe von Befehlen.
- **Diktieren:** Mikrofon im Eingabefeld (Spracherkennung von Android, wenn möglich auf dem Gerät); gesendet wird erst mit „Senden“.
- **Benachrichtigung** bei fertiger Antwort oder Rückfrage – mit „Im Hintergrund verbunden bleiben“ auch bei geschlossener App
  (dauerhafte, stille Benachrichtigung; Lebenszeichen erkennen abgerissene Verbindungen, Netzwechsel verbindet sofort neu).
- **Einstellungen** (Zahnrad): Diktieren, Hintergrund-Verbindung, Akku-Optimierung, Berechtigungen, Haupt-PCs, Updates, Lizenzen.
- **Über Vermittler** (eigener Server, siehe [relay/](../relay/README.md)): von unterwegs ohne Portfreigabe und ohne VPN; Ende-zu-Ende verschlüsselt.
- **Mehrere Adressen je Haupt-PC** (Heimnetz, Tailscale, öffentliche Adresse) – die App probiert sie der Reihe nach und übernimmt neue Adressen vom Haupt-PC.
- **Update-Hinweis**, wenn in den Releases eine neuere Version liegt (Download über den Browser, Android fragt vor der Installation).
- Deutsch und Englisch nach Systemsprache, hell/dunkel nach System.

## Installation

1. Auf dem Handy die neueste `Swapline-Android-<Version>.apk` aus den [Releases](https://github.com/ARFEP-IT-Service/Swapline/releases) (Tags `android-v…`) laden.
2. Öffnen – Android fragt einmal, ob der Browser Apps installieren darf.
3. In der App **Haupt-PC koppeln → QR-Code scannen**; am PC in Swapline: Fernzugriff → **Fernzugriff erlauben** → **Gerät koppeln …**.

Die APK ist mit einem eigenen Schlüssel signiert (SHA-256 des Zertifikats in den Release-Notizen). Updates lassen sich
über die installierte App installieren; eine Version mit anderem Schlüssel (z. B. ein eigener Build) muss vorher
deinstalliert werden.

**Von unterwegs:** per VPN (z. B. [Tailscale](https://tailscale.com)) oder mit Portfreigabe am Router (TCP 47820 auf den
Haupt-PC). Swapline zeigt am PC unter „Erreichbar unter“ die öffentliche Adresse und gibt sie im QR-Code mit.

## Berechtigungen

| Berechtigung | Wofür |
|---|---|
| Internet, lokales Netzwerk | Verbindung zum Haupt-PC (Android 17 verlangt für das Heimnetz eine eigene Freigabe) |
| Kamera | QR-Code beim Koppeln und Fotos für Claude; Fotos werden nach dem Einlesen gelöscht |
| Mikrofon | nur beim Diktieren |
| Benachrichtigungen | Hinweis bei fertiger Antwort oder Rückfrage (Sperrbildschirm ohne Inhalt) |
| Vordergrund-Dienst | „Im Hintergrund verbunden bleiben“ (abschaltbar) |

## Sicherheit

- Gleiches Protokoll wie zwischen zwei PCs: TLS 1.2 mit eigenem 256-Bit-Schlüssel je Gerät (TLS-PSK mit ECDHE,
  ChaCha20-Poly1305, über BouncyCastle). Der Geräteschlüssel liegt mit dem **Android Keystore** verschlüsselt auf dem Handy
  und ist von Backups und Geräteübertragung ausgenommen.
- Der Haupt-PC prüft jede Anfrage selbst (Freigaben je Gerät, Konten, Ordner). Gerät am PC entfernen = Zugriff sofort weg.
- QR-Codes werden streng geprüft (nur `swapline://pair`, gültige Adressen, Port und Code); die App zeigt erst den Namen des
  PCs und koppelt erst auf Tippen, der Haupt-PC fragt zusätzlich nach Bestätigung.
- Bilder gehen nur als verkleinerte JPEGs an den eigenen Haupt-PC; Kamera-Fotos werden danach gelöscht, Galerie-Bilder nur gelesen.
- **Nur eigene Geräte koppeln** – das Teilen eines Claude-Kontos erlauben Anthropics Bedingungen nicht.

## Entwicklung

Kotlin, Jetpack Compose, Gradle (Wrapper im Ordner). Voraussetzung: JDK 21 und Android SDK (API 37).

```
./gradlew testDebugUnitTest     # Tests (Verbindungstests laufen gegen src/remote.js, braucht Node)
./gradlew assembleDebug         # Debug-APK
./gradlew assembleRelease       # Release-APK (signiert, wenn ~/.swapline-android/keystore.properties existiert)
node tools/licenses.js          # app/src/main/assets/licenses.txt aus den Abhängigkeiten neu erzeugen
```

Der Signaturschlüssel liegt nie im Repo: Gradle liest `SWAPLINE_KEYSTORE_PROPS` bzw.
`~/.swapline-android/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`).

`testhost/host.js` startet den echten Fernzugriff aus `src/remote.js` mit Beispieldaten – für die Tests und für einen
Rauchtest im Emulator.

## Versionen

Eigene Versionsnummer (`versionName` in `app/build.gradle.kts`), Tags `android-v<Version>`; siehe [CHANGELOG.md](CHANGELOG.md).
Lizenz: MIT wie Swapline; Lizenzen der Bibliotheken in der App unter *Haupt-PCs → Open-Source-Lizenzen*.
