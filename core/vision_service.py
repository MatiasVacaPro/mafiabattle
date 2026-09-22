import io
import os
import re
import sys
from typing import List, Optional, Tuple
from PIL import Image
import pyautogui as pg

from core.logger import log_msg

# Apple Vision Framework en macOS
try:
    import Foundation
    import Vision
    VISION_DISPONIBLE = True
except ImportError:
    VISION_DISPONIBLE = False

# PyTesseract Respaldo
try:
    import pytesseract
    TESSERACT_DISPONIBLE = True
except ImportError:
    TESSERACT_DISPONIBLE = False


class VisionService:
    """Servicio unificado de OCR y captura de pantalla."""

    def __init__(self, capturas_dir: Optional[str] = None):
        if capturas_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            capturas_dir = os.path.join(base_dir, "capturas")
        self.capturas_dir = capturas_dir
        os.makedirs(self.capturas_dir, exist_ok=True)

    def capture_fullscreen(self) -> Image.Image:
        """Captura la pantalla completa."""
        return pg.screenshot()

    def capture_region(self, region: Tuple[int, int, int, int]) -> Image.Image:
        """Captura una región específica: (x, y, width, height)."""
        return pg.screenshot(region=region)

    def extract_text(self, pil_image: Image.Image) -> str:
        """Extrae texto usando Apple Vision (o Tesseract como respaldo)."""
        if VISION_DISPONIBLE:
            text = self._ocr_apple_vision(pil_image)
            if text:
                return text
                
        if TESSERACT_DISPONIBLE:
            return self._ocr_tesseract(pil_image)
            
        return ""

    def _ocr_apple_vision(self, pil_image: Image.Image) -> str:
        """OCR de alta velocidad usando Apple Vision."""
        try:
            buf = io.BytesIO()
            pil_image.save(buf, format="PNG")
            data = Foundation.NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))

            handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, None)
            request = Vision.VNRecognizeTextRequest.alloc().init()
            request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
            request.setUsesLanguageCorrection_(False)

            success, _ = handler.performRequests_error_([request], None)
            if not success:
                return ""

            results = request.results()
            if not results:
                return ""
                
            parts = [cand.string() for obs in results for cand in obs.topCandidates_(1)]
            return " ".join(parts).strip()
        except Exception as e:
            log_msg("VISION", "error", f"Error en Apple Vision: {e}")
            return ""

    def _ocr_tesseract(self, pil_image: Image.Image) -> str:
        """OCR de respaldo usando PyTesseract."""
        try:
            return pytesseract.image_to_string(pil_image).strip()
        except Exception as e:
            log_msg("VISION", "error", f"Error en PyTesseract: {e}")
            return ""

    def read_region_text(self, region: Tuple[int, int, int, int]) -> str:
        """Captura una región y extrae su texto."""
        img = self.capture_region(region)
        return self.extract_text(img)

    def read_region_number(self, region: Tuple[int, int, int, int]) -> Optional[int]:
        """Lee una región de pantalla y busca el primer número entero encontrado."""
        texto = self.read_region_text(region)
        if not texto:
            return None
        
        # Buscar secuencias numéricas
        nums = re.findall(r"\d+", texto)
        if nums:
            try:
                return int(nums[0])
            except ValueError:
                return None
        return None

    def check_keywords_in_region(self, region: Tuple[int, int, int, int], keywords: List[str]) -> Tuple[bool, str]:
        """Verifica si alguna palabra clave aparece en el texto detectado en la región."""
        texto = self.read_region_text(region).upper()
        for kw in keywords:
            if kw.upper() in texto:
                return True, kw
        return False, ""
