# MafiaBattle Bot & Vision OCR (macOS)

Sistema autónomo de automatización y orquestación multihilo para MafiaBattle en macOS con OCR en tiempo real mediante el framework nativo de Apple Vision.

---

## ⚡ Inicio Rápido

Para desplegar e iniciar en un sistema nuevo o tras formatear el Mac:

```bash
# 1. Configurar entorno e instalar dependencias automáticamente
bash setup.sh

# 2. Iniciar el bot
./run.sh
```

---

## ⚙️ Controles Globales

- **Pausa / Reanudar:** Presiona la tecla `P` en cualquier momento mientras el bot está en ejecución para pausar o reanudar de forma segura todas las tareas sin perder el estado ni los temporizadores.
- **Parada de Emergencia (Failsafe):** Mueve el cursor bruscamente a cualquier esquina de la pantalla o presiona `Ctrl + C` en la terminal.

---

## 🔒 Permisos Requeridos de macOS

Para que el bot pueda controlar el mouse y leer la pantalla mediante OCR, macOS exige autorizar la aplicación de terminal en:
1. **Ajustes del Sistema > Privacidad y seguridad > Accesibilidad**
2. **Ajustes del Sistema > Privacidad y seguridad > Grabación de pantalla**

Ejecuta el script de diagnóstico para verificar que todo esté en orden:
```bash
./venv/bin/python verify_environment.py
```

---

## 📁 Archivos Principales

- `autoclicker.py`: Orquestador principal multihilo.
- `anti_inactividad.py`: Detector OCR a ~1 FPS para pulsar RELOAD automáticamente.
- `mayor_menor.py`: Minijuego Mayor o Menor con lectura OCR de cartas.
- `coordenadas.py`: Utilidad para ver coordenadas `(X, Y)` en tiempo real.
- `captura_desktop.py`: Generador de capturas con cuadrícula de coordenadas.
- `setup.sh`: Script de instalación automática del entorno.
- `verify_environment.py`: Verificación de salud y diagnóstico del sistema.
- `AGENT_INSTRUCTIONS.md`: Documento técnico para que un agente de IA opere el repositorio.
