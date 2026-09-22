from abc import ABC, abstractmethod
import time
from typing import Optional, TYPE_CHECKING
import pyautogui as pg

from core.logger import log_msg

if TYPE_CHECKING:
    from core.input_controller import InputController
    from core.vision_service import VisionService
    from core.state_manager import StateManager


class BaseTask(ABC):
    """Clase base abstracta para todas las tareas del bot."""

    def __init__(self, name: str, interval_seconds: float, description: str = "", initial_delay: float = 0.0):
        self.name = name
        self.interval_seconds = interval_seconds
        self.description = description or name
        self.initial_delay = initial_delay
        self.created_at = time.time()
        self.is_high_priority = False

    def time_until_next_run(self, now: float, state_manager: 'StateManager') -> float:
        """Calcula el tiempo restante en segundos antes de que la tarea deba ejecutarse."""
        last_run = state_manager.get_last_run(self.name)
        
        # Si nunca se ha ejecutado, considerar el retraso inicial desde el arranque
        if last_run == 0.0:
            elapsed_since_start = now - self.created_at
            remaining_delay = self.initial_delay - elapsed_since_start
            return max(0.0, remaining_delay)
            
        elapsed = now - last_run
        return max(0.0, self.interval_seconds - elapsed)

    def can_run(self, now: float, state_manager: 'StateManager') -> bool:
        """Determina si la tarea está lista para ser ejecutada."""
        return self.time_until_next_run(now, state_manager) <= 0.0

    def run(self, input_ctrl: 'InputController', vision: 'VisionService', state_manager: 'StateManager', decision_engine = None) -> bool:
        """
        Plantilla de ejecución segura (Template Method).
        Garantiza:
        1. Limpieza preventiva con escape.
        2. Manejo de excepciones y logging.
        3. Retorno al punto inicial garantizado en bloque finally.
        4. Actualización del timestamp de ejecución en StateManager.
        """
        log_msg(self.name, "ejecutando", f"Iniciando ejecución de {self.description}...")
        success = False
        try:
            success = self.execute(input_ctrl, vision, state_manager, decision_engine)
            if success:
                state_manager.record_task_run(self.name)
                log_msg(self.name, "completado", f"Finalizado exitosamente.")
            else:
                log_msg(self.name, "alerta", f"Ejecución completada sin cambios o abortada limpiamente.")
            return success
        except pg.FailSafeException:
            log_msg(self.name, "error", "Fail-safe de PyAutoGUI activado (cursor en la esquina).")
            raise
        except Exception as e:
            log_msg(self.name, "error", f"Error durante la ejecución: {e}")
            return False
        finally:
            try:
                # Regreso seguro al punto inicial garantizado tras cada tarea
                input_ctrl.regresar_al_punto_inicial(veces=3, pausa=0.35)
            except Exception:
                pass

    @abstractmethod
    def execute(self, input_ctrl: 'InputController', vision: 'VisionService', state_manager: 'StateManager', decision_engine = None) -> bool:
        """Lógica específica de la tarea que deben implementar las subclases."""
        pass
