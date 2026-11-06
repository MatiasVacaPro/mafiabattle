"""The production loader is also the source evaluated by DOM fixtures."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from core.agent_bundle import load_agent_source
from core.dom_driver import DOMDriver

ROOT = Path(__file__).resolve().parents[1]


class AgentBundleTest(unittest.TestCase):
    def test_python_and_javascript_load_the_identical_factory(self):
        result = subprocess.run(
            ["bun", "scripts/agent_source.js"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.stdout, load_agent_source(ROOT / "scripts"))
        self.assertEqual(DOMDriver(None, {}).source, result.stdout)

    def test_missing_bundle_dependency_fails_before_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "agent-manifest.json").write_text(
                json.dumps(
                    {
                        "dependencies": ["missing.js"],
                        "entry": "supervisor.js",
                    }
                )
            )
            (root / "supervisor.js").write_text("function createMafiaAgent() {}")
            with self.assertRaises(FileNotFoundError):
                load_agent_source(root)
