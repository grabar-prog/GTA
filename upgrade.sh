#!/usr/bin/env bash
# fleet_split.sh — разносит палитры, DRIVE и light/wheel-layout по китам;
# vehicles.js остаётся только сборщиком парка. gta.html не трогается.
set -euo pipefail

for f in assets/models/car.js assets/models/bus.js assets/models/semi.js assets/vehicles.js; do
  [[ -f "$f" ]] || { echo "missing: $f"; exit 1; }
done

BK="assets.bak.fleet.$(date +%Y%m%d_%H%M%S)"
cp -r assets "$BK"
echo "backup → $BK"

# --- 1. assets/models/car.js ----------------------------------------------
cat > assets/models/car.js <<'CAR_EOF'
/* assets/models/car.js — кузова легковых: sedan, hatch, SUV, pickup, van.
 *
 * Classic-скрипт. Хелперы берутся из assets/geom.js — сам THREE сюда не приходит.
 * Регистрируется в MeridianAssets → viewer.html подхватывает автоматически.
 *
 * Всё, что относится к этому классу, живёт здесь: палитра, профиль движения,
 * раскладка фар, раскладка колёс. Раньше они лежали одним блобом в
 * assets/vehicles.js — теперь у своего кита.
 *
 * Переопределение палитры (до MeridianVehicles.createFactory):
 *   MeridianCarKit.PALETTE.car = [0x111111, 0x222222];
 */
(function () {
  'use strict';

  // L/W в метрах, h — высота кузова над полом, cz/cl/ch/taper задают greenhouse,
  // wr — радиус колеса (он же клиренс). `kind` выбирает профиль движения.
  const CAR_TYPES = [
    { name: 'sedan',  kind: 'car', w: .112, L: 4.5, W: 1.86, h: .62, cz: -.15, cl: 2.0, ch: .5,  taper: [.84, .70], wr: .35 },
    { name: 'hatch',  kind: 'car', w: .112, L: 3.9, W: 1.80, h: .60, cz:  .10, cl: 1.9, ch: .54, taper: [.82, .58], wr: .32 },
    { name: 'suv',    kind: 'car', w: .112, L: 4.7, W: 1.98, h: .72, cz: -.05, cl: 2.4, ch: .62, taper: [.90, .80], wr: .42, rails: true },
    { name: 'pickup', kind: 'car', w: .112, L: 5.2, W: 1.98, h: .68, cz:  .60, cl: 1.7, ch: .58, taper: [.86, .80], wr: .42, bed: true },
    { name: 'van',    kind: 'car', w: .112, L: 5.0, W: 2.00, h: .98, cz: -.10, cl: 2.6, ch: .72, taper: [.93, .90], wr: .38 }
  ];
  // Осевые пары выводятся из длины кузова один раз, прямо в ките.
  for (const t of CAR_TYPES) {
    t.track = t.W - .08;
    t.axles = [[t.L * .3, t.wr, 1], [-t.L * .3, t.wr, 1]];
  }

  // Цвета кита. Общие trim/glass/dark/chrome намеренно продублированы у трёх
  // китов: хочется уметь, скажем, покрасить стекло автобуса иначе, чем стекло
  // легковой. При слиянии в vehicles.js одинаковые ключи берут значение
  // последнего кита — при равных дефолтах это невидимо.
  const PALETTE = {
    car: [0xd23b3b, 0x2f7fd1, 0xe8e8ea, 0x2c2f34, 0xf0a526, 0x3fae6a, 0xb9c2cc, 0x8a4bd0, 0x1d2733, 0xdfe6ee],
    trim: 0x15181d, glass: 0x10171f, dark: 0x23282f, chrome: 0xa9b3bd,
  };

  // Профиль движения класса «car». Все пять типов едут одинаково — разница
  // между sedan и semi задаётся на уровне класса, а не конкретной модели.
  const DRIVE = { cruise: [7, 14], acc: 4.2, dec: 11 };

  // Body = underbody + tapered shell + greenhouse + roof plate + bumpers/grille/
  // rockers/mirrors/handles, всё слито в ОДИН vertex-coloured буфер.
  function makeGeometry(G, t, paint, PAL) {
    const { mergeGeometries, boxAt, taperBox } = G;
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

  // Где фары. Чистая геометрия на полях типа, палитра не нужна.
  function lightLayout(t) {
    const ly = t.wr * .95 + t.h - t.h * .26;
    return { s: 1,
      heads: [[ t.W / 2 - .34, ly,  t.L / 2 - .04], [-t.W / 2 + .34, ly,  t.L / 2 - .04]],
      tails: [[ t.W / 2 - .34, ly, -t.L / 2 + .04], [-t.W / 2 + .34, ly, -t.L / 2 + .04]] };
  }

  // [x, z, radius, widthScale] — зеркалится на обе стороны кузова.
  function vehicleWheels(t) {
    const half = t.track / 2, out = [];
    for (const [z, r, w] of t.axles) { out.push([ half, z, r, w]); out.push([-half, z, r, w]); }
    return out;
  }

  function makePreview(ctx) {
    const { THREE, geom } = ctx;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .34, metalness: .55 });
    const group = new THREE.Group();
    const gap = 0.9;
    const total = CAR_TYPES.reduce((s, t) => s + t.W, 0) + (CAR_TYPES.length - 1) * gap;
    let x = -total / 2;
    for (let i = 0; i < CAR_TYPES.length; i++) {
      const t = CAR_TYPES[i];
      const paint = PALETTE.car[i % PALETTE.car.length];
      const m = new THREE.Mesh(makeGeometry(geom, t, paint, PALETTE), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.x = x + t.W / 2;
      x += t.W + gap;
      group.add(m);
    }
    return group;
  }

  window.MeridianCarKit = {
    CAR_TYPES, PALETTE, DRIVE,
    makeGeometry, lightLayout, vehicleWheels,
  };

  MeridianAssets.register({
    id: 'vehicle/car',
    label: 'Car — sedan · hatch · SUV · pickup · van',
    group: 'Vehicles',
    makePreview,
    notes: 'Один merged body на машину; краска — vertex-color, перекраска бесплатна.',
  });
})();
CAR_EOF

