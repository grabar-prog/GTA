/* assets/models/bus.js — городской и сочленённый автобус.
 *
 * doorSide приходит снаружи, а не выпадает монеткой: rng()-draw остаётся в
 * vehicles.js, где ему и положено быть по контракту детерминизма
 * (methodology/contracts/README.md §4).
 *
 * Палитра кита: stripe — ливрея (полоса под остеклением), busRoof/busRib/
 * busDisplay — элементы крыши и табло. Переопределение до createFactory():
 *   MeridianBusKit.PALETTE.stripe = [0x111111, 0x222222];
 */
(function () {
  'use strict';

  const BUS_TYPES = [
    { name: 'bus',    kind: 'bus', w: .20, L: 12.0, W: 2.55, wr: .52, floorY: .75, roofY: 3.10, bandH: 1.35,
      track: 2.14, axles: [[ 3.4, .52, 1], [-3.6, .52, 1]] },
    { name: 'artbus', kind: 'bus', w: .07, L: 17.5, W: 2.55, wr: .52, floorY: .75, roofY: 3.10, bandH: 1.35, artic: true,
      track: 2.14, axles: [[ 6.6, .52, 1], [-1.4, .52, 1], [-6.6, .52, 1]] }
  ];

  const PALETTE = {
    stripe:     [0xe8e8ea, 0x2c2f34, 0xf0a526, 0x2f7fd1, 0xd23b3b, 0x4fae7a],
    trim:       0x15181d,
    glass:      0x10171f,
    dark:       0x23282f,
    chrome:     0xa9b3bd,
    busRoof:    0x9aa3bd,
    busRib:     0xb4bcc6,
    busDisplay: 0x14181d,
  };

  // Автобус медленнее и осторожнее легковой.
  const DRIVE = { cruise: [6.5, 10.5], acc: 2.8, dec: 8.5 };

  function makeGeometry(G, t, paint, stripe, doorSide, PAL) {
    const { mergeGeometries, boxAt, taperBox, cylZ } = G;
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
      for (let i = 0; i < 4; i++)
        P.push(boxAt(W - .3, h - .16, .1, 0, y0 + (h - .16) / 2,
                     zc - bel / 2 + .18 + i * (bel - .36) / 3, PAL.busRib));
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

  // Фары на углах юбки, задние — на уровне борта, не на крыше.
  function lightLayout(t) {
    return { s: 1.3,
      heads: [[ t.W / 2 - .4, .95,  t.L / 2 + .02], [-t.W / 2 + .4, .95,  t.L / 2 + .02]],
      tails: [[ t.W / 2 - .4, 1.5, -t.L / 2 - .02], [-t.W / 2 + .4, 1.5, -t.L / 2 - .02]] };
  }

  function vehicleWheels(t) {
    const half = t.track / 2, out = [];
    for (const [z, r, w] of t.axles) { out.push([ half, z, r, w]); out.push([-half, z, r, w]); }
    return out;
  }

  function makePreview(ctx) {
    const { THREE, geom } = ctx;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .34, metalness: .55 });
    const group = new THREE.Group();
    const gap = 2.0;
    const total = BUS_TYPES.reduce((s, t) => s + t.W, 0) + (BUS_TYPES.length - 1) * gap;
    let x = -total / 2;
    for (let i = 0; i < BUS_TYPES.length; i++) {
      const t = BUS_TYPES[i];
      const paint  = PALETTE.car ? PALETTE.car[i % PALETTE.car.length] : 0x2f7fd1;
      const stripe = PALETTE.stripe[i % PALETTE.stripe.length];
      // В превью ливрея/краска берутся напрямую: там нужен контролируемый
      // второй цвет, а не общая палитра парка из vehicles.js.
      const paint2 = [0x2f7fd1, 0x3fae6a][i] || paint;
      const m = new THREE.Mesh(makeGeometry(geom, t, paint2, stripe, 1, PALETTE), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.x = x + t.W / 2;
      x += t.W + gap;
      group.add(m);
    }
    return group;
  }

  window.MeridianBusKit = {
    BUS_TYPES, PALETTE, DRIVE,
    makeGeometry, lightLayout, vehicleWheels,
  };

  MeridianAssets.register({
    id: 'vehicle/bus',
    label: 'Bus — city · articulated',
    group: 'Vehicles',
    makePreview,
    notes: 'Двери выбираются per-vehicle coin-флипом в vehicles.js, не здесь.',
  });
})();
