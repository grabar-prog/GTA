# Contract: chase camera & look

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

## Rules — read always

- **C-CAM-1** Vertical look uses `+e.movementY` (larger pitch = looking further down); `player.yaw` keeps the usual `-=`.
- **C-CAM-2** The rig never goes under the asphalt: `ty = Math.max(0.35, 1.9 + dist*Math.sin(player.pitch))`. Orbit distance 7.4 m sprinting / 6.2 m walking.
- **C-CAM-3** Pitch clamp stays `[-1.35, 1.35]`; harness sweeps −1.35…+1.2 and asserts every camera height lands in `[0.3, 9]` (reference run 0.35 … 7.68).
- **C-CAM-4** Player↔building collision is exact AABB per building from that building's own footprint (`b.hw`, `b.hd`) — never a square block, never an `||` shortcut.
- **C-CAM-5** Click captures the mouse, Esc releases, click re-captures; `requestPointerLock()` needs `.catch(()=>{})`; the traffic slider must not steal the lock (see [boot-sequence.md](boot-sequence.md) C-BOOT-5).

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

## Open questions

Unresolved items awaiting a decision — not invariants, and not accepted limitations either
(accepted ones live in [docs/limitations.md](../docs/limitations.md)). The list of owners is
in [handsoff.md](../handsoff.md); the detail lives only here.

### chase-camera orientation

The offset applied to the camera position reuses the same `sin/cos(player.yaw)` as the heading
vector — i.e. along his facing direction — while the following `lookAt` points back at him, so
the rig reads as a camera sitting *in front* of the hero rather than behind his back.

Why it is still open: no measurement says which reading is wrong, and flipping the sign changes
how the game feels. Decide by comparison, not opinion — take an in-game chase-cam shot and check
it against the portrait rig's `SH.cam(d)` (`d < 0` → behind his back) and `camSide()` from
[character-anatomy.md](character-anatomy.md) § Verification. Ask before committing a flip; this
file's C-CAM-2 height formula is not in question, only the yaw-derived offset direction.

Consequence for review: any earlier shot taken from the front invalidates "back-of-head"
observations about hair — relevant to the hero-polish leads in
[character-anatomy.md](character-anatomy.md) § Open questions.
