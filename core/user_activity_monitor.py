"""
User Activity Monitor (Anti-Interference Protocol)
==================================================
Monitorea eventos de interacción del usuario humano (clics, teclas, scroll)
dentro de la página web de MafiaBattle. Si el usuario interactúa manualmente,
el bot se pausa de inmediato y reanuda tras un período de inactividad configurado.
"""

import time
import logging
from typing import Optional
from core.zen_bidi import ZenBiDiClient

logger = logging.getLogger("UserActivityMonitor")


class UserActivityMonitor:
    """Detecta actividad humana en la pestaña del juego para evitar colisiones."""

    INJECTION_SCRIPT = """
    (() => {
        if (!window.__mb_user_monitor_installed) {
            window.__mb_last_user_activity = 0;
            const onHumanEvent = (e) => {
                // Solo registrar eventos de usuarios reales (isTrusted === true)
                if (e.isTrusted !== false) {
                    window.__mb_last_user_activity = Date.now();
                }
            };
            const events = ['mousedown', 'mouseup', 'keydown', 'wheel', 'pointerdown', 'touchstart'];
            events.forEach(ev => {
                window.addEventListener(ev, onHumanEvent, { capture: true, passive: true });
            });
            window.__mb_user_monitor_installed = true;
        }
        return true;
    })()
    """

    CHECK_SCRIPT = """
    (() => {
        if (!window.__mb_user_monitor_installed) {
            window.__mb_last_user_activity = 0;
            const onHumanEvent = (e) => {
                // Solo registrar eventos de usuarios reales (isTrusted === true)
                if (e.isTrusted !== false) {
                    window.__mb_last_user_activity = Date.now();
                }
            };
            const events = ['mousedown', 'mouseup', 'keydown', 'wheel', 'pointerdown', 'touchstart'];
            events.forEach(ev => {
                window.addEventListener(ev, onHumanEvent, { capture: true, passive: true });
            });
            window.__mb_user_monitor_installed = true;
        }
        const now = Date.now();
        const last = window.__mb_last_user_activity || 0;
        return last === 0 ? 999999.0 : (now - last) / 1000.0;
    })()
    """

    def __init__(self, bidi_client: ZenBiDiClient, cooldown_seconds: float = 12.0):
        self.bidi = bidi_client
        self.cooldown_seconds = cooldown_seconds
        self._installed = False
        self._last_state_was_active = False

    def ensure_listener_installed(self, context_id: Optional[str] = None) -> bool:
        """Asegura que los event listeners de actividad humana estén activos en la página."""
        try:
            self.bidi.evaluate(self.INJECTION_SCRIPT, context_id=context_id)
            self._installed = True
            return True
        except Exception as e:
            logger.debug(f"No se pudo inyectar listener de actividad: {e}")
            return False

    def get_seconds_since_last_activity(self, context_id: Optional[str] = None) -> float:
        """Devuelve los segundos transcurridos desde el último clic o tecla del usuario."""
        try:
            val = self.bidi.evaluate(self.CHECK_SCRIPT, context_id=context_id)
            if val is not None:
                return float(val)
        except Exception as e:
            logger.debug(f"Error evaluando actividad del usuario: {e}")
        return 999999.0

    def is_user_active(self, context_id: Optional[str] = None) -> bool:
        """
        Determina si el usuario está interactuando activamente con la página.
        Devuelve True si hubo interacción hace menos de cooldown_seconds.
        """
        seconds_since = self.get_seconds_since_last_activity(context_id)
        active = seconds_since < self.cooldown_seconds

        if active and not self._last_state_was_active:
            logger.info(f"🛑 Intervención del usuario detectada ({seconds_since:.1f}s atrás). Pausando bot...")
            self._last_state_was_active = True
        elif not active and self._last_state_was_active:
            logger.info(f"✅ Inactividad del usuario restablecida ({seconds_since:.1f}s). Reanudando bot...")
            self._last_state_was_active = False

        return active

    def wait_if_user_active(self, context_id: Optional[str] = None, check_interval: float = 1.0) -> None:
        """Bloquea temporalmente la ejecución si el usuario está interactuando."""
        while self.is_user_active(context_id):
            time.sleep(check_interval)
