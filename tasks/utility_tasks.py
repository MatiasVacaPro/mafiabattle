from typing import Any, Dict, Optional
from core.logger import log_msg
from tasks.base_task import BaseTask

class MasVidaTask(BaseTask):
    """Tarea de recarga de vida con intervalo dinámico según temporizadores activos."""

    def __init__(
        self,
        name: str = "Mas_Vida",
        interval_seconds: float = 3607.0,
        coords: Optional[Dict[str, Any]] = None,
        active_timers_count: int = 4,
        initial_delay: float = 0.0,
        description: str = "Recarga de Vida"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description, initial_delay=initial_delay)
        self.coords = coords or {}
        self.active_timers_count = active_timers_count
        self.update_interval(active_timers_count)

    def update_interval(self, active_count: int) -> None:
        """Calcula el intervalo según la cantidad de tareas con temporizador activas."""
        self.active_timers_count = active_count
        if active_count >= 4:
            horas = 1.0
        elif active_count == 3:
            horas = 1.5
        elif active_count == 2:
            horas = 2.0
        else:
            horas = 3.0
        self.interval_seconds = int(horas * 3600) + 7

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        # 1. Modo BiDi en segundo plano (Enfoque A y C)
        is_bidi = getattr(input_ctrl, "is_bidi_mode", False)
        if is_bidi is True and getattr(input_ctrl, "bridge", None) is not None:
            stats = input_ctrl.bridge.get_player_stats()
            health = stats.get("health", 0)
            log_msg(self.name, "activo", f"Salud actual del jugador: {health}. Verificando recuperación...")
            input_ctrl.bridge.close_all_modals()
            return True

        # 2. Modo Legacy con coordenadas físicas
        icon_vida = self.coords.get("icon_vida", [893, 103])
        btn_sumar = self.coords.get("btn_sumar", [1078, 554])
        clicks_count = self.coords.get("clicks_count", 8)

        input_ctrl.double_click(icon_vida[0], icon_vida[1], delay_after=1.0)
        for i in range(clicks_count):
            input_ctrl.click(btn_sumar[0], btn_sumar[1], delay_after=1.0)

        return True


class RecolectorPiedrasTask(BaseTask):
    """Recolector de gemas y piedras preciosas cada 3 horas."""

    def __init__(
        self,
        name: str = "Recolector_Piedras",
        interval_seconds: float = 10800.0,
        coords: Optional[Dict[str, Any]] = None,
        initial_delay: float = 0.0,
        description: str = "Recolector de Piedras Preciosas"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description, initial_delay=initial_delay)
        self.coords = coords or {}

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        # 1. Modo BiDi en segundo plano (Enfoque A y C)
        is_bidi = getattr(input_ctrl, "is_bidi_mode", False)
        if is_bidi is True and getattr(input_ctrl, "bridge", None) is not None:
            log_msg(self.name, "ejecutando", "Recolectando piedras preciosas vía BiDi...")
            success = input_ctrl.bridge.collect_gemstones()
            if success:
                log_msg(self.name, "completado", "Piedras añadidas al inventario con éxito.")
            return success

        # 2. Modo Legacy con coordenadas físicas
        icon_piedras = self.coords.get("icon_piedras", [418, 722])
        btn_recolectar = self.coords.get("btn_recolectar", [739, 575])

        input_ctrl.double_click(icon_piedras[0], icon_piedras[1], delay_after=1.0)
        input_ctrl.click(btn_recolectar[0], btn_recolectar[1], delay_after=1.0)
        return True


class FabricacionTask(BaseTask):
    """Fabricación de Cristal en el Laboratorio cada 2 horas."""

    def __init__(
        self,
        name: str = "Fabricacion_Cristal",
        interval_seconds: float = 7200.0,
        coords: Optional[Dict[str, Any]] = None,
        initial_delay: float = 0.0,
        description: str = "Fabricación de Cristal"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description, initial_delay=initial_delay)
        self.coords = coords or {}

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        # 1. Modo BiDi en segundo plano (Enfoque A y C)
        is_bidi = getattr(input_ctrl, "is_bidi_mode", False)
        if is_bidi is True and getattr(input_ctrl, "bridge", None) is not None:
            log_msg(self.name, "ejecutando", "Iniciando cocinado de Cristal / Meth en laboratorio vía BiDi...")
            success = input_ctrl.bridge.produce_meth_crystal()
            if success:
                log_msg(self.name, "completado", "Producción de Cristal iniciada exitosamente.")
            return success

        # 2. Modo Legacy con coordenadas físicas
        btn_fabrica = self.coords.get("btn_fabrica", [545, 673])
        btn_lab = self.coords.get("btn_lab", [841, 729])
        btn_cocinar = self.coords.get("btn_cocinar", [836, 744])

        input_ctrl.double_click(btn_fabrica[0], btn_fabrica[1], delay_after=1.0)
        input_ctrl.click(btn_lab[0], btn_lab[1], delay_after=1.0)
        input_ctrl.click(btn_cocinar[0], btn_cocinar[1], delay_after=1.8)
        return True


class ImperiumCollectTask(BaseTask):
    """Recolector recurrente de ganancias y producción en edificios del imperio (Tattoo, Press, Meth, Ammo, Nightclub, Gemstones)."""

    def __init__(
        self,
        name: str = "Imperium_Edificios",
        interval_seconds: float = 120.0,
        coords: Optional[Dict[str, Any]] = None,
        initial_delay: float = 0.0,
        description: str = "Recolección de Edificios del Imperio"
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description, initial_delay=initial_delay)
        self.coords = coords or {}

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        # 1. Modo BiDi en segundo plano (Enfoque A y C)
        is_bidi = getattr(input_ctrl, "is_bidi_mode", False)
        if is_bidi is True and getattr(input_ctrl, "bridge", None) is not None:
            res = input_ctrl.bridge.collect_empire_buildings()
            collected = res.get("collected", [])
            if collected:
                log_msg(self.name, "completado", f"Recolección exitosa de edificios: {', '.join(collected)}")
            else:
                log_msg(self.name, "espera", "No hay edificios listos para recolectar en este ciclo.")
            return True

        # 2. Modo Legacy con coordenadas físicas
        return True
