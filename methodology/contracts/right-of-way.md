# Contract: right of way at intersections

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

Functions involved (`game/gta.html`): `crossState()`, `arbitrateCrossings()`, `clearance()`, `roomToClear()`, `unstickCars()`, plus `bodyGap()` / `leaderAhead()` / `approachLimit()`. Each square runs one global arbitration round: whoever entered first proceeds; ties break to the right-hand traffic.

## Rules — read always

- **C-ROW-1** Priority is positional only: (1) already inside the box → earliest arriver, (2) time-to-line at cruise speed, (3) right of way, (4) `id`. It must **never** depend on current speed — braking would hand over the right of way in a circle.
- **C-ROW-2** `bodyGap()` counts obstacles only *in front*: `if (dF <= 0) continue;` — a competitor whose centre is at or behind ours is not an obstacle.
- **C-ROW-3** One shared `xs.list` per crossing hand, referenced by every vehicle — never a copy per car, or `roomToClear()` sees only itself and each car declares the box free.
- **C-ROW-4** `clearance()` measures both legs to a single point P (the intersection of the lane axes), not "how far the opponent still has to go along its own line". The hold persists while any part of the opponent's body still straddles our lane line — release only at rear past P (`dO + o.hl <= 0`), never at centre past P.
- **C-ROW-5** All three liveliness guards are required: `roomToClear()`, the `STALL_HOLD` escape, and `unstickCars()` (`UNSTICK_S`). Remove any one and intersections swallow traffic within minutes.
- **C-ROW-6** A denied vehicle brakes toward its stop line; if the denial arrives later than its braking distance, it may cross the face and come to rest inside — bounded by braking distance from max cruise. Harness `sim.heldNoseMax ≤ 9.6` m (= car-class worst case 14²/(2·11) ≈ 8.9 m + one frame of travel at 14 m/s); reference runs: 4.5 / 6.9 m.
- **C-ROW-7** *(2026-09-29)* `roomToClear(c)` must refuse to enter a box the car cannot clear. Two conditions block entry: (1) the player or a pedestrian standing in the landing zone (`xs.dc + BOX + c.dmin + c.hl` ahead of the nose); (2) a chain of leaders whose worst-case stopped span exceeds the free segment between this box and the next (`CELL - 2*BOX`) — even a still-moving leader may stop at box 2 (cross traffic, another yield, the player). A car already past the box (`xs.dc <= -c.hl - BOX`) returns `true` immediately and does not block.
- **Scope** Vehicles never turn at an intersection — they keep lane and yield. Turning would need trajectory rebuilding this model does not have.

Verify: harness checks 21–23 over the pure-sim audit; acceptance numbers in *Rationale → Acceptance numbers*.

## Rationale & examples — read only when editing that rule

### C-ROW-1 — Priority is positional only

Speed-dependent priority is the classic livelock this whole block exists to prevent: braking hands the right of way over, which triggers braking again.

**Amendment 2026-10-27 (RC2).** The rule text was always "earliest arriver"; what changed is that it is now actually enforced. Pre-fix, a car already inside the box got a blanket `xGo = true` at the crossing frame and skipped the hold loop — so two cars could commit to the same hand simultaneously and T-bone (max-density audit: 195 perpendicular contact frames, 2 deadlocked cars). Post-fix, in-box cars go through the same hold loop; the sort already orders them first by `dc` ascending, so an in-box car is held only by another in-box car further past P — which *is* "earliest arriver". Same audit post-fix: 0 contact frames, 0 deadlocked, no gridlock.

### C-ROW-2 — `bodyGap()` counts obstacles only *in front*

```js
if (dF <= 0) continue;   // competitor whose centre is at or behind ours is not an obstacle
```

The tempting "robust" version with `Math.abs(dF)` hooked every vehicle to **its own tail**: `dmin = L + 3.5` exceeds a typical lane interval, so one fictitious barrier *behind* the nose zeroed the pull forever. That state had **20 of 52 vehicles frozen** (`deadlockCars=30`, `stuckFraction 0.43`, gridlock after 123 s).

**Amended 2026-10-26 (quote catch-up).** The guard itself changed on 2026-09-29 ('bodyGap same-axis front test by centre'): `dF + oF <= 0` → `dF <= 0`. The old form counted an overlapping trailing car as a forward obstacle and locked both cars in place — unstickCars does not handle same-axis overlaps. This rule's quote now matches the code; the invariant (front only) is unchanged.

### C-ROW-3 — One shared array per crossing, not a copy per car

Old one-liner trap: `Map.set()` returns the **`Map`**, not the value — so `xs.list = map.set(k, [c])` silently "worked" while being wrong.

### C-ROW-4 — `clearance()` measures both legs to a single point P

Measuring along the opponent's own line produced `hold = tClear` for a car standing at its line, which let one vehicle hold **every hand of its crossing across the whole district**. After the fix: `heldFarOutSamples 466 → 185`, mean speed from cruise `0.848 → 0.862`.


