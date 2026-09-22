from typing import Any, Dict, List, Optional
from core.logger import log_msg
from tasks.base_task import BaseTask

class AntiIdleTask(BaseTask):
    """Monitor de inactividad que detecta modales 'Idle too long' / 'RELOAD' y reactiva la sesión."""

    def __init__(
        self,
        name: str = "Anti_Idle",
        interval_seconds: float = 1.5,
        coords: Optional[Dict[str, Any]] = None,
        description: str = "Monitor Anti-Inactividad"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description)
        self.coords = coords or {}
        self.is_high_priority = True

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        btn_reload = self.coords.get("btn_reload", [838, 688])
        region_modal = tuple(self.coords.get("region_modal", [550, 320, 580, 430]))
        keywords = self.coords.get("keywords", ["IDLE", "RELOAD", "TOO LONG", "RECARGAR"])

        # Verificar si hay modal de inactividad presente en pantalla
        detectado, palabra = vision.check_keywords_in_region(region_modal, keywords)

        if detectado:
            log_msg(self.name, "alerta", f"¡Modal de inactividad detectado por palabra '{palabra}'! Pulsando RELOAD...")
            
            # Doble clic de reactivación
            input_ctrl.double_click(btn_reload[0], btn_reload[1], delay_after=2.0)
            
            # Esperar carga del juego
            log_msg(self.name, "espera", "Esperando 10 segundos para la recarga del juego...")
            input_ctrl.sleep(10.0)
            
            # Restaurar vista principal
            input_ctrl.regresar_al_punto_inicial(veces=3, pausa=0.35)
            log_msg(self.name, "completado", "Sesión reactivada exitosamente.")
            return True

        return True
