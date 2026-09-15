#!/usr/bin/env python3
"""
Script de Verificación y Diagnóstico del Entorno MafiaBattle
===========================================================
Diseñado para que cualquier agente o desarrollador verifique al 100%
que el entorno, librerías, permisos de macOS y recursos visuales
están listos para ejecutar el bot sin errores.
"""

import sys
import os
import platform

def print_header(title):
    print("\n" + "=" * 65)
    print(f"  {title}")
    print("=" * 65)

def main():
    print_header("DIAGNÓSTICO DEL ENTORNO MAFIABATTLE")
    errores = []
    advertencias = []

    # 1. Sistema Operativo y Python
    print(f"• Sistema Operativo: {platform.system()} {platform.release()} ({platform.machine()})")
    print(f"• Versión de Python: {sys.version.split()[0]} ({sys.executable})")
    if sys.version_info < (3, 10):
        errores.append("Se requiere Python >= 3.10 (probado con éxito en 3.13 y 3.14).")

    # 2. Comprobación de Módulos Python
    print("\n[1/4] Verificando dependencias de Python...")
    modulos = [
        ("pyautogui", "PyAutoGUI (control de mouse/teclado)"),
        ("PIL", "Pillow (procesamiento de imágenes)"),
        ("pynput", "pynput (atajos globales de teclado 'P')"),
        ("Foundation", "PyObjC Foundation"),
        ("Vision", "PyObjC Apple Vision (OCR nativo macOS)"),
        ("Quartz", "PyObjC Quartz (CoreGraphics / ScreenCapture)"),
        ("ApplicationServices", "PyObjC ApplicationServices (Comprobación de permisos TCC)"),
    ]

    for mod, desc in modulos:
        try:
            __import__(mod)
            print(f"  ✅ {desc}: OK")
        except ImportError as e:
            print(f"  ❌ {desc}: FALTANTE ({e})")
            errores.append(f"Módulo faltante: {mod}. Instalar con 'pip install -r requirements.txt'")

    # Módulos opcionales
    try:
        import pytesseract
        print("  ℹ️  pytesseract: Disponible (OCR de respaldo)")
    except ImportError:
        print("  ℹ️  pytesseract: No instalado (opcional, Apple Vision es el primario)")

    # 3. Comprobación de Permisos de macOS (TCC)
    print("\n[2/4] Verificando permisos de seguridad de macOS...")
    
    # 3.1 Accesibilidad
    try:
        import ApplicationServices
        es_confiable = ApplicationServices.AXIsProcessTrusted()
        if es_confiable:
            print("  ✅ Permiso de Accesibilidad (Accessibility): CONCEDIDO")
        else:
            print("  ❌ Permiso de Accesibilidad (Accessibility): DENEGADO / PENDIENTE")
            advertencias.append(
                "macOS requiere permiso de Accesibilidad para mover el mouse y enviar teclas.\n"
                "     Configúralo en: Ajustes del Sistema > Privacidad y seguridad > Accesibilidad\n"
                "     Agrega y activa tu aplicación de Terminal / Cursor / VSCode / Python."
            )
    except Exception as e:
        print(f"  ⚠️  No se pudo consultar AXIsProcessTrusted: {e}")

    # 3.2 Grabación de pantalla y Resolución
    try:
        import pyautogui as pg
        res = pg.size()
        print(f"  ✅ Detección de pantalla PyAutoGUI: {res.width}x{res.height}")
        
        if res.width == 1680 and res.height == 1050:
            print("  ✅ Resolución del monitor coincide exactamente con la calibración del bot (1680x1050).")
        else:
            print(f"  ⚠️  Resolución actual: {res.width}x{res.height}. El bot fue calibrado para 1680x1050.")
            advertencias.append(
                f"La resolución detectada es {res.width}x{res.height}, pero las coordenadas fijas del bot\n"
                "     están calibradas para 1680x1050. Si los clicks fallan, ajusta la pantalla a 1680x1050\n"
                "     o usa 'python coordenadas.py' / 'python captura_desktop.py' para recalibrar."
            )

        # Probar captura real
        captura = pg.screenshot(region=(0, 0, 20, 20))
        if captura and captura.size[0] > 0:
            print(f"  ✅ Prueba de captura de pantalla: Exitosa ({captura.size[0]}x{captura.size[1]} px)")
        else:
            print("  ❌ Prueba de captura de pantalla: Falló (Retornó imagen vacía)")
            errores.append(
                "Falta permiso de Grabación de Pantalla (Screen Recording).\n"
                "     Configúralo en: Ajustes del Sistema > Privacidad y seguridad > Grabación de pantalla"
            )
    except Exception as e:
        print(f"  ❌ Error al capturar pantalla: {e}")
        advertencias.append("Asegúrate de conceder permisos de 'Grabación de pantalla' en Ajustes de macOS.")

    # 4. Comprobación de Recursos Visuales (Crops / Plantillas)
    print("\n[3/4] Verificando imágenes y plantillas visuales...")
    directorio_actual = os.path.dirname(os.path.abspath(__file__))
    archivos_clave = [
        "crop_bottom_casino_icon.png",
        "crop_btn_close_x.png",
        "crop_btn_higher.png",
        "crop_btn_lower.png",
        "crop_btn_only.png",
        "crop_idle_modal.png",
        "crop_reload_btn.png",
        "crop_tab_higher_lower.png",
        "crop_tab_ruleta.png",
        "crop_test_user.png",
        "debug_numero.png",
        "autoclicker.py",
        "anti_inactividad.py",
        "mayor_menor.py",
        "captura_desktop.py",
        "coordenadas.py",
        "ordenes",
        "run.sh"
    ]

    faltantes = [f for f in archivos_clave if not os.path.exists(os.path.join(directorio_actual, f))]
    if faltantes:
        print(f"  ❌ Archivos faltantes: {faltantes}")
        errores.append(f"Faltan los siguientes archivos esenciales: {', '.join(faltantes)}")
    else:
        print(f"  ✅ Todos los {len(archivos_clave)} archivos y plantillas clave están presentes.")

    # Resumen
    print("\n[4/4] Resumen de Diagnóstico")
    print("-" * 65)
    if not errores and not advertencias:
        print("🎉 ¡TODO PERFECTO! El entorno está 100% operativo para ejecutar MafiaBattle.")
        print("   Ejecuta: ./run.sh")
        return 0
    elif not errores and advertencias:
        print("⚠️  El entorno está instalado, pero hay advertencias que debes revisar:")
        for adv in advertencias:
            print(f"   - {adv}")
        print("\nSi los permisos de macOS ya están listos, puedes ejecutar: ./run.sh")
        return 0
    else:
        print("❌ Se encontraron errores críticos que impiden la ejecución:")
        for err in errores:
            print(f"   - {err}")
        if advertencias:
            print("\nAdvertencias:")
            for adv in advertencias:
                print(f"   - {adv}")
        print("\nResuelve los errores anteriores antes de ejecutar el bot.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
