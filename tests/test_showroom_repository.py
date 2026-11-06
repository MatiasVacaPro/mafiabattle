import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from core.showroom_repository import ShowroomRepository


class TestShowroomRepository(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.path = Path(self.temporary_directory.name) / "nested" / "showroom.sqlite3"

    def test_fresh_database_creates_required_tables_and_empty_checkpoint(self):
        with ShowroomRepository(self.path) as repository:
            self.assertEqual(repository.load_agent_state(), {})
            self.assertEqual(repository.reconcile([], 10), {
                "counts_by_model": {},
                "total": 0,
                "discrepancies": {"added_by_model": {}, "departed_by_model": {}},
            })

        with sqlite3.connect(self.path) as connection:
            tables = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )}
        self.assertTrue({
            "inventory_instances", "inventory_events", "action_receipts",
            "agent_state", "repository_clock",
        } <= tables)

    def test_reconcile_counts_every_car_including_unpriced_and_is_repeatable(self):
        cars = [
            {"model": " Ferrari  F12berlinetta ", "offer_id": "23", "price": 300000},
            {"model": "Ferrari F12berlinetta", "offer_id": None, "price": None},
            {"model": "Bugatti Veyron"},
        ]
        with ShowroomRepository(self.path) as repository:
            first = repository.reconcile(cars, 100)
            second = repository.reconcile(cars, 110)

        self.assertEqual(first, {
            "counts_by_model": {"Bugatti Veyron": 1, "Ferrari F12berlinetta": 2},
            "total": 3,
            "discrepancies": {
                "added_by_model": {"Bugatti Veyron": 1, "Ferrari F12berlinetta": 2},
                "departed_by_model": {},
            },
        })
        self.assertEqual(second["discrepancies"], {"added_by_model": {}, "departed_by_model": {}})
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM inventory_instances WHERE state = 'current'"
            ).fetchone()[0], 3)

    def test_reconcile_departures_do_not_identify_physical_same_model_car(self):
        with ShowroomRepository(self.path) as repository:
            repository.reconcile([{"model": "BMW X5"}, {"model": "BMW X5"}], 10)
            changed = repository.reconcile([{"model": "BMW X5"}], 20)
            self.assertEqual(changed, {
                "counts_by_model": {"BMW X5": 1},
                "total": 1,
                "discrepancies": {"added_by_model": {}, "departed_by_model": {"BMW X5": 1}},
            })
            returned = repository.reconcile([{"model": "BMW X5"}, {"model": "BMW X5"}], 30)
            self.assertEqual(returned["discrepancies"], {
                "added_by_model": {"BMW X5": 1}, "departed_by_model": {},
            })
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute(
                "SELECT state, COUNT(*) FROM inventory_instances GROUP BY state"
            ).fetchall(), [("current", 2), ("departed", 1)])

    def test_older_reconcile_cannot_create_false_departure_or_rewind_last_seen(self):
        with ShowroomRepository(self.path) as repository:
            repository.reconcile([{"model": "BMW X5"}], 200)
            with self.assertRaisesRegex(ValueError, "stale"):
                repository.reconcile([], 100)
            latest = repository.reconcile([{"model": "BMW X5"}], 210)
            self.assertEqual(latest["discrepancies"], {
                "added_by_model": {}, "departed_by_model": {},
            })

        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute(
                "SELECT state, first_seen_at, last_seen_at FROM inventory_instances"
            ).fetchall(), [("current", 200, 210)])
        with ShowroomRepository(self.path) as repository:
            with self.assertRaisesRegex(ValueError, "stale"):
                repository.reconcile([], 205)

    def test_older_reconcile_after_empty_snapshot_cannot_create_false_acquisition(self):
        with ShowroomRepository(self.path) as repository:
            repository.reconcile([{"model": "BMW X5"}], 100)
            repository.reconcile([], 200)

        with ShowroomRepository(self.path) as repository:
            with self.assertRaisesRegex(ValueError, "stale"):
                repository.reconcile([{"model": "BMW X5"}], 150)
            current = repository.reconcile([], 210)
            self.assertEqual(current, {
                "counts_by_model": {}, "total": 0,
                "discrepancies": {"added_by_model": {}, "departed_by_model": {}},
            })
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute(
                "SELECT state, COUNT(*) FROM inventory_instances GROUP BY state"
            ).fetchall(), [("departed", 1)])

    def test_same_timestamp_allows_replay_but_rejects_conflicting_inventory(self):
        with ShowroomRepository(self.path) as repository:
            repository.reconcile([{"model": "BMW X5"}], 100)
            replay = repository.reconcile([{"model": "BMW X5"}], 100)
            self.assertEqual(replay["discrepancies"], {
                "added_by_model": {}, "departed_by_model": {},
            })
            with self.assertRaisesRegex(ValueError, "conflicting"):
                repository.reconcile([], 100)
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute(
                "SELECT state, COUNT(*) FROM inventory_instances GROUP BY state"
            ).fetchall(), [("current", 1)])

    def test_event_and_action_keys_are_idempotent_and_payloads_survive_reload(self):
        with ShowroomRepository(self.path) as repository:
            self.assertTrue(repository.record_event("rob:1", "robbery", "BMW X5", 100, {"success": True}))
            self.assertFalse(repository.record_event("rob:1", "robbery", "BMW X5", 101, {"success": False}))
            self.assertTrue(repository.record_action("reject:23", "rejectoffer", "BMW X5", "23", "confirmed", 102, {"price": 50}))
            self.assertFalse(repository.record_action("reject:23", "rejectoffer", "BMW X5", "23", "retry", 103, {}))

        with ShowroomRepository(self.path):
            with sqlite3.connect(self.path) as connection:
                event = connection.execute("SELECT event_type, payload FROM inventory_events").fetchone()
                action = connection.execute("SELECT action_type, status, detail FROM action_receipts").fetchone()
        self.assertEqual(event[0], "robbery")
        self.assertEqual(json.loads(event[1]), {"success": True})
        self.assertEqual(action[:2], ("rejectoffer", "confirmed"))
        self.assertEqual(json.loads(action[2]), {"price": 50})

    def test_checkpoint_survives_reload_and_failed_serialization_preserves_it(self):
        state = {"pending_action": {"key": "reject:23"}, "seen": [1, 2]}
        with ShowroomRepository(self.path) as repository:
            repository.save_agent_state(state, 100)
            with self.assertRaises(TypeError):
                repository.save_agent_state({"bad": object()}, 101)
            self.assertEqual(repository.load_agent_state(), state)

        with ShowroomRepository(self.path) as repository:
            self.assertEqual(repository.load_agent_state(), state)
            repository.save_agent_state({"next_review_at": 500}, 200)
            self.assertEqual(repository.load_agent_state(), {"next_review_at": 500})
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*), saved_at FROM agent_state").fetchone(), (1, 200))

    def test_older_checkpoint_cannot_replace_newer_checkpoint_after_reload(self):
        with ShowroomRepository(self.path) as repository:
            repository.save_agent_state({"pending_action": "new"}, 200)

        with ShowroomRepository(self.path) as repository:
            with self.assertRaisesRegex(ValueError, "stale"):
                repository.save_agent_state({"pending_action": "old"}, 100)
            self.assertEqual(repository.load_agent_state(), {"pending_action": "new"})
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute(
                "SELECT state, saved_at FROM agent_state"
            ).fetchone(), ('{"pending_action": "new"}', 200))

    def test_same_timestamp_checkpoint_allows_replay_but_rejects_conflict(self):
        with ShowroomRepository(self.path) as repository:
            repository.save_agent_state({"pending_action": "new"}, 200)
            repository.save_agent_state({"pending_action": "new"}, 200)
            with self.assertRaisesRegex(ValueError, "conflicting"):
                repository.save_agent_state({"pending_action": "old"}, 200)
            self.assertEqual(repository.load_agent_state(), {"pending_action": "new"})

    def test_dynamic_ledger_tracks_robbery_success_failure_theft_and_calibrates_on_reconcile(self):
        with ShowroomRepository(self.path) as repository:
            repository.reconcile(
                [{"model": "Bugatti Veyron"}, {"model": "Audi R8"}], 10000
            )
            self.assertEqual(repository.ledger_summary()["counts_by_model"], {
                "Audi R8": 1, "Bugatti Veyron": 1,
            })
            # Dynamic +1 on car robbery success after calibration
            repository.record_event("rob:1", "rob_car_success", "Porsche Carrera GT", 15000, {"model": "Porsche Carrera GT"})
            # Replay of same scan timestamp must not erase dynamic +1
            repository.reconcile(
                [{"model": "Bugatti Veyron"}, {"model": "Audi R8"}], 10000
            )
            # Failed robbery increments failed_count without changing car counts
            repository.record_event("fail:1", "rob_car_failed", None, 16000, {"text": "Failed"})
            # Old theft notice (occurred before t=10000: age_seconds=20 -> theft_at=17000-20000 = -3000 <= 10000)
            repository.record_event("theft:old", "car_theft_notice", "Bugatti Veyron", 17000, {"age_seconds": 20})
            # Fresh theft notice (occurred after t=10000: age_seconds=2 -> theft_at=18000-2000 = 16000 > 10000)
            repository.record_event("theft:fresh", "car_theft_notice", "Audi R8", 18000, {"age_seconds": 2})

            summary = repository.ledger_summary()
            self.assertEqual(summary["counts_by_model"], {
                "Bugatti Veyron": 1,
                "Porsche Carrera GT": 1,
            })
            self.assertEqual(summary["total_current"], 2)
            self.assertEqual(summary["stats"], {
                "rob_success": 1,
                "rob_failed": 1,
                "stolen_from_us": 2,
                "sell_all": 0,
            })
            # New showroom scan calibrates ledger to exact showroom contents
            repository.reconcile(
                [{"model": "Bugatti Veyron"}, {"model": "Porsche Carrera GT"}, {"model": "Maybach 57S"}],
                25000,
            )
            calibrated = repository.ledger_summary()
            self.assertEqual(calibrated["counts_by_model"], {
                "Bugatti Veyron": 1,
                "Maybach 57S": 1,
                "Porsche Carrera GT": 1,
            })
            self.assertEqual(calibrated["total_current"], 3)


if __name__ == "__main__":
    unittest.main()
