#!/usr/bin/env bash
#
# tools/extract-assets.sh — move vehicle and pedestrian models out of game/gta.html
# into assets/vehicles.js and assets/pedestrians.js, with palettes mutable at load time.
#
# Pattern (established by assets/main_person.js): classic <script src>, not ES module —
# file:// blocks sibling module imports but not classic scripts. Consequence: the file
# cannot import three itself; the caller passes THREE + the primitive-sugar helpers into
# a createFactory().
#
# Determinism: the seeded rng() stream is contractual (methodology/contracts/README.md §4).
# Every rng() draw keeps its original position in the generation order. Reference counters
# in methodology/contracts/harness.md are unchanged by this refactor.
#
# Prereqs: run from the repo root. Commit or stash uncommitted work first.
# After:   ./tools/lint-refs.sh  &&  node harness/check-city.js
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -f game/gta.html ]] || { echo "run from the repo root (game/gta.html missing)" >&2; exit 1; }
[[ -f assets/main_person.js ]] || { echo "assets/main_person.js missing — not a MERIDIAN CITY checkout?" >&2; exit 1; }

PY=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
[[ -n "$PY" ]] || { echo "python3 or python required" >&2; exit 1; }

say() { printf '\n== %s ==\n' "$*"; }

# ========================================================================
say "assets/vehicles.js"
cat > assets/vehicles.js <<'JS'
/* assets/vehicles.js — procedural vehicle models.
 *
 * Shared by game/gta.html. Loaded as a CLASSIC script, not an ES module: a file:// page may not
 * import a sibling .js (Chrome/Edge treat file:// as an opaque origin and block the module fetch),
 * while a classic <script src> from the same directory still loads. Consequence: the file cannot
 * import three itself — the caller hands in THREE and the primitive-sugar helpers.
 *
 *   const V = MeridianVehicles.createFactory({
 *     THREE,
 *     helpers: { mergeGeometries, boxAt, taperBox, cylX, cylZ },
 *   });
 *   const t     = V.pickVehicleType(rng);
 *   const paint = V.palettes.car[(rng() * V.palettes.car.length) | 0];
 *   const mesh  = new THREE.Mesh(V.makeVehicleGeometry(t, paint, tint, rng), carBodyMat);
 *
 * Colour contract: PALETTES is mutable at load time. Two ways to override:
 *   MeridianVehicles.PALETTES.car = [0xcc0000, 0x00cc00];   // before createFactory()
 *   createFactory({ THREE, helpers, palettes: { car: [...] } });
 * Colours are baked into vertex colours (one buffer per body), so mutating a palette *after*
 * createFactory() does not repaint the fleet that already exists — build a second factory.
 *
 * Determinism: pickVehicleType(rng) consumes exactly one rng() per call; makeVehicleGeometry
 * consumes one more for buses (the kerbside-door coin-flip). The seeded stream is contractual
 * (methodology/contracts/README.md §4), so those two draws must keep their original positions in
 * the caller's generation order or the whole city reshapes downstream.
 *
 * Units: metres, +Y up, +Z forward. A body extends from -L/2 to +L/2 along Z.
 * Contract: methodology/contracts/asset-contract.md, methodology/contracts/render-api.md C-API-4/5.
 */
