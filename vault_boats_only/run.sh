#!/usr/bin/env bash
# =====================================================================
# Script de Inicio - MafiaBattle Vault Robbery (Solo Barcos en Lotes de 10)
# =====================================================================
set -euo pipefail
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$( cd "$DIR/.." && pwd )"
cd "$DIR"

PYTHON="$ROOT/venv/bin/python"
if [ ! -f "$PYTHON" ]; then
    uv venv --python 3.14.2 "$ROOT/venv"
    uv pip install --python "$PYTHON" -r "$ROOT/requirements-bidi.txt"
fi

case "${1:-start}" in
  start) [[ $# -eq 0 ]] || shift; exec "$PYTHON" -u "$DIR/main_vault_boats.py" --background "$@" ;;
  run) shift; exec "$PYTHON" -u "$DIR/main_vault_boats.py" "$@" ;;
  stop) exec "$PYTHON" "$DIR/main_vault_boats.py" --stop ;;
  status) exec "$PYTHON" "$DIR/main_vault_boats.py" --status ;;
  *) exec "$PYTHON" -u "$DIR/main_vault_boats.py" "$@" ;;
esac
