# MafiaBattle reliability implementation plan

> For agentic workers: use subagent-driven-development task by task; TDD and scoped review.

**Goal:** Correct police handling, complete daily gym, improve production and dispatch transport, restore paused functions.
**Architecture:** Extend native DOM state machine with fresh observed contracts and bounded scheduling.
**Tech Stack:** Python BiDi, browser JavaScript, Bun Happy DOM, just, Biome.
**Spec:** docs/superpowers/specs/2026-10-12-weed-transport-gym.md

## Global Constraints
- Cuenta mati792, exclusivamente Zen Antigravity; no cambiar perfil diario.
- Guard humano de 15s, lease, recibos inciertos persistidos y control de cuenta obligatorios.
- No compras con diamantes, aceleraciones, cancelaciones ni recetas semanales inventadas.
- Mantener reserva de cash 100000 y límite XTC 50000; Meth usa receta nativa actual.
- Gimnasio usa ejercicio 4, máximo diario nativo y temporizador real; no simultáneos ni doble comando.
- No borrar runtime, logs ni recibos; solo integrar archivos de esta intervención preservando ediciones concurrentes.

### Task 1: Weed police rejection and daily gym

Files: scripts/supervisor.js, tests/supervisor.test.js, config/bidi-defaults.json, config/config.json (gym only), optional focused tests included in justfile.
Interfaces: existing fingerprint/progressed/click/available/activeStep scheduler; keep same public supervisor API.

- [ ] Read spec, relevant source and test helpers. Native contract captured read-only in /private/tmp/mafia-current-contracts.json: weed .button.no opens notif_weed_offer_deny then cmd('weedfarm:rejectoffer'); gym exclamation signals remaining sessions, daily data-val used/data-max cap, exercise 4 five minutes.
- [ ] Add failing behavior tests for explicit police cash rejection, diamond acceptance, changed confirmation, no unknown offer actions, rejection timeout/reinjection and human pause. Preserve existing normal buyer behavior. Reject police offer even with transport weed reservation enabled. Denial receipt requires native command acknowledgement plus offer state transition; do not treat close alone as success.
- [ ] Implement smallest weed state machine using exact native observed denial and confirmation controls. Keep accept/reject distinct in pending IDs/fingerprints.
- [ ] Add failing tests for absent gym DOM (open/read before deciding), final free global slot, active gym timer, daily cap and next-day reset, criminal contention, repeated sessions until cap. Ensure gym ready receives scheduling opportunity before criminal consumption. Keep production and completed transport priority.
- [ ] Implement lazy inspection and observed-timer gym scheduling, including native gym timer revalidation at click boundary. Set gym reserve_slots=0 in both config files, relying on actual slot availability. Require gym-specific receipt rather than unrelated timer increment.
- [ ] Run focused tests red then green, full JS tests once and just check. Commit only scoped files using git -c user.name=Codex -c user.email=codex@local.invalid. Report commands/output, self-review and concerns to task-1-report.md.

### Task 2: Transport batching and production timing

Files: scripts/supervisor.js, scripts/transport_planner.js, config/bidi-defaults.json, config/config.json (production/transport), tests/transport_planner.test.js, tests/supervisor.test.js, tests/empire_manager.test.js if necessary.
Interfaces: existing planner observeOrder/observeStock/planDonation/planDispatch and native receipt machinery; inherit Task 1 changes.

