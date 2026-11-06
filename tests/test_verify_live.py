import asyncio
import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import AsyncMock, MagicMock, patch

import scripts.verify_live as verify_live


def _make_snapshot(*, state="RUNNING", account="mati792", dry_run=True, paused_until=0, last_heartbeat=100_000):
    return {
        "version": "1.4.0",
        "state": state,
        "account": account,
        "dry_run": dry_run,
        "paused_until": paused_until,
        "last_heartbeat": last_heartbeat,
        "history": [],
    }


class VerifyLiveTests(unittest.IsolatedAsyncioTestCase):
    def _base_config(self):
        return {
            "endpoint": "ws://127.0.0.1:9222/session",
            "marionette_port": 2828,
            "target_url": "https://www.mafiabattle.com/es/",
            "account": "mati792",
            "user_pause_seconds": 15,
            "heartbeat_seconds": 2,
            "lease_seconds": 30,
            "action_delay_ms": 250,
            "ack_timeout_seconds": 15,
            "tick_ms": 1000,
            "recovery": {"enabled": True},
            "modules": {},
        }

    async def test_waits_for_15s_human_inactivity_and_pause_clearance_before_navigation(self):
        clock = [100.0]

        def fake_monotonic():
            return clock[0]

        async def fake_sleep(seconds):
            clock[0] += seconds

        events = asyncio.Queue()
        client = MagicMock()
        client.session_id = "owned-session-1"
        client.events = events
        client.connect = AsyncMock()
        client.disconnect = AsyncMock()
        client.close = AsyncMock()
        client.command = AsyncMock(return_value={})

        navigate_times = []
        navigated = [False]

        driver = MagicMock()
        driver.context = "ctx-main"
        driver.matches.side_effect = (
            lambda url: url == "https://www.mafiabattle.com/es/"
        )
        driver.find_target = AsyncMock(return_value="ctx-main")
        driver.install = AsyncMock(
            return_value=_make_snapshot(state="PAUSED_BY_USER", paused_until=120_000, last_heartbeat=100_000)
        )
        driver.stop = AsyncMock()

        async def fake_heartbeat():
            if navigated[0]:
                return _make_snapshot(state="RUNNING", paused_until=120_000, last_heartbeat=130_000)
            if clock[0] < 122.0:
                return _make_snapshot(state="PAUSED_BY_USER", paused_until=122_000, last_heartbeat=int(clock[0] * 1000))
            return _make_snapshot(state="RUNNING", paused_until=122_000, last_heartbeat=int(clock[0] * 1000))

        async def fake_evaluate(expr):
            if "crypto.randomUUID()" in expr:
                return "doc-token-1"
            if "location.replace" in expr:
                navigate_times.append(clock[0])
                navigated[0] = True
                await events.put(
                    {
                        "method": "network.beforeRequestSent",
                        "params": {
                            "context": "ctx-main",
                            "navigation": "nav-1",
                            "request": {
                                "method": "GET",
                                "url": "https://www.mafiabattle.com/es/?ignored=1",
                            },
                        },
                    }
                )
                return True
            if "__mafiaVerifyDocumentToken" in expr:
                return None if navigated[0] else "doc-token-1"
            return None

        driver.heartbeat = AsyncMock(side_effect=fake_heartbeat)
        driver.evaluate = AsyncMock(side_effect=fake_evaluate)

        browser = MagicMock()
        browser.ensure_ready = AsyncMock(return_value=999)

        buf = io.StringIO()
        with (
            patch.object(verify_live, "load_config", return_value=self._base_config()),
            patch.object(verify_live, "resident_config", return_value={"dry_run": True, "policies": []}),
            patch.object(verify_live, "AntigravityBrowser", return_value=browser),
            patch.object(verify_live, "BiDiClient", return_value=client),
            patch.object(verify_live, "DOMDriver", return_value=driver),
            patch.object(verify_live, "ClassicSessionFactory", return_value=MagicMock()),
            patch("time.monotonic", side_effect=fake_monotonic),
            patch("asyncio.sleep", side_effect=fake_sleep),
            redirect_stdout(buf),
        ):
            await verify_live.verify()

        self.assertEqual(len(navigate_times), 1)
        self.assertGreaterEqual(
            navigate_times[0],
            122.0,
            "Navigation must wait until both >=15s elapsed and PAUSED_BY_USER cleared",
        )
        payload = json.loads(buf.getvalue())
        self.assertTrue(payload["owned_session_reconnected"])
        self.assertTrue(payload["preload_reinstalled"])
        self.assertGreaterEqual(payload["human_idle_waited_seconds"], 22.0)
        self.assertEqual(
            payload["target_get_requests"],
            [{"context": "ctx-main", "method": "GET", "url": "https://www.mafiabattle.com/es/"}],
        )

    async def test_aborts_without_navigating_when_human_remains_active(self):
        clock = [300.0]

        def fake_monotonic():
            return clock[0]

        async def fake_sleep(seconds):
            clock[0] += seconds

        client = MagicMock()
        client.session_id = "owned-session-busy"
        client.events = asyncio.Queue()
        client.connect = AsyncMock()
        client.disconnect = AsyncMock()
        client.close = AsyncMock()
        client.command = AsyncMock(return_value={})

        navigate_calls = []
        driver = MagicMock()
        driver.context = "ctx-main"
        driver.find_target = AsyncMock(return_value="ctx-main")
        driver.install = AsyncMock(
            return_value=_make_snapshot(state="PAUSED_BY_USER", paused_until=999_000, last_heartbeat=300_000)
        )
        driver.heartbeat = AsyncMock(
            return_value=_make_snapshot(state="PAUSED_BY_USER", paused_until=999_000, last_heartbeat=300_000)
        )
        driver.stop = AsyncMock()

        async def fake_evaluate(expr):
            if "location.replace" in expr:
                navigate_calls.append(expr)
            return "doc-token"

        driver.evaluate = AsyncMock(side_effect=fake_evaluate)
        browser = MagicMock()
        browser.ensure_ready = AsyncMock(return_value=999)

        with (
            patch.object(verify_live, "load_config", return_value=self._base_config()),
            patch.object(verify_live, "resident_config", return_value={"dry_run": True, "policies": []}),
            patch.object(verify_live, "AntigravityBrowser", return_value=browser),
            patch.object(verify_live, "BiDiClient", return_value=client),
            patch.object(verify_live, "DOMDriver", return_value=driver),
            patch.object(verify_live, "ClassicSessionFactory", return_value=MagicMock()),
            patch("time.monotonic", side_effect=fake_monotonic),
            patch("asyncio.sleep", side_effect=fake_sleep),
        ):
            with self.assertRaisesRegex(AssertionError, "Human pause"):
                await verify_live.verify(idle_timeout_seconds=30.0)

        self.assertEqual(navigate_calls, [])

    async def test_rejects_when_only_child_iframe_performed_get_without_main_target_get(self):
        clock = [200.0]

        def fake_monotonic():
            return clock[0]

        async def fake_sleep(seconds):
            clock[0] += seconds

        events = asyncio.Queue()
        client = MagicMock()
        client.session_id = "owned-session-2"
        client.events = events
        client.connect = AsyncMock()
        client.disconnect = AsyncMock()
        client.close = AsyncMock()
        client.command = AsyncMock(return_value={})

        navigated = [False]
        driver = MagicMock()
        driver.context = "ctx-main"
        driver.matches.side_effect = (
            lambda url: url == "https://www.mafiabattle.com/es/"
        )
        driver.find_target = AsyncMock(return_value="ctx-main")
        driver.install = AsyncMock(return_value=_make_snapshot(state="RUNNING"))
        driver.heartbeat = AsyncMock(return_value=_make_snapshot(state="RUNNING"))
        driver.stop = AsyncMock()

        async def fake_evaluate(expr):
            if "crypto.randomUUID()" in expr:
                return "doc-token-2"
            if "location.replace" in expr:
                navigated[0] = True
                await events.put(
                    {
                        "method": "network.beforeRequestSent",
                        "params": {
                            "context": "ctx-iframe-fb",
                            "navigation": "nav-fb",
                            "request": {
                                "method": "GET",
                                "url": "https://www.facebook.com/plugins/likebox.php",
                            },
                        },
                    }
                )
                return True
            if "__mafiaVerifyDocumentToken" in expr:
                return None if navigated[0] else "doc-token-2"
            return None

        driver.evaluate = AsyncMock(side_effect=fake_evaluate)
        browser = MagicMock()
        browser.ensure_ready = AsyncMock(return_value=999)

        with (
            patch.object(verify_live, "load_config", return_value=self._base_config()),
            patch.object(verify_live, "resident_config", return_value={"dry_run": True, "policies": []}),
            patch.object(verify_live, "AntigravityBrowser", return_value=browser),
            patch.object(verify_live, "BiDiClient", return_value=client),
            patch.object(verify_live, "DOMDriver", return_value=driver),
            patch.object(verify_live, "ClassicSessionFactory", return_value=MagicMock()),
            patch("time.monotonic", side_effect=fake_monotonic),
            patch("asyncio.sleep", side_effect=fake_sleep),
        ):
            with self.assertRaisesRegex(AssertionError, "Main game navigation must be observed as GET"):
                await verify_live.verify()

    async def test_auth_recovery_defers_auto_login_until_after_get_navigation(self):
        clock = [400.0]

        def fake_monotonic():
            return clock[0]

        async def fake_sleep(seconds):
            clock[0] += seconds

        events = asyncio.Queue()
        client = MagicMock()
        client.session_id = "owned-session-auth"
        client.events = events
        client.connect = AsyncMock()
        client.disconnect = AsyncMock()
        client.close = AsyncMock()

        async def fake_command(method, params):
            if method == "script.addPreloadScript":
                return {"script": "preload-auth-script"}
            return {}

        client.command = AsyncMock(side_effect=fake_command)

        navigated = [False]
        installed_configs = []

        driver = MagicMock()
        driver.context = "ctx-main"
        driver.source = "function createMafiaAgent(){}"
        driver.preloads = {("owned-session-auth", "ctx-main"): "preload-initial"}
        driver.matches.side_effect = (
            lambda url: url == "https://www.mafiabattle.com/es/"
        )
        driver.find_target = AsyncMock(return_value="ctx-main")

        async def fake_install(cfg):
            installed_configs.append(cfg)
            return _make_snapshot(state="WAITING_FOR_LOGIN", account=None, dry_run=False)

        async def fake_heartbeat():
            if navigated[0]:
                return {
                    **_make_snapshot(state="RUNNING", account="mati792", dry_run=False),
                    "history": [{"action": "login_fetch"}, {"action": "login_render_get_document"}],
                }
            return _make_snapshot(state="WAITING_FOR_LOGIN", account=None, dry_run=False)

        async def fake_evaluate(expr):
            if "crypto.randomUUID()" in expr:
                return "doc-token-auth"
            if "location.replace" in expr:
                navigated[0] = True
                await events.put(
                    {
                        "method": "network.beforeRequestSent",
                        "params": {
                            "context": "ctx-main",
                            "navigation": "nav-auth",
                            "request": {
                                "method": "GET",
                                "url": "https://www.mafiabattle.com/es/",
                            },
                        },
                    }
                )
                return True
            if "__mafiaVerifyDocumentToken" in expr:
                return None if navigated[0] else "doc-token-auth"
            return None

        driver.install = AsyncMock(side_effect=fake_install)
        driver.heartbeat = AsyncMock(side_effect=fake_heartbeat)
        driver.evaluate = AsyncMock(side_effect=fake_evaluate)
        driver.stop = AsyncMock()

        browser = MagicMock()
        browser.ensure_ready = AsyncMock(return_value=999)

        buf = io.StringIO()
        with (
            patch.object(verify_live, "load_config", return_value=self._base_config()),
            patch.object(
                verify_live,
                "resident_config",
                return_value={
                    "dry_run": False,
                    "policies": [
                        {"kind": "anti_idle", "enabled": True, "auto_login": True, "keepalive_seconds": 60},
                        {"kind": "collector", "enabled": True},
                    ],
                },
            ),
            patch.object(verify_live, "AntigravityBrowser", return_value=browser),
            patch.object(verify_live, "BiDiClient", return_value=client),
            patch.object(verify_live, "DOMDriver", return_value=driver),
            patch.object(verify_live, "ClassicSessionFactory", return_value=MagicMock()),
            patch("time.monotonic", side_effect=fake_monotonic),
            patch("asyncio.sleep", side_effect=fake_sleep),
            redirect_stdout(buf),
        ):
            await verify_live.verify(auth_recovery=True)

        self.assertEqual(len(installed_configs), 1)
        self.assertEqual(
            installed_configs[0]["policies"],
            [{"kind": "anti_idle", "enabled": True, "auto_login": False, "keepalive_seconds": 0}],
        )
        add_preload_calls = [
            c for c in client.command.call_args_list if c.args[0] == "script.addPreloadScript"
        ]
        self.assertEqual(len(add_preload_calls), 1)
        self.assertIn('"auto_login": true', add_preload_calls[0].args[1]["functionDeclaration"])
        payload = json.loads(buf.getvalue())
        self.assertTrue(payload["auth_recovery_enabled"])
        self.assertEqual(payload["game_actions"], 0)


if __name__ == "__main__":
    unittest.main()
