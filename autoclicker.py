import pyautogui as pg
import time
import threading
import sys
import random
import re
import os
import io
from datetime import datetime, timedelta

# Apple Vision / PyTesseract para OCR en minijuegos
try:
    import Foundation
    import Vision
    VISION_DISPONIBLE = True
except ImportError:
    VISION_DISPONIBLE = False

try:
    import pytesseract
    TESSERACT_DISPONIBLE = True
except ImportError:
    TESSERACT_DISPONIBLE = False

# =====================================================================
# CONFIGURACIÓN DE TAREAS: Cambia a True para activar, False para desactivar
# =====================================================================
ACTIVO_TEMPORIZADOR_1     = False   # Celebrities District (Ejecución cada 6 minutos)
ACTIVO_TEMPORIZADOR_2     = False   # Shopping Street (Ejecución cada 6 minutos)
ACTIVO_TEMPORIZADOR_3     = False   # Jardin Clasico (Ejecución cada 10 minutos)
ACTIVO_TEMPORIZADOR_4     = True   # Mafiosi District (Ejecución cada 8 minutos)
ACTIVO_TEMPORIZADOR_6     = True   # Residential Area (Ejecución cada 8 minutos)
ACTIVO_TEMPORIZADOR_7     = True   # Billonari Club (Ejecución cada 8 minutos)
ACTIVO_FABRICACION_CRISTAL = False  # Fabricación de Cristal - Con temporizador (Ejecución cada 2 horas / cooldown)
ACTIVO_RULETA             = True   # Ruleta - Sin temporizador (Ejecución cada 30 minutos)
ACTIVO_MAYOR_MENOR        = True   # Mayor o Menor (Higher/Lower) - Sin temporizador (Ejecución cada 30 minutos)
ACTIVO_MAS_VIDA           = True   # Más vida - Sin temporizador (Ejecución dinámica según temporizadores activos)
ACTIVO_RECOLECTOR_PIEDRAS = True  # Recolector de piedras preciosas - Sin temporizador (Ejecución cada 3 horas)
ACTIVO_ANTI_INACTIVIDAD   = True   # Auto-Reload OCR Vision - Detección a ~1 FPS y pulsación de RELOAD inmediata


# ---- Configuración del módulo GYM ----s
ACTIVO_GYM                 = True
MAX_GYM_LOOPS              = 10
ASIGNAR_GYM_A              = "bucle_temporizador_7"  # Puede cambiarse por "bucle_temporizador_2", "bucle_temporizador_3", etc.
DESPLAZAR_GYM_SOLO_UNA_VEZ = True                    # True: desplaza solo la primera vez en la sesión; False: desplaza siempre
INTERVALO_GYM              = 300                     # Cooldown del gimnasio en segundos (300 = 5 minutos)
# ---- Configuración de Retrasos Individuales de Inicio ----
ACTIVO_RETRASOS            = False       # True: habilita los retrasos de inicio programados; False: arranca todo de inmediato.
# Permite definir una espera antes de que cada tarea empiece a ejecutarse.
# Ejemplos de valores: "3h", "45m", "17:30" (hora exacta) o "" (iniciar ya).
# Si un hilo se inicia tras una espera y es el primero en arrancar, ejecutará
# automáticamente la secuencia de login. Si ya hay tareas activas, omitirá el login.


#Con temporizador
RETRASOS_INICIALES = {
    "Celebrities District":  "",            # bucle_temporizador_1
    "Shopping Street":       "",            # bucle_temporizador_2
    "Jardin Clasico":        "",     # bucle_temporizador_3
    "Mafiosi District":      "",            # bucle_temporizador_4
    "Residential Area":      "2h 23m",            # bucle_temporizador_6
    "Billonari Club":        "",            # bucle_temporizador_7
    "Fabricación Cristal":   "48m",            # bucle_fabricacion_cristal

    #Sin temporizador
    "Ruleta":                "",
    "Mayor o Menor":         "",
    "Más Vida":              "",
    "Recolector Piedras":    "",
    "Anti-Inactividad":      "",
}

# Mapa interno: key_config (nombre de función) → nombre amigable en RETRASOS_INICIALES
_NOMBRE_POR_KEY = {
    "bucle_temporizador_1":                 "Celebrities District",
    "bucle_temporizador_2":                 "Shopping Street",
    "bucle_temporizador_3":                 "Jardin Clasico",
    "bucle_temporizador_4":                 "Mafiosi District",
    "bucle_temporizador_6":                 "Residential Area",
    "bucle_temporizador_7":                 "Billonari Club",
    "bucle_fabricacion_cristal":            "Fabricación Cristal",
    "bucle_no_temporizadores_ruleta":       "Ruleta",
    "bucle_no_temporizadores_mayor_menor":  "Mayor o Menor",
    "bucle_mas_vida":                       "Más Vida",
    "bucle_recolector_piedras":             "Recolector Piedras",
    "bucle_anti_inactividad":               "Anti-Inactividad",
}
# =====================================================================


