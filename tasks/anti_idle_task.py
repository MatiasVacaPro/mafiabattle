from typing import Any, Dict, List, Optional
from core.logger import log_msg
from tasks.base_task import BaseTask

class AntiIdleTask(BaseTask):
    """Monitor de inactividad que detecta modales 'Idle too long' / 'RELOAD' y mantiene la sesión activa 24/7."""

    def __init__(
        self,
        name: str = "Anti_Idle",
        interval_seconds: float = 2.0,
        coords: Optional[Dict[str, Any]] = None,
        description: str = "Monitor Anti-Inactividad 24/7"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description)
        self.coords = coords or {}
        self.is_high_priority = True

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        # 1. Modo BiDi en segundo plano (Enfoque A y C)
        is_bidi = getattr(input_ctrl, "is_bidi_mode", False)
        if is_bidi is True and getattr(input_ctrl, "bridge", None) is not None:
            is_modal, action = input_ctrl.bridge.anti_idle_tick()
            if is_modal:
                log_msg(self.name, "alerta", f"Modal de inactividad detectado vía DOM. Acción ejecutada: {action}")
                input_ctrl.sleep(2.0)
                input_ctrl.regresar_al_punto_inicial(veces=2, pausa=0.3)
            return True

        # 2. Modo Legacy con Vision OCR
        btn_reload = self.coords.get("btn_reload", [838, 688])
        region_modal = tuple(self.coords.get("region_modal", [550, 320, 580, 430]))
        keywords = self.coords.get("keywords", ["IDLE", "RELOAD", "TOO LONG", "RECARGAR"])

        detectado, palabra = vision.check_keywords_in_region(region_modal, keywords)

        if detectado:
            log_msg(self.name, "alerta", f"¡Modal de inactividad detectado por palabra '{palabra}'! Pulsando RELOAD...")
            input_ctrl.double_click(btn_reload[0], btn_reload[1], delay_after=2.0)
            log_msg(self.name, "espera", "Esperando 10 segundos para la recarga del juego...")
            input_ctrl.sleep(10.0)
            input_ctrl.regresar_al_punto_inicial(veces=3, pausa=0.35)
            log_msg(self.name, "completado", "Sesión reactivada exitosamente.")
            return True

        return True
