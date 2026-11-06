import tempfile
import unittest
from pathlib import Path

from core.process_control import ProcessLock


class ProcessControlTest(unittest.TestCase):
    def test_lock_excludes_a_second_supervisor_and_releases_after_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime"
            with ProcessLock(runtime):
                with self.assertRaises(RuntimeError):
                    with ProcessLock(runtime):
                        pass
            with ProcessLock(runtime):
                self.assertTrue((runtime / "bot.lock").read_text().strip().isdigit())

    def test_independent_runtime_does_not_share_the_original_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            with ProcessLock(Path(directory) / "original"):
                with ProcessLock(Path(directory) / "isolated"):
                    pass
