# Contract: the acceptance harness

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Everything under *Rationale* — environment troubleshooting, output shape, reference numbers, the check table — is read only when a check fails, when editing the harness, or when changing behaviour it gates.

`harness/check-city.js` loads `game/gta.html` (resolved relative to its own directory, so it works from any cwd) in headless Edge, waits for the loader to hide, collects page errors, then asserts **23 checks** and prints one JSON blob plus PASS/FAIL lines. It is the only executable spec this project has — keep it in the repo.

## Rules — read always

> **DRIFT NOTICE 2026-09-25.** The reference numbers in this file were measured at `cf4c702` — before the assets split (geom/asset-registry/day-cycle/traffic-ai + `assets/models/*`), before `CAR_COUNT_BASE / CAR_COUNT_MAX` and the density-based traffic multiplier ([traffic-lanes.md](traffic-lanes.md) C-LANE-6, amended), before `GROUND_APRON` grew from 10 to 60 (world-constants.md, amended), and before the building and park generators were replaced. The 23 checks themselves are unchanged — the numbers they print are not. **Re-run `node harness/check-city.js` from the repo root and paste the new reference blob here before trusting any threshold in the table below.** The drift is expected: the seeded RNG is contractual, so every rng-order change moves every downstream count.


- **Run:** `npm --prefix harness i` (puppeteer-core only), then `node harness/check-city.js` from the repo root.
- **Exit codes:** `0` all green · `1` a check failed · `2` the harness itself crashed. Reference run: 23/23 PASS, exit 0, wall time ≈24.6 s under SwiftShader (generation alone 7.73 s).
- **Screenshots never land in the repo** — `OUTDIR=%TEMP%\meridian-check\`. Hero review shots use a different rig and go to `%TEMP%\meridian-char\`.
- **The traffic audit is a pure simulation:** `updateCars(0.05)` in a loop with no rendering, 20k steps after 5k warm-up (~12 s wall, ~16.7 simulated minutes), and it must run alongside `updatePeds` — a crowd frozen during the run reads as a phantom collapse and has already produced one false alarm.
- **Harness versions are not comparable:** `tools/check-city.js` (pre-split, 8 checks) and `harness/check-city.js` (23 checks) are different programs with different measurement points. Always state which version a number came from.
- **Thresholds are contracts:** amend them with a reason ([README.md](README.md)), never silently relax; the seeded RNG is contractual, so reference numbers move whenever generation order changes.
- **Console noise that is normal:** 4× Edge *"Tracking Prevention blocked access to storage for …unpkg.com/three@0.160…"*; FPS ≈8 under SwiftShader at 1280×760 with shadows (player speed stays correct because `dt` is clamped to 0.05 s).

## Rationale & examples — read only when editing that rule

### Where it can actually run

- **User Git Bash** — the main path, works always. Verified at `cf4c702` (2026-09-19): 23/23 PASS, exit 0.
- **LM Studio agent shell** — works **only** if `puppeteer-core` sits in the **LM Studio scratchpad**, not in the project. The agent sandbox may allow spawning GUI processes loaded from the scratchpad but not from arbitrary paths.

| `NODE_PATH` | Result | Verified on |
|---|---|---|
| `C:/Users/user/.lmstudio/scratchpads/c/node_modules` | ✅ works | old 8-check `tools/check-city.js`, exit 0, ~18 s |
| `<project>/harness/node_modules` | ❌ `Code: 0`, ~0.3 s | current 23-check `harness/check-city.js` |

`NODE_PATH=` helps but is not universal — what matters is **where** it points: scratchpad (allowed by the sandbox) or project (forbidden). `EDGE_PATH=` is a separate concern and only matters when the browser binary cannot be found.

Probe GUI spawning with one line before a run:

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --version   # must print a version
```

Also check `where msedge.exe` — on 64-bit Windows Edge may live at `C:/Program Files/Microsoft/Edge/Application/msedge.exe` (without `(x86)`).

| Output of `--version` | Meaning | What to do |
|---|---|---|
| A version string (e.g. `Microsoft Edge 153.0.…`) | GUI spawning allowed | run the harness |
| Empty, instant exit | GUI spawning blocked by the sandbox | try `cmd.exe /c echo ok`; if `ok`, console spawn is alive and GUI is not — run from user Bash, or set `NODE_PATH=<scratchpad>` in the agent shell |

