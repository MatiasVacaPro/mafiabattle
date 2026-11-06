"""Read-only agent simulation, reconnect and explicit GET document recovery."""

import argparse
import asyncio
import contextlib
from hashlib import sha256
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core.bidi_client import BiDiClient
from core.bot_config import load_config, resident_config
from core.dom_driver import DOMDriver, JavaScriptError, TargetNotFound
from core.session_factory import AntigravityBrowser, ClassicSessionFactory
from main_bidi import ProcessLock


def _drain_events(client, document_methods, document_requests, observed):
    prompts = []
    while not client.events.empty():
        event = client.events.get_nowait()
        params = event.get("params", {})
        if event["method"] == "network.beforeRequestSent":
            if params.get("navigation"):
                request = params.get("request", {})
                document_methods.append(request.get("method"))
                url = urlsplit(request.get("url", ""))
                document_requests.append(
                    {
                        "context": params.get("context"),
                        "method": request.get("method"),
                        "url": f"{url.scheme}://{url.netloc}{url.path}",
                    }
                )
        else:
            observed.append(
                {
                    "method": event["method"],
                    "type": params.get("type"),
                    "handler": params.get("handler"),
                }
            )
        if (
            event["method"] == "browsingContext.userPromptOpened"
            and params.get("type") == "beforeUnload"
        ):
            prompts.append(params.get("context"))
    return prompts


async def _arm_preload(driver, client, resident_cfg):
    key = (client.session_id, driver.context)
    old_script = driver.preloads.pop(key, None)
    if old_script:
        await client.command("script.removePreloadScript", {"script": old_script})
    cfg = {
        **resident_cfg,
        "agent_source_digest": sha256(driver.source.encode()).hexdigest(),
    }
    config_json = json.dumps(cfg, ensure_ascii=True)
    declaration = (
        f"() => {{const createAgent=({driver.source}); createAgent({config_json});}}"
    )
    result = await client.command(
        "script.addPreloadScript",
        {"functionDeclaration": declaration, "contexts": [driver.context]},
    )
    driver.preloads[key] = result["script"]


