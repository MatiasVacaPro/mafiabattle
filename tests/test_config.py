import unittest
import os
from core.config_manager import ConfigManager

class TestConfigManager(unittest.TestCase):
    def setUp(self):
        self.config_mgr = ConfigManager()

    def test_config_loaded(self):
        self.assertIn("tasks", self.config_mgr.config)
        self.assertIn("screen", self.config_mgr.config)
        self.assertEqual(self.config_mgr.config["screen"]["target_resolution"], [1680, 1050])

    def test_coordinates_loaded(self):
        self.assertIn("districts", self.config_mgr.coordinates)
        self.assertIn("casino", self.config_mgr.coordinates)
        self.assertIn("gym", self.config_mgr.coordinates)
        self.assertIn("anti_idle", self.config_mgr.coordinates)

    def test_parse_delay_empty(self):
        self.assertEqual(ConfigManager.parse_delay_string(""), 0.0)
        self.assertEqual(ConfigManager.parse_delay_string(None), 0.0)

    def test_parse_delay_units(self):
        self.assertEqual(ConfigManager.parse_delay_string("10s"), 10.0)
        self.assertEqual(ConfigManager.parse_delay_string("5m"), 300.0)
        self.assertEqual(ConfigManager.parse_delay_string("2h"), 7200.0)
        self.assertEqual(ConfigManager.parse_delay_string("2h 23m"), 7200.0 + 23 * 60.0)

    def test_district_coordinates_exist(self):
        d = self.config_mgr.get_district_config("mafiosi_district")
        self.assertIn("nav_click", d)
        self.assertIn("options", d)
        self.assertTrue(len(d["options"]) > 0)

if __name__ == "__main__":
    unittest.main()
