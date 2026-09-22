from abc import ABC, abstractmethod
from typing import List

class DecisionEngine(ABC):
    """Interfaz abstracta para motores de decisión en el bot."""

    @abstractmethod
    def decide_higher_lower(self, current_number: int, cutoff: int = 50) -> str:
        """Determina si apostar a MAYOR (HIGHER) o MENOR (LOWER) en el minijuego de cartas."""
        pass

    @abstractmethod
    def evaluate_idle_modal(self, ocr_text: str, keywords: List[str]) -> bool:
        """Evalúa si el texto en pantalla indica un modal de inactividad que requiere recarga."""
        pass
