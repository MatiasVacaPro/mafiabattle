"""
Zen Browser WebDriver BiDi Client (macOS / Antigravity)
======================================================
Cliente nativo de alto rendimiento para controlar Zen Browser vía WebDriver BiDi
en el puerto 9222 (ws://127.0.0.1:9222/session).
Permite automatizar MafiaBattle en segundo plano sin secuestrar el ratón del sistema.
"""

import atexit
import json
import logging
import os
import socket
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional, Union
import websocket

logger = logging.getLogger("ZenBiDi")


def extract_bidi_value(result_data: Any) -> Any:
    """Desempaqueta recursivamente tipos de datos serializados de WebDriver BiDi a tipos nativos de Python."""
    if not isinstance(result_data, dict):
        return result_data

    # Si viene envuelto en {"type": "success", "result": ...}
    if "result" in result_data and isinstance(result_data["result"], dict):
        return extract_bidi_value(result_data["result"])

    r_type = result_data.get("type")
    if r_type in ("string", "number", "boolean"):
        return result_data.get("value")
    if r_type in ("null", "undefined"):
        return None
    if r_type == "array":
        items = result_data.get("value", [])
        return [extract_bidi_value(item) for item in items]
    if r_type == "object":
        pairs = result_data.get("value", [])
        obj = {}
        for pair in pairs:
            if isinstance(pair, list) and len(pair) == 2:
                k = pair[0] if isinstance(pair[0], str) else pair[0].get("value")
                obj[k] = extract_bidi_value(pair[1])
        return obj

    if "value" in result_data:
        return result_data["value"]

    return result_data


