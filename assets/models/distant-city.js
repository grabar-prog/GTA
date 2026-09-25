/* assets/models/distant-city.js — силуэт продолжающегося города за границей.
 *
 * Один merged mesh: основание из четырёх широких плит + ~240 коробок-силуэтов
 * в полосе HALF+apron … HALF+apron+130 с каждой стороны. Ни окон, ни теней,
 * ни коллизий — задача держать горизонт занятым, когда fog.far гасит
 * настоящие башни в центре.
 *
 *   MeridianDistantCityKit.build({
 *     THREE, geom, scene, material,
 *     half, apron,
 *     perSide,           // опц., по умолчанию 60
 *     innerGap,          // опц., зазор от края игровой земли, 10 м по умолчанию
 *     ringWidth,         // опц., толщина кольца вдоль радиуса, 130 м по умолчанию
 *     boxScale,          // опц., множитель габаритов коробок, 1.0 по умолчанию
 *     seed,              // опц., по умолчанию 0x51de77
 *     palette,           // опц., HEX[] силуэтов
 *     plateColor,        // опц., цвет плиты-основания
 *   });
 *
 * Распределение — по периметру квадрата ±(INNER..OUTER) × ±(INNER..OUTER),
 * где INNER = half + apron + innerGap, OUTER = INNER + ringWidth.
 * Полярная формула: угол θ ~ [0, 2π), «квадратный радиус» s ~ [INNER, OUTER],
 * точка = s * (cos θ, sin θ) / max(|cos θ|, |sin θ|). Это даёт равномерное
 * распределение вдоль периметра, а не четыре узких полосы по сторонам.
 *
 * rng: локальный mulberry32, основной поток города не трогается. Значит
 * buildDistantCity() можно вызывать в любом месте boot() и расстановка
 * зданий/машин/пешеходов не сдвинется (contracts/README.md §4).
 */
(function () {
  'use strict';

  // Палитра намеренно темнее BODY_HEXES: светлые тона читались как
  // «бумажные коробки» на фоне неба, потому что у силуэта нет ни окон,
  // ни теней, ни подсветки.
  const DISTANT_HEXES = [0x1a2634, 0x141c28, 0x22303e, 0x0f1620, 0x1d2734, 0x243040];
  const PLATE_COLOR = 0x0d1218;

  function mulberry32(a) {
    return function () {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function build(opts) {
    const { THREE, geom, scene, material, half, apron } = opts;
    if (!THREE || !geom || !scene) {
      throw new Error('MeridianDistantCityKit.build: THREE, geom, scene required');
    }
    if (!material) {
      throw new Error('MeridianDistantCityKit.build: material required');
    }
    const perSide   = opts.perSide   != null ? opts.perSide   : 60;
    const seed      = opts.seed      != null ? opts.seed      : 0x51de77;
    const innerGap  = opts.innerGap  != null ? opts.innerGap  : 10;
    const ringWidth = opts.ringWidth != null ? opts.ringWidth : 130;
    // Множитель габаритов коробок. В игре кольцо толщиной 130 м и коробки
    // 12..32 м в поперечнике читаются как силуэт. Если уменьшить кольцо
    // (как в превью), те же коробки превращаются в сплошную стену и
    // перекрывают друг друга в десятки раз. boxScale выравнивает пропорции.
    const boxScale  = opts.boxScale  != null ? opts.boxScale  : 1.0;
    const palette   = (opts.palette && opts.palette.length) ? opts.palette : DISTANT_HEXES;
    const plateColor= opts.plateColor != null ? opts.plateColor : PLATE_COLOR;

    const rngD = mulberry32(seed >>> 0);
    const randD = (lo, hi) => lo + (hi - lo) * rngD();
    const pickHex = () => palette[(rngD() * palette.length) | 0];

    const INNER = half + apron + innerGap;
    const OUTER = INNER + ringWidth;

    const parts = [];

    // Основание: четыре плиты по периметру квадрата.
    const ringIn = half + apron;
    const ringW  = OUTER - ringIn;
    const ringC  = ringIn + ringW / 2;
    parts.push({ geo: new THREE.BoxGeometry(OUTER * 2, 0.15, ringW)
                     .translate(0, 0.075,  ringC), color: plateColor });
    parts.push({ geo: new THREE.BoxGeometry(OUTER * 2, 0.15, ringW)
                     .translate(0, 0.075, -ringC), color: plateColor });
    parts.push({ geo: new THREE.BoxGeometry(ringW, 0.15, OUTER * 2)
                     .translate( ringC, 0.075, 0), color: plateColor });
    parts.push({ geo: new THREE.BoxGeometry(ringW, 0.15, OUTER * 2)
                     .translate(-ringC, 0.075, 0), color: plateColor });

    // Распределение по всему периметру. Идём через полярные координаты:
    // угол θ ~ [0, 2π), «квадратный радиус» s ~ [INNER, OUTER], затем
    // проекция на границу квадрата со стороной s. Это даёт равномерный
    // силуэт вокруг всей игровой площади, а не четыре узкие полосы.
    const total = perSide * 4;
    for (let i = 0; i < total; i++) {
      const theta = randD(0, Math.PI * 2);
      const s = randD(INNER, OUTER);
      const c = Math.cos(theta), si = Math.sin(theta);
      const m = Math.max(Math.abs(c), Math.abs(si));
      const x = s * c / m;
      const z = s * si / m;

      const w = randD(12, 32) * boxScale;
      const d = randD(12, 32) * boxScale;
      const h = randD(10, 70) * boxScale;
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2, z);
      parts.push({ geo: g, color: pickHex() });
    }

    const mesh = new THREE.Mesh(geom.mergeGeometries(parts), material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;   // один mesh на весь горизонт — куллинг только мешает
    scene.add(mesh);
    return mesh;
  }

  window.MeridianDistantCityKit = { build, DISTANT_HEXES, PLATE_COLOR };

  /* ============================================================
     viewer.html: маленькое кольцо вокруг центра сцены.
     ============================================================ */
  if (window.MeridianAssets) {
    MeridianAssets.register({
      id: 'scenery/distant-city',
      label: 'Distant city — horizon ring',
      group: 'Scenery',
      notes: 'Один mesh, ~240 коробок; ~2.5× темнее BODY_HEXES, чтобы сливаться с туманом.',
      makePreview: function (ctx) {
        const { THREE, geom } = ctx;
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.92, metalness: 0.04,
        });
        // В игре DISTANT_HEXES — тёмно-синие: они тонут в тумане и на
        // тёмном фоне viewer.html выглядят как чёрный экран. В превью
        // берём светлую палитру, чтобы силуэт читался, и уменьшаем кольцо,
        // чтобы оно влезало в кадр целиком.
        const PREVIEW_HEXES = [
          0x607888, 0x506878, 0x6a8294, 0x486074, 0x5a7284, 0x647c90,
        ];
        // Маленькое кольцо: half=12, apron=4, ringWidth=10. Размер сцены
        // ~44×44 — вписывается в кадр на близкой камере, near/far не режут.
        // boxScale подобран так, чтобы пропорции совпадали с игровыми:
        // там коробка ~22 м при кольце 130 м (≈0.17), здесь 22·0.22 ≈ 4.8 м
        // при ringWidth=10 (≈0.48 от полуширины — плотнее, но не стена).
        build({
          THREE, geom, scene: group, material: mat,
          half: 12, apron: 4,
          innerGap: 3, ringWidth: 10,
          boxScale: 0.22,
          perSide: 40, seed: 0x51de77,
          palette: PREVIEW_HEXES,
          plateColor: 0x2a3440,
        });
        return group;
      },
    });
  }
})();
