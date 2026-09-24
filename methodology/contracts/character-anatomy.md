# Contract: pedestrian & hero anatomy

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back. The **Open questions** section at the end is the working list; read it before any hero-polish work.

## Rules — read always

- **C-ANA-1** The head sits above the torso. Rig (a ~1.8 m walker): `PED_RIG = {hip:.84, shoulder:1.32, head:1.58, hipX:.14, shX:.29}`; torso top **y = 1.47**, head centre **1.58**, crown ≈ 1.79. Landmarks that must hold: `headTop − torsoTop ≈ 0.32`, neck overlap `≈ 0.1`, feet at `y ≈ 0.025`.
- **C-ANA-2** Head geometry is built around its own origin — the instance's Y **is** the head centre. No baked-in translate offset.
- **C-ANA-3** Limbs hang from their own pivot so a single `Rx()` swing animates them; one `InstancedMesh` per rig part (torso / head / arm L / arm R / leg L / leg R). Crowd animation must not allocate per-frame matrices.
- **C-ANA-4** The face texture is procedural canvas (`faceCanvas()`, painted at build time); the mesh whose `material.map === FACE_OPEN` is the diagnostic handle (`SH.skull()` in the portrait rig). Any head-geometry change keeps that mapping intact.

Verify: portrait shots, not the city harness — procedure in *Rationale → Verification*.

## Rationale & examples — read only when editing that rule

### C-ANA-1 — The head must sit above the torso

Sounds trivial and it was broken for a whole session: crowds rendered **headless** because the head sphere ended up inside the body (see C-ANA-2 for how the offsets conspired).

| Part | Construction | Resulting extent |
| --- | --- | --- |
| Torso | `CapsuleGeometry(.27, .36)` offset `+.18` from the hip pivot | top at **y = 1.47** |
| Head | sphere `r=.21`, placed as a **centre** at `PED_RIG.head` | centre **1.58**, crown ≈ 1.79 |

### C-ANA-2 — Head geometry is built around its own origin

The instance's Y **is** the head centre; no baked-in offset. That offset used to exist (`translate(0,.82,0)`) and combined with a formula `HEAD_Y = shoulder − .82 + .21` it pushed the sphere into the torso: the *previous* torso `(.26,.5)+.39` had its top at 1.78 — exactly where the crown was supposed to be, so nothing stuck out and people looked fine except for missing heads.

### C-ANA-3 — Limbs hang from their own pivot

Arms and legs are modelled relative to their pivot so a single `Rx()` swing animates them. One `InstancedMesh` per rig part keeps the crowd cheap: animation must not allocate per-frame matrices.

### C-ANA-4 — Face texture is procedural canvas

`faceCanvas()` paints the face into a canvas at build time; the mesh whose `material.map === FACE_OPEN` is the diagnostic handle (`SH.skull()` in the portrait rig). Keep that mapping intact through any head change, otherwise the portrait diagnostics go blind.

### Verification

Portrait shots, not the city harness: freeze the game loop (`animate=()=>{}`), pose via `SH.pose({x,z,vx,vz,heading,gait,sprint,stagger,lookYaw,lookPitch})` (drives `animateCharacter(0.016,…)` ×6 and never calls `updatePlayer`, so traffic can't shove him around mid-shot), then render manually — otherwise rAF overwrites the camera.

- `SH.cam(d, …)`: **d > 0 → in front of his face, d < 0 → behind his back**; `camSide()` for a profile view.
- Shots land in `%TEMP%\meridian-char\`, never into the repo; freeze before shooting by overriding `animate` with a no-op **and then waiting ~700 ms** — an rAF callback may already be queued holding the original `updatePlayer`, which yanks the camera back. Also hide the start overlay, add the `playing` body class, and per shot set `dayTime = 8.6/24; updateCycle(0)`, restoring `camera.fov` + `updateProjectionMatrix()`.
- Puppeteer gotcha that costs runs: functions passed to `page.evaluate` are serialized, so Node-scope closures do not cross the boundary — referencing a loop variable inside one throws `ReferenceError`. Thread data through an argument object instead.

## Open questions

Unresolved items awaiting a decision or a confirmation shot — not invariants, and not accepted
limitations (those live in [docs/limitations.md](../docs/limitations.md)). The owner list is in
[handsoff.md](../handsoff.md); the detail lives only here.

### hero polish (6 leads)

Every item below is a **lead from an earlier render, not a confirmed bug** — none has been checked
against the current build. Re-shoot first (§ Verification); the city harness cannot see polish
either way. If chase-camera orientation stays unresolved ([camera.md](camera.md) § Open questions),
shots taken from the front say nothing about hair.

1. **Hair** reads as a helmet/bowl — an even straight rim instead of strands.
2. **Backpack** reads as a light oval shield.
3. **Seat sphere visible between the legs** — `sphAt(.12,.062,.108,…)` on `hips`.
4. **Dark patches left on shins/knees.**
5. **Hands read as white mitts**, fingers invisible at 6 m: needs roughly a 9 cm palm / ~18 cm hand
   length, a separate thumb plus four tapered finger capsules, and a darker tint so they stop
   reading white at distance. Fix together with item 6.
6. **Arm chain hangs too low and long** (read from code, not yet confirmed on screen): the hand mesh
   ends up *below* the pelvis. Real hanging arms put fingertips near waist height (~0.90–0.95) with
   the wrist at 1.02–1.06. The leg chain is sound for a ~1.79 m figure — hip ≈0.95, knee ≈0.49,
   ankle ≈0.095. Raising the hand or shortening the forearm mesh is safe for animation: bones only
   receive rotations.
