#!/usr/bin/env bash
# =====================================================================
# Script de Despliegue Automatizado - MafiaBattle Bot (macOS)
# =====================================================================
# Este script crea el entorno virtual, instala todas las dependencias
# necesarias (PyAutoGUI, PyObjC Apple Vision OCR, Pillow, pynput, etc.)
# y ejecuta la verificación completa de salud del sistema.
# =====================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "================================================================="
echo "🚀 INICIANDO DESPLIEGUE DEL ENTORNO MAFIABATTLE"
echo "================================================================="

# 1. Detectar comando de Python disponible
PYTHON_BIN=""

if command -v uv &> /dev/null; then
    echo "⚡ 'uv' detectado en el sistema. Usando despliegue de alta velocidad..."
    USE_UV=true
else
    USE_UV=false
fi

if [ "$USE_UV" = false ]; then
    for candidate in python3.14 python3.13 python3.12 python3.11 python3; do
        if command -v "$candidate" &> /dev/null; then
            PYTHON_BIN=$(command -v "$candidate")
            break
        fi
    done

    if [ -z "$PYTHON_BIN" ]; then
        echo "❌ ERROR: No se encontró Python 3 instalado en el sistema."
        echo "   Por favor instala Python 3 (recomendado 3.12, 3.13 o 3.14):"
        echo "   brew install python"
        exit 1
    fi
    echo "🐍 Python detectado: $PYTHON_BIN ($($PYTHON_BIN --version))"
fi

# 2. Crear entorno virtual (venv)
if [ ! -d "venv" ] || [ ! -f "venv/bin/python" ]; then
    echo "📦 Creando entorno virtual 'venv'..."
    if [ "$USE_UV" = true ]; then
        uv venv venv
    else
        "$PYTHON_BIN" -m venv venv
    fi
    echo "✅ Entorno virtual creado."
else
    echo "ℹ️  Entorno virtual 'venv' existente detectado."
fi

# 3. Instalar o actualizar dependencias
echo "📥 Instalando dependencias..."
if [ -d "wheels" ] && [ "$(ls -A wheels)" ]; then
    echo "📦 Detectada carpeta local de 'wheels'. Instalando en modo rápido/offline..."
    if [ "$USE_UV" = true ]; then
        uv pip install --no-index --find-links ./wheels -r requirements.txt --python ./venv/bin/python || uv pip install -r requirements.txt --python ./venv/bin/python
    else
        ./venv/bin/pip install --no-index --find-links=./wheels -r requirements.txt || ./venv/bin/pip install -r requirements.txt
    fi
else
    if [ "$USE_UV" = true ]; then
        uv pip install -r requirements.txt --python ./venv/bin/python
    else
        ./venv/bin/python -m pip install --upgrade pip
        ./venv/bin/pip install -r requirements.txt
    fi
fi
echo "✅ Dependencias instaladas con éxito."

# 4. Asignar permisos de ejecución
chmod +x run.sh setup.sh verify_environment.py 2>/dev/null || true

# 5. Ejecutar diagnóstico de verificación
echo ""
echo "🔍 Ejecutando verificación de entorno y permisos..."
./venv/bin/python verify_environment.py

echo ""
echo "================================================================="
echo "🎉 DESPLIEGUE FINALIZADO"
echo "================================================================="
echo "Para iniciar el bot ejecuta:"
echo "   ./run.sh"
echo "================================================================="