(function () {
  'use strict';

  /* ---- palettes — read by createFactory, not by geometry already built ------------------------ */
  const PALETTES = {
    // Per-vehicle picks. Arrays — indexed modulo .length (render-api.md C-API-5).
    car:     [0xd23b3b, 0x2f7fd1, 0xe8e8ea, 0x2c2f34, 0xf0a526, 0x3fae6a, 0xb9c2cc, 0x8a4bd0, 0x1d2733, 0xdfe6ee],
    stripe:  [0xe8e8ea, 0x2c2f34, 0xf0a526, 0x2f7fd1, 0xd23b3b, 0x4fae7a],           // bus livery
    curtain: [0xd8dde3, 0xe8e8ea, 0x2f5f96, 0xb03a34, 0x3c7d54, 0x8f9aa6],           // trailer curtain
    // Shared hexes (one per element family).
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

  /* ---- silhouettes --------------------------------------------------------------------------- */
  // L/W in metres, h = body height above the floor pan, cz/cl/ch/taper place and slant the
  // greenhouse, wr is the wheel radius (also drives ground clearance). `kind` selects the geometry
  // builder and the driving profile; `w` is the type's share of the fleet.
  const CAR_TYPES = [
    { name: 'sedan',  kind: 'car', w: .112, L: 4.5, W: 1.86, h: .62, cz: -.15, cl: 2.0, ch: .5,  taper: [.84, .70], wr: .35 },
    { name: 'hatch',  kind: 'car', w: .112, L: 3.9, W: 1.80, h: .60, cz:  .10, cl: 1.9, ch: .54, taper: [.82, .58], wr: .32 },
    { name: 'suv',    kind: 'car', w: .112, L: 4.7, W: 1.98, h: .72, cz: -.05, cl: 2.4, ch: .62, taper: [.90, .80], wr: .42, rails: true },
    { name: 'pickup', kind: 'car', w: .112, L: 5.2, W: 1.98, h: .68, cz:  .60, cl: 1.7, ch: .58, taper: [.86, .80], wr: .42, bed: true },
    { name: 'van',    kind: 'car', w: .112, L: 5.0, W: 2.00, h: .98, cz: -.10, cl: 2.6, ch: .72, taper: [.93, .90], wr: .38 }
  ];
  // Buses: floorY/roofY are absolute heights over the asphalt, bandH is the glazing belt, doors sit
  // on one kerb side only (chosen per vehicle). axles = [zAlongBody, radius, widthScale] —
  // widthScale > 1 merges twin road wheels into one wide instance; artic splits the shell into two
  // spans joined by a bellows.
  const BUS_TYPES = [
    { name: 'bus',    kind: 'bus', w: .20, L: 12.0, W: 2.55, wr: .52, floorY: .75, roofY: 3.10, bandH: 1.35,
      track: 2.14, axles: [[ 3.4, .52, 1], [-3.6, .52, 1]] },
    { name: 'artbus', kind: 'bus', w: .07, L: 17.5, W: 2.55, wr: .52, floorY: .75, roofY: 3.10, bandH: 1.35, artic: true,
      track: 2.14, axles: [[ 6.6, .52, 1], [-1.4, .52, 1], [-6.6, .52, 1]] }
  ];
  // Euro semi-trailer: day cab + curtain-sider box on a tandem bogie. trGap is the bumper-to-trailer
  // front distance, so trailer length = L - trGap.
  const TRUCK_TYPES = [
    { name: 'semi', kind: 'semi', w: .17, L: 16.4, W: 2.55, wr: .55, cabL: 2.8, trGap: 3.3, trailerW: 2.60,
      trFloor: 1.42, trTop: 4.00, track: 2.05,
      axles: [[ 6.4, .55, 1], [ 2.5, .55, 1.75], [-5.8, .52, 1.75], [-6.9, .52, 1.75]] }
  ];
  const VEH_TYPES = [...CAR_TYPES, ...BUS_TYPES, ...TRUCK_TYPES];
  const VEH_W = VEH_TYPES.reduce((s, t) => s + t.w, 0);
  // Cars derive their axle pair from the body length; long vehicles list theirs. Normalising once
  // here means every downstream consumer (instance counts, wheel writer) can assume both exist.
  for (const t of CAR_TYPES) { t.track = t.W - .08; t.axles = [[t.L * .3, t.wr, 1], [-t.L * .3, t.wr, 1]]; }

  // Cruise range, brake and accel rates per class. A semi never out-accelerates a sedan.
  const DRIVE = {
    car:  { cruise: [7, 14],     acc: 4.2, dec: 11 },
    bus:  { cruise: [6.5, 10.5], acc: 2.8, dec: 8.5 },
    semi: { cruise: [6, 9],      acc: 2.1, dec: 7 },
  };

  // Weighted pick. Consumes exactly one rng() per call — that draw's position in the caller's
  // generation order is contractual (contracts/README.md §4); do not move it out of the loop.
  function pickVehicleType(rng) {
    let r = rng() * VEH_W;
    for (const t of VEH_TYPES) { r -= t.w; if (r <= 0) return t; }
    return VEH_TYPES[VEH_TYPES.length - 1];
  }

  /* ---- factory ------------------------------------------------------------------------------- */
  function createFactory(opts) {
    const THREE = opts.THREE;
    if (!THREE) throw new Error('MeridianVehicles.createFactory: THREE is required');
    const H = opts.helpers || {};
    for (const need of ['mergeGeometries', 'boxAt', 'taperBox', 'cylX', 'cylZ']) {
      if (typeof H[need] !== 'function') throw new Error('MeridianVehicles.createFactory: helpers.' + need + ' is required');
    }
    const { mergeGeometries, boxAt, taperBox, cylX, cylZ } = H;
    // Merge, not replace: an override keeps the untouched keys (glass, chrome, tyre, ...) intact.
    const PAL = Object.assign({}, PALETTES, opts.palettes || {});

    // One geometry instance shared by headMesh and tailMesh — the same lens on both ends of every body.
    const LENS_GEO = new THREE.BoxGeometry(.34, .15, .12);

    // Body = underbody + tapered shell + greenhouse + roof plate + bumpers/grille/rockers/mirrors/
    // handles, everything merged into ONE vertex-coloured buffer. Forward is local +Z. Paint and
    // trim hexes come from PAL — vertex colours are what make one merged mesh per body possible
    // (render-api.md C-API-4/5).
    function makeCarGeometry(t, paint) {
      const P = [], wr = t.wr, floor = wr * .95, belt = floor + t.h, top = belt + t.ch;
      P.push(boxAt(t.W - .18, wr * .9, t.L - .34, 0, floor - wr * .28, 0, PAL.trim));
      P.push(taperBox(t.W, t.h, t.L, 0, floor + t.h / 2, 0, .975, .94, paint));
      P.push(boxAt(.16, .2, t.L * .52,  t.W / 2 - .02, belt - .14, 0, PAL.trim));
      P.push(boxAt(.16, .2, t.L * .52, -t.W / 2 + .02, belt - .14, 0, PAL.trim));
      const gx = t.W * .94, sx = t.taper[0], sz = t.taper[1];
      P.push(taperBox(gx, t.ch, t.cl, 0, belt + t.ch / 2 - .02, t.cz, sx, sz, PAL.glass));
      P.push(boxAt(gx * sx + .05, .13, t.cl * sz + .05, 0, top - .045, t.cz, paint));
      P.push(boxAt(t.W + .05, wr * .6, .36, 0, wr * 1.0,  t.L / 2 - .14, PAL.trim));
      P.push(boxAt(t.W + .05, wr * .6, .36, 0, wr * 1.0, -t.L / 2 + .14, PAL.trim));
      P.push(boxAt(t.W * .58, .14, .09, 0, floor + t.h * .7, t.L / 2 + .02, PAL.dark));
      const mz = t.cz + t.cl * .46;
      P.push(boxAt(.18, .11, .1,  t.W / 2 + .1, belt + t.ch * .5, mz, PAL.trim));
      P.push(boxAt(.18, .11, .1, -t.W / 2 - .1, belt + t.ch * .5, mz, PAL.trim));
      P.push(boxAt(.06, .07, .26,  t.W / 2 + .03, floor + t.h * .72, t.cz - .12, PAL.chrome));
      P.push(boxAt(.06, .07, .26, -t.W / 2 - .03, floor + t.h * .72, t.cz - .12, PAL.chrome));
      if (t.rails) {
        const rx = gx * sx / 2;
        P.push(boxAt(.08, .08, t.cl * sz * .9,  rx, top + .05, t.cz, PAL.trim));
        P.push(boxAt(.08, .08, t.cl * sz * .9, -rx, top + .05, t.cz, PAL.trim));
      }
      if (t.bed) {
        const rear = -t.L / 2 + .18, front = t.cz - t.cl / 2, bl = front - rear, bh = .46;
        P.push(boxAt(t.W - .08, .1, bl, 0, belt + .05, (rear + front) / 2, PAL.dark));
        P.push(boxAt(.12, bh, bl,  t.W / 2 - .06, belt + bh / 2, (rear + front) / 2, paint));
        P.push(boxAt(.12, bh, bl, -t.W / 2 + .06, belt + bh / 2, (rear + front) / 2, paint));
        P.push(boxAt(t.W - .08, bh, .12, 0, belt + bh / 2, rear + .06, paint));
      }
      return mergeGeometries(P);
    }

    // Bus = skirt + tapered shell + full-width glazing belt, then pillars, kerbside doors and a
    // roof kit. `artic` cuts the shell into two spans joined by an accordion bellows: traffic never
    // steers (lanes are straight), so one rigid mesh reads exactly like a real articulation joint.
    function makeBusGeometry(t, paint, stripe, doorSide) {
      const P = [], W = t.W, L = t.L, y0 = t.floorY, y1 = t.roofY, h = y1 - y0;
      const bandY = y1 - .2 - t.bandH / 2;
      const doorTop = y1 - .35, doorBot = .95, dh = doorTop - doorBot;
      const span = (z0, z1, doors, roofKit) => {
        const l = z1 - z0, cz = (z0 + z1) / 2, fz = z1, rz = z0;
        P.push(boxAt(W - .5, .34, l - .1, 0, y0 - .2, cz, PAL.trim));
        P.push(taperBox(W, h, l - .12, 0, y0 + h / 2, cz, .985, .99, paint));
        P.push(boxAt(W + .06, t.bandH, l - 1.3, 0, bandY, cz, PAL.glass));
        P.push(boxAt(W + .07, .2, l - 1.4, 0, bandY - t.bandH / 2 - .12, cz, stripe));
        for (let z = rz + 1.0; z < fz - .8; z += 2.3) {
          const atDoor = doors.some(zd => Math.abs(z - zd) < .95);
          if (!atDoor || doorSide < 0) P.push(boxAt(.11, t.bandH + .08, .13,  W / 2 + .05, bandY, z, PAL.trim));
          if (!atDoor || doorSide > 0) P.push(boxAt(.11, t.bandH + .08, .13, -W / 2 - .05, bandY, z, PAL.trim));
        }
        for (const zd of doors) {
          const dx = doorSide * (W / 2 + .06);
          P.push(boxAt(.09, dh, 1.24, dx, (doorTop + doorBot) / 2, zd, PAL.glass));
          P.push(boxAt(.11, dh + .1, .09, dx, (doorTop + doorBot) / 2, zd - .63, PAL.trim));
          P.push(boxAt(.11, dh + .1, .09, dx, (doorTop + doorBot) / 2, zd + .63, PAL.trim));
          P.push(boxAt(.11, .1, 1.34, dx, doorBot, zd, PAL.trim));
        }
        if (roofKit) {
          P.push(boxAt(2.05, .3, l * .42, 0, y1 + .14, cz - l * .06, PAL.busRoof));
          P.push(cylZ(.34, .7, 0, y1 + .2, cz + l * .26, 12, PAL.dark));
        }
        P.push(boxAt(.1, .1, l - .3,  W / 2 - .16, y1 + .02, cz, PAL.trim));
        P.push(boxAt(.1, .1, l - .3, -W / 2 + .16, y1 + .02, cz, PAL.trim));
      };
      if (t.artic) {
        const joint = -1.4, bel = 1.2;
        span(joint, L / 2, [L / 2 - 2.3, 1.0], true);
        span(-L / 2, joint - bel, [-4.6], false);
        const zc = joint - bel / 2;
        P.push(boxAt(W - .55, h - .35, bel + .06, 0, y0 + (h - .35) / 2, zc, PAL.dark));
        for (let i = 0; i < 4; i++) P.push(boxAt(W - .3, h - .16, .1, 0, y0 + (h - .16) / 2, zc - bel / 2 + .18 + i * (bel - .36) / 3, PAL.busRib));
      } else {
        span(-L / 2, L / 2, [L / 2 - 2.2, -.4], true);
      }
      const fz = L / 2, rz = -L / 2;
      P.push(boxAt(W - .5, 1.45, .12, 0, y1 - 1.05, fz + .03, PAL.glass));
      P.push(boxAt(W - 1.15, .34, .1, 0, y1 - .42, fz + .05, PAL.busDisplay));
      P.push(boxAt(W + .02, .36, .3, 0, .56, fz - .05, PAL.trim));
      P.push(boxAt(W + .02, .36, .3, 0, .56, rz + .05, PAL.trim));
      P.push(boxAt(W - .7, .95, .1, 0, 1.45, rz - .03, PAL.dark));
      for (let i = 0; i < 3; i++) P.push(boxAt(W - 1.0, .06, .06, 0, 1.15 + i * .22, rz - .07, PAL.chrome));
      return mergeGeometries(P);
    }

    // Euro semi-trailer: day cab with a high sleeper roof, tanks and an exhaust stack behind the
    // door, plus a curtain-sided box (vertical buckles, rear doors with locking bars) on a bogie.
    function makeSemiGeometry(t, paint, curt) {
      const P = [], W = t.W, L = t.L, fz = L / 2;
      const cabF = fz, cabR = fz - t.cabL, cabBot = 1.15, cabTop = 3.60;
      const trZ1 = fz - t.trGap, trZ0 = -fz, trL = trZ1 - trZ0, trC = (trZ0 + trZ1) / 2, tw = t.trailerW;
      const boxH = t.trTop - t.trFloor, boxC = (t.trTop + t.trFloor) / 2;
      const railF = fz - 1.6, railR = trZ0;
      P.push(boxAt(1.3, .2, railF - railR, 0, 1.0, (railF + railR) / 2, PAL.trim));
      P.push(taperBox(W, cabTop - cabBot, t.cabL - .06, 0, (cabBot + cabTop) / 2, (cabF + cabR) / 2 + .03, .97, .98, paint));
      P.push(boxAt(W - .04, .4, t.cabL * .75, 0, cabTop + .2, cabR + t.cabL * .375, paint));
      P.push(boxAt(tw, .1, trL + .1, 0, t.trTop + .06, trC, PAL.busRoof));
      P.push(boxAt(W - .45, 1.45, .12, 0, cabTop - 1.05, cabF + .03, PAL.glass));
      P.push(boxAt(W - .2, .2, .3, 0, cabTop + .02, cabF + .06, PAL.trim));
      for (const sx of [1, -1]) P.push(boxAt(.12, .95, 1.45, sx * (W / 2 + .04), cabTop - 1.1, cabR + .85, PAL.glass));
      P.push(cylZ(.3, 1.2,  .78, .92, 4.3, 14, PAL.chrome));
      P.push(cylZ(.3, 1.2, -.78, .92, 4.3, 14, PAL.chrome));
      P.push(boxAt(1.9, .12, 2.0, 0, 1.16, trZ1 - 1.6, PAL.dark));
      P.push({ geo: new THREE.CylinderGeometry(.09, .11, 1.7, 10).translate(W / 2 - .25, 2.05, cabR - .3), color: PAL.chrome });
      for (const sx of [1, -1]) for (const dz of [-.62, .62])
        P.push(boxAt(.16, .12, .1, sx * (W / 2 - .25), cabTop + .06, cabF - dz, PAL.marker));
      P.push(boxAt(1.9, .26, trL + .1, 0, t.trFloor - .14, trC, PAL.trim));
      P.push(taperBox(tw, boxH, trL - .15, 0, boxC, trC, .998, .998, curt));
      for (let z = trZ0 + 1.2; z < trZ1 - 1.0; z += 1.1) {
        P.push(boxAt(.07, boxH - .1, .1,  tw / 2 + .05, boxC, z, PAL.busRib));
        P.push(boxAt(.07, boxH - .1, .1, -tw / 2 - .05, boxC, z, PAL.busRib));
      }
      for (const sy of [t.trFloor + .16, t.trTop - .16]) {
        P.push(boxAt(.09, .16, trL - .1,  tw / 2 + .04, sy, trC, PAL.trim));
        P.push(boxAt(.09, .16, trL - .1, -tw / 2 - .04, sy, trC, PAL.trim));
      }
      const rdz = trZ0 - .05;
      P.push(boxAt(tw - .08, boxH - .12, .1, 0, boxC, rdz, curt));
      for (const dx of [-.62, .62]) P.push(boxAt(.07, boxH - .24, .09, dx, boxC, rdz - .07, PAL.chrome));
      for (const sx of [1, -1]) P.push(boxAt(.14, boxH, .16, sx * (tw / 2 - .07), boxC, rdz, PAL.trim));
      P.push(boxAt(tw - .5, .16, .34, 0, .62, trZ0 - .28, PAL.trim));
      for (const sx of [1, -1]) P.push(boxAt(.14, .5, .14, sx * (tw / 2 - .3), .9, trZ0 - .16, PAL.trim));
      P.push(boxAt(tw - .2, .07, 2.6, 0, 1.18, -6.35, PAL.trim));
      return mergeGeometries(P);
    }

    // The bus-door coin-flip lives here so the caller does not have to remember it. rng is passed
    // in (not captured) so the module has no hidden state; the draw's position in the caller's
    // generation order is what matters — see the header comment.
    function makeVehicleGeometry(t, paint, tint, rng) {
      if (t.kind === 'bus') return makeBusGeometry(t, paint, tint, rng() < .5 ? 1 : -1);
      if (t.kind === 'semi') return makeSemiGeometry(t, paint, tint);
      return makeCarGeometry(t, paint);
    }

    // Unit wheel (radius 1) so every tyre size in the fleet shares ONE InstancedMesh via instance
    // scale: X is the tyre width axis, which is what makes widthScale > 1 render twin road wheels.
    function makeWheelGeometry() {
      const r = 1, w = r * .62;
      return mergeGeometries([
        cylX(r, w, 0, 0, 0, 20, PAL.tyre),
        cylX(.64, w + .03, 0, 0, 0, 16, PAL.chrome),
        cylX(.2, w + .06, 0, 0, 0, 10, PAL.hub),
      ]);
    }

    // Head/tail lamp mounts per body family: a bus lights the corners of its skirt, a semi puts the
    // tail cluster high on the trailer doors, not on the tractor. Pure geometry, no palette.
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
      palettes: PAL, LENS_GEO,
      makeCarGeometry, makeBusGeometry, makeSemiGeometry,
      makeVehicleGeometry, makeWheelGeometry,
      lightLayout, vehicleWheels,
      pickVehicleType,
      VEH_TYPES, VEH_W, DRIVE,
    };
  }

  window.MeridianVehicles = {
    createFactory, PALETTES, pickVehicleType,
    CAR_TYPES, BUS_TYPES, TRUCK_TYPES, VEH_TYPES, VEH_W, DRIVE,
  };
})();
JS

