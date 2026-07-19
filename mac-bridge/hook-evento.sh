#!/bin/bash
# Hook de Claude Code -> mac-bridge (localhost). Reenvía el JSON del evento
# (stdin) al daemon para que la app Prospia tenga el estado al instante.
# Best-effort: si el daemon no corre, no molesta al turno.
curl -s -m 2 -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:${BRIDGE_HOOK_PORT:-8765}/evento" >/dev/null 2>&1 || true
exit 0
