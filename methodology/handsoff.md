# Handoff — MERIDIAN CITY (`game/gta.html`)

State cache. Read this and nothing else to know where the project stands.
Renewed 2026-10-26: detail lives in the contract that owns it, not here — an open question is named
once below and written up in its owner file.

## Where we are

- Gate: **all 25 checks green, exit 0**, verified@HEAD-2026-10-26 — check 25 (lobby camera safety) added to the gate; deterministic reference numbers unchanged since 2026-10-21, `genMs` is machine-bound. Reference JSON and canonical commands: [contracts/harness.md](contracts/harness.md).
- Last verified behaviour change: chase-camera pull-in extended to ceiling slabs — no collider rect **and** no interior ceiling slab may sit between camera and player ([camera.md](contracts/camera.md) C-CAM-6 amendment); the orbit stops 0.3 m short of any wall face or slab underside, minimum distance 1.5 m. `floorSlabs[]` is populated from each builder's `ceilY`; slabs bind only at positive pitch (orbit rising). Harness reference numbers unchanged (the fixed spawn viewpoint stands on a street).
- Previous behaviour change: `clearance()` same-axis fix — opposing cars on the same road no longer wait for each other at a crossing ([right-of-way.md](contracts/right-of-way.md) C-ROW-4 amendment).
- Last visual change: physical light model (C-API-7 resolved) — [render-api.md](contracts/render-api.md) § Recalibration. Night and mid-distance walls are intentionally brighter than the pre-r155 baseline; harness reference numbers unchanged.
- Session 2026-09-29: parks replaced with six new builders (botanical, amphitheater, japanese, maze, playground, market) in `assets/models/park.js`; city switched to **right-hand traffic** (C-LANE-7); four traffic fixes — bus `dmin` = `L*0.55+4`, `roomToClear` extended (player / peds / segment capacity), `bodyGap` same-axis front test by centre, deterministic perpendicular-overlap post-pass in `buildCars`. Reference numbers re-measured 2026-09-29 ([contracts/harness.md](contracts/harness.md) § Reference run).
- Session 2026-10-21 (committed): three reported building-interior defects fixed and verified in `assets/models/building.js` — viewer menu entries for all seven types; office base course + lift backing slab (glass no longer floats over air); tower lobby lining removed, lifts on a narrow backing slab as in `buildOffice`. Same commit: per-building collision shells (`buildingWalls`, thin wall rects with door gaps) and facade facing in `game/gta.html`; `.gitignore` (+`list.txt`). Close-up shots verified each fix; harness 24/24 green, reference numbers refreshed ([contracts/harness.md](contracts/harness.md) § Reference run).
- Session 2026-10-21 (committed): chase-camera pull-in in `game/gta.html` — `camClearT()` / `camBoxT()` slab test over `buildingWalls` + `parkBlockers`, orbit distance scaled by the earliest entry, `CAM_WALL_MARGIN = 0.3` / `CAM_MIN_DIST = 1.5`; new rule C-CAM-6 in [contracts/camera.md](contracts/camera.md), C-CAM-2 amended to a "nominal" orbit distance. Verified with a scratchpad rig (before: full orbit point inside two wall rects, segment crossed both; after: zero crossings); harness 24/24 green, reference numbers unchanged ([contracts/harness.md](contracts/harness.md) § Reference run).
- Session 2026-10-22 (committed): ceiling-slab pull-in — the same C-CAM-6 invariant extended horizontally. `assets/models/building.js` builders report their first-storey underside as `ceilY`; `add()` registers it in a top-level `floorSlabs[]` (same transform and swap-aware rect as the walkable); new `camSlabT()` margin-plane crossing test folded into `camClearT()`. Verified with a scratchpad rig over all 62 walk-in lobbies: before — camera 4.6 m above the underside at pitch 1.2; after — every lobby pulled in, residual ≤ +0.25 m only where the min-distance floor wins at extreme pitch, towers fully clear. Harness 24/24 green, reference numbers unchanged ([contracts/harness.md](contracts/harness.md) § Reference run).
- Session 2026-10-22 (committed): new contract [contracts/building-interiors.md](contracts/building-interiors.md) — C-INT-1…5 own the generation side of walk-in interiors: builder `entries`/`interior` declaration, one shared floor/slab transform in `add()`, hollow wall shell with door gaps, facade facing, camera-safe surfaces. Camera-side pull-in stays in [contracts/camera.md](contracts/camera.md) C-CAM-6; its ceiling-slab rationale now points at C-INT-2 instead of restating the data flow. Docs + comment citations only — no runtime change, harness reference numbers untouched; lint clean (58 anchors, prefix `INT` documented). AGENTS.md also fixed two stale statements: router range is C-LANE-1…7 and the retired `useLegacyLights` stopgap sentence removed.
- Session 2026-10-22 (committed): stale references to the removed per-session log folder purged from AGENTS.md, README.md and this file — it was never tracked by git; handsoff stays the only per-session record. Docs only; lint clean.
- Session 2026-10-26 (committed): stale harness check count fixed (23 → 24) in the AGENTS.md router row, README badge/tree lines and docs/architecture.md — a leftover from before check 24 landed. Docs only; lint clean.
- Session 2026-10-26 (committed): anchor-citation coverage pass — contract-anchor comments (the `// see …#C-<DOMAIN>-N` form documented in AGENTS.md) added at the enforcement sites in `game/gta.html` (14) and `assets/traffic-ai.js` (11, T1–T11); lint's "anchors with no citation" dropped 53 → 38. Comments only; harness untouched.
- Session 2026-10-26 (committed): harness check 25 — lobby camera safety. The sweep re-runs the frame loop's orbit math per walk-in lobby (pitch × 16 yaws × {6.2, 7.4} m), takes d2 from the game's own `camClearT` and verifies each final pose with an independent geometric oracle: no wall or slab between camera and player in any of the 9920 poses over all 62 lobbies (35 office / 21 shop / 6 tower), zero orphan slabs, ceiling clearance > 1.7 m. The oracle accepts C-CAM-6's documented min-distance-floor residual (≤ +0.25 m above the underside) — without it a clean city fails on exactly the poses the contract already accepts. Reference block in [contracts/harness.md](contracts/harness.md) re-verified; gate is now 25 checks.
- Session 2026-10-26 (committed): drift-fix pass — C-ROW-2's quoted guard updated to the current centre test (`dF <= 0`, changed 2026-09-29); AGENTS.md router range corrected to C-ROW-1…7; slab-binding wording in C-CAM-6 / C-INT-5 (plus this file's own bullet and the building-interiors feel test) fixed from 'looking up' to positive pitch — camera above eye level per C-CAM-1; C-CAM-6 rule line now states its min-distance-floor residual (≤ +0.25 m) explicitly; stale `dF + oF` formulas also corrected in traffic-lanes.md amendment text and a traffic-ai.js comment. Docs + comments only — no runtime change, harness reference numbers untouched.
- Open defects in the city / traffic / camera layer: **none**. Unresolved *decisions* are not defects — see below.
- Tooling: `tools/lint-refs.sh` is the repo linter — anchor citations, router coverage, doc links, the pinned Three.js 0.160 API in `game/gta.html`, anchor format and documented prefixes, provenance labels on run metrics, numbered TODOs (exit 0/1), green since 2026-09-20. It also reports coverage — after the 2026-10-26 citation pass, **37 of 58 anchors are still uncited**; enforcement-site comments now live in `game/gta.html` and `assets/traffic-ai.js`, not just in `AGENTS.md` examples.
- Since that run, docs-only edits (`AGENTS.md` as entry point, this file as a cache), one comment fix in `game/gta.html` (HUD traffic-multiplier snap is a **0.05** grid, not quarter steps), the flat-window → `window.MERIDIAN` surface migration, and the C-API-7 recalibration.

