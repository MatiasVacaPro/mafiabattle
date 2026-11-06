# MafiaBattle Showroom Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent BiDi showroom manager that reconciles a durable car inventory, rejects below-floor offers every two hours, and sells at the approved capacity thresholds.

**Architecture:** Add a disabled-by-default showroom policy and a SQLite repository in Python. A pure JavaScript planner parses showroom DOM and proposes actions; the resident supervisor executes them through its existing DOM, user guard, and transaction-confirmation paths. Python persists planner snapshots and audit events through the existing BiDi heartbeat lifecycle.

**Tech Stack:** Python 3.14 standard library `sqlite3`, JavaScript ES modules loaded into the page realm, WebDriver BiDi, Bun test runner, existing `just` recipes.

**Spec:** `docs/superpowers/specs/2026-10-14-showroom-manager-design.md`

## Global Constraints

- Keep `showroom_manager` policy and state independent from `transport_manager`.
- Default to `enabled: false` and `mode: "observe"`; observation never clicks a reject or sell control.
- Reject all priced offers below their configured model minimum every 7,200 seconds; models without a configured minimum are not rejected.
- Set Ferrari F12berlinetta minimum to 300,000 and Bugatti Veyron minimum to 390,000.
- Sell all at 215 autos and immediately at the hard limit of 250, even below individual price floors.
- Reconcile current inventory from showroom rows; notifications are audit evidence and never decrement counts alone.
- Confirm each action from a fresh DOM read; an uncertain result blocks dependent actions and is never blindly replayed.
- Use the existing account/session checks, user guard, dry-run behavior, and pending-action receipts.
- Do not modify game files, restart the service, or enable live actions as part of implementation.

---

## File Structure

- `modules/showroom_manager.py` — constructs and validates the independent resident policy.
- `modules/__init__.py` — registers the policy with `build_policies`.
- `config/config.json`, `config/bidi-defaults.json` — separate disabled-by-default policy settings.
- `core/showroom_repository.py` — owns SQLite schema, inventory reconciliation, persistent planner state, and audit events.
- `scripts/showroom_manager.js` — parses showroom cards, successful car-robbery popups, and theft notifications; implements deterministic price/capacity decisions without DOM side effects.
- `core/dom_driver.py` — loads the new planner into the existing page agent source.
- `scripts/supervisor.js` — adds the showroom policy lifecycle and guarded DOM actions without changing transport decisions.
- `main_bidi.py` — hydrates planner state before agent installation and persists snapshots/events after heartbeats.
- `tests/test_showroom_manager.py`, `tests/test_showroom_repository.py`, `tests/test_showroom_lifecycle.py` — Python config, SQLite, and lifecycle coverage.
- `tests/showroom_manager.test.js`, `tests/fixtures/showroom-offers.html`, `tests/fixtures/showroom-robbery-popup.html`, `tests/fixtures/showroom-theft-notification.html` — parser/planner and DOM action fixtures.
- `tests/supervisor.test.js` — supervisor guard, acknowledgement, and no-replay integration cases.

## Task 1: Register the disabled showroom policy

**Files:**
- Create: `modules/showroom_manager.py`
- Modify: `modules/__init__.py`
- Modify: `config/config.json`
- Modify: `config/bidi-defaults.json`
- Create: `tests/test_showroom_manager.py`

**Interfaces:**
- `ShowroomManager.policy(settings) -> dict` returns `{name: "showroom_manager", kind: "showroom", enabled: bool, mode: "observe"|"manage", review_seconds: int, preventive_sell_threshold: int, hard_limit: int, minimum_prices: dict[str, int], database_path: str}`.
- Default policy values: `enabled=False`, `mode="observe"`, `review_seconds=7200`, `preventive_sell_threshold=215`, `hard_limit=250`, Ferrari F12berlinetta `300000`, Bugatti Veyron `390000`, database path `runtime/showroom.sqlite3`.
- `build_policies(settings)` includes exactly one showroom policy and leaves transport policy output unchanged.

