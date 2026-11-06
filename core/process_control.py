"""Process ownership, status files, logging and background launch."""

import fcntl
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import signal
import subprocess
import sys
import time


def atomic_json(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, path)


class ProcessLock:
    def __init__(self, runtime):
        self.runtime = runtime

    def __enter__(self):
        self.runtime.mkdir(exist_ok=True)
        self.file = (self.runtime / "bot.lock").open("a+")
        try:
            fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.file.close()
            raise RuntimeError("Another BiDi bot is already running") from None
        self.file.seek(0)
        self.file.truncate()
        self.file.write(str(os.getpid()))
        self.file.flush()
        return self

    def __exit__(self, *args):
        fcntl.flock(self.file, fcntl.LOCK_UN)
        self.file.close()


def setup_logging(console=True, *, root):
    (root / "logs").mkdir(exist_ok=True)
    handlers = [
        RotatingFileHandler(
            root / "logs/bot.log", maxBytes=2000000, backupCount=5, encoding="utf-8"
        )
    ]
    if console:
        handlers.insert(0, logging.StreamHandler())
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
    )


def status(*, runtime):
    path = runtime / "status.json"
    data = json.loads(path.read_text()) if path.exists() else {"state": "NOT_STARTED"}
    data["status_age_seconds"] = round(
        time.time() - data.get("updated_at", time.time()), 1
    )
    data["process_running"] = False
    if (runtime / "bot.lock").exists():
        with (runtime / "bot.lock").open() as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                data["process_running"] = True
    print(json.dumps(data, ensure_ascii=False, indent=2))


def stop_process(*, runtime):
    path = runtime / "bot.lock"
    if not path.exists():
        print("Bot is not running")
        return
    with path.open() as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pid = int(lock.read().strip())
            if pid <= 1:
                raise RuntimeError("Invalid process id")
            os.kill(pid, signal.SIGTERM)
            print(f"Stop requested for PID {pid}")
            return
    print("Bot is not running")


def background(args, *, root, runtime):
    with ProcessLock(runtime):
        pass
    (root / "logs").mkdir(exist_ok=True)
    argv = [sys.executable, "-u", str(root / "main_bidi.py")] + [
        a for a in sys.argv[1:] if a != "--background"
    ]
    with (root / "logs/service.log").open("a") as stream:
        child = subprocess.Popen(
            argv,
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=stream,
            stderr=stream,
            start_new_session=True,
        )
    time.sleep(0.5)
    if child.poll() is not None:
        raise RuntimeError("Bot failed to start; see logs/service.log")
    print(f"Bot started in background, PID {child.pid}. Status: ./run.sh status")
