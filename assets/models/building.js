/* assets/models/building.js — процедурные здания, семь типов, три меша.
 *
 * Каждое здание = три merged buffer:
 *   • walls     — корпус, крыша, двери, навесы, кусты, штакетник, техника
 *                 на крыше. Один материал, vertex colors.
 *   • glassLit  — окна, которые «горят» ночью. Яркий emissive.
 *   • glassDark — окна без света. Тёмное стекло, без emissive.
 *
 * Разбиение фиксировано на этапе сборки: каждое окно попадает в lit или
 * dark по хешу от его локальной позиции + позиции здания. Значит один и
 * тот же дом всегда даёт один и тот же узор освещённых окон, а разные
 * дома — разный. Днём эмиссия lit-материала выключена через updateCycle,
 * и оба типа выглядят как обычное тёмное стекло.
 *
 *   MeridianBuildingKit.add({
 *     THREE, geom, scene,
 *     materials: { solid, glass, glassDark },
 *     cx, cz, w, d, h,
 *     rng,              // основной rng города — НЕ трогается
 *     buildings,        // массив коллизий {x,z,hw,hd}
 *     type,             // опц.: 'cottage' | 'house' | ... | 'tower'
 *     level,            // опц.: 0..2
 *     worldHalf,        // опц.: радиус для pickType()
 *     litRatio,         // опц.: доля горящих окон, по умолчанию 0.4
 *   });
 *
 * Детерминизм. Основной rng не трогается вообще — локальный mulberry32
 * сидируется хешем (cx, cz). Расстановка зданий сохраняется, каждый
 * адрес всегда даёт один и тот же силуэт и тот же узор окон.
 *
 * Legacy: makeShellGeometry() / makeGlassGeometry() без изменений, доступны
 * через add({ legacy: true }).
 */
