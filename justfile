default:
    @just --list

test:
    venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
    bun test ./tests

check:
    bash -n run.sh
    venv/bin/python -m compileall -q core modules main_bidi.py scripts/manage_service.py scripts/verify_live.py scripts/inspect_resources.py scripts/inspect_contexts.py tests
    pnpm exec biome check scripts/*.js scripts/agent scripts/agent-manifest.json tests/*.test.js tests/supervisor tests/helpers package.json config/bidi-defaults.json config/config.json

buscar query:
    bun scripts/game_reference.js {{quote(query)}}

inspect:
    ./run.sh --inspect

dry-run:
    ./run.sh --dry-run --once

status:
    ./run.sh status
