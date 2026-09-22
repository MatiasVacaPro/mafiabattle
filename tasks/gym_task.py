import time
from typing import Any, Dict
from core.logger import log_msg
from tasks.base_task import BaseTask

class GymTask(BaseTask):
    """Tarea de entrenamiento en el Gimnasio con gestión de cooldown de 24 horas."""

    def __init__(
        self,
        name: str = "Gym",
        interval_seconds: float = 300.0,
        coords: Optional[Dict[str, Any]] = None,
        cooldown_24h: float = 86400.0,
        max_loops: int = 8,
        displace_once: bool = True,
        initial_delay: float = 0.0,
        description: str = "Entrenamiento en Gimnasio"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description, initial_delay=initial_delay)
        self.coords = coords or {}
        self.cooldown_24h = cooldown_24h
        self.max_loops = max_loops
        self.displace_once = displace_once

    def can_run(self, now: float, state_manager) -> bool:
        """Verifica si transcurrió el cooldown de 24h y el intervalo."""
        can_gym, horas_restantes = state_manager.can_run_gym(self.cooldown_24h)
        if not can_gym:
            return False
        return super().can_run(now, state_manager)

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        btn_gimnasio = self.coords.get("btn_gimnasio", [470, 975])
        btn_entrenar = self.coords.get("btn_entrenar", [841, 732])
        btn_desplazar = self.coords.get("btn_desplazar", [1173, 540])
        btn_ejercicio = self.coords.get("btn_ejercicio_opcion", [849, 748])

        for loop_num in range(1, self.max_loops + 1):
            log_msg(self.name, "ejecutando", f"Ejecutando iteración {loop_num} de {self.max_loops} en Gimnasio...")
            
            # 1. Abrir gimnasio
            input_ctrl.double_click(btn_gimnasio[0], btn_gimnasio[1], delay_after=1.0)
            
            # 2. Botón Entrenar
            input_ctrl.click(btn_entrenar[0], btn_entrenar[1], delay_after=1.0)

            # 3. Desplazamiento condicional al ejercicio más eficiente
            debe_desplazar = True
            if self.displace_once and state_manager.gym_displaced:
                debe_desplazar = False
            
            if debe_desplazar:
                log_msg(self.name, "ejecutando", "Realizando desplazamiento de rutina de ejercicios...")
                for _ in range(3):
                    input_ctrl.click(btn_desplazar[0], btn_desplazar[1], delay_after=1.0)
                state_manager.gym_displaced = True

            # 4. Seleccionar ejercicio
            input_ctrl.click(btn_ejercicio[0], btn_ejercicio[1], delay_after=1.0)

            # Cerrar modal para la siguiente iteración
            input_ctrl.regresar_al_punto_inicial(veces=2, pausa=0.3)
            
            if loop_num < self.max_loops:
                input_ctrl.sleep(1.5)

        return True