# Habilitar el fail-safe de PyAutoGUI: si mueves el cursor a cualquier esquina de la pantalla, el programa se detendrá.
pg.FAILSAFE = True

# ── Pausa global: presiona 'P' para pausar/reanudar todas las tareas ──
SISTEMA_PAUSADO = False
evento_activo = threading.Event()
evento_activo.set()
_last_toggle_time = 0.0


def toggle_pausa():
    """Alterna el estado de pausa de todas las tareas e hilos."""
    global SISTEMA_PAUSADO, _last_toggle_time
    ahora = time.time()
    if ahora - _last_toggle_time < 0.25:
        return
    _last_toggle_time = ahora
    SISTEMA_PAUSADO = not SISTEMA_PAUSADO
    if SISTEMA_PAUSADO:
        evento_activo.clear()
        print("\n" + "=" * 60, flush=True)
        log_msg("SISTEMA", "ejecutando", "⏸️  PAUSADO — Clicks en espera (Presiona 'P' para reanudar)")
        print("=" * 60 + "\n", flush=True)
    else:
        evento_activo.set()
        print("\n" + "=" * 60, flush=True)
        log_msg("SISTEMA", "ejecutando", "▶️  REANUDADO — Ejecutando tareas activas")
        print("=" * 60 + "\n", flush=True)


def sleep(segundos):
    """
    Espera 'segundos' de forma eficiente y no bloqueante.
    Mantiene la sincronización exacta con los cooldowns reales del juego sin añadir retrasos.
    """
    fin = time.time() + segundos
    while time.time() < fin:
        restante = fin - time.time()
        if restante <= 0:
            break
        time.sleep(min(0.2, restante))


class PausableLock:
    """Lock que espera automáticamente mientras el sistema esté en pausa antes de permitir clicks."""
    def __init__(self):
        self._lock = threading.Lock()

    def __enter__(self):
        while SISTEMA_PAUSADO:
            evento_activo.wait(0.2)
        self._lock.acquire()
        while SISTEMA_PAUSADO:
            self._lock.release()
            evento_activo.wait(0.2)
            self._lock.acquire()
        return self

    def __exit__(self, *args):
        self._lock.release()


# Lock compartido — bloquea si el sistema está pausado
action_lock = PausableLock()

# Índices para el ordenamiento secuencial de las opciones de clicks
celebrities_index = 0
shopping_index    = 0
jardin_index      = 0
mafiosi_index     = 0
residential_index = 0
billonari_club_index = 0

# Opciones secuenciales para cada caso
celebrities_options = [(889, 562)]
shopping_options    = [(878, 475)]
jardin_options      = [(885, 561)]
mafiosi_options     = [(889, 481), (885, 561)]
residential_options = [(893, 724), (892, 642), (881, 556), (878, 475)] # (895, 396), (878, 475), (881, 556)
billonari_club_options = [(889, 481), (885, 561)]


# =====================================================================
# UTILIDADES
# =====================================================================

