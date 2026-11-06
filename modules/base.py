"""Shared policy construction; each module owns its defaults and validation."""

from copy import deepcopy


class PolicyModule:
    @classmethod
    def configuration(cls, settings):
        return {**deepcopy(cls.DEFAULTS), **deepcopy(settings.get(cls.KEY, {}))}

    @classmethod
    def policy(cls, settings):
        return {**cls.configuration(settings), "name": cls.NAME, "kind": cls.KIND}

    @classmethod
    def validate(cls, policy):
        if not isinstance(policy["enabled"], bool):
            raise ValueError("enabled must be a boolean")
