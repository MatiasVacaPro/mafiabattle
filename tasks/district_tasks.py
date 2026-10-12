import random
from typing import Any, Dict, List, Optional
from core.logger import log_msg
from tasks.base_task import BaseTask

# Mapeo de identificadores de distrito a IDs de crimen en el motor del juego
DISTRICT_CRIME_MAP = {
    "celebrities_district": "26",
    "shopping_street": "16",
    "jardin_clasico": "21",
    "mafiosi_district": "28",
    "residential_area": "23",
    "billonari_club": "30"
}


class DistrictTask(BaseTask):
    """Tarea reutilizable para cualquier distrito o barrio."""

    def __init__(
        self,
        district_id: str,
        name: str,
        interval_seconds: float,
        coords: Dict[str, Any],
        initial_delay: float = 0.0,
        description: str = ""
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description or name, initial_delay=initial_delay)
        self.district_id = district_id
        self.coords = coords

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        # 1. Modo BiDi en segundo plano (Enfoque A y C)
        is_bidi = getattr(input_ctrl, "is_bidi_mode", False)
        if is_bidi is True and getattr(input_ctrl, "bridge", None) is not None:
            options = self.coords.get("options", [[]])
            num_opts = max(1, len(options))
            idx = state_manager.get_and_increment_district_index(self.district_id, num_opts)
            log_msg(self.name, "ejecutando", f"Ejecutando actividad del distrito vía BiDi (Opción #{idx + 1}/{num_opts})...")
            success, reason = input_ctrl.bridge.perform_district_crime(self.district_id, option_index=idx)
            if success:
                log_msg(self.name, "completado", f"Crimen de {self.name} realizado con éxito.")
                return True
            else:
                log_msg(self.name, "alerta", f"Crimen en {self.name} pospuesto/no completado: {reason}")
                return False

        # 2. Modo Legacy con coordenadas físicas
        nav_click = self.coords.get("nav_click", [740, 967])
        nav_sub = self.coords.get("nav_sub")
        x_range = self.coords.get("x_range", [500, 700])
        y_fixed = self.coords.get("y_fixed", 770)
        options = self.coords.get("options", [])

        if not options:
            log_msg(self.name, "error", "No se definieron opciones para este distrito.")
            return False

        input_ctrl.double_click(nav_click[0], nav_click[1], delay_after=1.0)
        if nav_sub:
            input_ctrl.double_click(nav_sub[0], nav_sub[1], delay_after=1.0)

        rand_x = random.randint(x_range[0], x_range[1])
        input_ctrl.double_click(rand_x, y_fixed, delay_after=1.0)

        idx = state_manager.get_and_increment_district_index(self.district_id, len(options))
        opt_x, opt_y = options[idx]
        log_msg(self.name, "ejecutando", f"Clic en opción #{idx + 1} de {len(options)}: ({opt_x}, {opt_y})")
        input_ctrl.double_click(opt_x, opt_y, delay_after=1.8)
        return True
