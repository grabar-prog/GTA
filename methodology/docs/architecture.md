# Architecture map — `game/gta.html`

Line numbers are verified against the current file (**2018 lines / 112,881 bytes**). Re-derive them with
`grep -nE '^(async )?function [A-Za-z_$]+' game/gta.html` after any large splice; do not trust this table blindly.

## Document layout

| Lines | Section |
| --- | --- |
| 1–9 | `<!DOCTYPE html>`, meta, Google Fonts preconnect (`Anton`, `Rajdhani`) |
| 10–99 | `<style>` — HUD panels, loader, start screen, CSS variables (`--red` etc.) |
| 102–126 | `#hud` overlay: brand, clock/phase, controls, traffic slider, minimap wrapper (z-index 10) |
| 128–136 | `#start` screen with the "enter" button (z-index 50) |
| 137–143 | `#loader` progress bar (z-index 80 — must stay above `#start`) |
| 144 | Three.js **r128** from cdnjs |
| 145 | unpkg fallback (`window.THREE \|\| document.write(...)`) |
| 146–2016 | the entire game, one `<script>` block |
| 2017–2018 | `</body></html>` |

## Script block, by responsibility

### Determinism & geometry helpers (150–250)

| Line | Symbol | Notes |
| --- | --- | --- |
| 150 | `const THREE = window.THREE` | single binding to the global |
| 159 | `mulberry32(a)` | seeded PRNG; seed at line **160** (`20240607`) |
| 162 | `pick(arr)` | RNG array picker (was missing once — caused a crash) |
| 169 | `mergeGeometries(parts)` | hand-rolled merge, keeps per-part colour |
| 213–231 | `boxAt` `taperBox` `cylX/Z/Y` `sphAt` `capY/X/Z` `ebox` | positioned-primitive factories; every one bakes its own `translate()` |
| 248 | `angLerp(a,b,k)` | yaw interpolation that wraps correctly |

### World constants (234–243) → [contracts/world-constants.md](../contracts/world-constants.md)

`GRID=10, CELL=58, ROAD=16, SIDEWALK=3.5` · `WORLD/HALF` · `GROUND_APRON` · `DAY_LEN=170` · `WALK/SPRINT` · `PLAYER_R`.
Later ones live near their users: `PED_LIMIT` (771), `CAR_LIMIT`/`TRACK` (1579–1580), crossing constants (1628–1635).

### Determinism

`mulberry32` (159) seeds a single `rng` stream at line **160** (`20240607`); `rand()` and `pick(arr)` draw from it.
`rng` is consumed strictly in generation order, so the city is identical on every load — and any edit that adds or
removes an `rng()` call reshapes everything downstream. That is expected behaviour, not a bug; changing the seed in
line 160 yields a new layout. Because composition shifts with the seed, reference counters in
[contracts/harness.md](../contracts/harness.md) (building count, fleet mix) move with it.

### Renderer & textures (252–330)

| Line | Symbol |
| --- | --- |
| 252 | `initRenderer()` — WebGL context, scene, camera, fog, sun/moon/hemi, shadow setup, encoding |
| 287 | `makeFacadeTexture()` |
| 299 | `makeWindowEmissive()` |
| 309 | `makeGroundTexture()` — procedural asphalt/dirt, incl. the accepted ±290 deviation |
| 325 | shared materials & palettes: `solidMat` (vertex colours), `glassMat` (`emissiveMap` = lit windows), `CAR_COLORS`, `PED_COLORS` — index these by `.length`, never by the array itself ([contracts/render-api.md](../contracts/render-api.md) C-API-5) |

### City generation (334–510) → [contracts/world-constants.md](../contracts/world-constants.md)

| Line | Symbol |
| --- | --- |
| 334 | `isRoad(x,z)` |
| 337 | `buildGround()` |
| 354 | `addBuilding(cx,cz,w,d,h)` |
| 394 | `buildCity()` — 2×2 block clusters, plaza lots, park at `i===4 && j===5` |
| 415 | `buildPark(cx,cz)` |
| 428 | `buildTrees()` / `addTree` (427) |
| 445 | `buildStreetlights()` — one `InstancedMesh` of **121** poles + a pool of only **6** `PointLight`s bound to the nearest ones |

Scale reference for that section: ~337 buildings (some lots deliberately skipped as plazas), exactly one park at `i===4 && j===5`, 121 lamp poles, 52 vehicles, 54 pedestrians.

### Vehicles (475–770) → [contracts/traffic-lanes.md](../contracts/traffic-lanes.md)

