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
