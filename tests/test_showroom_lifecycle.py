import sqlite3
import json
import contextlib
import io
from types import SimpleNamespace
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from main_bidi import ShowroomLifecycle
import main_bidi
from core.showroom_repository import ShowroomRepository
from core.bot_config import load_config


def snapshot(
    at=1000,
    cars=None,
    *,
    complete=True,
    state=None,
    events=None,
    pending=None,
    last_action=None,
):
    cars = (
        [{"model": "BMW X5", "row_id": "4", "offer_id": None, "price": None}]
        if cars is None
        else cars
    )
    showroom = {
        "total": len(cars),
        "capacity": 250,
        "unpriced": len(cars),
        "counts_by_model": {"BMW X5": len(cars)} if cars else {},
        "inventory_generation": "generation-1",
        "review_started_at": 800,
        "review_completed_at": 900,
        "reviewed_offer_ids": [],
        "pending_action": pending,
        "last_confirmed_result": last_action,
        "sell_attempted_generation": None,
        "capacity_state": None,
        "reconciliation_required": bool(pending),
        "enabled": True,
        "mode": "manage",
        "next_review_at": 10000,
        "last_action": last_action,
        "inventory_scan": {"complete": complete, "at": at, "cars": cars},
        "audit_events": events or [],
        "next_scan_due": 0,
    }
    if state:
        showroom.update(state)
    return {
        "state": "RUNNING",
        "account": "test",
        "dialogs": [],
        "history": [],
        "last_heartbeat": at,
        "showroom": showroom,
    }


