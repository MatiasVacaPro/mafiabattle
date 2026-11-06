from modules.base import PolicyModule
import json
from pathlib import Path


class CriminalActivities(PolicyModule):
    KEY = "criminal_activities"
    NAME = "criminal_activities"
    KIND = "criminal"
    DEFAULTS = {
        "enabled": False,
        "minimum_health": 15,
        "unfinished_only": True,
        "family_tournament_enabled": False,
        "boat_sales_enabled": False,
        "mastered_fallback_enabled": True,
        "activities": [
            {
                "family": "cars",
                "root": "#dialog_cars",
                "location_prefix": "cars_location_",
                "command": "robbing:perform",
                "route": [
                    {"selector": "#go_crimes", "root": "#dialog_crimes"},
                    {"selector": "#dialog_crimes .cars_nav", "root": "#dialog_cars"},
                ],
            },
            {
                "family": "crimes",
                "root": "#dialog_crimes",
                "location_prefix": "crimes_location_",
                "command": "crime:perform",
                "route": [{"selector": "#go_crimes", "root": "#dialog_crimes"}],
            },
            {
                "family": "boats",
                "empire": 2,
                "root": "#dialog_boats",
                "command": "boatcompany:perform",
                "direct_rows": True,
                "route": [
                    {
                        "selector": "#imperium #boatcompany .tip",
                        "root": "#dialog_boatcompany",
                    },
                    {
                        "selector": "#dialog_boatcompany .button.boats",
                        "root": "#dialog_boats",
                    },
                ],
            },
        ],
        "reserve_slots": 1,
        "event_objectives_enabled": True,
    }

    @classmethod
    def policy(cls, settings):
        catalog_path = Path(__file__).resolve().parents[1] / "data/game-reference.json"
        car_values = {}
        if catalog_path.exists():
            catalog = json.loads(catalog_path.read_text())
            by_id = {}
            for car in catalog.get("cars", []):
                by_id.setdefault(car["action_id"], []).append(car["base_cash"])
            car_values = {k: int(sum(v) / len(v) + 0.5) for k, v in by_id.items()}
            for action_id, rank_val in [(16, 1), (17, 2), (18, 3)]:
                car_values.setdefault(action_id, rank_val)
        return {"car_values": car_values, **super().policy(settings)}
