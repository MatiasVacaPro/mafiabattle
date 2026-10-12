"""Prevent automatic idle sleep while the bot runs; let the display sleep."""
from contextlib import contextmanager
import os
import subprocess
import sys


@contextmanager
def prevent_idle_sleep(enabled=True):
    process = None
    if enabled and sys.platform == 'darwin':
        process = subprocess.Popen(
            ['/usr/bin/caffeinate', '-i', '-w', str(os.getpid())],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    try:
        yield
    finally:
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
