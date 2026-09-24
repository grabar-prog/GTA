#!/usr/bin/env bash
#
# tools/split-models.sh — one file per model, palettes mutable at load time.
#
# Assets pattern (established by assets/main_person.js): classic <script src>, NOT an ES module —
# file:// blocks sibling ES-module imports. Consequence: each file cannot import three itself; the
# caller binds THREE via MeridianKit.init(THREE) and passes the primitives + palette down through
# createFactory().
#
# Determinism: rng() draws keep their original positions (contracts/README.md §4). Reference
# counters in methodology/contracts/harness.md do not move.
#
# Prereqs: run from repo root. Idempotent — safe to re-run.
# After:  ./tools/lint-refs.sh  &&  node harness/check-city.js
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -f game/gta.html ]] || { echo "run from repo root (game/gta.html missing)" >&2; exit 1; }
[[ -f assets/main_person.js ]] || { echo "assets/main_person.js missing" >&2; exit 1; }

PY=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
[[ -n "$PY" ]] || { echo "python3 or python required" >&2; exit 1; }

say() { printf '\n== %s ==\n' "$*"; }

# =========================================================================
say "assets/kit.js"
cat > assets/kit.js <<'JS'
/* assets/kit.js — shared geometry sugar for the asset scripts.
 *
 * Loaded as a CLASSIC script before assets/vehicles.js, assets/pedestrians.js and the per-model
 * files in assets/models/. A classic script cannot import three itself (a sibling ES-module import
 * from file:// is blocked), so init(THREE) is the single binding point.
 *
 *   const K = MeridianKit.init(THREE);
 *   const { mergeGeometries, boxAt, taperBox, cylX, cylZ } = K;
 *   const V = MeridianVehicles.createFactory({ THREE, helpers: K });
 *
 * Pure functions of their arguments — no module-level state; init() may be called more than once.
 */
(function () {
  'use strict';

  function init(THREE) {
    if (!THREE) throw new Error('MeridianKit.init: THREE is required');
    const _WHITE = new THREE.Color(1, 1, 1);

    // Merge a list of geometries — or [{geo,color},…] for vertex-coloured parts — into one buffer.
    // UVs are carried through only when EVERY part has them: without uv the emissive window map on
    // the facades would sample undefined coordinates and towers lit up as random glowing smudges
    // (render-api.md C-API-4).
    function mergeGeometries(parts) {
      const list = parts.map(p => {
        const src = (p && p.geo) || p;
        return { geo: src.index ? src.toNonIndexed() : src, color: p ? p.color : null };
      });
      let total = 0;
      for (const it of list) total += it.geo.attributes.position.count;
      const hasUV = list.every(it => !!it.geo.attributes.uv);
      const pos = new Float32Array(total * 3);
      const nor = new Float32Array(total * 3);
      const col = new Float32Array(total * 3);
      const uv = hasUV ? new Float32Array(total * 2) : null;
      let off = 0, anyColor = false;
      const tmp = new THREE.Color();
      for (const it of list) {
        const g = it.geo;
        if (!g.attributes.normal) g.computeVertexNormals();
        const n = g.attributes.position.count;
        const c = it.color == null ? _WHITE : tmp.set(it.color);
        pos.set(g.attributes.position.array, off * 3);
        nor.set(g.attributes.normal.array, off * 3);
        if (hasUV) uv.set(g.attributes.uv.array, off * 2);
        for (let i = 0; i < n; i++) {
          const j = (off + i) * 3;
          col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
        }
        if (it.color != null) anyColor = true;
        off += n;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (hasUV) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      if (anyColor) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return out;
    }

    // Parts end up in ONE buffer per object — that is what lets a detailed car cost a single draw
    // call (performance.md "Geometry merging is the entire budget").
    function boxAt(w, h, d, x, y, z, color) {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }

    // Box with the top face scaled inwards: car greenhouses, hoods, soft shoulders.
    function taperBox(w, h, d, x, y, z, sx, sz, color) {
      const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * sx); p.setZ(i, p.getZ(i) * sz); }
      p.needsUpdate = true;
      g.computeVertexNormals();
      g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }

    // Cylinder lying on its side (axis = X). A wheel built this way rolls with a plain Rx(spin).
    function cylX(r, h, x, y, z, seg, color) {
      const g = new THREE.CylinderGeometry(r, r, h, seg || 18);
      g.rotateZ(Math.PI / 2);
      g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }

    // Same cylinder along Z — lorry fuel tanks, bus AC fans, exhaust stacks.
    function cylZ(r, h, x, y, z, seg, color) {
      const g = new THREE.CylinderGeometry(r, r, h, seg || 14);
      g.rotateX(Math.PI / 2);
      g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }

    return { mergeGeometries, boxAt, taperBox, cylX, cylZ };
  }

  window.MeridianKit = { init };
})();
JS

