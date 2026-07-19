# mac-bridge — Sesiones de Claude en la app Prospia

Daemon que corre en la Mac de Sebi y espeja las sesiones de Claude Code en la
pantalla **Sesiones** de la app Prospia (y ejecuta lo que la app pida: mandar
mensajes, crear sesiones, continuar una en tmux).

## Piezas

- `bridge.py` — el daemon. Transcripts (`~/.claude/projects/`) + hooks locales
  (HTTP 127.0.0.1:8765) + tmux + WebSocket saliente a
  `wss://prospia.app/api/sesiones/ws-mac?token=<PROSPIA_MIRROR_TOKEN>`.
- `hook-evento.sh` — lo llaman los hooks de Claude Code; reenvía el evento al
  daemon (best-effort, no frena turnos).
- `install.sh` — venv (`~/.claude/mac-bridge/venv`) + launchd
  (`com.prospia.mac-bridge`, KeepAlive) + `Sesiones Claude (cel).command` en el
  escritorio + copia estable del hook en `~/.claude/mac-bridge/`.

## Hooks requeridos en `~/.claude/settings.json`

Agregar `~/.claude/mac-bridge/hook-evento.sh` (async, timeout 5) a:
`SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`, `PermissionRequest`
y `SessionEnd`. Conviven con otros hooks del mismo evento (peon-ping, etc.).

## Qué puede y qué no

- Sesión de VSCode/terminal: se **ve** en vivo y avisa (push) cuando termina o
  espera. NO se le puede escribir (Claude Code no permite inyectar input a un
  TUI ajeno). El botón "Continuar desde el cel" la reabre en tmux (`claude
  --resume`); si claude forkea el id, el puente mapea el nuevo y oculta el viejo.
- Sesión creada/continuada desde la app: corre en `tmux` (`cc-*`) → interactiva
  desde el cel y desde la Mac (doble click al `.command` del escritorio).
- Mensajes que arrancan con `/key ` mandan teclas crudas a tmux (p.ej.
  `/key 1`, `/key Enter`, `/key Down`) para contestar prompts nativos del TUI.
- Estados: `procesando` / `esperando` (permiso o input) / `pregunta`
  (AskUserQuestion o MCP preguntar-sebi pendiente) / `idle`.
- Push (toggles en la app, con su ⓘ): `sesion_termino` (solo turnos ≥60s) y
  `sesion_espera` (rate-limit 5 min por sesión).

## Operación

- Log: `~/.claude/mac-bridge/bridge.log` (y `launchd.log` / `launchd.err`).
- Reiniciar: `launchctl unload ~/Library/LaunchAgents/com.prospia.mac-bridge.plist && launchctl load ...`
  (o re-correr `install.sh`).
- La Mac dormida = "Mac offline" en la app; es esperado (no hay keep-awake).

## TCC (permisos de macOS) — importante tras un reinicio

launchd NO tiene acceso a `~/Documents`. Por eso el daemon corre desde
`~/.claude/mac-bridge/`, y el **server de tmux** tiene que arrancarse desde un
contexto CON permisos (Terminal/instalación), no desde el daemon. La sesión
`keeper` (la crea `install.sh` y el `.command` del escritorio) mantiene vivo ese
server "bendecido". **Si la Mac se reinicia** y las sesiones nuevas del cel no
pueden leer Documents: doble click al `.command` del escritorio (recrea keeper
desde Terminal). Fix definitivo opcional: System Settings → Privacy & Security →
Full Disk Access → agregar `/opt/homebrew/bin/tmux`.
