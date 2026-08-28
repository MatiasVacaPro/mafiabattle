import pyautogui as pg
import time
import threading
import sys
import random
from datetime import datetime
import signal
import os

def signal_handler(sig, frame):
    print("\n🛑 Programa detenido inmediatamente por el usuario (Ctrl+C).")
    os._exit(0)

signal.signal(signal.SIGINT, signal_handler)


# =====================================================================
# CONFIGURACIÓN: Cambia a True/False para activar o desactivar tareas
# =====================================================================
ACTIVO_CELEBRITIES    = True   # Celebrities District (cada 6 minutos)
ACTIVO_RULETA         = True   # Ruleta (cada 30 minutos)
ACTIVO_FABRICACION    = True   # Hilo de fabricación larga (Cristal → XTC)

# =====================================================================

pg.FAILSAFE = True

# Lock global: solo un hilo controla mouse/teclado a la vez
action_lock = threading.Lock()

celebrities_index = 0
celebrities_options = [(883, 415), (882, 479), (889, 562)]


# =====================================================================
# UTILIDADES
# =====================================================================

def log_msg(tag, status, message):
    """Imprime logs ordenados con marca de tiempo"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    emoji = {
        "espera":     "⏳",
        "ejecutando": "⚡",
        "completado": "✅"
    }.get(status, "ℹ️")
    print(f"{emoji} [{timestamp}] [{tag}] {message}")


# =====================================================================
# ACCIÓN RECURRENTE — Celebrities District (cada 6 minutos)
# =====================================================================

def _accion_celebrities():
    """Una iteración de Celebrities District"""
    global celebrities_index
    log_msg("Celebrities District", "espera", "Esperando turno para hacer click...")
    with action_lock:
        time.sleep(1.5)
        log_msg("Celebrities District", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        time.sleep(1)
        pg.doubleClick(x=735, y=311)
        time.sleep(1)

        # Click aleatorio en eje X (979 a 1174), Y siempre es 547
        random_x = random.randint(979, 1174)
        pg.doubleClick(x=random_x, y=547)
        time.sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = celebrities_options[celebrities_index % len(celebrities_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        celebrities_index += 1
        time.sleep(1)

        time.sleep(0.5)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Celebrities District", "completado", "Secuencia completada. Próxima en 6 minutos.")


def hilo_celebrities():
    """Hilo perpetuo: ejecuta Celebrities District cada 6 minutos"""
    while True:
        _accion_celebrities()
        time.sleep(360)


# =====================================================================
# ACCIÓN RECURRENTE — Ruleta (cada 30 minutos)
# =====================================================================

def hilo_ruleta():
    """Hilo perpetuo: ejecuta la Ruleta cada 30 minutos (1813 segundos)"""
    while True:
        log_msg("Ruleta", "espera", "Iniciando espera de 30 minutos antes de ejecutar...")
        time.sleep(1813)
        log_msg("Ruleta", "espera", "Esperando turno para hacer click...")
        with action_lock:
            time.sleep(1.5)
            log_msg("Ruleta", "ejecutando", "Ejecutando secuencia de clicks...")

            # Icono ruleta
            pg.doubleClick(x=880, y=973)
            time.sleep(1)

            # Opción aleatoria en eje X (552–684), Y=468
            random_x_opcion = random.randint(552, 684)
            pg.doubleClick(x=random_x_opcion, y=468)
            time.sleep(1)

            # Botón Spin: aleatorio en X (554–699), Y=685
            random_x_spin = random.randint(554, 699)
            pg.doubleClick(x=random_x_spin, y=685)
            time.sleep(10)

            # Tiempo de animación
            time.sleep(10)

            # Cerrar ruleta
            time.sleep(0.5)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            log_msg("Ruleta", "completado", "Secuencia completada. Próxima en 30 minutos.")


# =====================================================================
# HILO DE FABRICACIÓN LARGA — Cristal (3 h) → XTC (7 h)
# Los time.sleep largos NO bloquean los hilos recurrentes de arriba.
# =====================================================================

def hilo_fabricacion():
    """
    Hilo secuencial de fabricación prolongada.
    Orden del ciclo:
      1. Espera 7 h (cooldown XTC) → ir a Ciudad Oscura + comprar boleto
         (el cooldown de viaje de 30 min empieza en el momento del click)
      2. Fabricar XTC inmediatamente (sin espera adicional
      3. Esperar 30 min (cooldown de viaje ya corre desde el paso 1)
         → Volver a Ciudad Principal
      4. Espera 3 h (cooldown Cristal) → Fabricar Cristal
    Se repite indefinidamente.
    """
    while True:
        # ── 1. Esperar 7 horas (cooldown XTC) ─────────────────────────
        log_msg("Fabricación", "espera", "Esperando 7 horas para XTC (25200 s)...")
        time.sleep(25200)

        # ── 2. Ir a Ciudad Oscura + comprar boleto ─────────────────────
        # El cooldown de viaje de 30 min empieza AHORA con este click.
        log_msg("Fabricación", "ejecutando", "Yendo a Ciudad Oscura y comprando boleto (inicia cooldown 30 min)...")
        with action_lock:
            time.sleep(1.5)
            # Moverte a la ciudad oscura
            pg.doubleClick(x=947, y=890)
            time.sleep(1)
            # Comprar boleto
            pg.doubleClick(x=845, y=752)
            time.sleep(1)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            # Esperar carga del juego tras el viaje
            time.sleep(20)
        log_msg("Fabricación", "completado", "Boleto comprado. Fabricando XTC inmediatamente...")

        # ── 3. Fabricar XTC (sin espera, el cooldown de viaje ya corre) ─
        log_msg("Fabricación", "ejecutando", "Iniciando fabricación de XTC...")
        with action_lock:
            time.sleep(1.5)
            # Hacer click fábrica XTC
            pg.doubleClick(x=584, y=707)
            time.sleep(1)
            # Click en fabricar
            pg.click(x=918, y=742)
            time.sleep(1)
            # Comprar recursos
            pg.click(x=848, y=750)
            time.sleep(1)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
        log_msg("Fabricación", "completado", "XTC iniciado. Esperando 30 min de cooldown de viaje...")

        # ── 4. Esperar 30 min (cooldown de viaje que inició en paso 2) ──
        # Durante esta espera los hilos recurrentes siguen corriendo.
        time.sleep(1800)

        log_msg("Fabricación", "ejecutando", "Volviendo a Ciudad Principal...")
        with action_lock:
            time.sleep(1.5)
            # Ir a la ciudad principal
            pg.doubleClick(x=923, y=909)
            time.sleep(1)
            # Comprar boleto
            pg.doubleClick(x=845, y=752)
            time.sleep(1)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            # Esperar carga del juego tras el viaje
            time.sleep(20)
        log_msg("Fabricación", "completado", "En Ciudad Principal. Iniciando espera de 3 h para Cristal...")

        # ── 5. Esperar 3 horas (cooldown Cristal) ─────────────────────
        log_msg("Fabricación", "espera", "Esperando 3 horas para fabricar Cristal (10800 s)...")
        time.sleep(10800)

        log_msg("Fabricación", "ejecutando", "Iniciando fabricación de Cristal...")
        with action_lock:
            time.sleep(1.5)
            # Fábrica de cristal
            pg.doubleClick(x=612, y=609)
            time.sleep(1)
            # Click en Lab
            pg.click(x=841, y=729)
            time.sleep(1)
            # Comenzar a cocinar
            pg.click(x=836, y=744)
            time.sleep(1)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
        log_msg("Fabricación", "completado", "Cristal iniciado. Ciclo completo. Reiniciando con XTC...")

        # Pequeña pausa antes de reiniciar
        time.sleep(20)


# =====================================================================
# PUNTO DE ENTRADA
# =====================================================================

if __name__ == "__main__":
    hilos = []

    if ACTIVO_CELEBRITIES:
        hilos.append(threading.Thread(target=hilo_celebrities, name="Celebrities", daemon=True))

    if ACTIVO_RULETA:
        hilos.append(threading.Thread(target=hilo_ruleta, name="Ruleta", daemon=True))

    if ACTIVO_FABRICACION:
        hilos.append(threading.Thread(target=hilo_fabricacion, name="Fabricacion", daemon=True))

    print(f"🚀 Iniciando Fabricacion.py con {len(hilos)} hilos concurrentes...")
    print("   • Recurrentes : Celebrities District cada 6 min | Ruleta cada 30 min")
    print("   • Larga        : XTC (7 h) → Ciudad Oscura → XTC clicks → espera 30 min → Ciudad Principal → Cristal (3 h)")
    print("NOTA: Ctrl+C para detener. PyAutoGUI failsafe activo (esquina de pantalla).")
    print("Esperando 1 segundo antes de arrancar...")
    time.sleep(1)

    for t in hilos:
        t.start()

    # Hilo principal activo para recibir Ctrl+C
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Programa detenido por el usuario (Ctrl+C).")
        sys.exit(0)
