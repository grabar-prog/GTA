# MERIDIAN CITY

Procedural third-person sandbox city in **one self-contained HTML file**. No build step, no assets: every texture is painted into a canvas at runtime, every mesh is generated from code. Opens straight from `file://`.

![stack](https://img.shields.io/badge/Three.js-0.160-orange) ![file](https://img.shields.io/badge/single%20file-gta.html-green) ![checks](https://img.shields.io/badge/harness-23%20checks-brightgreen) ![license](https://img.shields.io/badge/license-MIT-green)

## Run it

Open `game/gta.html` in a browser (drag it into the window, or `file:///…/game/gta.html`). Internet access is required — Three.js **0.160.x** is resolved through an `importmap` pointing at `unpkg.com`. The page runs as an ES module.

| Key | Action |
| --- | --- |
| Click | capture / re-capture the mouse (pointer lock) |
| `W A S D` / arrows | walk |
| `Shift` | sprint (9.6 m/s vs 4.6 m/s) |
| `Esc` | release the cursor |
| `-` `=` `0` | traffic time-scale ×0…×2.5 (step 0.25); the HUD slider only takes input while the cursor is free |

City generation takes ~1–2 s on a GPU (~3.5–4 s under headless SwiftShader). The seeded RNG (`mulberry32(20240607)`) makes the layout identical on every load — change the seed at the top of the script block for a new floor plan.

## What's in here

```
game/gta.html            the whole game — one file, single source of truth
harness/check-city.js    headless harness: loads the page, asserts 23 contracts, prints JSON + screenshots
methodology/contracts/   formal, testable behaviour specs (see methodology/contracts/README.md)
methodology/docs/        architecture map · performance internals · limitations in detail
methodology/handsoff.md  state at the end of the last session + open work
AGENTS.md                entry point: working norms, repo structure, where to look
ides/                    generated per-environment snapshots (tools/sync-ides.sh)
journal/                 session journal, one file per sprint
LICENSE                  MIT
harness/package.json     dev-only dependency: puppeteer-core (for the harness)
```

**One file = one source of truth.** Nothing is extracted into modules. `harness/check-city.js` resolves `game/gta.html` relative to its own directory, so moving the HTML breaks it unless you pass the path as an argument.

## Verify it

```bash
npm --prefix harness i                  # puppeteer-core only
node harness/check-city.js              # from the repo root; NODE_PATH=…/node_modules if require() can't resolve it
# env: EDGE_PATH=<path to msedge.exe>   OUTDIR=<screenshot dir>, default %TEMP%\meridian-check
```

Exit `0` = all checks green, `1` = a check failed, `2` = harness crashed. The run prints one JSON blob (`genMs`, `stats`, `spawn`, `sim`, `cam`, `cycle`, `shots`, `errs`) followed by the 23 PASS/FAIL lines. Reference numbers and thresholds live in [methodology/contracts/harness.md](methodology/contracts/harness.md).

~10 minutes of the traffic audit is a pure `updateCars(0.05)` loop with no rendering — that is what proves lane-keeping, right-of-way arbitration and the absence of gridlock.

## The world

`GRID=10 × CELL=58 m` → a 580×580 ground plane (`±290`), roads 16 m wide with 3.5 m sidewalks, ~337 buildings in 2×2 block clusters (heights lerp 9→78 m toward the centre, some lots are left empty as "plazas"), one park at `i===4 && j===5`, 121 streetlight poles lit by a pool of **6** `PointLight`s bound to the nearest ones, 52 vehicles (cars / buses / articulated artbus / semis with double wheels) and 54 pedestrians. Full day cycle is 170 s; windows emit light at night, a billboarded moon rises opposite the sun.

Numbers, derivations and cross-references: [methodology/contracts/world-constants.md](methodology/contracts/world-constants.md).

## Known limitations

- Only 6 streetlights actually illuminate; distant poles read as silhouettes at night (compensated by emissive windows).
- No LOD or distance culling — the entire city is always in the scene.
- Vehicles keep their lane and yield at crossings, but never turn: a turn would need trajectory rebuilding that the model doesn't have. Pedestrians pace their own sidewalk strip and don't cross districts.
- Outer road lines `0` and `GRID` sit exactly on the ground-plane border (`±290`). The asphalt itself only exists inside `±290`, so standing on an outer line shows a break in the pavement; traffic wraps at `±(HALF+APRON)=±300` thanks to the 10 m dirt apron.
- Vehicles pop in/out at the map edge on wrap-around, with no fade.
- `renderer.useLegacyLights = true` keeps the r128-calibrated light intensities after the Three.js migration — a stopgap until the sun / hemi / moon / streetlight-pool numbers are re-tuned for the modern (r155+) light default. Visual output is currently identical to the pre-migration build.
- No save state, no audio, no boardable vehicles.

Why each one is the way it is, and what fixing it would cost: [methodology/docs/limitations.md](methodology/docs/limitations.md).

## License

[MIT](LICENSE) — copyright 2026, grabar-prog. Use it, fork it, ship it.