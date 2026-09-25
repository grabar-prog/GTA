/* assets/models/park.js — городские парки: шесть типов.
 *
 * Типы:
 *   'fountain'   — мощёная плаза с каскадным фонтаном, скамейки, деревья;
 *   'playground' — песочница, горка, качели, при level ≥1 балансир, при 2 лазалка;
 *   'monument'   — ступенчатый постамент со статуей, кусты, фонари;
 *   'pond'       — три пруда, кромка из камней, мостик, островок;
 *   'picnic'     — столы с лавками, мангалы, деревья по кольцу;
 *   'sports'     — площадка с разметкой, два кольца, ограждение.
 *
 *   const result = MeridianParkKit.add({
 *     THREE, geom, scene,
 *     cx, cz, size,
 *     rng,                    // см. ниже
 *     type,                   // опц.: 'fountain' | 'playground' | … | 'sports'
 *     level,                  // опц.: 0 | 1 | 2
 *     useMainRng,             // опц.: true = тратить основной rng (52 вызова),
 *                             //       false (по умолчанию) = локальный mulberry32
 *   });
 *   // result = { parts, trees, mesh }
 *   //   parts  — уже собранная геометрия парка (готова к new THREE.Mesh)
 *   //   trees  — массив {x, z, scale, hue} — вызывающий сам решает, добавить
 *   //            их в общий InstancedMesh или оставить частью парка
 *   //   mesh   — если scene передан, парк уже добавлен в сцену
 *
 * Детерминизм. По умолчанию парк не тратит основной rng: локальный mulberry32
 * засеян хешем от (cx, cz). Это значит, что расстановка зданий и всего, что
 * идёт после buildPark(), не сдвигается относительно соседних модулей.
 *
 * С флагом useMainRng: true поведение прежнее — парк тратит 52 вызова rng()
 * из основного потока (26 позиций деревьев × 2 координаты). Контракт сохранён
 * для случая, когда важно удержать прежний лэйаут города.
 */