# =========================================================================
say "assets/palettes.js"
cat > assets/palettes.js <<'JS'
/* assets/palettes.js — shared colour table for every procedural model.
 *
 * Loaded as a CLASSIC script before the factories are built. Mutable at load time: assign a new
 * array/hex before createFactory() runs and every model sees the override — the factories copy
 * this table with Object.assign, they do not alias it.
 *
 *   MeridianPalettes.car = [0xcc0000, 0x00cc00, 0x0000cc];
 *
 * Arrays are indexed modulo .length (render-api.md C-API-5); scalar hexes are directly assignable.
 */
(function () {
  'use strict';
  window.MeridianPalettes = {
    // Per-vehicle pools — a body draws one entry from the relevant array.
    car:     [0xd23b3b, 0x2f7fd1, 0xe8e8ea, 0x2c2f34, 0xf0a526, 0x3fae6a, 0xb9c2cc, 0x8a4bd0, 0x1d2733, 0xdfe6ee],
    stripe:  [0xe8e8ea, 0x2c2f34, 0xf0a526, 0x2f7fd1, 0xd23b3b, 0x4fae7a],   // bus livery band
    curtain: [0xd8dde3, 0xe8e8ea, 0x2f5f96, 0xb03a34, 0x3c7d54, 0x8f9aa6],   // trailer curtain
    shirt:   [0x3a6ea5, 0xd94f4f, 0xe8b23a, 0x4fae7a, 0xb06ad0, 0xe0e0e0, 0x2c2f34, 0xd98a3a],
    skin:    [0xd9a878, 0xc98d5e, 0x8d5a3b, 0xf0c9a5],
    // Shared hexes — one per element family.
    trim:       0x15181d,
    glass:      0x10171f,
    dark:       0x23282f,
    chrome:     0xa9b3bd,
    tyre:       0x141619,
    hub:        0x5d666f,
    busRoof:    0x9aa3bd,
    busRib:     0xb4bcc6,
    busDisplay: 0x14181d,
    marker:     0xd9a94a,
  };
})();
JS

# =========================================================================
say "assets/vehicles.js"
cat > assets/vehicles.js <<'JS'
/* assets/vehicles.js — vehicle registry + factory.
 *
 * Loaded as a CLASSIC script after assets/kit.js and assets/palettes.js, before the per-model
 * files in assets/models/*.js (each calls MeridianVehicles.register({...})), and before the game
 * module that constructs the fleet.
 *
 *   const K = MeridianKit.init(THREE);
 *   const V = MeridianVehicles.createFactory({ THREE, helpers: K });
 *   const t = V.pickVehicleType(rng);                  // weighted draw, one rng() call
 *   const paint = V.palettes.car[(rng() * V.palettes.car.length) | 0];
 *   const mesh = new THREE.Mesh(V.makeVehicleGeometry(t, paint, tint, rng), carBodyMat);
 *
 * Determinism: pickVehicleType(rng) consumes one rng() per call; makeVehicleGeometry passes rng
 * through so a bus can flip its kerbside-door coin. Both draws keep their positions in the
 * caller's generation order (contracts/README.md §4) — do not move them out of buildCars.
 *
 * Contract: methodology/contracts/traffic-lanes.md (fleet), render-api.md C-API-4/5.
 */
