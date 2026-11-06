from modules.base import PolicyModule


class EmpireManager(PolicyModule):
    KEY = "empire_manager"
    NAME = "empire_manager"
    KIND = "empire"
    DEFAULTS = {
        "enabled": False,
        "primary_residence_seconds": 7200,
        "minimum_primary_ratio": 0.75,
        "reserve_cash": 100000,
        "maximum_flight_cash": 100000,
        "family_tournament_enabled": False,
        "tournament_visit_seconds": 1800,
        "tournament_home_seconds": 900,
    }

    @classmethod
    def validate(cls, policy):
        super().validate(policy)
        if not isinstance(policy["family_tournament_enabled"], bool):
            raise ValueError("family_tournament_enabled must be a boolean")
        for duration in ("tournament_visit_seconds", "tournament_home_seconds"):
            visit = policy[duration]
            if (
                isinstance(visit, bool)
                or not isinstance(visit, (int, float))
                or visit < 60
            ):
                raise ValueError(f"{duration} must be >= 60")
        for key, minimum in [
            ("primary_residence_seconds", 60),
            ("reserve_cash", 100000),
            ("maximum_flight_cash", 1),
        ]:
            value = policy[key]
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or value < minimum
            ):
                raise ValueError(f"empire_manager.{key} must be >= {minimum}")
        ratio = policy["minimum_primary_ratio"]
        if (
            isinstance(ratio, bool)
            or not isinstance(ratio, (int, float))
            or (not 0.5 < ratio < 1)
        ):
            raise ValueError(
                "minimum_primary_ratio must be between 0.5 and 1 exclusively"
            )
        if policy["maximum_flight_cash"] > 100000:
            raise ValueError("maximum_flight_cash must not exceed 100000")