# --- 2. assets/models/bus.js ----------------------------------------------
cat > assets/models/bus.js <<'BUS_EOF'
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
BUS_EOF

# --- 3. assets/models/semi.js ---------------------------------------------
cat > assets/models/semi.js <<'SEMI_EOF'
/* assets/models/semi.js — евро-фура: дневная кабина + шторный полуприцеп.
 *
 * trGap — зазор бампер→передняя часть прицепа; длина прицепа = L - trGap.
 * Цвет шторы (curt) и краска кабины (paint) приходят снаружи.
 *
 * Палитра кита: curtain — цвет шторы, marker — угловые габариты.
 *   MeridianSemiKit.PALETTE.curtain = [0x111111, 0x222222];
 */
(function () {
  'use strict';

  const TRUCK_TYPES = [
    { name: 'semi', kind: 'semi', w: .17, L: 16.4, W: 2.55, wr: .55, cabL: 2.8, trGap: 3.3, trailerW: 2.60,
      trFloor: 1.42, trTop: 4.00, track: 2.05,
      axles: [[ 6.4, .55, 1], [ 2.5, .55, 1.75], [-5.8, .52, 1.75], [-6.9, .52, 1.75]] }
  ];

  const PALETTE = {
    curtain: [0xd8dde3, 0xe8e8ea, 0x2f5f96, 0xb03a34, 0x3c7d54, 0x8f9aa6],
    trim:    0x15181d,
    glass:   0x10171f,
    dark:    0x23282f,
    chrome:  0xa9b3bd,
    busRoof: 0x9aa3bd,
    busRib:  0xb4bcc6,
    marker:  0xd9a94a,
  };

  // Фура — самая тяжёлая в парке.
  const DRIVE = { cruise: [6, 9], acc: 2.1, dec: 7 };

  function makeGeometry(G, t, paint, curt, PAL) {
    const { mergeGeometries, boxAt, taperBox, cylZ, THREE } = G;
    const P = [], W = t.W, L = t.L, fz = L / 2;
    const cabF = fz, cabR = fz - t.cabL, cabBot = 1.15, cabTop = 3.60;
    const trZ1 = fz - t.trGap, trZ0 = -fz, trL = trZ1 - trZ0, trC = (trZ0 + trZ1) / 2, tw = t.trailerW;
    const boxH = t.trTop - t.trFloor, boxC = (t.trTop + t.trFloor) / 2;
    const railF = fz - 1.6, railR = trZ0;
    P.push(boxAt(1.3, .2, railF - railR, 0, 1.0, (railF + railR) / 2, PAL.trim));
    P.push(taperBox(W, cabTop - cabBot, t.cabL - .06, 0, (cabBot + cabTop) / 2,
                    (cabF + cabR) / 2 + .03, .97, .98, paint));
    P.push(boxAt(W - .04, .4, t.cabL * .75, 0, cabTop + .2, cabR + t.cabL * .375, paint));
    P.push(boxAt(tw, .1, trL + .1, 0, t.trTop + .06, trC, PAL.busRoof));
    P.push(boxAt(W - .45, 1.45, .12, 0, cabTop - 1.05, cabF + .03, PAL.glass));
    P.push(boxAt(W - .2, .2, .3, 0, cabTop + .02, cabF + .06, PAL.trim));
    for (const sx of [1, -1]) P.push(boxAt(.12, .95, 1.45, sx * (W / 2 + .04), cabTop - 1.1, cabR + .85, PAL.glass));
    P.push(cylZ(.3, 1.2,  .78, .92, 4.3, 14, PAL.chrome));
    P.push(cylZ(.3, 1.2, -.78, .92, 4.3, 14, PAL.chrome));
    P.push(boxAt(1.9, .12, 2.0, 0, 1.16, trZ1 - 1.6, PAL.dark));
    // Exhaust stack — единственное место, где нужен сам THREE (голый
    // CylinderGeometry с разными радиусами; cylY из geom.js даёт только равные).
    P.push({ geo: new THREE.CylinderGeometry(.09, .11, 1.7, 10)
                     .translate(W / 2 - .25, 2.05, cabR - .3), color: PAL.chrome });
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

  // Фары на передке тягача, задний кластер — высоко на дверях прицепа,
  // а не на тракторе (иначе светил бы внутрь шторы).
  function lightLayout(t) {
    return { s: 1.15,
      heads: [[ t.W / 2 - .4, 1.05,  t.L / 2 + .02], [-t.W / 2 + .4, 1.05,  t.L / 2 + .02]],
      tails: [[ t.trailerW / 2 - .3, 1.6, -t.L / 2 - .08], [-t.trailerW / 2 + .3, 1.6, -t.L / 2 - .08]] };
  }

  function vehicleWheels(t) {
    const half = t.track / 2, out = [];
    for (const [z, r, w] of t.axles) { out.push([ half, z, r, w]); out.push([-half, z, r, w]); }
    return out;
  }

  function makePreview(ctx) {
    const { THREE, geom } = ctx;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .34, metalness: .55 });
    const m = new THREE.Mesh(makeGeometry(geom, TRUCK_TYPES[0], 0xd23b3b, PALETTE.curtain[0], PALETTE), mat);
    m.castShadow = true; m.receiveShadow = true;
    const group = new THREE.Group(); group.add(m);
    return group;
  }

  window.MeridianSemiKit = {
    TRUCK_TYPES, PALETTE, DRIVE,
    makeGeometry, lightLayout, vehicleWheels,
  };

  MeridianAssets.register({
    id: 'vehicle/semi',
    label: 'Semi — day cab · curtain-sider',
    group: 'Vehicles',
    makePreview,
  });
})();
SEMI_EOF