async def verify(restore_tab=False, auth_recovery=False, idle_timeout_seconds=120.0):
    config = load_config(ROOT / "config/config.json")
    min_idle_seconds = max(15.0, float(config.get("user_pause_seconds", 15)))
    await AntigravityBrowser(config).ensure_ready()
    client = BiDiClient(
        config["endpoint"],
        session_file=ROOT / "runtime/verification-session.json",
        session_factory=ClassicSessionFactory(config.get("marionette_port", 2828)),
    )
    driver = DOMDriver(client, config)
    try:
        await client.connect()
        try:
            await driver.find_target()
        except TargetNotFound:
            if not restore_tab:
                raise
            created = await client.command(
                "browsingContext.create", {"type": "tab", "background": True}
            )
            await client.command(
                "browsingContext.navigate",
                {
                    "context": created["context"],
                    "url": config["target_url"],
                    "wait": "complete",
                },
            )
            await driver.find_target()
        agent_config = resident_config(config, dry_run=not auth_recovery)
        pre_nav_config = agent_config
        if auth_recovery:
            # Permit only login/bootstrap; never spend game resources in this check.
            agent_config["policies"] = [
                {**p, "keepalive_seconds": 0}
                for p in agent_config["policies"]
                if p["kind"] == "anti_idle"
            ]
            # Defer auto_login until after the test GET navigation so starting on
            # a logged-out page does not consume the 5-minute saved_login cooldown
            # before location.replace() runs.
            pre_nav_config = {
                **agent_config,
                "policies": [
                    {**p, "auto_login": False} for p in agent_config["policies"]
                ],
            }
        first = await driver.install(pre_nav_config)
        installed_at = time.monotonic()
        assert first["dry_run"] is (not auth_recovery)
        session = client.session_id
        await client.disconnect()
        await client.connect()
        assert client.session_id == session, "Reconnect must reuse owned session"
        await driver.find_target()
        reconnected = await driver.heartbeat()
        assert reconnected["dry_run"] is (not auth_recovery)
        await client.command(
            "session.subscribe",
            {
                "events": [
                    "browsingContext.userPromptOpened",
                    "browsingContext.navigationStarted",
                    "network.beforeRequestSent",
                ],
                "contexts": [driver.context],
            },
        )
        # Never navigate over an active user session: require >=15s with the guard
        # installed and no PAUSED_BY_USER window active right before location.replace().
        target_url = json.dumps(config["target_url"])
        wait_started = time.monotonic()
        document_id = None
        idle_waited = 0.0
        preload_armed_for_post_nav = not auth_recovery
        snap = reconnected
        while True:
            paused_until = snap.get("paused_until") or 0
            heartbeat_ms = snap.get("last_heartbeat") or 0
            is_paused = (
                snap.get("state") == "PAUSED_BY_USER" or paused_until > heartbeat_ms
            )
            elapsed_with_guard = time.monotonic() - installed_at
            if (not is_paused) and elapsed_with_guard >= min_idle_seconds:
                if not preload_armed_for_post_nav:
                    await _arm_preload(driver, client, agent_config)
                    preload_armed_for_post_nav = True
                while not client.events.empty():
                    client.events.get_nowait()
                document_id = await driver.evaluate(
                    "globalThis.__mafiaVerifyDocumentToken=crypto.randomUUID()"
                )
                # A legacy/native login may have created a POST document. reload() can
                # resubmit it; use the same explicit GET navigation as resident recovery.
                try:
                    navigated = await driver.evaluate(
                        "(() => {"
                        "const bot=globalThis.__mafiaBot;"
                        "const cur=bot?bot.heartbeat(false):null;"
                        'if(cur&&(cur.state==="PAUSED_BY_USER"||(cur.paused_until||0)>Date.now())) return false;'
                        f"location.replace({target_url});"
                        "return true;"
                        "})()"
                    )
                except JavaScriptError:
                    navigated = True  # The old realm may disappear before its reply.
                if navigated:
                    idle_waited = time.monotonic() - installed_at
                    break
            if time.monotonic() - wait_started >= idle_timeout_seconds:
                raise AssertionError(
                    "Human pause remained active; aborted test navigation to respect user control"
                )
            await asyncio.sleep(1.0)
            snap = await driver.heartbeat()

        changed = False
        observed = []
        document_methods = []
        document_requests = []
        reloaded = None
        for _ in range(180):
            for prompt_ctx in _drain_events(
                client, document_methods, document_requests, observed
            ):
                await client.command(
                    "browsingContext.handleUserPrompt",
                    {"context": prompt_ctx or driver.context, "accept": True},
                )
            try:
                changed = (
                    await driver.evaluate(
                        "globalThis.__mafiaVerifyDocumentToken || null"
                    )
                ) != document_id
                reloaded = await driver.heartbeat()
                if reloaded is None or reloaded.get("state") == "STOPPED":
                    reloaded = await driver.install(agent_config)
                if (
                    changed
                    and reloaded
                    and reloaded["account"] == config["account"]
                    and reloaded["state"] == "RUNNING"
                ):
                    break
            except JavaScriptError:
                pass
            await asyncio.sleep(0.5)
        _drain_events(client, document_methods, document_requests, observed)
        assert changed, f"Reload must create a new document; events={observed}"
        assert reloaded and reloaded["dry_run"] is (
            not auth_recovery
        ), "Preload must survive reload"
        assert reloaded["account"] == config["account"], "Expected logged-in account"
        assert (
            reloaded["state"] == "RUNNING"
        ), f"Game bootstrap must finish; state={reloaded['state']}"
        allowed = {
            "login_fetch",
            "login_response_verified",
            "login_render_get_document",
            "finish_background_preload",
        }
        game_actions = [
            action for action in reloaded["history"] if action["action"] not in allowed
        ]
        assert (
            not game_actions
        ), f"Verification must not execute game actions: {game_actions}"
        assert document_methods and all(
            method == "GET" for method in document_methods
        ), f"Every document request must be GET; target={driver.context}; requests={document_requests}"
        target_get_requests = [
            req
            for req in document_requests
            if req["context"] == driver.context
            and req["method"] == "GET"
            and driver.matches(req["url"])
        ]
        assert target_get_requests, (
            f"Main game navigation must be observed as GET in target context; "
            f"target={driver.context}; requests={document_requests}"
        )
        print(
            json.dumps(
                {
                    "version": reloaded.get("version"),
                    "owned_session_reconnected": True,
                    "preload_reinstalled": True,
                    "account": reloaded["account"],
                    "state": reloaded["state"],
                    "game_actions": len(game_actions),
                    "human_idle_waited_seconds": round(idle_waited, 3),
                    "document_request_methods": document_methods,
                    "document_requests": document_requests,
                    "target_get_requests": target_get_requests,
                    "auth_recovery_enabled": auth_recovery,
                },
                indent=2,
            )
        )
    finally:
        try:
            with contextlib.suppress(Exception):
                await driver.stop()
        finally:
            await client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--restore-tab",
        action="store_true",
        help="Restore game tab after the initial browser bootstrap",
    )
    parser.add_argument(
        "--auth-recovery",
        action="store_true",
        help="Allow autofilled fetch login and preload only; no game resource actions",
    )
    parser.add_argument(
        "--idle-timeout",
        type=float,
        default=120.0,
        help="Maximum seconds to wait for human pause clearance before aborting navigation",
    )
    args = parser.parse_args()
    with ProcessLock():
        asyncio.run(verify(args.restore_tab, args.auth_recovery, args.idle_timeout))
