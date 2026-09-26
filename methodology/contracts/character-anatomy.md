# Contract: pedestrian & hero anatomy

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back. The **Open questions** section at the end is the working list; read it before any hero-polish work.

## Rules — read always

- **C-ANA-1** The head sits above the torso. Rig (a ~1.8 m walker): `PED_RIG = {hip:.84, shoulder:1.32, head:1.58, hipX:.14, shX:.29}`; torso top **y = 1.47**, head centre **1.58**, crown ≈ 1.79. Landmarks that must hold: `headTop − torsoTop ≈ 0.32`, neck overlap `≈ 0.1`, feet at `y ≈ 0.025`.
- **C-ANA-2** Head geometry is built around its own origin — the instance's Y **is** the head centre. No baked-in translate offset.
- **C-ANA-3** Limbs hang from their own pivot so a single `Rx()` swing animates them; one `InstancedMesh` per rig part (torso / head / arm L / arm R / leg L / leg R). Crowd animation must not allocate per-frame matrices.
- **C-ANA-4** The hero face is built from geometry, not a texture: sclera sphere + pupil cylinder + iris torus, plus a skin-coloured eyelid dome that **slides** in Y to blink (`LID_OPEN_Y` in the eye group's `userData`). Never scale the eye group to blink — a scaled torus collapses into a horizontal sliver and the sclera surface crosses it, which reads as a stray line at oblique angles even when the eye is "open".

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

### C-ANA-4 — The hero face is built from geometry, not a texture

Eyes are sclera sphere + pupil cylinder + iris torus + eyelid skin dome — see `assets/models/hero.js`, the `[b.eyeL, b.eyeR].forEach(...)` construction. The lid **slides**: a blink brings it down over the sclera. Scaling the whole eye group would crush the iris torus into a horizontal sliver and let the sclera surface cross it — that is why the old blink read as a stray line even when the eye was "open".

This rule replaced a `faceCanvas()` / `material.map === FACE_OPEN` contract that no longer exists: the pre-extraction hero drew a face into a canvas, the current rig does not.

### Verification

Portrait shots, not the city harness. Two supported ways to place the hero in a pose:

- **In game.** Freeze the loop (`animate=()=>{}`), then drive the hero directly:
  `hero.applyPose(hero.poseGait(t, hero.WALKS[0], false)); hero.breathe(t, 0.016);`
  `hero` is the object returned by `MainPerson.createHero({THREE, RoundedBoxGeometry})` from `assets/models/hero.js`; `buildCharacter()` stores it on the module-local `hero` binding and its wrapper group on `charGroup`.
- **In the workbench.** Open `assets/main_person.html` — it loads the same `assets/models/hero.js` and exposes every pose/gait/jump control with no game loop running.

Camera conventions:

- The wrapper group owns world position + `rotation.y`; the rig owns everything below (see C-ANA-1…3).
- To shoot a specific frame: hide the start overlay, add the `playing` body class, `dayTime = 8.6/24; updateCycle(0)`, set `charGroup.position` / `charGroup.rotation.y`, then call `renderer.render(scene, camera)` — rAF will otherwise overwrite the camera between setup and shot. Wait ~700 ms after replacing `animate` with a no-op: an already-queued rAF callback may still hold the original `updatePlayer`.
- Shots land in `%TEMP%\meridian-char\`, never into the repo.
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
3. **A sphere artefact visible between the legs** — reported against the pre-extraction rig; the `sphAt(.12,.062,.108,…)` call it named no longer exists in `assets/models/hero.js`, so this is likely already gone. Confirm against the current rig before touching it.
4. **Dark patches left on shins/knees.**
5. **Hands read as white mitts**, fingers invisible at 6 m: needs roughly a 9 cm palm / ~18 cm hand
   length, a separate thumb plus four tapered finger capsules, and a darker tint so they stop
   reading white at distance. Fix together with item 6.
6. **Arm chain hangs too low and long** (read from code, not yet confirmed on screen): the hand mesh
   ends up *below* the pelvis. Real hanging arms put fingertips near waist height (~0.90–0.95) with
   the wrist at 1.02–1.06. The leg chain is sound for a ~1.79 m figure — hip ≈0.95, knee ≈0.49,
   ankle ≈0.095. Raising the hand or shortening the forearm mesh is safe for animation: bones only
   receive rotations.
