import unittest
from unittest.mock import MagicMock, patch
from tasks.district_tasks import DistrictTask
from tasks.casino_tasks import MayorMenorTask
from tasks.anti_idle_task import AntiIdleTask
from tasks.base_task import BaseTask
from core.state_manager import StateManager
from engine.rule_engine import LocalRuleEngine

class TestTasks(unittest.TestCase):
    def setUp(self):
        self.input_mock = MagicMock()
        self.vision_mock = MagicMock()
        self.state_mgr = StateManager(":memory:")
        self.rule_engine = LocalRuleEngine()

    def test_district_task_cycles_options(self):
        coords = {
            "nav_click": [740, 967],
            "x_range": [500, 700],
            "y_fixed": 770,
            "options": [[889, 481], [885, 561]]
        }
        task = DistrictTask(
            district_id="test_district",
            name="Test District",
            interval_seconds=480,
            coords=coords
        )

        # Primera ejecución -> opción 1 (889, 481)
        task.run(self.input_mock, self.vision_mock, self.state_mgr, self.rule_engine)
        self.input_mock.double_click.assert_any_call(889, 481, delay_after=1.8)
        self.input_mock.regresar_al_punto_inicial.assert_called_with(veces=3, pausa=0.35)

        # Segunda ejecución -> opción 2 (885, 561)
        task.run(self.input_mock, self.vision_mock, self.state_mgr, self.rule_engine)
        self.input_mock.double_click.assert_any_call(885, 561, delay_after=1.8)

    def test_mayor_menor_decision_logic(self):
        coords = {
            "icon_barra": [875, 960],
            "tab_pestana": [845, 472],
            "btn_start": [993, 689],
            "region_numero": [929, 486, 170, 124],
            "btn_mayor": [993, 660],
            "btn_menor": [993, 710],
            "btn_cerrar_x": [1202, 290]
        }
        task = MayorMenorTask(coords=coords, max_rounds=2, cutoff_value=50)

        # Simular lectura 42 (debe elegir MAYOR)
        self.vision_mock.read_region_number.return_value = 42
        task.run(self.input_mock, self.vision_mock, self.state_mgr, self.rule_engine)
        self.input_mock.click.assert_any_call(993, 660, delay_after=1.5)

        # Simular lectura 75 (debe elegir MENOR)
        self.vision_mock.read_region_number.return_value = 75
        task.run(self.input_mock, self.vision_mock, self.state_mgr, self.rule_engine)
        self.input_mock.click.assert_any_call(993, 710, delay_after=1.5)

    def test_anti_idle_reacts_to_keyword(self):
        coords = {
            "btn_reload": [838, 688],
            "region_modal": [550, 320, 580, 430],
            "keywords": ["RELOAD", "IDLE"]
        }
        task = AntiIdleTask(coords=coords)

        # Simular detección positiva
        self.vision_mock.check_keywords_in_region.return_value = (True, "RELOAD")
        task.run(self.input_mock, self.vision_mock, self.state_mgr, self.rule_engine)
        self.input_mock.double_click.assert_called_with(838, 688, delay_after=2.0)
        self.input_mock.regresar_al_punto_inicial.assert_called()

    def test_task_finally_closes_modals_on_error(self):
        class BrokenTask(BaseTask):
            def execute(self, input_ctrl, vision, state_manager, decision_engine=None):
                raise RuntimeError("Fallo inesperado")

        broken = BrokenTask("Broken", 10)
        broken.run(self.input_mock, self.vision_mock, self.state_mgr)
        # Verifica que regresar_al_punto_inicial se llamó incluso con el error
        self.input_mock.regresar_al_punto_inicial.assert_called_with(veces=3, pausa=0.35)

if __name__ == "__main__":
    unittest.main()
