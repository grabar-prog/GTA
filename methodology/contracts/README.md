# Contracts

Normative statements about how MERIDIAN CITY must behave, each with a **verification method**. If code and contract disagree, either the code regressed or the contract needs an explicit amendment (with a reason).

These exist because every one of them was paid for in a real debugging session — mostly the hang at *"Wiring streetlights…"* and the traffic gridlock audit. They are not style preferences.

Read only the *Rules* block unless you are changing the behaviour it governs; on a typical review that is 3–4× less text for the same coverage.

## Index

| Contract | Scope | Verified by |
| --- | --- | --- |
| [world-constants.md](world-constants.md) | numeric layout of the map, derived quantities, spawn positions | `spawn` block in harness JSON + code review |
| [render-api.md](render-api.md) | Three.js **0.160.x** API surface; forbidden r128 leftovers | `tools/lint-refs.sh` §7 (substring check against `game/gta.html`) |
| [boot-sequence.md](boot-sequence.md) | load order, loader visibility, error surfacing | harness waits for the loader to hide; `errs === []` |
| [traffic-lanes.md](traffic-lanes.md) | spawn lines, lane offsets, wrap point, ground-plane containment | `spawn` + `sim` blocks (checks 6–12, 18–19) |
| [right-of-way.md](right-of-way.md) | intersection arbitration, deadlock freedom, no body overlap | `sim` audit (checks 21–23) |
| [character-anatomy.md](character-anatomy.md) | head/torso proportions, rig pivots, face texture | portrait shots — ad-hoc scratchpad script; procedure in this file's §Verification, not part of the city harness |
| [camera.md](camera.md) | chase-camera look sign, height formula, exact-AABB collision, capture lifecycle | `cam` block in harness JSON + code review |
| [harness.md](harness.md) | the 23 acceptance checks, thresholds, reference run numbers | `node harness/check-city.js` exit code |
| [asset-contract.md](asset-contract.md) | character asset format: units, pose, mirrors, layers, capabilities | schema-only; no executable check yet |

## Rules for changing a contract

1. **Amend, don't silently relax.** A loosened threshold needs a sentence explaining why the old one was wrong (or why the world changed).
2. **Every contract statement must be checkable** — by the harness, by a substring grep, or by a named screenshot. "Looks better" is not a contract.
3. **Numeric coupling:** several constants are derived from each other (`TRACK = CAR_LIMIT*2`, `GROUND_APRON = ROAD/2+2`, `PED_LIMIT = HALF-6`). Changing a base constant obliges you to re-check every dependent value listed in [world-constants.md](world-constants.md), including the minimap and ground UVs.
4. **Seeded RNG is part of the contract.** `rng` is consumed strictly in generation order, so adding or removing any `rng()` call reshapes the whole city downstream. That is expected — but it changes building counts and fleet composition, so reference numbers in [harness.md](harness.md) move with it.
5. **Anchor form:** an invariant is a heading whose text starts with `C-<DOMAIN>-N — Title`, numbered from 1 within its file (it lives in the *Rationale* part; the identifier, not the heading level, is what gets cited). Domain prefixes are fixed: `CAM`, `BOOT`, `LANE`, `ROW`, `API`, `ANA`, `WLD`. A bold list item or an inline mention is **not** citable — an invariant written as a bullet cannot be pointed at from a code comment, which is how two files ended up citing anchors that did not exist.
6. **Identifiers outlive text.** Once anything cites an anchor — a code comment, another contract, the routing table in `AGENTS.md` — renaming it means grepping every citation and updating them in the same commit. `C-1…C-4` became `C-WLD-1…C-WLD-4` on 2026-09-20 only because the routing table was the sole citation; treat that as a one-time discount.
7. **Two parts per contract.** `## Rules — read always` states each invariant once: identifier + imperative + the number or symbol that makes it checkable. Everything below (`## Rationale & examples`, plus any trailing `Verification` / `Open questions`) is evidence, history and reference tables — edit-time material. The Rules block is normative: a requirement written only in the rationale part does not exist for review, triage or a harness run. Amending an invariant means editing its Rules line **and** its evidence heading in the same commit; they are one statement kept at two depths, and drift between them is a bug.
8. **Unresolved items go in `## Open questions`** — that exact heading (not *Open items*), always last, one `###` sub-heading per question with the analysis, what was tried and how to decide. [handsoff.md](../handsoff.md) keeps only a one-line pointer naming this file as owner; detail written there is a second source of truth. An open question is not an invariant (it has no imperative yet) and not a limitation ([limitations.md](../docs/limitations.md) records what was decided **not** to fix).