(function () {
  'use strict';

  // Cruise range, brake and accel rate per class. A semi never out-accelerates a sedan.
  const DRIVE = {
    car:  { cruise: [7, 14],     acc: 4.2, dec: 11 },
    bus:  { cruise: [6.5, 10.5], acc: 2.8, dec: 8.5 },
    semi: { cruise: [6, 9],      acc: 2.1, dec: 7 },
  };

  // Registration order = fleet order. pickVehicleType() walks MODELS and draws against the weights,
  // so do not sort or reshuffle: doing so reshapes the whole fleet downstream.
  const MODELS = [];

  function register(desc) {
    if (!desc || typeof desc.name !== 'string') throw new Error('MeridianVehicles.register: {name} required');
    if (typeof desc.build !== 'function')      throw new Error('MeridianVehicles.register(' + desc.name + '): build() required');
    if (typeof desc.weight !== 'number' || desc.weight <= 0) throw new Error('MeridianVehicles.register(' + desc.name + '): positive {weight} required');
    if (MODELS.some(m => m.name === desc.name)) throw new Error('MeridianVehicles.register: duplicate name ' + desc.name);
    // Cars derive their axle pair from the body length; long vehicles list theirs explicitly.
    // Normalising here means every downstream consumer can assume both fields exist.
    if (desc.kind === 'car') {
      desc.track = desc.track || desc.W - .08;
      desc.axles = desc.axles || [[desc.L * .3, desc.wr, 1], [-desc.L * .3, desc.wr, 1]];
    }
    MODELS.push(desc);
  }

  function createFactory(opts) {
    if (!opts || !opts.THREE) throw new Error('MeridianVehicles.createFactory: THREE is required');
    const THREE = opts.THREE;
    const H = opts.helpers;
    for (const need of ['mergeGeometries', 'boxAt', 'taperBox', 'cylX', 'cylZ']) {
      if (!H || typeof H[need] !== 'function') throw new Error('MeridianVehicles.createFactory: helpers.' + need + ' is required');
    }
    if (MODELS.length === 0) throw new Error('MeridianVehicles.createFactory: no models registered — load assets/models/*.js first');
    // Merge, not replace: an override keeps the untouched keys (glass, chrome, tyre, ...) intact.
    const PAL = Object.assign({}, window.MeridianPalettes || {}, opts.palettes || {});
    const TOTAL_W = MODELS.reduce((s, m) => s + m.weight, 0);

    const LENS_GEO = new THREE.BoxGeometry(.34, .15, .12);

    // Weighted draw. Consumes exactly one rng() per call — its position in the caller's generation
    // order is contractual (contracts/README.md §4).
    function pickVehicleType(rng) {
      let r = rng() * TOTAL_W;
      for (const m of MODELS) { r -= m.weight; if (r <= 0) return m; }
      return MODELS[MODELS.length - 1];
    }

    // Build one merged vertex-coloured body. rng is passed through so a bus can flip its door
    // coin — the model decides, the caller owns the stream.
    function makeVehicleGeometry(t, paint, tint, rng) {
      const P = [];
      t.build(P, { paint, tint, rng, THREE, helpers: H, PAL });
      return H.mergeGeometries(P);
    }

    // Unit wheel (radius 1) so every tyre size in the fleet shares ONE InstancedMesh via instance
    // scale: X is the tyre width axis, which is what makes widthScale > 1 render twin road wheels.
    function makeWheelGeometry() {
      const r = 1, w = r * .62;
      return H.mergeGeometries([
        H.cylX(r, w, 0, 0, 0, 20, PAL.tyre),
        H.cylX(.64, w + .03, 0, 0, 0, 16, PAL.chrome),
        H.cylX(.2, w + .06, 0, 0, 0, 10, PAL.hub),
      ]);
    }

    // Head/tail lamp mounts per body family: a bus lights the corners of its skirt, a semi puts
    // the tail cluster high on the trailer doors, not on the tractor. Pure geometry, no palette.
    function lightLayout(t) {
      if (t.kind === 'bus') return { s: 1.3,
        heads: [[ t.W / 2 - .4, .95,  t.L / 2 + .02], [-t.W / 2 + .4, .95,  t.L / 2 + .02]],
        tails: [[ t.W / 2 - .4, 1.5, -t.L / 2 - .02], [-t.W / 2 + .4, 1.5, -t.L / 2 - .02]] };
      if (t.kind === 'semi') return { s: 1.15,
        heads: [[ t.W / 2 - .4, 1.05,  t.L / 2 + .02], [-t.W / 2 + .4, 1.05,  t.L / 2 + .02]],
        tails: [[ t.trailerW / 2 - .3, 1.6, -t.L / 2 - .08], [-t.trailerW / 2 + .3, 1.6, -t.L / 2 - .08]] };
      const ly = t.wr * .95 + t.h - t.h * .26;
      return { s: 1,
        heads: [[ t.W / 2 - .34, ly,  t.L / 2 - .04], [-t.W / 2 + .34, ly,  t.L / 2 - .04]],
        tails: [[ t.W / 2 - .34, ly, -t.L / 2 + .04], [-t.W / 2 + .34, ly, -t.L / 2 + .04]] };
    }

    // Wheel instances are [x, z, radius, widthScale] — mirrored to both sides of the vehicle.
    function vehicleWheels(t) {
      const half = t.track / 2, out = [];
      for (const [z, r, w] of t.axles) { out.push([ half, z, r, w]); out.push([-half, z, r, w]); }
      return out;
    }

    return {
      palettes: PAL,
      LENS_GEO,
      models: MODELS,
      pickVehicleType,
      makeVehicleGeometry,
      makeWheelGeometry,
      lightLayout, vehicleWheels,
      DRIVE,
      VEH_TYPES: MODELS,
    };
  }

  window.MeridianVehicles = { register, createFactory, DRIVE, models: MODELS };
})();
JS

