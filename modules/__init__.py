"""Resident module policies; no module bypasses the shared DOM guard."""

from modules.anti_idle import AntiIdle
from modules.district_collector import DistrictCollector
from modules.gym_trainer import GymTrainer
from modules.casino_games import CasinoGames
from modules.production import ProductionManager
from modules.criminal_activities import CriminalActivities
from modules.helicopter import HelicopterCollector
from modules.health_manager import HealthManager
from modules.empire_manager import EmpireManager
from modules.transport_manager import TransportManager
from modules.showroom_manager import ShowroomManager
from modules.boss_fighter import BossFighter

MODULE_REGISTRY = (
    AntiIdle,
    HelicopterCollector,
    HealthManager,
    DistrictCollector,
    TransportManager,
    ShowroomManager,
    ProductionManager,
    EmpireManager,
    CriminalActivities,
    GymTrainer,
    CasinoGames,
    BossFighter,
)


def build_policies(settings):
    return [module.policy(settings) for module in MODULE_REGISTRY]


def module_settings(settings):
    result = dict(settings)
    for module in MODULE_REGISTRY:
        result[module.KEY] = module.configuration(settings)
    return result


def validate_modules(settings):
    for module in MODULE_REGISTRY:
        module.validate(module.policy(settings))
