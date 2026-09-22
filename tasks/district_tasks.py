import random
from typing import Any, Dict, List, Optional
from core.logger import log_msg
from tasks.base_task import BaseTask

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
        nav_click = self.coords.get("nav_click", [740, 967])
        nav_sub = self.coords.get("nav_sub")
        x_range = self.coords.get("x_range", [500, 700])
        y_fixed = self.coords.get("y_fixed", 770)
        options = self.coords.get("options", [])

        if not options:
            log_msg(self.name, "error", "No se definieron opciones para este distrito.")
            return False

        # 1. Navegar a la barra de barrios
        input_ctrl.double_click(nav_click[0], nav_click[1], delay_after=1.0)

        # 2. Navegación a submenú si aplica (página 2 o 3)
        if nav_sub:
            input_ctrl.double_click(nav_sub[0], nav_sub[1], delay_after=1.0)

        # 3. Clic aleatorio dentro del rango calibrado
        rand_x = random.randint(x_range[0], x_range[1])
        input_ctrl.double_click(rand_x, y_fixed, delay_after=1.0)

        # 4. Clic secuencial ordenado
        idx = state_manager.get_and_increment_district_index(self.district_id, len(options))
        opt_x, opt_y = options[idx]
        log_msg(self.name, "ejecutando", f"Clic en opción #{idx + 1} de {len(options)}: ({opt_x}, {opt_y})")
        input_ctrl.double_click(opt_x, opt_y, delay_after=1.8)

        return True
