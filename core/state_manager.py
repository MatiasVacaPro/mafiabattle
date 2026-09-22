import json
import os
import threading
import time
from typing import Any, Dict, Optional

class StateManager:
    """Administra el estado en memoria y persistente de las tareas del bot."""

    def __init__(self, state_file: Optional[str] = None):
        if state_file is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            state_file = os.path.join(base_dir, "config", "state.json")
        
        self.state_file = state_file
        self._lock = threading.Lock()
        
        # Estado en memoria
        self.is_paused = False
        self.is_game_active = False
        self.district_indices: Dict[str, int] = {}
        self.gym_displaced = False
        self.last_runs: Dict[str, float] = {}
        
        if self.state_file != ":memory:":
            self._load_state()

    def _load_state(self) -> None:
        """Carga el estado previo desde el archivo JSON si existe."""
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.last_runs = data.get("last_runs", {})
                    self.district_indices = data.get("district_indices", {})
                    self.gym_displaced = data.get("gym_displaced", False)
            except Exception:
                pass
        
        # Retrocompatibilidad con gym_last_run.txt
        gym_txt = os.path.join(os.path.dirname(self.state_file), "..", "gym_last_run.txt")
        gym_txt = os.path.abspath(gym_txt)
        if os.path.exists(gym_txt) and "gym" not in self.last_runs:
            try:
                with open(gym_txt, "r") as f:
                    val = f.read().strip()
                    if val:
                        self.last_runs["gym"] = float(val)
            except Exception:
                pass

    def save_state(self) -> None:
        """Guarda el estado actual en el archivo JSON de forma segura."""
        if self.state_file == ":memory:":
            return
        with self._lock:
            data = {
                "last_runs": self.last_runs,
                "district_indices": self.district_indices,
                "gym_displaced": self.gym_displaced,
                "updated_at": time.time()
            }
            try:
                os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
                with open(self.state_file, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
            except Exception:
                pass

    def record_task_run(self, task_name: str, timestamp: Optional[float] = None) -> None:
        """Registra la ejecución exitosa de una tarea."""
        if timestamp is None:
            timestamp = time.time()
        with self._lock:
            self.last_runs[task_name] = timestamp
            if task_name == "gym" and self.state_file != ":memory:":
                # Guardar también en gym_last_run.txt para retrocompatibilidad
                gym_txt = os.path.join(os.path.dirname(self.state_file), "..", "gym_last_run.txt")
                try:
                    with open(os.path.abspath(gym_txt), "w") as f:
                        f.write(str(timestamp))
                except Exception:
                    pass
        self.save_state()

    def get_last_run(self, task_name: str) -> float:
        """Obtiene el timestamp de la última ejecución de una tarea."""
        with self._lock:
            return self.last_runs.get(task_name, 0.0)

    def get_and_increment_district_index(self, district_name: str, options_count: int) -> int:
        """Obtiene el índice secuencial actual para un distrito y lo incrementa."""
        with self._lock:
            current = self.district_indices.get(district_name, 0)
            if options_count > 0:
                self.district_indices[district_name] = (current + 1) % options_count
            return current

    def can_run_gym(self, cooldown_seconds: float = 86400.0) -> Tuple[bool, float]:
        """Comprueba si el gimnasio puede ejecutarse (enfriamiento de 24h)."""
        ultimo = self.get_last_run("gym")
        ahora = time.time()
        transcurrido = ahora - ultimo
        if transcurrido >= cooldown_seconds:
            return True, 0.0
        else:
            horas_restantes = (cooldown_seconds - transcurrido) / 3600.0
            return False, horas_restantes
