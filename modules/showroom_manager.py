from modules.base import PolicyModule

"Disabled-by-default policy for observing showroom inventory."


class ShowroomManager(PolicyModule):
    KEY = "showroom_manager"
    NAME = "showroom_manager"
    KIND = "showroom"
    DEFAULTS = {
        "enabled": False,
        "mode": "observe",
        "review_seconds": 7200,
        "preventive_sell_threshold": 215,
        "hard_limit": 250,
        "minimum_prices": {
            "Bugatti Veyron": 390000,
            "Porsche Carrera GT": 355000,
            "Maybach 57S": 330000,
            "Rolls-Royce Phantom": 330000,
            "Ferrari F12berlinetta": 300000,
            "Bentley Continental GT": 275000,
            "Ferrari California": 275000,
            "Audi R8": 250000,
            "Aston Martin Vanquish": 235000,
            "Lamborghini Huracán": 195000,
        },
        "database_path": "runtime/showroom.sqlite3",
    }
    CONFIGURABLE_FIELDS = (
        "enabled",
        "mode",
        "review_seconds",
        "preventive_sell_threshold",
        "hard_limit",
        "minimum_prices",
        "database_path",
    )

    @classmethod
    def policy(cls, settings):
        user_settings = settings.get("showroom_manager", {})
        overrides = {
            key: user_settings[key]
            for key in cls.CONFIGURABLE_FIELDS
            if key in user_settings
        }
        values = {**cls.DEFAULTS, **overrides}
        values["minimum_prices"] = {
            **cls.DEFAULTS["minimum_prices"],
            **user_settings.get("minimum_prices", {}),
        }
        return {**values, "name": "showroom_manager", "kind": "showroom"}

    @classmethod
    def validate(cls, policy):
        super().validate(policy)
        if policy["mode"] not in ("observe", "manage"):
            raise ValueError("showroom_manager.mode must be observe or manage")
        review = policy["review_seconds"]
        if (
            isinstance(review, bool)
            or not isinstance(review, (int, float))
            or review <= 0
        ):
            raise ValueError("showroom_manager.review_seconds must be > 0")
        hard_limit = policy["hard_limit"]
        threshold = policy["preventive_sell_threshold"]
        if (
            isinstance(hard_limit, bool)
            or not isinstance(hard_limit, int)
            or hard_limit <= 0
        ):
            raise ValueError("showroom_manager.hard_limit must be a positive integer")
        if (
            isinstance(threshold, bool)
            or not isinstance(threshold, int)
            or (not 0 < threshold < hard_limit)
        ):
            raise ValueError(
                "showroom_manager.preventive_sell_threshold must be between 1 and hard_limit - 1"
            )
        if (
            not isinstance(policy["database_path"], str)
            or not policy["database_path"].strip()
        ):
            raise ValueError(
                "showroom_manager.database_path must be a non-empty string"
            )
        floors = policy["minimum_prices"]
        if not isinstance(floors, dict) or not floors:
            raise ValueError("showroom_manager.minimum_prices must be a non-empty dict")
        for model, price in floors.items():
            if not isinstance(model, str) or not model.strip():
                raise ValueError(
                    "showroom_manager.minimum_prices keys must be non-empty strings"
                )
            if isinstance(price, bool) or not isinstance(price, int) or price < 0:
                raise ValueError(
                    f"showroom_manager.minimum_prices[{model!r}] must be an integer >= 0"
                )