class TestShowroomLifecycle(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "showroom.sqlite3"
        self.config = load_config(
            Path(__file__).parents[1] / "config/bidi-defaults.json"
        )
        self.config["modules"]["showroom_manager"].update(
            {
                "database_path": str(self.path),
                "enabled": True,
                "mode": "manage",
            }
        )

    def test_install_and_repeated_heartbeat_persist_complete_inventory_and_state(self):
        lifecycle = ShowroomLifecycle(self.config)
        first = lifecycle.agent_config(False)
        self.assertEqual(first["showroom_state"], {})
        current = snapshot()
        lifecycle.persist(current)
        lifecycle.persist(current)
        with ShowroomRepository(self.path) as repository:
            self.assertEqual(repository.load_agent_state()["review_completed_at"], 900)
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM inventory_instances WHERE state='current'"
                ).fetchone()[0],
                1,
            )
        self.assertEqual(
            lifecycle.agent_config(False)["showroom_state"]["review_completed_at"], 900
        )

    def test_reconnect_and_restart_load_newest_checkpoint_including_uncertain_receipt(
        self,
    ):
        lifecycle = ShowroomLifecycle(self.config)
        lifecycle.persist(snapshot(1000))
        old_config = lifecycle.agent_config(False)
        pending = {
            "key": "reject_offer:900:4",
            "kind": "reject_offer",
            "offer_id": "4",
            "model": "BMW X5",
            "at": 1100,
        }
        lifecycle.persist(snapshot(1200, pending=pending))
        self.assertIsNone(old_config["showroom_state"]["pending_action"])
        fresh_config = lifecycle.agent_config(False)
        self.assertEqual(fresh_config["showroom_state"]["pending_action"], pending)
        self.assertTrue(
            ShowroomLifecycle(self.config).agent_config(False)["showroom_state"][
                "reconciliation_required"
            ]
        )
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT status FROM action_receipts WHERE action_key=?",
                    (pending["key"],),
                ).fetchone()[0],
                "uncertain",
            )

    def test_duplicate_sequenced_audit_and_receipt_are_idempotent(self):
        lifecycle = ShowroomLifecycle(self.config)
        event = {
            "sequence": 7,
            "at": 1000,
            "action": "car_robbery",
            "fingerprint": "robbery:bmw",
            "model": "BMW X5",
        }
        receipt = {
            "key": "reject_offer:900:4",
            "kind": "reject_offer",
            "at": 1000,
            "result": "confirmed",
        }
        current = snapshot(events=[event], last_action=receipt)
        lifecycle.persist(current)
        lifecycle.persist(current)
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM inventory_events").fetchone()[
                    0
                ],
                1,
            )
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM action_receipts").fetchone()[
                    0
                ],
                1,
            )

    def test_late_confirmed_receipt_promotes_same_uncertain_action(self):
        lifecycle = ShowroomLifecycle(self.config)
        pending = {
            "key": "reject_offer:900:4",
            "kind": "reject_offer",
            "offer_id": "4",
            "model": "BMW X5",
            "at": 1000,
        }
        lifecycle.persist(snapshot(1000, pending=pending))
        confirmed = {
            "key": pending["key"],
            "kind": "reject_offer",
            "at": 1200,
            "result": "confirmed",
        }
        lifecycle.persist(snapshot(1200, last_action=confirmed))
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*), status FROM action_receipts WHERE action_key=?",
                    (pending["key"],),
                ).fetchone(),
                (1, "confirmed"),
            )

    def test_complete_empty_scan_departs_cars(self):
        lifecycle = ShowroomLifecycle(self.config)
        lifecycle.persist(snapshot(1000))
        lifecycle.persist(snapshot(1200, cars=[]))
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM inventory_instances WHERE state='current'"
                ).fetchone()[0],
                0,
            )

    def test_unavailable_or_incomplete_scan_never_erases_inventory(self):
        lifecycle = ShowroomLifecycle(self.config)
        lifecycle.persist(snapshot(1000))
        lifecycle.persist(snapshot(1200, cars=[], complete=False))
        unavailable = snapshot(1300, cars=[])
        unavailable["showroom"]["inventory_scan"] = None
        lifecycle.persist(unavailable)
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM inventory_instances WHERE state='current'"
                ).fetchone()[0],
                1,
            )

    def test_event_write_failure_does_not_advance_checkpoint_past_evidence(self):
        lifecycle = ShowroomLifecycle(self.config)
        lifecycle.persist(snapshot(1000))
        later = snapshot(
            1200,
            state={"review_completed_at": 1100},
            events=[
                {
                    "sequence": 1,
                    "at": 1200,
                    "action": "rob_car_success",
                    "fingerprint": "rob_car:BMW X5:1",
                    "model": "BMW X5",
                }
            ],
        )
        with patch.object(
            ShowroomRepository,
            "record_event",
            side_effect=sqlite3.OperationalError("locked"),
        ):
            self.assertFalse(lifecycle.persist(later))
        with ShowroomRepository(self.path) as repository:
            self.assertEqual(repository.load_agent_state()["review_completed_at"], 900)

    def test_database_failure_disables_only_showroom_in_future_install_configs(self):
        lifecycle = ShowroomLifecycle(self.config)
        with patch.object(
            ShowroomRepository,
            "reconcile",
            side_effect=sqlite3.OperationalError("locked"),
        ):
            lifecycle.persist(snapshot(1000))
        self.assertTrue(lifecycle.disabled)
        configured = lifecycle.agent_config(False)
        showroom = next(p for p in configured["policies"] if p["kind"] == "showroom")
        self.assertFalse(showroom["enabled"])
        self.assertTrue(
            any(p["enabled"] for p in configured["policies"] if p["kind"] != "showroom")
        )

    def test_unavailable_database_at_install_fails_closed_before_agent_runs(self):
        lifecycle = ShowroomLifecycle(self.config)
        with patch.object(
            ShowroomRepository,
            "load_agent_state",
            side_effect=sqlite3.OperationalError("unavailable"),
        ):
            configured = lifecycle.agent_config(False)
        showroom = next(p for p in configured["policies"] if p["kind"] == "showroom")
        criminal = next(p for p in configured["policies"] if p["kind"] == "criminal")
        self.assertFalse(showroom["enabled"])
        self.assertTrue(criminal["enabled"])
        self.assertTrue(lifecycle.disabled)


