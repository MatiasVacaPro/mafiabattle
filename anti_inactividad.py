#!/usr/bin/env python3
"""
Módulo Anti-Inactividad Autónomo - MafiaBattle
==============================================
Monitorea la pantalla para detectar el modal de inactividad ('Idle too long' / 'RELOAD'),
ejecuta doble click de reactivación, espera 10 segundos de carga y restaura la pantalla
principal de la ciudad.

Puede ejecutarse de forma independiente:
    python3 anti_inactividad.py             # Modo monitor continuo
    python3 anti_inactividad.py --test-ocr   # Probar OCR y guardar captura de depuración
    python3 anti_inactividad.py --click      # Ejecutar secuencia de clic de prueba
    python3 anti_inactividad.py --verbose    # Modo detallado con logs en cada ciclo
"""

import os
import sys
import time
import io
import argparse
import threading
from datetime import datetime
from PIL import Image, ImageDraw
import pyautogui as pg

# OCR Nativo Apple Vision en macOS
try:
    import Foundation
    import Vision
    VISION_DISPONIBLE = True
except ImportError:
    VISION_DISPONIBLE = False

# OCR PyTesseract (Respaldo)
try:
    import pytesseract
    TESSERACT_DISPONIBLE = True
except ImportError:
    TESSERACT_DISPONIBLE = False


# =====================================================================
# CONFIGURACIÓN DE COORDENADAS Y REGIONES (PANTALLA 1680x1050)
# =====================================================================
DIRECTORIO_ACTUAL = os.path.dirname(os.path.abspath(__file__))
DIR_CAPTURAS = os.path.join(DIRECTORIO_ACTUAL, "capturas")
os.makedirs(DIR_CAPTURAS, exist_ok=True)

# Coordenada central del botón RELOAD en resolución 1680x1050
COORD_IDLE_RELOAD_BTN = (838, 688)

# Región del modal completo: (x, y, ancho, alto)
REGION_IDLE_MODAL = (550, 320, 580, 430)

# Región específica del botón RELOAD
REGION_IDLE_RELOAD_BTN = (730, 650, 220, 80)

# Palabras clave para detección de inactividad
PALABRAS_CLAVE_IDLE = [
    "IDLE", "TOO LONG", "STILL THERE", "RELOAD", "RECARGAR",
    "INACTIVIDAD", "ESTAS AHI", "ESTÁS AHÍ", "HELLO", "HOLA"
]


