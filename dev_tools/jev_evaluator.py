#!/usr/bin/env python3
"""
Herramienta de Desarrollo y Evaluación Semántica con Jev (TypeSafe System One).
=============================================================================
NOTA DE ARQUITECTURA:
Esta herramienta se usa exclusivamente durante la fase de desarrollo, calibración
y testing para evaluar casos ambiguos (OCR ruidoso, clasificación de estados del juego).
El bot en tiempo de ejecución (runtime) utiliza 'LocalRuleEngine' de forma autónoma,
local y con latencia cero, sin depender de servicios externos ni internet.
"""

import os
import sys
import json
import subprocess
from typing import Any, Dict, Optional

class JevEvaluator:
    """Evaluador de desarrollo para verificar decisiones semánticas usando Jev."""

    def __init__(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.bridge_script = os.path.join(self.base_dir, "jev_bridge.mjs")
        self.node_modules = os.path.expanduser("~/jev-demo/node_modules")

    def is_available(self) -> bool:
        """Verifica si Node.js y el SDK de Vercel AI están disponibles."""
        try:
            res = subprocess.run(["node", "-v"], capture_output=True, text=True)
            return res.returncode == 0 and os.path.exists(self.bridge_script)
        except Exception:
            return False

    def evaluate(self, state: Dict[str, Any], questions: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Envía un estado y preguntas a Jev a través del puente de desarrollo Node."""
        if not self.is_available():
            print("⚠️ [JEV-DEV] Node.js no disponible para el puente de desarrollo.")
            return None

        payload = {
            "state": state,
            "questions": questions
        }
        input_data = json.dumps(payload)

        env = os.environ.copy()
        if os.path.exists(self.node_modules):
            env["NODE_PATH"] = self.node_modules

        demo_dir = os.path.expanduser("~/jev-demo")
        exec_cwd = demo_dir if os.path.exists(demo_dir) else self.base_dir

        try:
            res = subprocess.run(
                ["node", self.bridge_script],
                input=input_data,
                capture_output=True,
                text=True,
                env=env,
                cwd=exec_cwd,
                timeout=15
            )
            if res.returncode == 0 and res.stdout.strip():
                return json.loads(res.stdout.strip())
            else:
                err_text = res.stderr.strip()
                print(f"❌ [JEV-DEV] Error ejecutando Jev bridge: {err_text}")
                return None
        except Exception as e:
            print(f"❌ [JEV-DEV] Excepción comunicando con Jev: {e}")
            return None

    def evaluate_game_screen(self, ocr_text: str) -> Optional[Dict[str, Any]]:
        """Evalúa semánticamente el texto extraído por OCR para clasificar el estado de la pantalla."""
        state = {
            "ocr_text": ocr_text,
            "context": "Pantalla capturada del juego MafiaBattle"
        }
        questions = {
            "pantalla_tipo": {
                "type": "choice",
                "instructions": "¿A qué tipo de pantalla o modal corresponde el texto OCR capturado?",
                "criteria": {
                    "idle_modal": "Aviso de inactividad o desconexión que pide recargar (Idle too long, Reload)",
                    "casino": "Minijuego de ruleta, mayor o menor, o apuestas",
                    "distrito": "Distrito de la ciudad o barrio (Celebrities, Shopping, Mafiosi)",
                    "gimnasio": "Entrenamiento físico o estadísticas en el gym",
                    "desconocido": "Texto ambiguo, fondo normal o no identificable"
                }
            },
            "requiere_recarga": {
                "type": "boolean",
                "instructions": "¿Indica este texto que la sesión expiró y el juego debe recargarse inmediatamente?"
            }
        }
        return self.evaluate(state, questions)

    def benchmark_rule_vs_jev(self, sample_text: str, local_rule_detected: bool) -> None:
        """Compara la decisión del LocalRuleEngine con la evaluación semántica de Jev para depuración."""
        print(f"\n🔍 [BENCHMARK] Texto analizado: '{sample_text}'")
        print(f"   LocalRuleEngine: {'RECARGAR' if local_rule_detected else 'NORMAL'}")
        
        if not self.is_available():
            print("   Jev: No disponible. El bot usa LocalRuleEngine como siempre.")
            return

        result = self.evaluate_game_screen(sample_text)
        if result:
            answers = result.get("answers", {})
            tipo_info = answers.get("pantalla_tipo", {})
            tipo = tipo_info.get("choice", "desconocido")
            recarga_info = answers.get("requiere_recarga", {})
            prob_recarga = recarga_info.get("probability", 0.0)
            recarga = prob_recarga > 0.5
            
            print(f"   Jev Clasificación: {tipo} (Requiere recarga: {recarga} | Probabilidad: {prob_recarga:.2f})")
            if local_rule_detected == recarga:
                print("   ✅ Coincidencia 100% entre regla local y evaluación semántica.")
            else:
                print("   ⚠️ Discrepancia detectada: evalúa refinar las palabras clave en config.json.")


if __name__ == "__main__":
    evaluator = JevEvaluator()
    sample = "You have been idle too long. Please click RELOAD to continue playing."
    print("Probando evaluador de desarrollo con texto de prueba:")
    evaluator.benchmark_rule_vs_jev(sample, local_rule_detected=True)
