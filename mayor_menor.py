#!/usr/bin/env python3
"""
Módulo Prototipo: Minijuego Mayor o Menor (Higher / Lower) - MafiaBattle
========================================================================
Permite calibrar coordenadas, realizar lectura OCR del número mostrado
y jugar automáticamente según probabilidades óptimas (1 a 100).
"""

import sys
import os
import time
import re
import io
import argparse
from datetime import datetime
import pyautogui as pg
from PIL import Image

# Apple Vision Framework para OCR nativo ultrarrápido en macOS
try:
    import Foundation
    import Vision
    VISION_DISPONIBLE = True
except ImportError:
    VISION_DISPONIBLE = False

# PyTesseract como respaldo
try:
    import pytesseract
    TESSERACT_DISPONIBLE = True
except ImportError:
    TESSERACT_DISPONIBLE = False


# =====================================================================
# CONFIGURACIÓN DE COORDENADAS Y REGIONES (PANTALLA 1680x1050)
# =====================================================================
# 1. Icono del casino en la barra inferior (para abrir el menú de minijuegos)
COORD_CASINO_BARRA = (880, 973)

# 2. Pestaña superior del minijuego (Icono bola 8 verde con flechas)
COORD_PESTANA      = (628, 299)

# 3. Botón "START!" (ubicado en el área central inferior de la tarjeta)
COORD_START        = (993, 689)

# 4. Región en pantalla donde se muestra el número actual: (x, y, ancho, alto)
REGION_NUMERO      = (929, 486, 170, 124)

# 5. Botón "HIGHER" / "MAYOR" (Flecha Arriba Verde)
COORD_MAYOR        = (993, 663)

# 6. Botón "LOWER" / "MENOR" (Flecha Abajo Roja)
COORD_MENOR        = (993, 712)

# 7. Botón de cierre "X" superior derecho del modal
COORD_CERRAR_X     = (1166, 272)

# 8. Parámetros del juego
MAX_RONDAS         = 10              # Cantidad máxima de rondas por partida
COOLDOWN_SEG       = 1800            # 30 minutos entre partidas (1800s)
PROB_CORTE         = 50              # <= 50 -> HIGHER (Mayor), >= 51 -> LOWER (Menor)


# =====================================================================
# UTILIDADES DE LOGGING
# =====================================================================
def log_msg(etiqueta, estado, mensaje):
    ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ahora}] [{etiqueta.upper():<12}] [{estado.upper():<10}] {mensaje}", flush=True)


# =====================================================================
# MOTOR OCR (APPLE VISION / PYTESSERACT)
# =====================================================================
def ocr_apple_vision(pil_image):
    """Extrae texto usando el motor nativo Apple Vision en macOS."""
    if not VISION_DISPONIBLE:
        return ""
    try:
        buf = io.BytesIO()
        pil_image.save(buf, format="PNG")
        data = Foundation.NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))
        
        handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, None)
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setUsesLanguageCorrection_(False)
        
        success, _ = handler.performRequests_error_([request], None)
        if not success:
            return ""
        
        results = request.results()
        text_parts = [cand.string() for obs in results for cand in obs.topCandidates_(1)]
        return " ".join(text_parts).strip()
    except Exception as e:
        log_msg("OCR", "error", f"Fallo en Apple Vision: {e}")
        return ""


def ocr_tesseract(pil_image):
    """Extrae texto usando PyTesseract como respaldo."""
    if not TESSERACT_DISPONIBLE:
        return ""
    try:
        # Configurar tesseract para solo reconocer dígitos
        config = "--psm 7 -c tessedit_char_whitelist=0123456789"
        text = pytesseract.image_to_string(pil_image, config=config)
        return text.strip()
    except Exception as e:
        return ""


