"""Disabled-by-default policy for observing showroom inventory."""


class ShowroomManager:
    CONFIGURABLE_FIELDS = (
        "enabled",
        "mode",
        "review_seconds",
        "preventive_sell_threshold",
        "hard_limit",
        "minimum_prices",
        "database_path",
    )
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
