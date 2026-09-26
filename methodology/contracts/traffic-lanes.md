# Contract: lanes, spawn & wrap-around

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

## Rules — read always

- **C-LANE-1** Every vehicle sits at `laneCentre ± ROAD/4`, exactly: harness asserts `spawn.maxLaneOffsetErr < 1e-6`.
- **C-LANE-2** Spawn only on interior road lines — `lineIdx = 1 + floor(rng()*(GRID-1))`; lines `0` and `GRID` are the ground-plane border (`±290`). Harness: `spawn.onBorderLine === 0`, `spawn.outsideGroundNow === 0`.
- **C-LANE-3** Anti-overlap at spawn is positional, not random: `wrapGap()` keeps a nose-to-tail gap using `TRACK = CAR_LIMIT*2` — that equality must hold or `gapAhead()` lies about lane distances.
- **C-LANE-4** Vehicles wrap at `CAR_LIMIT = HALF = 290`, never beyond (`sim.maxTravelAbs ≤ HALF + 1e-6`); a long body's nose overhang stays on the dirt apron (`sim.maxNoseAbs ≤ HALF + APRON`).
- **C-LANE-5** Cross-axis containment: `sim.maxCrossAbs ≤ HALF` and `sim.maxSideAbs ≤ HALF` for the whole audit, plus `sim.offRoadSamples === 0` — nobody wanders into a building or off the plane.
- **C-LANE-6** *(amended 2026-09-25)* The traffic multiplier scales the **active fleet size**, not time. `buildCars()` creates `CAR_COUNT_MAX = 130` vehicles; `MeridianTrafficAI.setTrafficMult(m)` marks the first `round(CAR_COUNT_BASE × m)` as `active` and hides the rest under the ground plane (`mesh.position.y = -1000`). Inactive cars are skipped by every loop that consumes the fleet — `updateCars`, `leaderAhead`, `bodyGap`, `bodyGapBehind`, `arbitrateCrossings`, `unstickCars`, `writeCarInstances`, `updateHeadlights`, `resolveCars`. Time in `animate()` is always real: `updateCars(dt)`. **Amendment reason:** the earlier rule (multiplier = time scale) was rejected at review — ×0.5 read as slow-motion, not as an empty street, which contradicted the HUD label. Reference fleet counts in [harness.md](harness.md) must be **re-measured** after this change: the ×1.0 state is now 52 active of 130 potential, and `spawn.fleet` enumerates the active set only.
- **Fleet/buffers** Instanced buffers are sized from the actual park, never hardcoded: `wheelsWanted === wheelsCount`, `unwrittenWheels === 0`, `unwrittenLenses === 0`.

Verify: harness checks 6–19 (spawn lines, lane offsets, buffers, containment) and the long-vehicle close-ups — `shots.semi / artbus / bus` must all be captured; a buffer bug on the articulated bus is invisible in a sedan screenshot.

## Rationale & examples — read only when editing that rule

### C-LANE-1 — Lane offset is exactly `ROAD/4`

Any drift in the lane maths fails the harness assertion immediately, which is why the tolerance is `1e-6` and not "about".

### C-LANE-2 — Spawn only on interior road lines

Lines `0` and `GRID` lie exactly on the ground-plane border; anything spawned there is born above the void. Same rule applies to pedestrians — see [world-constants.md](world-constants.md) C-WLD-1/C-WLD-2.

### C-LANE-3 — Anti-overlap at spawn is positional, not random

`TRACK = CAR_LIMIT*2` is the wrap period used by `gapAhead()`. If it stops matching, distances reported for cars ahead are wrong and vehicles brake for nothing (or not at all).

### C-LANE-4 — Wrap happens at the ground border, never beyond it

The earlier value `HALF+6` let a car drive 6 m past the last pixel of asphalt before teleporting. Wrap-around itself is intended: it reads as "entering the city from the cross street". There is no fade yet, so vehicles pop in/out at the edge (accepted limitation).

### C-LANE-5 — Cross-axis containment

Combined with `sim.offRoadSamples === 0`, this is what proves nobody wandered into a building or off the plane over the whole audit run.

### C-LANE-6 — The traffic multiplier scales the active fleet, not time

`setTrafficMult(m)` clamps to `[0, 2.5]` and snaps to `Math.round(m*20)/20`, i.e. **0.05** steps — the native slider `step="5"` on a `min=0 max=250` range is exactly that, because the slider reports *percent of the multiplier* (`value = round(trafficMult*100)`, so full track = ×2.5). Keys `-` / `=` move by **0.25**, `0` resets to ×1.

- The slider must stop propagating `pointerdown / mousedown / click / dblclick`, otherwise the global click handler yanks the cursor back into pointer lock — see [boot-sequence.md](boot-sequence.md) C-BOOT-5.
- Consequently it only works with a free cursor (after Esc); under capture, keys are the only controls.
- At ×0 the fleet must be genuinely frozen: total displacement 0 m over 0.7 s — the assertion to re-run if anyone touches `updateCars` early-out logic.

Verified headless rather than as a standing harness check: after Enter + `exitPointerLock()`, clicking the track at 20 % lands on ×0.45, dragging gives ×1.10, setting ×0 produces zero movement. Re-check with `page.evaluate()` — `trafficMult` is a classic-script global.

### Fleet & instanced buffers

Wheel entries are `[x, z, radius, widthScale]`; `widthScale = 1.75` merges twin road wheels on the semi's bogie/trailer into one wide instance. Counts come from the **actual fleet**, never hardcoded:

```
wheelsWanted = Σ vehicleWheels(t).length over every vehicle in the park
             = wheelsCount            // instances actually written (harness check 16)
unwrittenLenses === 0   // harness check 17
```

Reference fleet (52 vehicles, weights-driven so composition shifts with the seed): `{artbus:1, bus:14, semi:2, van:7, pickup:9, hatch:8, sedan:6, suv:5}`. Longest body ≥ 16 m (`artbus L=17.5`, `semi L=16.4`, `bus L=12`).

`kind` drives the driving profile from `DRIVE`: `car cruise [7,14]`, `bus [6.5,10.5]`, `semi [6,9]` m/s with matching accel/decel — a semi never out-accelerates a sedan.

### Geometry budget (why it's one mesh per body)

Body = 1 merged mesh per vehicle; wheels and headlight/lens pairs live in shared `InstancedMesh`es across the whole park: **52 bodies + 4 instanced meshes instead of ~90 boxes**. Buildings follow the same discipline — a shell with vertex colours plus one glazing mesh shared by a 2×2 block cluster (≈12 meshes → 2). Break this and draw calls explode to ~4000, which presents exactly like a hang.
