#!/usr/bin/env python3
"""
MafiaBattle Autonomous Automation Engine (Enfoque A & C)
========================================================
Punto de entrada principal con arquitectura modular POO, control en segundo plano
vía WebDriver BiDi (Zen Browser), tolerancia a intervención del usuario,
lectura de estado DOM y ejecución sin secuestro del mouse físico.
"""

import argparse
import os
import signal
import sys
import time

from core.logger import log_msg
from core.config_manager import ConfigManager
from core.state_manager import StateManager
from core.input_controller import InputController
from core.vision_service import VisionService
from core.zen_bidi import ZenBiDiClient
from core.game_bridge import MafiaBattleBridge
from core.user_activity_monitor import UserActivityMonitor
from engine.rule_engine import LocalRuleEngine
from engine.scheduler import TaskScheduler

from tasks.district_tasks import DistrictTask
from tasks.gym_task import GymTask
from tasks.casino_tasks import RuletaTask, MayorMenorTask
from tasks.anti_idle_task import AntiIdleTask
from tasks.utility_tasks import MasVidaTask, RecolectorPiedrasTask, FabricacionTask, ImperiumCollectTask


def build_bot(config_dir: str = None, mode: str = "bidi") -> TaskScheduler:
    """
    Construye y ensambla todos los componentes del bot a partir de los archivos JSON.
    Modo 'bidi': Enfoque A & C (control en segundo plano vía WebSocket Zen Browser).
    Modo 'gui': Enfoque tradicional (PyAutoGUI + Vision OCR).
    """
    config_mgr = ConfigManager(config_dir)
    state_mgr = StateManager()
    vision_srv = VisionService()
    decision_engine = LocalRuleEngine()

    bidi_client = None
    game_bridge = None
    user_monitor = None

    if mode == "bidi":
        try:
            bidi_client = ZenBiDiClient()
            bidi_client.connect()
            game_bridge = MafiaBattleBridge(bidi_client)
            user_monitor = UserActivityMonitor(bidi_client)
            user_monitor.ensure_listener_installed()
            log_msg("SISTEMA", "activo", "🚀 Modo BiDi Activo: Control en segundo plano sin secuestro de mouse.")
        except Exception as e:
            log_msg("SISTEMA", "alerta", f"No se pudo conectar a BiDi ({e}). Activando fallback GUI.")
            bidi_client = None
            game_bridge = None
            user_monitor = None

    input_ctrl = InputController(
        bidi_client=bidi_client,
        game_bridge=game_bridge,
        user_monitor=user_monitor
    )

    scheduler = TaskScheduler(
        input_controller=input_ctrl,
        vision_service=vision_srv,
        state_manager=state_mgr,
        decision_engine=decision_engine
    )

    tasks_cfg = config_mgr.config.get("tasks", {})

    # 1. Anti-Inactividad 24/7 (Alta Prioridad)
    if tasks_cfg.get("anti_idle", {}).get("enabled", True):
        anti_idle_coords = config_mgr.coordinates.get("anti_idle", {})
        anti_idle_interval = tasks_cfg.get("anti_idle", {}).get("check_interval_seconds", 2.0)
        scheduler.add_task(AntiIdleTask(
            coords=anti_idle_coords,
            interval_seconds=anti_idle_interval
        ))

    # 2. Distritos y Barrios
    distritos_map = [
        ("celebrities_district", "Celebrities District"),
        ("shopping_street", "Shopping Street"),
        ("jardin_clasico", "Jardin Clasico"),
        ("mafiosi_district", "Mafiosi District"),
        ("residential_area", "Residential Area"),
        ("billonari_club", "Billonari Club"),
    ]

    for d_id, friendly_name in distritos_map:
        t_cfg = tasks_cfg.get(d_id, {})
        if t_cfg.get("enabled", False):
            coords = config_mgr.get_district_config(d_id)
            delay_sec = config_mgr.parse_delay_string(t_cfg.get("initial_delay", ""))
            scheduler.add_task(DistrictTask(
                district_id=d_id,
                name=friendly_name,
                interval_seconds=t_cfg.get("interval_seconds", 480),
                coords=coords,
                initial_delay=delay_sec,
                description=t_cfg.get("description", friendly_name)
            ))

    # 3. Casino: Ruleta
    if tasks_cfg.get("ruleta", {}).get("enabled", False):
        t_cfg = tasks_cfg["ruleta"]
        coords = config_mgr.coordinates.get("casino", {}).get("ruleta", {})
        delay_sec = config_mgr.parse_delay_string(t_cfg.get("initial_delay", ""))
        scheduler.add_task(RuletaTask(
            coords=coords,
            interval_seconds=t_cfg.get("interval_seconds", 1800),
            initial_delay=delay_sec,
            description=t_cfg.get("description", "Ruleta")
        ))

    # 4. Casino: Mayor o Menor (Higher / Lower)
    if tasks_cfg.get("mayor_menor", {}).get("enabled", False):
        t_cfg = tasks_cfg["mayor_menor"]
        coords = config_mgr.coordinates.get("casino", {}).get("mayor_menor", {})
        delay_sec = config_mgr.parse_delay_string(t_cfg.get("initial_delay", ""))
        scheduler.add_task(MayorMenorTask(
            coords=coords,
            interval_seconds=t_cfg.get("interval_seconds", 1800),
            max_rounds=t_cfg.get("max_rounds", 10),
            cutoff_value=t_cfg.get("cutoff_value", 50),
            initial_delay=delay_sec,
            description=t_cfg.get("description", "Mayor o Menor")
        ))

    # 5. Fabricación de Cristal / Meth
    if tasks_cfg.get("fabricacion_cristal", {}).get("enabled", False):
        t_cfg = tasks_cfg["fabricacion_cristal"]
        coords = config_mgr.coordinates.get("fabricacion", {})
        delay_sec = config_mgr.parse_delay_string(t_cfg.get("initial_delay", ""))
        scheduler.add_task(FabricacionTask(
            coords=coords,
            interval_seconds=t_cfg.get("interval_seconds", 7200),
            initial_delay=delay_sec,
            description=t_cfg.get("description", "Fabricación Cristal")
        ))

    # 6. Gimnasio
    if tasks_cfg.get("gym", {}).get("enabled", False):
        t_cfg = tasks_cfg["gym"]
        coords = config_mgr.coordinates.get("gym", {})
        delay_sec = config_mgr.parse_delay_string(t_cfg.get("initial_delay", ""))
        scheduler.add_task(GymTask(
            coords=coords,
            interval_seconds=t_cfg.get("interval_seconds", 300),
            cooldown_24h=t_cfg.get("cooldown_24h", 86400),
            max_loops=t_cfg.get("max_loops", 8),
            displace_once=t_cfg.get("displace_once", True),
            initial_delay=delay_sec,
            description=t_cfg.get("description", "Gimnasio")
        ))

    # 7. Más Vida
    if tasks_cfg.get("mas_vida", {}).get("enabled", False):
        t_cfg = tasks_cfg["mas_vida"]
        coords = config_mgr.coordinates.get("mas_vida", {})
        delay_sec = config_mgr.parse_delay_string(t_cfg.get("initial_delay", ""))
        active_count = sum(1 for k in ["celebrities_district", "shopping_street", "jardin_clasico", "mafiosi_district", "residential_area", "billonari_club", "fabricacion_cristal"] if tasks_cfg.get(k, {}).get("enabled", False))
        scheduler.add_task(MasVidaTask(
            coords=coords,
            active_timers_count=active_count,
            initial_delay=delay_sec,
            description=t_cfg.get("description", "Más Vida")
        ))

    # 8. Recolector de Piedras Preciosas
    if tasks_cfg.get("recolector_piedras", {}).get("enabled", False):
        t_cfg = tasks_cfg["recolector_piedras"]
        coords = config_mgr.coordinates.get("recolector", {})
        delay_sec = config_mgr.parse_delay_string(t_cfg.get("initial_delay", ""))
        scheduler.add_task(RecolectorPiedrasTask(
            coords=coords,
            interval_seconds=t_cfg.get("interval_seconds", 10800),
            initial_delay=delay_sec,
            description=t_cfg.get("description", "Recolector Piedras")
        ))

    # 9. Recolección de Edificios del Imperio
    if tasks_cfg.get("imperium_buildings", {}).get("enabled", True):
        t_cfg = tasks_cfg.get("imperium_buildings", {})
        delay_sec = config_mgr.parse_delay_string(t_cfg.get("initial_delay", ""))
        scheduler.add_task(ImperiumCollectTask(
            interval_seconds=t_cfg.get("interval_seconds", 180),
            initial_delay=delay_sec,
            description=t_cfg.get("description", "Recolección de Edificios del Imperio")
        ))

    return scheduler