(function () {
  'use strict';

  const PAL = {
    grass:  [0x4a7a3a, 0x5a8a48, 0x3a6a30, 0x4a8a38],
    pave:   [0x9a938a, 0x8a8880, 0xa8a098],
    stone:  [0x8a8a90, 0x7a7a80, 0x9a9aa0],
    water:  0x2a6a8f,
    waterL: 0x4a9ac0,
    sand:   0xd4b878,
    wood:   [0x6a4a2a, 0x8a6a4a, 0x5a3a22],
    metalR: 0xc83a3a,
    metalB: 0x3a6ac8,
    metalY: 0xe8c04a,
    hedge:  0x2a5a24,
    rock:   0x8a8070,
    fence:  0x4a4a50,
    dark:   0x2a2a30,
    hoop:   0xd85a3a,
    bb:     0xe8e8ec,
    lamp:   0xe8c04a,
    bbq:    0x3a3a40,
    tree:   0x6b4a2f,
  };

  const TYPE_IDS = ['fountain', 'playground', 'monument', 'pond', 'picnic', 'sports'];

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

  /* ============================================================
     Базовые примитивы. Все — {geo, color}, сливаются mergeGeometries.
     ============================================================ */
  function boxAt(THREE, w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
    return { geo: g, color };
  }
  function cylY(THREE, rt, rb, h, x, y, z, seg, color) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg || 14); g.translate(x, y, z);
    return { geo: g, color };
  }
  function sphAt(THREE, rx, ry, rz, x, y, z, color, seg) {
    const s = seg || 10;
    const g = new THREE.SphereGeometry(1, s, s - 2);
    g.scale(rx, ry, rz); g.translate(x, y, z);
    return { geo: g, color };
  }
  function coneY(THREE, r, h, x, y, z, seg, color) {
    const g = new THREE.ConeGeometry(r, h, seg || 8); g.translate(x, y, z);
    return { geo: g, color };
  }

  /* ============================================================
     Мебель/деревья — параметризованы, поэтому их можно звать
     из любого билдера и получать геометрию в общей parts.
     ============================================================ */
  function bench(THREE, parts, x, z, ry) {
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const place = (geo, lx, ly, lz, color) => {
      if (ry) geo.rotateY(ry);
      const rx = lx * cos + lz * sin;
      const rz = -lx * sin + lz * cos;
      geo.translate(x + rx, ly, z + rz);
      parts.push({ geo, color });
    };
    const w = 1.8;
    place(new THREE.BoxGeometry(w, 0.08, 0.4), 0, 0.45, 0, PAL.wood[1]);
    place(new THREE.BoxGeometry(w, 0.4, 0.08), 0, 0.68, -0.18, PAL.wood[0]);
    for (const dx of [-w / 2 + 0.15, w / 2 - 0.15]) {
      for (const dz of [-0.12, 0.12]) {
        place(new THREE.BoxGeometry(0.08, 0.45, 0.08), dx, 0.225, dz, PAL.dark);
      }
    }
  }

  // Дерево: пивот основания на y=0, возвращает {geometry, trunkHeight}.
  // Список trees() собирается отдельно вызывающим — позиции, scale, hue.
  function treeGeometryAt(THREE, x, z, scale, hue) {
    const parts = [];
    const trunkH = 2.4 * scale;
    parts.push({
      geo: new THREE.CylinderGeometry(0.14 * scale, 0.22 * scale, trunkH, 7)
             .translate(x, trunkH / 2, z),
      color: PAL.tree,
    });
    parts.push({
      geo: new THREE.IcosahedronGeometry(1.3 * scale, 0)
             .scale(1, 1.1, 1).translate(x, trunkH + 0.9 * scale, z),
      color: hue,
    });
    parts.push({
      geo: new THREE.IcosahedronGeometry(0.85 * scale, 0)
             .translate(x + 0.35 * scale, trunkH + 1.4 * scale, z - 0.25 * scale),
      color: hue,
    });
    return parts;
  }

  function picnicTable(THREE, parts, x, z, ry) {
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const place = (geo, lx, ly, lz, color) => {
      if (ry) geo.rotateY(ry);
      const rx = lx * cos + lz * sin;
      const rz = -lx * sin + lz * cos;
      geo.translate(x + rx, ly, z + rz);
      parts.push({ geo, color });
    };
    place(new THREE.BoxGeometry(2.0, 0.08, 0.9), 0, 0.78, 0, PAL.wood[0]);
    place(new THREE.BoxGeometry(2.0, 0.06, 0.35), 0, 0.45, -0.85, PAL.wood[0]);
    place(new THREE.BoxGeometry(2.0, 0.06, 0.35), 0, 0.45,  0.85, PAL.wood[0]);
    for (const dx of [-0.85, 0.85]) {
      for (const dz of [-0.35, 0.35])
        place(new THREE.BoxGeometry(0.08, 0.78, 0.08), dx, 0.39, dz, PAL.dark);
      for (const dz of [-0.85, 0.85])
        place(new THREE.BoxGeometry(0.08, 0.45, 0.08), dx, 0.225, dz, PAL.dark);
      for (const dz of [-0.6, 0.6])
        place(new THREE.BoxGeometry(0.06, 0.06, 0.5), dx, 0.36, dz, PAL.wood[0]);
    }
  }

  /* ============================================================
     Шесть билдеров. Каждый возвращает {parts, trees}.
     ============================================================ */

  function buildFountain(THREE, rng, level, size) {
    const parts = [], trees = [];
    const R = size / 2;
    parts.push(cylY(THREE, R + 1.5, R + 1.5, 0.08, 0, 0.04, 0, 28, pick(rng, PAL.grass)));
    parts.push(cylY(THREE, R, R, 0.15, 0, 0.115, 0, 28, pick(rng, PAL.pave)));

    const fr = 3.2 + level * 0.4;
    parts.push(cylY(THREE, fr, fr, 0.7, 0, 0.35, 0, 22, PAL.stone[0]));
    parts.push(cylY(THREE, fr - 0.35, fr - 0.35, 0.02, 0, 0.71, 0, 22, PAL.waterL));
    if (level >= 1) {
      parts.push(cylY(THREE, 0.45, 0.55, 1.4, 0, 1.4, 0, 12, PAL.stone[0]));
      parts.push(cylY(THREE, 1.3, 1.3, 0.3, 0, 2.25, 0, 16, PAL.stone[0]));
      parts.push(cylY(THREE, 1.1, 1.1, 0.02, 0, 2.41, 0, 16, PAL.waterL));
      parts.push(cylY(THREE, 0.06, 0.06, 0.5, 0, 2.7, 0, 6, 0xcfe8f4));
    }
    if (level >= 2) {
      parts.push(cylY(THREE, 0.35, 0.42, 1.0, 0, 3.1, 0, 12, PAL.stone[0]));
      parts.push(cylY(THREE, 0.85, 0.85, 0.25, 0, 3.72, 0, 14, PAL.stone[0]));
      parts.push(cylY(THREE, 0.7, 0.7, 0.02, 0, 3.86, 0, 14, PAL.waterL));
      parts.push(cylY(THREE, 0.05, 0.05, 0.7, 0, 4.2, 0, 6, 0xcfe8f4));
    }

    const nB = 4 + level * 2;
    for (let i = 0; i < nB; i++) {
      const a = i * Math.PI * 2 / nB + Math.PI / nB;
      const r = R - 1.6;
      bench(THREE, parts, Math.cos(a) * r, Math.sin(a) * r, Math.PI / 2 - a);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const r = R + 2.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sc = 0.75 + rng() * 0.35;
      const hue = pick(rng, PAL.grass);
      trees.push({ x, z, scale: sc, hue });
      parts.push(...treeGeometryAt(THREE, x, z, sc, hue));
    }
    return { parts, trees };
  }

  function buildPlayground(THREE, rng, level, size) {
    const parts = [], trees = [];
    const W = size, D = size * 0.85;
    parts.push(boxAt(THREE, W, 0.1, D, 0, 0.05, 0, pick(rng, PAL.grass)));
    parts.push(boxAt(THREE, W - 2, 0.18, D - 2, 0, 0.13, 0, PAL.sand));
    for (const s of [-1, 1]) {
      parts.push(boxAt(THREE, W - 2, 0.25, 0.2, 0, 0.2, s * (D - 2) / 2, PAL.wood[0]));
      parts.push(boxAt(THREE, 0.2, 0.25, D - 2, s * (W - 2) / 2, 0.2, 0, PAL.wood[0]));
    }

    // Горка
    {
      const bx = W / 2 - 3.2, bz = -D / 4;
      for (const dx of [-0.25, 0.25])
        parts.push(boxAt(THREE, 0.08, 2.0, 0.08, bx + dx, 1.0, bz - 0.3, PAL.metalR));
      for (let i = 1; i <= 4; i++)
        parts.push(boxAt(THREE, 0.5, 0.06, 0.06, bx, i * 0.5, bz - 0.3, PAL.metalY));
      parts.push(boxAt(THREE, 1.2, 0.1, 1.2, bx, 2.0, bz + 0.4, PAL.metalR));
      for (const dx of [-0.6, 0.6])
        parts.push(boxAt(THREE, 0.06, 0.7, 0.06, bx + dx, 2.4, bz + 0.4, PAL.metalY));
      parts.push(boxAt(THREE, 1.2, 0.06, 0.06, bx, 2.75, bz - 0.2, PAL.metalY));
      parts.push(boxAt(THREE, 1.2, 0.06, 0.06, bx, 2.75, bz + 1.0, PAL.metalY));
      const sg = new THREE.BoxGeometry(0.7, 0.08, 3.6);
      sg.rotateX(0.5); sg.translate(bx, 1.15, bz + 2.4);
      parts.push({ geo: sg, color: PAL.metalR });
      for (const dx of [-0.35, 0.35]) {
        const s = new THREE.BoxGeometry(0.05, 0.22, 3.6);
        s.rotateX(0.5); s.translate(bx + dx, 1.15, bz + 2.4);
        parts.push({ geo: s, color: PAL.metalY });
      }
    }

    // Качели
    {
      const sx = -W / 2 + 3.2, sz = D / 4;
      const H = 2.5, span = 2.8;
      for (const dx of [-span / 2, span / 2])
        parts.push(boxAt(THREE, 0.1, H, 0.1, sx + dx, H / 2, sz, PAL.metalB));
      parts.push(boxAt(THREE, span + 0.2, 0.1, 0.1, sx, H, sz, PAL.metalB));
      for (const dx of [-0.7, 0.7]) {
        const swx = sx + dx;
        for (const cx of [-0.2, 0.2])
          parts.push(cylY(THREE, 0.02, 0.02, H - 0.5, swx + cx, (H + 0.5) / 2, sz, 4, PAL.dark));
        parts.push(boxAt(THREE, 0.5, 0.06, 0.25, swx, 0.5, sz, PAL.metalR));
      }
    }

    if (level >= 1) {
      parts.push(boxAt(THREE, 0.3, 0.5, 0.3, 0, 0.25, 0, PAL.dark));
      const bg = new THREE.BoxGeometry(0.15, 0.15, 3.0);
      bg.rotateX(0.15); bg.translate(0, 0.6, 0);
      parts.push({ geo: bg, color: PAL.metalY });
      parts.push(boxAt(THREE, 0.15, 0.5, 0.1, 0, 1.0, -1.4, PAL.metalR));
      parts.push(boxAt(THREE, 0.15, 0.5, 0.1, 0, 0.2,  1.4, PAL.metalR));
    }
    if (level >= 2) {
      const cz = -D / 2 + 2.4;
      for (const dx of [-0.8, 0.8]) for (const dz of [-0.8, 0.8])
        parts.push(boxAt(THREE, 0.08, 1.6, 0.08, dx, 0.8, cz + dz, PAL.metalB));
      for (const dy of [0.5, 1.0, 1.5]) {
        parts.push(boxAt(THREE, 1.7, 0.06, 0.06, 0, dy, cz - 0.8, PAL.metalR));
        parts.push(boxAt(THREE, 1.7, 0.06, 0.06, 0, dy, cz + 0.8, PAL.metalR));
      }
    }

    const nT = 3 + level;
    for (let i = 0; i < nT; i++) {
      const a = i * Math.PI * 2 / nT;
      const r = Math.max(W, D) / 2 + 1.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sc = 0.7 + rng() * 0.4;
      const hue = pick(rng, PAL.grass);
      trees.push({ x, z, scale: sc, hue });
      parts.push(...treeGeometryAt(THREE, x, z, sc, hue));
    }
    return { parts, trees };
  }

  function buildMonument(THREE, rng, level, size) {
    const parts = [], trees = [];
    const R = size / 2;
    parts.push(cylY(THREE, R + 1.5, R + 1.5, 0.06, 0, 0.03, 0, 24, pick(rng, PAL.grass)));
    parts.push(cylY(THREE, R, R, 0.14, 0, 0.1, 0, 24, pick(rng, PAL.pave)));

    parts.push(boxAt(THREE, 4.2, 0.3, 4.2, 0, 0.27, 0, PAL.stone[1]));
    parts.push(boxAt(THREE, 3.6, 0.3, 3.6, 0, 0.57, 0, PAL.stone[0]));
    parts.push(boxAt(THREE, 3.0, 0.3, 3.0, 0, 0.87, 0, PAL.stone[1]));
    parts.push(boxAt(THREE, 2.4, 1.8, 2.4, 0, 1.92, 0, PAL.stone[0]));
    parts.push(boxAt(THREE, 2.7, 0.15, 2.7, 0, 2.895, 0, PAL.stone[2]));

    if (level === 0) {
      parts.push(boxAt(THREE, 0.8, 3.0, 0.8, 0, 4.5, 0, PAL.stone[0]));
      parts.push(coneY(THREE, 0.55, 1.0, 0, 6.5, 0, 4, PAL.stone[0]));
    } else if (level === 1) {
      parts.push(boxAt(THREE, 0.9, 0.4, 0.9, 0, 3.17, 0, PAL.stone[0]));
      parts.push(cylY(THREE, 0.28, 0.42, 1.6, 0, 4.17, 0, 10, PAL.stone[0]));
      parts.push(sphAt(THREE, 0.42, 0.46, 0.42, 0, 5.4, 0, PAL.stone[2], 10));
    } else {
      parts.push(boxAt(THREE, 1.6, 0.3, 1.6, 0, 3.12, 0, PAL.stone[0]));
      for (const dx of [-0.45, 0.45]) {
        parts.push(boxAt(THREE, 0.55, 0.3, 0.55, dx, 3.42, 0, PAL.stone[1]));
        parts.push(cylY(THREE, 0.22, 0.3, 1.4, dx, 4.27, 0, 10, PAL.stone[0]));
        parts.push(sphAt(THREE, 0.33, 0.36, 0.33, dx, 5.32, 0, PAL.stone[2], 10));
      }
    }

    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const r = R - 2;
      parts.push(boxAt(THREE, 2.2, 0.85, 2.2, Math.cos(a) * r, 0.43, Math.sin(a) * r, PAL.hedge));
    }
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const r = R - 0.8;
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      parts.push(cylY(THREE, 0.06, 0.09, 2.6, lx, 1.3, lz, 6, PAL.dark));
      parts.push(boxAt(THREE, 0.4, 0.5, 0.4, lx, 2.85, lz, PAL.lamp));
      parts.push(coneY(THREE, 0.35, 0.4, lx, 3.3, lz, 4, PAL.dark));
    }
    return { parts, trees };
  }

  function buildPond(THREE, rng, level, size) {
    const parts = [], trees = [];
    const W = size, D = size * 0.85;
    parts.push(boxAt(THREE, W + 1, 0.1, D + 1, 0, 0.05, 0, pick(rng, PAL.grass)));

    const r1 = 3.6 + level * 0.2;
    const r2 = 3.0 + level * 0.2;
    const r3 = 2.4;
    parts.push(cylY(THREE, r1, r1, 0.15, -1, 0.12, 0.5, 24, PAL.water));
    parts.push(cylY(THREE, r2, r2, 0.15, 2.2, 0.12, 1.0, 24, PAL.water));
    parts.push(cylY(THREE, r3, r3, 0.15, 0.3, 0.12, -2.2, 24, PAL.water));

    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI * 2 / 16;
      parts.push(boxAt(THREE,
        0.55 + rng() * 0.3, 0.35 + rng() * 0.15, 0.5 + rng() * 0.25,
        -1 + Math.cos(a) * (r1 + 0.25), 0.18, 0.5 + Math.sin(a) * (r1 + 0.25),
        PAL.rock));
    }

    if (level >= 1) {
      const bx = 1.0, bz = 0.6;
      parts.push(boxAt(THREE, 4.0, 0.15, 1.3, bx, 1.0, bz, PAL.wood[0]));
      for (const dz of [-0.65, 0.65]) {
        for (const dx of [-1.7, 0, 1.7])
          parts.push(boxAt(THREE, 0.08, 0.8, 0.08, bx + dx, 1.4, bz + dz, PAL.wood[0]));
        parts.push(boxAt(THREE, 3.8, 0.08, 0.08, bx, 1.82, bz + dz, PAL.wood[0]));
      }
      for (const dx of [-1.4, 1.4]) {
        for (const dz of [-0.5, 0.5])
          parts.push(boxAt(THREE, 0.15, 1.0, 0.15, bx + dx, 0.5, bz + dz, PAL.wood[0]));
      }
    }

    if (level >= 2) {
      parts.push(cylY(THREE, 1.4, 1.4, 0.4, 0.3, 0.2, -2.2, 16, PAL.grass[0]));
      const x = 0.3, z = -2.2, sc = 0.7;
      const hue = pick(rng, PAL.grass);
      trees.push({ x, z, scale: sc, hue });
      parts.push(...treeGeometryAt(THREE, x, z, sc, hue));
    }

    const nB = 3 + level;
    for (let i = 0; i < nB; i++) {
      const a = i * Math.PI * 2 / nB + Math.PI / 4;
      const r = r1 + 2.2;
      bench(THREE, parts, -1 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, Math.PI / 2 - a);
    }
    const nT = 4 + level;
    for (let i = 0; i < nT; i++) {
      const a = i * Math.PI * 2 / nT + 0.3;
      const r = Math.max(W, D) / 2 + 1;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sc = 0.75 + rng() * 0.4;
      const hue = pick(rng, PAL.grass);
      trees.push({ x, z, scale: sc, hue });
      parts.push(...treeGeometryAt(THREE, x, z, sc, hue));
    }
    return { parts, trees };
  }

  function buildPicnic(THREE, rng, level, size) {
    const parts = [], trees = [];
    const W = size, D = size;
    parts.push(boxAt(THREE, W, 0.1, D, 0, 0.05, 0, pick(rng, PAL.grass)));
    parts.push(boxAt(THREE, W, 0.06, 1.4, 0, 0.085, 0, pick(rng, PAL.pave)));

    const n = 3 + level;
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n;
      const r = W / 2 - 2.6;
      picnicTable(THREE, parts, Math.cos(a) * r, Math.sin(a) * r, Math.PI / 2 - a);
    }
    if (level >= 1) {
      for (let i = 0; i < 2; i++) {
        const a = i * Math.PI + Math.PI / 2;
        const r = W / 3;
        const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
        parts.push(cylY(THREE, 0.6, 0.6, 0.5, bx, 0.3, bz, 12, PAL.bbq));
        parts.push(cylY(THREE, 0.5, 0.5, 0.08, bx, 0.6, bz, 12, 0x1a1a20));
        for (const dx of [-0.45, 0.45])
          parts.push(boxAt(THREE, 0.08, 0.5, 0.08, bx + dx, 0.25, bz, PAL.dark));
      }
    }

    const nT = 4 + level;
    for (let i = 0; i < nT; i++) {
      const a = i * Math.PI * 2 / nT + 0.3;
      const r = W / 2 + 1.2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sc = 0.85 + rng() * 0.4;
      const hue = pick(rng, PAL.grass);
      trees.push({ x, z, scale: sc, hue });
      parts.push(...treeGeometryAt(THREE, x, z, sc, hue));
    }
    return { parts, trees };
  }

  function buildSports(THREE, rng, level, size) {
    const parts = [], trees = [];
    const W = size, D = size * 0.75;
    parts.push(boxAt(THREE, W + 3, 0.1, D + 3, 0, 0.05, 0, pick(rng, PAL.grass)));
    parts.push(boxAt(THREE, W, 0.15, D, 0, 0.13, 0, 0x8a6a4a));

    parts.push(boxAt(THREE, 0.12, 0.02, D, 0, 0.21, 0, 0xf0e8d0));
    parts.push(cylY(THREE, 1.2, 1.2, 0.02, 0, 0.21, 0, 24, 0xf0e8d0));
    parts.push(cylY(THREE, 1.05, 1.05, 0.021, 0, 0.211, 0, 24, 0x8a6a4a));
    for (const dx of [-W / 2 + 2.2, W / 2 - 2.2]) {
      parts.push(boxAt(THREE, 4.2, 0.02, 3.4, dx, 0.21, 0, 0xf0e8d0));
      parts.push(boxAt(THREE, 3.9, 0.021, 3.1, dx, 0.211, 0, 0x8a6a4a));
    }

    for (const dx of [-W / 2 + 0.7, W / 2 - 0.7]) {
      const inward = dx < 0 ? 1 : -1;
      parts.push(cylY(THREE, 0.1, 0.1, 3.5, dx, 1.75, 0, PAL.dark, 8));
      parts.push(boxAt(THREE, 0.8, 0.08, 0.08, dx + inward * 0.4, 3.5, 0, PAL.dark));
      const bbX = dx + inward * 0.85;
      parts.push(boxAt(THREE, 0.06, 1.1, 1.8, bbX, 3.4, 0, PAL.bb));
      const rim = new THREE.TorusGeometry(0.3, 0.03, 6, 14);
      rim.rotateX(Math.PI / 2);
      rim.translate(bbX + inward * 0.4, 3.1, 0);
      parts.push({ geo: rim, color: PAL.hoop });
    }

    const fh = 2.6;
    for (const side of [-1, 1]) {
      const z = side * (D / 2 + 1);
      for (let x = -W / 2; x <= W / 2; x += 1.6)
        parts.push(boxAt(THREE, 0.08, fh, 0.08, x, fh / 2, z, PAL.fence));
      for (const y of [0.5, 1.3, 2.1])
        parts.push(boxAt(THREE, W, 0.06, 0.06, 0, y, z, PAL.fence));
    }

    bench(THREE, parts, 0, D / 2 + 2.2, Math.PI);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (W / 2 + 2.5), z = sz * (D / 2 + 2.5);
      const sc = 0.85;
      const hue = pick(rng, PAL.grass);
      trees.push({ x, z, scale: sc, hue });
      parts.push(...treeGeometryAt(THREE, x, z, sc, hue));
    }
    return { parts, trees };
  }

  const BUILDERS = {
    fountain:   buildFountain,
    playground: buildPlayground,
    monument:   buildMonument,
    pond:       buildPond,
    picnic:     buildPicnic,
    sports:     buildSports,
  };

  function pickType(distanceFromCenter, rng) {
    const r = rng();
    if (distanceFromCenter < 0.3) return r < 0.5 ? 'fountain' : 'monument';
    if (distanceFromCenter < 0.6) return r < 0.4 ? 'playground' : (r < 0.75 ? 'picnic' : 'pond');
    return r < 0.4 ? 'pond' : (r < 0.75 ? 'picnic' : 'sports');
  }

  /* ============================================================
     add() — публичная точка входа. Возвращает {parts, trees, mesh}.
     ============================================================ */
  function add(opts) {
    const { THREE, geom, scene, cx, cz } = opts;
    if (!THREE) throw new Error('MeridianParkKit.add: THREE required');
    if (!geom)  throw new Error('MeridianParkKit.add: geom required');
    const size = opts.size != null ? opts.size : 30;

    // Выбор rng: основной (прежний контракт, 52 вызова) или локальный.
    const useMainRng = !!opts.useMainRng;
    const rng = useMainRng ? (opts.rng || Math.random)
                           : mulberry32(hashSeed(cx || 0, cz || 0, 0x51de77));

    // Тип: явный или по расстоянию от центра (worldHalf необязателен).
    const worldHalf = opts.worldHalf || 290;
    const distFromCenter = Math.hypot(cx || 0, cz || 0) / worldHalf;
    const seedForType = mulberry32(hashSeed(cx || 0, cz || 0, 0xabcd1234));
    const type = (opts.type && BUILDERS[opts.type]) ? opts.type
               : pickType(Math.min(distFromCenter, 1), seedForType);
    const level = (typeof opts.level === 'number') ? (opts.level | 0) : 1;

    const result = BUILDERS[type](THREE, rng, level, size);
    const geo = geom.mergeGeometries(result.parts);

    // Если передан scene — сразу добавляем меш; material опционален.
    let mesh = null;
    if (scene) {
      const material = opts.material || new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.86, metalness: 0.04,
      });
      mesh = new THREE.Mesh(geo, material);
      mesh.position.set(cx || 0, 0, cz || 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.parkType = type;
      mesh.userData.parkLevel = level;
      scene.add(mesh);
    }

    // Возвращаем также позиции деревьев в мировых координатах — они уже
    // смещены в (0,0), поэтому прибавляем (cx, cz), чтобы вызывающий мог
    // положить их в общий InstancedMesh как есть.
    const treesOut = result.trees.map(t => ({
      x: t.x + (cx || 0),
      z: t.z + (cz || 0),
      scale: t.scale,
      hue: t.hue,
    }));

    return { parts: result.parts, trees: treesOut, mesh, type, level };
  }

  /* ============================================================
     Старый API: makeMaterials — сохранён для обратной совместимости.
     ============================================================ */
  function makeMaterials(THREE) {
    return {
      lawn: new THREE.MeshStandardMaterial({ color: 0x4c7a3f, roughness: 1 }),
      pond: new THREE.MeshStandardMaterial({ color: 0x2b6a8f, roughness: 0.15, metalness: 0.4 }),
      path: new THREE.MeshStandardMaterial({ color: 0xb9a67e, roughness: 1 }),
    };
  }

  window.MeridianParkKit = {
    add, makeMaterials, pickType, TYPE_IDS, PAL,
    BUILDERS,
  };

  /* ============================================================
     viewer.html: шесть типов в ряд, у каждого level=1.
     ============================================================ */
  if (window.MeridianAssets) {
    MeridianAssets.register({
      id: 'scenery/park',
      label: 'Parks — 6 types',
      group: 'Scenery',
      notes: 'Плаза/фонтан · площадка · монумент · пруд · пикник · спорт. Один mesh на парк.',
      makePreview: function (ctx) {
        const { THREE, geom } = ctx;
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.86, metalness: 0.04,
        });
        const GAP = 6;
        let x = 0;
        const SIZE = 24;
        for (const id of TYPE_IDS) {
          const rng = mulberry32(hashSeed(id.length, x * 7, 0xc0ffee));
          const res = BUILDERS[id](THREE, rng, 1, SIZE);
          const mesh = new THREE.Mesh(geom.mergeGeometries(res.parts), mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.position.set(x + SIZE / 2, 0, 0);
          group.add(mesh);
          x += SIZE + GAP;
        }
        group.position.x = -x / 2;
        group.userData.parkTypes = TYPE_IDS.slice();
        return group;
      },
    });
  }
})();
