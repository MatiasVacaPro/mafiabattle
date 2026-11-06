from modules.base import PolicyModule


class GymTrainer(PolicyModule):
    KEY = "gym_trainer"
    NAME = "gym_trainer"
    KIND = "gym"
    DEFAULTS = {
        "enabled": False,
        "empire": 1,
        "open_selector": "#imperium #gym .tip",
        "room": 4,
        "reserve_slots": 0,
        "energy_selector": None,
        "minimum_energy": 1,
    }

    @classmethod
    def validate(cls, policy):
        super().validate(policy)
        if (
            isinstance(policy["room"], bool)
            or not isinstance(policy["room"], int)
            or (not 1 <= policy["room"] <= 5)
        ):
            raise ValueError("gym room must be an integer from 1 to 5")
