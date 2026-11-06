from modules.base import PolicyModule

"Claim observed helicopter rewards through the game's own DOM button."


class HelicopterCollector(PolicyModule):
    KEY = "helicopter"
    NAME = "helicopter_collector"
    KIND = "helicopter"
    DEFAULTS = {"enabled": False, "selector": "#heli_copter .bnd"}
