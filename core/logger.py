import sys
from datetime import datetime

EMOJI_STATUS_MAP = {
    "activo":     "ℹ️",
    "espera":     "⏳",
    "ejecutando": "⚡",
    "alerta":     "⚠️",
    "completado": "✅",
    "error":      "❌",
    "pausa":      "⏸️",
    "reanudar":   "▶️"
}

def log_msg(tag: str, status: str, message: str) -> None:
    """Imprime logs ordenados, con marcas de tiempo y emojis consistentes."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    emoji = EMOJI_STATUS_MAP.get(status.lower(), "ℹ️")
    formatted = f"{emoji} [{timestamp}] [{tag}] {message}"
    print(formatted, flush=True)