### Launch-error diagnostics

**`ENOENT` and `Code: 0` are different problems.** The first is about a path, the second about sandbox policy — do not mix them up.

| Symptom | Cause | What to do |
|---|---|---|
| `ENOENT … msedge.exe` | browser binary not found | `where msedge.exe`, fix `EDGE_PATH` |
| `Cannot find module 'puppeteer-core'` | wrong `NODE_PATH`, or package not installed | user Bash: `npm --prefix harness i`; agent shell: `NODE_PATH=C:/Users/user/.lmstudio/scratchpads/c/node_modules` (check with `ls`) |
| `Cannot find module '…check-city.js'` | started from the wrong folder (`harness/harness`) | check cwd — run from the repo root |
| `Failed to launch the browser process: Code: 0`, ~0.3 s | GUI spawn blocked by the agent sandbox | user Bash, or `NODE_PATH=<scratchpad>`; `EDGE_PATH` does **not** help here |
| `Timeout waiting for loader` | the game did not load | read `errs[]` in the JSON, check CDN access |
| `net::ERR_…` | Edge could not reach the Three.js CDN | check internet/proxy |

### Commands and flags

```bash
npm --prefix harness i                  # puppeteer-core only
node harness/check-city.js              # from the repo root
# NODE_PATH=<…>/node_modules node harness/check-city.js   # if require() can't resolve puppeteer-core
# EDGE_PATH=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe
# OUTDIR=%TEMP%\meridian-check          # screenshots never land in the repo
```

Browser flags: `--no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --disable-gpu-sandbox`.

### Output shape

stdout is one JSON blob, then one `PASS`/`FAIL` line per check, then `screenshots -> <OUTDIR>`. The blob is assembled at [`harness/check-city.js:293`](../../harness/check-city.js): `{ html, genMs, stats, spawn, sim, cam, cycle, shots, errs }`.

| Field | Contents |
| --- | --- |
| `html` | the page under test |
| `genMs` | wall time until the loader hid itself — check 2 gates this (`< 30000`) |
| `stats` | `calls`, `tris`, `geoms`, `meshesInScene`, `buildings`, `trees`. Measured from one **fixed** spawn viewpoint (`player.x = CELL*4 + CELL/2`, `z = -HALF + CELL*3`, `pitch 0.15`) because draw calls depend on frustum culling — see [docs/performance.md](../docs/performance.md) |
| `spawn` | lane and border state at t=0: `cars`, `GRID`, `HALF`, `ROAD`, `CELL`, `linesUsed`, `onBorderLine`, `outsideGroundNow`, `maxCrossAbs`, `maxLaneOffsetErr` (centre-to-centreline distance must be exactly `ROAD/4`) · fleet: `fleet` (by type name), `kinds` (by geometry builder), `longest` · instanced buffers: `wheelsWanted`, `wheelsCount`, `unwrittenWheels`, `unwrittenLenses` · `APRON` for the overhang bounds checks |
| `sim` | traffic audit — `steps`, `simMinutes`, `maxTravelAbs`, `maxCrossAbs`, `maxNoseAbs`, `maxSideAbs`, `wraps`, `offRoadSamples`, `stuckFraction`, `perpFrames`, `sameFrames`, `maxPen` (+ `maxPenEv`: time, both tags, penetration), `yieldSeconds`, `heldNoseMax`, `gridlockAt` |
| `cam` | camera `y` keyed by each tested pitch (`-1.35 … +1.2`) — the evidence for [camera.md](camera.md) |
| `cycle` | `{ night, day }`, each `{ emissive, moon, lamps }` at `dayTime = 0.83 / 0.42` |
| `shots` | specimen found per long-vehicle shot: `{ name, L, wheels }`; `null` when that kind is absent from the fleet |
| `errs` | page errors — must be empty (check 1) |

### Reference run (`verified@cf4c702` — 2026-09-19, 23/23 PASS, exit 0, wall time ≈24.6 s)

