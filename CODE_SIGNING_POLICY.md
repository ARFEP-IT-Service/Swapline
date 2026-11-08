# Code signing policy

> **Status:** prepared, not active yet. Swapline releases are currently **unsigned**. Once the project has been
> accepted by the SignPath Foundation, releases will be signed as described below and this note will be removed.
> (Deutsch: Signierung ist vorbereitet, aber noch nicht aktiv – bis dahin sind die Releases unsigniert.)

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What is signed

Only release builds made by the GitHub Actions workflow [`release.yml`](.github/workflows/release.yml) from a version
tag (`v*`) in this repository:

| File | When |
|---|---|
| `Swapline.exe` | before it is packed into the installer and the ZIP |
| `SWAP-Installer.exe` | after the installer is built; `latest.yml` then gets the new checksum |

Local builds (`npm run dist`) and CI test builds are never signed. Third-party binaries shipped inside the app
(Electron/Chromium runtime, `ffmpeg.dll`) are not re-signed by this project.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [Halil Ayberk Bulut](https://github.com/AyberkBLT) (ARFEP IT-Service) |
| Approvers | [Halil Ayberk Bulut](https://github.com/AyberkBLT) (ARFEP IT-Service) |

Every signing request is approved manually by an approver in SignPath. Contributions from outside the team are
merged only after review by a committer.

## Privacy policy

Swapline does not collect telemetry and does not send personal data anywhere. It sends nothing to other networked
systems unless the user asks for it, with one exception:

- **Update check:** the installed app asks GitHub (`github.com/ARFEP-IT-Service/Swapline`, release metadata
  `latest.yml`) whether a newer version exists, at start-up and every 6 hours, and downloads it from there.
  No account or usage data is sent. It can be switched off in **Settings → Updates**.

All requests to Claude are made by the separately installed, unmodified Claude Code CLI from Anthropic, under the
user's own account; Swapline itself does not talk to Anthropic. Sign-in only happens through `claude auth login`
in the user's browser; Swapline never reads or stores credentials or tokens.

## Verifying a download

Each release lists SHA-256 checksums in `SHA256SUMS.txt`:

```powershell
Get-FileHash .\SWAP-Installer.exe -Algorithm SHA256
```

Once signing is active, the signature can also be checked in the file properties (**Digital Signatures**) or with
`Get-AuthenticodeSignature .\SWAP-Installer.exe`.

## Setup (maintainers)

1. Apply at the SignPath Foundation for open-source code signing (project: Swapline, repository
   `ARFEP-IT-Service/Swapline`).
2. In SignPath create the project `swapline`, the signing policy `release-signing` and two artifact
   configurations: `app` (a ZIP of the app folder; sign `Swapline.exe`) and `installer` (sign `SWAP-Installer.exe`).
3. In the GitHub repository set the variable `SIGNPATH_ORGANIZATION_ID` and the secret `SIGNPATH_API_TOKEN`.
   The release workflow signs only when both are present.
4. Optional, after the first signed release: set `build.win.signtoolOptions.publisherName` in `package.json` to
   the certificate's subject name, so the auto-update only installs updates signed with that certificate.