**Amendment 2026-09-26.** Same-axis opponents never hold: the opponent on the same road going the other way shares the crossing list (same `xs.key`), but the two do not conflict — they pass in different lanes. `clearance()` therefore returns `-Infinity` for them, **not** `Infinity`. The distinction matters because the arbitration loop takes `max()` of all clearances and then checks `c.xGo = tE >= hold`: an `Infinity` there means "wait forever", and the car held its neighbour until the `STALL_HOLD` escape (2.5 s) fired — visible as a pointless 2.5 s stop at a crossing when there are only two cars in the whole world. The two other "no conflict" early returns (`dC < -c.hl - o.hw` and `dC > CROSS_LOOK + 30`) had the same sign error and are also `-Infinity` now.

**Amendment 2026-10-27 (RC2).** The release test was "opponent's centre past P" (`dO <= 0`). A semi whose centre has passed still leaves ~8 m of trailer across our lane line; releasing the hold then let us commit while its tail was in the box — one source of the pre-fix T-bones. Now: `if (dO + o.hl <= 0) return -Infinity;` — keep holding until the opponent's rear clears our line.
### C-ROW-5 — Three liveliness guards, all required

| Guard | What it prevents |
| --- | --- |
| `roomToClear()` | driving into a box that has a queue on the other side |
| `STALL_HOLD` escape | treating a stalled competitor as an authority forever |
| `unstickCars()` (`UNSTICK_S`) | permanent clinch — reverse out of the denied box |

### C-ROW-6 — A denied vehicle brakes toward its stop line; late holds may overshoot, bounded by physics

A denied car gets the exact sqrt braking profile to 1.2 m before the face (`approachLimit`). If denial is in effect early enough (stop ≥ v²/2·dec + 1.2) it stops before the box. If the hold appears later — or reappears after a grant window while the car has re-accelerated toward cruise — the car crosses the face and comes to rest inside, at depth ≈ v_cross²/(2·dec). That overshoot is transient (the holder passes, or the STALL_HOLD escape restores `xGo`), produces no body overlap (check 21) and no deadlock (check 22); while stopped inside we *are* the positional priority for perpendicular traffic, which C-ROW-1 handles.

**Amendment 2026-10-27.** Pre-fix this rule read "stops before the box" with a 0.6 m threshold — but that scope was an accident: in-box cars got blanket `xGo = true` (see C-ROW-1), so denial could only ever fire for approaching cars, and the metric's effective scope was identical to today's crossing-event form. Post-fix, denial legitimately persists inside the box; frame traces show a bus crossing at ~9.7 m/s coming to rest ~6 m inside — v²/2·dec ≈ 5.6 m plus one frame of travel, exactly the physics bound. The threshold therefore moves from "arbitration never let a car through" (0.6 m) to "no car moved faster than its own braking profile allows": max over classes of v_max²/(2·dec) + one frame — car class 14²/(2·11) ≈ 8.9 m + 0.7 m = **9.6 m**. Anything deeper is a real defect (braking or arbitration), not late denial. Persistent blocking inside the box stays under C-ROW-5's guards (check 22).

### C-ROW-7 — A car does not enter a box it cannot clear

Two failure modes gave this rule its shape.

- **The player (or a pedestrian) stands just beyond the crossing.** A car
  enters the box, brakes at `dmin` from the obstacle, and stops inside the
  box, blocking cross traffic until the player walks away. `roomToClear`
  measures the landing zone (`xs.dc + BOX + c.dmin + c.hl` ahead of the
  nose) and waits *before* the box instead.
- **The leader is still moving but will stop at box 2** — cross traffic,
  another yield, the player. Entering box 1 on the assumption the leader
  will clear strands the car inside box 1. `roomToClear` walks the chain of
  leaders up to box 2 and, in the worst case (leader’s nose at box 2’s near
  edge, every car stopped at `dmin` behind the next), compares the span
  against `CELL - 2*BOX`. If the chain would not fit, the car waits.

A car already past the box no longer needs to keep it clear; `roomToClear`
returns `true` immediately when `xs.dc <= -c.hl - BOX`.

### Acceptance numbers (16.7 min audit, ~12 s pure sim)

```
perpFrames     = 0      // no perpendicular body overlap; same-axis queue compression is a known limitation (maxPen ≈ 2.75 m, self-resolving — ../docs/limitations.md)
deadlockCars   = 0      // nobody standing > 25 s
gridlockAt     = -1     // never ≥3 simultaneous stalls
heldNoseMax    ≈ 4–7 m  // crossing-while-denied rest depth; physics bound 9.6 m (check 23)
stuckFraction  ≈ 0.016  (threshold < 0.2)
wraps          ≈ 770
```

Separate flow run over 10 min: mean speed **0.86 × cruise**, ~76 % free-flow; denied-box rests are bounded by the C-ROW-6 braking distance, not forbidden.