class TestSupervisorShowroomLifecycle(unittest.IsolatedAsyncioTestCase):
    async def test_install_and_heartbeat_persist_snapshots_and_safe_status(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory)
            config = load_config(
                Path(__file__).parents[1] / "config/bidi-defaults.json"
            )
            config["modules"]["showroom_manager"]["database_path"] = str(
                runtime / "showroom.sqlite3"
            )
            config["modules"]["showroom_manager"].update(enabled=True, mode="manage")
            first = snapshot(1000)
            second = snapshot(1200, cars=[])
            driver = MagicMock()
            driver.context = "test-context"
            driver.find_target = AsyncMock(return_value="test-context")
            driver.install = AsyncMock(return_value=first)
            driver.heartbeat = AsyncMock(return_value=second)
            driver.stop = AsyncMock()
            client = MagicMock()
            client.session_id = "test-session"
            client.connect = AsyncMock()
            client.close = AsyncMock()
            browser = MagicMock()
            browser.ensure_ready = AsyncMock()
            browser.profile = runtime / "profile"
            browser.application = runtime / "browser"
            browser.pid = 42
            guard = MagicMock()
            guard.observe.return_value = "RUNNING"
            args = SimpleNamespace(dry_run=False, inspect=False, once=True, duration=0)
            with (
                patch.object(main_bidi, "RUNTIME", runtime),
                patch.object(main_bidi, "BiDiClient", return_value=client),
                patch.object(main_bidi, "AntigravityBrowser", return_value=browser),
                patch.object(main_bidi, "DOMDriver", return_value=driver),
                patch.object(main_bidi, "UserGuard", return_value=guard),
                patch.object(main_bidi, "FailureReporter"),
                patch.object(main_bidi.asyncio, "sleep", new_callable=AsyncMock),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                await main_bidi.supervise(args, config)
            self.assertEqual(driver.install.await_args.args[0]["showroom_state"], {})
            with sqlite3.connect(runtime / "showroom.sqlite3") as connection:
                self.assertEqual(
                    connection.execute(
                        "SELECT COUNT(*) FROM inventory_instances WHERE state='current'"
                    ).fetchone()[0],
                    0,
                )
            status = json.loads((runtime / "status.json").read_text())
            self.assertEqual(status["last_snapshot"]["showroom"]["total"], 0)
            self.assertNotIn("session_id", status)

    async def test_write_failure_revokes_installed_showroom_without_stopping_heartbeat(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory)
            config = load_config(
                Path(__file__).parents[1] / "config/bidi-defaults.json"
            )
            config["modules"]["showroom_manager"]["database_path"] = str(
                runtime / "showroom.sqlite3"
            )
            config["modules"]["showroom_manager"].update(enabled=True, mode="manage")
            driver = MagicMock()
            driver.context = "test-context"
            driver.find_target = AsyncMock(return_value="test-context")
            driver.install = AsyncMock(return_value=snapshot(1000))
            driver.heartbeat = AsyncMock(return_value=snapshot(1200))
            driver.evaluate = AsyncMock(return_value=True)
            driver.stop = AsyncMock()
            client = MagicMock()
            client.session_id = "test-session"
            client.connect = AsyncMock()
            client.close = AsyncMock()
            browser = MagicMock()
            browser.ensure_ready = AsyncMock()
            browser.profile = runtime / "profile"
            browser.application = runtime / "browser"
            browser.pid = 42
            guard = MagicMock()
            guard.observe.return_value = "RUNNING"
            args = SimpleNamespace(dry_run=False, inspect=False, once=True, duration=0)
            with (
                patch.object(main_bidi, "RUNTIME", runtime),
                patch.object(main_bidi, "BiDiClient", return_value=client),
                patch.object(main_bidi, "AntigravityBrowser", return_value=browser),
                patch.object(main_bidi, "DOMDriver", return_value=driver),
                patch.object(main_bidi, "UserGuard", return_value=guard),
                patch.object(main_bidi, "FailureReporter"),
                patch.object(main_bidi.asyncio, "sleep", new_callable=AsyncMock),
                patch.object(
                    ShowroomRepository,
                    "reconcile",
                    side_effect=sqlite3.OperationalError("locked"),
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                await main_bidi.supervise(args, config)
            self.assertGreaterEqual(driver.evaluate.await_count, 1)
            self.assertEqual(
                driver.evaluate.await_args.args[0],
                "globalThis.__mafiaBot?.disableShowroomActions()",
            )
            driver.heartbeat.assert_awaited_once()
            status = json.loads((runtime / "status.json").read_text())
            self.assertTrue(status["last_snapshot"]["showroom"]["persistence_blocked"])
            self.assertIn("showroom_persistence", status["last_snapshot"]["issues"])
