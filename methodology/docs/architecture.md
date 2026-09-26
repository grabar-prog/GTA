# Architecture map — `game/gta.html`

Line numbers were valid **before** the r128→0.160 migration and the `assets/models/hero.js`
extraction; they are stale. The **section names** below are the stable reference — grep for
the marker, not the line. Re-derive with
`grep -nE '^(async )?function [A-Za-z_$]+' game/gta.html` after any large edit.

## Document layout

Exact line numbers drift with every edit — grep for the marker instead.

| Marker | Section |
| --- | --- |
| `<!DOCTYPE html>` / `<head>` | meta, Google Fonts preconnect (`Anton`, `Rajdhani`), `<style>` (HUD, loader, start screen, `:root` variables) |
| `id="hud"` | HUD overlay: brand, clock/phase, controls, traffic slider, minimap wrapper (z-index 10) |
| `id="start"` | start screen with the "enter" button (z-index 50) |
| `id="loader"` | loader progress bar (z-index 80 — must stay above `#start`) |
| `Booting engine…` | inline **watchdog** classic `<script>`: 4 s timer that surfaces a failed importmap (`boot().catch` never runs when the module import itself fails) |
| `<script src="../assets/geom.js">` … `<script src="../assets/vehicles.js">` | classic asset scripts, all loaded before the module: `geom.js`, `asset-registry.js`, `day-cycle.js`, `traffic-ai.js, models/hero.js, models/pedestrian.js, models/car.js, models/bus.js, models/semi.js, models/building.js, models/tree.js, models/streetlight.js, models/park.js, models/road.js, models/distant-city.js, vehicles.js`, `vehicles.js` — see README.md for the full list |
| `<script type="importmap">` | `three` / `three/addons/` → `unpkg.com/three@0.160.x` |
| `<script type="module">` | the entire game: one module, one `<script>` block |
| `</body></html>` | last two lines |

## Script block, by responsibility

`game/gta.html` runs as one `<script type="module">`. Top-level bindings are private to the module:
the trailing `Object.assign(window, {…})` / `Object.defineProperties(window, {…})` block is the
harness contract — any state `harness/check-city.js` needs must be added there or `page.evaluate()`
dies with `ReferenceError`. See [contracts/harness.md](../contracts/harness.md) § Open questions.

The hero rig is **not** in this file. `assets/models/hero.js` loads as a classic `<script>` before
the module and exports `window.MainPerson.createHero({THREE, RoundedBoxGeometry})`; `buildCharacter()`
binds the returned wrapper group to `charGroup` and drives it each frame with
`hero.update(dt, {speed, sprint})`.

Section order inside the module (grep for the marker to locate):

| Marker | Responsibility |
| --- | --- |
| `import * as THREE from 'three'` | module imports; `RoundedBoxGeometry` from `three/addons/` (importmap, C-API-1) |
| `mulberry32` / `rand` / `pick` | seeded PRNG (seed `20240607`); consumed strictly in generation order |
| `mergeGeometries` | hand-rolled merge, keeps per-part colour and UVs (C-API-4) |
| `boxAt` `taperBox` `cylX/Z/Y` `sphAt` `capY/X/Z` `ebox` | positioned-primitive factories; each bakes its own `translate()` |
| `angLerp` | shortest-arc yaw interpolation |
| `initRenderer` | WebGL context, scene, camera, fog, sun/moon/hemi, shadows, `useLegacyLights` stopgap (C-API-7) |
| `dayCycle.makeFacadeTexture` `dayCycle.makeWindowEmissive` `dayCycle.makeGroundTexture` | canvas textures (in `assets/day-cycle.js`), `colorSpace = SRGBColorSpace` (C-API-2) |
| shared materials & palettes (`solidMat`, `glassMat`, `CAR_COLORS`, `PED_COLORS`) | index by `.length`, never by the array itself (C-API-5) |
| `isRoad` `buildGround` | ground plane + UV squeeze (`GROUND_APRON`, world-constants) |
| `addBuilding` `buildCity` `buildPark` `buildTrees` `buildStreetlights` | city generation: 2×2 clusters, one park, 121 poles, a pool of 6 `PointLight`s |
| `MeridianTrafficAI.create(...)` | lane following, right-of-way, unstick, headlight pool (in `assets/traffic-ai.js`) |
| `makeCarGeometry` `makeBusGeometry` `makeSemiGeometry` `makeWheelGeometry` `lightLayout` | one merged buffer per body |
| `wrapGap` `inBox` `clearOfBox` `buildCars` `vehicleWheels` | fleet spawn, instanced-buffer sizing |
| `PED_COLORS` `PED_SKIN` `PED_RIG` `PED_LIMIT` `buildPeds` | crowd rig (one `InstancedMesh` per part, C-ANA-1…3) |
| `buildCharacter` | calls `MainPerson.createHero(...)`, adds the wrapper to `scene` (asset-contract) |
| `dayCycle.buildSky` `dayCycle.update` | sky shader, palette table, day/night cycle (in `assets/day-cycle.js`) |
| `keys` `setTrafficMult` `mousemove` `collide` `resolveCars` `resolvePeds` | input, HUD traffic scale, collisions |
| `updatePlayer` | player + chase camera (camera.md C-CAM-1…4) |
| `leaderAhead` `pathGap` `bodyGap` `bodyGapBehind` `approachLimit` `crossState` `clearance` `roomToClear` `arbitrateCrossings` `unstickCars` `updateCars` `writeCarInstances` | traffic simulation (right-of-way.md) |
| `limbInstance` `updatePeds` `updateLights` `initMinimap` `drawMinimap` `animate` | per-frame update; lights + minimap throttled to ~15 Hz |
| `boot` `lockMouse` `boot().catch(...)` | fixed step order; `boot().catch` must remain the last statement |
| `Object.assign(window, {…})` / `Object.defineProperties(window, {…})` | harness surface (§ Open questions in [contracts/harness.md](../contracts/harness.md)) |

Determinism: `mulberry32` seeds a single `rng` stream; `rand()` and `pick()` draw from it in
generation order, so the city is identical on every load — and any edit that adds or removes an
`rng()` call reshapes everything downstream. Reference counters in
[contracts/harness.md](../contracts/harness.md) (building count, fleet mix) move with the seed.

## Verification

- Runtime assertions: [contracts/harness.md](../contracts/harness.md) (23 checks).
- Three.js API surface pinning: [contracts/render-api.md](../contracts/render-api.md).
- [`AGENTS.md`](../../AGENTS.md) is the entry point: working norms plus a "where to look" table. It deliberately
  carries **no** line-number map, no invariant list and no status — those live here and in `contracts/`.
