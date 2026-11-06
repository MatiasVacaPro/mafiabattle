"""Autonomous boss-event policy; combat remains guarded by the resident agent."""


class BossFighter:
    @staticmethod
    def policy(settings):
        return {
            "name": "boss_fighter",
            "kind": "boss",
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
            **settings.get("boss_fighter", {}),
        }
