import time
import threading
from typing import Dict, List, Optional
import pyautogui as pg

from core.logger import log_msg
from core.input_controller import InputController
from core.vision_service import VisionService
from core.state_manager import StateManager
from engine.decision_engine import DecisionEngine
from tasks.base_task import BaseTask

class TaskScheduler:
    """Orquestador centralizado de tareas. Elimina colisiones y carreras entre hilos."""

    def __init__(
        self,
        input_controller: InputController,
        vision_service: VisionService,
        state_manager: StateManager,
        decision_engine: DecisionEngine,
        login_on_first_delayed_run: bool = True
    ):
        self.input_ctrl = input_controller
        self.vision = vision_service
        self.state_mgr = state_manager
        self.decision_engine = decision_engine
        self.login_on_first_delayed_run = login_on_first_delayed_run
        
        self.tasks: List[BaseTask] = []
        self.high_priority_tasks: List[BaseTask] = []
        self._running = False
        self._first_task_run = False

    def add_task(self, task: BaseTask) -> None:
        """Registra una tarea en el planificador."""
        if getattr(task, "is_high_priority", False):
            self.high_priority_tasks.append(task)
        else:
            self.tasks.append(task)
        log_msg("SCHEDULER", "activo", f"Registrada tarea: {task.name} ({task.description})")

    def start(self) -> None:
        """Inicia el bucle principal de planificación."""
        self._running = True
        log_msg("SCHEDULER", "activo", f"Iniciado TaskScheduler con {len(self.tasks)} tareas y {len(self.high_priority_tasks)} de alta prioridad.")
        
        # Iniciar escuchador global de teclado
        self.input_ctrl.start_keyboard_listener()

        try:
            while self._running:
                now = time.time()

                # Verificar si el usuario está interactuando (tolerancia a injerencia humana)
                if self.input_ctrl.is_user_interfering():
                    self.input_ctrl.sleep(0.5)
                    continue

                # 1. Ejecutar tareas de alta prioridad (e.g. Anti-Inactividad)
                for hp_task in self.high_priority_tasks:
                    if self.input_ctrl.is_user_interfering():
                        break
                    if hp_task.can_run(now, self.state_mgr):
                        hp_task.run(self.input_ctrl, self.vision, self.state_mgr, self.decision_engine)

                # Si el sistema está pausado o el usuario interactúa, esperar
                if self.input_ctrl.is_paused or self.input_ctrl.is_user_interfering():
                    self.input_ctrl.sleep(0.5)
                    continue

                # 2. Buscar tareas regulares listas para ejecutarse
                ready_tasks = [t for t in self.tasks if t.can_run(now, self.state_mgr)]

                if ready_tasks:
                    for task in ready_tasks:
                        if not self._running:
                            break
                        if self.input_ctrl.is_paused or self.input_ctrl.is_user_interfering():
                            break
                            
                        # Manejo de login en el primer arranque si tenía retraso
                        if not self._first_task_run and task.initial_delay > 0 and self.login_on_first_delayed_run:
                            self.input_ctrl.ejecutar_login()
                        self._first_task_run = True

                        # Ejecutar tarea de forma ordenada y aislada
                        task.run(self.input_ctrl, self.vision, self.state_mgr, self.decision_engine)
                        
                        # Pequeño respiro entre tareas para estabilidad de la interfaz
                        self.input_ctrl.sleep(1.0)
                else:
                    # Espera adaptativa corta para no quemar CPU y permitir que Anti-Idle siga vigilando
                    self.input_ctrl.sleep(0.5)

        except KeyboardInterrupt:
            log_msg("SCHEDULER", "alerta", "Detención solicitada por el usuario (Ctrl+C).")
        except pg.FailSafeException:
            log_msg("SCHEDULER", "error", "FailSafe activado (cursor en la esquina de la pantalla).")
        finally:
            self.stop()

    def stop(self) -> None:
        """Detiene la ejecución del planificador."""
        self._running = False
        if getattr(self.input_ctrl, "bidi", None):
            try:
                self.input_ctrl.bidi.close()
            except Exception:
                pass
        log_msg("SCHEDULER", "completado", "TaskScheduler detenido.")
