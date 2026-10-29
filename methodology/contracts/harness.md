# Contract: the acceptance harness

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Everything under *Rationale* — environment troubleshooting, output shape, reference numbers, the check table — is read only when a check fails, when editing the harness, or when changing behaviour it gates.

`harness/check-city.js` loads `game/gta.html` (resolved relative to its own directory, so it works from any cwd) in headless Edge, waits for the loader to hide, collects page errors, then asserts **26 checks** and prints one JSON blob plus PASS/FAIL lines. It is the only executable spec this project has — keep it in the repo.

## Rules — read always

> **Amendment 2026-09-26.** Checks 5, 16 and 17 were re-worded to match
> the current code; the assertions themselves are unchanged.
>
> - **Check 5** (`day: lamps off`): the streetlight pool keeps `visible = true`
>   by design (`gta.html` `buildStreetlights()`) so that toggling a light never
>   rebuilds the shader programs. "Off" now means `intensity === 0`, and the
>   harness counts lamps with `intensity > 0.01` instead of `visible`.
> - **Checks 16 and 17** (`wheel buffer`, `lens buffers`): `CAR_COUNT_BASE` /
>   `CAR_COUNT_MAX` (C-LANE-6) split the park into "created 130" and "active 52".
>   Inactive cars get `makeScale(0,0,0)` in `writeCarInstances()`, which reads
>   as "unwritten" under the old formula. The harness now counts only the
>   active cars' slots — the instanced buffer itself is still sized to the
>   whole park (`wheelsWanted === wheelsCount === 646`).

> **Re-measured 2026-09-26.** Previous DRIFT NOTICE numbers were from `cf4c702`;
> this run reflects the assets split, `GROUND_APRON = 60`, the new building and
> park generators, and the density-based traffic multiplier (C-LANE-6).

> **Amendment 2026-10-27.** Check 23 re-scoped with C-ROW-6 ([right-of-way.md](right-of-way.md)): `heldNoseMax` now measures vehicles that crossed the box face *while denied* and how deep they came to rest; legally-committed waits inside are excluded by construction. Threshold moved from 0.6 m to the physics bound **9.6 m** (braking distance at max car-class cruise + one frame of travel). This is an amendment, not a relaxation — pre-fix the metric could only fire for approaching cars anyway, since in-box cars got blanket `xGo = true`.

> **Amendment 2026-10-29.** Check 26 added — a max-density traffic audit that re-runs checks 21–23's invariants with every car active (mult 2.5, C-LANE-6), the load where RC2's T-bones and gridlock reproduced before `ffa1ba2` (perpFrames 195, deadlockCars 2). Its liveness gate is `frozenAtEnd === 0` — nobody still stopped > FROZEN_S at the last step — not "no standstill ever": a 4000 s mult-2.5 diagnostic shows congestion legitimately holds a car up to ~30 s (max 29.6 s, all episodes resolved), so an anywhere-in-run assert flakes on ~a quarter of runs; a truly deadlocked car is still stopped at the last step. `heldNoseMax` and `deadlockCars` are informational there — C-ROW-6's bound stays enforced where the metric is clean (check 23).


