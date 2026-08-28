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

def log_msg(tag, status, message):
    """Función auxiliar para imprimir logs ordenados y con marcas de tiempo"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    emoji = {
        "espera": "⏳",
        "ejecutando": "⚡",
        "completado": "✅"
    }.get(status, "ℹ️")
    print(f"{emoji} [{timestamp}] [{tag}] {message}")

def bucle_gym():
    """Bucle GYM: Realizar la tarea de entrenamiento del gimnasio 10 veces, cada 30 minutos (1800 segundos)"""
    for iteration in range(1, 11):
        log_msg("GYM", "espera", f"Esperando turno para realizar tarea del GYM (Iteración {iteration} de 10)...")
        with action_lock:
            # Pausa de cortesía para que la interfaz se estabilice
            time.sleep(1.5)
            log_msg("GYM", "ejecutando", f"Realizando tarea del GYM (Iteración {iteration} de 10)...")
            
            # Boton Gimnasio
            pg.doubleClick(x=470, y=975)
            time.sleep(1)
            
            # Boton de Entrenar
            pg.click(x=841, y=732)
            time.sleep(1)
            
            # Desplazamiento al ejercicio mas completo
            pg.click(x=1173, y=540)
            time.sleep(1)
            pg.click(x=1173, y=540)
            time.sleep(1)
            pg.click(x=1173, y=540)
            time.sleep(1)
            pg.click(x=1173, y=540)
            time.sleep(1)
            
            # Boton de ejercicio 4 opcion
            pg.click(x=849, y=748)
            time.sleep(1)
            
            # Volver a la pantalla principal
            pg.press('escape')
            pg.press('escape')
            time.sleep(0.5)
            pg.press('escape')
            log_msg("GYM", "completado", f"Tarea del GYM (Iteración {iteration} de 10) completada. Iniciando espera de 30 minutos.")
        
        # El tiempo de espera al final en el gym (excepto tras la última iteración)
        if iteration < 10:
            time.sleep(1800)
            
    log_msg("GYM", "completado", "Bucle de GYM finalizado tras completar 10 veces.")

def bucle_no_temporizadores_ruleta():
    """Bucle Ruleta: Sin temporizador de juego - Ejecución cada 30 minutos (1813 segundos)"""
    while True:
        log_msg("Ruleta", "espera", "Esperando turno para hacer click (espera al inicio de 30 minutos / 1813s)...")
        # El tiempo de espera (sleep) al inicio, no al final
        time.sleep(1813)
        
        with action_lock:
            # Pausa de cortesía para que la interfaz del juego se estabilice
            time.sleep(1.5)
            log_msg("Ruleta", "ejecutando", "Ejecutando secuencia de clicks...")
            
            # Icono ruleta
            pg.doubleClick(x=880, y=973)
            time.sleep(1)
            
            # Opcion de juego ruleta: aleatoria en eje X (552 a 684), Y=468
            random_x_opcion = random.randint(552, 684)
            pg.doubleClick(x=random_x_opcion, y=468)
            time.sleep(1)
            
            # Boton Spin: aleatoria en eje X (554 a 699), Y=685
            random_x_spin = random.randint(554, 699)
            pg.doubleClick(x=random_x_spin, y=685)
            time.sleep(10)
            
            # Tiempo de animacion 10 segundos
            time.sleep(10)
            
            # Cerrar ruleta
            time.sleep(0.5)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            log_msg("Ruleta", "completado", "Secuencia completada.")

if __name__ == "__main__":
    # Crear la lista de hilos activos
    hilos = [
        threading.Thread(target=bucle_gym, daemon=True),
        threading.Thread(target=bucle_no_temporizadores_ruleta, daemon=True)
    ]
    
    print(f"Iniciando ejecutor de GYM y Ruleta concurrentes con {len(hilos)} hilos...")
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