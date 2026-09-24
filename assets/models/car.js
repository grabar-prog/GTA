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