- [ ] **Step 1: Write policy tests first** for default disabled/observe values, approved model floors, a user override for another model, and a single showroom policy registration.
- [ ] **Step 2: Run the focused tests and confirm they fail** with `venv/bin/python -m unittest discover -s tests -p test_showroom_manager.py -v`.
- [ ] **Step 3: Implement the policy factory and registration**; merge module defaults with user settings and return the documented `showroom` policy shape.
- [ ] **Step 4: Add both config blocks** with identical safe defaults and a separate `showroom_manager` key; do not alter transport settings.
- [ ] **Step 5: Re-run the focused tests and inspect policy output** to confirm it contains only showroom-specific values and transport policy remains unchanged.
- [ ] **Step 6: Commit** with `feat: register disabled showroom manager policy`.

## Task 2: Add durable SQLite inventory and event repository

**Files:**
- Create: `core/showroom_repository.py`
- Create: `tests/test_showroom_repository.py`

**Interfaces:**
- `ShowroomRepository(path)` opens SQLite, creates schema idempotently, and supports context-manager close.
- `reconcile(cars: list[dict], observed_at: int) -> dict` reconciles internal instance rows by normalized model and observed occurrence count; it returns counts, total, and discrepancy metadata. Because the game exposes no stable vehicle ID, it does not claim which same-model physical car was lost.
- `record_event(event_key: str, event_type: str, model: str | None, occurred_at: int, payload: dict) -> bool` inserts once by unique event key and returns false for a duplicate.
- `save_agent_state(state: dict, saved_at: int) -> None` atomically replaces the serialized planner checkpoint.
- `load_agent_state() -> dict` returns the last checkpoint or `{}` for a new database.
- `record_action(action_key: str, action_type: str, model: str | None, offer_id: str | None, status: str, at: int, detail: dict) -> bool` persists each action receipt once and refuses duplicate action keys.
- SQLite tables are `inventory_instances` (local instance key, model, current/departed state, first/last seen), `inventory_events` (deduplicated robbery/theft/sale audit), `action_receipts` (one row per guarded game action), and `agent_state` (one serialized planner checkpoint).

- [ ] **Step 1: Write repository tests first** for fresh schema, exact model counts, repeat reconciliation, event deduplication, action idempotency, and state survival after closing/reopening the database.
- [ ] **Step 2: Run the focused tests and confirm they fail** with `venv/bin/python -m unittest discover -s tests -p test_showroom_repository.py -v`.
- [ ] **Step 3: Implement SQLite schema and repository methods** using only standard-library `sqlite3`; create parent directories, enable foreign keys, use parameterized SQL, and wrap each mutation in a transaction.
- [ ] **Step 4: Ensure unpriced vehicles are included in inventory counts** by model, while offers/actions are stored separately from physical inventory.
- [ ] **Step 5: Re-run focused tests**, including a temporary on-disk database reload.
- [ ] **Step 6: Commit** with `feat: persist showroom inventory and receipts`.

## Task 3: Implement pure DOM parsing and showroom decision planner

**Files:**
- Create: `scripts/showroom_manager.js`
- Create: `tests/showroom_manager.test.js`
- Create: `tests/fixtures/showroom-offers.html`
- Create: `tests/fixtures/showroom-robbery-popup.html`
- Create: `tests/fixtures/showroom-theft-notification.html`

**Interfaces:**
- `parseShowroom(root, hardLimit) -> {available, total, capacity, cars, offers, error}` extracts normalized model names, base values, offer prices, offer IDs, and unpriced rows from observed DOM selectors; `capacity` comes from configured `hardLimit`. Invalid or duplicate offer IDs make the parse unavailable rather than partially actionable.
- `parseCarRobberyPopup(root) -> {success, model}` returns a model only for the confirmed successful `rob_car` popup; otherwise `success` is false. The supervisor assigns and persists a local event key when first observing the popup because notifications do not expose a stable event ID.
- `parseCarTheftNotifications(root) -> Array<{model, text, relative_time, fingerprint}>` extracts theft notices as audit evidence. Their fingerprint is only for local deduplication; notices never directly change inventory counts.
- `createMafiaShowroomPlanner(policy, saved, now)` returns `observe(parsed)`, `plan(parsed)`, `markPending(action)`, `confirm(actionKey, result)`, `snapshot()`, and `serialize()`.
- `plan(parsed)` returns `null` when disabled, in observe mode, or when data is invalid; at 250 cars returns `{kind: "sell_all", key, reason: "hard_limit"}`; at 215 or more returns the same with `reason: "preventive_threshold"`; otherwise, when review is due, returns one `{kind: "reject_offer", key, offer_id, model, price}` at a time for a model with a configured floor and offer below it.
- Planner state persists the two-hour review start/completion, capacity state, pending action, last confirmed result, and the inventory generation for which a sell-all action was attempted. A review timestamp advances only after all eligible offers have been evaluated. A capacity sale is not repeated while the same inventory generation remains unresolved.

