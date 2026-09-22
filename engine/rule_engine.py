from typing import List
from engine.decision_engine import DecisionEngine

class LocalRuleEngine(DecisionEngine):
    """
    Motor de decisiones puramente local, determinista y de latencia cero.
    No requiere conexión a internet ni llamadas a APIs externas.
    Garantiza que el bot funcione de forma 100% autónoma y confiable.
    """

    def decide_higher_lower(self, current_number: int, cutoff: int = 50) -> str:
        """
        Estrategia de probabilidad estricta:
        Rango de juego 1 a 100.
        Si número <= 50 -> HIGHER (Mayor probabilidad de carta superior).
        Si número > 50 -> LOWER (Mayor probabilidad de carta inferior).
        """
        return "HIGHER" if current_number <= cutoff else "LOWER"

    def evaluate_idle_modal(self, ocr_text: str, keywords: List[str]) -> bool:
        """Evalúa si alguna de las palabras clave de inactividad está presente."""
        if not ocr_text:
            return False
        texto_upper = ocr_text.upper()
        return any(kw.upper() in texto_upper for kw in keywords)