# ========================================================================
say "assets/pedestrians.js"
cat > assets/pedestrians.js <<'JS'
/* assets/pedestrians.js — procedural pedestrian rig.
 *
 * Shared by game/gta.html. Loaded as a CLASSIC script for the same file:// reason as
 * assets/main_person.js: sibling ES-module imports are blocked, classic <script src> is not.
 *
 *   const PED = MeridianPedestrians.createFactory({ THREE, helpers: { mergeGeometries } });
 *   const rig = PED.createRig(scene, 54);          // builds + adds the six InstancedMeshes
 *   for (let i = 0; i < 54; i++) {
 *     rig.setColors(i, shirt, skin);               // one call per walker, inside the caller's rng loop
 *   }
 *   rig.commitColors();
 *
 * Colour contract: PALETTES.shirt / .skin are mutable at load time. Two ways to override:
 *   MeridianPedestrians.PALETTES.shirt = [0x111111, 0x222222];   // before createFactory()
 *   createFactory({ THREE, helpers, palettes: { shirt: [...] } });
 * Per-instance colours are written through InstancedMesh.setColorAt, so overriding the palette
 * before the rig is created is enough — there is no vertex-colour bake and no repaint cost.
 *
 * Determinism: createRig() and setColors() do NOT consume rng; the caller stays in charge of the
 * seeded stream (methodology/contracts/README.md §4). The call pattern above reproduces the
 * original in-line loop's draw order exactly.
 *
 * Units: metres, feet at Y = 0, +Y up, +Z forward. A ~1.8 m walker; crown ≈ 1.79.
 * Contract: methodology/contracts/character-anatomy.md C-ANA-1…3, asset-contract.md C-ASSET-1.
 */
