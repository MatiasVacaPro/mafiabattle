"""Durable local showroom observations, audit events, and action receipts."""

import json
import sqlite3
import unicodedata
from collections import Counter
from pathlib import Path
from uuid import uuid4


def _model_name(value: str) -> str:
    name = unicodedata.normalize("NFC", " ".join(value.split()))
    if not name:
        raise ValueError("car model must not be empty")
    return name


def _json(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


class ShowroomRepository:
    """SQLite record of observed inventory and guarded showroom operations."""

    def __init__(self, path: str | Path):
        database_path = Path(path)
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(database_path)
        self._connection.execute("PRAGMA foreign_keys = ON")
        with self._connection:
            self._connection.executescript("""
                CREATE TABLE IF NOT EXISTS inventory_instances (
                    instance_key TEXT PRIMARY KEY,
                    model TEXT NOT NULL,
                    model_key TEXT NOT NULL,
                    state TEXT NOT NULL CHECK (state IN ('current', 'departed')),
                    first_seen_at INTEGER NOT NULL,
                    last_seen_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS inventory_current_model_idx
                    ON inventory_instances (model_key, state);
                CREATE TABLE IF NOT EXISTS inventory_events (
                    event_key TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    model TEXT,
                    occurred_at INTEGER NOT NULL,
                    payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS action_receipts (
                    action_key TEXT PRIMARY KEY,
                    action_type TEXT NOT NULL,
                    model TEXT,
                    offer_id TEXT,
                    status TEXT NOT NULL,
                    at INTEGER NOT NULL,
                    detail TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agent_state (
                    checkpoint_id INTEGER PRIMARY KEY CHECK (checkpoint_id = 1),
                    state TEXT NOT NULL,
                    saved_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS repository_clock (
                    clock_id INTEGER PRIMARY KEY CHECK (clock_id = 1),
                    observed_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_ledger (
                    model_key TEXT PRIMARY KEY,
                    model TEXT NOT NULL,
                    current_count INTEGER NOT NULL DEFAULT 0,
                    robbed_count INTEGER NOT NULL DEFAULT 0,
                    stolen_from_us_count INTEGER NOT NULL DEFAULT 0,
                    rejected_offers_count INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS robbery_stats (
                    stat_id INTEGER PRIMARY KEY CHECK (stat_id = 1),
                    success_count INTEGER NOT NULL DEFAULT 0,
                    failed_count INTEGER NOT NULL DEFAULT 0,
                    stolen_from_us_count INTEGER NOT NULL DEFAULT 0,
                    sell_all_count INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL
                );
            """)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self._connection.close()

    def reconcile(self, cars: list[dict], observed_at: int) -> dict:
        """Align local rows with a complete observation, by model count only."""
        observed = Counter()
        display_names = {}
        for car in cars:
            name = _model_name(car["model"])
            key = name.casefold()
            observed[key] += 1
            display_names.setdefault(key, name)

        added = {}
        departed = {}
        counts = {}
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            clock = self._connection.execute(
                "SELECT observed_at FROM repository_clock WHERE clock_id = 1"
            ).fetchone()
            if clock is not None and observed_at < clock[0]:
                raise ValueError("stale showroom observation")
            current = self._connection.execute(
                "SELECT instance_key, model, model_key FROM inventory_instances "
                "WHERE state = 'current' ORDER BY first_seen_at, instance_key"
            ).fetchall()
            if clock is not None and observed_at == clock[0]:
                if observed != Counter(row[2] for row in current):
                    raise ValueError("conflicting showroom observation at same timestamp")
            is_fresh_scan = clock is None or observed_at > clock[0]
            by_key = {}
            for instance_key, model, model_key in current:
                by_key.setdefault(model_key, []).append((instance_key, model))

            for key in observed.keys() | by_key.keys():
                rows = by_key.get(key, [])
                count = observed[key]
                name = rows[0][1] if rows else display_names[key]
                retained = min(len(rows), count)
                for instance_key, _ in rows[:retained]:
                    self._connection.execute(
                        "UPDATE inventory_instances SET last_seen_at = ? WHERE instance_key = ?",
                        (observed_at, instance_key),
                    )
                for instance_key, _ in rows[retained:]:
                    self._connection.execute(
                        "UPDATE inventory_instances SET state = 'departed' WHERE instance_key = ?",
                        (instance_key,),
                    )
                for _ in range(count - retained):
                    self._connection.execute(
                        "INSERT INTO inventory_instances "
                        "(instance_key, model, model_key, state, first_seen_at, last_seen_at) "
                        "VALUES (?, ?, ?, 'current', ?, ?)",
                        (uuid4().hex, name, key, observed_at, observed_at),
                    )
                if count:
                    counts[name] = count
                if count > len(rows):
                    added[name] = count - len(rows)
                if count < len(rows):
                    departed[name] = len(rows) - count
            if is_fresh_scan:
                self._connection.execute(
                    "UPDATE model_ledger SET current_count = 0, updated_at = ?",
                    (observed_at,),
                )
                for key, count in observed.items():
                    name = by_key[key][0][1] if key in by_key else display_names[key]
                    self._connection.execute(
                        "INSERT INTO model_ledger (model_key, model, current_count, updated_at) "
                        "VALUES (?, ?, ?, ?) ON CONFLICT(model_key) DO UPDATE SET "
                        "model = excluded.model, current_count = excluded.current_count, "
                        "updated_at = excluded.updated_at",
                        (key, name, count, observed_at),
                    )
            self._connection.execute(
                "INSERT INTO repository_clock (clock_id, observed_at) VALUES (1, ?) "
                "ON CONFLICT(clock_id) DO UPDATE SET observed_at = excluded.observed_at",
                (observed_at,),
            )

        return {
            "counts_by_model": dict(sorted(counts.items())),
            "total": sum(observed.values()),
            "discrepancies": {
                "added_by_model": dict(sorted(added.items())),
                "departed_by_model": dict(sorted(departed.items())),
            },
        }

    def record_event(
        self, event_key: str, event_type: str, model: str | None,
        occurred_at: int, payload: dict,
    ) -> bool:
        encoded = _json(payload)
        clean_model = _model_name(model) if isinstance(model, str) and model.strip() else None
        with self._connection:
            result = self._connection.execute(
                "INSERT INTO inventory_events "
                "(event_key, event_type, model, occurred_at, payload) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_key) DO NOTHING",
                (event_key, event_type, clean_model, occurred_at, encoded),
            )
            if result.rowcount != 1:
                return False
            clock = self._connection.execute(
                "SELECT observed_at FROM repository_clock WHERE clock_id = 1"
            ).fetchone()
            last_calibrated_at = clock[0] if clock else None
            self._connection.execute(
                "INSERT INTO robbery_stats (stat_id, updated_at) VALUES (1, ?) "
                "ON CONFLICT(stat_id) DO UPDATE SET updated_at = MAX(updated_at, excluded.updated_at)",
                (occurred_at,),
            )
            if event_type in ("rob_car_success", "car_robbery"):
                self._connection.execute(
                    "UPDATE robbery_stats SET success_count = success_count + 1, updated_at = ? "
                    "WHERE stat_id = 1",
                    (occurred_at,),
                )
                if clean_model:
                    key = clean_model.casefold()
                    delta = 1 if (last_calibrated_at is None or occurred_at > last_calibrated_at) else 0
                    self._connection.execute(
                        "INSERT INTO model_ledger "
                        "(model_key, model, current_count, robbed_count, updated_at) "
                        "VALUES (?, ?, ?, 1, ?) ON CONFLICT(model_key) DO UPDATE SET "
                        "current_count = current_count + ?, "
                        "robbed_count = robbed_count + 1, "
                        "updated_at = excluded.updated_at",
                        (key, clean_model, delta, occurred_at, delta),
                    )
            elif event_type == "rob_car_failed":
                self._connection.execute(
                    "UPDATE robbery_stats SET failed_count = failed_count + 1, updated_at = ? "
                    "WHERE stat_id = 1",
                    (occurred_at,),
                )
            elif event_type == "car_theft_notice":
                self._connection.execute(
                    "UPDATE robbery_stats SET stolen_from_us_count = stolen_from_us_count + 1, "
                    "updated_at = ? WHERE stat_id = 1",
                    (occurred_at,),
                )
                if clean_model:
                    key = clean_model.casefold()
                    age = payload.get("age_seconds")
                    has_age = isinstance(age, (int, float)) and not isinstance(age, bool) and age >= 0
                    theft_at = (occurred_at - int(age) * 1000) if has_age else None
                    is_fresh_theft = (
                        theft_at is not None
                        and (last_calibrated_at is None or theft_at > last_calibrated_at)
                    )
                    delta = 1 if is_fresh_theft else 0
                    self._connection.execute(
                        "INSERT INTO model_ledger "
                        "(model_key, model, current_count, stolen_from_us_count, updated_at) "
                        "VALUES (?, ?, 0, 1, ?) ON CONFLICT(model_key) DO UPDATE SET "
                        "current_count = MAX(0, current_count - ?), "
                        "stolen_from_us_count = stolen_from_us_count + 1, "
                        "updated_at = excluded.updated_at",
                        (key, clean_model, occurred_at, delta),
                    )
            elif event_type == "showroom_reject" and clean_model:
                key = clean_model.casefold()
                self._connection.execute(
                    "INSERT INTO model_ledger "
                    "(model_key, model, current_count, rejected_offers_count, updated_at) "
                    "VALUES (?, ?, 0, 1, ?) ON CONFLICT(model_key) DO UPDATE SET "
                    "rejected_offers_count = rejected_offers_count + 1, "
                    "updated_at = excluded.updated_at",
                    (key, clean_model, occurred_at),
                )
            elif event_type == "showroom_sell_all":
                self._connection.execute(
                    "UPDATE robbery_stats SET sell_all_count = sell_all_count + 1, updated_at = ? "
                    "WHERE stat_id = 1",
                    (occurred_at,),
                )
        return True

    def ledger_summary(self) -> dict:
        rows = self._connection.execute(
            "SELECT model, current_count, robbed_count, stolen_from_us_count, rejected_offers_count "
            "FROM model_ledger ORDER BY model"
        ).fetchall()
        stats_row = self._connection.execute(
            "SELECT success_count, failed_count, stolen_from_us_count, sell_all_count "
            "FROM robbery_stats WHERE stat_id = 1"
        ).fetchone()
        by_model = {
            model: {
                "current": current,
                "robbed": robbed,
                "stolen_from_us": stolen,
                "rejected_offers": rejected,
            }
            for model, current, robbed, stolen, rejected in rows
        }
        return {
            "total_current": sum(item["current"] for item in by_model.values()),
            "counts_by_model": {
                model: item["current"] for model, item in by_model.items() if item["current"] > 0
            },
            "by_model": by_model,
            "stats": {
                "rob_success": stats_row[0] if stats_row else 0,
                "rob_failed": stats_row[1] if stats_row else 0,
                "stolen_from_us": stats_row[2] if stats_row else 0,
                "sell_all": stats_row[3] if stats_row else 0,
            },
        }

    def save_agent_state(self, state: dict, saved_at: int) -> None:
        encoded = _json(state)
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            checkpoint = self._connection.execute(
                "SELECT saved_at, state FROM agent_state WHERE checkpoint_id = 1"
            ).fetchone()
            if checkpoint is not None and saved_at < checkpoint[0]:
                raise ValueError("stale showroom checkpoint")
            if checkpoint is not None and saved_at == checkpoint[0] and encoded != checkpoint[1]:
                raise ValueError("conflicting showroom checkpoint at same timestamp")
            self._connection.execute(
                "INSERT INTO agent_state (checkpoint_id, state, saved_at) "
                "VALUES (1, ?, ?) ON CONFLICT(checkpoint_id) DO UPDATE SET "
                "state = excluded.state, saved_at = excluded.saved_at",
                (encoded, saved_at),
            )

    def load_agent_state(self) -> dict:
        row = self._connection.execute(
            "SELECT state FROM agent_state WHERE checkpoint_id = 1"
        ).fetchone()
        return json.loads(row[0]) if row else {}

    def record_action(
        self, action_key: str, action_type: str, model: str | None,
        offer_id: str | None, status: str, at: int, detail: dict,
    ) -> bool:
        encoded = _json(detail)
        with self._connection:
            result = self._connection.execute(
                "INSERT INTO action_receipts "
                "(action_key, action_type, model, offer_id, status, at, detail) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(action_key) DO NOTHING",
                (action_key, action_type, model, offer_id, status, at, encoded),
            )
        return result.rowcount == 1

    def confirm_action(self, action_key: str, at: int, detail: dict) -> bool:
        """Promote an uncertain receipt after exact external confirmation."""
        encoded = _json(detail)
        with self._connection:
            result = self._connection.execute(
                "UPDATE action_receipts SET status = 'confirmed', at = ?, detail = ? "
                "WHERE action_key = ? AND status = 'uncertain'",
                (at, encoded, action_key),
            )
        return result.rowcount == 1

