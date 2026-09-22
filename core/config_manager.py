import json
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

class ConfigManager:
    """Administra la configuración del bot y las coordenadas visuales desde archivos JSON."""

    def __init__(self, config_dir: Optional[str] = None):
        if config_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            config_dir = os.path.join(base_dir, "config")
        
        self.config_dir = config_dir
        self.config_path = os.path.join(config_dir, "config.json")
        self.coords_path = os.path.join(config_dir, "coordinates.json")
        
        self._config: Dict[str, Any] = {}
        self._coords: Dict[str, Any] = {}
        self.reload()

    def reload(self) -> None:
        """Recarga los archivos de configuración desde el disco."""
        if not os.path.exists(self.config_path):
            raise FileNotFoundError(f"Archivo de configuración no encontrado: {self.config_path}")
        if not os.path.exists(self.coords_path):
            raise FileNotFoundError(f"Archivo de coordenadas no encontrado: {self.coords_path}")
            
        with open(self.config_path, "r", encoding="utf-8") as f:
            self._config = json.load(f)
            
        with open(self.coords_path, "r", encoding="utf-8") as f:
            self._coords = json.load(f)

    @property
    def config(self) -> Dict[str, Any]:
        return self._config

    @property
    def coordinates(self) -> Dict[str, Any]:
        return self._coords

    def get_task_config(self, task_name: str) -> Dict[str, Any]:
        """Obtiene la configuración específica para una tarea."""
        return self._config.get("tasks", {}).get(task_name, {})

    def is_task_enabled(self, task_name: str) -> bool:
        """Verifica si una tarea está habilitada en la configuración."""
        return bool(self.get_task_config(task_name).get("enabled", False))

    def get_district_config(self, district_name: str) -> Dict[str, Any]:
        """Obtiene las coordenadas y opciones de un distrito."""
        return self._coords.get("districts", {}).get(district_name, {})

    def get_coord(self, section: str, key: str) -> Tuple[int, int]:
        """Obtiene una coordenada (x, y) de una sección de coordenadas."""
        data = self._coords.get(section, {})
        val = data.get(key)
        if val is None or len(val) != 2:
            raise KeyError(f"Coordenada no encontrada: [{section}][{key}]")
        return (val[0], val[1])

    def get_region(self, section: str, key: str) -> Tuple[int, int, int, int]:
        """Obtiene una región (x, y, ancho, alto) de una sección de coordenadas."""
        data = self._coords.get(section, {})
        val = data.get(key)
        if val is None or len(val) != 4:
            raise KeyError(f"Región no encontrada: [{section}][{key}]")
        return (val[0], val[1], val[2], val[3])

    @staticmethod
    def parse_delay_string(user_input: str) -> float:
        """
        Parsea un string de tiempo y devuelve los segundos correspondientes.
        Soporta:
        - Vacío -> 0
        - "3h", "45m", "120s", "3.5h", "2h 23m"
        - Hora exacta HH:MM (ej: "17:30")
        """
        if not user_input:
            return 0.0
        
        user_input = str(user_input).strip().lower()
        if not user_input:
            return 0.0

        # Formato HH:MM
        time_match = re.match(r"^(\d{1,2}):(\d{2})$", user_input)
        if time_match:
            hour = int(time_match.group(1))
            minute = int(time_match.group(2))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError(f"Hora inválida en formato HH:MM: {user_input}")
            now = datetime.now()
            target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if target < now:
                target += timedelta(days=1)
            return (target - now).total_seconds()

        # Si es solo un número entero sin unidad, asumimos horas
        if user_input.isdigit():
            return float(user_input) * 3600.0

        parts = re.findall(r"(\d+(?:\.\d+)?)\s*([hms]?)", user_input)
        if not parts:
            raise ValueError(f"Formato de tiempo no reconocido: {user_input}")

        total_seconds = 0.0
        for val_str, unit in parts:
            val = float(val_str)
            if unit == 'h' or unit == '':
                total_seconds += val * 3600.0
            elif unit == 'm':
                total_seconds += val * 60.0
            elif unit == 's':
                total_seconds += val

        return total_seconds
