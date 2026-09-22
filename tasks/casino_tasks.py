import random
import time
from typing import Any, Dict, Optional
from core.logger import log_msg
from tasks.base_task import BaseTask

class RuletaTask(BaseTask):
    """Tarea automatizada para la Ruleta del Casino."""

    def __init__(
        self,
        name: str = "Ruleta",
        interval_seconds: float = 1800.0,
        coords: Optional[Dict[str, Any]] = None,
        initial_delay: float = 0.0,
        description: str = "Ruleta del Casino (30 min)"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description, initial_delay=initial_delay)
        self.coords = coords or {}

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        icon_barra = self.coords.get("icon_barra", [880, 973])
        opcion_x_range = self.coords.get("opcion_x_range", [552, 684])
        opcion_y = self.coords.get("opcion_y", 468)
        spin_x_range = self.coords.get("spin_x_range", [554, 699])
        spin_y = self.coords.get("spin_y", 685)
        animacion_wait = self.coords.get("animacion_wait", 20.0)

        # 1. Abrir menú de ruleta
        input_ctrl.double_click(icon_barra[0], icon_barra[1], delay_after=1.0)

        # 2. Seleccionar opción de apuesta
        rand_x_opt = random.randint(opcion_x_range[0], opcion_x_range[1])
        input_ctrl.double_click(rand_x_opt, opcion_y, delay_after=1.0)

        # 3. Presionar botón Spin
        rand_x_spin = random.randint(spin_x_range[0], spin_x_range[1])
        input_ctrl.double_click(rand_x_spin, spin_y, delay_after=2.0)

        # 4. Esperar animación de giro
        log_msg(self.name, "espera", f"Esperando animación de la ruleta ({animacion_wait}s)...")
        input_ctrl.sleep(animacion_wait)

        return True


class MayorMenorTask(BaseTask):
    """Minijuego Mayor o Menor (Higher / Lower) con lectura OCR y toma de decisiones óptimas."""

    def __init__(
        self,
        name: str = "Mayor_Menor",
        interval_seconds: float = 1800.0,
        coords: Optional[Dict[str, Any]] = None,
        max_rounds: int = 10,
        cutoff_value: int = 50,
        initial_delay: float = 0.0,
        description: str = "Minijuego Mayor o Menor"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description, initial_delay=initial_delay)
        self.coords = coords or {}
        self.max_rounds = max_rounds
        self.cutoff_value = cutoff_value

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        icon_barra = self.coords.get("icon_barra", [875, 960])
        tab_pestana = self.coords.get("tab_pestana", [845, 472])
        btn_start = self.coords.get("btn_start", [993, 689])
        region_numero = tuple(self.coords.get("region_numero", [929, 486, 170, 124]))
        btn_mayor = self.coords.get("btn_mayor", [993, 660])
        btn_menor = self.coords.get("btn_menor", [993, 710])
        btn_cerrar = self.coords.get("btn_cerrar_x", [1202, 290])

        # 1. Abrir menú de casino
        input_ctrl.double_click(icon_barra[0], icon_barra[1], delay_after=1.0)

        # 2. Cambiar a la pestaña del juego Mayor o Menor
        input_ctrl.click(tab_pestana[0], tab_pestana[1], delay_after=1.2)

        # 3. Iniciar juego
        input_ctrl.click(btn_start[0], btn_start[1], delay_after=1.5)

        rondas_jugadas = 0
        ultimo_numero = None

        for ronda in range(1, self.max_rounds + 1):
            numero = vision.read_region_number(region_numero)
            
            # Reintento rápido si falló lectura OCR
            if numero is None:
                input_ctrl.sleep(0.5)
                numero = vision.read_region_number(region_numero)

            if numero is None:
                log_msg(self.name, "alerta", f"No se detectó número visible en la ronda {ronda}. Fin de partida.")
                break

            # Toma de decisión: delegada en decision_engine o regla local
            if decision_engine:
                eleccion = decision_engine.decide_higher_lower(numero, self.cutoff_value)
            else:
                eleccion = "HIGHER" if numero <= self.cutoff_value else "LOWER"

            log_msg(self.name, "ejecutando", f"Ronda {ronda}: Número={numero} → Decisión={eleccion}")

            if eleccion == "HIGHER":
                input_ctrl.click(btn_mayor[0], btn_mayor[1], delay_after=1.5)
            else:
                input_ctrl.click(btn_menor[0], btn_menor[1], delay_after=1.5)

            rondas_jugadas += 1
            ultimo_numero = numero

        log_msg(self.name, "completado", f"Partida completada con {rondas_jugadas} rondas jugadas.")
        
        # Cerrar ventana
        input_ctrl.click(btn_cerrar[0], btn_cerrar[1], delay_after=0.5)
        return True
