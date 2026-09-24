# Contract: boot sequence & failure reporting

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

## Rules — read always

- **C-BOOT-1** `boot()` order is fixed: renderer → textures (facade/win/ground) → sky + ground → city → trees → streetlights → cars/peds/character → minimap + `updateCycle(0)` → hide loader → `animate()`. Two hard sub-rules: `updateCycle(0)` runs **before** the loader hides; textures come before any geometry that samples them. Each step awaits `nextFrame()` so the bar repaints.
- **C-BOOT-2** The loader must hide itself at 100 % (`loaderEl.classList.add('hidden')`) — it is opaque and sits above the start button, so without it the game never becomes enterable.
- **C-BOOT-3** Generation errors are surfaced: `boot().catch(...)` writes red text into `#ltxt` **and** `console.error`s. That call stays the last line of the script block and comes after the `const startEl/loaderEl = …` TDZ bindings.
- **C-BOOT-4** Re-acquiring the mouse after Esc works: a `click` listener on `window` calls `lockMouse()` once the game has started and `body.playing` is set; `.catch(()=>{})` on `requestPointerLock()` is required (a rejected lock otherwise spams unhandled rejections and trips harness check 1).
- **C-BOOT-5** The traffic slider stops propagating `pointerdown / mousedown / click / dblclick`, so clicking it never pulls the cursor back into pointer lock. Consequence: under capture, keys `-` `=` `0` are the only controls; the slider works with a free cursor (Esc).

Verify: harness waits for the loader to hide (check 2), asserts `errs === []` (check 1) and proves *"Enter the City"* is clickable via `document.elementFromPoint`. Manual failure test — throw inside any build step → red text in the loader instead of a frozen bar.

## Rationale & examples — read only when editing that rule

### C-BOOT-1 — Order of `boot()` is fixed

```
initRenderer()                                   12%  "Rendering engine online…"
textures: facadeTex, winTex, groundTex           24%  "Painting facades & asphalt…"
buildSky(); buildGround()                        38%  "Raising the skyline…"
buildCity()                                      60%  "Placing N buildings…"
buildTrees()                                     72%  "Planting N trees…"
buildStreetlights()                              82%  "Wiring streetlights…"
buildCars(); buildPeds(); buildCharacter()       94%  "Spawning traffic & crowds…"
initMinimap(); updateCycle(0)                   100%  "Ready."
loaderEl.classList.add('hidden'); animate()
```

- **`updateCycle(0)` before the loader hides** — otherwise the very first frame renders with unsynchronised lighting (sun/moon/fog/window-emission out of phase with `dayTime`).
- **Textures before geometry that samples them** — `glassMat.map` / `glassMat.emissiveMap` are attached during the texture step.

### C-BOOT-2 — The loader must hide itself at 100 %

`#loader` is opaque at `z-index: 80`, above `#start` (`z-index: 50`). Missing the hide call leaves the player staring at *"Ready."* forever — bug #2 in the invariant list.

### C-BOOT-3 — Generation errors must be visible, not swallowed

Calling `boot()` before those `const` bindings throws a `ReferenceError` before any handler exists, which is exactly how a crash used to look like a hang: nothing on screen, nothing in the console until you attach a debugger.

### C-BOOT-4 — Re-acquiring the mouse after Esc works

The listener must be attached once `renderer` exists; the original one-liner ran too early and left the view stuck after a single Escape.

### C-BOOT-5 — First click on the HUD slider must not re-capture the cursor

Without the propagation stop, clicking the slider feeds the global click handler and yanks the pointer back into lock mid-drag. Slider details (0.05 grid, percent-of-multiplier scale) live in [traffic-lanes.md](traffic-lanes.md) C-LANE-6.
