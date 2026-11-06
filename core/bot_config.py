from core.config_defaults import DEFAULTS
import json
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlsplit
from modules import build_policies, module_settings, validate_modules


def load_config(path):
    data = json.loads(Path(path).read_text())
    config = {**deepcopy(DEFAULTS), **data.get("bidi", data)}
    target = urlsplit(config["target_url"])
    if (target.scheme, target.netloc, target.path) != (
        "https",
        "www.mafiabattle.com",
        "/es/",
    ):
        raise ValueError("target_url must be https://www.mafiabattle.com/es/")
    endpoint = urlsplit(config["endpoint"])
    if endpoint.scheme != "ws" or endpoint.hostname not in (
        "127.0.0.1",
        "localhost",
        "::1",
    ):
        raise ValueError("BiDi endpoint must be a local WebSocket")
    if config.get("session_mode", "bidi") not in ("bidi", "classic"):
        raise ValueError("Unknown session_mode")

    def positive(key, minimum):
        value = config[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or value < minimum
        ):
            raise ValueError(f"{key} must be >= {minimum}")

    for key, minimum in [
        ("user_pause_seconds", 15),
        ("heartbeat_seconds", 0.25),
        ("lease_seconds", 5),
        ("tick_ms", 250),
        ("action_delay_ms", 100),
        ("ack_timeout_ms", 1000),
        ("command_timeout_seconds", 1),
        ("reconnect_min_seconds", 0.25),
        ("reconnect_max_seconds", 1),
    ]:
        positive(key, minimum)
    if config["lease_seconds"] < config["heartbeat_seconds"] * 3:
        raise ValueError("lease_seconds must be at least 3 heartbeat intervals")
    if config["reconnect_min_seconds"] > config["reconnect_max_seconds"]:
        raise ValueError("reconnect range is inverted")
    config["modules"] = module_settings(config.get("modules", {}))
    validate_modules(config["modules"])
    return config


def resident_config(config, dry_run=False):
    result = deepcopy(config)
    result.update(
        user_pause_ms=config["user_pause_seconds"] * 1000,
        lease_ms=config["lease_seconds"] * 1000,
        dry_run=dry_run,
        policies=build_policies(config["modules"]),
    )
    result.pop("modules")
    return result
