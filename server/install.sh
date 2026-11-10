#!/bin/sh
# Swapline Server installieren bzw. aktualisieren – als normaler Benutzer (nicht root), auf dem Claude Code läuft.
# Legt das Programm nach ~/.local/share/swapline-server, den Befehl nach ~/.local/bin/swapline-server und einen
# systemd-Benutzerdienst an. Einstellungen und gekoppelte Geräte (~/.config/swapline-server) bleiben bei Updates erhalten.
set -eu

if [ "$(id -u)" = 0 ]; then
  echo "Bitte als normaler Benutzer ausführen, nicht als root (der Benutzer, mit dem Claude Code angemeldet ist)."
  echo "Please run as a normal user, not as root."
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 oder neuer fehlt – z. B.: sudo apt install nodejs  (oder https://nodejs.org)"
  echo "Node.js 20 or newer is missing."
  exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 20 ]; then echo "Node.js $MAJOR ist zu alt – bitte 20 oder neuer (Node.js $MAJOR is too old)."; exit 1; fi

HERE=$(cd "$(dirname "$0")" && pwd)
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/swapline-server"
BIN="$HOME/.local/bin"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

systemctl --user stop swapline-server 2>/dev/null || true
rm -rf "$DEST"
mkdir -p "$DEST" "$BIN" "$UNIT_DIR"
cp -R "$HERE/server" "$HERE/src" "$HERE/node_modules" "$HERE/LICENSE" "$DEST/"
chmod 755 "$DEST/server/swapline-server.js"
ln -sf "$DEST/server/swapline-server.js" "$BIN/swapline-server"

NODE=$(command -v node)
cat > "$UNIT_DIR/swapline-server.service" <<EOF
[Unit]
Description=Swapline Server (Fernzugriff für Claude Code)
After=network-online.target

[Service]
ExecStart=$NODE $DEST/server/swapline-server.js run
Restart=always
RestartSec=5
Environment=PATH=$BIN:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now swapline-server
# ohne angemeldeten Benutzer weiterlaufen (nach Neustart, ohne SSH-Sitzung)
loginctl enable-linger "$USER" 2>/dev/null || echo "Hinweis: Damit der Dienst auch ohne Anmeldung läuft: sudo loginctl enable-linger $USER"

echo
echo "Swapline Server läuft. Nächste Schritte / next steps:"
echo "  1. claude auth login                      (einmal, falls noch nicht angemeldet)"
echo "  2. swapline-server folders add ~/projekt  (Ordner für neue Chats)"
echo "  3. swapline-server pair                   (QR-Code mit der Swapline-App scannen)"
echo "Erreichbar über Port 47820/TCP (Firewall) – oder ohne offenen Port: swapline-server relay <Einrichtungscode>"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Hinweis: $BIN steht nicht im PATH – neu anmelden oder: export PATH=\"$BIN:\$PATH\"" ;; esac