# =====================================================================
# UTILIDADES DE LOGGING
# =====================================================================
def log_msg(tag, status, message):
    """Imprime mensajes formateados con marca de tiempo y emojis."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    emoji = {
        "activo":     "ℹ️",
        "espera":     "⏳",
        "ejecutando": "⚡",
        "alerta":     "⚠️",
        "completado": "✅",
        "error":      "❌"
    }.get(status, "ℹ️")
    print(f"{emoji} [{timestamp}] [{tag}] {message}", flush=True)


def sleep_exacto(segundos, evento_activo=None):
    """Espera eficiente compatible con eventos de pausa."""
    fin = time.time() + segundos
    while time.time() < fin:
        if evento_activo and not evento_activo.is_set():
            evento_activo.wait(0.2)
            continue
        restante = fin - time.time()
        if restante <= 0:
            break
        time.sleep(min(0.2, restante))


def verificar_permiso_grabacion_pantalla():
    """
    Comprueba si macOS ha concedido permiso de Grabación de Pantalla (Screen Recording).
    Si no está concedido, macOS solo devuelve el fondo de escritorio (wallpaper),
    haciendo que el OCR sea ciego a ventanas y modales.
    """
    try:
        import Quartz
        if hasattr(Quartz, "CGPreflightScreenCaptureAccess"):
            return Quartz.CGPreflightScreenCaptureAccess()
    except Exception:
        pass
    return True


# =====================================================================
# DETECCIÓN OCR Y VISUAL
# =====================================================================
def es_color_boton_reload(img_crop):
    """
    Verifica mediante análisis de color si el botón cian de RELOAD está visible.
    El botón de MafiaBattle tiene un tono cian característico (#00C4FF / #00b8e6).
    """
    try:
        w, h = img_crop.size
        cian_pixels = 0
        total_sample = 0
        
        # Muestrear píxeles del centro del recorte
        for y in range(int(h * 0.2), int(h * 0.8), 2):
            for x in range(int(w * 0.2), int(w * 0.8), 2):
                r, g, b = img_crop.getpixel((x, y))[:3]
                total_sample += 1
                # Cian / Celeste brillante del botón RELOAD
                if r < 100 and g > 150 and b > 180:
                    cian_pixels += 1
        
        if total_sample > 0 and (cian_pixels / total_sample) > 0.08:
            return True
    except Exception:
        pass
    return False


def analizar_pantalla_idle(guardar_debug=False, imagen=None):
    """
    Captura la región del modal (o usa 'imagen' si se provee) y ejecuta OCR para detectar el aviso de inactividad.
    Retorna: (detectado: bool, coord_click: tuple, texto_detectado: str)
    """
    rx, ry, rw, rh = REGION_IDLE_MODAL
    if imagen is not None:
        screenshot = imagen
    else:
        screenshot = pg.screenshot(region=REGION_IDLE_MODAL)
    
    texto_detectado = ""
    coord_click = COORD_IDLE_RELOAD_BTN
    detectado = False
    boxes_encontradas = []

    # 1. OCR Apple Vision
    if VISION_DISPONIBLE:
        try:
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
                parts = []
                for obs in results:
                    candidates = obs.topCandidates_(1)
                    if not candidates:
                        continue
                    cand = candidates[0].string()
                    parts.append(cand)
                    bbox = obs.boundingBox()
                    bx = int(bbox.origin.x * rw + rx)
                    by = int((1.0 - (bbox.origin.y + bbox.size.height)) * rh + ry)
                    bw = int(bbox.size.width * rw)
                    bh = int(bbox.size.height * rh)
                    boxes_encontradas.append((cand, (bx, by, bw, bh)))
                    
                    cand_upper = cand.upper()
                    if any(w in cand_upper for w in ["RELOAD", "RECARGAR"]):
                        coord_click = (bx + bw // 2, by + bh // 2)
                        detectado = True
                        
                texto_detectado = " ".join(parts).upper()
        except Exception as e:
            log_msg("Anti-Inactividad", "error", f"Error en Apple Vision OCR: {e}")

    # 2. Respaldo Tesseract si no hubo Vision
    elif TESSERACT_DISPONIBLE:
        try:
            texto_detectado = pytesseract.image_to_string(screenshot).strip().upper()
        except Exception as e:
            log_msg("Anti-Inactividad", "error", f"Error en Tesseract OCR: {e}")

    # 3. Comprobación por palabras clave
    if any(p in texto_detectado for p in PALABRAS_CLAVE_IDLE):
        detectado = True

    # 4. Respaldo por color del botón cian (solo si se captura de pantalla completa/en vivo)
    if not detectado and imagen is None:
        crop_btn = pg.screenshot(region=REGION_IDLE_RELOAD_BTN)
        if es_color_boton_reload(crop_btn):
            detectado = True
            texto_detectado = "[DETECTADO POR COLOR CIAN DEL BOTÓN]"

    # Guardar depuración si se solicita
    if guardar_debug:
        debug_path = os.path.join(DIR_CAPTURAS, "debug_anti_inactividad.png")
        draw_img = screenshot.copy()
        draw = ImageDraw.Draw(draw_img)
        for cand, (bx, by, bw, bh) in boxes_encontradas:
            # Convertir a coordenadas locales del crop
            lx, ly = bx - rx, by - ry
            draw.rectangle([lx, ly, lx + bw, ly + bh], outline="red", width=2)
            draw.text((lx, max(0, ly - 12)), cand, fill="yellow")
        draw_img.save(debug_path)
        log_msg("DEBUG", "completado", f"Captura de depuración guardada en: {debug_path}")

    return detectado, coord_click, texto_detectado


# =====================================================================
# SECUENCIA DE RECUPERACIÓN / CLICK
# =====================================================================
def ejecutar_recuperacion_idle(coord_click=COORD_IDLE_RELOAD_BTN, lock=None):
    """
    Ejecuta la reactivación completa con doble mecanismo seguro:
    1. Click de enfoque y doble click en botón RELOAD (838, 688).
    2. Confirmación con tecla Enter.
    3. Verificación de seguridad: si el modal persiste tras 3s, fuerza recarga directa con Cmd+R.
    4. Espera de pantalla de carga del juego.
    5. Secuencia de login (Enter) y retorno a pantalla principal (Escape).
    """
    def _accion():
        log_msg("Anti-Inactividad", "ejecutando", f"Pulsando botón RELOAD (Doble Click) en {coord_click}...")
        
        # 1. Click inicial de enfoque en la ventana del navegador
        pg.click(x=coord_click[0], y=coord_click[1])
        sleep_exacto(0.2)
        
        # 2. Doble click de reactivación en el botón RELOAD
        pg.doubleClick(x=coord_click[0], y=coord_click[1])
        sleep_exacto(0.5)
        pg.press('enter')

        # 3. Verificación de seguridad: comprobar si el aviso persiste tras el click
        sleep_exacto(3.0)
        sigue_idle, _, _ = analizar_pantalla_idle(guardar_debug=False)
        if sigue_idle:
            log_msg("Anti-Inactividad", "alerta", "Aviso aún presente. Ejecutando recarga directa con Cmd+R...")
            pg.hotkey('command', 'r')
            sleep_exacto(1.5)
            pg.press('enter')

        # 4. Espera de pantalla de carga del juego
        log_msg("Anti-Inactividad", "espera", "Esperando 8s para recarga y conexión del juego...")
        sleep_exacto(8.0)

        # 5. Secuencia de restauración de sesión y ciudad
        log_msg("Anti-Inactividad", "ejecutando", "Ejecutando secuencia de login y retorno a pantalla principal...")
        pg.press('enter')
        sleep_exacto(2.5)
        pg.press('enter')
        sleep_exacto(2.0)

        # 6. Limpiar ventanas emergentes / modales residuales
        pg.press('escape')
        sleep_exacto(0.5)
        pg.press('escape')
        sleep_exacto(0.5)
        pg.press('escape')
        sleep_exacto(0.5)

        log_msg("Anti-Inactividad", "completado", "✅ Pantalla principal de la ciudad restaurada con éxito.")

    if lock:
        with lock:
            _accion()
    else:
        _accion()


# =====================================================================
# BUCLE PRINCIPAL DE MONITOREO
# =====================================================================
def bucle_anti_inactividad(lock=None, verbose=False, max_iteraciones=None, callback_iteracion=None):
    """
    Bucle continuo a ~1 FPS para detectar y solucionar la inactividad automáticamente.
    Emite latidos periódicos para confirmar iteración activa en consola.
    """
    if not verificar_permiso_grabacion_pantalla():
        log_msg("Anti-Inactividad", "alerta", "⚠️ ATENCIÓN: Permiso de 'Grabación de pantalla' NO concedido en macOS.")
        log_msg("Anti-Inactividad", "alerta", "macOS solo muestra el fondo de pantalla y bloquea la detección de ventanas.")
        log_msg("Anti-Inactividad", "alerta", "Activa tu Terminal/Ghostty en: Ajustes del Sistema > Privacidad y seguridad > Grabación de pantalla.")

    log_msg("Anti-Inactividad", "activo", "Monitor OCR activo (~1 FPS) para detectar 'Idle too long' / RELOAD...")
    contador_iteraciones = 0

    while True:
        contador_iteraciones += 1
        try:
            detectado, coord_click, texto = analizar_pantalla_idle(guardar_debug=False)

            if callback_iteracion:
                callback_iteracion(contador_iteraciones, texto)

            if verbose:
                info_scan = f"'{texto}'" if texto else "[Sin texto en región]"
                log_msg("Anti-Inactividad", "activo", f"Escaneo #{contador_iteraciones}: {info_scan}")
            elif contador_iteraciones % 10 == 0:
                # Latido periódico cada 10 iteraciones (~10s) para que el usuario verifique actividad
                log_msg("Anti-Inactividad", "activo", f"Monitor OCR activo (Iteración #{contador_iteraciones}) - Sin inactividad")

            if detectado:
                log_msg("Anti-Inactividad", "alerta", f"⚠️ Detectado aviso de inactividad ('{texto.strip()}').")
                ejecutar_recuperacion_idle(coord_click=coord_click, lock=lock)

        except Exception as e:
            log_msg("Anti-Inactividad", "error", f"Error en bucle detector: {e}")

        if max_iteraciones is not None and contador_iteraciones >= max_iteraciones:
            break

        sleep_exacto(1.0)


# =====================================================================
# CLI / EJECUCIÓN DIRECTA
# =====================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Módulo Anti-Inactividad para MafiaBattle (Detección OCR + Auto Reload)"
    )
    parser.add_argument("--test-ocr", action="store_true", help="Captura el modal, realiza OCR y guarda 'capturas/debug_anti_inactividad.png'")
    parser.add_argument("--click", action="store_true", help="Prueba inmediatamente la secuencia de clic y los 10s de espera")
    parser.add_argument("--verbose", "-v", action="store_true", help="Muestra los resultados de cada escaneo en tiempo real")
    parser.add_argument("--calibrar", action="store_true", help="Muestra coordenadas del mouse en vivo para calibración")

    args = parser.parse_args()

    print("=" * 65)
    print(" 🛡️  MONITOR ANTI-INACTIVIDAD (MAFIABATTLE) ")
    print("=" * 65)
    print(f"📐 Región de Monitoreo Modal: {REGION_IDLE_MODAL}")
    print(f"🎯 Coordenada Botón RELOAD:  {COORD_IDLE_RELOAD_BTN}")
    print(f"🔍 Motor OCR Apple Vision:    {'Disponible ✅' if VISION_DISPONIBLE else 'No disponible ❌'}")
    print("=" * 65 + "\n")

    if args.calibrar:
        print("Mueve el mouse sobre el botón RELOAD. Presiona Ctrl+C para salir.\n")
        try:
            pg.displayMousePosition()
        except KeyboardInterrupt:
            print("\nCalibración finalizada.")
        return

    if args.test_ocr:
        log_msg("TEST", "ejecutando", "Ejecutando escaneo OCR de prueba...")
        detectado, coord_click, texto = analizar_pantalla_idle(guardar_debug=True)
        print("\n--- RESULTADOS DEL ESCANEO ---")
        print(f"Aviso detectado:     {'SÍ ✅' if detectado else 'NO ❌'}")
        print(f"Coordenada calculada: {coord_click}")
        print(f"Texto reconocido:    \"{texto}\"")
        print("------------------------------\n")
        return

    if args.click:
        log_msg("TEST", "ejecutando", "Iniciando secuencia de click de prueba en 3 segundos... Cambia al navegador.")
        time.sleep(3)
        ejecutar_recuperacion_idle()
        return

    # Ejecución por defecto: Bucle continuo
    try:
        bucle_anti_inactividad(verbose=args.verbose)
    except KeyboardInterrupt:
        print("\nMonitor detenido por el usuario.")


if __name__ == "__main__":
    main()