def log_msg(tag, status, message):
    """Función auxiliar para imprimir logs ordenados y con marcas de tiempo"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    emoji = {
        "espera":     "⏳",
        "ejecutando": "⚡",
        "completado": "✅",
        "error":      "❌"
    }.get(status, "ℹ️")
    print(f"{emoji} [{timestamp}] [{tag}] {message}", flush=True)


def parse_delay(user_input):
    """
    Parsea la entrada del usuario para calcular el retraso en segundos.
    Formatos soportados:
    - Vacío (Enter) -> 0 segundos
    - Duración con unidades (ej: '3h', '45m', '120s', '3.5h')
    - Múltiples unidades combinadas (ej: '3h 30m')
    - Números solos (ej: '3' -> se interpreta como 3 horas)
    - Hora exacta del día (ej: '17:30', '05:00'). Si la hora ya pasó hoy, se programa para mañana.
    """
    user_input = user_input.strip().lower()
    if not user_input:
        return 0

    # Comprobar si es hora exacta del día (HH:MM)
    time_match = re.match(r"^(\d{1,2}):(\d{2})$", user_input)
    if time_match:
        hour = int(time_match.group(1))
        minute = int(time_match.group(2))
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise ValueError("Hora inválida. Debe estar entre 00:00 y 23:59.")
        
        now = datetime.now()
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target < now:
            target += timedelta(days=1)
        return (target - now).total_seconds()

    # Comprobar duración con unidades
    # Si es solo un número sin unidades (ej: '3'), lo asumimos como horas.
    if user_input.isdigit():
        return float(user_input) * 3600

    parts = re.findall(r"(\d+(?:\.\d+)?)\s*([hms]?)", user_input)
    if not parts:
        raise ValueError("Formato de tiempo no reconocido. Ejemplos válidos: 3h, 45m, 17:30")

    total_seconds = 0
    for val_str, unit in parts:
        val = float(val_str)
        if unit == 'h' or unit == '':
            total_seconds += val * 3600
        elif unit == 'm':
            total_seconds += val * 60
        elif unit == 's':
            total_seconds += val

    return total_seconds





def ejecutar_secuencia_login():
    """Ejecuta la secuencia de recarga y login del juego."""
    log_msg("LOGIN", "ejecutando", "Ejecutando secuencia de login post-espera...")
    with action_lock:
        log_msg("LOGIN", "ejecutando", "Recargando página (cmd+r)...")
        pg.hotkey('command', 'r')
        sleep(2)
        
        log_msg("LOGIN", "ejecutando", "Presionando primer Enter...")
        pg.press('enter')
        sleep(5)
        
        log_msg("LOGIN", "ejecutando", "Presionando segundo Enter...")
        pg.press('enter')
        sleep(2)
        
        log_msg("LOGIN", "ejecutando", "Presionando tercer Enter por si acaso...")
        pg.press('enter')
        sleep(1)
        pg.press('escape')
        sleep(1)
        pg.press('escape')
        sleep(1)
        log_msg("LOGIN", "completado", "Secuencia de login finalizada.")


juego_activo = False


def hilo_wrapper(target_func, key_config, is_orquestador, *args):
    """
    Wrapper para todos los hilos que maneja:
    1. Retraso de inicio individual.
    2. Secuencia de login (cmd+r, etc.) condicional.
    3. Ejecución del bucle original.
    """
    global juego_activo
    
    # Obtener el tag para el log
    if is_orquestador:
        tag = args[2]  # El tercer argumento de bucle_orquestador es nombre_tag
    else:
        # Para hilos sin orquestador, mapeamos un tag amigable
        tag_map = {
            "bucle_no_temporizadores_ruleta": "Ruleta",
            "bucle_no_temporizadores_mayor_menor": "Mayor/Menor",
            "bucle_mas_vida": "Más Vida",
            "bucle_recolector_piedras": "Recolector Piedras",
            "bucle_anti_inactividad": "Anti-Inactividad"
        }
        tag = tag_map.get(key_config, key_config)

    # Obtener el retraso para esta tarea usando el nombre amigable
    nombre_amigable = _NOMBRE_POR_KEY.get(key_config, key_config)
    retraso_str = RETRASOS_INICIALES.get(nombre_amigable, "")
    segundos_espera = 0
    if ACTIVO_RETRASOS and retraso_str:
        if isinstance(retraso_str, tuple):
            retraso_str = " ".join(retraso_str)
        try:
            segundos_espera = parse_delay(str(retraso_str))
        except ValueError as e:
            log_msg(tag, "error", f"Error en retraso: {e}")
            
    if segundos_espera > 0:
        now = datetime.now()
        start_time = now + timedelta(seconds=segundos_espera)
        start_time_str = start_time.strftime("%H:%M:%S")
        log_msg(tag, "espera", f"Inicio programado en '{retraso_str}'. Arrancará a las {start_time_str}.")
        
        # Esperar el tiempo correspondiente
        sleep(segundos_espera)
        
        # Al despertar, decidir si hace login
        with action_lock:
            if not juego_activo:
                juego_activo = True
                log_msg(tag, "ejecutando", "Primer hilo en arrancar tras espera. Ejecutando secuencia de login...")
                ejecutar_secuencia_login()
            else:
                log_msg(tag, "ejecutando", "Iniciando tarea. El juego ya está activo, omitiendo login.")
    else:
        # Si inicia inmediatamente, marcamos el juego como activo
        with action_lock:
            juego_activo = True
            log_msg(tag, "ejecutando", "Iniciando de inmediato.")

    # Ejecutar la función original
    if is_orquestador:
        target_func(*args)
    else:
        target_func()


# =====================================================================
# TAREA MAESTRA GYM (función aislada, sin bucle propio)
# =====================================================================

GYM_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gym_last_run.txt")

# Variable de estado global para rastrear si ya se posicionó el GYM
gym_desplazamiento_realizado = False


def obtener_ultimo_gym():
    """Devuelve el timestamp (float) de la última ejecución completa de GYM, o 0 si no existe."""
    if os.path.exists(GYM_STATE_FILE):
        try:
            with open(GYM_STATE_FILE, "r") as f:
                val = f.read().strip()
                return float(val) if val else 0.0
        except Exception:
            return 0.0
    return 0.0


def guardar_ultimo_gym(timestamp=None):
    """Guarda el timestamp actual en el archivo de estado de GYM."""
    if timestamp is None:
        timestamp = time.time()
    try:
        with open(GYM_STATE_FILE, "w") as f:
            f.write(str(timestamp))
    except Exception as e:
        log_msg("GYM", "error", f"Error guardando timestamp de GYM: {e}")


def tiempo_hasta_siguiente_gym():
    """
    Verifica si han transcurrido 24 horas (86400s) desde el último GYM.
    Retorna: (puede_ejecutar: bool, horas_restantes: float)
    """
    ultimo = obtener_ultimo_gym()
    ahora = time.time()
    transcurrido = ahora - ultimo
    SEGUNDOS_24H = 86400  # 24 horas

    if transcurrido >= SEGUNDOS_24H:
        return True, 0.0
    else:
        restante = SEGUNDOS_24H - transcurrido
        return False, restante / 3600.0


def ejecutar_clicks_gym():
    """Ejecuta una única iteración de la secuencia de clicks del Gimnasio."""
    global gym_desplazamiento_realizado
    with action_lock:
        sleep(1.5)
        log_msg("GYM", "ejecutando", "Ejecutando secuencia de clicks del GYM...")

        # Botón Gimnasio
        pg.doubleClick(x=470, y=975)
        sleep(1)

        # Botón de Entrenar
        pg.click(x=841, y=732)
        sleep(1)

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
            sleep(1)
            pg.click(x=1173, y=540)
            sleep(1)
            pg.click(x=1173, y=540)
            sleep(1)
            gym_desplazamiento_realizado = True

        # Botón de ejercicio 3 (opción)
        pg.click(x=849, y=748)
        sleep(1)

        # Volver a la pantalla principal
        pg.press('escape')
        pg.press('escape')
        sleep(0.5)
        pg.press('escape')

        log_msg("GYM", "completado", "Iteración del GYM completada.")


# =====================================================================
# INYECTOR DINÁMICO (Wrapper / Orquestador)
# =====================================================================

def bucle_orquestador(funcion_original, intervalo_original, nombre_tag):
    """
    Orquestador genérico que inyecta automáticamente la tarea GYM cuando
    hayan transcurrido 24 horas desde la última ejecución guardada en archivo.
    """
    nombre_funcion = funcion_original.__name__
    es_hilo_gym = ACTIVO_GYM and (nombre_funcion == ASIGNAR_GYM_A)
    primer_chequeo_gym = True

    while True:
        # ── Verificación y ejecución automática del GYM si pasaron 24h ──
        if es_hilo_gym:
            puede_ejecutar, horas_restantes = tiempo_hasta_siguiente_gym()
            if puede_ejecutar:
                log_msg("GYM", "espera", f"Han transcurrido 24h (o primera ejecución). Iniciando GYM en '{nombre_tag}' ({MAX_GYM_LOOPS} iteraciones)...")
                for iteration in range(1, MAX_GYM_LOOPS + 1):
                    log_msg("GYM", "espera", f"Esperando turno para realizar tarea del GYM (Iteración {iteration} de {MAX_GYM_LOOPS})...")
                    ejecutar_clicks_gym()
                    log_msg("GYM", "completado", f"Iteración {iteration} de {MAX_GYM_LOOPS} completada.")
                    if iteration < MAX_GYM_LOOPS:
                        sleep(INTERVALO_GYM)
                
                guardar_ultimo_gym()
                log_msg("GYM", "completado", "Fase GYM de 24h finalizada. Marca de tiempo guardada en 'gym_last_run.txt'.")
                primer_chequeo_gym = False
            elif primer_chequeo_gym:
                horas = int(horas_restantes)
                minutos = int((horas_restantes % 1) * 60)
                log_msg("GYM", "espera", f"GYM en cooldown de 24h (registro en archivo). Faltan {horas}h {minutos}m para la próxima ejecución.")
                primer_chequeo_gym = False

        funcion_original()
        sleep(intervalo_original)


# =====================================================================
# TEMPORIZADORES (una sola ejecución por llamada — el bucle lo gestiona
# el orquestador)
# =====================================================================

def bucle_temporizador_1():
    """Temporizador 1: Celebrities District — una iteración por llamada"""
    global celebrities_index
    log_msg("Celebrities District", "espera", "Esperando turno para hacer click...")
    with action_lock:
        sleep(1.5)
        log_msg("Celebrities District", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        sleep(1)
        pg.doubleClick(x=735, y=311)
        sleep(1)

        # Click aleatorio en eje X (979 a 1174), Y siempre es 547
        random_x = random.randint(979, 1174)
        pg.doubleClick(x=random_x, y=547)
        sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = celebrities_options[celebrities_index % len(celebrities_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        celebrities_index += 1
        sleep(1)

        sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Celebrities District", "completado", "Secuencia completada. Iniciando espera de 6 minutos.")


def bucle_temporizador_2():
    """Temporizador 2: Shopping Street — una iteración por llamada"""
    global shopping_index
    log_msg("Shopping Street", "espera", "Esperando turno para hacer click...")
    with action_lock:
        sleep(1.5)
        log_msg("Shopping Street", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        sleep(1)

        # Click aleatorio en eje X, Y siempre es 770
        random_x = random.randint(500, 698)
        pg.doubleClick(x=random_x, y=770)
        sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = shopping_options[shopping_index % len(shopping_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        shopping_index += 1
        sleep(1)

        sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Shopping Street", "completado", "Secuencia completada. Iniciando espera de 6 minutos.")


def bucle_temporizador_3():
    """Temporizador 3: Jardin clasico — una iteración por llamada"""
    global jardin_index
    log_msg("Jardin clasico", "espera", "Esperando turno para hacer click...")
    with action_lock:
        sleep(1.5)
        log_msg("Jardin clasico", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        sleep(1)
        pg.doubleClick(x=735, y=311)
        sleep(1)

        # Click aleatorio en eje X, Y siempre es 770
        random_x = random.randint(738, 934)
        pg.doubleClick(x=random_x, y=770)
        sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = jardin_options[jardin_index % len(jardin_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        jardin_index += 1
        sleep(1)

        sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Jardin clasico", "completado", "Secuencia completada. Iniciando espera de 10 minutos.")


def bucle_temporizador_4():
    """Temporizador 4: Mafiosi District — una iteración por llamada"""
    global mafiosi_index
    log_msg("Mafiosi District", "espera", "Esperando turno para hacer click...")
    with action_lock:
        sleep(1.5)
        log_msg("Mafiosi District", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        sleep(1)
        pg.doubleClick(x=735, y=311)
        sleep(1)

        # Click aleatorio en eje X, Y siempre es 778
        random_x = random.randint(984, 1059)
        pg.doubleClick(x=random_x, y=775)
        sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = mafiosi_options[mafiosi_index % len(mafiosi_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        mafiosi_index += 1
        sleep(1)

        sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Mafiosi District", "completado", "Secuencia completada. Iniciando espera de 8 minutos.")


def bucle_temporizador_6():
    """Temporizador 6: Residential Area — una iteración por llamada"""
    global residential_index
    log_msg("Residential Area", "espera", "Esperando turno para hacer click...")
    with action_lock:
        sleep(1.5)
        log_msg("Residential Area", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        sleep(1)

        # Click aleatorio en eje X, Y siempre es 775
        random_x = random.randint(739, 882)
        pg.doubleClick(x=random_x, y=775)
        sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = residential_options[residential_index % len(residential_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        residential_index += 1
        sleep(1)

        sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Residential Area", "completado", "Secuencia completada. Iniciando espera de 8 minutos.")


def bucle_temporizador_7():
    """Temporizador 7: Billonari Club — una iteración por llamada"""
    global billonari_club_index
    log_msg("Billonari Club", "espera", "Esperando turno para hacer click...")
    with action_lock:
        sleep(1.5)
        log_msg("Billonari Club", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        sleep(1)
        pg.doubleClick(x=739, y=309)
        sleep(1)

        # Click aleatorio en eje X, Y siempre es 775
        random_x = random.randint(502, 684)
        pg.doubleClick(x=random_x, y=772)
        sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = billonari_club_options[billonari_club_index % len(billonari_club_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        billonari_club_index += 1
        sleep(1)

        sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Billonari Club", "completado", "Secuencia completada. Iniciando espera de 8 minutos.")


# =====================================================================
# TAREAS SIN TEMPORIZADOR (mantienen su propio bucle interno ya que no
# necesitan inyección de GYM ni son candidatas al orquestador)
# =====================================================================

def bucle_no_temporizadores_ruleta():
    """Bucle Ruleta: Sin temporizador de juego — Ejecución cada 30 minutos (1800 segundos)"""
    while True:
        log_msg("Ruleta", "espera", "Iniciando espera de 30 minutos (1800s) antes de ejecutar...")
        sleep(1800)
        log_msg("Ruleta", "espera", "Esperando turno para hacer click...")
        with action_lock:
            sleep(1.5)
            log_msg("Ruleta", "ejecutando", "Ejecutando secuencia de clicks...")

            # Icono ruleta
            pg.doubleClick(x=880, y=973)
            sleep(1)

            # Opción de juego ruleta: aleatoria en eje X (552 a 684), Y=468
            random_x_opcion = random.randint(552, 684)
            pg.doubleClick(x=random_x_opcion, y=468)
            sleep(1)

            # Botón Spin: aleatoria en eje X (554 a 699), Y=685
            random_x_spin = random.randint(554, 699)
            pg.doubleClick(x=random_x_spin, y=685)
            sleep(10)

            # Tiempo de animación 10 segundos
            sleep(10)

            # Cerrar ruleta
            sleep(0.5)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            log_msg("Ruleta", "completado", "Secuencia completada.")


# =====================================================================
# MINIJUEGO MAYOR O MENOR (HIGHER / LOWER)
# =====================================================================
COORD_MM_CASINO_BARRA = (880, 973)
COORD_MM_PESTANA      = (628, 299)
COORD_MM_START        = (993, 689)
REGION_MM_NUMERO      = (929, 486, 170, 124)
COORD_MM_MAYOR        = (993, 663)
COORD_MM_MENOR        = (993, 712)
COORD_MM_CERRAR_X     = (1166, 272)


def mm_ocr_leer_numero(region):
    """Extrae el número (1 al 100) en la región configurada usando Apple Vision o PyTesseract."""
    try:
        screenshot = pg.screenshot(region=region)
        texto = ""
        if VISION_DISPONIBLE:
            buf = io.BytesIO()
            screenshot.save(buf, format="PNG")
            data = Foundation.NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))
            handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, None)
            request = Vision.VNRecognizeTextRequest.alloc().init()
            request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
            request.setUsesLanguageCorrection_(False)
            success, _ = handler.performRequests_error_([request], None)
            if success:
                results = request.results()
                parts = [c.string() for obs in results for c in obs.topCandidates_(1)]
                texto = " ".join(parts).strip()
        elif TESSERACT_DISPONIBLE:
            config = "--psm 7 -c tessedit_char_whitelist=0123456789"
            texto = pytesseract.image_to_string(screenshot, config=config).strip()

        matches = re.findall(r'\b\d+\b', texto)
        if matches:
            num = int(matches[0])
            if 1 <= num <= 100:
                return num
        return None
    except Exception as e:
        log_msg("Mayor/Menor", "error", f"Error en lectura OCR: {e}")
        return None


def bucle_no_temporizadores_mayor_menor():
    """Bucle Mayor o Menor: Sin temporizador de juego — Ejecución cada 30 minutos (1800 segundos)"""
    while True:
        log_msg("Mayor/Menor", "espera", "Iniciando espera de 30 minutos (1800s) antes de ejecutar...")
        sleep(1800)
        log_msg("Mayor/Menor", "espera", "Esperando turno para hacer click...")
        with action_lock:
            sleep(1.5)
            log_msg("Mayor/Menor", "ejecutando", "Iniciando minijuego Mayor o Menor...")

            # Abrir casino desde la barra y seleccionar pestaña de bola 8
            pg.doubleClick(x=COORD_MM_CASINO_BARRA[0], y=COORD_MM_CASINO_BARRA[1])
            sleep(1.2)
            pg.click(x=COORD_MM_PESTANA[0], y=COORD_MM_PESTANA[1])
            sleep(1.0)

            # Clic en START
            pg.click(x=COORD_MM_START[0], y=COORD_MM_START[1])
            sleep(2.0)

            # Jugar hasta 10 rondas con lectura OCR y probabilidades
            for ronda in range(1, 11):
                numero = None
                for _ in range(3):
                    numero = mm_ocr_leer_numero(REGION_MM_NUMERO)
                    if numero is not None:
                        break
                    sleep(0.4)

                if numero is None:
                    log_msg("Mayor/Menor", "fin", f"Ronda #{ronda}: Fin de partida o número no detectado.")
                    break

                if numero <= 50:
                    decision = "MAYOR"
                    coord_btn = COORD_MM_MAYOR
                else:
                    decision = "MENOR"
                    coord_btn = COORD_MM_MENOR

                log_msg("Mayor/Menor", "decision", f"Ronda #{ronda}: [{numero}] -> [{decision}]")
                pg.click(x=coord_btn[0], y=coord_btn[1])
                sleep(2.2)

            # Cerrar modal
            sleep(0.8)
            pg.click(x=COORD_MM_CERRAR_X[0], y=COORD_MM_CERRAR_X[1])
            sleep(0.5)
            pg.press('escape')
            sleep(0.3)
            pg.press('escape')
            log_msg("Mayor/Menor", "completado", "Secuencia completada.")


def calcular_intervalo_mas_vida():
    """
    Calcula el intervalo dinámico para el bucle de Más Vida según los temporizadores activos:
    - 4 o más temporizadores activos -> 1 hora (3600 s) + 7 s
    - 3 temporizadores activos       -> 1.5 horas (5400 s) + 7 s
    - 2 temporizadores activos       -> 2 horas (7200 s) + 7 s
    - 1 o 0 temporizadores activos   -> 3 horas (10800 s) + 7 s
    """
    temporizadores = [
        ACTIVO_TEMPORIZADOR_1,
        ACTIVO_TEMPORIZADOR_2,
        ACTIVO_TEMPORIZADOR_3,
        ACTIVO_TEMPORIZADOR_4,
        ACTIVO_TEMPORIZADOR_6,
        ACTIVO_TEMPORIZADOR_7,
        ACTIVO_FABRICACION_CRISTAL,
    ]
    activos = sum(1 for t in temporizadores if t)

    if activos >= 4:
        horas = 1.0
    elif activos == 3:
        horas = 1.5
    elif activos == 2:
        horas = 2.0
    else:
        horas = 3.0

    segundos = int(horas * 3600) + 7
    return activos, horas, segundos


def bucle_mas_vida():
    """Bucle Más Vida: Le da más vida al personaje — Intervalo dinámico según temporizadores activos"""
    while True:
        activos, horas, segundos = calcular_intervalo_mas_vida()
        log_msg("Más Vida", "espera", f"Detectados {activos} temporizadores activos. Iniciando espera de {horas} hora(s) y 7s ({segundos}s)...")
        sleep(segundos)
        log_msg("Más Vida", "espera", "Esperando turno...")
        with action_lock:
            sleep(1.5)
            log_msg("Más Vida", "ejecutando", "Ejecutando secuencia de clicks para más vida...")

            # Click en icono de más vida
            pg.doubleClick(x=893, y=103)
            sleep(1)

            # 8 clicks para sumar vida
            for _ in range(8):
                pg.click(x=1078, y=554)
                sleep(1)

            sleep(0.5)
            pg.press('escape')
            pg.press('escape')
            pg.press('escape')
            log_msg("Más Vida", "completado", "Secuencia completada.")


def bucle_recolector_piedras():
    """Bucle Recolector de piedras preciosas — Ejecución cada 3 horas (10800 segundos)"""
    while True:
        log_msg("Recolector Piedras", "espera", "Iniciando espera de 3 horas antes de ejecutar...")
        sleep(10800)
        log_msg("Recolector Piedras", "espera", "Esperando turno...")
        with action_lock:
            sleep(1.5)
            log_msg("Recolector Piedras", "ejecutando", "Ejecutando secuencia para recolectar piedras preciosas...")

            # Click en el icono piedras
            pg.doubleClick(x=418, y=722)
            sleep(1)

            # Recolección de piedra
            pg.click(x=739, y=575)
            sleep(1)

            # Regresar a pantalla principal
            pg.press('escape')
            pg.press('escape')
            log_msg("Recolector Piedras", "completado", "Secuencia completada.")


# =====================================================================
# MONITOR ANTI-INACTIVIDAD INTELIGENTE (OCR VISION A 1 FPS)
# =====================================================================
COORD_IDLE_RELOAD_BTN  = (837, 689)
REGION_IDLE_RELOAD_BTN = (745, 660, 185, 60)


def bucle_anti_inactividad():
    """
    Bucle Anti-Inactividad Inteligente (Vision OCR ~1 FPS):
    Monitorea de forma ultraligera el área de 'Idle too long' y presiona
    automáticamente el botón RELOAD en cuanto aparece el aviso.
    """
    log_msg("Anti-Inactividad", "activo", "Monitor OCR activo (~1 FPS) para detectar 'Idle too long' / RELOAD...")
    while True:
        try:
            # Capturar la pequeña región del botón RELOAD (185x60 px)
            screenshot = pg.screenshot(region=REGION_IDLE_RELOAD_BTN)
            texto = ""
            if VISION_DISPONIBLE:
                buf = io.BytesIO()
                screenshot.save(buf, format="PNG")
                data = Foundation.NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))
                handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, None)
                request = Vision.VNRecognizeTextRequest.alloc().init()
                request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelFast)
                request.setUsesLanguageCorrection_(False)
                success, _ = handler.performRequests_error_([request], None)
                if success:
                    results = request.results()
                    parts = [c.string() for obs in results for c in obs.topCandidates_(1)]
                    texto = " ".join(parts).upper()
            elif TESSERACT_DISPONIBLE:
                texto = pytesseract.image_to_string(screenshot).strip().upper()

            # Si detecta la palabra RELOAD o IDLE
            if "RELOAD" in texto or "IDLE" in texto:
                log_msg("Anti-Inactividad", "alerta", f"⚠️ Detectado aviso de inactividad ('{texto.strip()}').")
                with action_lock:
                    log_msg("Anti-Inactividad", "ejecutando", f"Pulsando botón RELOAD en {COORD_IDLE_RELOAD_BTN}...")
                    pg.click(COORD_IDLE_RELOAD_BTN)
                    sleep(2.0)
                    pg.press('enter')
                    
                    log_msg("Anti-Inactividad", "espera", "Esperando 6s para carga inicial del juego...")
                    sleep(6.0)
                    
                    # Secuencia de restauración para asegurar la pantalla principal de la ciudad
                    log_msg("Anti-Inactividad", "ejecutando", "Ejecutando secuencia de login y retorno a pantalla principal...")
                    pg.press('enter')
                    sleep(3.0)
                    pg.press('enter')
                    sleep(2.0)
                    
                    # Cerrar posibles popups de bienvenida/recompensas
                    pg.press('escape')
                    sleep(0.8)
                    pg.press('escape')
                    sleep(0.8)
                    pg.press('escape')
                    sleep(0.5)
                    
                    log_msg("Anti-Inactividad", "completado", "✅ Pantalla principal de la ciudad restaurada con éxito.")

        except Exception as e:
            log_msg("Anti-Inactividad", "error", f"Error en detector: {e}")

        # Tasa de refresco a ~1 FPS (1 segundo de espera entre escaneos ligeros)
        sleep(1.0)


def bucle_fabricacion_cristal():
    """Temporizador Fabricación de Cristal — una iteración por llamada (intervalo: 7200 s)"""
    
    
    with action_lock:
        sleep(1.5)
        log_msg("Fabricación", "ejecutando", "Iniciando fabricación de Cristal...")
        # Fábrica de cristal
        pg.press('escape')
        pg.doubleClick(x=545, y=673)
        sleep(1)
        # Click en Lab
        pg.click(x=771, y=734)
        sleep(1)
        # Comenzar a cocinar
        pg.click(x=836, y=744)
        sleep(1)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')

    log_msg("Fabricación", "espera", "Esperando turno para fabricar Cristal...")
    sleep(7200)
    log_msg("Fabricación", "completado", "Cristal iniciado. Iniciando espera de 2 horas.")


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
                    target=hilo_wrapper,
                    args=(bucle_orquestador, nombre, True, funcion, intervalo, tag),
                    daemon=True
                )
            )

    # ── Tareas sin temporizador (bucle propio, no pasan por orquestador) ─
    if ACTIVO_RULETA:
        hilos.append(
            threading.Thread(
                target=hilo_wrapper,
                args=(bucle_no_temporizadores_ruleta, "bucle_no_temporizadores_ruleta", False),
                daemon=True
            )
        )
    if ACTIVO_MAYOR_MENOR:
        hilos.append(
            threading.Thread(
                target=hilo_wrapper,
                args=(bucle_no_temporizadores_mayor_menor, "bucle_no_temporizadores_mayor_menor", False),
                daemon=True
            )
        )
    if ACTIVO_MAS_VIDA:
        hilos.append(
            threading.Thread(
                target=hilo_wrapper,
                args=(bucle_mas_vida, "bucle_mas_vida", False),
                daemon=True
            )
        )
    if ACTIVO_RECOLECTOR_PIEDRAS:
        hilos.append(
            threading.Thread(
                target=hilo_wrapper,
                args=(bucle_recolector_piedras, "bucle_recolector_piedras", False),
                daemon=True
            )
        )
    if ACTIVO_ANTI_INACTIVIDAD:
        hilos.append(
            threading.Thread(
                target=hilo_wrapper,
                args=(bucle_anti_inactividad, "bucle_anti_inactividad", False),
                daemon=True
            )
        )

    # ── Listeners de teclado: tecla 'P' para pausar/reanudar ───────────
    # 1. Listener Global (funciona en cualquier ventana vía pynput)
    try:
        from pynput import keyboard as _kb

        def _on_key_press(key):
            try:
                if hasattr(key, 'char') and key.char and key.char.lower() == 'p':
                    toggle_pausa()
                elif hasattr(key, 'vk') and key.vk in (35, 80, 112):
                    toggle_pausa()
                elif str(key).strip("'\"").lower() == 'p':
                    toggle_pausa()
            except Exception:
                pass

        _listener = _kb.Listener(on_press=_on_key_press)
        _listener.daemon = True
        _listener.start()
    except Exception as e:
        print(f"⚠️  Listener global no disponible ({e}). Se usará el listener de consola.")

    # 2. Listener de Consola (funciona directamente en el terminal sin requerir permisos de accesibilidad del SO)
    def _terminal_stdin_listener():
        import select
        try:
            if sys.stdin.isatty():
                import tty
                import termios
                fd = sys.stdin.fileno()
                old_settings = termios.tcgetattr(fd)
                try:
                    tty.setcbreak(fd)
                    while True:
                        rlist, _, _ = select.select([fd], [], [], 0.2)
                        if rlist:
                            raw = os.read(fd, 1)
                            if not raw:
                                break
                            ch = raw.decode('utf-8', errors='ignore')
                            if ch.lower() == 'p':
                                toggle_pausa()
                            elif ch == '\x03':  # Ctrl+C
                                os._exit(0)
                finally:
                    termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
            else:
                while True:
                    line = sys.stdin.readline()
                    if not line:
                        break
                    if 'p' in line.lower():
                        toggle_pausa()
        except Exception:
            try:
                while True:
                    line = sys.stdin.readline()
                    if not line:
                        break
                    if 'p' in line.lower():
                        toggle_pausa()
            except Exception:
                pass

    t_stdin = threading.Thread(target=_terminal_stdin_listener, daemon=True)
    t_stdin.start()

    print(f"Iniciando autoclicker con {len(hilos)} hilos concurrentes...")
    print("🎮 Presiona 'P' en cualquier momento para pausar/reanudar | Ctrl+C o esquina del mouse para detener.")
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
