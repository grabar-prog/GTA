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
      if (t.kind === 'bus') {
        const r = makeBusGeometry(t, paint, tint, rng() < .5 ? 1 : -1);
        return { body: r.body, glass: r.glass };
      }
      if (t.kind === 'semi') return { body: makeSemiGeometry(t, paint, tint) };
      return { body: makeCarGeometry(t, paint) };
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
