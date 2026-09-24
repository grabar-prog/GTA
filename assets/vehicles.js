/* assets/vehicles.js — фабрика транспорта, собранная из трёх body-китов.
 *
 * Геометрия кузовов живёт в assets/models/{car,bus,semi}.js. Здесь — только
 * то, что разделяет весь парк: палитры, состав, колесо, разметка фар и
 * профили движения. Публичная форма MeridianVehicles.createFactory не меняется.
 *
 * Детерминизм: pickVehicleType(rng) и монетка двери автобуса внутри
 * makeVehicleGeometry(t, paint, tint, rng) сохраняют свои позиции в rng-потоке
 * (methodology/contracts/README.md §4).
 */
(function () {
  'use strict';

  const PALETTES = {
    car:     [0xd23b3b, 0x2f7fd1, 0xe8e8ea, 0x2c2f34, 0xf0a526, 0x3fae6a, 0xb9c2cc, 0x8a4bd0, 0x1d2733, 0xdfe6ee],
    stripe:  [0xe8e8ea, 0x2c2f34, 0xf0a526, 0x2f7fd1, 0xd23b3b, 0x4fae7a],
    curtain: [0xd8dde3, 0xe8e8ea, 0x2f5f96, 0xb03a34, 0x3c7d54, 0x8f9aa6],
    trim: 0x15181d, glass: 0x10171f, dark: 0x23282f, chrome: 0xa9b3bd,
    tyre: 0x141619, hub: 0x5d666f,
    busRoof: 0x9aa3bd, busRib: 0xb4bcc6, busDisplay: 0x14181d, marker: 0xd9a94a,
  };

  const CAR_TYPES   = MeridianCarKit.CAR_TYPES;
  const BUS_TYPES   = MeridianBusKit.BUS_TYPES;
  const TRUCK_TYPES = MeridianSemiKit.TRUCK_TYPES;
  const VEH_TYPES   = [...CAR_TYPES, ...BUS_TYPES, ...TRUCK_TYPES];
  const VEH_W       = VEH_TYPES.reduce((s, t) => s + t.w, 0);
  for (const t of CAR_TYPES) { t.track = t.W - .08; t.axles = [[t.L * .3, t.wr, 1], [-t.L * .3, t.wr, 1]]; }

  const DRIVE = {
    car:  { cruise: [7, 14],     acc: 4.2, dec: 11 },
    bus:  { cruise: [6.5, 10.5], acc: 2.8, dec: 8.5 },
    semi: { cruise: [6, 9],      acc: 2.1, dec: 7 },
  };

  function pickVehicleType(rng) {
    let r = rng() * VEH_W;
    for (const t of VEH_TYPES) { r -= t.w; if (r <= 0) return t; }
    return VEH_TYPES[VEH_TYPES.length - 1];
  }

  function createFactory(opts) {
    const THREE = opts.THREE;
    if (!THREE) throw new Error('MeridianVehicles.createFactory: THREE is required');
    const G = opts.helpers || {};
    for (const need of ['mergeGeometries', 'boxAt', 'taperBox', 'cylX', 'cylZ']) {
      if (typeof G[need] !== 'function') throw new Error('MeridianVehicles.createFactory: helpers.' + need + ' is required');
    }
    const { mergeGeometries, cylX } = G;
    const PAL = Object.assign({}, PALETTES, opts.palettes || {});
    const LENS_GEO = new THREE.BoxGeometry(.34, .15, .12);

    const makeCarGeometry  = (t, paint) => MeridianCarKit.makeGeometry(G, t, paint, PAL);
    const makeBusGeometry  = (t, paint, stripe, doorSide) =>
      MeridianBusKit.makeGeometry(G, t, paint, stripe, doorSide, PAL);
    const makeSemiGeometry = (t, paint, curt) => MeridianSemiKit.makeGeometry(G, t, paint, curt, PAL);

    // Монетка двери живёт здесь — её позиция в rng-потоке контрактна.
    function makeVehicleGeometry(t, paint, tint, rng) {
      if (t.kind === 'bus')  return makeBusGeometry(t, paint, tint, rng() < .5 ? 1 : -1);
      if (t.kind === 'semi') return makeSemiGeometry(t, paint, tint);
      return makeCarGeometry(t, paint);
    }

    function makeWheelGeometry() {
      const r = 1, w = r * .62;
      return mergeGeometries([
        cylX(r, w, 0, 0, 0, 20, PAL.tyre),
        cylX(.64, w + .03, 0, 0, 0, 16, PAL.chrome),
        cylX(.2, w + .06, 0, 0, 0, 10, PAL.hub),
      ]);
    }

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
