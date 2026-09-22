import sys
import threading
import time
from typing import Optional
import pyautogui as pg

from core.logger import log_msg

# Fail-safe habilitado
pg.FAILSAFE = True

class PausableLock:
    """Lock que espera automáticamente mientras el sistema esté en pausa antes de permitir clicks."""
    def __init__(self, controller: 'InputController'):
        self._controller = controller
        self._lock = threading.Lock()

    def __enter__(self):
        while self._controller.is_paused:
            self._controller.pause_event.wait(0.2)
        self._lock.acquire()
        while self._controller.is_paused:
            self._lock.release()
            self._controller.pause_event.wait(0.2)
            self._lock.acquire()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._lock.release()


class InputController:
    """Controlador centralizado y seguro de mouse, teclado y estados de pausa."""

    def __init__(self):
        self.is_paused = False
        self.pause_event = threading.Event()
        self.pause_event.set()
        self._last_toggle_time = 0.0
        self.lock = PausableLock(self)
        self._keyboard_listener = None

    def toggle_pause(self) -> bool:
        """Alterna el estado de pausa del bot."""
        ahora = time.time()
        if ahora - self._last_toggle_time < 0.25:
            return self.is_paused
        
        self._last_toggle_time = ahora
        self.is_paused = not self.is_paused
        
        if self.is_paused:
            self.pause_event.clear()
            log_msg("SISTEMA", "pausa", "PAUSADO — Clicks en espera (Presiona 'P' para reanudar)")
        else:
            self.pause_event.set()
            log_msg("SISTEMA", "reanudar", "REANUDADO — Ejecutando tareas activas")
            
        return self.is_paused

    def sleep(self, seconds: float) -> None:
        """Espera de forma no bloqueante y respetando pausas."""
        end_time = time.time() + seconds
        while time.time() < end_time:
            while self.is_paused:
                self.pause_event.wait(0.2)
                end_time = time.time() + seconds  # Reiniciar o extender espera
            remaining = end_time - time.time()
            if remaining <= 0:
                break
            time.sleep(min(0.2, remaining))

    def click(self, x: int, y: int, clicks: int = 1, interval: float = 0.1, delay_after: float = 1.0) -> None:
        """Ejecuta un clic seguro coordinado."""
        with self.lock:
            pg.click(x=x, y=y, clicks=clicks, interval=interval)
            if delay_after > 0:
                self.sleep(delay_after)

    def double_click(self, x: int, y: int, delay_after: float = 1.0) -> None:
        """Ejecuta un doble clic seguro."""
        with self.lock:
            pg.doubleClick(x=x, y=y)
            if delay_after > 0:
                self.sleep(delay_after)

    def press(self, key: str, presses: int = 1, interval: float = 0.1, delay_after: float = 0.0) -> None:
        """Presiona una tecla en el teclado."""
        with self.lock:
            pg.press(key, presses=presses, interval=interval)
            if delay_after > 0:
                self.sleep(delay_after)

    def hotkey(self, *keys: str, delay_after: float = 1.0) -> None:
        """Ejecuta una combinación de teclas."""
        with self.lock:
            pg.hotkey(*keys)
            if delay_after > 0:
                self.sleep(delay_after)

    def regresar_al_punto_inicial(self, veces: int = 3, pausa: float = 0.35) -> None:
        """Presiona 'escape' para cerrar modales y volver al punto inicial del juego."""
        with self.lock:
            self.sleep(0.3)
            for _ in range(veces):
                pg.press('escape')
                self.sleep(pausa)

    def ejecutar_login(self) -> None:
        """Secuencia de recarga de página y login en el navegador."""
        log_msg("LOGIN", "ejecutando", "Ejecutando secuencia de login...")
        with self.lock:
            log_msg("LOGIN", "ejecutando", "Recargando página (cmd+r)...")
            pg.hotkey('command', 'r')
            self.sleep(2.0)
            
            log_msg("LOGIN", "ejecutando", "Confirmando con Enter...")
            pg.press('enter')
            self.sleep(5.0)
            
            pg.press('enter')
            self.sleep(2.0)
            pg.press('enter')
            self.sleep(1.0)
            
            # Limpiar posibles diálogos
            self.regresar_al_punto_inicial(veces=2, pausa=0.5)
            log_msg("LOGIN", "completado", "Secuencia de login finalizada.")

    def start_keyboard_listener(self) -> None:
        """Inicia el escuchador global de teclado en segundo plano (tecla 'P')."""
        try:
            from pynput import keyboard
            
            def on_press(key):
                try:
                    if hasattr(key, 'char') and key.char in ['p', 'P']:
                        self.toggle_pause()
                except Exception:
                    pass

            self._keyboard_listener = keyboard.Listener(on_press=on_press)
            self._keyboard_listener.daemon = True
            self._keyboard_listener.start()
            log_msg("SISTEMA", "activo", "Escuchador de atajo 'P' activado.")
        except Exception as e:
            log_msg("SISTEMA", "alerta", f"No se pudo iniciar listener global de teclado: {e}")
