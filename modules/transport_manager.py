from modules.base import PolicyModule

"Transport objectives share the resident modal, receipt and account guards."
import json
from pathlib import Path


class TransportManager(PolicyModule):
    KEY = "transport_manager"
    NAME = "transport_manager"
    KIND = "transport"
    DEFAULTS = {
        "enabled": False,
        "scan_seconds": 300,
        "minimum_commit_seconds": 86400,
        "weed_reserve_enabled": False,
    }

    @classmethod
    def policy(cls, settings):
        catalog = json.loads(
            (
                Path(__file__).resolve().parents[1] / "data/game-reference.json"
            ).read_text()
        )
        return {
            "car_catalog": [
                {"name": c["name"], "action_id": c["action_id"]}
                for c in catalog["cars"]
            ],
            **super().policy(settings),
        }
