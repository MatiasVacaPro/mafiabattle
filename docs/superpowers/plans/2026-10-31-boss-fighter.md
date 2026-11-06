# Autonomous Boss Fighter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development and verification-before-completion task-by-task.

**Goal:** Implement and verify autonomous, zero-diamond boss-event progression in the resident BiDi supervisor.

**Architecture:** Add a Python policy and config validation, a pure/testable JS arena-combat helper injected before the supervisor, and a supervisor-owned boss state machine with a dedicated 45 ms combat interval.

**Tech Stack:** Python `unittest`, Bun test, Happy DOM, JavaScript, Biome, JSON.

**Spec:** `docs/superpowers/specs/2026-10-31-boss-fighter-design.md`

## Global Constraints

- Preserve existing dirty-worktree changes and resident safety controls.
- Use only the free pistol and free bomb damage; never click premium weapons.
- Boss runs in either empire and consumes no timer slot.
- Run `just test` and `just check` to a clean exit before completion.

### Task 1: Policy and configuration

**Files:** Create `modules/boss_fighter.py`, `tests/test_bidi_config.py`; modify `modules/__init__.py`, `core/bot_config.py`, and both config JSON files.

- [x] Write policy/validation/config assertions and verify they fail because `BossFighter` is absent.
- [x] Add the exact policy defaults, registration, numeric validation, and enabled production/default config.
- [x] Re-run the Python tests and keep unrelated settings unchanged.

### Task 2: Arena and combat helper

**Files:** Create `scripts/boss_fighter.js`, `tests/boss_fighter.test.js`; modify `core/dom_driver.py` and `justfile`.

- [x] Write failing CSS, aim, hidden-target, bomb, background-shot, and premium-control tests.
- [x] Implement `applyBossArenaStyles` and `stepBossCombat` with safe no-op behavior.
- [x] Inject the helper before the supervisor and add it to test/check recipes.

### Task 3: Supervisor state machine

**Files:** Modify `scripts/supervisor.js` and `tests/boss_fighter.test.js`.

- [x] Write failing end-to-end fixture tests for open, fight, reward, next level, health pause, defeat, priority, and stop cleanup.
- [x] Add boss selection, owned-dialog resume, progression, scheduling priority, combat interval, deadline protection, and snapshot fields.
- [x] Re-run boss and supervisor suites after each focused increment.

### Task 4: Final verification

**Files:** All changed implementation/test/config files.

- [x] Run targeted Python and JS suites.
- [x] Run `biome check --write` only on changed JS/JSON if formatting is needed.
- [x] Run fresh `just test` and `just check`; inspect the final diff for unrelated changes.
