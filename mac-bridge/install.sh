#!/bin/bash
# Instala el mac-bridge: venv + launchd (arranque automático) + acceso de
# escritorio para ver las sesiones del cel en la Mac (tmux).
#
# Uso: ./install.sh [ruta-del-mac-bridge]   (default: la carpeta de este script)
# Idempotente: correrlo de nuevo re-instala/reinicia el daemon.
set -euo pipefail

BRIDGE_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
STATE_DIR="$HOME/.claude/mac-bridge"
VENV="$STATE_DIR/venv"
PLIST="$HOME/Library/LaunchAgents/com.prospia.mac-bridge.plist"
LABEL="com.prospia.mac-bridge"

echo "→ mac-bridge desde: $BRIDGE_DIR"
mkdir -p "$STATE_DIR" "$HOME/Library/LaunchAgents"

# 1. venv con websockets
if [ ! -x "$VENV/bin/python3" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip websockets

# 2. Copia del código a ~/.claude/mac-bridge (fuera de ~/Documents: macOS/TCC
#    NO deja que un daemon launchd lea Documents → correr desde ahí falla con
#    "Operation not permitted"). launchd apunta a la copia.
cp "$BRIDGE_DIR/bridge.py" "$STATE_DIR/bridge.py"

# 3. launchd plist (KeepAlive: lo revive si se cae; corre con la Mac despierta)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$VENV/bin/python3</string>
    <string>$STATE_DIR/bridge.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$STATE_DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$STATE_DIR/launchd.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

# 3. Acceso de escritorio: abre/attachea las sesiones tmux del puente
CMD="$HOME/Desktop/Sesiones Claude (cel).command"
cat > "$CMD" <<'EOF'
#!/bin/bash
# Abre las sesiones de Claude creadas/continuadas desde el cel (tmux).
# Si hay varias, muestra el selector de tmux (flechas + Enter; d = despegar).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Sesión "keeper": mantiene vivo el server de tmux arrancado DESDE Terminal
# (contexto con permisos TCC a Documents). Si el server lo arrancara el daemon
# de launchd, las sesiones nuevas no podrían tocar ~/Documents.
tmux has-session -t keeper 2>/dev/null || tmux new-session -d -s keeper
if ! tmux ls 2>/dev/null | grep -q '^cc-'; then
  echo "No hay sesiones del cel corriendo ahora."
  echo "(Se crean desde la app Prospia → Sesiones)"
  read -n 1 -s -r -p "Tocá una tecla para cerrar…"
  exit 0
fi
N=$(tmux ls 2>/dev/null | grep -c '^cc-')
PRIMERA=$(tmux ls | grep '^cc-' | head -1 | cut -d: -f1)
if [ "$N" -eq 1 ]; then
  exec tmux attach -t "=$PRIMERA"
else
  exec tmux attach -t "=$PRIMERA" \; choose-tree -s
fi
EOF
chmod +x "$CMD"

chmod +x "$BRIDGE_DIR/hook-evento.sh" "$BRIDGE_DIR/bridge.py" 2>/dev/null || true

# 3.5 Comando `cs` (sesión espejada Mac<->cel) al PATH
cp "$BRIDGE_DIR/cs" "$HOME/.local/bin/cs" 2>/dev/null && chmod +x "$HOME/.local/bin/cs" || true

# 4. Copia estable del hook (los hooks de settings.json apuntan acá, para que
#    sigan andando aunque el repo se mueva o el worktree se borre)
cp "$BRIDGE_DIR/hook-evento.sh" "$STATE_DIR/hook-evento.sh"
chmod +x "$STATE_DIR/hook-evento.sh"

echo "✓ daemon instalado y corriendo (launchctl list | grep $LABEL)"
echo "✓ log: $STATE_DIR/bridge.log"
echo "✓ escritorio: 'Sesiones Claude (cel).command'"
echo "⚠ Falta (si no está hecho): hooks en ~/.claude/settings.json → ver README.md"
