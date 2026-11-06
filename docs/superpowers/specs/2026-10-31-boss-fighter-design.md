# Autonomous Boss Fighter Design

## Goal

Add a resident `boss_fighter` policy that progresses every boss-event level using only the free pistol and free bombs, pauses for health recovery, handles rewards and goal popups, and records final defeat without spending diamonds.

## Architecture

The Python policy owns defaults and validation. A separate browser helper, `scripts/boss_fighter.js`, owns arena styling and the pure combat assist so it can be tested independently. `scripts/supervisor.js` owns navigation and lifecycle as a `kind: "boss"` state machine, while a 45 ms interval only performs in-fight aiming/shooting when the agent is running and not in dry-run mode.

Boss dialogs are task-owned. Active combat extends its deadline and is exempt from city-dialog recovery. Health and casino retain higher scheduling priority; boss runs before routine policies and never requires a timer slot or a specific empire.

## Safety and completion

- Only `guntype = 6` is selected; Uzi and machine-gun controls are never queried for clicking.
- Shooting is enabled only while a visible boss exists; otherwise mouse flags are cleared.
- Scratch completion uses the native functions only after the normal 900 ms grace period.
- A defeated overview is persisted in resident records and prevents reopening the unchanged event.
- Unit fixtures cover CSS, aiming, bombs, lifecycle progression, health pause, defeat, cleanup, priority, and snapshots.

