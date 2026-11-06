"""Python observes the guard; the synchronous DOM guard authorizes each action."""
from enum import StrEnum


class BotState(StrEnum):
    RUNNING = 'RUNNING'
    PAUSED_BY_USER = 'PAUSED_BY_USER'
    WAITING_FOR_LOGIN = 'WAITING_FOR_LOGIN'
    LOADING_GAME = 'LOADING_GAME'
    WAITING_FOR_SUPERVISOR = 'WAITING_FOR_SUPERVISOR'
    WAITING_FOR_DIALOG = 'WAITING_FOR_DIALOG'
    WAITING_FOR_COMMAND = 'WAITING_FOR_COMMAND'
    WAITING_FOR_RECOVERY = 'WAITING_FOR_RECOVERY'
    WAITING_FOR_JAIL = 'WAITING_FOR_JAIL'
    SYNCING_EMPIRE = 'SYNCING_EMPIRE'
    ACCOUNT_MISMATCH = 'ACCOUNT_MISMATCH'
    STOPPED = 'STOPPED'


class UserGuard:
    def __init__(self): self.state = BotState.WAITING_FOR_SUPERVISOR

    def observe(self, snapshot):
        self.state = BotState(snapshot['state'])
        return self.state

    def can_act(self, snapshot): return self.observe(snapshot) == BotState.RUNNING
