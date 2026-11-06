"""Resident lifecycle, reconnect/backoff and heartbeat orchestration."""

import asyncio
import contextlib
from dataclasses import dataclass
import json
import logging
import os
import random
import signal
import time
from websockets.exceptions import WebSocketException
from core.bidi_client import BiDiError, SessionBusy
from core.dom_driver import JavaScriptError, TargetNotFound
from core.process_control import atomic_json
from core.showroom_lifecycle import persist_snapshot

LOG = logging.getLogger("mafiabattle")


@dataclass(frozen=True)
class SupervisorDependencies:
    BiDiClient: object
    ClassicSessionFactory: object
    AntigravityBrowser: object
    DOMDriver: object
    UserGuard: object
    ShowroomLifecycle: object
    FailureReporter: object


async def supervise(args, config, *, root, runtime, dependencies):
    BiDiClient = dependencies.BiDiClient
    ClassicSessionFactory = dependencies.ClassicSessionFactory
    AntigravityBrowser = dependencies.AntigravityBrowser
    DOMDriver = dependencies.DOMDriver
    UserGuard = dependencies.UserGuard
    ShowroomLifecycle = dependencies.ShowroomLifecycle
    FailureReporter = dependencies.FailureReporter
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    factory = (
        ClassicSessionFactory(
            config.get("marionette_port", 2828), config["command_timeout_seconds"]
        )
        if config.get("session_mode") == "classic"
        else None
    )
    client = BiDiClient(
        config["endpoint"],
        config["command_timeout_seconds"],
        runtime / "session.json",
        session_factory=factory,
    )
    browser = AntigravityBrowser(config)
    driver = DOMDriver(client, config)
    guard = UserGuard()
    showroom_lifecycle = ShowroomLifecycle(config)
    backoff = config["reconnect_min_seconds"]
    previous_state = None
    previous_history = set()
    started = loop.time()
    last_snapshot = None
    installed = None
    failures = FailureReporter(
        root / "logs/failures.jsonl", runtime / "failure-log-state.json"
    )
    try:
        while not stop.is_set() and (
            not args.duration or loop.time() - started < args.duration
        ):
            try:
                await browser.ensure_ready()
                await client.connect()
                old_context = driver.context
                await driver.find_target(create_if_missing=not args.inspect)
                if old_context != driver.context:
                    previous_history.clear()
                if args.inspect:
                    data = await driver.evaluate(
                        '({url:location.href,ready:document.readyState,logged_in:!!document.querySelector("#game")&&!!document.querySelector("#top_bar"),account:document.querySelector(".player1_username")?.textContent.trim(),dialogs:[...document.querySelectorAll(".dialog")].filter(e=>getComputedStyle(e).display!=="none").map(e=>e.id),selectors:Object.fromEntries('
                        + json.dumps(
                            [
                                p["selector"]
                                for p in config["modules"]["district_collector"][
                                    "collectors"
                                ]
                            ]
                        )
                        + ".map(s=>[s,!!document.querySelector(s)]))})"
                    )
                    print(json.dumps(data, ensure_ascii=False, indent=2))
                    return
                key = (client.session_id, driver.context)
                if installed != key:
                    snapshot = await driver.install(
                        showroom_lifecycle.agent_config(args.dry_run)
                    )
                    installed = key
                    previous_history.clear()
                    LOG.info("Resident agent injected in context %s", driver.context)
                else:
                    snapshot = await driver.heartbeat()
                    if snapshot is None or snapshot.get("state") == "STOPPED":
                        snapshot = await driver.install(
                            showroom_lifecycle.agent_config(args.dry_run)
                        )
                        previous_history.clear()
                await persist_snapshot(snapshot, showroom_lifecycle, driver)
                last_snapshot = snapshot
                failures.observe(snapshot)
                state = guard.observe(snapshot)
                if state != previous_state:
                    LOG.info(
                        "State %s; account=%s; dialogs=%s",
                        state,
                        snapshot["account"],
                        snapshot["dialogs"],
                    )
                    previous_state = state
                for item in snapshot["history"]:
                    key = (item["at"], item["sequence"])
                    if key not in previous_history:
                        LOG.info("DOM %s", json.dumps(item, ensure_ascii=False))
                previous_history = {
                    (i["at"], i["sequence"]) for i in snapshot["history"]
                }
                atomic_json(
                    runtime / "status.json",
                    {
                        "pid": os.getpid(),
                        "updated_at": time.time(),
                        **snapshot,
                        "browser": {
                            "profile": str(browser.profile),
                            "application": str(browser.application),
                            "pid": browser.pid,
                        },
                    },
                )
                backoff = config["reconnect_min_seconds"]
                if args.once:
                    await asyncio.sleep(min(config["heartbeat_seconds"], 2))
                    snapshot = await driver.heartbeat()
                    await persist_snapshot(snapshot, showroom_lifecycle, driver)
                    last_snapshot = snapshot
                    print(json.dumps(snapshot, ensure_ascii=False, indent=2))
                    return
                delay = config["heartbeat_seconds"]
            except (
                OSError,
                ConnectionError,
                TimeoutError,
                BiDiError,
                JavaScriptError,
                TargetNotFound,
                WebSocketException,
            ) as error:
                label = (
                    "SESSION_BUSY" if isinstance(error, SessionBusy) else "RECONNECTING"
                )
                LOG.warning("%s: %s", label, error)
                failures.connection_failure(label, error)
                atomic_json(
                    runtime / "status.json",
                    {
                        "pid": os.getpid(),
                        "updated_at": time.time(),
                        "state": label,
                        "error": str(error),
                        "last_snapshot": last_snapshot,
                    },
                )
                if args.once or args.inspect:
                    raise
                if not isinstance(error, (JavaScriptError, TargetNotFound)):
                    await client.disconnect()
                delay = backoff + random.uniform(0, min(1, backoff * 0.2))
                backoff = min(config["reconnect_max_seconds"], backoff * 2)
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
            except TimeoutError:
                pass
    finally:
        if not args.inspect:
            with contextlib.suppress(Exception):
                await driver.stop()
        try:
            await client.close()
        finally:
            failures.close()
        if not args.inspect:
            atomic_json(
                runtime / "status.json",
                {
                    "pid": os.getpid(),
                    "updated_at": time.time(),
                    "state": "STOPPED",
                    "last_snapshot": last_snapshot,
                },
            )
        LOG.info("Supervisor stopped; Zen remains open")
