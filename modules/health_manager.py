from modules.base import PolicyModule

"Cash-only health recovery with a reserve, bounded budget and server confirmation."


class HealthManager(PolicyModule):
    KEY = "health_manager"
    NAME = "health_manager"
    KIND = "health"
    DEFAULTS = {
        "enabled": False,
        "trigger_below": 100,
        "refill_to": 400,
        "reserve_cash": 100000,
        "maximum_cycle_cash": 400000,
        "maximum_cash_per_point": 1000,
        "cycle_cooldown_seconds": 300,
        "root": "#dialog_shop_valuepacks",
        "open_selector": "#my_health .plus",
    }
