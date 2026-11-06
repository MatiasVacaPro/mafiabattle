# MafiaBattle Observable Game Map Implementation Plan

> **For agentic workers:** Use the `executing-plans` skill to carry out this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Produce a source-traceable map of MafiaBattle's visible interface, observable frontend resources, existing BiDi coverage, and explicit coverage gaps.

**Architecture:** Keep the full map in one Markdown file at `docs/game-map/mafiabattle-ui-dom-map.md`; organize entries by screen and label every fact with provenance and observation status. Add a compact Obsidian project note that links to the map and is indexed from the MafiaBattle project MOC and master index.

**Tech Stack:** Markdown, existing repository documentation and source, read-only BiDi inspector when safe, Obsidian MCP.

**Spec:** `docs/superpowers/specs/2026-10-14-mafiabattle-game-map-design.md`

## Global Constraints

- Do not modify game files, bot code, bot configuration, or operational data.
- Do not interrupt, reconfigure, or compete with the active supervisor; if inspection cannot be isolated, mark live UI as pending.
- Do not trigger gameplay mutations such as buying, selling, producing, donating, traveling, delivering, betting, or other effects.
- Do not persist credentials, cookies, tokens, session IDs, auth-bearing request bodies, full HTML, or full minified bundles.
- Distinguish `observed in DOM`, `located in frontend`, `documented in external source`, `inferred`, and `pending/unavailable` evidence.
- Preserve all pre-existing working-tree changes; create and edit only the planned map, plan, and Obsidian note/index entries.
- Do not run tests; validate the documentation structure and the exact changed-file set with read-only inspection.

---

## File Structure

- Create `docs/game-map/mafiabattle-ui-dom-map.md`: complete master map, evidence legend, section index, per-screen records, coverage table, and verified gaps.
- Create `01 - Proyectos/MafiaBattle/MafiaBattle — Mapa de interfaz y frontend observable.md` in Obsidian: canonical YAML, concise purpose/status, link to the repository map, and project MOC backlink.
- Modify the existing MafiaBattle project MOC and `_INDICE_MAESTRO` only by adding links to the new note.
- Do not modify game, bot, configuration, service, or operational-data files.

### Task 1: Establish the evidence inventory

**Files:**
- Read: `docs/game-reference/*.md`, `docs/game-reference/*.json`, `docs/bidi-plan.md`, relevant project session/plan documents.
- Read: `main_bidi.py`, `scripts/supervisor.js`, `scripts/inspect_resources.py`, and relevant `modules/*.py` / `scripts/*.js` only to map existing UI coverage.
- Create: `docs/game-map/mafiabattle-ui-dom-map.md`.

- [x] Read local game-reference catalogs and existing documentation; record their date and classify them as static references.
- [x] Read BiDi entry points and module selectors; record which interface areas each module currently reaches, without editing them.
- [x] Check supervisor/inspector ownership and locking using read-only status. It was initially active; after the user paused it, status was `STOPPED`, process absent, and the exclusive lock free, so read-only inspection proceeded.
- [x] Create the map with an evidence legend and inventory of all identified sections; distinguish observed, frontend-located, external-source, inferred, and pending facts.

**Deliverable:** A populated source inventory and initial coverage matrix with all known UI areas represented, even if some are pending.

### Task 2: Map observable screens and frontend references

**Files:**
- Modify: `docs/game-map/mafiabattle-ui-dom-map.md` only.
- Read only: relevant repository code and frontend resources exposed by the existing browser inspector, if the lock check permits.

- [x] Organize records under global navigation, Empire I, Empire II, global systems, and unavailable/uninspected sections.
- [x] For each source-supported screen, record selector/type and meaningful attributes, related local BiDi module, provenance, and limitations; visible live states and frontend game symbols are marked pending where not evidenced.
- [x] Date historical volatile references and state their context; do not present static catalog values as current DOM observations.
- [x] Open/read/close only visible building information panels and 13 subpanels; no purchase, production, travel, collect, casino, donation, upgrade, or training button was activated. One weed-farm close handler automatically invoked `weedfarm:weedoffers_refresh`; its effect is explicitly marked pending and no further close action will be repeated.
- [x] Read the already-visible `#dialog_crimes` without opening or closing it; record 30 rows and their `crime:perform` controls without activating them.
- [x] Complete live source sections for the accessible Empire I; list Empire II and global interfaces that remain inaccessible/pending.

**Deliverable:** Screen-level records with traceable evidence and no unsupported handler/action claims.

### Task 3: Close coverage gaps and document navigation boundaries

**Files:**
- Modify: `docs/game-map/mafiabattle-ui-dom-map.md` only.

- [x] Cross-reference discovered screens/controls to existing BiDi modules or mark areas with no verified coverage.
- [x] Add explicit gaps for inaccessible or uninspected sections and state why they were not inspected.
- [x] Add a concise coverage summary separating source code, static references, and pending live questions.
- [x] Check that every scope category from the spec appears in the index and has evidence or explicit pending status.

**Deliverable:** A reviewable map that exposes known coverage and evidence gaps without implying exhaustive access to unavailable game state.

### Task 4: Persist the project link in Obsidian

**Files:**
- Create: `01 - Proyectos/MafiaBattle/MafiaBattle — Mapa de interfaz y frontend observable.md`.
- Modify by atomic link insertion: the existing MafiaBattle project MOC and `_INDICE_MAESTRO`.

- [x] Read the exact current note/MOC/index content and confirm the target note path did not already exist.
- [x] Create the note with strict YAML (`type: project`, precise `category`, project tags, `moc: "[[MOC - Proyectos]]"`), project link, repository-map reference, purpose, scope, date, and backlink to the MOC.
- [x] Insert one inbound note link into the MafiaBattle section of the project MOC and one into the relevant `_INDICE_MAESTRO` section, preserving surrounding content atomically.
- [x] Normalize the new filename/content to Unicode NFC and verify both index links resolve to the created note.
- [x] Open the note in Obsidian after successful creation.

**Deliverable:** A navigable, indexed Obsidian record that points to the repository's full map without duplicating it.

### Task 5: Review scope, evidence labels, and change boundaries

**Files:**
- Read: `docs/game-map/mafiabattle-ui-dom-map.md` and the exact new Obsidian note/index entries.
- Read-only check: `git status --short` and focused diffs for the planned repository docs.

- [x] Review the map against local sources, dated references, and the live inspector outputs; correct the airport classification and distinguish current observations from pending screens.
- [x] Confirm each area from the spec is documented or explicitly pending, and historical volatile references are dated and contextualized.
- [x] Confirm no credentials or full HTML/bundle content were copied into the map.
- [x] Confirm only the map/plan/spec documentation paths were changed in the repository; no game, bot, configuration, or operational-data files were edited or staged.
- [x] Record the remaining live-DOM limitations and summarize verified source coverage; the supervisor remains stopped.

**Deliverable:** Final documentation with an auditable evidence boundary and an explicit statement of what remains unavailable.