# =========================================================================
say "assets/models/ (8 files)"
mkdir -p assets/models

# -------- sedan --------
cat > assets/models/vehicle-sedan.js <<'JS'
/* assets/models/vehicle-sedan.js — sedan.
 * Registers with MeridianVehicles.register(); loaded as a classic <script> after assets/vehicles.js
 * and before the game module runs. Model contract: assets/vehicles.js. */
(function () {
  'use strict';
  const T = {
    name: 'sedan', kind: 'car', weight: .112,
    L: 4.5, W: 1.86, h: .62, cz: -.15, cl: 2.0, ch: .5,
    taper: [.84, .70], wr: .35,
    build(P, { paint, helpers, PAL }) {
      const { boxAt, taperBox } = helpers;
      const wr = T.wr, floor = wr * .95, belt = floor + T.h, top = belt + T.ch;
      P.push(boxAt(T.W - .18, wr * .9, T.L - .34, 0, floor - wr * .28, 0, PAL.trim));
      P.push(taperBox(T.W, T.h, T.L, 0, floor + T.h / 2, 0, .975, .94, paint));
      P.push(boxAt(.16, .2, T.L * .52,  T.W / 2 - .02, belt - .14, 0, PAL.trim));
      P.push(boxAt(.16, .2, T.L * .52, -T.W / 2 + .02, belt - .14, 0, PAL.trim));
      const gx = T.W * .94, sx = T.taper[0], sz = T.taper[1];
      P.push(taperBox(gx, T.ch, T.cl, 0, belt + T.ch / 2 - .02, T.cz, sx, sz, PAL.glass));
      P.push(boxAt(gx * sx + .05, .13, T.cl * sz + .05, 0, top - .045, T.cz, paint));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0,  T.L / 2 - .14, PAL.trim));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0, -T.L / 2 + .14, PAL.trim));
      P.push(boxAt(T.W * .58, .14, .09, 0, floor + T.h * .7, T.L / 2 + .02, PAL.dark));
      const mz = T.cz + T.cl * .46;
      P.push(boxAt(.18, .11, .1,  T.W / 2 + .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.18, .11, .1, -T.W / 2 - .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.06, .07, .26,  T.W / 2 + .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
      P.push(boxAt(.06, .07, .26, -T.W / 2 - .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
    }
  };
  MeridianVehicles.register(T);
})();
JS

# -------- hatch --------
cat > assets/models/vehicle-hatch.js <<'JS'
/* assets/models/vehicle-hatch.js — hatchback. See assets/vehicles.js for the model contract. */
(function () {
  'use strict';
  const T = {
    name: 'hatch', kind: 'car', weight: .112,
    L: 3.9, W: 1.80, h: .60, cz: .10, cl: 1.9, ch: .54,
    taper: [.82, .58], wr: .32,
    build(P, { paint, helpers, PAL }) {
      const { boxAt, taperBox } = helpers;
      const wr = T.wr, floor = wr * .95, belt = floor + T.h, top = belt + T.ch;
      P.push(boxAt(T.W - .18, wr * .9, T.L - .34, 0, floor - wr * .28, 0, PAL.trim));
      P.push(taperBox(T.W, T.h, T.L, 0, floor + T.h / 2, 0, .975, .94, paint));
      P.push(boxAt(.16, .2, T.L * .52,  T.W / 2 - .02, belt - .14, 0, PAL.trim));
      P.push(boxAt(.16, .2, T.L * .52, -T.W / 2 + .02, belt - .14, 0, PAL.trim));
      const gx = T.W * .94, sx = T.taper[0], sz = T.taper[1];
      P.push(taperBox(gx, T.ch, T.cl, 0, belt + T.ch / 2 - .02, T.cz, sx, sz, PAL.glass));
      P.push(boxAt(gx * sx + .05, .13, T.cl * sz + .05, 0, top - .045, T.cz, paint));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0,  T.L / 2 - .14, PAL.trim));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0, -T.L / 2 + .14, PAL.trim));
      P.push(boxAt(T.W * .58, .14, .09, 0, floor + T.h * .7, T.L / 2 + .02, PAL.dark));
      const mz = T.cz + T.cl * .46;
      P.push(boxAt(.18, .11, .1,  T.W / 2 + .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.18, .11, .1, -T.W / 2 - .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.06, .07, .26,  T.W / 2 + .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
      P.push(boxAt(.06, .07, .26, -T.W / 2 - .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
    }
  };
  MeridianVehicles.register(T);
})();
JS