| Line | Symbol |
| --- | --- |
| 480 / 490 / 498 / 502–503 | `CAR_TYPES` `BUS_TYPES` `TRUCK_TYPES` → `VEH_TYPES`, `VEH_W` |
| 506 | `DRIVE` — cruise/accel/decel per class |
| 504 | `pickVehicleType()` — weighted RNG draw |
| 526 / 557 / 565 / 615 / 657 | `makeCarGeometry` `makeVehicleGeometry` `makeBusGeometry` `makeSemiGeometry` `makeWheelGeometry` |
| 665 | `lightLayout(t)` |
| 678–692 | `wrapGap` `inBox` `clearOfBox` — lane maths helpers |
| 692 | `buildCars()` — fleet spawn, instanced meshes, wheel buffer sizing |
| 758 | `vehicleWheels(t)` — `[x,z,radius,widthScale]` tuples |

### Pedestrians & hero (765–1240) → [contracts/character-anatomy.md](../contracts/character-anatomy.md)

| Line | Symbol |
| --- | --- |
| 765–771 | `PED_COLORS` `PED_SKIN` `PED_RIG` `PED_LIMIT` |
| 773 | `buildPeds()` |
| 845–857 | skin/clothing hex constants, `CHAR` animation state |
| 869 | `faceCanvas(blink)` — procedural face texture |
| 981 | `buildCharacter()` — hero rig on own pivots, no baked `translate` in limbs |

### Sky & day cycle (1241–1300)

`buildSky()` (1241), `SKY` palette table (1271), `updateCycle(dt)` (1274).

### Input & camera → [contracts/camera.md](../contracts/camera.md)

| Line | Symbol |
| --- | --- |
| 1310–1318 | `keys` / `locked`, `keydown` `keyup` handlers (`-` `=` `0` traffic scale) |
| 1327 | `setTrafficMult(m)` |
| 1341 | `mousemove` — yaw from `-movementX`, pitch from `+movementY`, clamp ±1.35 |
| 1346 | `collide(px,pz,r)` — exact-AABB static collision |
| 1354 / 1375 | `resolveCars` `resolvePeds` |

### Player & animation (1400–1650)

`animateCharacter(dt,speed,sprint)` (1400), `updatePlayer(dt,t)` (1530).

### Traffic simulation → [contracts/right-of-way.md](../contracts/right-of-way.md)

| Line | Symbol |
| --- | --- |
| 1650 / 1656 / 1672 / 1688 | `leaderAhead` `pathGap` `bodyGap(perpOnly)` `bodyGapBehind` |
| 1705 / 1715 | `approachLimit` `crossState` |
| 1735 / 1747 | `clearance(c,o)` `roomToClear` |
| 1761 | `arbitrateCrossings()` — positional-only priority, shared `xs.list` |
| 1810 | `unstickCars(dt)` — reverse-out escape |
| 1833 / 1876 | `updateCars(dt)` `writeCarInstances()` |

### Per-frame update (1895–1990) → [contracts/boot-sequence.md](../contracts/boot-sequence.md)

| Line | Symbol |
| --- | --- |
| 1895 | `limbInstance(...)` |
| 1901 | `updatePeds(dt,t)` |
| 1937 | `updateLights()` |
| 1945–1964 | `initMinimap()` `drawMinimap()` — a 184 px canvas overlay, redrawn once every 4 frames (see [docs/performance.md](performance.md)) |
| 1966 | `animate(now)` — rAF loop, `dt` clamped to 0.05 s |

### Boot & pointer lock (1972–2015) → [contracts/boot-sequence.md](../contracts/boot-sequence.md)

| Line | Symbol |
| --- | --- |
| 1973 | `async function boot()` — fixed step order with % labels (steps at 1975–1987) |
| 1993 | `lockMouse()` |
| 1998 | "enter" button click → start game |
| 2003 | `pointerlockchange` |
| 2006 | global click re-acquires pointer lock |
| 2008 | resize handler |
| 2011–2015 | `boot().catch(...)` — **must remain the last statement** in the script block |

## Verification

- Runtime assertions: [contracts/harness.md](../contracts/harness.md) (23 checks).
- Three.js API surface pinning: [contracts/render-api.md](../contracts/render-api.md).
- [`AGENTS.md`](../../AGENTS.md) is the entry point: working norms plus a "where to look" table. It deliberately
  carries **no** line-number map, no invariant list and no status — those live here and in `contracts/`.
