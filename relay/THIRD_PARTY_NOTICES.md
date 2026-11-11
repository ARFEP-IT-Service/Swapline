# Third-party notices – Swapline Relay / Hinweise zu Drittkomponenten

Swapline Relay is part of Swapline and licensed under the MIT License (see `LICENSE`). The Windows
release (installer and zip) contains the following third-party components. Their full license
texts are in the `licenses/` folder next to `Swapline Relay.exe`. Swapline Relay itself has no
npm dependencies.

Swapline Relay gehört zu Swapline und steht unter der MIT-Lizenz (siehe `LICENSE`). Das
Windows-Release enthält die folgenden Drittkomponenten; die vollständigen Lizenztexte liegen im
Ordner `licenses/` neben `Swapline Relay.exe`. Swapline Relay selbst hat keine npm-Abhängigkeiten.

| Component | Version | Used for | License | Full text |
|---|---|---|---|---|
| Electron | 45.2.3 | Application runtime (window, Node.js for the background service) | MIT | `licenses/Electron-45.2.3.txt` |
| Chromium (part of Electron) | as shipped with Electron 45.2.3 | Rendering engine of the window | BSD-3-Clause and the licenses of its third-party components | `licenses/Chromium-LICENSES.chromium.html` |
| FFmpeg (`ffmpeg.dll`, part of Electron) | as shipped with Electron 45.2.3 | Media decoding inside Chromium (not used by the relay) | LGPL-2.1-or-later | `licenses/FFmpeg-LGPL-2.1.txt` |

Installer only (`Swapline-Relay-Setup-<version>.exe`) / nur im Installer:

| Component | Version | Used for | License | Full text |
|---|---|---|---|---|
| NSIS (Nullsoft Scriptable Install System) | 3.0.4.1 (as used by electron-builder) | Installer and uninstaller stub | zlib/libpng; LZMA module: CPL-1.0 | `licenses/Installer-NSIS-COPYING.txt` |
| electron-builder NSIS scripts | 26.18.0 | Installer logic | MIT | `licenses/Installer-electron-builder-26.18.0.txt` |

## FFmpeg (LGPL)

`ffmpeg.dll` is shipped unmodified as built by the Electron project and lies as a separate file
next to `Swapline Relay.exe`. You may replace it with your own build of the same FFmpeg
version/ABI. Source code: Chromium's FFmpeg fork,
https://chromium.googlesource.com/chromium/third_party/ffmpeg — the exact revision is referenced
by the Chromium version that Electron 45.2.3 is based on
(https://github.com/electron/electron/releases/tag/v45.2.3).

`ffmpeg.dll` wird unverändert so ausgeliefert, wie das Electron-Projekt sie baut, und liegt als
eigene Datei neben `Swapline Relay.exe`. Sie darf durch einen eigenen Build derselben
FFmpeg-Version ersetzt werden.

## Trademarks / Marken

“Claude” is a trademark of Anthropic, PBC. Swapline is an unofficial project and is not affiliated
with or endorsed by Anthropic. Electron is a trademark of the OpenJS Foundation.
