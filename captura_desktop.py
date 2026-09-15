#!/usr/bin/env python3
"""
Capturador y Calculador de Coordenadas de Pantalla (macOS / Retina / PyAutoGUI)
=============================================================================
Toma capturas de pantalla del desktop ajustadas a las dimensiones EXACTAS
de la pantalla (1680x1050) para que 1 píxel en la imagen corresponda a 1 punto
de clic en PyAutoGUI (mapeo 1:1 directo).
"""

import os
import sys
import time
import json
import argparse
import subprocess
from datetime import datetime
from PIL import Image, ImageGrab, ImageDraw, ImageFont
import pyautogui as pg

DIRECTORIO_ACTUAL = os.path.dirname(os.path.abspath(__file__))
DIR_CAPTURAS = os.path.join(DIRECTORIO_ACTUAL, "capturas")
os.makedirs(DIR_CAPTURAS, exist_ok=True)
RUTA_CAPTURA_1X = os.path.join(DIR_CAPTURAS, "captura_pantalla.png")
RUTA_CAPTURA_RETINA = os.path.join(DIR_CAPTURAS, "captura_pantalla_retina_2x.png")
RUTA_CAPTURA_GUIA = os.path.join(DIR_CAPTURAS, "captura_pantalla_con_coordenadas.png")