(function () {
  'use strict';

  // Pivot heights of a ~1.8 m walker. Limbs hang from their own pivot so a single Rx() swing
  // animates them (C-ANA-3). `head` is the world Y of the head sphere *centre* — the geometry is
  // built around its own origin, so an instance Y *is* the head centre (C-ANA-2).
  const RIG = Object.freeze({ hip: .84, shoulder: 1.32, head: 1.58, hipX: .14, shX: .29 });

  // Mutable at load time. Arrays are indexed modulo .length by the caller.
  const PALETTES = {
    shirt: [0x3a6ea5, 0xd94f4f, 0xe8b23a, 0x4fae7a, 0xb06ad0, 0xe0e0e0, 0x2c2f34, 0xd98a3a],
    skin:  [0xd9a878, 0xc98d5e, 0x8d5a3b, 0xf0c9a5],
  };

  function createFactory(opts) {
    const THREE = opts.THREE;
    if (!THREE) throw new Error('MeridianPedestrians.createFactory: THREE is required');
    const H = opts.helpers || {};
    if (typeof H.mergeGeometries !== 'function') {
      throw new Error('MeridianPedestrians.createFactory: helpers.mergeGeometries is required');
    }
    const mergeGeometries = H.mergeGeometries;
    // Merge, not replace: an override of { shirt } keeps the default skin palette and vice versa.
    const PAL = Object.assign({}, PALETTES, opts.palettes || {});
    // The instance-colour writer needs its own Color scratch — the caller's is not assumed.
    const _col = new THREE.Color();

    // Root = hips. The capsule tops out at y=1.47 so the head (centre 1.58, r .21) sticks out above
    // it. It used to be (.26,.5)+translate .39 → top 1.78, exactly the crown of the head: the sphere
    // sat *inside* the torso and every walker rendered headless (C-ANA-1).
    function makeTorsoGeometry() {
      const g = new THREE.CapsuleGeometry(.27, .36, 4, 12);
      g.translate(0, .18, 0);
      return g;
    }
    // Centred on its origin → instance Y is the head centre (C-ANA-2). No baked-in offset.
    function makeHeadGeometry() { return new THREE.SphereGeometry(.21, 12, 10); }
    // Trouser + sole, merged — one buffer per leg.
    function makeLegGeometry() {
      return mergeGeometries([
        { geo: new THREE.CapsuleGeometry(.13, .5, 4, 8).translate(0, -.37, 0), color: 0x2b313c },
        { geo: new THREE.BoxGeometry(.2, .13, .36).translate(0, -.75, .07), color: 0x1a1d22 },
      ]);
    }
    // Sleeve capsule hanging from its own shoulder pivot (C-ANA-3).
    function makeArmGeometry() {
      const g = new THREE.CapsuleGeometry(.1, .42, 4, 8);
      g.translate(0, -.31, 0);
      return g;
    }

    function createRig(scene, count) {
      const shirtMat = new THREE.MeshStandardMaterial({ roughness: .86 });   // tinted per instance
      const skinMat  = new THREE.MeshStandardMaterial({ roughness: .8 });    // tinted per instance
      const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });

      const torso = new THREE.InstancedMesh(makeTorsoGeometry(), shirtMat, count);
      const armL  = new THREE.InstancedMesh(makeArmGeometry(),   shirtMat, count);
      const armR  = new THREE.InstancedMesh(makeArmGeometry(),   shirtMat, count);
      const head  = new THREE.InstancedMesh(makeHeadGeometry(),  skinMat,  count);
      const legL  = new THREE.InstancedMesh(makeLegGeometry(),   clothMat, count);
      const legR  = new THREE.InstancedMesh(makeLegGeometry(),   clothMat, count);
      const meshes = [torso, armL, armR, head, legL, legR];
      for (const m of meshes) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }

      // Colour writes are separated from the build so the CALLER keeps the seeded rng draw order:
      // setColors() is called once per walker inside the caller's position loop — one shirt and one
      // skin pick per iteration — and commitColors() flushes once, right before updatePeds starts.
      // setColorAt auto-creates instanceColor; there is no per-frame cost.
      function setColors(i, shirt, skin) {
        torso.setColorAt(i, _col.set(shirt));
        armL.setColorAt(i, _col);
        armR.setColorAt(i, _col);
        head.setColorAt(i, _col.set(skin));
      }
      function commitColors() {
        for (const m of [torso, armL, armR, head]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }

      return { torso, head, armL, armR, legL, legR, meshes, setColors, commitColors };
    }

    return {
      palettes: PAL, RIG, createRig,
      makeTorsoGeometry, makeHeadGeometry, makeLegGeometry, makeArmGeometry,
    };
  }

  window.MeridianPedestrians = { createFactory, PALETTES, RIG };
})();
JS