(function () {
  'use strict';

  /* ============================================================
     Палитра
     ============================================================ */
  const PAL = {
    office:      [0x9aa4ae, 0x8a949e, 0xa8b2bc, 0x7a8894, 0xb8c0c8],
    residential: [0xb89070, 0xc8a080, 0xa87858, 0xc0a890, 0x987a68],
    shop:        [0xc0b8a8, 0xd0c8b8, 0xb0a898, 0xd8d0c0],
    house:       [0xe8dcc8, 0xd8c8b0, 0xe0c8b0, 0xd0b898, 0xe8d0b8],
    roof:        [0x6a3a30, 0x4a5560, 0x5a4530, 0x3a3540, 0x803a2a, 0x4a3530],
    trim:        0x252830,
    wood:        0x6a4a2a,
    chimney:     0x8a6050,
    door:        [0x8a3a2a, 0x2a4a6a, 0x6a4a2a, 0x3a6a4a, 0x4a2a3a],
    fence:       [0xe8e4dc, 0xdcd0b8, 0x4a5a6a],
    garden:      [0x4a7a3a, 0x5a8a48, 0x3a6a30, 0x4a8a3a],
    bush:        [0x3a6a30, 0x4a7a3a, 0x2a5a24, 0x4a8a38],
    glass:       0x1e2a34,
    glassLight:  0x5a7a96,
    pavement:    0x8a8880,
    awning:      [0x8a2a2a, 0x2a4a8a, 0x2a6a3a, 0xc47a2a],
    ac:          0x6a6a6a,
    water:       0x8a8070,
    antenna:     0x3a3a3a,
    beacon:      0xff2a2a,
  };

  const BODY_HEXES = [0x8a94a2, 0x6f7d8c, 0xb3b9c1, 0x5c6b7a, 0x9aa0a8, 0x7d8894];
  const ROOF_HEX = 0x2c3138;
  const TRIM_HEX = 0x14171d;

  const DEFAULT_LIT_RATIO = 0.40;

  /* ============================================================
     Локальный rng + хеш позиции
     ============================================================ */
  function mulberry32(a) {
    return function () {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashSeed(cx, cz, salt) {
    let h = (salt | 0) >>> 0;
    h = (h * 73856093 ^ (cx * 1000 | 0) * 19349663 ^ (cz * 1000 | 0) * 83492791) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h >>> 0;
  }
  function pick(rng, arr) { return arr[(rng() * arr.length) | 0]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ============================================================
     Функция «окно горит?». Каждому окну даётся его локальная
     позиция в метрах; результат — детерминированный бит.
     FNV-1a с позицией здания в seed и позицией окна в каждом шаге.
     ============================================================ */
  function makeLitFn(seed, ratio) {
    const inv = 1 / 16777216;
    return function (lx, ly, lz) {
      let h = seed >>> 0;
      h = Math.imul(h ^ ((lx * 31 | 0) & 0xffff), 16777619) >>> 0;
      h = Math.imul(h ^ ((ly * 37 | 0) & 0xffff), 16777619) >>> 0;
      h = Math.imul(h ^ ((lz * 41 | 0) & 0xffff), 16777619) >>> 0;
      return ((h >>> 8) * inv) < ratio;
    };
  }

  /* ============================================================
     Двускатная крыша-призма
     ============================================================ */
  /* ============================================================
     Крыша-призма из явных треугольников. ExtrudeGeometry оказался
     нестабилен: одна из вершин уезжала на миллионы метров по Z
     (проверено диагностикой — size Z = 16722535 м). Здесь 6 вершин
     и 8 треугольников, всё задано руками, никакой скрытой математики.

     Соглашение: конёк идёт вдоль X, скаты — по Z, база — на y=0.
     Вершины:
       A = (-w/2, 0, -d/2)   B = ( w/2, 0, -d/2)
       C = ( w/2, 0,  d/2)   D = (-w/2, 0,  d/2)
       E = (-w/2, h,  0  )   F = ( w/2, h,  0  )
     ============================================================ */
  function gable(THREE, w, d, h, x, y, z, color) {
    const hw = w / 2, hd = d / 2;
    const A = [-hw, 0, -hd], B = [ hw, 0, -hd];
    const C = [ hw, 0,  hd], D = [-hw, 0,  hd];
    const E = [-hw, h,  0 ], F = [ hw, h,  0 ];
    const tris = [
      // Низ: два треугольника прямоугольника ABCD, нормаль вниз.
      [A, B, C], [A, C, D],
      // Левый фронтон: треугольник ADE, нормаль в -X.
      [A, D, E],
      // Правый фронтон: треугольник BFC, нормаль в +X.
      [B, F, C],
      // Задний скат: AEF + AFB, нормаль в -Z и +Y.
      [A, E, F], [A, F, B],
      // Передний скат: DCF + DFE, нормаль в +Z и +Y.
      [D, C, F], [D, F, E],
    ];
    const pos = new Float32Array(tris.length * 9);
    let k = 0;
    for (const tri of tris) {
      for (const v of tri) {
        pos[k++] = v[0];
        pos[k++] = v[1];
        pos[k++] = v[2];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // Нормали per-face: геометрия non-indexed, поэтому каждая вершина
    // получает нормаль своего единственного треугольника.
    geo.computeVertexNormals();
    geo.translate(x, y, z);
    return { geo, color };
  }

  /* ============================================================
     Семь builders.

     Сигнатура: (THREE, G, rng, hintW, hintD, hintH, isLit) → {
       walls, glassLit, glassDark, w, d, h
     }
     ============================================================ */

  /* --- 1. Cottage --- */
  function buildCottage(THREE, G, rng, hintW, hintD, hintH, isLit) {
    const { boxAt, sphAt } = G;
    const w = clamp(hintW, 6.5, 10);
    const d = clamp(hintD, 6, 9.5);
    const h = clamp(3.0 + (hintH - 3) * 0.15, 2.8, 4.2);
    const wall = pick(rng, PAL.house);
    const roofC = pick(rng, PAL.roof);
    const walls = [], glassLit = [], glassDark = [];

    const win = (geo, x, y, z) => {
      (isLit(x, y, z) ? glassLit : glassDark).push(geo);
    };

    walls.push(boxAt(w, h, d, 0, h / 2, 0, wall));
    walls.push(boxAt(w + 0.25, 0.35, d + 0.25, 0, 0.175, 0, PAL.trim));
    walls.push(gable(THREE, w + 0.6, d + 0.6, 2.2, 0, h, 0, roofC));
    walls.push(boxAt(0.7, 1.9, 0.7, w / 2 - 1, h + 2.2 - 0.4, -d / 4, PAL.chimney));
    walls.push(boxAt(1.0, 2.0, 0.1, 0, 1.0, d / 2 + 0.05, pick(rng, PAL.door)));

    const wx1 = -w / 2 + 1.4;
    const wx2 =  w / 2 - 1.4;
    win(boxAt(1.1, 1.0, 0.1, wx1, 1.7, d / 2 + 0.05, PAL.glassLight), wx1, 1.7, d / 2 + 0.05);
    win(boxAt(1.1, 1.0, 0.1, wx2, 1.7, d / 2 + 0.05, PAL.glassLight), wx2, 1.7, d / 2 + 0.05);
    win(boxAt(0.1, 1.0, 1.1, w / 2 + 0.05, 1.7, 0, PAL.glassLight), w / 2 + 0.05, 1.7, 0);

    walls.push(boxAt(1.6, 0.1, 1.0, 0, 2.5, d / 2 + 0.5, roofC));
    walls.push(boxAt(0.1, 2.5, 0.1, -0.7, 1.25, d / 2 + 0.9, PAL.wood));
    walls.push(boxAt(0.1, 2.5, 0.1,  0.7, 1.25, d / 2 + 0.9, PAL.wood));

    const gz = d / 2 + 2.4;
    walls.push(boxAt(w + 2, 0.25, 2.0, 0, 0.125, gz, pick(rng, PAL.garden)));
    // sphAt signature: (rx, ry, rz, x, y, z, color, seg) — три радиуса,
    // потом позиция. Кусты ниже — эллипсоид, чуть сплюснутый по X и Z.
    for (let i = 0; i < 4; i++) {
      const cx = -w / 2 + 0.6 + i * (w + 1.6) / 3.5;
      const r  = 0.35 + rng() * 0.15;
      walls.push(sphAt(r, r, r, cx, 0.55, gz, pick(rng, PAL.bush), 8));
    }
    const fz = gz + 1.2, fh = 0.75, fc = pick(rng, PAL.fence);
    for (let i = 0; i < 20; i++) {
      walls.push(boxAt(0.07, fh, 0.07, -w / 2 - 1 + i * (w + 2) / 19, fh / 2, fz, fc));
    }
    walls.push(boxAt(w + 2, 0.06, 0.07, 0, fh * 0.75, fz, fc));

    return { walls, glassLit, glassDark, w: w + 2, d: d + 3.6, h: h + 2.2 };
  }

  /* --- 2. House --- */
  function buildHouse(THREE, G, rng, hintW, hintD, hintH, isLit) {
    const { boxAt, sphAt } = G;
    const w = clamp(hintW, 6, 9);
    const d = clamp(hintD, 5.5, 8);
    const h = clamp(5.4 + (hintH - 6) * 0.2, 5.0, 7.0);
    const wall = pick(rng, PAL.house);
    const roofC = pick(rng, PAL.roof);
    const walls = [], glassLit = [], glassDark = [];

    const win = (geo, x, y, z) => {
      (isLit(x, y, z) ? glassLit : glassDark).push(geo);
    };

    walls.push(boxAt(w, h, d, 0, h / 2, 0, wall));
    walls.push(boxAt(w + 0.3, 0.4, d + 0.3, 0, 0.2, 0, PAL.trim));
    walls.push(gable(THREE, w + 0.6, d + 0.6, 2.4, 0, h, 0, roofC));
    walls.push(boxAt(0.8, 2.2, 0.8, w / 2 - 0.8, h + 2.4 - 0.5, -d / 4, PAL.chimney));
    walls.push(boxAt(1.0, 2.0, 0.1, 0, 1.0, d / 2 + 0.05, pick(rng, PAL.door)));

    for (const fy of [1.8, 4.4]) {
      const xL = -w / 2 + 1.4, xR = w / 2 - 1.4;
      win(boxAt(1.1, 1.15, 0.1, xL, fy, d / 2 + 0.05, PAL.glassLight), xL, fy, d / 2 + 0.05);
      win(boxAt(1.1, 1.15, 0.1, xR, fy, d / 2 + 0.05, PAL.glassLight), xR, fy, d / 2 + 0.05);
      win(boxAt(0.1, 1.15, 1.1, -w / 2 - 0.05, fy, 0, PAL.glassLight), -w / 2 - 0.05, fy, 0);
      win(boxAt(0.1, 1.15, 1.1,  w / 2 + 0.05, fy, 0, PAL.glassLight),  w / 2 + 0.05, fy, 0);
    }

    walls.push(boxAt(1.6, 0.1, 0.9, 0, 2.4, d / 2 + 0.45, roofC));
    walls.push(boxAt(0.1, 2.4, 0.1, -0.7, 1.2, d / 2 + 0.8, PAL.wood));
    walls.push(boxAt(0.1, 2.4, 0.1,  0.7, 1.2, d / 2 + 0.8, PAL.wood));

    const gz = d / 2 + 1.9;
    walls.push(boxAt(w + 2, 0.25, 1.8, 0, 0.125, gz, pick(rng, PAL.garden)));
    for (let i = 0; i < 3; i++) {
      const cx = -w / 2 + 0.7 + i * (w + 1) / 2.2;
      const r  = 0.4 + rng() * 0.15;
      walls.push(sphAt(r, r, r, cx, 0.55, gz, pick(rng, PAL.bush), 8));
    }
    const fz = gz + 1.1, fh = 0.7, fc = pick(rng, PAL.fence);
    for (let i = 0; i < 18; i++) {
      walls.push(boxAt(0.07, fh, 0.07, -w / 2 - 1 + i * (w + 2) / 17, fh / 2, fz, fc));
    }
    walls.push(boxAt(w + 2, 0.06, 0.07, 0, fh * 0.75, fz, fc));

    return { walls, glassLit, glassDark, w: w + 2, d: d + 3.2, h: h + 2.4 };
  }

  /* --- 3. Rowhouse --- */
  function buildRowhouse(THREE, G, rng, hintW, hintD, hintH, isLit) {
    const { boxAt } = G;
    const units = 4;
    const unitW = clamp(hintW / units, 3.2, 4.0);
    const d = clamp(hintD, 6.5, 8);
    const h = clamp(7.5 + (hintH - 8) * 0.25, 7.0, 10);
    const walls = [], glassLit = [], glassDark = [];

    const win = (geo, x, y, z) => {
      (isLit(x, y, z) ? glassLit : glassDark).push(geo);
    };

    for (let u = 0; u < units; u++) {
      const x0 = -units * unitW / 2 + u * unitW + unitW / 2;
      walls.push(boxAt(unitW - 0.05, h, d, x0, h / 2, 0, pick(rng, PAL.house)));
      walls.push(gable(THREE, unitW + 0.05, d + 0.3, 1.3, x0, h, 0, pick(rng, PAL.roof)));
      walls.push(boxAt(0.9, 2.0, 0.1, x0, 1.0, d / 2 + 0.05, pick(rng, PAL.door)));
      walls.push(boxAt(1.2, 0.15, 0.4, x0, 0.075, d / 2 + 0.25, PAL.pavement));
      for (const fy of [1.6, 3.4, 5.2]) {
        if (fy > h - 0.4) continue;
        const xL = x0 - 0.75, xR = x0 + 0.75;
        win(boxAt(0.85, 1.0, 0.1, xL, fy, d / 2 + 0.05, PAL.glassLight), xL, fy, d / 2 + 0.05);
        win(boxAt(0.85, 1.0, 0.1, xR, fy, d / 2 + 0.05, PAL.glassLight), xR, fy, d / 2 + 0.05);
      }
    }
    walls.push(boxAt(units * unitW + 0.2, 0.4, d + 0.2, 0, 0.2, 0, PAL.trim));
    return { walls, glassLit, glassDark, w: units * unitW + 0.2, d, h };
  }

  /* --- 4. Shop --- */
  function buildShop(THREE, G, rng, hintW, hintD, hintH, isLit) {
    const { boxAt } = G;
    const w = clamp(hintW, 9, 15);
    const d = clamp(hintD, 7, 11);
    const floors = hintH < 8 ? 2 : hintH < 14 ? 3 : 4;
    const fh = 3.2;
    const h = floors * fh;
    const walls = [], glassLit = [], glassDark = [];

    const win = (geo, x, y, z) => {
      (isLit(x, y, z) ? glassLit : glassDark).push(geo);
    };

    walls.push(boxAt(w, h, d, 0, h / 2, 0, pick(rng, PAL.shop)));
    walls.push(boxAt(w + 0.3, 0.35, d + 0.3, 0, 0.175, 0, PAL.trim));

    // Витрина — почти всегда горит, но по правилу.
    win(boxAt(w - 1.0, 2.6, 0.25, 0, 1.4, d / 2 + 0.02, PAL.glass), 0, 1.4, d / 2 + 0.02);
    for (let i = 0; i < 4; i++) {
      walls.push(boxAt(0.08, 2.6, 0.3, -w / 2 + 0.8 + i * (w - 1.6) / 3,
                       1.4, d / 2 + 0.03, PAL.trim));
    }

    const awningC = pick(rng, PAL.awning);
    walls.push(boxAt(w - 0.6, 0.15, 1.3, 0, 3.0, d / 2 + 0.65, awningC));
    walls.push(boxAt(w - 0.6, 0.55, 0.1, 0, 2.75, d / 2 + 1.3, awningC));
    walls.push(boxAt(w - 0.8, 0.7, 0.15, 0, 3.7, d / 2 + 0.08, PAL.trim));

    for (let f = 1; f < floors; f++) {
      const fy = f * fh + fh * 0.5;
      for (let i = 0; i < 4; i++) {
        const x = -w / 2 + 2 + i * (w - 4) / 3;
        win(boxAt(1.3, 1.4, 0.1, x, fy, d / 2 + 0.05, PAL.glassLight), x, fy, d / 2 + 0.05);
      }
      win(boxAt(0.1, 1.4, 1.4, -w / 2 - 0.05, fy, 0, PAL.glassLight), -w / 2 - 0.05, fy, 0);
      win(boxAt(0.1, 1.4, 1.4,  w / 2 + 0.05, fy, 0, PAL.glassLight),  w / 2 + 0.05, fy, 0);
    }

    walls.push(boxAt(w + 0.4, 0.55, d + 0.4, 0, h, 0, PAL.trim));
    walls.push(boxAt(2.5, 0.9, 1.6, -w / 4, h + 0.55, d / 4, PAL.ac));

    return { walls, glassLit, glassDark, w, d, h };
  }

  /* --- 5. Residential --- */
  function buildResidential(THREE, G, rng, hintW, hintD, hintH, isLit) {
    const { boxAt, cylY } = G;
    const w = clamp(hintW, 11, 17);
    const d = clamp(hintD, 9, 13);
    const floors = hintH < 16 ? 4 : hintH < 22 ? 5 : 6;
    const fh = 3.0;
    const h = floors * fh;
    const walls = [], glassLit = [], glassDark = [];

    const win = (geo, x, y, z) => {
      (isLit(x, y, z) ? glassLit : glassDark).push(geo);
    };

    walls.push(boxAt(w, h, d, 0, h / 2, 0, pick(rng, PAL.residential)));
    walls.push(boxAt(w + 0.4, 0.4, d + 0.4, 0, 0.2, 0, PAL.trim));

    walls.push(boxAt(2.2, 0.2, 1.4, 0, 2.5, d / 2 + 0.65, PAL.trim));
    win(boxAt(1.6, 2.4, 0.2, 0, 1.2, d / 2 + 0.05, PAL.glass), 0, 1.2, d / 2 + 0.05);

    for (let f = 1; f < floors; f++) {
      const fy = f * fh + 1.5;
      for (let i = 0; i < 5; i++) {
        const x = -w / 2 + 1.8 + i * (w - 3.6) / 4;
        win(boxAt(1.2, 1.4, 0.1, x, fy, d / 2 + 0.05, PAL.glassLight), x, fy, d / 2 + 0.05);
      }
      for (let i = 0; i < 3; i++) {
        const x = -w / 2 + 3.2 + i * (w - 6.4) / 2;
        walls.push(boxAt(1.8, 0.15, 1.2, x, fy - 1.05, d / 2 + 0.6, 0xd0c8b8));
        walls.push(boxAt(1.8, 0.5, 0.05, x, fy - 0.65, d / 2 + 1.15, PAL.trim));
        walls.push(boxAt(0.05, 0.5, 1.2, x - 0.9, fy - 0.65, d / 2 + 0.6, PAL.trim));
        walls.push(boxAt(0.05, 0.5, 1.2, x + 0.9, fy - 0.65, d / 2 + 0.6, PAL.trim));
      }
      win(boxAt(0.1, 1.4, 1.4, -w / 2 - 0.05, fy, 0, PAL.glassLight), -w / 2 - 0.05, fy, 0);
      win(boxAt(0.1, 1.4, 1.4,  w / 2 + 0.05, fy, 0, PAL.glassLight),  w / 2 + 0.05, fy, 0);
    }

    walls.push(boxAt(w + 0.4, 0.65, d + 0.4, 0, h, 0, PAL.trim));
    walls.push(cylY(1.3, 1.8, -w / 4, h + 1.3, 0, 12, PAL.water));
    walls.push(cylY(0.1, 4,  w / 4, h + 2.5, d / 4, 6, PAL.trim));

    return { walls, glassLit, glassDark, w, d, h };
  }

  /* --- 6. Office --- */
  function buildOffice(THREE, G, rng, hintW, hintD, hintH, isLit) {
    const { boxAt } = G;
    const w = clamp(hintW, 13, 20);
    const d = clamp(hintD, 10, 14);
    const floors = hintH < 22 ? 6 : hintH < 30 ? 7 : 8;
    const fh = 3.4;
    const h = floors * fh;
    const walls = [], glassLit = [], glassDark = [];

    const win = (geo, x, y, z) => {
      (isLit(x, y, z) ? glassLit : glassDark).push(geo);
    };

    walls.push(boxAt(w, h, d, 0, h / 2, 0, pick(rng, PAL.office)));
    walls.push(boxAt(w + 0.4, fh + 0.2, d + 0.4, 0, (fh + 0.2) / 2, 0, 0x4a5058));
    win(boxAt(w - 1.5, fh - 0.6, 0.2, 0, fh / 2, d / 2 + 0.15, PAL.glass), 0, fh / 2, d / 2 + 0.15);

    const cols = 6;
    for (let f = 1; f < floors; f++) {
      const fy = fh + (f - 0.5) * fh;
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + 1.5 + c * (w - 3) / (cols - 1);
        win(boxAt(1.3, 1.6, 0.15, x, fy,  d / 2 + 0.02, PAL.glass), x, fy,  d / 2 + 0.02);
        win(boxAt(1.3, 1.6, 0.15, x, fy, -d / 2 - 0.02, PAL.glass), x, fy, -d / 2 - 0.02);
      }
      for (let c = 0; c < 3; c++) {
        const z = -d / 2 + 2.5 + c * (d - 5) / 2;
        win(boxAt(0.15, 1.6, 1.3,  w / 2 + 0.02, fy, z, PAL.glass),  w / 2 + 0.02, fy, z);
        win(boxAt(0.15, 1.6, 1.3, -w / 2 - 0.02, fy, z, PAL.glass), -w / 2 - 0.02, fy, z);
      }
    }

    walls.push(boxAt(w + 0.5, 0.7, d + 0.5, 0, h, 0, PAL.trim));
    walls.push(boxAt(2.5, 0.9, 1.8, -w / 4, h + 0.6, d / 4, PAL.ac));
    walls.push(boxAt(2.5, 0.9, 1.8,  w / 4, h + 0.6, -d / 4, PAL.ac));

    return { walls, glassLit, glassDark, w, d, h };
  }

  /* --- 7. Tower --- */
  function buildTower(THREE, G, rng, hintW, hintD, hintH, isLit) {
    const { boxAt, cylY, sphAt } = G;
    const w = clamp(hintW, 10, 15);
    const d = clamp(hintD, 8, 13);
    const h = clamp(32 + Math.max(0, hintH - 40) * 0.9, 32, 78);
    const shell = pick(rng, PAL.office);
    const walls = [], glassLit = [], glassDark = [];

    const win = (geo, x, y, z) => {
      (isLit(x, y, z) ? glassLit : glassDark).push(geo);
    };

    const baseH = 7;
    walls.push(boxAt(w + 3.5, baseH, d + 3.5, 0, baseH / 2, 0, PAL.trim));
    walls.push(boxAt(w + 3, 0.4, d + 3, 0, baseH + 0.2, 0, shell));
    walls.push(boxAt(w, h, d, 0, baseH + h / 2, 0, shell));

    // Стеклянные полосы — каждая своя «полоса», но проверка на «горит» идёт
    // по её центру. Полоса — это фактически длинный «продолговатый этаж»,
    // так что одна полоса без света — это хорошо читаемая «тёмная шахта».
    const nX = Math.floor(w / 2);
    for (let i = 0; i < nX; i++) {
      const x = -w / 2 + 1 + i * 2;
      const yMid = baseH + h / 2;
      win(boxAt(0.7, h - 2, 0.12, x, yMid,  d / 2 + 0.04, PAL.glass), x, yMid,  d / 2 + 0.04);
      win(boxAt(0.7, h - 2, 0.12, x, yMid, -d / 2 - 0.04, PAL.glass), x, yMid, -d / 2 - 0.04);
    }
    const nZ = Math.floor(d / 2);
    for (let i = 0; i < nZ; i++) {
      const z = -d / 2 + 1 + i * 2;
      const yMid = baseH + h / 2;
      win(boxAt(0.12, h - 2, 0.7,  w / 2 + 0.04, yMid, z, PAL.glass),  w / 2 + 0.04, yMid, z);
      win(boxAt(0.12, h - 2, 0.7, -w / 2 - 0.04, yMid, z, PAL.glass), -w / 2 - 0.04, yMid, z);
    }

    const w2 = w - 1.5, d2 = d - 1.5;
    const h2 = h * 0.32;
    const y2 = baseH + h;
    walls.push(boxAt(w2, h2, d2, 0, y2 + h2 / 2, 0, shell));
    for (let i = 0; i < Math.floor(w2 / 2); i++) {
      const x = -w2 / 2 + 1 + i * 2;
      const yMid = y2 + h2 / 2;
      win(boxAt(0.7, h2 - 1, 0.12, x, yMid,  d2 / 2 + 0.04, PAL.glass), x, yMid,  d2 / 2 + 0.04);
      win(boxAt(0.7, h2 - 1, 0.12, x, yMid, -d2 / 2 - 0.04, PAL.glass), x, yMid, -d2 / 2 - 0.04);
    }

    walls.push(boxAt(w2 + 0.3, 0.5, d2 + 0.3, 0, y2 + h2 + 0.25, 0, PAL.trim));
    walls.push(cylY(0.08, 7, 0, y2 + h2 + 3.5, 0, 6, PAL.antenna));
    walls.push(sphAt(0.28, 0.28, 0.28, 0, y2 + h2 + 7.2, 0, PAL.beacon, 8));

    return { walls, glassLit, glassDark, w: w + 3.5, d: d + 3.5, h: y2 + h2 + 7.5 };
  }

  const BUILDERS = {
    cottage:     buildCottage,
    house:       buildHouse,
    rowhouse:    buildRowhouse,
    shop:        buildShop,
    residential: buildResidential,
    office:      buildOffice,
    tower:       buildTower,
  };
  const TYPE_IDS = Object.keys(BUILDERS);

  /* ============================================================
     Выбор типа по удалению от центра
     ============================================================ */
  function pickType(distFromCenter, rng) {
    const r = rng();
    if (distFromCenter < 0.28) return r < 0.55 ? 'tower' : 'office';
    if (distFromCenter < 0.58) return r < 0.40 ? 'office' : (r < 0.80 ? 'residential' : 'shop');
    if (distFromCenter < 0.82) return r < 0.50 ? 'residential' : (r < 0.80 ? 'shop' : 'rowhouse');
    return r < 0.40 ? 'house' : (r < 0.75 ? 'cottage' : 'rowhouse');
  }
  function pickLevel(h) {
    if (h < 8)  return 0;
    if (h < 20) return 1;
    return 2;
  }

  /* ============================================================
     add() — публичная точка входа. До трёх мешей на здание.
     ============================================================ */
  function add(opts) {
    const { THREE, geom, scene, materials, cx, cz, w, d, h, buildings,
            type, level, worldHalf, seedSalt, litRatio } = opts;
    if (!THREE || !geom || !scene) {
      throw new Error('MeridianBuildingKit.add: THREE, geom, scene required');
    }
    if (!materials || !materials.solid) {
      throw new Error('MeridianBuildingKit.add: materials.solid required');
    }

    if (opts.legacy) return addLegacy(opts);

    const distFromCenter = worldHalf ? Math.hypot(cx, cz) / worldHalf
                                     : Math.hypot(cx, cz) / 290;
    const baseSeed = hashSeed(cx, cz, (seedSalt | 0) || 0x51de77);
    const seedRng = mulberry32(baseSeed);
    const finalType = (type && BUILDERS[type]) ? type
                     : pickType(clamp(distFromCenter, 0, 1), seedRng);
    const finalLevel = (typeof level === 'number') ? (level | 0)
                      : pickLevel(h || 10);

    const localRng = mulberry32(baseSeed ^ 0x9e3779b1);
    const ratio = (typeof litRatio === 'number') ? litRatio : DEFAULT_LIT_RATIO;
    const isLit = makeLitFn(baseSeed, ratio);

    const result = BUILDERS[finalType](THREE, geom, localRng, w || 12, d || 10, h || 20, isLit);
    const { walls, glassLit, glassDark, w: actualW, d: actualD } = result;

    const wallGeo = geom.mergeGeometries(walls);
    const shell = new THREE.Mesh(wallGeo, materials.solid);
    shell.position.set(cx, 0, cz);
    shell.castShadow = true;
    shell.receiveShadow = true;
    shell.userData.buildingType = finalType;
    shell.userData.buildingLevel = finalLevel;
    scene.add(shell);

    // Если dark-материал не передан — все окна идут в lit (обратная совместимость
    // с вызовами, которые шлют только materials.glass).
    let litParts = glassLit, darkParts = glassDark;
    if (!materials.glassDark) {
      litParts = glassLit.concat(glassDark);
      darkParts = [];
    }

    let litMesh = null, darkMesh = null;
    if (litParts.length && materials.glass) {
      litMesh = new THREE.Mesh(geom.mergeGeometries(litParts), materials.glass);
      litMesh.position.set(cx, 0, cz);
      litMesh.castShadow = false; litMesh.receiveShadow = false;
      litMesh.userData.buildingType = finalType;
      scene.add(litMesh);
    }
    if (darkParts.length && materials.glassDark) {
      darkMesh = new THREE.Mesh(geom.mergeGeometries(darkParts), materials.glassDark);
      darkMesh.position.set(cx, 0, cz);
      darkMesh.castShadow = false; darkMesh.receiveShadow = false;
      darkMesh.userData.buildingType = finalType;
      scene.add(darkMesh);
    }

    if (buildings) {
      buildings.push({ x: cx, z: cz, hw: (w || actualW) / 2, hd: (d || actualD) / 2 });
    }
    return { mesh: shell, glassMesh: litMesh, glassDarkMesh: darkMesh,
             type: finalType, level: finalLevel };
  }

  /* ============================================================
     Legacy: старый shell + стекло одной плоскостью.
     ============================================================ */
  function makeShellGeometry(THREE, geom, w, d, h, rng) {
    const mergeGeometries = geom.mergeGeometries;
    const solid = [];
    const push = (geo, color) => solid.push({ geo, color });

    const body = new THREE.BoxGeometry(w, h, d);
    body.translate(0, h / 2, 0);
    push(body, BODY_HEXES[(rng() * BODY_HEXES.length) | 0]);

    const cap = new THREE.BoxGeometry(w + 0.5, 0.4, d + 0.5);
    cap.translate(0, h, 0);
    push(cap, ROOF_HEX);

    const par = (pw, pd, px, pz) => {
      const p = new THREE.BoxGeometry(pw, 1.2, pd);
      p.translate(px, h + 0.6, pz);
      push(p, TRIM_HEX);
    };
    par(w + 0.5, 0.4, 0,  d / 2);
    par(w + 0.5, 0.4, 0, -d / 2);
    par(0.4, d + 0.5,  w / 2, 0);
    par(0.4, d + 0.5, -w / 2, 0);

    const n = 1 + (rng() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const bw = 1.2 + rng() * (Math.min(w - 2, 3) - 1.2);
      const bd = 1.2 + rng() * (Math.min(d - 2, 3) - 1.2);
      const bh = 0.8 + rng() * 1.2;
      const bx = -w / 2 + 1 + rng() * (w - 2);
      const bz = -d / 2 + 1 + rng() * (d - 2);
      const b = new THREE.BoxGeometry(bw, bh, bd);
      b.translate(bx, h + 0.4, bz);
      push(b, TRIM_HEX);
    }
    if (h > 36 && rng() < 0.7) {
      const ah = 5 + rng() * 6;
      const ax = -w / 2 + 1 + rng() * (w - 2);
      const az = -d / 2 + 1 + rng() * (d - 2);
      const a = new THREE.CylinderGeometry(0.08, 0.14, ah, 6);
      a.translate(ax, h + 5, az);
      push(a, TRIM_HEX);
    }
    return mergeGeometries(solid);
  }

  function makeGlassGeometry(THREE, geom, w, d, h) {
    const floors = Math.max(2, Math.round(h / 3.1));
    const winH = Math.max(2, h - 3);
    const wy = h / 2 + 0.5;
    const face = (ww, pos, rotY) => {
      const pg = new THREE.PlaneGeometry(ww, winH);
      const uv = pg.attributes.uv.array;
      for (let i = 0; i < uv.length; i += 2) {
        uv[i]     *= ww / 8.8;
        uv[i + 1] *= floors / 16;
      }
      pg.applyMatrix4(new THREE.Matrix4().makeRotationY(rotY).setPosition(pos));
      return pg;
    };
    return geom.mergeGeometries([
      face(w - 1.2, new THREE.Vector3(0, wy,  d / 2 + 0.06), 0),
      face(w - 1.2, new THREE.Vector3(0, wy, -d / 2 - 0.06), Math.PI),
      face(d - 1.2, new THREE.Vector3( w / 2 + 0.06, wy, 0),  Math.PI / 2),
      face(d - 1.2, new THREE.Vector3(-w / 2 - 0.06, wy, 0), -Math.PI / 2),
    ]);
  }

  function addLegacy(opts) {
    const { THREE, geom, scene, materials, cx, cz, w, d, h, rng, buildings } = opts;
    const shellGeo = makeShellGeometry(THREE, geom, w, d, h, rng || Math.random);
    const glassGeo = makeGlassGeometry(THREE, geom, w, d, h);
    const shell = new THREE.Mesh(shellGeo, materials.solid);
    const glass = new THREE.Mesh(glassGeo, materials.glass || materials.solid);
    shell.position.set(cx, 0, cz);
    shell.castShadow = true; shell.receiveShadow = true;
    glass.position.set(cx, 0, cz);
    scene.add(shell, glass);
    if (buildings) buildings.push({ x: cx, z: cz, hw: w / 2, hd: d / 2 });
    return { mesh: shell, glassMesh: glass, glassDarkMesh: null, type: 'legacy', level: 0 };
  }

  /* ============================================================
     Экспорт
     ============================================================ */
  window.MeridianBuildingKit = {
    BODY_HEXES, ROOF_HEX, TRIM_HEX,
    PAL, TYPE_IDS,
    DEFAULT_LIT_RATIO,
    pickType, pickLevel,
    add,
    buildCottage, buildHouse, buildRowhouse, buildShop,
    buildResidential, buildOffice, buildTower,
    makeShellGeometry, makeGlassGeometry,
    makeLitFn,
  };

  /* ============================================================
     viewer.html: ряд из семи типов, три материала.
     ============================================================ */
  if (window.MeridianAssets) {
    MeridianAssets.register({
      id: 'scenery/building',
      label: 'Buildings — 7 types, lit windows',
      group: 'Scenery',
      notes: 'Три меша на здание: стены, горящие окна, тёмные окна. ~40 % lit.',
      makePreview: function (ctx) {
        const THREE = ctx.THREE, geom = ctx.geom;
        const group = new THREE.Group();
        const wallMat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.86, metalness: 0.04,
        });
        const litMat = new THREE.MeshStandardMaterial({
          color: 0x10171f,
          emissive: 0xffd090, emissiveIntensity: 1.1,
          roughness: 0.22, metalness: 0.35,
        });
        const darkMat = new THREE.MeshStandardMaterial({
          color: 0x1a2028,
          roughness: 0.35, metalness: 0.45,
        });
        const GAP = 8;
        let x = 0;
        for (const id of TYPE_IDS) {
          const baseSeed = hashSeed(id.length, x * 7, 0xc0ffee);
          const rng = mulberry32(baseSeed);
          const isLit = makeLitFn(baseSeed, DEFAULT_LIT_RATIO);
          const res = BUILDERS[id](THREE, geom, rng, 12, 10, 20, isLit);

          const wallMesh = new THREE.Mesh(geom.mergeGeometries(res.walls), wallMat);
          wallMesh.castShadow = true; wallMesh.receiveShadow = true;
          wallMesh.position.x = x + res.w / 2;
          group.add(wallMesh);

          if (res.glassLit.length) {
            const litMesh = new THREE.Mesh(geom.mergeGeometries(res.glassLit), litMat);
            litMesh.position.x = x + res.w / 2;
            group.add(litMesh);
          }
          if (res.glassDark.length) {
            const darkMesh = new THREE.Mesh(geom.mergeGeometries(res.glassDark), darkMat);
            darkMesh.position.x = x + res.w / 2;
            group.add(darkMesh);
          }
          x += res.w + GAP;
        }
        group.position.x = -x / 2;
        group.userData.buildingTypes = TYPE_IDS.slice();
        return group;
      },
    });
  }
})();
