import pyautogui as pg
import time
import sys

def mostrar_coordenadas():
    print("=========================================================")
    print("          VISUALIZADOR DE COORDENADAS (MAFIABATTLE)      ")
    print("=========================================================")
    print(f"Resolución de pantalla detectada: {pg.size()}")
    print("Mueve el mouse por la pantalla para ver la posición actual.")
    print("Para salir del programa, presiona Ctrl+C en la terminal.")
    print("=========================================================\n")
    
    try:
        # Esto iniciará el visualizador interactivo integrado de pyautogui
        pg.displayMousePosition()
    except KeyboardInterrupt:
        print("\n\nVisualizador detenido. ¡Listo!")
        sys.exit(0)

if __name__ == "__main__":
    mostrar_coordenadas()