# ========================================================================
say "syntax check the two new files"
if command -v node >/dev/null 2>&1; then
  node --check assets/vehicles.js
  node --check assets/pedestrians.js
  echo "  node --check ok"
else
  echo "  node not on PATH — skipping (harmless)"
fi

# ========================================================================
say "game/gta.html — wiring + block deletions"
"$PY" - <<'PY'
import pathlib
p = pathlib.Path("game/gta.html")
s = p.read_text(encoding="utf-8")

def sub(old, new, why):
    global s
    assert old in s, "gta.html: marker not found — " + why
    s = s.replace(old, new, 1)

# ---- 1) watchdog + asset script tags ---------------------------------------
sub(
"""<script>
  // Watchdog: the module below imports Three.js through an importmap. If that
  // importmap fails to resolve — offline, CDN blocked, no importmap support —
  // none of the module code runs and the loader freezes with no message. This
  // classic script is a one-shot net: after 4 s with the text still at its
  // initial value, surface the failure where boot().catch() would have.
  setTimeout(() => {
    const t = document.getElementById('ltxt');
    if (t && t.textContent === 'Booting engine…') {
      t.style.color = 'var(--red)';
      t.textContent = 'Failed to load Three.js — check your connection / importmap.';
    }
  }, 4000);
</script>

<script src="../assets/main_person.js"></script>""",
"""<script>
  // Watchdog: the module below imports Three.js through an importmap and expects three classic
  // <script src> siblings to have defined their globals. If any of those fails — offline, CDN
  // blocked, no importmap support, a missing assets/*.js — none of the module code runs and the
  // loader freezes with no message. This classic script is a one-shot net: after 4 s with the
  // text still at its initial value, name whatever is actually missing, where boot().catch()
  // would have.
  setTimeout(() => {
    const t = document.getElementById('ltxt');
    if (!t || t.textContent !== 'Booting engine…') return;
    const missing = [];
    if (!window.MainPerson)          missing.push('assets/main_person.js');
    if (!window.MeridianVehicles)    missing.push('assets/vehicles.js');
    if (!window.MeridianPedestrians) missing.push('assets/pedestrians.js');
    t.style.color = 'var(--red)';
    t.textContent = missing.length
      ? 'Failed to load asset script(s): ' + missing.join(', ')
      : 'Failed to load Three.js — check your connection / importmap.';
  }, 4000);
</script>

<script src="../assets/main_person.js"></script>
<script src="../assets/vehicles.js"></script>
<script src="../assets/pedestrians.js"></script>""",
    "watchdog + asset tags")