## Open questions

The single list: name it here, write it up under *Open questions* in the owner contract. Not defects,
not accepted limitations — each waits on a decision or a measurement. Accepted-as-is items belong to
[docs/limitations.md](docs/limitations.md); work with a known shape belongs to a `TODO(sNN)` comment.


## What next

Nothing queued. No open questions remain — the two that were live in
2026-09-26 (flat window surface, `useLegacyLights`) are both resolved and their
records live in the owner contracts ([contracts/harness.md](contracts/harness.md),
[contracts/render-api.md](contracts/render-api.md) § Recalibration). There is
no `TODO(s27)` any more.

Standing workflow for any behaviour change: fix by direct edits in `game/gta.html`, verify (re-shoot where the harness cannot see), then run [../harness/check-city.js](../harness/check-city.js) (`npm --prefix harness i`, then `node harness/check-city.js`) and refresh the reference numbers in [contracts/harness.md](contracts/harness.md). Update [docs/architecture.md](docs/architecture.md) if functions moved; re-run [../tools/sync-ides.sh](../tools/sync-ides.sh) after any edit to `AGENTS.md` or methodology/ and commit the regenerated adapters with it.

## Watch out for

- `game/gta.html` is the only **game** file. Support code is split across `assets/` into small classic `<script>`s (`file://` blocks sibling ES-module imports): `geom.js`, `asset-registry.js`, `day-cycle.js`, `traffic-ai.js`, `vehicles.js`, plus one file per model under `assets/models/` and two preview pages (`viewer.html`, `diagnostic.html`). Every model self-registers in `MeridianAssets`; the file list is generated by `./sync_models.sh`. Palettes are load-time mutable on each kit. No second game HTML/JS/CSS.

- Three.js **0.160.x** via importmap. The r128 API — `outputEncoding`, `sRGBEncoding`, the `CapsuleGeometry` polyfill — is gone. See [contracts/render-api.md](contracts/render-api.md) C-API-1…7.
- The abandoned "splice" workflow rebuilt the file from a backup snapshot and would silently revert direct edits. Do not resurrect it; edit in place.
- Hero review shots need the portrait rig, which is **not in the repo** — rebuild it in the scratchpad. Procedure, camera-sign convention and the puppeteer serialization trap: [contracts/character-anatomy.md](contracts/character-anatomy.md) → *Verification*. Shots go to `%TEMP%\meridian-char\`, never into the repo (the city harness uses its own `%TEMP%\meridian-check\`).
- Contracts are amended, never relaxed; the seeded RNG is contractual: [contracts/README.md](contracts/README.md).
- `game/gta.html` runs as an ES module: top-level bindings are not on window.
  The surface block at the end of the module is the harness contract — any new
  state that check-city.js needs must be added there or it dies with
  ReferenceError.

## Housekeeping leads (small, none approved)

- An older note claimed a "step-length regression". It was never substantiated: checks stayed green and the gait frames looked fine. Do not treat it as a bug by default.

## Files

Routing by task type lives in [`AGENTS.md`](../AGENTS.md); the function/section map of `game/gta.html` is [docs/architecture.md](docs/architecture.md) (line numbers stale — re-derive with `grep -n` before use). Environment adapters under [`ides/`](../ides/) are generated — never hand-edit a snapshot.
