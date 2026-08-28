import pyautogui as pg
import time
import random
import sys

# Habilitar el fail-safe de PyAutoGUI: si mueves el cursor a cualquier esquina de la pantalla, el programa se detendrá.
pg.FAILSAFE = True

def ejecutar_bucle():
    print("Iniciando bucle 'scratch'...")
    print("NOTA: Para detener el programa, presiona Ctrl+C o mueve el mouse a una esquina de la pantalla.")
    print("Esperando 2 segundos para que posiciones la ventana...")
    time.sleep(2)
    
    while True:
        try:
            print("\nEjecutando secuencia de clicks...")
            
            # 1. Primer click aleatorio en eje X (Y = 564, X en [1081, 1174])
            x1 = random.randint(1081, 1174)
            print(f"Haciendo doble click en x={x1}, y=564")
            pg.doubleClick(x=x1, y=564)
            time.sleep(1)
            
            # 2. Segundo click aleatorio en eje X (Y = 381, X en [945, 1054])
            x2 = random.randint(945, 1054)
            print(f"Haciendo doble click en x={x2}, y=381")
            pg.doubleClick(x=x2, y=381)
            time.sleep(5)
            
            # 3. Presionar escape una vez
            print("Presionando escape...")
            pg.press('escape')
            time.sleep(1)
            
            # 4. Tercer click aleatorio en eje X (Y = 305, X en [521, 557])
            x3 = random.randint(521, 557)
            print(f"Haciendo doble click en x={x3}, y=305")
            pg.click(x=x3, y=305)
            time.sleep(1)
            
            print("Secuencia completada. Esperando 1 segundo antes de la siguiente iteración...")
            time.sleep(1)
            
        except KeyboardInterrupt:
            print("\nPrograma detenido por el usuario.")
            sys.exit(0)

if __name__ == "__main__":
    ejecutar_bucle()