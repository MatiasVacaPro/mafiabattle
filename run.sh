#!/usr/bin/env bash
# =====================================================================
# Script de Inicio - MafiaBattle Autoclicker
# =====================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Auto-despliegue si el entorno virtual aún no existe
if [ ! -f "./venv/bin/python" ]; then
    echo "⚠️  Entorno virtual no detectado. Ejecutando setup.sh automáticamente..."
    bash ./setup.sh
fi

# Ejecutar el script principal con Python en modo unbuffered (-u)
echo "🚀 Iniciando autoclicker.py con la venv del proyecto..."
exec ./venv/bin/python -u autoclicker.py
