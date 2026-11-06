#!/usr/bin/env bash
# =====================================================================
# Script de Inicio - MafiaBattle WebDriver BiDi Resident Supervisor
# =====================================================================
set -euo pipefail
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Auto-despliegue si el entorno virtual aún no existe
if [ ! -f "./venv/bin/python" ]; then
    uv venv --python 3.14.2 venv
    uv pip install --python ./venv/bin/python -r requirements-bidi.txt
fi
source ./venv/bin/activate

# Entrada canónica: supervisor residente BiDi (main_bidi.py).
case "${1:-start}" in
  start) [[ $# -eq 0 ]] || shift; exec ./venv/bin/python -u main_bidi.py --background "$@" ;;
  run) shift; exec ./venv/bin/python -u main_bidi.py "$@" ;;
  stop) exec ./venv/bin/python main_bidi.py --stop ;;
  status) exec ./venv/bin/python main_bidi.py --status ;;
  showroom) exec ./venv/bin/python main_bidi.py --showroom ;;
  install-service) exec ./venv/bin/python scripts/manage_service.py install ;;
  remove-service) exec ./venv/bin/python scripts/manage_service.py remove ;;
  service-status) exec ./venv/bin/python scripts/manage_service.py status ;;
  restart-service) exec ./venv/bin/python scripts/manage_service.py restart ;;
  *) exec ./venv/bin/python -u main_bidi.py "$@" ;;
esac
