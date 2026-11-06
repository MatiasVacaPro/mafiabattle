from modules.base import PolicyModule


class CasinoGames(PolicyModule):
    KEY = "casino_games"
    NAME = "casino_player"
    KIND = "casino"
    DEFAULTS = {
        "enabled": False,
        "open_selector": "#go_casino, .button.casino",
        "max_rounds": 10,
        "cutoff_value": 50,
        "games": [
            {
                "id": "wheel_spin",
                "game": "wheel",
                "enabled": True,
                "root": "#dialog_casino_wheel",
                "button": ".spin_button",
                "selector": "#dialog_casino_wheel .spin_button",
                "open_selector": "#main_button_wheeloffortune",
                "cooldown_seconds": 1800,
            },
            {
                "id": "hilo_start",
                "game": "hilo",
                "enabled": True,
                "root": "#dialog_casino_higherlower",
                "button": ".start_button",
                "selector": "#dialog_casino_higherlower .start_button",
                "open_selector": "#main_button_higherlower",
                "cooldown_seconds": 1800,
            },
        ],
        "number_wait_timeout_seconds": 60,
    }

    @classmethod
    def validate(cls, policy):
        super().validate(policy)
        if not 1 <= policy["max_rounds"] <= 10 or not 1 <= policy["cutoff_value"] < 100:
            raise ValueError("invalid Higher/Lower policy")
