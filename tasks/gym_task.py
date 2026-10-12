import time
from typing import Any, Dict, Optional
from core.logger import log_msg
from tasks.base_task import BaseTask

class GymTask(BaseTask):
    """Tarea de entrenamiento en el Gimnasio con gestión de energía y cooldown."""

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
        # 1. Modo BiDi en segundo plano (Enfoque A y C)
        is_bidi = getattr(input_ctrl, "is_bidi_mode", False)
        if is_bidi is True and getattr(input_ctrl, "bridge", None) is not None:
            status = input_ctrl.bridge.check_gym_status()
            avail = status.get("available_sessions", 0)
            max_s = status.get("max_sessions", 10)
            cd = status.get("cooldown_seconds", 0)
            log_msg(self.name, "activo", f"Estado Gimnasio: disponibles={avail}/{max_s}, cooldown={cd}s, puede_entrenar={status.get('can_train')}")

            if not status.get("can_train", False):
                log_msg(self.name, "alerta", f"Gimnasio no disponible actualmente (Sesiones: {avail}, Cooldown: {cd}s, Timers libres: {status.get('free_timers', 0)}).")
                return False

            success = input_ctrl.bridge.train_gym(room="4")
            if success:
                log_msg(self.name, "completado", "Entrenamiento en Gimnasio realizado exitosamente vía BiDi.")
            return success

        # 2. Modo Legacy con coordenadas físicas
        btn_gimnasio = self.coords.get("btn_gimnasio", [470, 975])
        btn_entrenar = self.coords.get("btn_entrenar", [841, 732])
        btn_desplazar = self.coords.get("btn_desplazar", [1173, 540])
        btn_ejercicio = self.coords.get("btn_ejercicio_opcion", [849, 748])

        for loop_num in range(1, self.max_loops + 1):
            log_msg(self.name, "ejecutando", f"Ejecutando iteración {loop_num} de {self.max_loops} en Gimnasio...")
            input_ctrl.double_click(btn_gimnasio[0], btn_gimnasio[1], delay_after=1.0)
            input_ctrl.click(btn_entrenar[0], btn_entrenar[1], delay_after=1.0)

            debe_desplazar = True
            if self.displace_once and state_manager.gym_displaced:
                debe_desplazar = False

            if debe_desplazar:
                log_msg(self.name, "ejecutando", "Realizando desplazamiento de rutina de ejercicios...")
                for _ in range(3):
                    input_ctrl.click(btn_desplazar[0], btn_desplazar[1], delay_after=1.0)
                state_manager.gym_displaced = True

            input_ctrl.click(btn_ejercicio[0], btn_ejercicio[1], delay_after=1.0)
            input_ctrl.regresar_al_punto_inicial(veces=2, pausa=0.3)

            if loop_num < self.max_loops:
                input_ctrl.sleep(1.5)

        return True
