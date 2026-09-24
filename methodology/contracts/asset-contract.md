C-ASSET-1  Units: metres. Axes: +Y up, +Z forward, +X right. Rest pose contact geometry at Y=0.
C-ASSET-2  Pose = flat object { key: number }. Keys are deltas from rest, radians. Missing key = 0.
C-ASSET-3  Pose keys are either <nodeId>.<dof> (normative) or <nodeId><Axis> (compact). Both accepted.
C-ASSET-4  Mirror pairs: node with "mirror" gets flipped x-components (angles and tx), y/z unchanged.
C-ASSET-5  Behavior phases must be continuous: phase[k].end == phase[k+1].start for every non-zero key.
C-ASSET-6  Behavior blending uses smoothstep; no pose discontinuity across transitions.
C-ASSET-7  Layers are additive over pose, toggled independently via setLayer.
C-ASSET-8  Behaviors available only from declared `capabilities`; nothing implicit.
C-ASSET-9  Materials declared by semantic role (primary, skin, metal, ...), not by mesh name; recolor targets roles.
C-ASSET-10 requires.three is a semver range; baseline for contract v1.0 is >=0.160.0 <0.170.0.
C-ASSET-11 requires.features listed explicitly; missing feature = load refusal, not graceful degradation.
C-ASSET-12 Sockets and contacts are declared, not inferred; contact kinds are foot | paw | wheel | base | grip | tip.
C-ASSET-13 Budget declared; exceeding it warns but does not refuse.