# -------- suv --------
cat > assets/models/vehicle-suv.js <<'JS'
/* assets/models/vehicle-suv.js — SUV with roof rails. See assets/vehicles.js for the model contract. */
(function () {
  'use strict';
  const T = {
    name: 'suv', kind: 'car', weight: .112,
    L: 4.7, W: 1.98, h: .72, cz: -.05, cl: 2.4, ch: .62,
    taper: [.90, .80], wr: .42, rails: true,
    build(P, { paint, helpers, PAL }) {
      const { boxAt, taperBox } = helpers;
      const wr = T.wr, floor = wr * .95, belt = floor + T.h, top = belt + T.ch;
      P.push(boxAt(T.W - .18, wr * .9, T.L - .34, 0, floor - wr * .28, 0, PAL.trim));
      P.push(taperBox(T.W, T.h, T.L, 0, floor + T.h / 2, 0, .975, .94, paint));
      P.push(boxAt(.16, .2, T.L * .52,  T.W / 2 - .02, belt - .14, 0, PAL.trim));
      P.push(boxAt(.16, .2, T.L * .52, -T.W / 2 + .02, belt - .14, 0, PAL.trim));
      const gx = T.W * .94, sx = T.taper[0], sz = T.taper[1];
      P.push(taperBox(gx, T.ch, T.cl, 0, belt + T.ch / 2 - .02, T.cz, sx, sz, PAL.glass));
      P.push(boxAt(gx * sx + .05, .13, T.cl * sz + .05, 0, top - .045, T.cz, paint));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0,  T.L / 2 - .14, PAL.trim));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0, -T.L / 2 + .14, PAL.trim));
      P.push(boxAt(T.W * .58, .14, .09, 0, floor + T.h * .7, T.L / 2 + .02, PAL.dark));
      const mz = T.cz + T.cl * .46;
      P.push(boxAt(.18, .11, .1,  T.W / 2 + .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.18, .11, .1, -T.W / 2 - .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.06, .07, .26,  T.W / 2 + .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
      P.push(boxAt(.06, .07, .26, -T.W / 2 - .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
      const rx = gx * sx / 2;
      P.push(boxAt(.08, .08, T.cl * sz * .9,  rx, top + .05, T.cz, PAL.trim));
      P.push(boxAt(.08, .08, T.cl * sz * .9, -rx, top + .05, T.cz, PAL.trim));
    }
  };
  MeridianVehicles.register(T);
})();
JS

