"""Bridge resident snapshots to the durable showroom checkpoint."""

import logging
import time
from pathlib import Path
from core.bot_config import resident_config
from core.showroom_repository import ShowroomRepository

ROOT = Path(__file__).resolve().parents[1]
LOG = logging.getLogger("mafiabattle")
SHOWROOM_STATE_FIELDS = (
    "total",
    "capacity",
    "unpriced",
    "counts_by_model",
    "inventory_generation",
    "review_started_at",
    "review_completed_at",
    "reviewed_offer_ids",
    "pending_action",
    "last_confirmed_result",
    "sell_attempted_generation",
    "capacity_state",
    "reconciliation_required",
)


class ShowroomLifecycle:
    """Bridge resident snapshots and the durable showroom checkpoint."""

    def __init__(self, config):
        database_path = Path(config["modules"]["showroom_manager"]["database_path"])
        self.path = (
            database_path if database_path.is_absolute() else ROOT / database_path
        )
        self.config = config
        self.disabled = False
        self.issue = None

    def _fail(self, error):
        self.disabled = True
        self.issue = f"Showroom persistence unavailable ({type(error).__name__})"
        LOG.error("%s: %s", self.issue, error)

    def agent_config(self, dry_run):
        result = resident_config(self.config, dry_run)
        if not self.disabled:
            try:
                with ShowroomRepository(self.path) as repository:
                    result["showroom_state"] = repository.load_agent_state()
            except Exception as error:
                self._fail(error)
        if self.disabled:
            result["showroom_state"] = {}
            for policy in result["policies"]:
                if policy["kind"] == "showroom":
                    policy["enabled"] = False
        return result

    def persist(self, snapshot):
        showroom = snapshot.get("showroom") if isinstance(snapshot, dict) else None
        if self.disabled or not isinstance(showroom, dict):
            return not self.disabled
        try:
            with ShowroomRepository(self.path) as repository:
                scan = showroom.get("inventory_scan")
                if isinstance(scan, dict) and scan.get("complete") is True:
                    cars = scan["cars"]
                    observed_at = scan.get("at", scan.get("observed_at"))
                    if (
                        not isinstance(cars, list)
                        or isinstance(observed_at, bool)
                        or (not isinstance(observed_at, int))
                    ):
                        raise ValueError("invalid complete showroom scan")
                    repository.reconcile(cars, observed_at)
                state = {
                    field: showroom[field]
                    for field in SHOWROOM_STATE_FIELDS
                    if field in showroom
                }
                for event in showroom.get("audit_events") or []:
                    event_key = str(
                        event.get("fingerprint")
                        or f"{event['action']}:{event['at']}:{event['sequence']}"
                    )
                    repository.record_event(
                        event_key,
                        event["action"],
                        event.get("model"),
                        event["at"],
                        event,
                    )
                pending = showroom.get("pending_action")
                if pending:
                    repository.record_action(
                        pending["key"],
                        pending["kind"],
                        pending.get("model"),
                        pending.get("offer_id"),
                        "uncertain",
                        pending["at"],
                        pending,
                    )
                confirmed = showroom.get("last_confirmed_result") or showroom.get(
                    "last_action"
                )
                if confirmed and confirmed.get("result") == "confirmed":
                    key = confirmed["key"]
                    if not repository.confirm_action(key, confirmed["at"], confirmed):
                        repository.record_action(
                            key,
                            confirmed["kind"],
                            confirmed.get("model"),
                            confirmed.get("offer_id"),
                            "confirmed",
                            confirmed["at"],
                            confirmed,
                        )
                repository.save_agent_state(state, time.time_ns())
                showroom["ledger"] = repository.ledger_summary()
        except Exception as error:
            self._fail(error)
            return False
        return True


async def persist_snapshot(snapshot, lifecycle, driver):
    if not lifecycle.persist(snapshot):
        await driver.evaluate("globalThis.__mafiaBot?.disableShowroomActions()")
        snapshot.setdefault("issues", {})["showroom_persistence"] = lifecycle.issue
        if isinstance(snapshot.get("showroom"), dict):
            snapshot["showroom"]["persistence_blocked"] = True