class ZenBiDiClient:
    """
    Cliente robusto para el protocolo WebDriver BiDi sobre WebSocket.
    Maneja reconexión automática, deduplicación de sesiones y cierre limpio.
    """

    def __init__(self, port: int = 9222, host: str = "127.0.0.1", default_timeout: float = 15.0):
        self.port = port
        self.host = host
        self.ws_url = f"ws://{host}:{port}/session"
        self.default_timeout = default_timeout

        self.ws: Optional[websocket.WebSocket] = None
        self.session_id: Optional[str] = None
        self._msg_id = 0
        self._lock = threading.Lock()
        self._cached_context: Optional[str] = None

        atexit.register(self.close)

    def is_port_open(self) -> bool:
        """Verifica si el puerto de depuración está activo."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.settimeout(0.5)
            s.connect((self.host, self.port))
            s.close()
            return True
        except Exception:
            return False

    def restart_zen_if_needed(self) -> bool:
        """
        Reinicia la instancia Antigravity de Zen Browser si existe una sesión zombi
        bloqueando el protocolo BiDi ('Maximum number of active sessions').
        """
        logger.warning("Reiniciando instancia Antigravity de Zen Browser para limpiar sesión huérfana...")
        try:
            res = subprocess.run(["pgrep", "-f", "antigravity.Default"], capture_output=True, text=True)
            pids = [p.strip() for p in res.stdout.strip().split() if p.strip()]
            for pid in pids:
                try:
                    os.kill(int(pid), 15)  # SIGTERM
                except Exception:
                    pass
            time.sleep(1.5)

            # Relanzar vía zen-antigravity o directamente con open
            try:
                subprocess.run(["zen-antigravity"], capture_output=True, timeout=5)
            except Exception:
                profile_dir = os.path.expanduser("~/Library/Application Support/zen/Profiles/antigravity.Default")
                cmd = [
                    "open", "-n", "-a", "/Applications/Zen.app",
                    "--args", "--profile", profile_dir,
                    "--new-instance", "--remote-debugging-port", str(self.port)
                ]
                subprocess.run(cmd, capture_output=True)

            for _ in range(30):
                time.sleep(0.3)
                if self.is_port_open():
                    time.sleep(1.0)
                    logger.info("Zen Browser reiniciado y disponible.")
                    return True
        except Exception as e:
            logger.error(f"Fallo durante reinicio de Zen Browser: {e}")
        return False

    def connect(self) -> None:
        """Establece conexión WebSocket y crea una sesión BiDi."""
        with self._lock:
            if self.ws and self.ws.connected and self.session_id:
                return

            if not self.is_port_open():
                self.restart_zen_if_needed()

            for attempt in range(2):
                try:
                    self.ws = websocket.create_connection(
                        self.ws_url,
                        timeout=self.default_timeout,
                        suppress_origin=True
                    )
                    self._msg_id += 1
                    req = {
                        "id": self._msg_id,
                        "method": "session.new",
                        "params": {"capabilities": {}}
                    }
                    self.ws.send(json.dumps(req))
                    raw_res = json.loads(self.ws.recv())

                    if "error" in raw_res:
                        err_msg = raw_res.get("message", "")
                        if "Maximum number of active sessions" in err_msg or "Session already started" in err_msg:
                            logger.warning("Detectada sesión BiDi huérfana. Procediendo a recuperar...")
                            try:
                                self.ws.close()
                            except Exception:
                                pass
                            self.ws = None
                            self.restart_zen_if_needed()
                            continue
                        raise RuntimeError(f"Error de BiDi en session.new: {raw_res}")

                    self.session_id = raw_res.get("result", {}).get("sessionId")
                    logger.info(f"Sesión BiDi inicializada con éxito: {self.session_id}")
                    return

                except Exception as e:
                    if attempt == 1:
                        raise RuntimeError(f"No se pudo conectar a Zen Browser tras reintento: {e}")
                    logger.warning(f"Intento de conexión falló ({e}), recuperando...")
                    self.restart_zen_if_needed()

    def send_command(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: Optional[float] = None) -> Dict[str, Any]:
        """Envía un comando BiDi sobre el WebSocket y retorna la respuesta procesada."""
        self.connect()
        with self._lock:
            self._msg_id += 1
            cmd_id = self._msg_id
            payload = {
                "id": cmd_id,
                "method": method,
                "params": params or {}
            }
            if timeout:
                self.ws.settimeout(timeout)
            else:
                self.ws.settimeout(self.default_timeout)

            self.ws.send(json.dumps(payload))

            while True:
                msg_str = self.ws.recv()
                msg = json.loads(msg_str)
                # Omitir eventos asíncronos recibidos antes de la respuesta a nuestra petición
                if msg.get("id") == cmd_id:
                    if msg.get("type") == "error":
                        raise RuntimeError(f"BiDi Error [{method}]: {msg.get('error')} - {msg.get('message')}")
                    return msg.get("result", {})

    def get_contexts(self) -> List[Dict[str, Any]]:
        """Obtiene la lista de todas las pestañas/contextos abiertos."""
        res = self.send_command("browsingContext.getTree", {})
        return res.get("contexts", [])

    def get_tab_context(self, url_pattern: str = "mafiabattle") -> Optional[str]:
        """Encuentra el identificador de contexto de la pestaña que coincide con el patrón."""
        contexts = self.get_contexts()
        for ctx in contexts:
            url = ctx.get("url", "")
            if url_pattern.lower() in url.lower():
                self._cached_context = ctx.get("context")
                return self._cached_context

        # Si no se encuentra, retornar el primer contexto disponible
        if contexts:
            self._cached_context = contexts[0].get("context")
            return self._cached_context
        return None

    def ensure_target_context(self, context_id: Optional[str] = None) -> str:
        """Devuelve un contexto válido, buscando o reutilizando el de MafiaBattle."""
        if context_id:
            return context_id
        if self._cached_context:
            return self._cached_context
        ctx = self.get_tab_context("mafiabattle")
        if not ctx:
            raise RuntimeError("No se encontró ninguna pestaña de MafiaBattle en Zen Browser.")
        return ctx

    def evaluate(
        self,
        expression: str,
        context_id: Optional[str] = None,
        await_promise: bool = True,
        raw_output: bool = False
    ) -> Any:
        """
        Ejecuta código JavaScript en la pestaña indicada y retorna el valor extraído.
        """
        ctx = self.ensure_target_context(context_id)
        params = {
            "expression": expression,
            "target": {"context": ctx},
            "awaitPromise": await_promise,
            "serializationOptions": {"maxDomDepth": 0, "maxObjectDepth": 8}
        }
        res = self.send_command("script.evaluate", params)
        if raw_output:
            return res
        return extract_bidi_value(res)

    def call_function(
        self,
        function_declaration: str,
        arguments: Optional[List[Dict[str, Any]]] = None,
        context_id: Optional[str] = None,
        await_promise: bool = True
    ) -> Any:
        """Invoca una función JavaScript con argumentos serializados."""
        ctx = self.ensure_target_context(context_id)
        params = {
            "functionDeclaration": function_declaration,
            "arguments": arguments or [],
            "target": {"context": ctx},
            "awaitPromise": await_promise,
            "serializationOptions": {"maxDomDepth": 0, "maxObjectDepth": 8}
        }
        res = self.send_command("script.callFunction", params)
        return extract_bidi_value(res)

    def navigate(self, url: str, context_id: Optional[str] = None, wait: str = "interactive") -> Dict[str, Any]:
        """Navega a una URL específica dentro del contexto indicado."""
        ctx = self.ensure_target_context(context_id)
        return self.send_command("browsingContext.navigate", {
            "context": ctx,
            "url": url,
            "wait": wait
        })

    def click_selector(self, selector: str, context_id: Optional[str] = None) -> bool:
        """Hace clic en un elemento encontrado por selector CSS o jQuery."""
        script = f"""
        (() => {{
            const el = document.querySelector("{selector}");
            if (el) {{
                el.scrollIntoView({{ block: "nearest", inline: "nearest" }});
                el.click();
                return true;
            }}
            if (window.$) {{
                const jEl = window.$("{selector}");
                if (jEl.length > 0) {{
                    jEl.trigger("click");
                    return true;
                }}
            }}
            return false;
        }})()
        """
        return bool(self.evaluate(script, context_id=context_id))

    def close(self) -> None:
        """Cierra limpiamente la sesión BiDi y el socket."""
        with self._lock:
            if self.ws and self.ws.connected:
                try:
                    self._msg_id += 1
                    self.ws.send(json.dumps({"id": self._msg_id, "method": "session.end", "params": {}}))
                    self.ws.recv()
                except Exception:
                    pass
                try:
                    self.ws.close()
                except Exception:
                    pass
            self.ws = None
            self.session_id = None
            self._cached_context = None

    def __enter__(self) -> 'ZenBiDiClient':
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()