class ScreenHelper:
    """
    Gestor de geometría de pantalla y capturas 1:1 exactas para PyAutoGUI.
    """
    def __init__(self):
        self.actualizar_geometria()

    def actualizar_geometria(self):
        """Detecta las dimensiones lógicas de clic y físicas de la pantalla."""
        self.logico_w, self.logico_h = pg.size()
        temp_img = ImageGrab.grab()
        self.fisico_w, self.fisico_h = temp_img.size
        self.escala_x = self.fisico_w / float(self.logico_w) if self.logico_w else 1.0
        self.escala_y = self.fisico_h / float(self.logico_h) if self.logico_h else 1.0

    def capturar_pantalla_1a1(self, ruta_1x=RUTA_CAPTURA_1X, ruta_retina=RUTA_CAPTURA_RETINA, delay_seg=1, generar_guia=False):
        """
        Toma la captura y genera la imagen con dimensiones EXACTAS de la pantalla (1:1).
        Cualquier coordenada (X, Y) medida en 'captura_pantalla.png' es idéntica
        a la coordenada para pyautogui.click(x, y).
        """
        if delay_seg and delay_seg > 0:
            if delay_seg >= 2:
                for restante in range(int(delay_seg), 0, -1):
                    sys.stdout.write(f"\r⏳ Capturando en {restante}s... Cambia a la ventana deseada...")
                    sys.stdout.flush()
                    time.sleep(1)
                sys.stdout.write("\r📸 ¡Capturando ahora!                                                 \n")
                sys.stdout.flush()
            else:
                sys.stdout.write(f"⏳ Esperando {delay_seg}s para enfocar la ventana...\n")
                sys.stdout.flush()
                time.sleep(delay_seg)

        self.actualizar_geometria()

        # 1. Captura nativa a máxima resolución (Retina 2x)
        cmd = ["screencapture", "-x", ruta_retina]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0 or not os.path.exists(ruta_retina):
            img_raw = ImageGrab.grab()
            img_raw.save(ruta_retina)
        else:
            img_raw = Image.open(ruta_retina)

        # 2. Redimensionar a la resolución REAL de la pantalla (1:1 para clics)
        img_1x = img_raw.resize((self.logico_w, self.logico_h), Image.Resampling.LANCZOS)
        img_1x.save(ruta_1x)

        # 3. Opcional: Generar versión con cuadrícula de coordenadas dibujadas
        ruta_guia_creada = None
        if generar_guia:
            ruta_guia_creada = self._generar_imagen_con_guia(img_1x.copy(), RUTA_CAPTURA_GUIA)

        return {
            "archivo_1x": ruta_1x,
            "dimensiones_1x": (self.logico_w, self.logico_h),
            "archivo_retina": ruta_retina,
            "dimensiones_retina": (self.fisico_w, self.fisico_h),
            "archivo_guia": ruta_guia_creada,
            "escala": (self.escala_x, self.escala_y),
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

    def _generar_imagen_con_guia(self, img, ruta_salida):
        """Dibuja una cuadrícula milimétrica con números de coordenadas sobre la imagen."""
        draw = ImageDraw.Draw(img)
        w, h = img.size

        # Líneas verticales cada 100px
        for x in range(0, w, 100):
            color = (255, 0, 0, 180) if x % 200 == 0 else (255, 255, 255, 100)
            draw.line([(x, 0), (x, h)], fill=color, width=1)
            draw.text((x + 2, 5), f"X={x}", fill=(255, 255, 0))

        # Líneas horizontales cada 100px
        for y in range(0, h, 100):
            color = (255, 0, 0, 180) if y % 200 == 0 else (255, 255, 255, 100)
            draw.line([(0, y), (w, y)], fill=color, width=1)
            draw.text((5, y + 2), f"Y={y}", fill=(255, 255, 0))

        img.save(ruta_salida)
        return ruta_salida

    def pixel_a_click(self, x, y):
        """Retorna las coordenadas de clic 1:1."""
        return int(round(x)), int(round(y))


screen_helper = ScreenHelper()


# =====================================================================
# CLI
# =====================================================================
def imprimir_banner():
    print("=" * 68)
    print(" 🖥️  CAPTURADOR 1:1 - DIMENSIONES REALES DE PANTALLA (PYAUTOGUI)")
    print("=" * 68)


def main():
    parser = argparse.ArgumentParser(
        description="Captura de pantalla con dimensiones exactas 1:1 de macOS para PyAutoGUI"
    )
    parser.add_argument("--delay", "-d", type=float, default=1.0, help="Segundos de espera antes de capturar (default: 1.0s)")
    parser.add_argument("--guia", "-g", action="store_true", help="Generar además versión con regla y cuadrícula de coordenadas")
    parser.add_argument("--salida", "-s", type=str, default=None, help="Nombre del archivo de salida 1:1")
    parser.add_argument("--info", action="store_true", help="Mostrar información de pantalla")

    args = parser.parse_args()

    if args.info:
        imprimir_banner()
        w, h = pg.size()
        raw_w, raw_h = ImageGrab.grab().size
        print(f"📐 Dimensiones Reales de Pantalla (Clics): {w} x {h} pt")
        print(f"🔍 Resolución Nativa del Sensor (Retina):  {raw_w} x {raw_h} px")
        print(f"⚙️ Factor de Escala:                      {raw_w/w:.1f}x")
        return

    imprimir_banner()
    ruta_salida_1x = os.path.abspath(args.salida) if args.salida else RUTA_CAPTURA_1X
    
    info = screen_helper.capturar_pantalla_1a1(
        ruta_1x=ruta_salida_1x,
        delay_seg=args.delay,
        generar_guia=args.guia
    )

    print("\n✅ ¡Captura 1:1 generada con éxito!")
    print(f"📁 Imagen 1:1 (Para medir clics):  {info['archivo_1x']}")
    print(f"   └─ Dimensiones exactas:         {info['dimensiones_1x'][0]} x {info['dimensiones_1x'][1]} px (Igual a la pantalla)")
    print(f"📁 Imagen Retina 2x (Alta def):    {info['archivo_retina']}")
    print(f"   └─ Dimensiones físicas:         {info['dimensiones_retina'][0]} x {info['dimensiones_retina'][1]} px")
    
    if info['archivo_guia']:
        print(f"📁 Imagen con Regla y Coordenadas: {info['archivo_guia']}")

    print("\n🎯 REGLA DE ORO 1:1:")
    print(f"  Cualquier coordenada (X, Y) que midas en '{os.path.basename(info['archivo_1x'])}'")
    print(f"  es DIRECTAMENTE la coordenada que debes poner en 'pg.click(x=X, y=Y)' sin dividir nada.\n")


if __name__ == "__main__":
    main()
