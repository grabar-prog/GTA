# Contract: world constants

**Reading rule:** the *Rules* block is enough for review, triage and harness runs. Open a rule's evidence only when editing that behaviour — everything under *Rationale* exists to stop one old bug coming back.

All values are read from `game/gta.html` (trust names, not line offsets). Changing a base value obliges re-checking every dependent quantity in the derived table below, including minimap and ground UVs.

## Rules — read always

- **C-WLD-1** Cars spawn only on interior road lines: `lineIdx = 1 + floor(rng()*(GRID-1))`. Lines `0` and `GRID` lie exactly on the ground-plane border (`±290`) — anything spawned there is born above the void.
- **C-WLD-2** Pedestrians spawn only on interior lines too, offset toward the pavement by `ROAD/2 + 1.8`.
- **C-WLD-3** A border clamp must never flip axis: a pedestrian pushed off-course is hard-clamped to `±PED_LIMIT` and must not `p.axis ^= 1` — that made crowds walk diagonally through buildings and then off the map.
- **C-WLD-4** Vehicles wrap at `CAR_LIMIT`, not beyond it; the cross-axis coordinate of any vehicle stays inside `±HALF` for the whole run (`sim.maxCrossAbs ≤ HALF`).
- **Couplings** `WORLD = GRID*CELL = 580`; `HALF = WORLD/2 = 290`; `CAR_LIMIT = HALF`; `TRACK = CAR_LIMIT*2` (must stay exactly that, or `gapAhead()` lies); `GROUND_APRON = ROAD/2 + 2 = 10`; `PED_LIMIT = HALF - 6 = 284`.
- **Accepted deviation** Asphalt is painted only inside `±290`, so standing on an outer road line shows a break in the pavement. Deliberately not fixed — remediation cost in [docs/limitations.md](../docs/limitations.md).

Verify: harness checks 6–12 (`spawn.onBorderLine === 0`, `spawn.outsideGroundNow === 0`, `spawn.maxLaneOffsetErr < 1e-6`, `sim.offRoadSamples === 0`) and check 18 for the apron. Every vehicle must sit at an offset of exactly `ROAD/4` from its lane centre.

## Rationale & examples — read only when editing that rule

### Base layout

| Symbol | Value | Meaning |
| --- | --- | --- |
| `GRID` | 10 | blocks per side |
| `CELL` | 58 m | block pitch (road + district) |
| `ROAD` | 16 m | road width inside a block |
| `SIDEWALK` | 3.5 m | pavement width |
| `DAY_LEN` | 170 s | one full day/night cycle |
| `WALK` / `SPRINT` | 4.6 / 9.6 m/s | player speed; `dt` clamped to 0.05 s |

### Derived (must stay consistent)

| Symbol | Derivation | Value |
| --- | --- | --- |
| `WORLD` | `GRID * CELL` | 580 |
| `HALF` | `WORLD / 2` | 290 |
| `GROUND_APRON` | `ROAD/2 + 2` | 10 — dirt apron around the asphalt, keeps wrapped traffic on solid ground |
| `CAR_LIMIT` | `HALF` | 290 — wrap point for vehicles (was `HALF+6`, which drove 6 m past the last pixel of asphalt) |
| `TRACK` | `CAR_LIMIT * 2` | 580 — **must** equal `CAR_LIMIT*2`, otherwise `gapAhead()` lies about lane distances |
| `PED_LIMIT` | `HALF - 6` | 284 — pedestrians turn around here |

### Player start

```
player.x = CELL*4 + CELL/2 = 261     // on a road line, never inside a building
player.z = -HALF + CELL*3 = -116
dayTime  = 8/24                       // 08:00 at load
```

### Building heights

`h = lerp(9, 78, (central + rand(-.2,.2))^1.35)`, with a 6 % chance of `×1.4`. `central` grows toward the map centre, so the skyline peaks downtown. Some lots are skipped on purpose — they read as plazas. Reference run: **337 buildings**.

### Road-line indexing (the trap that cost two bug fixes)

Road lines run `0 … GRID`. Lines `0` and `GRID` lie exactly on the ground-plane border (`±290`). Anything spawned there is born above the void.

#### C-WLD-1 — Cars spawn only on interior lines

`lineIdx = 1 + floor(rng()*(GRID-1))`. Harness: `spawn.onBorderLine === 0`, `spawn.outsideGroundNow === 0`.

#### C-WLD-2 — Pedestrians spawn only on interior lines

Same interior-line rule as cars, offset toward the pavement by `ROAD/2 + 1.8`.

#### C-WLD-3 — A border clamp must never flip axis

A pedestrian pushed off-course is hard-clamped to `±PED_LIMIT`; flipping it at a border (`p.axis ^= 1`) made crowds walk diagonally through buildings and then off the map.

#### C-WLD-4 — Vehicles wrap at `CAR_LIMIT`, not beyond it

The cross-axis coordinate of any vehicle stays inside `±HALF` for the whole run (`sim.maxCrossAbs ≤ HALF`). The earlier value `HALF+6` drove 6 m past the last pixel of asphalt before teleporting.

*Verified by:* harness checks 6–12 and 18 (apron). Every vehicle must sit at an offset of exactly `ROAD/4` from its lane centre.
