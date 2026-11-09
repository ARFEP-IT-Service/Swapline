# Third-party notices / Hinweise zu Drittkomponenten

Swapline is licensed under the MIT License (see `LICENSE`). The Windows release contains the
following third-party components. Their full license texts are in the `licenses/` folder next to
`Swapline.exe`.

Swapline steht unter der MIT-Lizenz (siehe `LICENSE`). Das Windows-Release enthält die folgenden
Drittkomponenten; die vollständigen Lizenztexte liegen im Ordner `licenses/` neben `Swapline.exe`.

| Component | Version | Used for | License | Full text |
|---|---|---|---|---|
| Electron | 45.2.3 | Application runtime (window, Node.js) | MIT | `licenses/Electron-45.2.3.txt` |
| Chromium (part of Electron) | as shipped with Electron 45.2.3 | Rendering engine | BSD-3-Clause and the licenses of its third-party components | `licenses/Chromium-LICENSES.chromium.html` |
| FFmpeg (`ffmpeg.dll`, part of Electron) | as shipped with Electron 45.2.3 | Media decoding inside Chromium | LGPL-2.1-or-later | `licenses/FFmpeg-LGPL-2.1.txt` |
| marked | 18.1.3 | Markdown rendering of chat messages | MIT | `licenses/marked-18.1.3.txt` |
| DOMPurify | 3.4.17 | Sanitizing rendered Markdown | Apache-2.0 OR MPL-2.0 (used under Apache-2.0) | `licenses/dompurify-3.4.17-LICENSE.txt`, `licenses/dompurify-3.4.17-LICENSE-MPL.txt` |
| @types/trusted-types | 2.0.7 | Type definitions pulled in by DOMPurify (no runtime code) | MIT | `licenses/types__trusted-types-2.0.7.txt` |
| electron-updater | 6.8.11 | Automatic updates from GitHub releases | MIT | `licenses/electron-updater-6.8.11.txt` |
| builder-util-runtime | 9.7.0 | Used by electron-updater | MIT | `licenses/builder-util-runtime-9.7.0.txt` |
| debug, ms | 4.4.3, 2.1.3 | Used by electron-updater | MIT | `licenses/debug-4.4.3.txt`, `licenses/ms-2.1.3.txt` |
| fs-extra, jsonfile, universalify | 10.1.0, 6.2.1, 2.0.1 | Used by electron-updater | MIT | `licenses/fs-extra-10.1.0.txt`, `licenses/jsonfile-6.2.1.txt`, `licenses/universalify-2.0.1.txt` |
| graceful-fs | 4.2.11 | Used by electron-updater | ISC | `licenses/graceful-fs-4.2.11.txt` |
| js-yaml | 4.3.2 | Reading `latest.yml` (electron-updater) | MIT | `licenses/js-yaml-4.3.2.txt` |
| argparse | 2.0.1 | Used by js-yaml | Python-2.0 | `licenses/argparse-2.0.1.txt` |
| lazy-val | 1.0.5 | Used by electron-updater (the package ships no license file; text from its declared MIT license) | MIT | `licenses/lazy-val-1.0.5.txt` |
| lodash.escaperegexp, lodash.isequal | 4.1.2, 4.5.0 | Used by electron-updater | MIT | `licenses/lodash.escaperegexp-4.1.2.txt`, `licenses/lodash.isequal-4.5.0.txt` |
| sax | 1.6.1 | Reading the GitHub release feed (electron-updater) | BlueOak-1.0.0 | `licenses/sax-1.6.1.txt` |
| semver | 7.7.4 | Version comparison (electron-updater) | ISC | `licenses/semver-7.7.4.txt` |
| tiny-typed-emitter | 2.1.0 | Used by electron-updater | MIT | `licenses/tiny-typed-emitter-2.1.0.txt` |

Installer only (`Swapline-Setup-<version>.exe`, not part of the installed app) / nur im Installer:

| Component | Version | Used for | License | Full text |
|---|---|---|---|---|
| NSIS (Nullsoft Scriptable Install System) | 3.0.4.1 (as used by electron-builder) | Installer and uninstaller stub | zlib/libpng; LZMA module: CPL-1.0 | `licenses/Installer-NSIS-COPYING.txt` |
| electron-builder NSIS scripts | 26.18.0 | Installer logic (per-user installation, shortcuts, uninstall entry) | MIT | `licenses/Installer-electron-builder-26.18.0.txt` |

`licenses/packages.json` lists the exact npm packages and versions that were bundled. The build
checks that every bundled package has a license text and that no unbundled package is listed
(`tools/check-bundle.js`).

## FFmpeg (LGPL)

`ffmpeg.dll` is shipped unmodified as built by the Electron project and lies as a separate file
next to `Swapline.exe`. You may replace it with your own build of the same FFmpeg version/ABI
(see the Electron release notes for 45.2.3). Source code: Electron's FFmpeg is built from
Chromium's FFmpeg fork, https://chromium.googlesource.com/chromium/third_party/ffmpeg — the exact
revision is referenced by the Chromium version that Electron 45.2.3 is based on
(https://github.com/electron/electron/releases/tag/v45.2.3).

`ffmpeg.dll` wird unverändert so ausgeliefert, wie das Electron-Projekt sie baut, und liegt als
eigene Datei neben `Swapline.exe`. Sie darf durch einen eigenen Build derselben FFmpeg-Version
ersetzt werden.

## Not included / Nicht enthalten

Claude Code itself is **not** part of Swapline. Swapline starts the `claude` program that the
user has installed separately; Claude Code is subject to Anthropic's own terms
(https://code.claude.com/docs).

## Trademarks / Marken

“Claude” and “Claude Code” are trademarks of Anthropic, PBC. Swapline is an unofficial project and
is not affiliated with or endorsed by Anthropic. Electron is a trademark of the OpenJS Foundation.

The ARFEP logo (`src/renderer/assets/arfep/`) is **not** covered by the MIT license, see
`src/renderer/assets/arfep/NOTICE.md`.
