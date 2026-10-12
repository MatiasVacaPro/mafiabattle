"""
Helicoptero Task - MafiaBattle Autonomous Bot
==============================================
Tarea orientada a objetos (POO) para la detección y recolección autónoma
del evento de helicóptero de recompensa.

Opera de forma local, determinista y ultrarrápida (0ms latencia) mediante
OpenCV template matching sobre resolución Retina escalada a coordenadas
lógicas del mouse (1680x1050).
"""

import os
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np
from PIL import Image

from core.logger import log_msg
from tasks.base_task import BaseTask


class HelicopteroTask(BaseTask):
    """
    Monitor autónomo de alta prioridad para recolectar el helicóptero de MafiaBattle.
    Detecta el sprite del helicóptero (horizontal o vertical) en el área del mapa
    y ejecuta un clic seguro para reclamar la recompensa.
    """

    def __init__(
        self,
        name: str = "Helicoptero",
        interval_seconds: float = 5.0,
        matching_threshold: float = 0.82,
        coords: Optional[Dict[str, Any]] = None,
        description: str = "Detector y Recolector Autónomo de Helicóptero",
        template_paths: Optional[List[str]] = None
    ):
        super().__init__(name=name, interval_seconds=interval_seconds, description=description)
        self.matching_threshold = matching_threshold
        self.coords = coords or {}
        self.is_high_priority = True  # Monitoreo continuo sin bloqueo de tareas de distrito

        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if template_paths is None:
            # Lista priorizada de plantillas calibradas con Jev
            candidates = [
                os.path.join(base_dir, "crop_helicoptero.png"),
                os.path.join(base_dir, "crop_helicoptero_vertical.png"),
                os.path.join(base_dir, "crop_helicoptero_north_street.png"),
                os.path.join(base_dir, "crop_helicoptero_north_roof.png"),
                os.path.join(base_dir, "capturas", "crop_helicoptero.png"),
            ]
            self.template_paths = [p for p in candidates if os.path.exists(p)]
        else:
            self.template_paths = [p for p in template_paths if os.path.exists(p)]

    def detect_in_image(self, image_input: Any) -> Optional[Tuple[int, int, float, str]]:
        """
        Busca el helicóptero en una captura de pantalla (PIL Image o NumPy array BGR).
        Retorna (center_x, center_y, confidence, template_name) si la correlación >= threshold.
        """
        if isinstance(image_input, Image.Image):
            img_np = np.array(image_input.convert("RGB"))
            img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        elif isinstance(image_input, np.ndarray):
            img_bgr = image_input
        else:
            return None

        h, w = img_bgr.shape[:2]

        # Región de escaneo del mapa principal (ignorar barra superior del navegador y barra inferior)
        if h > 1500:
            # Retina 3360x2100
            scan_cfg = self.coords.get("scan_region_retina", [0, 220, 3360, 1680])
            roi_y1 = scan_cfg[1]
            roi_y2 = min(h, roi_y1 + scan_cfg[3])
        else:
            # Lógica 1680x1050
            scan_cfg = self.coords.get("scan_region", [0, 110, 1680, 840])
            roi_y1 = scan_cfg[1]
            roi_y2 = min(h, roi_y1 + scan_cfg[3])

        roi = img_bgr[roi_y1:roi_y2, :]

        best_score = 0.0
        best_center = None
        best_tname = ""

        for tpath in self.template_paths:
            templ = cv2.imread(tpath, cv2.IMREAD_UNCHANGED)
            if templ is None:
                continue

            th, tw = templ.shape[:2]
            if th > roi.shape[0] or tw > roi.shape[1]:
                continue

            # Matching con máscara de transparencia alfa RGBA si está disponible
            if len(templ.shape) == 3 and templ.shape[2] == 4:
                bgr = templ[:, :, :3]
                mask = templ[:, :, 3]
                res = cv2.matchTemplate(roi, bgr, cv2.TM_CCOEFF_NORMED, mask=mask)
            else:
                bgr = templ if len(templ.shape) == 3 else cv2.cvtColor(templ, cv2.COLOR_GRAY2BGR)
                res = cv2.matchTemplate(roi, bgr, cv2.TM_CCOEFF_NORMED)

            min_v, max_v, min_l, max_l = cv2.minMaxLoc(res)
            if max_v > best_score:
                best_score = float(max_v)
                best_tname = os.path.basename(tpath)
                cx = max_l[0] + tw // 2
                cy = max_l[1] + roi_y1 + th // 2
                best_center = (cx, cy)

        if best_score >= self.matching_threshold and best_center is not None:
            return (best_center[0], best_center[1], best_score, best_tname)

        return None

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None) -> bool:
        """
        Ejecución segura de la tarea de helicóptero:
        1. Captura de pantalla a través de VisionService.
        2. Detección local con OpenCV.
        3. Escalado dinámico Retina -> Coordenadas de mouse (1680x1050).
        4. Clic seguro para recoger recompensa.
        5. Retorno al punto inicial.
        """
        screenshot = vision.capture_fullscreen()
        detection = self.detect_in_image(screenshot)

        if not detection:
            return False

        rx, ry, conf, tname = detection
        log_msg(self.name, "activo", f"¡Helicóptero detectado con plantilla '{tname}'! Correlación: {conf:.4f} en ({rx}, {ry})")

        # Escalado dinámico de coordenadas a pantalla lógica (1680x1050)
        screen_w, screen_h = screenshot.size
        scale_x = screen_w / 1680.0
        scale_y = screen_h / 1050.0

        mouse_x = int(rx / scale_x)
        mouse_y = int(ry / scale_y)

        log_msg(self.name, "click", f"Haciendo clic en helicóptero en coordenadas lógicas ({mouse_x}, {mouse_y})...")
        input_ctrl.click(mouse_x, mouse_y, delay_after=0.5)

        # Esperar recepción del bono
        input_ctrl.sleep(1.0)

        # Si el clic abre una ventana emergente o modal de recompensa, retornar al punto inicial
        return_clicks = self.coords.get("return_to_base_clicks", 2)
        input_ctrl.regresar_al_punto_inicial(veces=return_clicks, pausa=0.25)
        log_msg(self.name, "completado", "Evento de helicóptero recolectado y vista restaurada.")
        return True
