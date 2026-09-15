# INSTRUCCIONES DE DESPLIEGUE PARA AGENTE DE IA (MAFIABATTLE)

Este documento contiene la especificación técnica completa y las directivas de despliegue para que un **Agente de IA** (o desarrollador) configure el entorno desde cero, instale dependencias y ejecute el proyecto sin intervención humana innecesaria tras un formateo de disco o migración.

---

## 1. Resumen del Proyecto

- **Nombre:** MafiaBattle Autonomous Bot & Vision OCR
- **Plataforma:** macOS (Intel x86_64 o Apple Silicon arm64)
- **Lenguaje:** Python 3.10+ (probado y validado en Python 3.13 y 3.14)
- **Tecnologías Clave:**
  - `PyAutoGUI` / `pynput`: Automatización de cursor, clics, secuencias de teclado y listener global de pausa.
  - `Apple Vision Framework` (`pyobjc-framework-Vision`, `Foundation`, `Quartz`): OCR nativo en macOS a ~1 FPS para detección de modales de inactividad (*Idle too long*) y lectura de números en minijuegos (*Mayor o Menor*).
  - `Threading` con `PausableLock`: Concurrencia de múltiples distritos y tareas sin colisión de mouse.
  - Tecla de pausa global: Presionar `P` en cualquier momento pausa o reanuda todas las tareas de forma segura.

---

## 2. Flujo de Despliegue Rápido (1-Click)

Si eres un agente recién llegado a la carpeta desempaquetada:

```bash
# 1. Ejecutar el script maestro de aprovisionamiento
bash setup.sh

# 2. Verificar la salud del entorno y permisos de macOS
./venv/bin/python verify_environment.py

# 3. Iniciar el bot
./run.sh
```

El script `setup.sh` detecta automáticamente si existe `uv` (instalación ultrarrápida en ~2s) o usa `python3 -m venv` con `pip`, instala `requirements.txt`, otorga permisos `+x` y valida el entorno.

---

## 3. Requisitos Críticos de Seguridad de macOS (TCC Permissions)

En macOS, el sistema operativo bloquea el control de cursor y la captura de pantalla por motivos de seguridad hasta que el usuario lo apruebe explícitamente en Ajustes del Sistema.

El script `verify_environment.py` diagnostica estos permisos automáticamente:

1. **Accesibilidad (Accessibility):**
   - Requerido por `PyAutoGUI` para mover el mouse y teclear.
   - Verificado mediante: `ApplicationServices.AXIsProcessTrusted()`.
   - Ruta en macOS: `Ajustes del Sistema > Privacidad y seguridad > Accesibilidad`.
   - Debe estar activada la aplicación que ejecuta el proceso (ej. `Terminal`, `iTerm2`, `Cursor`, `VS Code` o `Python`).
   - Comando directo para abrir la ventana de ajustes:
     ```bash
     open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
     ```

2. **Grabación de Pantalla (Screen Recording):**
   - Requerido para capturar regiones de pantalla y pasarlas al motor OCR Apple Vision.
   - Ruta en macOS: `Ajustes del Sistema > Privacidad y seguridad > Grabación de pantalla`.
   - Comando directo:
     ```bash
     open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
     ```

> **Nota para el Agente:** Si `verify_environment.py` indica que alguno de estos permisos falta, debes notificar al usuario de forma clara indicando la aplicación que debe habilitar en los Ajustes del Sistema.

---

## 4. Calibración de Pantalla y Resolución

- **Resolución Objetivo:** `1680x1050` puntos lógicos (resolución nativa calibrada en el código).
- **Escalado Retina:** El código maneja factores de escala 2x mediante `captura_desktop.py` y recortes relativos en puntos virtuales de PyAutoGUI.
- **Ubicación de Ventana:** MafiaBattle debe estar abierto en el navegador a pantalla completa o en la posición estándar de juego.
- **Herramientas de Recalibración:**
  - `python coordenadas.py`: Muestra en tiempo real la posición `(X, Y)` del mouse bajo el cursor para ajustar coordenadas si cambia el diseño de la web.
  - `python captura_desktop.py`: Genera `capturas/captura_pantalla_con_coordenadas.png` con una cuadrícula visual superpuesta para inspección.

