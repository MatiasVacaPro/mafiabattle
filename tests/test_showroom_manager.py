import json
import tempfile
import unittest
from pathlib import Path

from core.bot_config import load_config
from modules import build_policies
from modules.showroom_manager import ShowroomManager
from modules.transport_manager import TransportManager


class TestShowroomManagerPolicy(unittest.TestCase):
    def setUp(self):
        defaults = json.loads((Path(__file__).resolve().parents[1] / "config/bidi-defaults.json").read_text())
        self.settings = defaults["modules"]

    def test_default_policy_is_disabled_observe_with_approved_floors(self):
        policies = build_policies(self.settings)
        showroom = [policy for policy in policies if policy["name"] == "showroom_manager"]

        self.assertEqual(len(showroom), 1)
        self.assertEqual(showroom[0], {
            "name": "showroom_manager",
            "kind": "showroom",
            "enabled": False,
            "mode": "observe",
            "review_seconds": 7200,
            "preventive_sell_threshold": 215,
            "hard_limit": 250,
            "minimum_prices": dict(ShowroomManager.DEFAULTS["minimum_prices"]),
            "database_path": "runtime/showroom.sqlite3",
        })

    def test_production_config_enables_manage_mode_with_high_end_floors(self):
        cfg = load_config(Path(__file__).resolve().parents[1] / "config/config.json")
        showroom = cfg["modules"]["showroom_manager"]
        self.assertTrue(showroom["enabled"])
        self.assertEqual(showroom["mode"], "manage")
        self.assertEqual(showroom["review_seconds"], 7200)
        self.assertEqual(showroom["preventive_sell_threshold"], 215)
        self.assertEqual(showroom["minimum_prices"], ShowroomManager.DEFAULTS["minimum_prices"])

    def test_user_can_override_minimum_for_another_model(self):
        settings = {**self.settings,
                    "showroom_manager": {"minimum_prices": {"Custom model": 123456}}}
        showroom = [policy for policy in build_policies(settings)
                    if policy["name"] == "showroom_manager"]

        self.assertEqual(showroom[0]["minimum_prices"], {
            **ShowroomManager.DEFAULTS["minimum_prices"],
            "Custom model": 123456,
        })

    def test_user_cannot_override_policy_identity(self):
        settings = {**self.settings, "showroom_manager": {
            "name": "transport_manager", "kind": "transport"
        }}
        showroom = [policy for policy in build_policies(settings)
                    if policy.get("kind") == "showroom"]

        self.assertEqual(len(showroom), 1)
        self.assertEqual(showroom[0]["name"], "showroom_manager")
        self.assertEqual(showroom[0]["kind"], "showroom")

    def test_policy_omits_undocumented_user_settings(self):
        settings = {**self.settings, "showroom_manager": {
            "enabled": True,
            "custom_internal_flag": "unexpected",
        }}
        showroom = [policy for policy in build_policies(settings)
                    if policy["name"] == "showroom_manager"]

        self.assertTrue(showroom[0]["enabled"])
        self.assertNotIn("custom_internal_flag", showroom[0])

    def test_registration_does_not_change_transport_policy(self):
        settings = {**self.settings, "transport_manager": {"enabled": True}}
        before = TransportManager.policy(settings)
        policies = build_policies(settings)

        self.assertEqual(
            [policy for policy in policies if policy["kind"] == "transport"],
            [before],
        )
        self.assertEqual(
            len([policy for policy in policies if policy["kind"] == "showroom"]), 1
        )

    def test_load_config_rejects_invalid_showroom_settings(self):
        base = json.loads((Path(__file__).resolve().parents[1] / "config/bidi-defaults.json").read_text())
        invalid_cases = [
            {"mode": "invalid"},
            {"review_seconds": 0},
            {"review_seconds": True},
            {"preventive_sell_threshold": 250, "hard_limit": 250},
            {"preventive_sell_threshold": 0},
            {"hard_limit": 0},
            {"database_path": "   "},
            {"minimum_prices": {"Bugatti Veyron": -1}},
            {"minimum_prices": {"Bugatti Veyron": True}},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = Path(tmp) / "config.json"
            for patch_dict in invalid_cases:
                candidate = json.loads(json.dumps(base))
                candidate["modules"]["showroom_manager"].update(patch_dict)
                cfg_path.write_text(json.dumps(candidate))
                with self.assertRaises(ValueError, msg=f"Should reject {patch_dict}"):
                    load_config(cfg_path)


if __name__ == "__main__":
    unittest.main()
