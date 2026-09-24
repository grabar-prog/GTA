# Contract: right of way at intersections

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

Functions involved (`game/gta.html`): `crossState()`, `arbitrateCrossings()`, `clearance()`, `roomToClear()`, `unstickCars()`, plus `bodyGap()` / `leaderAhead()` / `approachLimit()`. Each square runs one global arbitration round: whoever entered first proceeds; ties break to the right-hand traffic.

## Rules — read always

- **C-ROW-1** Priority is positional only: (1) already inside the box → earliest arriver, (2) time-to-line at cruise speed, (3) right of way, (4) `id`. It must **never** depend on current speed — braking would hand over the right of way in a circle.
- **C-ROW-2** `bodyGap()` counts obstacles only *in front*: `if (dF + oF <= 0) continue;` — a competitor behind our nose is not an obstacle.
- **C-ROW-3** One shared `xs.list` per crossing hand, referenced by every vehicle — never a copy per car, or `roomToClear()` sees only itself and each car declares the box free.
- **C-ROW-4** `clearance()` measures both legs to a single point P (the intersection of the lane axes), not "how far the opponent still has to go along its own line".
- **C-ROW-5** All three liveliness guards are required: `roomToClear()`, the `STALL_HOLD` escape, and `unstickCars()` (`UNSTICK_S`). Remove any one and intersections swallow traffic within minutes.
- **C-ROW-6** A held vehicle stops *before* the box it was denied: harness `sim.heldNoseMax ≤ 0.6` m overshoot (reference run: 0).
- **Scope** Vehicles never turn at an intersection — they keep lane and yield. Turning would need trajectory rebuilding this model does not have.

Verify: harness checks 21–23 over the pure-sim audit; acceptance numbers in *Rationale → Acceptance numbers*.

## Rationale & examples — read only when editing that rule

### C-ROW-1 — Priority is positional only

Speed-dependent priority is the classic livelock this whole block exists to prevent: braking hands the right of way over, which triggers braking again.

### C-ROW-2 — `bodyGap()` counts obstacles only *in front*

```js
if (dF + oF <= 0) continue;   // competitor behind our nose is not an obstacle
```

The tempting "robust" version with `Math.abs(dF)` hooked every vehicle to **its own tail**: `dmin = L + 3.5` exceeds a typical lane interval, so one fictitious barrier *behind* the nose zeroed the pull forever. That state had **20 of 52 vehicles frozen** (`deadlockCars=30`, `stuckFraction 0.43`, gridlock after 123 s).

### C-ROW-3 — One shared array per crossing, not a copy per car

Old one-liner trap: `Map.set()` returns the **`Map`**, not the value — so `xs.list = map.set(k, [c])` silently "worked" while being wrong.

### C-ROW-4 — `clearance()` measures both legs to a single point P

Measuring along the opponent's own line produced `hold = tClear` for a car standing at its line, which let one vehicle hold **every hand of its crossing across the whole district**. After the fix: `heldFarOutSamples 466 → 185`, mean speed from cruise `0.848 → 0.862`.

### C-ROW-5 — Three liveliness guards, all required

| Guard | What it prevents |
| --- | --- |
| `roomToClear()` | driving into a box that has a queue on the other side |
| `STALL_HOLD` escape | treating a stalled competitor as an authority forever |
| `unstickCars()` (`UNSTICK_S`) | permanent clinch — reverse out of the denied box |

### C-ROW-6 — A held vehicle stops *before* the box it was denied

Negative/zero overshoot means nobody drove into a square they were told to wait out of; anything above `0.6` m means arbitration let a car through a denial.

### Acceptance numbers (16.7 min audit, ~12 s pure sim)

```
perpFrames     = 0      // no body overlap at all, perpendicularly or same-axis
deadlockCars   = 0      // nobody standing > 25 s
gridlockAt     = -1     // never ≥3 simultaneous stalls
heldNoseMax    = 0
stuckFraction  ≈ 0.054  (threshold < 0.2)
wraps          ≈ 780
```

Separate flow run over 10 min: mean speed **0.86 × cruise**, ~76 % free-flow, 0 vehicles inside a denied box.
