import pyautogui as pg
import time
import threading
import sys
import random
from datetime import datetime

# =====================================================================
# CONFIGURACIÓN DE TAREAS: Cambia a True para activar, False para desactivar
# =====================================================================
ACTIVO_TEMPORIZADOR_1     = False   # Celebrities District (Ejecución cada 6 minutos)
ACTIVO_TEMPORIZADOR_2     = False   # Shopping Street (Ejecución cada 6 minutos)
ACTIVO_TEMPORIZADOR_3     = False   # Jardin Clasico (Ejecución cada 10 minutos)
ACTIVO_TEMPORIZADOR_4     = True   # Mafiosi District (Ejecución cada 8 minutos)
ACTIVO_TEMPORIZADOR_6     = False   # Residential Area (Ejecución cada 8 minutos)
ACTIVO_TEMPORIZADOR_7     = True   # Billonari Club (Ejecución cada 8 minutos)
ACTIVO_FABRICACION_CRISTAL = False  # Fabricación de Cristal - Con temporizador (Ejecución cada 3 horas / cooldown)
ACTIVO_RULETA             = True   # Ruleta - Sin temporizador (Ejecución cada 30 minutos)
ACTIVO_MAS_VIDA           = True   # Más vida - Sin temporizador (Ejecución cada 3 horas y 7 segundos)
ACTIVO_RECOLECTOR_PIEDRAS = False  # Recolector de piedras preciosas - Sin temporizador (Ejecución cada 3 horas)
ACTIVO_ANTI_INACTIVIDAD   = True   # Evitar cierre por inactividad - Doble click en (676, 531) cada 6 minutos


# ---- Configuración del módulo GYM ----
ACTIVO_GYM                 = False
MAX_GYM_LOOPS              = 10
ASIGNAR_GYM_A              = "bucle_temporizador_7"  # Puede cambiarse por "bucle_temporizador_2", "bucle_temporizador_3", etc.
DESPLAZAR_GYM_SOLO_UNA_VEZ = True                    # True: desplaza solo la primera vez en la sesión; False: desplaza siempre
INTERVALO_GYM              = 300                     # Cooldown del gimnasio en segundos (300 = 5 minutos)
# =====================================================================

# Habilitar el fail-safe de PyAutoGUI: si mueves el cursor a cualquier esquina de la pantalla, el programa se detendrá.
pg.FAILSAFE = True

# Lock (bloqueo) para asegurar que solo un hilo controle el mouse/teclado a la vez
action_lock = threading.Lock()

# Índices para el ordenamiento secuencial de las opciones de clicks
celebrities_index = 0
shopping_index    = 0
jardin_index      = 0
mafiosi_index     = 0
residential_index = 0
billonari_club_index = 0

# Opciones secuenciales para cada caso
celebrities_options = [(882, 479), (889, 562)]
shopping_options    = [(878, 475), (878, 475)]
jardin_options      = [(881, 396), (889, 481), (885, 561)]
mafiosi_options     = [(881, 396), (889, 481), (885, 561)]
residential_options = [(893, 724), (892, 642), (881, 556), (878, 475), (895, 396)]
billonari_club_options = [(881, 396), (889, 481), (885, 561)]


# =====================================================================
# UTILIDADES
# =====================================================================