# --- 4. assets/vehicles.js — сборщик парка --------------------------------
cat > assets/vehicles.js <<'VEH_EOF'
/* assets/vehicles.js — сборщик парка.
 *
 * Здесь НЕ живут модели. Каждая модель — свой файл в assets/models/:
 *   • car.js   — легковые, палитра CAR_PALETTE, DRIVE, lightLayout, vehicleWheels
 *   • bus.js   — автобусы,   палитра BUS_PALETTE, DRIVE, lightLayout, vehicleWheels
 *   • semi.js  — фуры,       палитра SEMI_PALETTE, DRIVE, lightLayout, vehicleWheels
 *
 * Этот файл знает только то, что разделяет весь парк:
 *   • как составить список типов и их веса         → VEH_TYPES, VEH_W, pickVehicleType
 *   • как выглядит ОДНО колесо на всех             → makeWheelGeometry
 *   • один общий LENS_GEO на head/tail всех тел    → LENS_GEO
 *   • как скомпоновать PAL из палитр трёх китов    → createFactory
 *   • куда делегировать lightLayout / vehicleWheels по t.kind
 *
 * Палитры переопределяются у китов, а не здесь:
 *   MeridianCarKit.PALETTE.car = [0x111111, 0x222222];   // до createFactory()
 *   MeridianBusKit.PALETTE.stripe = [...];
 *   MeridianSemiKit.PALETTE.curtain = [...];
 * Обратная совместимость: MeridianVehicles.PALETTES — read-only снимок
 * дефолтов; писать в него бесполезно.
 *
 * Детерминизм: pickVehicleType(rng) и монетка двери автобуса внутри
 * makeVehicleGeometry(t, paint, tint, rng) сохраняют свои позиции в rng-потоке
 * (methodology/contracts/README.md §4).
 *
 * gta.html читает эту фабрику тем же способом, что и раньше — публичная форма
 * MeridianVehicles.createFactory не менялась.
 */