- **Run:** `npm --prefix harness i` (puppeteer-core only), then `node harness/check-city.js` from the repo root.
- **Exit codes:** `0` all green · `1` a check failed · `2` the harness itself crashed. Reference run: 26/26 PASS, exit 0, wall time ≈61 s under SwiftShader (generation alone ≈12.8 s; genMs is machine-bound).
- **Screenshots never land in the repo** — `OUTDIR=%TEMP%\meridian-check\`. Hero review shots use a different rig and go to `%TEMP%\meridian-char\`.
- **The traffic audit is a pure simulation:** `updateCars(0.05)` in a loop with no rendering, 20k steps after 5k warm-up (~12 s wall, ~16.7 simulated minutes), and it must run alongside `updatePeds` — a crowd frozen during the run reads as a phantom collapse and has already produced one false alarm.
- **Harness versions are not comparable:** `tools/check-city.js` (pre-split, 8 checks) and `harness/check-city.js` (26 checks) are different programs with different measurement points. Always state which version a number came from.
- **Thresholds are contracts:** amend them with a reason ([README.md](README.md)), never silently relax; the seeded RNG is contractual, so reference numbers move whenever generation order changes.
- **Console noise that is normal:** 4× Edge *"Tracking Prevention blocked access to storage for …unpkg.com/three@0.160…"*; FPS ≈8 under SwiftShader at 1280×760 with shadows (player speed stays correct because `dt` is clamped to 0.05 s).

## Rationale & examples — read only when editing that rule

### Where it can actually run

- **User Git Bash** — the main path, works always. Verified at `cf4c702` (2026-09-19): 24/24 PASS, exit 0.
- **LM Studio agent shell** — works **only** if `puppeteer-core` sits in the **LM Studio scratchpad**, not in the project. The agent sandbox may allow spawning GUI processes loaded from the scratchpad but not from arbitrary paths.

| `NODE_PATH` | Result | Verified on |
|---|---|---|
| `C:/Users/user/.lmstudio/scratchpads/c/node_modules` | ✅ works | old 8-check `tools/check-city.js`, exit 0, ~18 s |
| `<project>/harness/node_modules` | ❌ `Code: 0`, ~0.3 s | current `harness/check-city.js` |

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

stdout is one JSON blob, then one `PASS`/`FAIL` line per check, then `screenshots -> <OUTDIR>`. The blob is assembled at [`harness/check-city.js:615`](../../harness/check-city.js): `{ html, genMs, stats, spawn, sim, simMax, cam, cycle, shots, lobby, errs }`.

| Field | Contents |
| --- | --- |
| `html` | the page under test |
| `genMs` | wall time until the loader hid itself — check 2 gates this (`< 30000`) |
| `stats` | `calls`, `tris`, `geoms`, `meshesInScene`, `buildings`, `trees`. Measured from one **fixed** spawn viewpoint (`player.x = CELL*4 + CELL/2`, `z = -HALF + CELL*3`, `pitch 0.15`) because draw calls depend on frustum culling — see [docs/performance.md](../docs/performance.md) |
| `spawn` | lane and border state at t=0: `cars`, `GRID`, `HALF`, `ROAD`, `CELL`, `linesUsed`, `onBorderLine`, `outsideGroundNow`, `maxCrossAbs`, `maxLaneOffsetErr` (centre-to-centreline distance must be exactly `ROAD/4`) · fleet: `fleet` (by type name), `kinds` (by geometry builder), `longest` · instanced buffers: `wheelsWanted`, `wheelsCount`, `unwrittenWheels`, `unwrittenLenses` · `APRON` for the overhang bounds checks |
| `sim` | traffic audit — `steps`, `simMinutes`, `maxTravelAbs`, `maxCrossAbs`, `maxNoseAbs`, `maxSideAbs`, `wraps`, `offRoadSamples`, `stuckFraction`, `perpFrames`, `sameFrames`, `maxPen` (+ `maxPenEv`: time, both tags, penetration), `yieldSeconds`, `heldNoseMax`, `gridlockAt` |
| `simMax` | check 26's max-density audit (mult 2.5, all cars active) — `activeCount`, `perpFrames`, `sameFrames`, `maxPen` (+ `maxPenEv`), `heldNoseMax` (info), `gridlockAt`, `deadlockCars` (info), `frozenAtEnd`, `offRoadSamples`, `wraps`, `stuckFraction` |
| `cam` | camera `y` keyed by each tested pitch (`-1.35 … +1.2`) — the evidence for [camera.md](camera.md) |
| `cycle` | `{ night, day }`, each `{ emissive, moon, lamps }` at `dayTime = 0.83 / 0.42` |
| `shots` | specimen found per long-vehicle shot: `{ name, L, wheels }`; `null` when that kind is absent from the fleet |
| `lobby` | check 25 sweep over the walk-in lobbies: `lobbies`, `orphanSlabs`, `poses`, `pulledIn`, `wallHits`, `slabHits`, `minCeilClearance`, `firstHit` — evidence for [camera.md](camera.md) C-CAM-6 |
| `errs` | page errors — must be empty (check 1) |

### Reference run (verified@HEAD 2026-10-27)

This is the **current** harness (`harness/check-city.js`, 26 checks). These numbers describe the tree with RC2 applied to `assets/traffic-ai.js` — in-box priority enforced through holds and the clearance tail test (see [right-of-way.md](right-of-way.md), C-ROW-1/4/6 amendments) — plus the crossing-event form of `heldNoseMax`, check 23's braking-distance threshold, and check 26's max-density audit.

```
verified@HEAD 2026-10-29 (26/26 PASS, exit 0, wall ≈ 61 s under SwiftShader)