# ---- 2) module-level guard right after the imports -------------------------
sub(
"""import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));""",
"""import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// The classic <script> siblings above have already defined their globals. A missing one is a
// module-load failure the watchdog names, but failing *here* is honest: the alternative is a
// ReferenceError deep inside buildCars, with the loader stuck on "Spawning traffic…".
if (typeof MeridianVehicles === 'undefined' || typeof MeridianPedestrians === 'undefined' ||
    typeof MainPerson === 'undefined') {
  throw new Error('asset scripts missing — expected MeridianVehicles, MeridianPedestrians, MainPerson');
}

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));""",
    "asset guard")

# ---- 3) replace the vehicle constants block with the factory call ----------
a = s.index("/* ---------- cars ---------- */")
b = s.index("for(const t of CAR_TYPES){t.track=t.W-.08;t.axles=[[ t.L*.3,t.wr,1],[-t.L*.3,t.wr,1]];}")
b = s.index("\n", b) + 1
s = s[:a] + """/* ---------- cars ---------- */
// Vehicle models live in assets/vehicles.js. The factory closes over the primitive-sugar helpers
// (so gta.html remains the single source of boxAt / taperBox / cylX / cylZ) and over the palettes,
// which a caller can swap at load time: mutate MeridianVehicles.PALETTES before createFactory(),
// or pass { palettes } to it. Palette indices are taken modulo .length — render-api.md C-API-5.
// Determinism: pickVehicleType(rng), the paint/tint picks below and the bus-door coin inside
// makeVehicleGeometry(t, paint, tint, rng) all keep their original rng() positions — contracts/
// README.md §4.
const V = MeridianVehicles.createFactory({
  THREE,
  helpers: { mergeGeometries, boxAt, taperBox, cylX, cylZ },
});
const { CAR_TYPES, BUS_TYPES, TRUCK_TYPES, VEH_TYPES, VEH_W, DRIVE } = MeridianVehicles;
""" + s[b:]