- [ ] **Step 1: Write parser and planner tests first** for exact DOM extraction, successful/failed robbery popups, theft notice parsing/deduplication, observe-only mode, missing model floor, price equality, below-floor rejection, review cadence, 215/250 sales, and stale/duplicate IDs.
- [ ] **Step 2: Run the focused test and confirm it fails** with `bun test tests/showroom_manager.test.js`.
- [ ] **Step 3: Implement DOM parsers as pure functions** using the observed selectors `.car_offer[id^='caroffer_']`, `.car_title`, `.car_worth`, `.car_price`, `#dialog_carshowroom_offers`, `.notification`, and `.notif_time[data-timeago]`; never click or mutate DOM in this file.
- [ ] **Step 4: Implement deterministic planner decisions** with injected `now`, persisted review time, one pending rejection at a time, and capacity rules taking precedence over price floors.
- [ ] **Step 5: Re-run the focused Bun test** and verify planner serialization followed by recreation preserves pending action and both timers.
- [ ] **Step 6: Commit** with `feat: plan showroom price and capacity actions`.

## Task 4: Integrate the showroom workflow into the resident supervisor

**Files:**
- Modify: `core/dom_driver.py`
- Modify: `scripts/supervisor.js`
- Modify: `tests/supervisor.test.js`
- Modify: `tests/showroom_manager.test.js`

**Interfaces:**
- `DOMDriver.source` loads `showroom_manager.js` before `supervisor.js` and preserves existing planner loading.
- Supervisor selects `kind === "showroom"` independently from `kind === "transport"`.
- Snapshot adds `showroom` with `enabled`, `mode`, `total`, `capacity`, `unpriced`, `counts_by_model`, `next_review_at`, `last_action`, `pending_action`, and `reconciliation_required`.
- Rejection and sell-all use the existing `begin(...)`, action delay, user guard, dry-run gate, and expected-command/confirmation receipt mechanisms.
- A showroom capacity pause blocks only the `rob_car` activity; other crime types remain governed by their existing policy.

- [ ] **Step 1: Add failing supervisor tests** for policy isolation, no action in observe/dry-run mode, no action during user guard, opening only the showroom offer dialog, and snapshot inventory fields.
- [ ] **Step 2: Add failing receipt tests** proving a rejection waits for fresh offer state and a timed-out rejection is not clicked a second time before reconciliation.
- [ ] **Step 3: Run focused tests and confirm failure** with `bun test tests/supervisor.test.js tests/showroom_manager.test.js`.
- [ ] **Step 4: Load the pure planner in `DOMDriver`** and initialize it only when the showroom policy exists; do not modify transport planner behavior.
- [ ] **Step 5: Add successful robbery and theft-notification audit events** to the agent snapshot; assign a local sequence/fingerprint and keep showroom counts as the only inventory authority.
- [ ] **Step 6: Add one-action-at-a-time showroom scheduling** and integrate only the established `showroom:rejectoffer`, `showroom:acceptall` commands, each with exact matching offer IDs and visible confirmation state.
- [ ] **Step 7: Add post-action reread and uncertainty handling**; on unknown modal, account/session change, or missing acknowledgement, pause showroom actions and expose `reconciliation_required`. If a capacity sale leaves at least 215 autos, pause only `rob_car` and do not repeat Sell all until inventory changes or a fresh offer becomes available.
- [ ] **Step 8: Re-run focused supervisor tests and existing transport tests** using `bun test tests/supervisor.test.js tests/showroom_manager.test.js tests/transport_planner.test.js`.
- [ ] **Step 9: Commit** with `feat: integrate guarded showroom actions`.

## Task 5: Persist showroom snapshots and action history through BiDi lifecycle