# -------- pickup --------
cat > assets/models/vehicle-pickup.js <<'JS'
/* assets/models/vehicle-pickup.js — pickup with an open cargo bed. See assets/vehicles.js. */
(function () {
  'use strict';
  const T = {
    name: 'pickup', kind: 'car', weight: .112,
    L: 5.2, W: 1.98, h: .68, cz: .60, cl: 1.7, ch: .58,
    taper: [.86, .80], wr: .42, bed: true,
    build(P, { paint, helpers, PAL }) {
      const { boxAt, taperBox } = helpers;
      const wr = T.wr, floor = wr * .95, belt = floor + T.h, top = belt + T.ch;
      P.push(boxAt(T.W - .18, wr * .9, T.L - .34, 0, floor - wr * .28, 0, PAL.trim));
      P.push(taperBox(T.W, T.h, T.L, 0, floor + T.h / 2, 0, .975, .94, paint));
      P.push(boxAt(.16, .2, T.L * .52,  T.W / 2 - .02, belt - .14, 0, PAL.trim));
      P.push(boxAt(.16, .2, T.L * .52, -T.W / 2 + .02, belt - .14, 0, PAL.trim));
      const gx = T.W * .94, sx = T.taper[0], sz = T.taper[1];
      P.push(taperBox(gx, T.ch, T.cl, 0, belt + T.ch / 2 - .02, T.cz, sx, sz, PAL.glass));
      P.push(boxAt(gx * sx + .05, .13, T.cl * sz + .05, 0, top - .045, T.cz, paint));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0,  T.L / 2 - .14, PAL.trim));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0, -T.L / 2 + .14, PAL.trim));
      P.push(boxAt(T.W * .58, .14, .09, 0, floor + T.h * .7, T.L / 2 + .02, PAL.dark));
      const mz = T.cz + T.cl * .46;
      P.push(boxAt(.18, .11, .1,  T.W / 2 + .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.18, .11, .1, -T.W / 2 - .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.06, .07, .26,  T.W / 2 + .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
      P.push(boxAt(.06, .07, .26, -T.W / 2 - .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
      // cargo bed
      const rear = -T.L / 2 + .18, front = T.cz - T.cl / 2, bl = front - rear, bh = .46;
      P.push(boxAt(T.W - .08, .1, bl, 0, belt + .05, (rear + front) / 2, PAL.dark));
      P.push(boxAt(.12, bh, bl,  T.W / 2 - .06, belt + bh / 2, (rear + front) / 2, paint));
      P.push(boxAt(.12, bh, bl, -T.W / 2 + .06, belt + bh / 2, (rear + front) / 2, paint));
      P.push(boxAt(T.W - .08, bh, .12, 0, belt + bh / 2, rear + .06, paint));
    }
  };
  MeridianVehicles.register(T);
})();
JS

# -------- van --------
cat > assets/models/vehicle-van.js <<'JS'
/* assets/models/vehicle-van.js — tall panel van. See assets/vehicles.js for the model contract. */
(function () {
  'use strict';
  const T = {
    name: 'van', kind: 'car', weight: .112,
    L: 5.0, W: 2.00, h: .98, cz: -.10, cl: 2.6, ch: .72,
    taper: [.93, .90], wr: .38,
    build(P, { paint, helpers, PAL }) {
      const { boxAt, taperBox } = helpers;
      const wr = T.wr, floor = wr * .95, belt = floor + T.h, top = belt + T.ch;
      P.push(boxAt(T.W - .18, wr * .9, T.L - .34, 0, floor - wr * .28, 0, PAL.trim));
      P.push(taperBox(T.W, T.h, T.L, 0, floor + T.h / 2, 0, .975, .94, paint));
      P.push(boxAt(.16, .2, T.L * .52,  T.W / 2 - .02, belt - .14, 0, PAL.trim));
      P.push(boxAt(.16, .2, T.L * .52, -T.W / 2 + .02, belt - .14, 0, PAL.trim));
      const gx = T.W * .94, sx = T.taper[0], sz = T.taper[1];
      P.push(taperBox(gx, T.ch, T.cl, 0, belt + T.ch / 2 - .02, T.cz, sx, sz, PAL.glass));
      P.push(boxAt(gx * sx + .05, .13, T.cl * sz + .05, 0, top - .045, T.cz, paint));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0,  T.L / 2 - .14, PAL.trim));
      P.push(boxAt(T.W + .05, wr * .6, .36, 0, wr * 1.0, -T.L / 2 + .14, PAL.trim));
      P.push(boxAt(T.W * .58, .14, .09, 0, floor + T.h * .7, T.L / 2 + .02, PAL.dark));
      const mz = T.cz + T.cl * .46;
      P.push(boxAt(.18, .11, .1,  T.W / 2 + .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.18, .11, .1, -T.W / 2 - .1, belt + T.ch * .5, mz, PAL.trim));
      P.push(boxAt(.06, .07, .26,  T.W / 2 + .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
      P.push(boxAt(.06, .07, .26, -T.W / 2 - .03, floor + T.h * .72, T.cz - .12, PAL.chrome));
    }
  };
  MeridianVehicles.register(T);
})();
JS

# -------- bus --------
cat > assets/models/vehicle-bus.js <<'JS'
/* assets/models/vehicle-bus.js — 12 m city bus, two axles, one kerbside door side per vehicle.
 * The build function draws one rng() for the door-side coin-flip — that draw's position in the
 * caller's generation order is contractual (contracts/README.md §4). See assets/vehicles.js. */
(function () {
  'use strict';
  const T = {
    name: 'bus', kind: 'bus', weight: .20,
    L: 12.0, W: 2.55, wr: .52, floorY: .75, roofY: 3.10, bandH: 1.35,
    track: 