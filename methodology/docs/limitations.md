# Known limitations — MERIDIAN CITY

What the sandbox deliberately does **not** do, why, and what it would actually cost to fix.
Each item is stated once here; other docs link in rather than repeating the list.

- Public-facing short list: [`README.md`](../../README.md) → "Known limitations". Keep it a summary of this file.
- Performance internals (budgets, throttling, shadow setup): [performance.md](performance.md).
- Rules that are *enforced* rather than merely noted — i.e. things the harness fails on — live in
  [`../contracts/`](../contracts/), not here.
- Items still waiting on a decision or a measurement are **open questions**, not limitations: index in
  [`../handsoff.md`](../handsoff.md), detail under *Open questions* in the owning contract. Nothing enters this file until
  someone has decided not to fix it.

## Lighting

**Only 6 streetlights illuminate.** There are **121** lamp poles (one `InstancedMesh`), but a pool of exactly
**6** `PointLight`s is re-bound to the nearest poles by `updateLights()` each time it runs. Distant poles are
therefore geometry without glow, and at night they read as silhouettes.

*Compensated by:* emissive window glass (`glassMat.emissiveIntensity` rises after dusk), so lit interiors carry
the mood the lamps cannot.

*Cost to fix:* more `PointLight`s is a linear per-light cost in the fragment shader on every material — under
SwiftShader that is the fastest way to lose the frame budget. The cheaper routes are a fake (bake glow into the
pole texture and fade it with `dayTime`) or one projected light with a mask.

## Level of detail

**No LOD, no distance culling.** Every building, tree, pole and vehicle is resident in the scene for the whole
session; ~337 buildings, 121 poles, 52 vehicles, 54 pedestrians. The only thing that drops work is Three.js
frustum culling, which is why draw calls are viewpoint-dependent (see [performance.md](performance.md)).

*Cost to fix:* real LOD needs per-block meshes that can be swapped, which conflicts with the current design of
one merged shell mesh + one glass mesh per building — the merge is what keeps the draw-call budget alive.

## Traffic model

**Vehicles hold their lane and their distance; they never turn.** Lane keeping is `leaderAhead` +
`approachLimit`, crossing etiquette is [`../contracts/right-of-way.md`](../contracts/right-of-way.md). A turn at
a crossing would mean rebuilding the trajectory, which the model does not have: a vehicle commits to one axis at
spawn and travels it until it wraps.

**Pedestrians pace their own sidewalk lane and never cross between quarters.** They re-aim (`p.dir`) rather than
path-find; there is no walk-target graph.

*Cost to fix:* turning requires per-segment routes plus a crossing model that can hand a vehicle from one axis
to another mid-block — that breaks the invariant that a car's perpendicular coordinate never leaves its line, so
several harness checks would need rethinking, not just relaxing (see [`../contracts/README.md`](../contracts/README.md)
on amending rather than relaxing).

## Map edges

**Outer road lines `0` and `GRID` sit exactly on the ground-plane border (`±290`).** The asphalt texture is
painted only inside `±290`, so standing on an outer line shows a break in the pavement. This is *accepted*, not
overlooked: [`../contracts/world-constants.md`](../contracts/world-constants.md) records it as a known deviation.

The ground plane itself was already widened — `GROUND_APRON = 60` makes it **700×700** with the UVs
squeezed inward, so traffic that travels out to `±(HALF+APRON) = ±350` stands on dirt rather than over void. That
is what harness check 18 asserts (`sim.maxNoseAbs ≤ HALF + APRON`).

*Cost of going further (asphalt out by `ROAD/2`):* four coupled edits — `CAR_LIMIT`, `TRACK` (which is
`CAR_LIMIT*2`), the minimap mapping, and the ground UVs. They must move together or lane maths and the overlay
drift apart; that coupling is documented in [`../contracts/traffic-lanes.md`](../contracts/traffic-lanes.md).

**Vehicles pop in and out at the map edge on wrap-around.** No fade, no despawn animation — it reads as "drove
out of town", which is arguably honest, but it is a hard cut.

## Frame-loop work

**The HUD writes DOM every frame**, and `isRoad()` is declared but never called. Both are tracked as open
performance work in [performance.md](performance.md) rather than duplicated here.

## What the sandbox simply isn't

**No save state** — position, `dayTime` and traffic state reset on reload; the seeded RNG means you get the same
*city* back, not the same *moment*. **No audio.** **No boardable vehicles** — traffic is simulation, not gameplay.
There are no quests, targets or failure states: it is a sandbox to look at and walk through.

## Not limitations

- **≈8 FPS under headless SwiftShader at 1280×760 with shadows** is expected, not a regression signal — see
  [performance.md](performance.md) and [`../contracts/harness.md`](../contracts/harness.md). Player speed stays
  correct because `dt` is clamped to 0.05 s.
- **A different city after changing the seed or adding an `rng()` call** is determinism working as designed — see
  [architecture.md](architecture.md) → "Determinism".

## If this gets picked up

Ordered by cost, cheapest first, using the costs above:

1. Throttle the HUD to every 4th frame (matches the minimap/lights cadence); delete or use `isRoad()`.
2. Fake lamp glow via texture + `dayTime` fade instead of more `PointLight`s.
3. Fade vehicles at wrap-around.
4. Extend asphalt past `±290` — the only item that requires a coordinated multi-file edit; budget for re-running
   [`../contracts/harness.md`](../contracts/harness.md) afterwards, since reference counters move with it.
