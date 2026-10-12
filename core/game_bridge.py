"""
MafiaBattle Game Bridge (DOM & BiDi Engine)
===========================================
Puente de alto nivel para interactuar con la lógica del juego MafiaBattle vía DOM/JS
a través del cliente WebSocket BiDi de Zen Browser.
Permite ejecutar tareas sin mover el cursor físico del sistema (Enfoque A y C).
"""

import time
import logging
from typing import Any, Dict, List, Optional, Tuple
from core.zen_bidi import ZenBiDiClient

logger = logging.getLogger("GameBridge")


class MafiaBattleBridge:
    """Controlador de alto nivel del DOM y eventos del juego MafiaBattle."""

    # Mapeo oficial de distritos a su ubicación en el diálogo de crímenes y su ID base
    DISTRICT_MAPPING = {
        "shopping_street": {"loc": "crimes_location_shop", "base_crime": 16, "num_crimes": 5},
        "residential_area": {"loc": "crimes_location_residential", "base_crime": 21, "num_crimes": 5},
        "mafiosi_district": {"loc": "crimes_location_office", "base_crime": 26, "num_crimes": 5},
        "celebrities_district": {"loc": "crimes_location_city", "base_crime": 11, "num_crimes": 5},
        "jardin_clasico": {"loc": "crimes_location_neighborhood", "base_crime": 6, "num_crimes": 5},
        "billonari_club": {"loc": "crimes_location_office", "base_crime": 26, "num_crimes": 5},
    }

    def __init__(self, bidi_client: ZenBiDiClient):
        self.bidi = bidi_client

    def ensure_page_ready(self, timeout: float = 10.0) -> bool:
        """Verifica que la página de MafiaBattle esté cargada y lista."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                res = self.bidi.evaluate("document.readyState === 'complete' && typeof window.$ !== 'undefined'")
                if res:
                    return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def is_logged_in(self) -> bool:
        """Determina si el usuario tiene sesión activa o está en la pantalla de login."""
        script = """
        (() => {
            if ($("#interface, #menu, .bottommenu, #imperium").length > 0) return true;
            if ($("input[name='signup'], #recover_password").length > 0) return false;
            return false;
        })()
        """
        try:
            return bool(self.bidi.evaluate(script))
        except Exception:
            return False

    def perform_login_if_needed(self) -> bool:
        """Si la sesión no está activa, envía el formulario de login guardado."""
        if self.is_logged_in():
            return True

        logger.info("Detectada pantalla de login. Enviando credenciales guardadas...")
        script = """
        (() => {
            const submitBtn = $("input[type='submit'][name='signup'], input[value='Ingresar']");
            if (submitBtn.length > 0) {
                submitBtn.trigger("click");
                return true;
            }
            const form = $("input[name='username']").closest("form");
            if (form.length > 0) {
                form.submit();
                return true;
            }
            return false;
        })()
        """
        try:
            res = self.bidi.evaluate(script)
            time.sleep(3.0)
            return bool(res) and self.is_logged_in()
        except Exception as e:
            logger.error(f"Error al enviar formulario de login: {e}")
            return False

    def get_player_stats(self) -> Dict[str, Any]:
        """Extrae estadísticas en tiempo real del jugador (salud, dinero, timers, etc.)."""
        script = """
        (() => {
            return {
                health: window.stats_health !== undefined ? window.stats_health : 0,
                cash: window.stats_cash !== undefined ? window.stats_cash : 0,
                diamonds: window.stats_diamonds !== undefined ? window.stats_diamonds : 0,
                bank: window.stats_bank !== undefined ? window.stats_bank : 0,
                timers_active: window.stats_timers !== undefined ? window.stats_timers : 0,
                timers_max: window.stats_timers_max !== undefined ? window.stats_timers_max : 8,
                ammunition: window.stats_ammunition !== undefined ? window.stats_ammunition : 0,
                logged_in: $("#interface").length > 0
            };
        })()
        """
        try:
            return self.bidi.evaluate(script) or {}
        except Exception as e:
            logger.error(f"Error al obtener estadísticas del jugador: {e}")
            return {}

    def close_all_modals(self) -> bool:
        """Cierra modales visibles de forma limpia sin recargar la página."""
        script = """
        (() => {
            let closed = false;
            $(".dialog:visible .close, .dialog:visible .close_button").each(function() {
                try {
                    $(this).trigger("click");
                    closed = true;
                } catch (e) {}
            });
            if (typeof window.close_dialog === "function") {
                ["notification", "alert_notification", "info", "crimes", "gym", "gym_room", "casino_wheel", "casino_higherlower", "methlab", "methlab_lab", "hospital", "gemstonesfactory", "gemstonesfactory_produce"].forEach(name => {
                    if ($("#dialog_" + name + ":visible").length > 0) {
                        try {
                            window.close_dialog(name);
                            closed = true;
                        } catch (e) {}
                    }
                });
            }
            $("#overlay").hide();
            return closed;
        })()
        """
        try:
            return bool(self.bidi.evaluate(script))
        except Exception:
            return False

    def anti_idle_tick(self) -> Tuple[bool, str]:
        """
        Monitor anti-inactividad 24/7 en segundo plano.
        1. Detecta modales de alerta o 'Idle too long' y los cierra / pulsa reload.
        2. Si no hay modales, envía un ping nativo ('cmd(\"ping:pong\")') para mantener la sesión viva.
        """
        script = """
        (() => {
            // 1. Detectar modal o aviso de inactividad
            const notifDialog = $("#dialog_notification:visible, #dialog_alert_notification:visible");
            if (notifDialog.length > 0) {
                const text = notifDialog.text().toLowerCase();
                if (text.includes("idle") || text.includes("reload") || text.includes("inactividad") || text.includes("too long")) {
                    const reloadBtn = notifDialog.find(".button:contains('Reload'), .button:contains('Recargar'), input[value*='Reload']");
                    if (reloadBtn.length > 0) {
                        reloadBtn.trigger("click");
                        return { action: "clicked_reload_modal", modal: true };
                    }
                    notifDialog.find(".close, .button").first().trigger("click");
                    return { action: "closed_idle_modal", modal: true };
                }
            }

            // 2. Ping nativo para prevenir desconexión sin recargas bruscas
            if (typeof window.cmd === "function") {
                window.cmd("ping:pong");
                return { action: "ping_sent", modal: false };
            }

            return { action: "none", modal: false };
        })()
        """
        try:
            res = self.bidi.evaluate(script)
            action = res.get("action", "none") if isinstance(res, dict) else "none"
            is_modal = res.get("modal", False) if isinstance(res, dict) else False
            return is_modal, action
        except Exception as e:
            logger.debug(f"Error en anti_idle_tick: {e}")
            return False, "error"

    def collect_empire_buildings(self) -> Dict[str, Any]:
        """
        Recolecta automáticamente todos los recursos acumulados en los edificios del imperio
        (Tattoo Shop, Money Press, Ammunition Factory, Meth Lab, Nightclub, Gemstones Factory, Red Light).
        Devuelve el detalle de los edificios recolectados.
        """
        script = r"""
        (() => {
            const collected = [];
            // Buscar todos los botones de recolección visibles en la ciudad
            $(".collect:visible").each(function() {
                const onclick = $(this).attr("onclick") || "";
                if (onclick.includes("object:collect") || onclick.includes("collectmeth") || onclick.includes("gemstones:addgem")) {
                    const match = onclick.match(/type\s*:\s*['"]([^'"]+)['"]/);
                    const name = match ? match[1] : (onclick.includes("collectmeth") ? "meth" : "gemstones");
                    try {
                        $(this).trigger("click");
                        collected.push(name);
                    } catch (e) {}
                }
            });
            return {
                collected: collected,
                count: collected.length
            };
        })()
        """
        try:
            res = self.bidi.evaluate(script) or {}
            collected_list = res.get("collected", [])
            if collected_list:
                logger.info(f"Edificios del imperio recolectados: {collected_list}")
                time.sleep(0.5)
            return res
        except Exception as e:
            logger.error(f"Error al recolectar edificios del imperio: {e}")
            return {"collected": [], "count": 0}

    def check_gym_status(self) -> Dict[str, Any]:
        """
        Verifica disponibilidad real de sesiones de entrenamiento en el gimnasio.
        Abre el diálogo si es necesario, comprueba sesiones disponibles (data-val > 0),
        y verifica que haya cupo de timers libres y no haya un entreno en curso.
        """
        script = """
        (() => {
            let wasOpen = $("#dialog_gym:visible").length > 0;
            if (!wasOpen && typeof window.show_dialog === "function") {
                window.show_dialog("gym", true);
            }

            const sessionsEl = $("#dialog_gym .stat_sessions .progress");
            const availableSessions = sessionsEl.length ? parseInt(sessionsEl.attr("data-val") || "0") : 0;
            const maxSessions = sessionsEl.length ? parseInt(sessionsEl.attr("data-max") || "10") : 10;
            const cdtimerEl = $("#dialog_gym .timedetail [data-cdtimer]");
            const remainingCooldown = cdtimerEl.length ? parseInt(cdtimerEl.attr("data-cdtimer") || "0") : 0;

            const activeTimersText = ($("#timer_detail_countdown").text() || "").toLowerCase();
            const isGymTrainingActive = activeTimersText.includes("gym") || activeTimersText.includes("fitness") || activeTimersText.includes("treadmill");

            const freeTimers = (window.stats_timers_max || 8) - (window.stats_timers || 0);
            const canTrain = (freeTimers > 0) && (availableSessions > 0) && !isGymTrainingActive;

            if (!wasOpen && typeof window.close_dialog === "function") {
                window.close_dialog("gym");
            }

            return {
                available_sessions: availableSessions,
                max_sessions: maxSessions,
                cooldown_seconds: remainingCooldown,
                is_training_active: isGymTrainingActive,
                free_timers: freeTimers,
                can_train: canTrain
            };
        })()
        """
        try:
            return self.bidi.evaluate(script) or {}
        except Exception as e:
            logger.error(f"Error al verificar estado del gimnasio: {e}")
            return {}

    def train_gym(self, room: str = "4") -> bool:
        """
        Ejecuta una sesión de entrenamiento en el gimnasio en segundo plano.
        """
        status = self.check_gym_status()
        if not status.get("can_train", False):
            logger.warning(f"No se puede entrenar en el gimnasio: sesiones={status.get('available_sessions')}, timers={status.get('free_timers')}")
            return False

        script = f"""
        (() => {{
            if (typeof window.show_dialog === "function") {{
                window.show_dialog("gym_room", true);
            }}
            if (typeof window.cmd === "function") {{
                window.cmd("gym:fitness", {{ "room": "{room}" }});
                return true;
            }}
            return false;
        }})()
        """
        try:
            res = bool(self.bidi.evaluate(script))
            time.sleep(1.0)
            self.close_all_modals()
            return res
        except Exception as e:
            logger.error(f"Fallo en train_gym: {e}")
            return False

    def is_ruleta_available(self) -> bool:
        """Comprueba si la ruleta diaria está lista para girar."""
        script = """
        (() => {
            let wasOpen = $("#dialog_casino_wheel:visible").length > 0;
            if (!wasOpen && typeof window.show_dialog === "function") {
                window.show_dialog("casino_wheel", true);
            }
            const btn = $("#dialog_casino_wheel .spin_button");
            const available = btn.length > 0 && !btn.hasClass("disabled");
            if (!wasOpen && typeof window.close_dialog === "function") {
                window.close_dialog("casino_wheel");
            }
            return available;
        })()
        """
        try:
            return bool(self.bidi.evaluate(script))
        except Exception:
            return False

    def spin_ruleta(self) -> bool:
        """Gira la ruleta diaria del casino si está disponible."""
        script = """
        (() => {
            if (typeof window.show_dialog === "function") {
                window.show_dialog("casino_wheel", true);
            }
            const btn = $("#dialog_casino_wheel .spin_button");
            if (btn.length > 0 && !btn.hasClass("disabled")) {
                if (typeof window.wheel_play === "function") {
                    window.wheel_play();
                    return true;
                }
                btn.trigger("click");
                return true;
            }
            return false;
        })()
        """
        try:
            spun = bool(self.bidi.evaluate(script))
            if spun:
                logger.info("Ruleta girada exitosamente. Esperando animación (15s)...")
                time.sleep(15.0)
            self.close_all_modals()
            return spun
        except Exception as e:
            logger.error(f"Fallo en spin_ruleta: {e}")
            return False

    def is_mayor_menor_available(self) -> bool:
        """Comprueba si el minijuego Mayor o Menor está disponible."""
        script = """
        (() => {
            let wasOpen = $("#dialog_casino_higherlower:visible").length > 0;
            if (!wasOpen && typeof window.show_dialog === "function") {
                window.show_dialog("casino_higherlower", true);
            }
            const btn = $("#dialog_casino_higherlower .start_button");
            const available = btn.length > 0 && !btn.hasClass("disabled");
            if (!wasOpen && typeof window.close_dialog === "function") {
                window.close_dialog("casino_higherlower");
            }
            return available;
        })()
        """
        try:
            return bool(self.bidi.evaluate(script))
        except Exception:
            return False

    def play_mayor_menor(self, max_rounds: int = 10, cutoff: int = 50, user_monitor: Optional[Any] = None) -> int:
        """
        Juega una partida completa de Mayor o Menor (Higher / Lower)
        con decisiones probabilísticas óptimas (<= cutoff -> HIGHER, > cutoff -> LOWER),
        esperando el fin del rodillo de animación antes de responder.
        """
        init_script = """
        (() => {
            if (typeof window.show_dialog === "function") {
                window.show_dialog("casino_higherlower", true);
            }
            const btn = $("#dialog_casino_higherlower .start_button");
            if (btn.length > 0 && !btn.hasClass("disabled")) {
                if (typeof window.hilo_play === "function") {
                    window.hilo_play();
                    return true;
                }
                btn.trigger("click");
                return true;
            }
            return false;
        })()
        """
        started = bool(self.bidi.evaluate(init_script))
        if not started:
            self.close_all_modals()
            return 0

        logger.info("Iniciada partida de Mayor o Menor. Jugando rondas automáticas...")
        time.sleep(1.0)

        rondas_completadas = 0
        poll_number_script = """
        (() => {
            const isOver = $("#dialog_casino_higherlower .start_button:visible").not(".disabled").length > 0;
            const rolling = (window.hilo_roll_out || 0) > 0;
            let num = window.hilo_number || 0;
            if (!num) {
                const text = $("#dialog_casino_higherlower .playfield span").text().trim();
                const parsed = parseInt(text);
                if (!isNaN(parsed) && parsed > 0) num = parsed;
            }
            return {
                is_over: isOver,
                rolling: rolling,
                number: num
            };
        })()
        """

        for ronda in range(1, max_rounds + 1):
            if user_monitor and user_monitor.is_user_active():
                logger.info("Intervención de usuario detectada en Mayor o Menor. Pausando partida.")
                break

            # Polling con espera adaptativa hasta que termine la animación
            num = 0
            for _ in range(25):
                state = self.bidi.evaluate(poll_number_script) or {}
                if state.get("is_over") and ronda > 1:
                    logger.info(f"Partida finalizada tras ronda {ronda - 1}.")
                    self.close_all_modals()
                    return rondas_completadas

                if not state.get("rolling") and state.get("number", 0) > 0:
                    num = state.get("number")
                    break
                time.sleep(0.2)

            if not num:
                logger.info("No se obtuvo número válido tras esperar animación. Fin de partida.")
                break

            decision = 1 if num <= cutoff else -1
            decision_name = "HIGHER" if decision == 1 else "LOWER"
            logger.info(f"Ronda {ronda}: Número={num} → Decisión={decision_name}")

            answer_script = f"""
            (() => {{
                if (typeof window.hilo_answer === "function") {{
                    window.hilo_answer({decision});
                    return true;
                }}
                const sel = {decision} === 1 ? ".higher_button" : ".lower_button";
                $("#dialog_casino_higherlower " + sel).trigger("click");
                return true;
            }})()
            """
            self.bidi.evaluate(answer_script)
            rondas_completadas += 1
            time.sleep(1.5)

        self.close_all_modals()
        return rondas_completadas

    def perform_district_crime(self, district_id: str, option_index: int = 0) -> Tuple[bool, str]:
        """
        Ejecuta un crimen de distrito vía BiDi mapeado según el DOM real del juego.
        Verifica cupo de temporizadores, salud mínima y estado de cooldown del distrito.
        """
        mapping = self.DISTRICT_MAPPING.get(district_id)
        if not mapping:
            # Fallback a Mafiosi/Office
            mapping = {"loc": "crimes_location_office", "base_crime": 26, "num_crimes": 5}

        loc_class = mapping["loc"]
        base_crime = mapping["base_crime"]
        num_crimes = mapping["num_crimes"]
        target_crime_id = str(base_crime + (option_index % num_crimes))

        script = f"""
        (() => {{
            // 1. Verificar temporizadores libres
            const freeTimers = (window.stats_timers_max || 8) - (window.stats_timers || 0);
            if (freeTimers <= 0) return {{ success: false, reason: "timers_full" }};

            // 2. Verificar salud
            if ((window.stats_health || 0) < 15) return {{ success: false, reason: "low_health" }};

            // 3. Abrir diálogo de crímenes y verificar si la ubicación está en cooldown
            let wasOpen = $("#dialog_crimes:visible").length > 0;
            if (!wasOpen && typeof window.show_dialog === "function") {{
                window.show_dialog("crimes", true);
            }}

            const locItem = $(".item.{loc_class}");
            const inCooldown = locItem.find(".disabled.timer").length > 0;

            if (inCooldown) {{
                if (!wasOpen && typeof window.close_dialog === "function") window.close_dialog("crimes");
                return {{ success: false, reason: "location_cooldown" }};
            }}

            // 4. Ejecutar crimen
            if (typeof window.cmd === "function") {{
                window.cmd("crime:perform", {{ "id": "{target_crime_id}" }}, true);
                if (!wasOpen && typeof window.close_dialog === "function") window.close_dialog("crimes");
                return {{ success: true, reason: "ok", crime_id: "{target_crime_id}" }};
            }}

            if (!wasOpen && typeof window.close_dialog === "function") window.close_dialog("crimes");
            return {{ success: false, reason: "cmd_not_available" }};
        }})()
        """
        try:
            res = self.bidi.evaluate(script) or {}
            success = res.get("success", False)
            reason = res.get("reason", "unknown")
            time.sleep(0.5)
            self.close_all_modals()
            return success, reason
        except Exception as e:
            logger.error(f"Error al ejecutar crimen de distrito [{district_id}]: {e}")
            return False, str(e)

    def perform_crime(self, crime_id: str) -> bool:
        """Compatibilidad legacy con llamada directa por ID numérico."""
        script = f"""
        (() => {{
            if (window.stats_timers >= window.stats_timers_max) return false;
            if (typeof window.cmd === "function") {{
                window.cmd("crime:perform", {{ "id": "{crime_id}" }}, true);
                return true;
            }}
            return false;
        }})()
        """
        try:
            return bool(self.bidi.evaluate(script))
        except Exception as e:
            logger.error(f"Fallo en perform_crime [{crime_id}]: {e}")
            return False

    def collect_gemstones(self) -> bool:
        """Recolecta gemas y piedras preciosas acumuladas en el almacén."""
        script = """
        (() => {
            if (typeof window.cmd === "function") {
                window.cmd("gemstones:addgem", "", true);
                return true;
            }
            return false;
        })()
        """
        try:
            return bool(self.bidi.evaluate(script))
        except Exception as e:
            logger.error(f"Fallo en collect_gemstones: {e}")
            return False

    def check_methlab_status(self) -> Dict[str, Any]:
        """Verifica si el laboratorio de cristal está listo para cocinar o ya en producción."""
        script = """
        (() => {
            let wasOpen = $("#dialog_methlab:visible").length > 0;
            if (!wasOpen && typeof window.show_dialog === "function") {
                window.show_dialog("methlab", true);
            }

            const isCooking = $("#dialog_methlab .cancelproduction:visible").length > 0;
            const freeTimers = (window.stats_timers_max || 8) - (window.stats_timers || 0);

            if (!wasOpen && typeof window.close_dialog === "function") {
                window.close_dialog("methlab");
            }

            return {
                is_cooking: isCooking,
                free_timers: freeTimers,
                can_cook: !isCooking && (freeTimers > 0)
            };
        })()
        """
        try:
            return self.bidi.evaluate(script) or {}
        except Exception:
            return {}

    def produce_meth_crystal(self) -> bool:
        """Inicia cocinado en el Laboratorio de Cristal / Meth Lab si hay timer disponible."""
        status = self.check_methlab_status()
        if not status.get("can_cook", False):
            logger.info("Meth lab ya está en producción o no hay temporizadores disponibles.")
            return False

        script = """
        (() => {
            if (window.stats_timers >= window.stats_timers_max) return false;
            if (typeof window.cmd === "function") {
                window.cmd("object:produce", {
                    "type": "methlab",
                    "temp": 180,
                    "product_0": 1, "product_1": 1, "product_2": 1, "product_3": 1,
                    "product_4": 1, "product_5": 1, "product_6": 1, "product_7": 1, "product_8": 1
                });
                return true;
            }
            return false;
        })()
        """
        try:
            res = bool(self.bidi.evaluate(script))
            time.sleep(0.5)
            self.close_all_modals()
            return res
        except Exception as e:
            logger.error(f"Fallo en produce_meth_crystal: {e}")
            return False
