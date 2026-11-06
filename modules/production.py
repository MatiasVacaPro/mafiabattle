from modules.base import PolicyModule


class ProductionManager(PolicyModule):
    KEY = "production"
    NAME = "production_manager"
    KIND = "production"
    DEFAULTS = {
        "enabled": False,
        "reserve_slots": 0,
        "factories": [
            {
                "id": "meth_produce",
                "empire": 1,
                "root": "#dialog_methlab_lab",
                "open_selector": "#imperium #methlab .tip",
                "selector": "#dialog_methlab_lab .button.produce",
                "production_root": "#dialog_methlab",
                "capacity_global": "methlab_capacity",
                "capacity_selector": "#dialog_methlab .stat_meth .progress",
                "quantity_selector": "#dialog_methlab .stat_cooking .progress",
                "cash_free_native": True,
                "expected_type": "methlab",
                "maximum_cash_cost": 0,
                "reserve_cash": 100000,
                "requires_timer_slot": True,
                "cooldown_seconds": 0,
                "require_server_ack": True,
                "require_production_timer": True,
                "expected_command": "object:produce",
                "route": [
                    {"selector": "#imperium #methlab .tip", "root": "#dialog_methlab"},
                    {
                        "selector": "#dialog_methlab .button.lab",
                        "root": "#dialog_methlab_lab",
                    },
                ],
            },
            {
                "id": "xtc_produce",
                "empire": 2,
                "root": "#dialog_xtclab_lab",
                "open_selector": "#imperium #xtclab .tip",
                "selector": "#dialog_xtclab_lab .button.cash",
                "production_root": "#dialog_xtclab",
                "capacity_global": "xtclab_capacity",
                "capacity_selector": "#dialog_xtclab .stat_xtc .progress",
                "quantity_selector": "#dialog_xtclab .stat_cooking .progress",
                "maximum_cash_cost": 50000,
                "reserve_cash": 100000,
                "requires_timer_slot": True,
                "cooldown_seconds": 0,
                "require_server_ack": True,
                "require_production_timer": True,
                "expected_command": "object:produce",
                "expected_type": "xtclab",
                "route": [
                    {"selector": "#imperium #xtclab .tip", "root": "#dialog_xtclab"},
                    {
                        "selector": "#dialog_xtclab .button.lab",
                        "root": "#dialog_xtclab_lab",
                    },
                ],
            },
        ],
        "scheduled": [
            {
                "id": "cigar_offer",
                "task": "cigar_offer",
                "empire": 1,
                "root": "#dialog_cigarfactory_factory",
                "selector": "#dialog_cigarfactory_factory .offer_details .button.yes",
                "requires_timer_slot": False,
                "cooldown_seconds": 300,
                "require_server_ack": True,
                "expected_command": "cigarfactory:acceptoffer",
                "route": [
                    {
                        "selector": "#imperium #cigarfactory .tip",
                        "root": "#dialog_cigarfactory",
                    },
                    {
                        "selector": "#dialog_cigarfactory .button.lab",
                        "root": "#dialog_cigarfactory_factory",
                    },
                ],
            },
            {
                "id": "weed_offer",
                "task": "weed_offer",
                "root": "#dialog_weedfarm_offers",
                "selector": "#dialog_weedfarm_offers .button.yes",
                "offer_indicator": "#imperium #weedfarm .collect.offer_weed",
                "requires_timer_slot": False,
                "cooldown_seconds": 1140,
                "route": [
                    {
                        "selector": "#imperium #weedfarm .collect.offer_weed",
                        "root": "#dialog_weedfarm_offers",
                    }
                ],
                "empire": 1,
            },
            {
                "id": "weed_harvest",
                "task": "weed_harvest",
                "root": "#dialog_weedfarm_farm",
                "selector": "#dialog_weedfarm_farm .collect_button",
                "requires_timer_slot": False,
                "cooldown_seconds": 1140,
                "route": [
                    {
                        "selector": "#imperium #weedfarm .tip",
                        "root": "#dialog_weedfarm",
                    },
                    {
                        "selector": "#dialog_weedfarm .button.farm",
                        "root": "#dialog_weedfarm_farm",
                    },
                ],
                "empire": 1,
            },
            {
                "id": "weed_plant",
                "task": "weed_plant",
                "root": "#dialog_weedfarm_farm",
                "selector": "#dialog_weedfarm_farm .plant.free .plant_button",
                "requires_timer_slot": False,
                "cooldown_seconds": 1,
                "reserve_cash": 100000,
                "route": [
                    {
                        "selector": "#imperium #weedfarm .tip",
                        "root": "#dialog_weedfarm",
                    },
                    {
                        "selector": "#dialog_weedfarm .button.farm",
                        "root": "#dialog_weedfarm_farm",
                    },
                ],
                "empire": 1,
            },
            {
                "id": "tattooshop_stock",
                "task": "stock",
                "root": "#dialog_tattooshop_stock",
                "selector": "#tattooshop_lazy",
                "capacity_selector": "#dialog_tattooshop_stock .stat_sells .progress",
                "capacity_global": "tattooshop_stockcapacity",
                "reserve_cash": 100000,
                "requires_timer_slot": False,
                "cooldown_seconds": 7200,
                "route": [
                    {
                        "selector": "#imperium #tattooshop .tip",
                        "root": "#dialog_tattooshop",
                    },
                    {
                        "selector": "#dialog_tattooshop .button.tattoostock",
                        "root": "#dialog_tattooshop_stock",
                    },
                ],
                "empire": 1,
            },
            {
                "id": "nightclub_stock",
                "task": "stock",
                "root": "#dialog_nightclub_stock",
                "selector": "#nightclub_lazy",
                "capacity_selector": "#dialog_nightclub_stock .stat_sells .progress",
                "capacity_global": "nightclub_stockcapacity",
                "reserve_cash": 100000,
                "requires_timer_slot": False,
                "cooldown_seconds": 7200,
                "route": [
                    {
                        "selector": "#imperium #nightclub .tip",
                        "root": "#dialog_nightclub",
                    },
                    {
                        "selector": "#dialog_nightclub .button.stock",
                        "root": "#dialog_nightclub_stock",
                    },
                ],
                "empire": 1,
            },
            {
                "id": "gemstone_inventory",
                "task": "gemstone",
                "root": "#dialog_gemstonesfactory_produce",
                "selector": "#dialog_gemstonesfactory_produce .inventory_button",
                "timer_scope": "#dialog_gemstonesfactory_produce .factory",
                "requires_timer_slot": False,
                "cooldown_seconds": 10800,
                "route": [
                    {
                        "selector": "#imperium #gemstonesfactory .tip",
                        "root": "#dialog_gemstonesfactory",
                    },
                    {
                        "selector": "#dialog_gemstonesfactory .button.factory",
                        "root": "#dialog_gemstonesfactory_produce",
                    },
                ],
                "empire": 1,
            },
        ],
    }
