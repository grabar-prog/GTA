# Contract: Three.js API surface

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

*Migrated r128 → 0.160.x. Anchors C-API-1…7 are the current contract; do not renumber them.*

## Rules — read always

- **C-API-1** The game targets Three.js **0.160.x** via `importmap` — `three` resolves to `…/three@0.160.x/build/three.module.js`, `three/addons/` to `…/examples/jsm/` — and binds `import * as THREE from 'three'`. Never revert to a classic `<script src="…three.min.js">` or a `document.write` fallback: a module-load failure is surfaced by the inline watchdog, not swallowed.
- **C-API-2** Use `renderer.outputColorSpace = THREE.SRGBColorSpace` and `texture.colorSpace = THREE.SRGBColorSpace`. The r128 names `outputEncoding` / `sRGBEncoding` / `physicallyCorrectLights` are r128-only and must not appear. A grep for those must print nothing.
- **C-API-3** *(retired)* The `CapsuleGeometry` polyfill has been removed — the class is native since r140. Do not re-introduce it.
- **C-API-4** The hand-rolled merge emits UVs only when **all** parts supply them — keep that branch or the emissive window layer loses its `emissiveMap` source.
- **C-API-5** Palette indices are taken modulo `.length`: `CAR_COLORS[i % CAR_COLORS.length]`, same for `PED_COLORS`. Reuse the finished materials rather than building colour per vehicle.
- **C-API-6** The moon is a billboard: `PlaneGeometry(20, 20)`, positioned opposite the sun (`-dir * 520`), turned with `lookAt(camera)`, hidden at `elev >= 0.14`. Never a sphere.
- **C-API-7** `renderer.useLegacyLights = true` is a **migration stopgap** (r155 changed the light default; without it every sun/hemi/moon intensity in this file is wrong). It is deprecated and must stay paired with a `TODO(sNN):` comment naming its removal. Do not drop it in a drive-by edit — that is a recalibration commit.

Verify: harness check 1 (`errs === []`) catches any constructor that failed at runtime; checks 4/5 cover moon visibility by day/night. `tools/lint-refs.sh` §7 checks the 0.160 entry points, the absence of r128 symbols, and that `useLegacyLights` carries its TODO.

## Rationale & examples — read only when editing that rule

### C-API-1 — The game targets Three.js 0.160.x and nothing else