def log_msg(tag, status, message):
    """Función auxiliar para imprimir logs ordenados y con marcas de tiempo"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    emoji = {
        "espera":     "⏳",
        "ejecutando": "⚡",
        "completado": "✅"
    }.get(status, "ℹ️")
    print(f"{emoji} [{timestamp}] [{tag}] {message}")


# =====================================================================
# TAREA MAESTRA GYM (función aislada, sin bucle propio)
# =====================================================================

# Variable de estado global para rastrear si ya se posicionó el GYM
gym_desplazamiento_realizado = False


def ejecutar_clicks_gym():
    """Ejecuta una única iteración de la secuencia de clicks del Gimnasio."""
    global gym_desplazamiento_realizado
    with action_lock:
        time.sleep(1.5)
        log_msg("GYM", "ejecutando", "Ejecutando secuencia de clicks del GYM...")

        # Botón Gimnasio
        pg.doubleClick(x=470, y=975)
        time.sleep(1)

        # Botón de Entrenar
        pg.click(x=841, y=732)
        time.sleep(1)

        # Desplazamiento al ejercicio más eficiente
        debe_desplazar = True
        if DESPLAZAR_GYM_SOLO_UNA_VEZ:
            if gym_desplazamiento_realizado:
                debe_desplazar = False
                log_msg("GYM", "ejecutando", "Omitiendo desplazamiento del GYM (ya fue posicionado en esta sesión).")
            else:
                log_msg("GYM", "ejecutando", "Realizando desplazamiento inicial del GYM...")

        if debe_desplazar:
            pg.click(x=1173, y=540)
            time.sleep(1)
            pg.click(x=1173, y=540)
            time.sleep(1)
            pg.click(x=1173, y=540)
            time.sleep(1)
            gym_desplazamiento_realizado = True

        # Botón de ejercicio 3 (opción)
        pg.click(x=849, y=748)
        time.sleep(1)

        # Volver a la pantalla principal
        pg.press('escape')
        pg.press('escape')
        time.sleep(0.5)
        pg.press('escape')

        log_msg("GYM", "completado", "Iteración del GYM completada.")


# =====================================================================
# INYECTOR DINÁMICO (Wrapper / Orquestador)
# =====================================================================

def bucle_orquestador(funcion_original, intervalo_original, nombre_tag):
    """
    Orquestador genérico que inyecta opcionalmente la tarea GYM antes de
    pasar a la ejecución perpetua de funcion_original.

    Fase 1 (opcional): si ACTIVO_GYM y el nombre de función coincide con
                        ASIGNAR_GYM_A, ejecuta MAX_GYM_LOOPS iteraciones
                        del GYM separadas por INTERVALO_GYM (sin dormir tras la última).
    Fase 2 (perpetua): bucle while True que llama a funcion_original() y
                        duerme intervalo_original segundos.
    """
    nombre_funcion = funcion_original.__name__

    # ── Fase 1: GYM ────────────────────────────────────────────────────
    if ACTIVO_GYM and nombre_funcion == ASIGNAR_GYM_A:
        log_msg("GYM", "espera", f"Iniciando fase GYM en hilo '{nombre_tag}' ({MAX_GYM_LOOPS} iteraciones)...")
        for iteration in range(1, MAX_GYM_LOOPS + 1):
            log_msg("GYM", "espera", f"Esperando turno para realizar tarea del GYM (Iteración {iteration} de {MAX_GYM_LOOPS})...")
            ejecutar_clicks_gym()
            log_msg("GYM", "completado", f"Iteración {iteration} de {MAX_GYM_LOOPS} completada.")
            # No dormir tras la última iteración; pasar directo a la Fase 2
            if iteration < MAX_GYM_LOOPS:
                time.sleep(INTERVALO_GYM)
        log_msg("GYM", "completado", f"Fase GYM finalizada. Pasando a ejecución perpetua de '{nombre_tag}'.")

    # ── Fase 2: bucle perpetuo ──────────────────────────────────────────
    while True:
        funcion_original()
        time.sleep(intervalo_original)


# =====================================================================
# TEMPORIZADORES (una sola ejecución por llamada — el bucle lo gestiona
# el orquestador)
# =====================================================================

def bucle_temporizador_1():
    """Temporizador 1: Celebrities District — una iteración por llamada"""
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

        time.sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Celebrities District", "completado", "Secuencia completada. Iniciando espera de 6 minutos.")


def bucle_temporizador_2():
    """Temporizador 2: Shopping Street — una iteración por llamada"""
    global shopping_index
    log_msg("Shopping Street", "espera", "Esperando turno para hacer click...")
    with action_lock:
        time.sleep(1.5)
        log_msg("Shopping Street", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        time.sleep(1)

        # Click aleatorio en eje X, Y siempre es 770
        random_x = random.randint(500, 698)
        pg.doubleClick(x=random_x, y=770)
        time.sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = shopping_options[shopping_index % len(shopping_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        shopping_index += 1
        time.sleep(1)

        time.sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Shopping Street", "completado", "Secuencia completada. Iniciando espera de 6 minutos.")


def bucle_temporizador_3():
    """Temporizador 3: Jardin clasico — una iteración por llamada"""
    global jardin_index
    log_msg("Jardin clasico", "espera", "Esperando turno para hacer click...")
    with action_lock:
        time.sleep(1.5)
        log_msg("Jardin clasico", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        time.sleep(1)
        pg.doubleClick(x=735, y=311)
        time.sleep(1)

        # Click aleatorio en eje X, Y siempre es 770
        random_x = random.randint(738, 934)
        pg.doubleClick(x=random_x, y=770)
        time.sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = jardin_options[jardin_index % len(jardin_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        jardin_index += 1
        time.sleep(1)

        time.sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Jardin clasico", "completado", "Secuencia completada. Iniciando espera de 10 minutos.")


def bucle_temporizador_4():
    """Temporizador 4: Mafiosi District — una iteración por llamada"""
    global mafiosi_index
    log_msg("Mafiosi District", "espera", "Esperando turno para hacer click...")
    with action_lock:
        time.sleep(1.5)
        log_msg("Mafiosi District", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        time.sleep(1)
        pg.doubleClick(x=735, y=311)
        time.sleep(1)

        # Click aleatorio en eje X, Y siempre es 778
        random_x = random.randint(984, 1059)
        pg.doubleClick(x=random_x, y=775)
        time.sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = mafiosi_options[mafiosi_index % len(mafiosi_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        mafiosi_index += 1
        time.sleep(1)

        time.sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Mafiosi District", "completado", "Secuencia completada. Iniciando espera de 8 minutos.")


def bucle_temporizador_6():
    """Temporizador 6: Residential Area — una iteración por llamada"""
    global residential_index
    log_msg("Residential Area", "espera", "Esperando turno para hacer click...")
    with action_lock:
        time.sleep(1.5)
        log_msg("Residential Area", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        time.sleep(1)

        # Click aleatorio en eje X, Y siempre es 775
        random_x = random.randint(739, 882)
        pg.doubleClick(x=random_x, y=775)
        time.sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = residential_options[residential_index % len(residential_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        residential_index += 1
        time.sleep(1)

        time.sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Residential Area", "completado", "Secuencia completada. Iniciando espera de 8 minutos.")


def bucle_temporizador_7():
    """Temporizador 7: Billonari Club — una iteración por llamada"""
    global billonari_club_index
    log_msg("Billonari Club", "espera", "Esperando turno para hacer click...")
    with action_lock:
        time.sleep(1.5)
        log_msg("Billonari Club", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        time.sleep(1)
        pg.doubleClick(x=739, y=309)
        time.sleep(1)

        # Click aleatorio en eje X, Y siempre es 775
        random_x = random.randint(502, 684)
        pg.doubleClick(x=random_x, y=772)
        time.sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = billonari_club_options[billonari_club_index % len(billonari_club_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        billonari_club_index += 1
        time.sleep(1)

        time.sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Billonari Club", "completado", "Secuencia completada. Iniciando espera de 8 minutos.")


# =====================================================================
# TAREAS SIN TEMPORIZADOR (mantienen su propio bucle interno ya que no
# necesitan inyección de GYM ni son candidatas al orquestador)
# =====================================================================

def bucle_no_temporizadores_ruleta():
    """Bucle Ruleta: Sin temporizador de juego — Ejecución cada 30 minutos (1813 segundos)"""
    while True:
        log_msg("Ruleta", "espera", "Iniciando espera de 30 minutos (1813s) antes de ejecutar...")
        time.sleep(1813)
        log_msg("Ruleta", "espera", "Esperando turno para hacer click...")
        with action_lock:
            time.sleep(1.5)
            log_msg("Ruleta", "ejecutando", "Ejecutando secuencia de clicks...")

            # Icono ruleta
            pg.doubleClick(x=880, y=973)
            time.sleep(1)

            # Opción de juego ruleta: aleatoria en eje X (552 a 684), Y=468
            random_x_opcion = random.randint(552, 684)
            pg.doubleClick(x=random_x_opcion, y=468)
            time.sleep(1)

            # Botón Spin: aleatoria en eje X (554 a 699), Y=685
            random_x_spin = random.randint(554, 699)
            pg.doubleClick(x=random_x_spin, y=685)
            time.sleep(10)

            # Tiempo de animación 10 segundos
            time.sleep(10)

            # Cerrar ruleta
            time.sleep(0.5)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            log_msg("Ruleta", "completado", "Secuencia completada.")


def bucle_mas_vida():
    """Bucle Más Vida: Le da más vida al personaje — Ejecución cada 3 horas y 7 segundos (10807s)"""
    while True:
        log_msg("Más Vida", "espera", "Iniciando espera de 3 horas y 7 segundos antes de ejecutar...")
        time.sleep(10807)
        log_msg("Más Vida", "espera", "Esperando turno...")
        with action_lock:
            time.sleep(1.5)
            log_msg("Más Vida", "ejecutando", "Ejecutando secuencia de clicks para más vida...")

            # Click en icono de más vida
            pg.doubleClick(x=893, y=103)
            time.sleep(1)

            # 8 clicks para sumar vida
            for _ in range(8):
                pg.click(x=1078, y=554)
                time.sleep(1)

            time.sleep(0.5)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            log_msg("Más Vida", "completado", "Secuencia completada.")


def bucle_recolector_piedras():
    """Bucle Recolector de piedras preciosas — Ejecución cada 3 horas (10800 segundos)"""
    while True:
        log_msg("Recolector Piedras", "espera", "Iniciando espera de 3 horas antes de ejecutar...")
        time.sleep(10800)
        log_msg("Recolector Piedras", "espera", "Esperando turno...")
        with action_lock:
            time.sleep(1.5)
            log_msg("Recolector Piedras", "ejecutando", "Ejecutando secuencia para recolectar piedras preciosas...")

            # Click en el icono piedras
            pg.doubleClick(x=418, y=722)
            time.sleep(1)

            # Recolección de piedra
            pg.click(x=739, y=575)
            time.sleep(1)

            # Regresar a pantalla principal
            pg.press('escape')
            pg.press('escape')
            log_msg("Recolector Piedras", "completado", "Secuencia completada.")


def bucle_anti_inactividad():
    """Bucle Anti-Inactividad: Evita el cierre del juego por inactividad.
    Realiza un doble click en (676, 531) cada 6 minutos."""
    while True:
        log_msg("Anti-Inactividad", "espera", "Iniciando espera de 6 minutos (360s)...")
        time.sleep(360)
        log_msg("Anti-Inactividad", "espera", "Esperando turno...")
        with action_lock:
            time.sleep(1.5)
            log_msg("Anti-Inactividad", "ejecutando", "Asegurando menú inicial y ejecutando click anti-inactividad...")
            pg.press('escape')
            pg.press('escape')
            time.sleep(0.5)
            pg.press('escape')
            time.sleep(0.5)
            pg.doubleClick(x=676, y=531)
            time.sleep(1)
            log_msg("Anti-Inactividad", "completado", "Click anti-inactividad completado.")


def bucle_fabricacion_cristal():
    """Temporizador Fabricación de Cristal — una iteración por llamada (intervalo: 10800 s)"""
    log_msg("Fabricación", "espera", "Esperando turno para fabricar Cristal...")
    time.sleep(10800)
    with action_lock:
        time.sleep(1.5)
        log_msg("Fabricación", "ejecutando", "Iniciando fabricación de Cristal...")
        # Fábrica de cristal
        pg.press('escape')
        pg.doubleClick(x=545, y=673)
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
    log_msg("Fabricación", "completado", "Cristal iniciado. Iniciando espera de 3 horas.")


# =====================================================================
# MAPA: nombre de función → (función, intervalo en segundos, nombre_tag)
# =====================================================================
_TEMPORIZADORES = {
    "bucle_temporizador_1":         (bucle_temporizador_1,        360,   "Celebrities District"),
    "bucle_temporizador_2":         (bucle_temporizador_2,        360,   "Shopping Street"),
    "bucle_temporizador_3":         (bucle_temporizador_3,        600,   "Jardin clasico"),
    "bucle_temporizador_4":         (bucle_temporizador_4,        480,   "Mafiosi District"),
    "bucle_temporizador_6":         (bucle_temporizador_6,        480,   "Residential Area"),
    "bucle_temporizador_7":         (bucle_temporizador_7,        480,   "Billonari Club"),
    "bucle_fabricacion_cristal":    (bucle_fabricacion_cristal,   0,     "Fabricación Cristal"),
}


# =====================================================================
# PUNTO DE ENTRADA
# =====================================================================

if __name__ == "__main__":
    hilos = []

    # ── Temporizadores gestionados por el orquestador ──────────────────
    flags_temporizadores = {
        "bucle_temporizador_1":      ACTIVO_TEMPORIZADOR_1,
        "bucle_temporizador_2":      ACTIVO_TEMPORIZADOR_2,
        "bucle_temporizador_3":      ACTIVO_TEMPORIZADOR_3,
        "bucle_temporizador_4":      ACTIVO_TEMPORIZADOR_4,
        "bucle_temporizador_6":      ACTIVO_TEMPORIZADOR_6,
        "bucle_temporizador_7":      ACTIVO_TEMPORIZADOR_7,
        "bucle_fabricacion_cristal": ACTIVO_FABRICACION_CRISTAL,
    }

    for nombre, activo in flags_temporizadores.items():
        if activo:
            funcion, intervalo, tag = _TEMPORIZADORES[nombre]
            hilos.append(
                threading.Thread(
                    target=bucle_orquestador,
                    args=(funcion, intervalo, tag),
                    daemon=True
                )
            )

    # ── Tareas sin temporizador (bucle propio, no pasan por orquestador) ─
    if ACTIVO_RULETA:
        hilos.append(threading.Thread(target=bucle_no_temporizadores_ruleta, daemon=True))
    if ACTIVO_MAS_VIDA:
        hilos.append(threading.Thread(target=bucle_mas_vida, daemon=True))
    if ACTIVO_RECOLECTOR_PIEDRAS:
        hilos.append(threading.Thread(target=bucle_recolector_piedras, daemon=True))
    if ACTIVO_ANTI_INACTIVIDAD:
        hilos.append(threading.Thread(target=bucle_anti_inactividad, daemon=True))


    print(f"Iniciando autoclicker con {len(hilos)} hilos concurrentes...")
    print("NOTA: Para detener el programa, presiona Ctrl+C en la terminal o mueve el mouse rápidamente a cualquier esquina de la pantalla.")
    print("Esperando 1 segundo antes de arrancar...")
    time.sleep(1)

    for t in hilos:
        t.start()

    # Mantener el hilo principal activo para poder recibir KeyboardInterrupt (Ctrl+C)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nPrograma detenido por el usuario.")
        sys.exit(0)
