#!/usr/bin/env python3
"""
Pruebas Automatizadas para HelicopteroTask
==========================================
Verifica:
1. Detección precisa (100%) en las 7 capturas con helicóptero (score >= 0.82).
2. 0% de falsos positivos en la captura negativa (Screenshot 2026-09-22 at 4.30.24 PM.png).
3. Escalado correcto de coordenadas de Retina (3360x2100) a Mouse Lógico (1680x1050).
4. Flujo seguro de ejecución Template Method con mocks de InputController (sin mover el mouse real).
"""

import os
import glob
import unittest
from unittest.mock import MagicMock
from PIL import Image
import cv2

from tasks.helicoptero_task import HelicopteroTask


class TestHelicopteroTask(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cls.heli_dir = os.path.join(cls.base_dir, "helicptero")
        cls.coords = {
            "scan_region": [0, 110, 1680, 840],
            "scan_region_retina": [0, 220, 3360, 1680],
            "return_to_base_clicks": 2
        }
        cls.task = HelicopteroTask(
            coords=cls.coords,
            interval_seconds=5.0,
            matching_threshold=0.82
        )

    def test_templates_exist(self):
        """Verifica que las plantillas calibradas existan en el sistema."""
        self.assertTrue(len(self.task.template_paths) > 0, "Debe haber al menos una plantilla de helicóptero registrada.")
        primary_template = os.path.join(self.base_dir, "crop_helicoptero.png")
        self.assertTrue(os.path.exists(primary_template), "Debe existir 'crop_helicoptero.png' en el directorio raíz.")

    def test_benchmark_all_8_screenshots(self):
        """Prueba de detección sobre las 8 capturas reales sin mover el mouse."""
        files = sorted(glob.glob(os.path.join(self.heli_dir, "*.png")))
        self.assertEqual(len(files), 8, f"Se esperaban 8 capturas en {self.heli_dir}, encontradas {len(files)}")

        for fpath in files:
            fname = os.path.basename(fpath)
            pil_img = Image.open(fpath)
            detection = self.task.detect_in_image(pil_img)

            if "4.30.24" in fname:
                # Captura negativa sin helicóptero -> Debe garantizar 0 falsos positivos
                self.assertIsNone(
                    detection,
                    f"Falso positivo detectado en {fname}: {detection}"
                )
            else:
                # Capturas con helicóptero presente -> Debe detectar con score >= 0.82
                self.assertIsNotNone(
                    detection,
                    f"Fallo de detección en {fname}. El helicóptero debió ser detectado."
                )
                rx, ry, conf, tname = detection
                self.assertGreaterEqual(
                    conf,
                    0.82,
                    f"La confianza en {fname} ({conf:.4f}) debe ser >= 0.82"
                )
                self.assertGreater(rx, 0)
                self.assertGreater(ry, 0)

    def test_retina_coordinate_scaling(self):
        """Verifica que las coordenadas de Retina 2x se escalen exactamente a pantalla lógica 1680x1050."""
        # Tomar captura de referencia 12.50.25 donde el helicóptero está centrado en Retina (1345, 850)
        ref_file = os.path.join(self.heli_dir, "Screenshot 2026-09-22 at 12.50.25 PM.png")
        pil_img = Image.open(ref_file)
        self.assertEqual(pil_img.size, (3360, 2100))

        detection = self.task.detect_in_image(pil_img)
        self.assertIsNotNone(detection)
        rx, ry, conf, _ = detection

        scale_x = pil_img.width / 1680.0
        scale_y = pil_img.height / 1050.0
        mx = int(rx / scale_x)
        my = int(ry / scale_y)

        # En 1680x1050 el helicóptero debe situarse en el cuadrante del parque/pista
        self.assertTrue(550 <= mx <= 750, f"Coordenada X lógica {mx} fuera de rango esperado [550, 750]")
        self.assertTrue(350 <= my <= 500, f"Coordenada Y lógica {my} fuera de rango esperado [350, 500]")

    def test_execute_flow_with_mock_controller(self):
        """Verifica la ejecución completa de HelicopteroTask simulando clicks sin mover el mouse."""
        mock_input = MagicMock()
        mock_vision = MagicMock()
        mock_state = MagicMock()

        # Mockear screenshot con captura real con helicóptero
        ref_file = os.path.join(self.heli_dir, "Screenshot 2026-09-22 at 12.50.25 PM.png")
        mock_vision.capture_fullscreen.return_value = Image.open(ref_file)

        result = self.task.execute(mock_input, mock_vision, mock_state)

        self.assertTrue(result, "La tarea debe reportar éxito cuando detecta el helicóptero.")
        mock_input.click.assert_called_once()
        clicked_x, clicked_y = mock_input.click.call_args[0][:2]
        self.assertEqual(clicked_x, 672)
        self.assertEqual(clicked_y, 425)
        mock_input.regresar_al_punto_inicial.assert_called_once_with(veces=2, pausa=0.25)

    def test_execute_negative_case(self):
        """Verifica que en una pantalla sin helicóptero no se ejecuten clicks."""
        mock_input = MagicMock()
        mock_vision = MagicMock()
        mock_state = MagicMock()

        neg_file = os.path.join(self.heli_dir, "Screenshot 2026-09-22 at 4.30.24 PM.png")
        mock_vision.capture_fullscreen.return_value = Image.open(neg_file)

        result = self.task.execute(mock_input, mock_vision, mock_state)

        self.assertFalse(result, "La tarea debe reportar False cuando no hay helicóptero.")
        mock_input.click.assert_not_called()


if __name__ == "__main__":
    unittest.main()