This is the **current** harness (`harness/check-city.js`, 23 checks). The working tree at `cf4c702` carried one comment-only delta in `setTrafficMult`; behaviour is unchanged from HEAD, so these numbers describe `cf4c702` itself.

```
genMs 7733 (SwiftShader; 1.5–3 s on a GPU)   calls 83   tris 119866   geoms 681
meshesInScene 765   buildings 337   trees 26   errs []
fleet {artbus:1, bus:14, semi:2, van:7, pickup:9, hatch:8, sedan:6, suv:5} = 52
spawn: linesUsed 1…9 · onBorderLine 0 · outsideGroundNow 0 · maxLaneOffsetErr 0
maxCrossAbs 236 · wheelsWanted/Count 218/218 · unwrittenWheels 0 · unwrittenLenses 0
sim (20k steps ≈ 16.7 min): maxTravelAbs 290 · maxCrossAbs 236 · maxNoseAbs 298.85 · maxSideAbs 237.38
       wraps 779 · offRoadSamples 0 · stuckFraction 0.0533 · perpFrames 0 · sameFrames 0 · maxPen 0
       yieldSeconds 14040 · heldNoseMax 0 · gridlockAt -1 · deadlockCars 0
cam: y = 0.35…7.68 over pitch −1.35…+1.2 (never under asphalt)
night: emissiveIntensity 1.7, moon visible, 6 lamps on   day: emission 0, no moon, 0 lamps
shots: semi L=16.4 w=8 · artbus L=17.5 w=6 · bus L=12 w=4
```

Draw-call and triangle counts are viewpoint-dependent (frustum culling): the reference numbers describe that fixed spawn-view measurement; looking downtown costs a few hundred calls.

#### Earlier reference (8-check harness, pre-split) — for orientation only

```
tools/check-city.js, exit 0, ~18.3 s, NODE_PATH=<LM Studio scratchpad>
genMs 1765 · day { calls 400, tris 42498, geoms 567, buildings 337 } · errs []
8/8 checks PASS · screenshots → D:\tmp\meridian-check
```

Do not compare with the 23-check reference: different check set, different measurement points, different harness code.

### The checks

| # | Check | Assertion | Contract |
| --- | --- | --- | --- |
| 1 | no page errors | `errs.length === 0` | [boot-sequence.md](boot-sequence.md) C-BOOT-3 |
| 2 | generation finished in time | `genMs < 30000` | [boot-sequence.md](boot-sequence.md) C-BOOT-1/2 |
| 3 | camera stays above the asphalt for every pitch | all `cam` values in `[0.3, 9]` | [camera.md](camera.md) C-CAM-2/3 |
| 4 | night: windows glow, moon visible, lamps pooled on | `emissive > 1 && moon && lamps >= 1` | day/night cycle |
| 5 | day: no emission, moon hidden, lamps off | `emissive < 0.05 && !moon && lamps === 0` | day/night cycle |
| 6 | cars spawn on interior road lines only | `spawn.onBorderLine === 0` | [world-constants.md](world-constants.md) C-WLD-1 · [traffic-lanes.md](traffic-lanes.md) C-LANE-2 |
| 7 | no car outside the ground plane at spawn | `spawn.outsideGroundNow === 0` | world-constants C-WLD-1 · traffic-lanes C-LANE-2 |
| 8 | every car sits in its lane (offset = `ROAD/4`) | `spawn.maxLaneOffsetErr < 1e-6` | [traffic-lanes.md](traffic-lanes.md) C-LANE-1 |
| 9 | traffic never leaves its lane over N min | `sim.offRoadSamples === 0` | traffic-lanes C-LANE-5 |
| 10 | cross-axis stays inside the map | `sim.maxCrossAbs <= HALF` | traffic-lanes C-LANE-5 |
| 11 | wrap happens at the ground border, not beyond it | `sim.maxTravelAbs <= HALF + 1e-6` | traffic-lanes C-LANE-4 |
| 12 | traffic keeps moving | `sim.stuckFraction < 0.2` | [right-of-way.md](right-of-way.md) C-ROW-5 |
| 13 | through traffic still wraps around the map | `sim.wraps > 0` | traffic-lanes C-LANE-4 |
| 14 | fleet contains bus + artbus + semi | each count `> 0` | traffic-lanes (fleet) |
| 15 | longest body is a real long vehicle | `spawn.longest >= 16` | traffic-lanes (fleet) |
| 16 | wheel buffer sized to the fleet | `wheelsWanted === wheelsCount && unwrittenWheels === 0` | traffic-lanes → Fleet & instanced buffers |
| 17 | lens buffers fully written | `unwrittenLenses === 0` | render-api / traffic-lanes (buffers) |
| 18 | wrapping overhang stays on the ground apron | `sim.maxNoseAbs <= HALF + APRON` | world-constants (`GROUND_APRON`) · C-WLD-4 |
| 19 | vehicle side stays inside the map | `sim.maxSideAbs <= HALF` | traffic-lanes C-LANE-5 |
| 20 | close-ups of all three long kinds captured | `shots.semi && shots.artbus && shots.bus` | regression visibility |
| 21 | no perpendicular bodies overlap over N min | `sim.perpFrames === 0` | right-of-way C-ROW-2/6 |
| 22 | no vehicle frozen for good | `deadlockCars === 0 && gridlockAt < 0` | right-of-way C-ROW-5 |
| 23 | a held vehicle stops before the box it was denied | `sim.heldNoseMax <= 0.6` | right-of-way C-ROW-6 |

