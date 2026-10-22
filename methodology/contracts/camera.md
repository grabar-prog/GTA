# Contract: chase camera & look

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

## Rules — read always

- **C-CAM-1** Vertical look uses `+e.movementY` (larger pitch = looking further down); `player.yaw` keeps the usual `-=`.
- **C-CAM-2** The rig never goes under the asphalt: `ty = Math.max(0.35, 1.9 + dist*Math.sin(player.pitch))`. Orbit distance is nominally 7.4 m sprinting / 6.2 m walking — C-CAM-6 may pull it in when geometry (a wall or a ceiling slab) sits between camera and player.
- **C-CAM-3** Pitch clamp stays `[-1.35, 1.35]`; harness sweeps −1.35…+1.2 and asserts every camera height lands in `[0.3, 9]` (reference run 0.35 … 7.68).
- **C-CAM-4** Player↔building collision is exact AABB per building from that building's own footprint (`b.hw`, `b.hd`) — never a square block, never an `||` shortcut.
- **C-CAM-5** Click captures the mouse, Esc releases, click re-captures; `requestPointerLock()` needs `.catch(()=>{})`; the traffic slider must not steal the lock (see [boot-sequence.md](boot-sequence.md) C-BOOT-5).
- **C-CAM-6** No collider rect (`buildingWalls` + `parkBlockers`) and no interior ceiling slab (`floorSlabs`) may sit between camera and player: the orbit distance is pulled in until the whole player→camera segment clears every rect and stays below every slab, stopping 0.3 m short of any face or underside (`CAM_WALL_MARGIN`) and never closer than 1.5 m to the player (`CAM_MIN_DIST`). Wall rects are a pure XZ test on the same rects as `collide()`; slabs bind only when looking up with the camera path crossing their margin plane over the slab rect.

Verify: harness check 3 + the `cam` block (`{ pitch_-1.35: y, … }`). Manual feel test — look straight up while sprinting, then walk into a building doorway: no clipping through walls, no invisible barriers across a street.

## Rationale & examples — read only when editing that rule

### C-CAM-1 — Vertical look sign is `+e.movementY`

```js
player.pitch = clamp(player.pitch + e.movementY*0.0024, -1.35, 1.35);
```

The "obvious" `-=` fix inverts vertical look and drops the camera under the ground — that was bug #8, and it is easy to reintroduce while tidying this one line. Hence the plus: pointer above centre means looking down.

### C-CAM-2 — The camera never goes under the asphalt

```js
const ty = Math.max(0.35, 1.9 + dist*Math.sin(player.pitch));
```

Without the floor clamp, looking up (`pitch < -0.2`) put the orbit rig below the ground plane and the player disappeared into geometry. The `0.35` floor is what harness check 3 measures against (its lower bound is `0.3`).

### C-CAM-3 — Pitch must stay in `[-1.35, 1.35]`

Widening the clamp range or changing `dist` requires re-reading that check's bounds: the sweep and the `[0.3, 9]` window are coupled to both numbers.

### C-CAM-4 — Player collision is exact AABB, per building

```js
Math.abs(px - b.x) - b.hw < r && Math.abs(pz - b.z) - b.hd < r
```

Wrapping either term in `||` around each building grows an invisible cross that blocks whole streets (bug #4). Half-width and half-depth come from the building's own footprint, so a long thin lot does not become a square wall.

### C-CAM-5 — Mouse capture lifecycle

The old one-liner attached while `renderer` was still `undefined`, so the view stayed stuck after a single Escape; see [boot-sequence.md](boot-sequence.md) C-BOOT-4 for the listener and C-BOOT-5 for why the HUD slider stops propagating its click.

### C-CAM-6 — No wall between camera and player

Inside a lobby facing a wall, the full orbit lands on the far side of that wall: the view reads as "the game sees through buildings". The fix pulls the orbit in along its own direction until the segment is clear. A line meets each axis-aligned rect in one interval, so `camClearT()` takes the earliest entry over all rects; the camera stops 0.3 m short of the nearest face and never closer than 1.5 m to the player (tight lobbies would otherwise dive into the hero).

Measured on the tree before this rule (lobby at (−154.3, −21.1), yaw 112.5°): the full orbit point sat inside two wall rects and the player→camera segment crossed both; after pull-in the camera is outside every rect with zero crossings. The test is pure XZ on the same rects as `collide()` — treating every rect as a full-height column is deliberately conservative, and it costs ~1300 cheap bbox pre-filters per frame.

**Ceiling slabs (same invariant, horizontal).** The same "sees through geometry" class applied to storeys: in a walk-in lobby, looking up put the full orbit above the first-storey ceiling and into/through the second storey. Each interior builder now reports its first-storey underside as `ceilY` on the returned `interior`; `add()` registers it (same transform and swap-aware rect as the walkable) in a top-level `floorSlabs[]`, and `camClearT()` takes the earliest entry over wall rects **and** slabs. Slabs register existing visible ceiling surfaces — no new geometry, draw calls unchanged. A slab binds only when looking up (`sp > 0`) with its margin plane (underside − 0.3 m, measured above feet) more than ~1.4 m overhead — no such low ceiling exists in the city, so `sp ≤ 0` is unbounded by design. The crossing test stays a single interval: camera height and the eye→camera sightline's XZ fraction are both monotone along the orbit, so `camSlabT()` solves for the first fraction where the camera is above the margin plane **and** the sightline is over the slab rect.

Measured on all 62 walk-in lobbies (35 office h=0.65, 21 shop h=0.37, 6 tower h=0.6), worst pose pitch 1.2 / yaw 0: before — camera at y≈8.33 in the office lobby, 4.6 m **above** the underside, no bound; after — every lobby pulled in, residual ≤ +0.25 m above the underside only where the `CAM_MIN_DIST` floor wins at extreme pitch (office +0.248, shop +0.218), towers fully below the underside (−0.3). Photo pose (pitch 0.6 / yaw 0) in that office lobby: camera y 3.4 vs underside 3.7 — below the slab, player visible with nothing between.
