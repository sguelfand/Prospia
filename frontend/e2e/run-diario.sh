#!/bin/bash
# Corrida DIARIA de los tests visuales (7:00 AM Buenos Aires, vía launchd).
# Corre la suite Playwright contra prod y registra el resultado en el Historial
# ($0 de API — Playwright maneja un navegador, no llama IA). Log en /tmp.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
DIR="$(cd "$(dirname "$0")/.." && pwd)"   # .../prospia/frontend
LOG="/tmp/prospia-tests-diario.log"
cd "$DIR" || exit 1
{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
  rm -rf e2e/.auth test-results
  npm run test:e2e:registrar
  echo ""
} >> "$LOG" 2>&1
