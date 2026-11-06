from modules.base import PolicyModule


class AntiIdle(PolicyModule):
    KEY = "anti_idle"
    NAME = "anti_idle"
    KIND = "anti_idle"
    DEFAULTS = {"enabled": False, "keepalive_seconds": 60, "auto_login": True}
