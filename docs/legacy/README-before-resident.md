# MafiaBattle Autonomous Bot & BiDi Engine (macOS)

Sistema autónomo de automatización y orquestación para **MafiaBattle** en macOS. Incorpora arquitectura dual:
1. **Enfoque A & C (Predeterminado):** Control en segundo plano vía **WebDriver BiDi** (`ws://127.0.0.1:9222/session` en Zen Browser), interacción directa por DOM/JS sin secuestrar el ratón del sistema y tolerancia a interferencia humana.
2. **Modo Legacy GUI (Respaldo):** Automatización física de cursor mediante PyAutoGUI y lectura OCR nativa con Apple Vision Framework.

---

## ⚡ Inicio Rápido

Para desplegar e iniciar el bot:

```bash
# 1. Configurar entorno e instalar dependencias (si es primera vez)
bash setup.sh

# 2. Consultar estado en tiempo real de conexión, estadísticas del jugador y timers
./run.sh --status

# 3. Iniciar el bot en segundo plano
./run.sh
```

---

## 🏗️ Arquitectura: Enfoque A y C (BiDi + DOM)

- **Cero secuestro del ratón:** El bot interactúa con la sesión activa de Zen Browser mediante llamadas nativas de WebDriver BiDi en el puerto 9222. Puedes seguir utilizando tu computadora con total normalidad mientras el bot opera en segundo plano.
- **Tolerancia a injerencia del usuario:** El monitor `UserActivityMonitor` escucha eventos de interacción física (`mousedown`, `keydown`, `wheel`) en la pestaña del juego. Si realizas un clic o tocas una tecla manualmente, el bot se suspende de inmediato y reanuda tras 12 segundos de inactividad.
- **Detección DOM y timers reales:** Lee variables del motor (`window.stats_*`, `data-cdtimer`) para saber con precisión de milisegundos cuándo están listos los edificios, crímenes, ruleta y minijuegos.
- **Anti-inactividad 24/7:** Envía pulsos nativos de `ping:pong` para mantener la sesión viva sin recargas de página destructivas y cierra modales de inactividad de forma autónoma.

---

## ⚙️ Controles Globales y Opciones CLI

| Opción | Descripción |
| :--- | :--- |
| `./run.sh` | Inicia el bot en modo BiDi (segundo plano por defecto). |
| `./run.sh --status` | Muestra estado de conexión, salud del jugador, efectivo, timers y tareas listas. |
| `./run.sh --dry-run` | Valida configuraciones y planificador sin ejecutar acciones. |
| `./run.sh --mode gui` | Fuerza el modo legacy (PyAutoGUI físico con OCR). |
| **Tecla `P`** | Pausa o reanuda de forma inmediata todas las tareas en curso. |
| **`Ctrl + C`** | Cierre limpio de sesión BiDi y parada segura. |

---

## 📁 Inventario de Archivos Clave

| Archivo | Rol y Descripción |
| :--- | :--- |
| `main.py` | Orquestador principal POO compatible con Enfoque A, C y legacy GUI. |
| `core/zen_bidi.py` | Cliente nativo de WebDriver BiDi con auto-recuperación ante sesiones zombi. |
| `core/game_bridge.py` | Puente de alto nivel para invocar acciones del juego vía DOM y eventos JS. |
| `core/user_activity_monitor.py` | Monitor de interferencia humana para pausar el bot al usar la pestaña. |
| `core/input_controller.py` | Controlador unificado que conmuta entre BiDi y PyAutoGUI. |
| `tasks/anti_idle_task.py` | Monitor 24/7 anti-inactividad inteligente. |
| `tasks/gym_task.py` | Entrenamiento en el Gimnasio basado en energía y límites diarios. |
| `tasks/casino_tasks.py` | Ruleta diaria y minijuego Mayor o Menor con probabilidad óptima. |
| `tasks/district_tasks.py` | Automatización de distritos y recolección de barrio según timers. |
| `tasks/utility_tasks.py` | Fabricación en Laboratorio de Cristal, Más Vida y Recolector de Piedras. |
| `run.sh` | Lanzador del bot con auto-detección de entorno virtual. |
| `tests/test_bidi.py` | Suite de pruebas unitarias para BiDi, Game Bridge y tareas en segundo plano. |
