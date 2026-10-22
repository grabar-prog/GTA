# Contract: building interiors (walk-in lobbies)

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

## Rules — read always

- **C-INT-1** A walk-in ground floor is declared in the builder's return: `entries` (door gaps on the local +Z face) plus `interior { hw, hd, floorY, ceilY }`, all lengths in metres — `floorY` is the lobby floor top, `ceilY` the first-storey ceiling underside. Only builders with a walk-in ground floor declare these; every other builder returns neither and gets one solid AABB collider instead.
- **C-INT-2** `add()` registers each declared interior once from one shared transform: a walkable rect (top = `floorY`) into the caller's `walkables` list and — only when `ceilY != null` — a slab rect (underside = `ceilY`) into `floorSlabs`, both centred on the building centre plus any local offset `(x, z)`, rotated by yaw and swap-aware (`swap = |sinY| > 0.5`). Floor and slab share one footprint so they stay mutually consistent.
- **C-INT-3** A building with `entries` gets a hollow collision shell in the caller's collider list (the city passes `buildingWalls`): four thin wall rects of thickness `WALL_T = 0.35` along the `outerW/outerD` footprint, front face split into segments by door gaps; each gap is widened ±0.30 m beyond the visible door so a body of radius `PLAYER_R = 0.5` passes at walking speed. A building without entries registers one solid AABB in the same list.
- **C-INT-4** Doors face the street: `addBuilding()` passes a per-lot `facing`, and `FACING_YAW` rotates the whole building so its local +Z (door) face points away from the block centre — never into the block or across the lot.
- **C-INT-5** Every surface bounding the lobby volume is registered as a wall rect (`buildingWalls`) or a slab (`floorSlabs`), so the chase camera's pull-in keeps it outside the building: walls by pure-XZ test, slabs when looking up. The camera-side invariant and its numbers live in [camera.md](camera.md) C-CAM-6; this contract owns what generation must produce for it to hold.

Verify: code review of `assets/models/building.js` — grep `interior:` finds exactly three builders (shop, office, tower), each with all four fields and an `entries` list; the registration block in `add()` is the only building-side writer of `walkables`/`floorSlabs`. Harness check 3 + the `cam` block must stay green after any change here. Manual feel test — walk into a shop, office or tower doorway and look up: no clipping through walls or ceiling.

## Rationale & examples — read only when editing that rule

### C-INT-1 — Walk-in declaration shape

The builders are self-contained (one file per model, registered in `MeridianAssets`), so the walk-in data travels with the builder's return rather than being special-cased by type name in `add()`. Exactly three of the seven types have a walk-in ground floor; grep `interior:` in `assets/models/building.js`:

| Builder | entries (local XZ) | interior (metres) |
|---|---|---|
| shop | `[{ x: doorX, w: doorW }]` | `{ hw: W/2 − 0.1, hd: D/2 + 0.2, floorY: baseH + 0.02, ceilY: baseH + floorH − 0.10 }` |
| office | `[{ x: 0, w: 2.4 }]` | `{ hw: W/2 − 0.1, hd: D/2 + 0.3, floorY: baseH + 0.10, ceilY: baseH + floorH − 0.25 }` |
| tower | `[{ x: 0, w: 3.0 }]` | `{ hw: W1/2 − 0.3, hd: D1/2 + 0.3, floorY: yBase + 0.10, ceilY: yBase + gfH − 0.25 }` |

In all three builders `hd` equals the shell half-depth (`outerD / 2`), so the walkable reaches the door line and crossing the threshold does not drop the player to street level mid-step. The `hw` insets vary per builder — do not "unify" them without re-measuring each lobby.

Failure modes this shape guards against:

- a builder that builds a doorway but omits `entries` gets a solid AABB collider over its whole footprint — the door is visible and unenterable, silently;
- an interior declared without `ceilY` registers a walkable floor but no slab (C-INT-2), so C-CAM-6 loses its ceiling bound for that lobby: looking up puts the camera through the first-storey ceiling again.

### C-INT-2 — One shared transform for floor and ceiling

