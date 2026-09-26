# Performance notes — `game/gta.html`

Why the scene costs what it costs, and which failure modes look like a hang. Authoritative counters are the
reference run in [contracts/harness.md](../contracts/harness.md); this file explains them rather than repeating
them. Line numbers drift — locate symbols with `grep -n` in the game file.

## Geometry merging is the entire budget

- *(amended 2026-09-26)* **Building** = 3 meshes: shell (vertex colours), lit glass (bright emissive, ~40 % of windows), dark glass (no emissive). The split is what makes windows glow on their own while walls stay neutral — `vertexColors` in Three.js only affect `diffuse`, not `emissive`, so one material cannot do both. The old 2-mesh description (shell + one shared glazing plane) is history.
- **Vehicle** = 1 merged body mesh; wheels and headlight/lens pairs are shared `InstancedMesh`es across the whole
  park (**52 bodies + 4 instanced meshes instead of ~90 boxes**).
- **Bus** = one merged mesh including windows and doors. **Semi** = cab + trailer merged, with double wheels
  collapsed into a single wide instance (`widthScale = 1.75`).

Break the merging discipline and draw calls climb to roughly **4000**, which presents exactly like a hang: the
loader stops at *"Wiring streetlights…"* and never hides. That was the original symptom, not a slow render.
Details in [contracts/traffic-lanes.md](../contracts/traffic-lanes.md) "Geometry budget".

## Draw-call counts are viewpoint-dependent

Frustum culling means one measurement is never "the" cost of the city. The harness measures from a fixed spawn
view; panning toward downtown costs a few hundred extra calls. When regressing, compare like-for-like viewpoints —
a call-count difference between two runs may just be where the camera was pointing.

## Ground apron and UV squeeze

`GROUND_APRON = 60`, so the ground plane is `WORLD + 2*APRON` = **700×700** while the painted asphalt
map only covers `±HALF` (±290). The UVs are rescaled inward so the extra ring reads as dirt rather than void. This
is what keeps wrap-around traffic — which travels to `±(HALF+APRON)` = ±300 — on solid ground instead of floating
over nothing, and it is asserted by harness check 18 (`sim.maxNoseAbs ≤ HALF + APRON`).

The trade: standing exactly on an outer road line still shows a break in the pavement, because asphalt exists only
inside ±290. Extending it would require touching `CAR_LIMIT`, `TRACK`, the minimap and the ground UVs together — see
[docs/limitations.md](limitations.md).

## Shadows

Shadow map **2048²**; the ortho shadow camera is `±95` with `far = 520` and follows the player.
**`sun.shadow.normalBias = 0.7`** — deliberately large, set right after the map size in `initRenderer()`. The casters
are merged city meshes containing thin geometry; drop this bias toward a "tidier" value and self-shadow artefacts
(dark patches crawling over facades and roads) come back. Do not tune it without looking at a night screenshot.

## Work throttled out of the frame loop

`if ((frame++ & 3) === 0) { updateLights(); drawMinimap(); }` — the nearest-lamp sort and the minimap redraw run at
about 15 Hz, which is plenty for both. The minimap canvas is **184 px**, scaled by `min(devicePixelRatio, 2)` so it
stays sharp on high-DPI without allocating a huge surface.

## Lights

**121** instanced lamp poles, but only **6** pooled `PointLight`s, re-bound to the poles nearest the player. Every
real light multiplies shader cost across every material in the scene, so the pool is the budget; distant poles are
silhouettes at night, compensated by emissive windows ([docs/limitations.md](limitations.md)).

## Headless frame rate is not a regression signal

**≈8 FPS under SwiftShader at 1280×760 with shadows is expected**, not a bug. Simulation correctness survives it
because `dt` is clamped to ≤0.05 s in the rAF loop, so player and traffic speed stay correct while the renderer
limps. Judge performance by draw calls / triangles / geometry count, never by FPS on the harness machine.

Generation time is the number that actually moves: **1.5–3 s on a real GPU**, **7.73 s** under SwiftShader in the
harness (`verified@cf4c702`, which also runs the traffic audit). Harness bound is `genMs < 30000`.

## Open performance work

- The HUD writes DOM every frame; it could be throttled like the minimap (every 4th) with no visible difference.
- No LOD and no distance culling — the whole city is always in the scene.
- `isRoad()` exists but is never called; either use it for street-surface logic or delete it.

## Verification

Re-measure with the harness (`node harness/check-city.js`) and compare against the reference run there. For a
specific frame, freeze the loop (`animate = () => {}`) and call `renderer.render(scene, camera)` manually —
otherwise rAF overwrites the camera between setup and shot.
