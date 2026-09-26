# Contract: character asset format

**Reading rule:** the *Rules* block is the whole file. There is no *Rationale* section yet — every
line below is normative and short enough to read top-to-bottom.

Consumers: `assets/models/hero.js` (the hero) and the pose workbench `assets/main_person.html`.
A future importer (glTF, generated rigs, a character editor) is the intended audience for the
format; the current hero is a direct consumer of the same rules.

## Rules — read always

### C-ASSET-1 — Units and axes
Units: metres. Axes: +Y up, +Z forward, +X right. Rest-pose contact geometry sits at `Y = 0`.

### C-ASSET-2 — Pose shape
Pose = flat object `{ key: number }`. Keys are deltas from rest, in radians. A missing key means 0.

### C-ASSET-3 — Pose key naming
Pose keys are either `<nodeId>.<dof>` (normative) or `<nodeId><Axis>` (compact). Both forms are
accepted; a consumer must not depend on one over the other.

### C-ASSET-4 — Mirror pairs
A node declared with `mirror` gets its x-components flipped (both angles and `tx`); y and z are
unchanged. Mirroring is declarative, never inferred from the node's name.

### C-ASSET-5 — Phase continuity
Behaviour phases must be continuous: `phase[k].end == phase[k+1].start` for every non-zero key.
A discontinuity is a bug in the behaviour, not in the runtime.

### C-ASSET-6 — Behaviour blending
Behaviour blending uses smoothstep; no pose discontinuity is allowed across a transition.

### C-ASSET-7 — Layers
Layers are additive over the pose and toggled independently via `setLayer`.

### C-ASSET-8 — Capabilities
Behaviours are available only from the declared `capabilities` list; nothing is implicit.

### C-ASSET-9 — Materials by role
Materials are declared by semantic role (`primary`, `skin`, `metal`, …), not by mesh name.
Recolouring targets a role, never a mesh.

### C-ASSET-10 — `requires.three`
`requires.three` is a semver range; the baseline for contract v1.0 is `>=0.160.0 <0.170.0`.

### C-ASSET-11 — `requires.features`
`requires.features` are listed explicitly; a missing feature is a load refusal, not graceful
degradation.

### C-ASSET-12 — Sockets and contacts
Sockets and contacts are declared, not inferred. Contact kinds are
`foot | paw | wheel | base | grip | tip`.

### C-ASSET-13 — Budget
The asset declares its budget; exceeding it warns but does not refuse.
