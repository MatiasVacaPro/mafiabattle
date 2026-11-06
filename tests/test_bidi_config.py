import json
import tempfile
import unittest
from pathlib import Path

from core.bot_config import load_config, resident_config
from core.dom_driver import DOMDriver
from modules import build_policies
from modules.boss_fighter import BossFighter


ROOT = Path(__file__).resolve().parents[1]


class BossFighterConfigTest(unittest.TestCase):
    def setUp(self):
        self.defaults_path = ROOT / "config/bidi-defaults.json"
        self.production_path = ROOT / "config/config.json"

    def test_boss_policy_is_registered_with_safe_defaults(self):
        boss = BossFighter.policy({})

        self.assertEqual(
            boss,
            {
                "name": "boss_fighter",
                "kind": "boss",
                "enabled": False,
                "minimum_health": 120,
                "minimum_ammo": 250,
                "cooldown_seconds": 2,
                "open_selector": "#go_boss",
                "event_root": "#dialog_bosses_bosevent",
                "family_event_root": "#dialog_bosses_familyevent",
                "family_min_only_max_level": 4,
                "family_scan_seconds": 180,
                "fight_root": "#dialog_bosses_fight",
                "reward_root": "#dialog_bosses_reward",
                "goal_root": "#dialog_bosses_goalcomplete",
                "hide_obstacles": True,
                "enlarge_hitarea": True,
                "boss_scale": 0.55,
            },
        )

        settings = load_config(self.defaults_path)["modules"]
        policies = build_policies(settings)
        self.assertEqual(
            len([policy for policy in policies if policy["kind"] == "boss"]), 1
        )

    def test_shipped_configs_enable_boss_and_align_health_threshold(self):
        defaults = load_config(self.defaults_path)
        production = load_config(self.production_path)

        for config in (defaults, production):
            boss = config["modules"]["boss_fighter"]
            self.assertEqual(
                boss,
                {**BossFighter.DEFAULTS, "enabled": True},
            )
            resident = resident_config(config)
            boss_policy = next(
                policy for policy in resident["policies"] if policy["kind"] == "boss"
            )
            self.assertTrue(boss_policy["enabled"])
            self.assertEqual(boss_policy["minimum_health"], 120)

        self.assertEqual(production["modules"]["health_manager"]["trigger_below"], 120)

    def test_load_config_rejects_invalid_boss_limits(self):
        base = json.loads(self.defaults_path.read_text())
        invalid_cases = [
            {"minimum_health": 19},
            {"minimum_health": True},
            {"minimum_ammo": 9},
            {"minimum_ammo": True},
            {"cooldown_seconds": 0},
            {"cooldown_seconds": True},
            {"family_min_only_max_level": True},
            {"family_min_only_max_level": -1},
            {"family_min_only_max_level": 4.5},
            {"family_min_only_max_level": "4"},
            {"family_scan_seconds": True},
            {"family_scan_seconds": 4.9},
            {"family_scan_seconds": "180"},
        ]

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            for changes in invalid_cases:
                candidate = json.loads(json.dumps(base))
                candidate["modules"].setdefault("boss_fighter", {}).update(changes)
                path.write_text(json.dumps(candidate))
                with self.subTest(changes=changes):
                    with self.assertRaises(ValueError):
                        load_config(path)

    def test_family_limits_accept_disabled_cap_and_fractional_scan(self):
        base = json.loads(self.defaults_path.read_text())
        base["modules"]["boss_fighter"].update(
            family_min_only_max_level=0, family_scan_seconds=5.5
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(base))
            policy = BossFighter.policy(load_config(path)["modules"])
        self.assertEqual(policy["family_min_only_max_level"], 0)
        self.assertEqual(policy["family_scan_seconds"], 5.5)

    def test_dom_driver_injects_boss_helpers_before_supervisor(self):
        driver = DOMDriver(object(), {"target_url": "https://www.mafiabattle.com/es/"})
        helper = driver.source.index("function stepBossCombat")
        supervisor = driver.source.index("function createMafiaAgent")

        self.assertGreaterEqual(helper, 0)
        self.assertLess(helper, supervisor)


if __name__ == "__main__":
    unittest.main()