# ---- 4) delete the vehicle geometry builders -------------------------------
a = s.index("// Body = underbody + tapered shell + greenhouse + roof plate + bumpers/grille/rockers/mirrors/handles,")
b = s.index("// Shortest distance between two spawn slots on a lane that wraps around the map.")
s = s[:a] + s[b:]

# ---- 5) buildCars call sites ----------------------------------------------
for old, new, why in [
    ("const t=pickVehicleType();",
     "const t=V.pickVehicleType(rng);",
     "pickVehicleType"),
    ("""    const t=v.t,paint=CAR_COLORS[(rng()*CAR_COLORS.length)|0];
    const tint=t.kind==='bus'?BUS_STRIPES[(rng()*BUS_STRIPES.length)|0]
             :t.kind==='semi'?CURTAINS[(rng()*CURTAINS.length)|0]:paint;""",
     """    const t=v.t,PAL=V.palettes;
    const paint=PAL.car[(rng()*PAL.car.length)|0];
    const tint=t.kind==='bus'?PAL.stripe[(rng()*PAL.stripe.length)|0]
             :t.kind==='semi'?PAL.curtain[(rng()*PAL.curtain.length)|0]:paint;""",
     "paint/tint pick"),
    ("wheelMesh=new THREE.InstancedMesh(makeWheelGeometry(),wheelMat,nWheel);",
     "wheelMesh=new THREE.InstancedMesh(V.makeWheelGeometry(),wheelMat,nWheel);",
     "wheel instanced mesh"),
    ("headMesh =new THREE.InstancedMesh(lensGeo,headMat,nLens);",
     "headMesh =new THREE.InstancedMesh(V.LENS_GEO,headMat,nLens);",
     "head instanced mesh"),
    ("tailMesh =new THREE.InstancedMesh(lensGeo,tailMat,nLens);",
     "tailMesh =new THREE.InstancedMesh(V.LENS_GEO,tailMat,nLens);",
     "tail instanced mesh"),
    ("const mesh=new THREE.Mesh(makeVehicleGeometry(t,paint,tint),carBodyMat);",
     "const mesh=new THREE.Mesh(V.makeVehicleGeometry(t,paint,tint,rng),carBodyMat);",
     "makeVehicleGeometry call"),
    ("const dr=DRIVE[t.kind],ll=lightLayout(t),cruise=rand(dr.cruise[0],dr.cruise[1]);",
     "const dr=DRIVE[t.kind],ll=V.lightLayout(t),cruise=rand(dr.cruise[0],dr.cruise[1]);",
     "lightLayout call"),
    ("wheels:vehicleWheels(t),heads:ll.heads,tails:ll.tails};",
     "wheels:V.vehicleWheels(t),heads:ll.heads,tails:ll.tails};",
     "vehicleWheels call"),
]:
    sub(old, new, why)

# ---- 6) delete the standalone vehicleWheels() ------------------------------
a = s.index("// Wheel instances are [x, z, radius, widthScale] — mirrored to both sides of the vehicle.")
b = s.index("/* ---------- pedestrians:")
s = s[:a] + s[b:]

# ---- 7) replace the pedestrians block -------------------------------------
a = s.index("/* ---------- pedestrians: one InstancedMesh per rig part (torso/head/2 arms/2 legs) ---------- */")
b = s.index("// The hero: a physics body plus the rig that draws him (built at the bottom of this section).")
s = s[:a] + """/* ---------- pedestrians: one InstancedMesh per rig part (torso/head/2 arms/2 legs) ---------- */
// Models and palettes live in assets/pedestrians.js; RIG lands there too and is re-exported here
// under its original name so updatePeds / limbInstance keep reading it untouched. Spawn RNG order
// is unchanged: the shirt/skin picks stay inside the per-walker loop below, one draw each, in the
// same position they occupied before (contracts/README.md §4).
const PED = MeridianPedestrians.createFactory({
  THREE,
  helpers: { mergeGeometries },
});
const PED_RIG = MeridianPedestrians.RIG;
const PED_LIMIT=HALF-6;   // walkers turn around here — the ground plane itself ends at ±HALF
let pedRig=null;          // { torso, head, armL, armR, legL, legR, setColors, commitColors }
let pedTorso=null,pedHead=null,pedArmL=null,pedArmR=null,pedLegL=null,pedLegR=null;
function buildPeds(){
  const N=54;
  pedRig=PED.createRig(scene,N);
  pedTorso=pedRig.torso;pedHead=pedRig.head;pedArmL=pedRig.armL;pedArmR=pedRig.armR;
  pedLegL=pedRig.legL;pedLegR=pedRig.legR;
  const PAL=PED.palettes;
  for(let i=0;i<N;i++){
    // Interior road lines only (1…GRID-1): line 0 and line GRID lie exactly on the border of the ground
    // plane, so a walker put there started out standing in the void outside the map.
    const axis=rng()<.5?0:1;const lineIdx=1+Math.floor(rng()*(GRID-1));const along=rand(-PED_LIMIT,PED_LIMIT);
    const side=(rng()<.5?1:-1)*(ROAD/2+1.8);   // pavement strip between carriageway and building line
    const dir=rng()<.5?1:-1;                   // ±1 along the lane, reversed at the map border
    let x,z,yaw;
    if(axis===0){x=-HALF+lineIdx*CELL+side;z=along;yaw=dir>0?0:Math.PI;}else{z=-HALF+lineIdx*CELL-side;x=along;yaw=dir>0?Math.PI/2:-Math.PI/2;}
    const shirt=PAL.shirt[(rng()*PAL.shirt.length)|0],skin=PAL.skin[(rng()*PAL.skin.length)|0];
    pedRig.setColors(i,shirt,skin);
    peds.push({x,z,yaw,axis,dir,speed:rand(1.1,1.9),phase:rng()*6.28,vx:0,vz:0});   // vx/vz = bump impulse
  }
  pedRig.commitColors();
}

""" + s[b:]