def leer_numero_en_region(region, guardar_debug=False):
    """
    Captura la región especificada y detecta el número mostrado (1 al 100).
    Devuelve int(numero) si tiene éxito, o None si no encuentra número válido.
    """
    try:
        # Captura de pantalla de la región
        screenshot = pg.screenshot(region=region)
        
        if guardar_debug:
            ruta_debug = os.path.join(os.path.dirname(os.path.abspath(__file__)), "debug_numero.png")
            screenshot.save(ruta_debug)
            log_msg("DEBUG", "info", f"Captura de región guardada en: {ruta_debug}")

        texto = ""
        if VISION_DISPONIBLE:
            texto = ocr_apple_vision(screenshot)
        elif TESSERACT_DISPONIBLE:
            texto = ocr_tesseract(screenshot)
        
        # Buscar el primer número entero en el texto detectado
        matches = re.findall(r'\b\d+\b', texto)
        if matches:
            numero = int(matches[0])
            # Validar que esté en el rango esperado (1 a 100)
            if 1 <= numero <= 100:
                return numero
            log_msg("OCR", "aviso", f"Número fuera de rango (1-100): {numero}")
            return numero
        
        return None
    except Exception as e:
        log_msg("OCR", "error", f"Error al leer pantalla: {e}")
        return None


# =====================================================================
# LÓGICA DE DECISIÓN Y JUEGO
# =====================================================================
def decidir_jugada(numero):
    """
    Determina la jugada estadísticamente óptima para un rango 1-100:
    - Si numero <= 50: la mayoría de números restantes son mayores -> MAYOR
    - Si numero >= 51: la mayoría de números restantes son menores -> MENOR
    """
    if numero <= PROB_CORTE:
        return "MAYOR", COORD_MAYOR
    else:
        return "MENOR", COORD_MENOR


def jugar_partida(guardar_debug=True, abrir_desde_barra=True):
    """
    Ejecuta una partida completa del minijuego:
    1. Abre el casino y selecciona la pestaña de Mayor o Menor si es necesario
    2. Clic en START
    3. Bucle de hasta 10 rondas detectando el número y pulsando HIGHER/LOWER
    4. Cierre del modal
    """
    log_msg("JUEGO", "inicio", "Iniciando partida de Mayor o Menor...")
    
    # 1. Abrir modal si se solicita
    if abrir_desde_barra:
        log_msg("JUEGO", "click", f"Abriendo casino desde la barra: {COORD_CASINO_BARRA}")
        pg.doubleClick(COORD_CASINO_BARRA)
        time.sleep(1.2)
        
        log_msg("JUEGO", "click", f"Seleccionando pestaña Mayor/Menor (Bola 8): {COORD_PESTANA}")
        pg.click(COORD_PESTANA)
        time.sleep(1.0)
    
    # 2. Clic en START
    log_msg("JUEGO", "click", f"Haciendo click en START: {COORD_START}")
    pg.click(COORD_START)
    time.sleep(2.0)
    
    # 3. Bucle de rondas
    for ronda in range(1, MAX_RONDAS + 1):
        log_msg("JUEGO", "ronda", f"--- RONDA #{ronda} / {MAX_RONDAS} ---")
        
        # Intentar leer el número (con hasta 3 reintentos por si la animación está en curso)
        numero = None
        for intento in range(3):
            numero = leer_numero_en_region(REGION_NUMERO, guardar_debug=(guardar_debug and ronda == 1))
            if numero is not None:
                break
            time.sleep(0.5)
        
        if numero is None:
            log_msg("JUEGO", "fin", f"No se detectó número en la ronda #{ronda}. Partida terminada o fallida.")
            break
        
        decision, coord_boton = decidir_jugada(numero)
        log_msg("JUEGO", "decision", f"Número actual: [{numero}] -> Decisión óptima: [{decision}] en {coord_boton}")
        
        # Hacer clic en HIGHER o LOWER
        pg.click(coord_boton)
        
        # Esperar animación de acierto/resultado antes de la siguiente ronda
        time.sleep(2.2)
    
    # 4. Salir / Cerrar ventana modal
    time.sleep(1.0)
    log_msg("JUEGO", "cierre", "Cerrando ventana modal...")
    pg.click(COORD_CERRAR_X)
    time.sleep(0.5)
    pg.press('escape')
    time.sleep(0.3)
    pg.press('escape')
    log_msg("JUEGO", "completado", "Partida finalizada con éxito.")