- [ ] Read spec and relevant functions/tests. Current order DOM absent in live capture despite loaded parent. Meth running timer 2h, XTC 5h; selectors native current captured /private/tmp/mafia-current-contracts.json. Keep optional objective behavior when specified by config, but remove goal gating from default Meth to operate normally without recognized order.
- [ ] Add failing tests for absent/lazy Meth and XTC recipe/dialogs, native opening route, timers completed/full capacity/cash safeguards, restart after completion without extra delay. Use native tip -> lab route for XTC analogous Meth. Read under demand before production; no recipe inference.
- [ ] Implement production discovery and due times driven by observed countdowns, with bounded no-data backoff. Avoid thrashing hidden stale dialogs; check correct empire, cash reserve, output capacity (including observed max output for XTC bonus) and native active timers before clicking.
- [ ] Add failing transport tests for delayed warehouse DOM preserving objective, absent DOM vs expired order, multiple fractional donations and dispatch in same open visit after confirmed final row, ready order without global slot, unavailable/stale stocks, unknown rows, repeated uncertain acknowledgements, pending persistence and flight interaction.
- [ ] Implement bounded loading wait instead of marking scan complete prematurely. Preserve valid stored orders on transient no DOM; distinguish genuine expiry. Chain confirmed progress to next donation/dispatch; reserve last slot for ready transport; update next scans from relevant receipt/stock changes or native timer completion without scanning every tick. Do not reopen showroom after every theft when no target is missing. Preserve Empire I residence/cash flight constraints.
- [ ] Run focused red/green evidence and full JS suite once plus just check; commit scoped files. Write task-2-report.md.

### Task 3: Restore paused policies and integration diagnostics

Files: config/bidi-defaults.json, config/config.json, tests/test_bidi.py or focused JS tests, README.md, scripts/supervisor.js only if version/diagnostics required.
Interfaces: current resident config, event and transport planners, scheduler priority from prior tasks.

- [ ] Verify both configs keep all modules enabled. Set event_objectives_enabled=true and weed_reserve_enabled=true following latest user instruction. Preserve casino, collectors, health, helicopter, crime, stocks, cigar non-cash policy and production. Do not activate undocumented premium or legacy GUI modules.
- [ ] Latest steering: user is already in Empire II, where transport is located. Confirm explicit map affinity: gym/Weed/Meth/stock/Cigar/I collectors in I; transport/XTC/II collectors in II; global account health/helicopter/menu activities validated on observed controls. Add gym empire=1 to both configs and enforce it in lazy discovery/readiness/final click/recovery. Behavior test: stale or visible cached I gym DOM with unused sessions cannot train in II, and returning to I restores normal exercise. Add equivalent Meth/XTC wrong-empire integration if existing tests do not cover the restored policy path. Do not change default flight/residence parameters; controller no longer needs early-flight override because user arrived manually.
- [ ] Address Task1 deferred minor: derive rejection gate from spec.id, with a custom-ID uncertain-rejection regression test; combined police-diamonds/reserve and ordinary-buyer/reserve tests already required below.
- [ ] Critical live integration finding: /private/tmp/mafia-empire2-contracts.json now includes real warehouse. Completed car/weed/XTC rows have progress data-val=data-max and NO donate button. Existing parseTransportOrder requires button handler orderid for every row and returns null. Add actual native fixture and RED tests for three completed rows + incomplete Meth, and all completed rows with no donate buttons -> dispatch available with slot. Derive ID from strict transportorder_<digits> for completed rows with numeric full progress; incomplete rows require matching native transport:donate handler, and any present mismatched handler must fail closed. Current real amounts: Meth342.91/631.8, cars7/7, Weed1461.6/1461.6, XTC279.45/279.45. No hardcoded live IDs in production code. Preserve keys/pending and unknown/malformed row safety.
- [ ] Add behavior tests covering restored policies: active/expired known event, transport weed reservation with police denial and diamond exception, gym/production/transport priorities with criminals present. Avoid config-mirroring tests.
- [ ] Increment supervisor version and expose useful gym/production/transport next-due diagnostics if existing snapshot insufficient to verify repaired behavior. Document final behavior and operation in README without rewriting prior history.
- [ ] Run just test and just check, requesting sandbox escalation for local sockets if needed; structural diff audit; commit scoped files. Write task-3-report.md with exact verification evidence and live limitations. Controller performs actual runtime installation after final review.
