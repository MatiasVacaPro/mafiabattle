import unittest
from unittest.mock import MagicMock, patch
import json
import time

from core.zen_bidi import ZenBiDiClient, extract_bidi_value
from core.user_activity_monitor import UserActivityMonitor
from core.game_bridge import MafiaBattleBridge
from core.input_controller import InputController
from core.state_manager import StateManager
from engine.scheduler import TaskScheduler
from engine.rule_engine import LocalRuleEngine
from tasks.anti_idle_task import AntiIdleTask
from tasks.gym_task import GymTask
from tasks.casino_tasks import RuletaTask, MayorMenorTask
from tasks.district_tasks import DistrictTask
from tasks.utility_tasks import FabricacionTask, RecolectorPiedrasTask, ImperiumCollectTask


class TestBiDiSerialization(unittest.TestCase):
    def test_extract_primitives(self):
        self.assertEqual(extract_bidi_value({"type": "string", "value": "hello"}), "hello")
        self.assertEqual(extract_bidi_value({"type": "number", "value": 42}), 42)
        self.assertEqual(extract_bidi_value({"type": "boolean", "value": True}), True)
        self.assertIsNone(extract_bidi_value({"type": "null"}))
        self.assertIsNone(extract_bidi_value({"type": "undefined"}))

    def test_extract_array(self):
        arr = {
            "type": "array",
            "value": [
                {"type": "number", "value": 1},
                {"type": "string", "value": "two"},
                {"type": "boolean", "value": False}
            ]
        }
        self.assertEqual(extract_bidi_value(arr), [1, "two", False])

    def test_extract_object(self):
        obj = {
            "type": "object",
            "value": [
                ["name", {"type": "string", "value": "mati792"}],
                ["level", {"type": "number", "value": 94}],
                ["active", {"type": "boolean", "value": True}]
            ]
        }
        self.assertEqual(extract_bidi_value(obj), {"name": "mati792", "level": 94, "active": True})


class TestUserActivityMonitor(unittest.TestCase):
    def setUp(self):
        self.mock_bidi = MagicMock(spec=ZenBiDiClient)
        self.monitor = UserActivityMonitor(self.mock_bidi, cooldown_seconds=10.0)

    def test_listener_installation(self):
        self.mock_bidi.evaluate.return_value = True
        res = self.monitor.ensure_listener_installed("ctx_123")
        self.assertTrue(res)
        self.mock_bidi.evaluate.assert_called_with(UserActivityMonitor.INJECTION_SCRIPT, context_id="ctx_123")

    def test_user_active_detection(self):
        # Usuario interactuó hace 3 segundos (< 10s cooldown)
        self.mock_bidi.evaluate.return_value = 3.0
        self.assertTrue(self.monitor.is_user_active("ctx_123"))

        # Usuario inactivo hace 15 segundos (> 10s cooldown)
        self.mock_bidi.evaluate.return_value = 15.0
        self.assertFalse(self.monitor.is_user_active("ctx_123"))

    def test_self_healing_check_script(self):
        # CHECK_SCRIPT auto-inyecta los listeners si no están instalados
        self.assertIn("window.__mb_user_monitor_installed", UserActivityMonitor.CHECK_SCRIPT)
        self.assertIn("isTrusted", UserActivityMonitor.CHECK_SCRIPT)