# =====================================================================
# MODOS INTERACTIVOS Y PRUEBAS (CLI)
# =====================================================================
def modo_test_ocr():
    """Toma una captura de la región configurada y muestra el OCR."""
    print("\n" + "=" * 60)
    print(" 📸 PROBANDO LECTURA OCR DE LA REGIÓN CONFIGURADA")
    print(f" Región: {REGION_NUMERO}")
    print("=" * 60)
    
    num = leer_numero_en_region(REGION_NUMERO, guardar_debug=True)
    if num is not None:
        decision, coord = decidir_jugada(num)
        print(f"\n✅ ¡ÉXITO! Número detectado: {num}")
        print(f"📊 Decisión probabilística: [{decision}] -> Coordenada: {coord}\n")
    else:
        print("\n❌ No se detectó ningún número en la región.")
        print("💡 Revisa el archivo 'debug_numero.png' para verificar si el recorte abarca el número.\n")


def modo_calibrador_region():
    """Guía paso a paso para obtener las coordenadas y dimensiones de la caja del número."""
    print("\n" + "=" * 60)
    print(" 📐 CALIBRADOR DE REGIÓN DEL NÚMERO")
    print("=" * 60)
    print("1. Coloca el cursor en la ESQUINA SUPERIOR IZQUIERDA de la caja del número.")
    print("   Tienes 4 segundos...")
    time.sleep(4)
    x1, y1 = pg.position()
    print(f"   -> Esquina superior izquierda: X={x1}, Y={y1}")
    
    print("\n2. Ahora coloca el cursor en la ESQUINA INFERIOR DERECHA de la caja del número.")
    print("   Tienes 4 segundos...")
    time.sleep(4)
    x2, y2 = pg.position()
    print(f"   -> Esquina inferior derecha: X={x2}, Y={y2}")
    
    ancho = max(10, x2 - x1)
    alto = max(10, y2 - y1)
    
    print("\n" + "=" * 60)
    print(f"🎯 COPIA Y PEGA ESTA LÍNEA EN EL ARCHIVO:")
    print(f"REGION_NUMERO = ({x1}, {y1}, {ancho}, {alto})")
    print("=" * 60 + "\n")
    
    # Probar lectura con la nueva región
    num = leer_numero_en_region((x1, y1, ancho, alto), guardar_debug=True)
    print(f"Resultado de prueba con esta región: {num if num is not None else 'No detectado aún'}")


def bucle_cooldown_30min():
    """Ejecuta el ciclo continuo cada 30 minutos."""
    log_msg("BUCLE", "activo", f"Iniciando bucle de Mayor o Menor (Ciclo cada {COOLDOWN_SEG // 60} min)...")
    while True:
        try:
            jugar_partida(guardar_debug=False)
        except Exception as e:
            log_msg("BUCLE", "error", f"Error en la partida: {e}")
        
        log_msg("BUCLE", "espera", f"Esperando {COOLDOWN_SEG // 60} minutos para el siguiente intento...")
        time.sleep(COOLDOWN_SEG)


def main():
    parser = argparse.ArgumentParser(description="Prototipo Mayor o Menor - MafiaBattle")
    parser.add_argument("--ocr", action="store_true", help="Probar OCR sobre la región actual y guardar debug_numero.png")
    parser.add_argument("--calibrar", action="store_true", help="Asistente interactivo para calibrar la región del número")
    parser.add_argument("--jugar", action="store_true", help="Ejecutar 1 partida de prueba")
    parser.add_argument("--loop", action="store_true", help="Iniciar el bucle continuo cada 30 minutos")
    
    args = parser.parse_args()
    
    if args.ocr:
        modo_test_ocr()
    elif args.calibrar:
        modo_calibrador_region()
    elif args.jugar:
        jugar_partida(guardar_debug=True)
    elif args.loop:
        bucle_cooldown_30min()
    else:
        print("\n" + "=" * 60)
        print("🎮 PROTOTIPO MAYOR O MENOR (HIGHER / LOWER) - MAFIABATTLE")
        print("=" * 60)
        print("Opciones disponibles:")
        print("  1. python mayor_menor.py --calibrar   (Asistente para calibrar la caja del número)")
        print("  2. python mayor_menor.py --ocr        (Probar si lee el número y ver debug_numero.png)")
        print("  3. python mayor_menor.py --jugar      (Ejecutar 1 partida completa de prueba)")
        print("  4. python mayor_menor.py --loop       (Ejecutar bucle continuo cada 30 min)")
        print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