---

## 5. Inventario de Archivos y Arquitectura

| Archivo | Rol y Descripción |
| :--- | :--- |
| `autoclicker.py` | Orquestador principal multihilo. Gestiona temporizadores de distritos, ruleta, minijuegos, gimnasio, bloqueo de mouse y hotkeys. |
| `anti_inactividad.py` | Módulo OCR Apple Vision independiente que monitorea el aviso *"Idle too long"* y pulsa *RELOAD* automáticamente. |
| `mayor_menor.py` | Minijuego Casino Higher/Lower con OCR para lectura de cartas y decisiones óptimas. |
| `barrio.py` | Automatización del distrito residencial (*Residential Area*). |
| `billonarie_club.py` | Secuencia de clicks para el *Billionaire Club*. |
| `fabricacion.py` | Ciclo de fabricación de Cristal / XTC con control de cooldowns. |
| `gym.py` | Módulo de entrenamiento en el gimnasio con navegación secuencial. |
| `coordenadas.py` | Utilidad interactiva CLI para inspeccionar coordenadas de pantalla. |
| `captura_desktop.py` | Generador de capturas en 1x, Retina 2x y con grilla de coordenadas. |
| `ordenes` | Especificación de reglas fijas, temporizadores y notas de referencia del autor. |
| `crop_*.png` | Plantillas visuales de referencia para botones, pestañas e iconos del juego. |
| `capturas/` | Directorio de capturas de depuración y pruebas de OCR. |
| `requirements.txt` | Lista de paquetes necesarios para `pip` / `uv`. |
| `requirements-frozen.txt` | Snapshot exacto de versiones congeladas probadas en macOS. |
| `setup.sh` | Script bash de auto-despliegue e instalación de entorno virtual. |
| `run.sh` | Lanzador del bot con auto-detección y recuperación de entorno. |
| `verify_environment.py` | Diagnóstico automático de dependencias, permisos TCC y resolución. |

---

## 6. Configuración de Tareas en `autoclicker.py`

Al inicio de `autoclicker.py`, las siguientes variables controlan los módulos activos:

```python
ACTIVO_TEMPORIZADOR_1     = False  # Celebrities District (cada 6 min)
ACTIVO_TEMPORIZADOR_2     = False  # Shopping Street (cada 6 min)
ACTIVO_TEMPORIZADOR_3     = False  # Jardin Clasico (cada 10 min)
ACTIVO_TEMPORIZADOR_4     = True   # Mafiosi District (cada 8 min)
ACTIVO_TEMPORIZADOR_6     = False  # Residential Area (cada 8 min)
ACTIVO_TEMPORIZADOR_7     = True   # Billonari Club (cada 8 min)
ACTIVO_FABRICACION_CRISTAL = False  # Fabricación Cristal (cada 2 horas)
ACTIVO_RULETA             = True   # Ruleta Casino (cada 30 min)
ACTIVO_MAYOR_MENOR        = True   # Mayor o Menor Casino (cada 30 min)
ACTIVO_MAS_VIDA           = True   # Recarga de vida dinámica
ACTIVO_RECOLECTOR_PIEDRAS = False  # Recolector de gemas (cada 3 horas)
ACTIVO_ANTI_INACTIVIDAD   = True   # Auto-Reload OCR a ~1 FPS
ACTIVO_GYM                 = False  # Entrenamiento Gimnasio
```

---

## 7. Directivas para el Agente en caso de Fallas

- **Failsafe activado (`pyautogui.FailSafeException`):** Ocurre si el cursor se arrastra físicamente a una esquina `(0, 0)`. Es la parada de emergencia nativa. El agente debe verificar si la ventana perdió el foco o si el usuario detuvo el script deliberadamente.
- **Fallo en captura de pantalla:** Comprobar inmediatamente `verify_environment.py` para asegurar que el permiso de Grabación de Pantalla no fue revocado tras una actualización del sistema operativo.
- **Fallo de OCR:** Verificar si el juego cambió de escala o de tema visual inspeccionando la imagen `capturas/debug_anti_inactividad.png` o `capturas/debug_numero.png`.