**Files:**
- Modify: `main_bidi.py`
- Modify: `core/showroom_repository.py`
- Create: `tests/test_showroom_lifecycle.py`

**Interfaces:**
- Before each `driver.install(agent_config)`, load the SQLite checkpoint into `agent_config.showroom_state`.
- After every successful `driver.install` or `driver.heartbeat`, if the snapshot contains `showroom`, reconcile its complete inventory, save `showroom.state`, and persist newly sequenced robbery/action events idempotently.
- The `runtime/status.json` snapshot continues to expose the last showroom summary without exposing session secrets.
- Build the per-install config from the current database checkpoint, rather than retaining a stale startup copy of `resident_config`, so reconnects hydrate the newest confirmed timer and receipt state.

- [ ] **Step 1: Write lifecycle tests first** with mocked driver snapshots for first install, repeated heartbeat, duplicate history sequence, restart hydration, and database unavailable.
- [ ] **Step 2: Run the focused tests and confirm they fail** with `venv/bin/python -m unittest discover -s tests -p test_showroom_lifecycle.py -v`.
- [ ] **Step 3: Implement startup hydration and heartbeat persistence** around the existing install/heartbeat path without changing target selection, browser lifecycle, or service enablement.
- [ ] **Step 4: Handle repository failures conservatively**: report a showroom persistence issue, disable showroom actions for that process, and preserve other module operation.
- [ ] **Step 5: Re-run focused tests** and confirm reloading from the same SQLite file restores timers and uncertain action receipts.
- [ ] **Step 6: Commit** with `feat: persist showroom state across supervisor restarts`.

## Task 6: Validate configuration and publish the manager status

**Files:**
- Modify: `core/bot_config.py`
- Modify: `config/config.json`
- Modify: `config/bidi-defaults.json`
- Modify: `scripts/supervisor.js`
- Modify: `tests/test_showroom_manager.py`
- Modify: `tests/supervisor.test.js`

- [ ] **Step 1: Add failing config tests** for invalid modes, nonpositive review intervals, noninteger floors, preventive threshold greater than or equal to hard limit, and default-disabled state.
- [ ] **Step 2: Run focused tests and confirm they fail** with `venv/bin/python -m unittest discover -s tests -p test_showroom_manager.py -v`.
- [ ] **Step 3: Validate all showroom values** in `load_config` and make malformed policy fail before page injection.
- [ ] **Step 4: Add showroom status to the existing agent heartbeat** with pending review time, rejection progress, unpriced count, capacity, last sale receipt, and pause reason.
- [ ] **Step 5: Verify policy independence** with tests that enable transport only, showroom only, and both policies; transport output and planner behavior must stay unchanged.
- [ ] **Step 6: Re-run focused Python and Bun tests** with `venv/bin/python -m unittest discover -s tests -p 'test_showroom_*.py' -v` and `bun test tests/supervisor.test.js tests/showroom_manager.test.js tests/transport_planner.test.js`.
- [ ] **Step 7: Commit** with `feat: validate and expose showroom manager status`.

## Task 7: Run full local verification and update operational documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-showroom-manager-design.md`
- Modify: `docs/superpowers/plans/2026-10-14-showroom-manager.md`
- Modify: `docs/game-map/mafiabattle-ui-dom-map.md`

- [ ] **Step 1: Run the complete repository checks** with `just test` and `just check`; resolve failures caused by this change before continuing.
- [ ] **Step 2: Add verified implementation paths and observed selector/command contracts** to the spec and game UI map, keeping live observations separate from inferred behavior.
- [ ] **Step 3: Verify default configuration remains disabled and observe-only** by inspecting the generated policy; do not start the service or interact with live game controls.
- [ ] **Step 4: Review the final diff** to confirm no game files, runtime database, credentials, or unrelated existing user changes are included.
- [ ] **Step 5: Commit** with `docs: document showroom manager integration`.

## Handoff Notes

- Implementation starts only after the user reviews and approves this plan.
- At runtime rollout, keep `enabled: false` and `mode: "observe"` by default. Enabling live rejection or sale is a separate operational choice after fixture and local verification.
- The bot is currently disabled. This plan does not include starting it, enabling its LaunchAgent, or performing any game action.
