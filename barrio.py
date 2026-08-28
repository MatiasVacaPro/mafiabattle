import pyautogui as pg
import time
import threading
import random
import sys
from datetime import datetime
import signal
import os

def signal_handler(sig, frame):
    print("\n🛑 Programa detenido inmediatamente por el usuario (Ctrl+C).")
    os._exit(0)

signal.signal(signal.SIGINT, signal_handler)


# Habilitar el fail-safe de PyAutoGUI
pg.FAILSAFE = True

# Lock (bloqueo) para asegurar que solo un hilo controle el mouse/teclado a la vez
action_lock = threading.Lock()

# Índices y opciones para el ordenamiento secuencial de los clicks
residential_index = 0
residential_options = [(893, 724), (892, 642), (881, 556), (878, 475), (895, 396)]

def log_msg(tag, status, message):
    """Función auxiliar para imprimir logs ordenados y con marcas de tiempo"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    emoji = {
        "espera": "⏳",
        "ejecutando": "⚡",
        "completado": "✅"
    }.get(status, "ℹ️")
    print(f"{emoji} [{timestamp}] [{tag}] {message}")

def bucle_barrio():
    """Bucle Barrio / Residential Area: Ejecución cada 8 minutos (480 segundos)"""
    global residential_index
    while True:
        log_msg("Residential Area", "espera", "Esperando turno para hacer click...")
        with action_lock:
            # Pausa de cortesía para que la interfaz se estabilice
            time.sleep(1.5)
            log_msg("Residential Area", "ejecutando", "Ejecutando secuencia de clicks...")
            pg.doubleClick(x=740, y=967)
            time.sleep(1)

            # Click aleatorio en eje X, Y siempre es 554
            random_x = random.randint(502, 696)
            pg.doubleClick(x=random_x, y=554)
            time.sleep(1)

            # Click secuencial ordenado
            opt_x, opt_y = residential_options[residential_index % len(residential_options)]
            pg.doubleClick(x=opt_x, y=opt_y)
            residential_index += 1
            time.sleep(1)

            time.sleep(0.5)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            log_msg("Residential Area", "completado", "Secuencia completada. Iniciando espera de 1 minutos.")
        
        # Dormimos fuera del lock
        time.sleep(60)

if __name__ == "__main__":
    hilos = [
        threading.Thread(target=bucle_barrio, daemon=True)
    ]
    
    print(f"Iniciando autoclicker Barrio con {len(hilos)} hilos...")
    print("NOTA: Para detener el programa, presiona Ctrl+C en la terminal o mueve el mouse a cualquier esquina.")
    time.sleep(1)
    
    for t in hilos:
        t.start()
        
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nPrograma detenido por el usuario.")
        sys.exit(0)