### How the traffic audit works (and why it must stay this way)

The audit is a **pure simulation**: `updateCars(0.05)` in a loop with no rendering — 20k steps after 5k warm-up ≈ 12 s of wall time, ~16.7 simulated minutes. It measures:

- **(a)** lane integrity — the cross-axis coordinate must not change; both axes inside `±HALF`;
- **(b)** body overlaps via `penOf()` — instances whose *axis difference* differs are counted separately, those are "collision at a crossing";
- **(c)** standstills: standing longer than 25 s = `deadlockCars`, first moment with ≥3 simultaneous = `gridlockAt`;
- **(d)** whether a vehicle holding at `xGo=false` crept inside the denied square (`heldNoseMax`).

**The audit must run alongside `updatePeds`.** A crowd frozen statue-like during the run reads as a phantom collapse and has already produced one false alarm.

### Screenshot set

`player-view`, `west-border-road`, `topdown-west-edge`, `night`, `long-semi`, `long-artbus`, `long-bus`, `minimap` → `%TEMP%\meridian-check\`. To shoot a specific frame, freeze the loop (`animate=()=>{}`) and call `renderer.render(scene,camera)` yourself — otherwise rAF overwrites the camera.

### Maintenance notes

- The harness was rebuilt during the traffic fix (it had been missing from the tree). Keep it in the repo — it is the only executable spec this project has.
- Globals of the classic `<script>` are reachable from `page.evaluate()` by name: `scene`, `renderer`, `camera`, `player`, `dayTime`, `glassMat`, `lampLightPool`, `buildings`, `moonMesh`. Cheap diagnostics and time-travel (`dayTime = 0.83`) without touching game code.
- Agent shell (LM Studio): GUI spawn is allowed only for `node_modules` loaded from the scratchpad — see *Where it can actually run*.


## Open questions

Unresolved items awaiting a decision — not invariants, not accepted limitations (those live in
[docs/limitations.md](../docs/limitations.md)). The owner list is in [handsoff.md](../handsoff.md);
the detail lives only here.

### flat window surface vs. explicit namespace

`game/gta.html` runs as an ES module, so its top-level bindings are private to the module. The
harness reaches them through a trailing block of `Object.assign(window, {…})` /
`Object.defineProperties(window, {…})` calls — roughly 20 names (`cars`, `player`, `buildings`,
`updateCars`, `dayTime`, `renderer` as an accessor, …). When that list grows past a comfortable
size, promote it to a single `window.MERIDIAN = {game, world, helpers, …}` namespace and update
[check-city.js](../../harness/check-city.js) to match, in one commit. There is no other consumer
of the flat names today, so the change is mechanical — a rename, not a refactor.

Decide when the list actually becomes awkward. Until then the flat names are the contract: any
new state that check-city.js needs must be added to that trailing block or it dies with
`ReferenceError`.
