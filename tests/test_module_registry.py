"""Policies can be composed from partial overrides without shared mutable defaults."""

import json
import tempfile
import unittest
from pathlib import Path

from core.bot_config import load_config
from modules import MODULE_REGISTRY, build_policies


class ModuleRegistryTest(unittest.TestCase):
    def test_empty_settings_are_safe_and_nested_defaults_are_independent(self):
        first = build_policies({})
        self.assertEqual(len(first), 12)
        self.assertTrue(all(policy["enabled"] is False for policy in first))
        production = next(policy for policy in first if policy["kind"] == "production")
        production["factories"].clear()
        second = build_policies({})
        self.assertTrue(
            next(policy for policy in second if policy["kind"] == "production")[
                "factories"
            ]
        )

    def test_policy_identity_is_owned_by_the_module(self):
        for module in MODULE_REGISTRY:
            with self.subTest(module=module.KEY):
                policy = module.policy({module.KEY: {"name": "other", "kind": "other"}})
                self.assertEqual(
                    (policy["name"], policy["kind"]), (module.NAME, module.KIND)
                )

    def test_partial_configuration_uses_defaults_and_local_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps({"modules": {"gym_trainer": {"enabled": True, "room": 3}}})
            )
            config = load_config(path)
            self.assertEqual(config["modules"]["gym_trainer"]["room"], 3)
            self.assertEqual(config["target_url"], "https://www.mafiabattle.com/es/")
            path.write_text(json.dumps({"modules": {"gym_trainer": {"room": 6}}}))
            with self.assertRaises(ValueError):
                load_config(path)