# ---- 8) harness surface: expose the factories + namespaces ----------------
sub(
"""Object.assign(window, {
  // Data — the harness mutates through the same references
  cars, buildings, trees, lampLightPool, player,""",
"""Object.assign(window, {
  // Data — the harness mutates through the same references
  cars, buildings, trees, lampLightPool, player,
  // Asset factory instances (see the guard at the top of the module) + their namespaces
  V, PED, MeridianVehicles, MeridianPedestrians,""",
    "Object.assign surface")

# ---- 9) idempotent 46→52 in the perf comment (in case the earlier script wasn't run) ---
s = s.replace("46 bodies + 4 instanced meshes", "52 bodies + 4 instanced meshes")

p.write_text(s, encoding="utf-8")
print("  patched")
PY

# ========================================================================
say "docs — one-liners naming the new asset files"
"$PY" - <<'PY'
import pathlib
def patch(rel, old, new):
    p = pathlib.Path(rel)
    if not p.exists():
        print(f"  skip {rel} (missing)"); return
    s = p.read_text(encoding="utf-8")
    if old not in s:
        print(f"  skip {rel} (marker absent — already updated?)"); return
    p.write_text(s.replace(old, new, 1), encoding="utf-8")
    print(f"  {rel}")

patch("AGENTS.md",
"""- `assets/` — procedural hero rig (`assets/main_person.js`, a classic `<script>`) and its \
pose workbench (`assets/main_person.html`). Loaded by `game/gta.html`.""",
"""- `assets/` — procedural models loaded by `game/gta.html` as classic `<script>`s (`file://` \
blocks sibling ES-module imports): hero rig `main_person.js` (+ its pose workbench \
`main_person.html`), fleet `vehicles.js`, crowd `pedestrians.js`. Each exposes a \
`createFactory({ THREE, helpers, palettes })` entry point; palettes are load-time mutable.""")

patch("README.md",
"""assets/main_person.js    procedural hero rig (classic <script>, shared with the pose workbench)
assets/main_person.html  pose workbench for the hero rig (not part of the city)""",
"""assets/main_person.js    procedural hero rig (classic <script>, shared with the pose workbench)
assets/main_person.html  pose workbench for the hero rig (not part of the city)
assets/vehicles.js       fleet models: sedan / hatch / suv / pickup / van / bus / artbus / semi
                         (palettes overridable at load — MeridianVehicles.PALETTES)
assets/pedestrians.js    crowd rig: torso / head / arms / legs (MeridianPedestrians.PALETTES)""")

patch("README.md",
"""**One game file = one source of truth.** The city lives entirely in `game/gta.html`; \
the hero rig is the sole extracted asset (`assets/main_person.js`, a classic `<script>` \
loaded by `gta.html` because `file://` blocks sibling ES-module imports), with its pose \
workbench `assets/main_person.html` beside it.""",
"""**One game file = one source of truth.** The city — layout, traffic simulation, camera, \
HUD — lives entirely in `game/gta.html`. Three asset scripts sit beside it and are loaded as \
classic `<script>`s (`file://` blocks sibling ES-module imports): the hero rig \
`assets/main_person.js` with its pose workbench `assets/main_person.html`, the fleet \
`assets/vehicles.js`, and the crowd `assets/pedestrians.js`. Each asset exposes a \
`createFactory({ THREE, helpers, palettes })`; palettes are mutable at load time.""")

patch("methodology/handsoff.md",
"""- `game/gta.html` is the only **game** file. The hero rig is extracted to `assets/main_person.js` \
(loaded as a classic `<script>` because `file://` blocks sibling ES-module imports); its pose \
workbench `assets/main_person.html` sits beside it. No second game HTML/JS/CSS.""",
"""- `game/gta.html` is the only **game** file. Three asset scripts sit beside it, all loaded as \
classic `<script>`s (`file://` blocks sibling ES-module imports): the hero rig \
`assets/main_person.js` (+ its pose workbench `assets/main_person.html`), the fleet \
`assets/vehicles.js`, the crowd `assets/pedestrians.js`. Each exposes \
`createFactory({ THREE, helpers, palettes })`; palettes are mutable at load time. \
No second game HTML/JS/CSS.""")
PY

# ========================================================================
say "done"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git diff --stat || true
  echo
  echo "untracked:"
  git ls-files --others --exclude-standard -- assets/ | sed 's/^/  /'
fi
echo
echo "Next:  ./tools/lint-refs.sh  &&  node harness/check-city.js"
echo "Commit: git add assets/vehicles.js assets/pedestrians.js game/gta.html AGENTS.md README.md methodology/handsoff.md"