genMs 12833   calls 170   tris 668180   geoms 1053
meshesInScene 1222   buildings 318   trees 37   errs []
fleet {pickup:18, sedan:16, bus:22, semi:26, hatch:17, artbus:9, suv:12, van:10} = 130 (whole park)
kinds {car:73, bus:31, semi:26} = 130   artic 9   longest 17.5
spawn: linesUsed 1…9 · onBorderLine 0 · outsideGroundNow 0 · maxLaneOffsetErr 0
maxCrossAbs 236 · wheelsWanted/Count 642/642 · unwrittenWheels 0 · unwrittenLenses 0
maxNoseAbs 279.65 · maxSideAbs 237.38 · APRON 60
sim (20k steps ≈ 16.7 min): maxTravelAbs 290 · maxCrossAbs 236 · maxNoseAbs 298.85 · maxSideAbs 237.38
       wraps 773 · offRoadSamples 0 · stuckFraction 0.0163 · perpFrames 0 · sameFrames 65918
       maxPen 2.75 (bus#13 vs semi#105, t=0) · yieldSeconds 5590 · heldNoseMax 6.86
       gridlockAt -1 · deadlockCars 0
simMax (mult 2.5, all 130 cars active): perpFrames 0 · sameFrames 0 · maxPen 0 · offRoadSamples 0
       wraps 1476 · stuckFraction 0.1252 · heldNoseMax 32.64 m (info) · gridlockAt -1
       deadlockCars 1 (info) · frozenAtEnd 0
cam: y = 0.35…7.68 over pitch −1.35…+1.2 (never under asphalt)
night: emissiveIntensity 1.7, moon visible, 6 lamps on   day: emission 0, no moon, 0 lamps
shots: semi L=16.4 w=8 · artbus L=17.5 w=6 · bus L=12 w=4
check24 (setTrafficMult round-trip): same-axis overlaps 0 / 0 · maxPen 0
check25 (lobby camera safety): 62 lobbies, 9920 poses, pulled in 5307, hits 0, minCeilClearance 3.05
```

Draw-call and triangle counts are viewpoint-dependent (frustum culling) and drift a few percent between runs under SwiftShader; `meshesInScene`, `buildings` and `trees` are stable. The sim's initial state depends on how many real-time frames elapse before the audit starts, so `wraps`, `stuckFraction`, `yieldSeconds` and `heldNoseMax` move run to run (observed: wraps 766–779, stuckFraction 0.0156–0.0163, heldNoseMax 4.46–6.86 m — always under the 9.6 m bound); `perpFrames`, `deadlockCars`, `gridlockAt` and `maxPen ≈ 2.75` are stable across runs (the pair achieving it varies). `simMax` metrics share the same run-to-run variance as `sim` (its initial state is the tail of the default-density audit); its hard gates (`perpFrames`, `gridlockAt`, `offRoadSamples`, `frozenAtEnd`) are robust, while `heldNoseMax` and `deadlockCars` there are informational. `genMs` is machine-bound — it moves with the box, not the tree.

#### Earlier reference (8-check harness, pre-split) — for orientation only

```
tools/check-city.js, exit 0, ~18.3 s, NODE_PATH=<LM Studio scratchpad>
genMs 1765 · day { calls 400, tris 42498, geoms 567, buildings 337 } · errs []
8/8 checks PASS · screenshots → D:\tmp\meridian-check
```

Do not compare with the current reference: different check set, different measurement points, different harness code.

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
| 23 | a denied vehicle rests no deeper than its braking distance allows | `sim.heldNoseMax <= 9.6` | right-of-way C-ROW-6 (amended 2026-10-27) |
| 24 | reseat after a multiplier raise leaves no overlap, same- or cross-axis | `reseat.atMax.same === 0 && reseat.atMax.cross === 0 && reseat.backTo1.same === 0 && reseat.backTo1.cross === 0` | [traffic-lanes.md](traffic-lanes.md) C-LANE-6 |
| 25 | lobby camera safety: no wall/slab between camera and player | `lobby.wallHits === 0 && lobby.slabHits === 0`, `orphanSlabs === 0`, `minCeilClearance > 1.7` | [camera.md](camera.md) C-CAM-6 · [building-interiors.md](building-interiors.md) C-INT-2/5 |
| 26 | max-density audit: no T-bones, gridlock, off-road or car still frozen at run end (mult 2.5) | `simMax.perpFrames === 0 && simMax.gridlockAt < 0 && simMax.offRoadSamples === 0 && simMax.frozenAtEnd === 0` | [right-of-way.md](right-of-way.md) C-ROW-5/6 · [traffic-lanes.md](traffic-lanes.md) C-LANE-6 |

### How the traffic audit works (and why it must stay this way)

The audit is a **pure simulation**: `updateCars(0.05)` in a loop with no rendering — 20k steps after 5k warm-up ≈ 12 s of wall time, ~16.7 simulated minutes. It measures:

- **(a)** lane integrity — the cross-axis coordinate must not change; both axes inside `±HALF`;
- **(b)** body overlaps via `penOf()` — instances whose *axis difference* differs are counted separately, those are "collision at a crossing";
- **(c)** standstills: standing longer than 25 s = `deadlockCars`, first moment with ≥3 simultaneous = `gridlockAt`;
- **(d)** how deep a vehicle that crossed the box face *while denied* came to rest (`heldNoseMax`) — legally-committed waits inside are excluded by construction (see [right-of-way.md](right-of-way.md) C-ROW-6).

**Check 26 re-runs this same audit with every car active.** `trafficAI.setTrafficMult(2.5)` activates all 130 cars (C-LANE-6) — the load where RC2's T-bones and gridlock reproduced before `ffa1ba2` — then the identical warm-up + step loop runs, and the multiplier is restored afterwards. The hard gates are checks 21–23's invariants plus liveness: `perpFrames === 0`, `gridlockAt < 0`, `offRoadSamples === 0`, `frozenAtEnd === 0`. Liveness is deliberately *not* "no standstill > FROZEN_S anywhere in the run" (`deadlockCars`): under max-density congestion a car legitimately waits up to ~30 s behind a queue (measured over a 4000 s mult-2.5 diagnostic: 276 standstills ≥10 s, all resolved, max 29.6 s), so that assert flakes on ~a quarter of runs; a truly deadlocked car is still stopped at the last step — which `frozenAtEnd` catches with certainty while flaking at ≈0.2 % per run (Poisson estimate from the measured episode rate). `heldNoseMax` and `deadlockCars` stay in the output as info metrics; C-ROW-6's braking bound stays enforced where the metric is clean (check 23).

**The audit must run alongside `updatePeds`.** A crowd frozen statue-like during the run reads as a phantom collapse and has already produced one false alarm.

### Screenshot set

`player-view`, `west-border-road`, `topdown-west-edge`, `night`, `long-semi`, `long-artbus`, `long-bus`, `minimap` → `%TEMP%\meridian-check\`. To shoot a specific frame, freeze the loop (`animate=()=>{}`) and call `renderer.render(scene,camera)` yourself — otherwise rAF overwrites the camera.

### Maintenance notes

- The harness was rebuilt during the traffic fix (it had been missing from the tree). Keep it in the repo — it is the only executable spec this project has.
- The module's bindings reach `page.evaluate()` through a single `window.MERIDIAN`
  namespace — `MERIDIAN.scene`, `MERIDIAN.player`, `MERIDIAN.dayTime`,
  `MERIDIAN.glassMat`, `MERIDIAN.lampLightPool`, `MERIDIAN.buildings`,
  `MERIDIAN.moonMesh`, … See `game/gta.html` § "surface for the harness".
  Cheap diagnostics and time-travel (`MERIDIAN.dayTime = 0.83`) without touching
  game code.
- Agent shell (LM Studio): GUI spawn is allowed only for `node_modules` loaded from the scratchpad — see *Where it can actually run*.


