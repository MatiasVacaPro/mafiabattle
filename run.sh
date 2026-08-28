#!/bin/bash
# Script para iniciar el autoclicker usando el entorno virtual correcto y sin buffering

# Obtener la ruta absoluta del directorio del script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Ir al directorio del script
cd "$DIR"

# Ejecutar el script usando el Python del entorno virtual con -u (unbuffered)
echo "🚀 Iniciando autoclicker.py con la venv del proyecto..."
./venv/bin/python -u autoclicker.py