The page loads an `importmap` at the top of the document and runs the game as `<script type="module">`. Both `three` and `three/addons/` resolve to `unpkg.com/three@0.160.x`. An inline classic `<script>` before the importmap sets a 4-second timer: if `#ltxt` is still reading `Booting engine…` when it fires, it shows *"Failed to load Three.js — check your connection / importmap."* — the one failure mode that an ES module cannot surface on its own (`import` fails before any of the module's own code runs, so `boot().catch()` is never reached).

Never restore the r128 CDN pair or the `document.write` fallback: the whole point of the migration was one pinned resolver, not a chain of silent substitutions.

### C-API-2 — sRGB on the colour-managed side, linear everywhere else

| Correct on 0.160 | Would be wrong (r128 leftovers) |
| --- | --- |
| `renderer.outputColorSpace = THREE.SRGBColorSpace` | `outputEncoding` / `sRGBEncoding` |
| `texture.colorSpace = THREE.SRGBColorSpace` (×4 canvas textures: facade, emissive mask, ground, face atlas) | `texture.encoding` |
| `renderer.toneMapping = THREE.ACESFilmicToneMapping` | unchanged, but `toneMappingExposure` values were tuned against the r128 pipeline |

A `grep` for the right-hand column must print nothing — `tools/lint-refs.sh` §7 fails if it does. The exact symptom if the wrong pair leaks in: every canvas texture renders *washed out and 2.2× too bright*, worst on the facade windows, because the canvas bytes get sampled as if they were linear.

### C-API-3 — *(retired)* the `CapsuleGeometry` polyfill

The migration removed it. Native `THREE.CapsuleGeometry(radius, length, capSeg, radialSeg)` exists in 0.160 and is API-compatible with the old polyfill for every call site in this file (`capY`, `capX`, `capZ`, `buildPeds`). Adding the polyfill back would double-define the class and produce geometry identical to native — pure weight.

The reason the anchor stays numbered and named: any comment that cited it before this migration is still valid history, and moving C-API-4/5/6 down by one would invalidate every such citation in one silent edit.

### C-API-4 — `mergeGeometries()` carries UVs when **all** parts have them

The merge copies position/normal/colour unconditionally; UVs are only emitted when every part supplies them. That branch is what lets the facade mesh keep an `emissiveMap` while a solid colour part (a parapet, a rooftop AC) is merged into the same buffer.

*Symptom to watch for:* bright white patches on building facades at night, worst where glazing is densest.

### C-API-5 — Palette indices are taken modulo `.length`

Indexing the array object itself yields `undefined`, which silently degrades to a default white material — **the entire fleet and crowd render white**, with no error.

*Symptom:* uniformly white cars/pedestrians under any lighting.

### C-API-6 — The moon is a billboard, never a sphere

A `SphereGeometry(r = 18)` instead of the plane rendered as a white dome hanging over downtown mid-dusk — visible from every street, because a sphere has no facing to hide behind.

### C-API-7 — `useLegacyLights = true` is a stopgap, not a decision

r155 changed the light default (`useLegacyLights` went from `true` to `false` by default, then removed entirely in r165). Its practical effect on this file: at the old default, a `HemisphereLight(intensity = 0.7)` lit the scene roughly **π× brighter** than it does at the new one. The migration pinned `true` because re-tuning every sun / hemi / moon / streetlight-pool intensity is a separate commit — a visual change that wants its own screenshot review, not a mechanical r128→0.160 diff.

The rule exists so the stopgap does not become permanent:

- The `TODO(sNN):` comment in `initRenderer()` names the owner session.
- `tools/lint-refs.sh` §7 fails if `renderer.useLegacyLights` appears without a matching `TODO(sNN): … useLegacyLights`.
- Removing it is a **recalibration commit** — see the open question in [handsoff.md](../handsoff.md). Do not roll it into an unrelated edit; every intensity in `initRenderer()` and `updateCycle()` is a candidate to change, and nothing in the harness can tell whether the new numbers are right.

### Surface actually used (grep-verified)

```
ACESFilmicToneMapping  BackSide            BoxGeometry         BufferAttribute
BufferGeometry         CanvasTexture       CapsuleGeometry     CircleGeometry
Color                  CylinderGeometry    DirectionalLight    Fog
Group                  HemisphereLight     IcosahedronGeometry InstancedMesh
Matrix4                Mesh                MeshBasicMaterial   MeshStandardMaterial
PCFSoftShadowMap       PerspectiveCamera   PlaneGeometry       PointLight
Points                 PointsMaterial      Quaternion          RepeatWrapping
RingGeometry           Scene               ShaderMaterial      SphereGeometry
SRGBColorSpace         Vector3             WebGLRenderer
```

### Verification commands

```bash
# 1) pinned importmap present; no r128 leftovers anywhere
grep -nE 'type="importmap"|three@0\.160\.[0-9]+/build/three\.module\.js' game/gta.html   # required
grep -nE 'three\.js/r128|three@0\.128|outputEncoding|THREE\.sRGBEncoding|physicallyCorrectLights|examples/js/' game/gta.html   # must print nothing

# 2) required 0.160 API present
grep -nE 'renderer\.outputColorSpace[[:space:]]*=[[:space:]]*THREE\.SRGBColorSpace' game/gta.html
grep -nE 't\.colorSpace[[:space:]]*=[[:space:]]*THREE\.SRGBColorSpace'               game/gta.html

# 3) useLegacyLights is temporary and has an owner
grep -nE 'renderer\.useLegacyLights[[:space:]]*=[[:space:]]*true'   game/gta.html
grep -nE 'TODO\(s[0-9]+\):.*useLegacyLights'                        game/gta.html   # must print a match
```

Then the real gate: `node harness/check-city.js`.

### Related

- Instanced buffers are sized from the **actual fleet**, never hardcoded — see [traffic-lanes.md](traffic-lanes.md) and harness checks 16–17 (`unwrittenWheels === 0`, `unwrittenLenses === 0`).
- The `useLegacyLights` removal is an open question in [handsoff.md](../handsoff.md) → *Open questions*; the numeric recalibration lands there, not here.
- Where each symbol above lives in the file: [docs/architecture.md](../docs/architecture.md).