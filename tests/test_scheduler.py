import unittest
from unittest.mock import MagicMock
import time
from engine.scheduler import TaskScheduler
from core.state_manager import StateManager
from core.input_controller import InputController
from engine.rule_engine import LocalRuleEngine
from tasks.base_task import BaseTask

class SimpleTask(BaseTask):
    def __init__(self, name, interval):
        super().__init__(name, interval)
        self.executed_count = 0

    def execute(self, input_ctrl, vision, state_manager, decision_engine=None):
        self.executed_count += 1
        return True

class TestScheduler(unittest.TestCase):
    def setUp(self):
        self.input_ctrl = MagicMock()
        self.vision = MagicMock()
        self.state_mgr = StateManager(":memory:")
        self.decision_engine = LocalRuleEngine()
        self.scheduler = TaskScheduler(
            input_controller=self.input_ctrl,
            vision_service=self.vision,
            state_manager=self.state_mgr,
            decision_engine=self.decision_engine
        )

    def test_add_task(self):
        task = SimpleTask("T1", 10)
        self.scheduler.add_task(task)
        self.assertEqual(len(self.scheduler.tasks), 1)

    def test_task_cooldown_tracking(self):
        task = SimpleTask("T1", 100)
        now = time.time()
        # Inicialmente debe poder ejecutarse
        self.assertTrue(task.can_run(now, self.state_mgr))
        
        # Ejecutar tarea
        task.run(self.input_ctrl, self.vision, self.state_mgr, self.decision_engine)
        
        # Inmediatamente después NO debe poder ejecutarse
        self.assertFalse(task.can_run(now, self.state_mgr))
        self.assertGreater(task.time_until_next_run(now, self.state_mgr), 90)

if __name__ == "__main__":
    unittest.main()
