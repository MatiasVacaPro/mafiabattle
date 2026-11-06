from modules.base import PolicyModule

"Autonomous boss-event policy; combat remains guarded by the resident agent."


class BossFighter(PolicyModule):
    KEY = "boss_fighter"
    NAME = "boss_fighter"
    KIND = "boss"
    DEFAULTS = {
        "enabled": False,
        "minimum_health": 120,
        "minimum_ammo": 250,
        "cooldown_seconds": 2,
        "open_selector": "#go_boss",
        "event_root": "#dialog_bosses_bosevent",
        "family_event_root": "#dialog_bosses_familyevent",
        "family_min_only_max_level": 4,
        "family_scan_seconds": 180,
        "fight_root": "#dialog_bosses_fight",
        "reward_root": "#dialog_bosses_reward",
        "goal_root": "#dialog_bosses_goalcomplete",
        "hide_obstacles": True,
        "enlarge_hitarea": True,
        "boss_scale": 0.55,
    }

    @classmethod
    def validate(cls, policy):
        super().validate(policy)
        for key, minimum in [
            ("minimum_health", 20),
            ("minimum_ammo", 10),
            ("cooldown_seconds", 1),
            ("family_scan_seconds", 5),
        ]:
            value = policy[key]
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or value < minimum
            ):
                raise ValueError(f"boss_fighter.{key} must be >= {minimum}")
        level = policy["family_min_only_max_level"]
        if isinstance(level, bool) or not isinstance(level, int) or level < 0:
            raise ValueError(
                "boss_fighter.family_min_only_max_level must be an integer >= 0"
            )
