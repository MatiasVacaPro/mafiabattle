"""MafiaBattle BiDi supervisor CLI. Runtime services live in core/."""

import argparse
import asyncio
from pathlib import Path
import sys
from core.bidi_client import BiDiClient
from core.bot_config import load_config
from core.dom_driver import DOMDriver
from core.user_guard import UserGuard
from core.session_factory import ClassicSessionFactory, AntigravityBrowser
from core.power_guard import prevent_idle_sleep
from core.failure_log import FailureReporter
from core.showroom_lifecycle import ShowroomLifecycle
from core.showroom_cli import showroom_summary as print_showroom_summary
from core import process_control
from core.supervisor import SupervisorDependencies, supervise as supervise_resident

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / "runtime"


class ProcessLock(process_control.ProcessLock):
    def __init__(self):
        super().__init__(RUNTIME)


def setup_logging(console=True):
    return process_control.setup_logging(console, root=ROOT)


def status():
    return process_control.status(runtime=RUNTIME)


def stop_process():
    return process_control.stop_process(runtime=RUNTIME)


def background(args):
    return process_control.background(args, root=ROOT, runtime=RUNTIME)


def showroom_summary(config):
    return print_showroom_summary(config, root=ROOT, runtime=RUNTIME)


async def supervise(args, config):
    dependencies = SupervisorDependencies(
        BiDiClient,
        ClassicSessionFactory,
        AntigravityBrowser,
        DOMDriver,
        UserGuard,
        ShowroomLifecycle,
        FailureReporter,
    )
    return await supervise_resident(
        args, config, root=ROOT, runtime=RUNTIME, dependencies=dependencies
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "config/config.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--duration", type=float, default=0)
    parser.add_argument("--background", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--showroom", action="store_true")
    parser.add_argument("--stop", action="store_true")
    parser.add_argument(
        "--quiet", action="store_true", help="Log to rotating file only"
    )
    args = parser.parse_args()
    try:
        if args.status:
            status()
            return
        if args.stop:
            stop_process()
            return
        config = load_config(args.config)
        if args.showroom:
            showroom_summary(config)
            return
        if args.duration < 0:
            raise ValueError("duration cannot be negative")
        if args.background:
            background(args)
            return
        with ProcessLock():
            setup_logging(console=not args.quiet)
            with prevent_idle_sleep(
                config.get("prevent_idle_sleep", True) and (not args.inspect)
            ):
                asyncio.run(supervise(args, config))
    except (RuntimeError, ValueError, OSError, KeyError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
