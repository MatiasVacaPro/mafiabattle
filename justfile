default:
    @just --list

test:
    venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
    bun test tests/supervisor.test.js tests/boss_fighter.test.js tests/game_reference.test.js tests/empire_manager.test.js tests/event_objectives.test.js tests/transport_planner.test.js tests/cigar_offers.test.js tests/showroom_manager.test.js

check:
    bash -n run.sh
    venv/bin/python -m compileall -q core modules main_bidi.py scripts/manage_service.py scripts/verify_live.py scripts/inspect_resources.py scripts/inspect_contexts.py tests
    biome check scripts/supervisor.js scripts/boss_fighter.js scripts/empire_manager.js scripts/event_objectives.js scripts/transport_planner.js scripts/cigar_offers.js scripts/showroom_manager.js scripts/game_reference.js tests/supervisor.test.js tests/boss_fighter.test.js tests/empire_manager.test.js tests/event_objectives.test.js tests/transport_planner.test.js tests/cigar_offers.test.js tests/showroom_manager.test.js tests/game_reference.test.js package.json config/bidi-defaults.json config/config.json

buscar query:
    bun scripts/game_reference.js {{quote(query)}}

inspect:
    ./run.sh --inspect

dry-run:
    ./run.sh --dry-run --once

status:
    ./run.sh status