```js
if (result.interior) {
  const it = result.interior;
  const ix = it.x || 0, iz = it.z || 0;
  const wx = cx + ix * cosY + iz * sinY;
  const wz = cz - ix * sinY + iz * cosY;
  if (walkables) walkables.push({ x: wx, z: wz,
                                  hw: swap ? it.hd : it.hw,
                                  hd: swap ? it.hw : it.hd,
                                  h: it.floorY });
  /* … slab push — same footprint, guarded on ceilY != null … */
  if (floorSlabs && it.ceilY != null) floorSlabs.push({ x: wx, z: wz,
                                                       hw: swap ? it.hd : it.hw,
                                                       hd: swap ? it.hw : it.hd,
                                                       y: it.ceilY });
}
```

One transform feeds both pushes — a second copy of the rotation for the slab would drift from the floor under any yaw that is not 0/±90°, and `swap = |sinY| > 0.5` exchanges `hw`/`hd` because at those yaws local X maps to world Z (the same swap the collider shell uses). The pushes are guarded (`if (walkables)`, `if (floorSlabs && it.ceilY != null)`), so a caller that does not pass the lists gets geometry only.

Consumers: `groundHeight()` samples `walkables` nearest-centre-wins for the player's feet; `camClearT()`/`camSlabT()` read `floorSlabs` on the camera side (C-CAM-6). All three current builders use the default offset (`it.x`, `it.z` unset), so floor and slab are centred exactly on the building.

### C-INT-3 — Hollow shell with door gaps

```js
const WALL_T = 0.35;
if (result.entries && result.entries.length) {
  const rects = [];
  rects.push({ x: -hwO + WALL_T / 2, z: 0, hw: WALL_T / 2, hd: hdO });   // left
  rects.push({ x:  hwO - WALL_T / 2, z: 0, hw: WALL_T / 2, hd: hdO });   // right
  rects.push({ x: 0, z: -hdO + WALL_T / 2, hw: hwO, hd: WALL_T / 2 });   // back
  const gaps = result.entries
    .map(e => [e.x - e.w / 2 - 0.30, e.x + e.w / 2 + 0.30])
```

The shell sits on `outerW/outerD` (defaulting to the visual `w/d`), which is slightly larger than the walkable footprint — you collide with the wall thickness, not the glass line. The front face is split into segments by the gaps; each gap is widened ±0.30 m beyond the visible door because `PLAYER_R = 0.5` and the shop door mesh is 1.4 m — 0.4 m of free travel for the body centre was too tight to hit at walking speed (the original comment in code). A building without entries registers one solid AABB `{ x: cx, z: cz, hw: hwO, hd: hdO }` in the same list, so `collide()` and the camera pull-in never need a second shape.

### C-INT-4 — Facade facing

```js
const FACING_YAW = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2, '+z': 0, ... };
// building.js, add()
const yaw = FACING_YAW[opts.facing] || 0;
```

and in `game/gta.html`, `buildCity()`:

```js
// фасад — наружу от центра квартала по X-оси: a=0 → запад, a=1 → восток
const facing = (a === 0) ? 'W' : 'E';
```

Each lot in the 2×2 block cluster gets `facing` from its column (`a`): the door face (local +Z) is rotated away from the block centre, so every walk-in opens onto a street rather than into the neighbouring lot. The yaw table also carries axis aliases (`'+z'`, …) for callers that think in axes instead of compass points; `add()` falls back to yaw 0 when no facing is given (viewer previews).

### C-INT-5 — Camera-safe interiors

The chase camera orbits behind the player at up to ~7.4 m; inside a lobby most of that orbit lies outside the building, so without registration the view reads as "the game sees through walls and ceilings". The generation-side obligation is total: every surface bounding the lobby volume must exist in one of the two lists C-CAM-6 tests — vertical surfaces as wall rects (pure-XZ test), horizontal undersides as slabs (binds only when looking up). Adding a new walk-in type or a second storey means registering its walls and each ceiling underside, not just the visible geometry.

The camera-side invariant, margins (`CAM_WALL_MARGIN = 0.3`, `CAM_MIN_DIST = 1.5`) and the measured pull-in numbers are owned by [camera.md](camera.md) C-CAM-6 — this contract does not restate them.