def main():
    parser = argparse.ArgumentParser(description="MafiaBattle Autonomous Engine (Enfoque A & C)")
    parser.add_argument("--mode", choices=["bidi", "gui"], default="bidi", help="Modo de ejecución: 'bidi' (segundo plano BiDi) o 'gui' (PyAutoGUI físico).")
    parser.add_argument("--dry-run", action="store_true", help="Cargar configuración y listar tareas sin ejecutar acciones.")
    parser.add_argument("--status", action="store_true", help="Mostrar estado de conexión, stats del jugador y tiempos de espera de tareas.")
    args = parser.parse_args()

    print("=" * 68)
    print("        MAFIABATTLE AUTONOMOUS BOT — ENFOQUE A & C (BIDI + DOM)")
    print("=" * 68)

    scheduler = build_bot(mode=args.mode)

    if args.dry_run or args.status:
        now = time.time()
        print(f"\n📡 Modo de Ejecución: {'SEGUNDO PLANO BIDI (Enfoque A/C)' if scheduler.input_ctrl.is_bidi_mode else 'LEGACY GUI'}")

        if scheduler.input_ctrl.is_bidi_mode and scheduler.input_ctrl.bridge:
            stats = scheduler.input_ctrl.bridge.get_player_stats()
            print("\n📊 Estadísticas del Jugador (en tiempo real desde el juego):")
            print(f"  • Salud:            {stats.get('health', 'N/A')}")
            print(f"  • Efectivo:         ${stats.get('cash', 0):,}")
            print(f"  • Banco:            ${stats.get('bank', 0):,}")
            print(f"  • Diamantes:        {stats.get('diamonds', 0):,}")
            print(f"  • Munición:         {stats.get('ammunition', 0):,}")
            print(f"  • Timers Activos:   {stats.get('timers_active', 0)} / {stats.get('timers_max', 8)}")

        print(f"\n📋 Tareas registradas en el Planificador:")
        for t in scheduler.tasks + scheduler.high_priority_tasks:
            espera = t.time_until_next_run(now, scheduler.state_mgr)
            print(f"  • {t.name:<25} | Intervalo: {t.interval_seconds}s | Próxima ejecución en: {espera:.1f}s")
        print("\n✅ Verificación completada con éxito.")

        scheduler.stop()
        sys.exit(0)

    # Manejo seguro de señales de terminación
    def sigint_handler(sig, frame):
        print("\n🛑 Señal de interrupción recibida. Deteniendo bot de forma segura...")
        scheduler.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, sigint_handler)
    scheduler.start()


if __name__ == "__main__":
    main()