class TestGameBridge(unittest.TestCase):
    def setUp(self):
        self.mock_bidi = MagicMock(spec=ZenBiDiClient)
        self.bridge = MafiaBattleBridge(self.mock_bidi)

    def test_get_player_stats(self):
        self.mock_bidi.evaluate.return_value = {
            "health": 453,
            "cash": 3291120,
            "diamonds": 3402,
            "timers_active": 7,
            "timers_max": 8
        }
        stats = self.bridge.get_player_stats()
        self.assertEqual(stats["health"], 453)
        self.assertEqual(stats["cash"], 3291120)
        self.assertEqual(stats["timers_active"], 7)

    def test_anti_idle_tick(self):
        self.mock_bidi.evaluate.return_value = {"action": "ping_sent", "modal": False}
        is_modal, action = self.bridge.anti_idle_tick()
        self.assertFalse(is_modal)
        self.assertEqual(action, "ping_sent")

    def test_collect_empire_buildings(self):
        self.mock_bidi.evaluate.return_value = {
            "collected": ["tattooshop", "moneypress", "meth", "ammunitionfactory", "nightclub", "gemstonesfactory"],
            "count": 6
        }
        with patch("time.sleep"):
            res = self.bridge.collect_empire_buildings()
            self.assertEqual(res["count"], 6)
            self.assertIn("moneypress", res["collected"])

    def test_check_gym_status_with_cooldown(self):
        # Caso 1: Cooldown activo (no puede entrenar)
        self.mock_bidi.evaluate.return_value = {
            "available_sessions": 0,
            "max_sessions": 10,
            "cooldown_seconds": 21000,
            "can_train": False
        }
        status = self.bridge.check_gym_status()
        self.assertFalse(status["can_train"])
        self.assertEqual(status["available_sessions"], 0)

        # Caso 2: Sesiones listas y timers disponibles
        self.mock_bidi.evaluate.return_value = {
            "available_sessions": 5,
            "max_sessions": 10,
            "cooldown_seconds": 0,
            "can_train": True
        }
        status = self.bridge.check_gym_status()
        self.assertTrue(status["can_train"])
        self.assertEqual(status["available_sessions"], 5)

    def test_perform_district_crime(self):
        self.mock_bidi.evaluate.return_value = {
            "success": True,
            "reason": "ok",
            "crime_id": "21"
        }
        with patch("time.sleep"):
            success, reason = self.bridge.perform_district_crime("residential_area", option_index=0)
            self.assertTrue(success)
            self.assertEqual(reason, "ok")

    def test_play_mayor_menor_with_animation_polling(self):
        # 1er evaluate: inicio True
        # 2do evaluate: poll (rolling: False, number: 35)
        # 3er evaluate: answer True
        # 4to evaluate: poll (is_over: True)
        self.mock_bidi.evaluate.side_effect = [
            True,
            {"is_over": False, "rolling": False, "number": 35},
            True,
            {"is_over": True, "rolling": False, "number": 0}
        ]
        with patch("time.sleep"):
            rondas = self.bridge.play_mayor_menor(max_rounds=5, cutoff=50)
            self.assertEqual(rondas, 1)


class TestDualModeTasks(unittest.TestCase):
    def setUp(self):
        self.mock_bidi = MagicMock(spec=ZenBiDiClient)
        self.bridge = MafiaBattleBridge(self.mock_bidi)
        self.input_ctrl = InputController(bidi_client=self.mock_bidi, game_bridge=self.bridge)
        self.state_mgr = StateManager()

    def test_imperium_collect_task_bidi(self):
        self.mock_bidi.evaluate.return_value = {
            "collected": ["tattooshop", "moneypress"],
            "count": 2
        }
        task = ImperiumCollectTask()
        with patch("time.sleep"):
            success = task.execute(self.input_ctrl, None, self.state_mgr)
            self.assertTrue(success)

    def test_gym_task_respects_cooldown(self):
        # Gym está en cooldown
        self.mock_bidi.evaluate.return_value = {
            "available_sessions": 0,
            "max_sessions": 10,
            "cooldown_seconds": 15000,
            "can_train": False
        }
        task = GymTask()
        success = task.execute(self.input_ctrl, None, self.state_mgr)
        self.assertFalse(success)

    def test_district_task_bidi_option_cycling(self):
        self.mock_bidi.evaluate.return_value = {"success": True, "reason": "ok", "crime_id": "26"}
        coords = {"options": [[889, 481], [885, 561]]}
        task = DistrictTask(district_id="mafiosi_district", name="Mafiosi District", interval_seconds=480, coords=coords)

        with patch("time.sleep"):
            success = task.execute(self.input_ctrl, None, self.state_mgr)
            self.assertTrue(success)
            self.assertEqual(self.state_mgr.get_district_index("mafiosi_district"), 1)


class TestSchedulerUserInterference(unittest.TestCase):
    def setUp(self):
        self.mock_bidi = MagicMock(spec=ZenBiDiClient)
        self.bridge = MafiaBattleBridge(self.mock_bidi)
        self.user_monitor = MagicMock(spec=UserActivityMonitor)
        self.input_ctrl = InputController(
            bidi_client=self.mock_bidi,
            game_bridge=self.bridge,
            user_monitor=self.user_monitor
        )
        self.state_mgr = StateManager()
        self.scheduler = TaskScheduler(
            input_controller=self.input_ctrl,
            vision_service=MagicMock(),
            state_manager=self.state_mgr,
            decision_engine=LocalRuleEngine()
        )

    def test_scheduler_pauses_when_user_interferes(self):
        # Simulamos que el usuario está interactuando
        self.user_monitor.is_user_active.return_value = True
        self.assertTrue(self.input_ctrl.is_user_interfering())


if __name__ == "__main__":
    unittest.main()
