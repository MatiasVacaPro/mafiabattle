"""
Tasks package for MafiaBattle automation.
Provides base classes and implementations for game activities.
"""
from tasks.base_task import BaseTask
from tasks.district_tasks import DistrictTask
from tasks.gym_task import GymTask
from tasks.casino_tasks import RuletaTask, MayorMenorTask
from tasks.anti_idle_task import AntiIdleTask
from tasks.utility_tasks import MasVidaTask, RecolectorPiedrasTask, FabricacionTask
from tasks.helicoptero_task import HelicopteroTask

__all__ = [
    "BaseTask",
    "DistrictTask",
    "GymTask",
    "RuletaTask",
    "MayorMenorTask",
    "AntiIdleTask",
    "MasVidaTask",
    "RecolectorPiedrasTask",
    "FabricacionTask",
    "HelicopteroTask"
]