(function () {
  'use strict';

  // Цвета колеса — единственная палитра, которая действительно общая на весь
  // парк (sedan, bus и semi катаются на одном и том же чёрном с хромом).
  const WHEEL_PALETTE = { tyre: 0x141619, hub: 0x5d666f };

  // Состав парка берётся у китов. Порядок = порядок объявления китов, и он
  // участвует в pickVehicleType — менять осознанно.
  const CAR_TYPES   = MeridianCarKit.CAR_TYPES;
  const BUS_TYPES   = MeridianBusKit.BUS_TYPES;
  const TRUCK_TYPES = MeridianSemiKit.TRUCK_TYPES;
  const VEH_TYPES   = [...CAR_TYPES, ...BUS_TYPES, ...TRUCK_TYPES];
  const VEH_W       = VEH_TYPES.reduce((s, t) => s + t.w, 0);

  // Профили движения по классам. gta.html читает этот объект как DRIVE[kind].
  const DRIVE = {
    car:  MeridianCarKit .DRIVE,
    bus:  MeridianBusKit .DRIVE,
    semi: MeridianSemiKit.DRIVE,
  };

  // Свежий снимок дефолтных палитр — для чтения. Писать сюда бессмысленно:
  // чтобы перекрасить, мутируйте PALETTE у соответствующего кита.
  function snapshotPalettes() {
    return Object.assign({},
      MeridianCarKit.PALETTE,
      MeridianBusKit.PALETTE,
      MeridianSemiKit.PALETTE,
      WHEEL_PALETTE);
  }

  // Weighted pick. Consumes exactly one rng() per call — that draw's position in
  // the caller's generation order is contractual (contracts/README.md §4).
  function pickVehicleType(rng) {
    let r = rng() * VEH_W;
    for (const t of VEH_TYPES) { r -= t.w; if (r <= 0) return t; }
    return VEH_TYPES[VEH_TYPES.length - 1];
  }

  // Делегаты по kind — единственное место, где сборщик «знает» про киты.
  function lightLayout(t)   { return (kitFor(t)).lightLayout(t); }
  function vehicleWheels(t) { return (kitFor(t)).vehicleWheels(t); }
  function kitFor(t) {
    if (t.kind === 'bus')  return MeridianBusKit;
    if (t.kind === 'semi') return MeridianSemiKit;
    return MeridianCarKit;
  }

  function createFactory(opts) {
    const THREE = opts.THREE;
    if (!THREE) throw new Error('MeridianVehicles.createFactory: THREE is required');
    const G = opts.helpers || {};
    for (const need of ['mergeGeometries', 'boxAt', 'taperBox', 'cylX', 'cylZ']) {
      if (typeof G[need] !== 'function') {
        throw new Error('MeridianVehicles.createFactory: helpers.' + need + ' is required');
      }
    }
    const { mergeGeometries, cylX } = G;

    // Единый PAL: kit-палитры + колесо + опциональный override.
    // Ключи, встречающиеся у нескольких китов (trim/glass/dark/chrome),
    // разрешаются в пользу последнего — при равных дефолтах это невидимо,
    // а если кто-то переопределил, он это сделал осознанно.
    const PAL = Object.assign({},
      MeridianCarKit.PALETTE,
      MeridianBusKit.PALETTE,
      MeridianSemiKit.PALETTE,
      WHEEL_PALETTE,
      opts.palettes || {});

    // Одна геометрия линзы на head и tail всех тел — экономит буфер.
    const LENS_GEO = new THREE.BoxGeometry(.34, .15, .12);

    // Тонкие обёртки: кузов делает кит, PAL передаётся ему собранным выше.
    const makeCarGeometry  = (t, paint)                => MeridianCarKit .makeGeometry(G, t, paint, PAL);
    const makeBusGeometry  = (t, paint, stripe, door)  => MeridianBusKit .makeGeometry(G, t, paint, stripe, door, PAL);
    const makeSemiGeometry = (t, paint, curt)          => MeridianSemiKit.makeGeometry(G, t, paint, curt, PAL);

    // Монетка двери живёт здесь — её позиция в rng-потоке контрактна.
    function makeVehicleGeometry(t, paint, tint, rng) {
      if (t.kind === 'bus')  return makeBusGeometry(t, paint, tint, rng() < .5 ? 1 : -1);
      if (t.kind === 'semi') return makeSemiGeometry(t, paint, tint);
      return makeCarGeometry(t, paint);
    }

    // Unit wheel (радиус 1) — один InstancedMesh на весь парк, размеры через
    // instance-scale. X — ось ширины шины: widthScale > 1 даёт сдвоенные колёса.
    function makeWheelGeometry() {
      const r = 1, w = r * .62;
      return mergeGeometries([
        cylX(r, w, 0, 0, 0, 20, PAL.tyre),
        cylX(.64, w + .03, 0, 0, 0, 16, PAL.chrome),
        cylX(.2, w + .06, 0, 0, 0, 10, PAL.hub),
      ]);
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
    createFactory, pickVehicleType,
    CAR_TYPES, BUS_TYPES, TRUCK_TYPES, VEH_TYPES, VEH_W, DRIVE,
    // Read-only снимок дефолтов. Для переопределения — мутируйте PALETTE у кита.
    get PALETTES() { return snapshotPalettes(); },
  };
})();
VEH_EOF

# --- 5. итог --------------------------------------------------------------
echo
echo "=== Готово. Раскладка: ==="
for f in assets/models/car.js assets/models/bus.js assets/models/semi.js assets/vehicles.js; do
  printf "  %-32s %5s строк\n" "$f" "$(wc -l < "$f")"
done
echo
echo "Бэкап: $BK"
echo
echo "Проверка:"
echo "  • assets/viewer.html — Car / Bus / Semi показываются как раньше;"
echo "  • game/gta.html      — трафик, скорости, свет фар — без изменений;"
echo "  • перекрасить парк: MeridianCarKit.PALETTE.car = [...] до createFactory()."