/* assets/models/park.js — городские парки: шесть типов.
 *
 *   'botanical'    — регулярный сад: крестовые дорожки, четыре партера, оранжерея;
 *   'amphitheater' — круглая сцена под навесом, ступенчатая трибуна на юге;
 *   'japanese'     — пруд, арочный мост, пагода, чайный домик, тории, бамбуковый забор;
 *   'maze'         — три вложенных кольца изгороди, фонтан в центре;
 *   'playground'   — две башни, мост, двойная горка, качели, карусель, песочница;
 *   'market'       — мощёная площадь, восемь палаток, трёхъярусный фонтан.
 *
 *   const result = MeridianParkKit.add({
 *     THREE, geom, scene, cx, cz, size,
 *     type, level, material, worldHalf, useMainRng,
 *   });
 *   // result = { parts, trees, mesh, type, level }
 *
 * Деревья НЕ входят в parts — только в массив trees. Регистрация в общий
 * instanced-меш — на стороне вызывающего (gta.html buildPark → addTree).
 */
(function () {
  'use strict';

  const PAL = {
    grass:    [0x4a7a3a, 0x5a8a48, 0x3a6a30, 0x4a8a38],
    pave:     [0x9a938a, 0x8a8880, 0xa8a098],
    stone:    [0x8a8a90, 0x7a7a80, 0x9a9aa0],
    wood:     [0x6a4a2a, 0x8a6a4a, 0x5a3a22],
    dark:     0x2a2a30,
    tree:     0x6b4a2f,
    water:    0x2a6a8f,
    waterL:   0x4a9ac0,
    rock:     0x8a8070,
    soil:     0x6a4a3a,
    hedge:    0x2a5a24,
    hedgeTop: 0x3a7a30,
    sand:     0xd4b878,
    gravel:   0xb0a898,
    fence:    0x4a4a50,
    cherry:   0xe8b8d0,
    cherryD:  0xf0c8dc,
    bamboo:   0x8a9a5a,
    bambooR:  0x6a7a3a,
    raked:    0xe8e0d0,
    rakedL:   0xb8b0a0,
    moss:     0x3a6a2a,
    pagoda:   0x8a3a2a,
    pagodaR:  0x6a3a30,
    pagodaB:  0x4a2820,
    torii:    0xb84a3a,
    toriiD:   0xa84a3a,
    pgRed:    0xd8443a, pgYellow: 0xe8c04a, pgBlue: 0x3a7ac8,
    pgGreen:  0x5fc87a, pgOrange: 0xe8843a, pgCream: 0xf0e8d0,
    rubberB:  0x3a5c8a,
    stall:    [0xd8443a, 0x3a7ac8, 0xe8c04a, 0xe8843a, 0x9a5ac8],
    stripe:   0xf0f0f0,
    goods:    [0xd83a4a, 0xe8c04a, 0x5fc87a, 0x9a5ac8, 0xe88a3a, 0x3a7ac8],
    roof:     0x6a3030,
    roofRim:  0x4a2020,
    wall:     0x7a7268,
    tier0:    0xb8b0a5,
    tier1:    0x9a938a,
    aisle:    0x606870,
    flowerR:  0xd83a4a, flowerY: 0xe8c04a, flowerP: 0x9a5ac8,
    flowerPk: 0xe89ac8, flowerO: 0xe88a3a, flowerB: 0x3a7ac8,
    window:   0xe8d4a0,
  };

  const TYPE_IDS = ['botanical', 'amphitheater', 'japanese', 'maze', 'playground', 'market'];

  let THREE = null;

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

  /* ---------- примитивы ---------- */
  function boxAt(w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
    return { geo: g, color };
  }
  function cylY(rt, rb, h, x, y, z, seg, color) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg || 12); g.translate(x, y, z);
    return { geo: g, color };
  }
  function sphAt(rx, ry, rz, x, y, z, color, seg) {
    const s = seg || 10;
    const g = new THREE.SphereGeometry(1, s, s - 2);
    g.scale(rx, ry, rz); g.translate(x, y, z);
    return { geo: g, color };
  }
  function coneY(r, h, x, y, z, seg, color) {
    const g = new THREE.ConeGeometry(r, h, seg || 8); g.translate(x, y, z);
    return { geo: g, color };
  }
  function tri(parts, ax, ay, az, bx, by, bz, cx, cy, cz, color) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([ax,ay,az, bx,by,bz, cx,cy,cz]), 3));
    g.computeVertexNormals();
    parts.push({ geo: g, color });
  }

  function pitchedRoof(parts, cx, cz, w, d, baseY, ridgeH, color, eave, ridgeColor) {
    const oh = eave || 0;
    const halfD = d / 2 + oh;
    const len = Math.hypot(ridgeH, halfD);
    const ang = Math.atan2(ridgeH, halfD);
    const ww = w + 2 * oh;
    const s1 = new THREE.BoxGeometry(ww, 0.14, len);
    s1.rotateX(ang);
    s1.translate(cx, baseY + ridgeH / 2, cz + halfD / 2);
    parts.push({ geo: s1, color });
    const s2 = new THREE.BoxGeometry(ww, 0.14, len);
    s2.rotateX(-ang);
    s2.translate(cx, baseY + ridgeH / 2, cz - halfD / 2);
    parts.push({ geo: s2, color });
    const rr = new THREE.BoxGeometry(ww + 0.1, 0.10, 0.16);
    rr.translate(cx, baseY + ridgeH + 0.03, cz);
    parts.push({ geo: rr, color: ridgeColor || 0x3a2a24 });
    const gxE = cx + w / 2, gxW = cx - w / 2;
    const zS = cz + d / 2, zN = cz - d / 2;
    const yT = baseY + ridgeH;
    tri(parts, gxE, baseY, zS,  gxE, baseY, zN,  gxE, yT, cz,  color);
    tri(parts, gxE, baseY, zN,  gxE, baseY, zS,  gxE, yT, cz,  color);
    tri(parts, gxW, baseY, zN,  gxW, baseY, zS,  gxW, yT, cz,  color);
    tri(parts, gxW, baseY, zS,  gxW, baseY, zN,  gxW, yT, cz,  color);
  }

  function sectorWedge(rIn, rOut, a0, a1, yBot, yTop, color) {
    const shape = new THREE.Shape();
    shape.moveTo(Math.cos(a1) * rIn,  -Math.sin(a1) * rIn);
    shape.lineTo(Math.cos(a1) * rOut, -Math.sin(a1) * rOut);
    shape.lineTo(Math.cos(a0) * rOut, -Math.sin(a0) * rOut);
    shape.lineTo(Math.cos(a0) * rIn,  -Math.sin(a0) * rIn);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: yTop - yBot, bevelEnabled: false, curveSegments: 1,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, yBot, 0);
    return { geo, color };
  }

  /* ---------- мебель ---------- */
  function bench(parts, x, z, ry) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const put = (geo, lx, ly, lz, color) => {
      if (ry) geo.rotateY(ry);
      const rx = lx * c + lz * s, rz = -lx * s + lz * c;
      geo.translate(x + rx, ly, z + rz);
      parts.push({ geo, color });
    };
    const w = 1.8;
    put(new THREE.BoxGeometry(w, 0.08, 0.4), 0, 0.45, 0, PAL.wood[1]);
    put(new THREE.BoxGeometry(w, 0.4, 0.08), 0, 0.68, -0.18, PAL.wood[0]);
    for (const dx of [-w / 2 + 0.15, w / 2 - 0.15])
      for (const dz of [-0.12, 0.12])
        put(new THREE.BoxGeometry(0.08, 0.45, 0.08), dx, 0.225, dz, PAL.dark);
  }
  function lampPost(parts, x, z) {
    parts.push(cylY(0.07, 0.11, 3.0, x, 1.5, z, 6, PAL.dark));
    parts.push(boxAt(0.5, 0.45, 0.5, x, 3.15, z, 0xe8c04a));
    parts.push(coneY(0.35, 0.32, x, 3.5, z, 4, PAL.dark));
  }
  function stoneLantern(parts, lx, lz) {
    parts.push(cylY(0.30, 0.38, 0.30, lx, 0.15, lz, 6, PAL.stone[0]));
    parts.push(cylY(0.16, 0.20, 0.90, lx, 0.75, lz, 6, PAL.stone[1]));
    parts.push(boxAt(0.55, 0.10, 0.55, lx, 1.25, lz, PAL.stone[0]));
    parts.push(boxAt(0.55, 0.45, 0.55, lx, 1.52, lz, PAL.stone[2]));
    parts.push(coneY(0.55, 0.50, lx, 1.99, lz, 4, PAL.stone[0]));
    parts.push(sphAt(0.10, 0.10, 0.10, lx, 2.32, lz, PAL.stone[1], 6));
  }

  /* ---------- 1. botanical ---------- */
  function buildBotanical(rng, level, size) {
    const p = [], trees = [];
    const R = size / 2;
    p.push(boxAt(size, 0.10, size, 0, 0.05, 0, PAL.grass[1]));
    p.push(boxAt(size, 0.11, 3.4, 0, 0.06, 0, PAL.gravel));
    p.push(boxAt(3.4, 0.11, size, 0, 0.06, 0, PAL.gravel));
    p.push(cylY(4.6, 4.6, 0.12, 0, 0.07, 0, 8, PAL.pave[0]));
    p.push(cylY(4.2, 4.2, 0.13, 0, 0.08, 0, 8, PAL.pave[2]));
    p.push(cylY(1.0, 1.2, 0.30, 0, 0.20, 0, 12, PAL.stone[0]));
    p.push(cylY(0.65, 0.75, 1.00, 0, 0.85, 0, 12, PAL.stone[1]));
    p.push(cylY(0.95, 0.65, 0.35, 0, 1.52, 0, 12, PAL.stone[0]));
    p.push(sphAt(0.35, 0.40, 0.35, 0, 2.05, 0, PAL.stone[2], 10));

    const bs = 9.5, off = bs / 2 + 2.5;
    const fcols = [PAL.flowerR, PAL.flowerY, PAL.flowerP, PAL.flowerPk, PAL.flowerO, PAL.flowerB];
    for (const [bx, bz] of [[-off, -off], [off, -off], [-off, off], [off, off]]) {
      p.push(boxAt(bs + 0.8, 0.13, bs + 0.8, bx, 0.065, bz, PAL.gravel));
      const ht = 0.34, hw = 0.32;
      p.push(boxAt(bs + hw * 2, ht, hw, bx, 0.13 + ht / 2, bz + bs / 2 + hw / 2, PAL.hedge));
      p.push(boxAt(bs + hw * 2, ht, hw, bx, 0.13 + ht / 2, bz - bs / 2 - hw / 2, PAL.hedge));
      p.push(boxAt(hw, ht, bs, bx + bs / 2 + hw / 2, 0.13 + ht / 2, bz, PAL.hedge));
      p.push(boxAt(hw, ht, bs, bx - bs / 2 - hw / 2, 0.13 + ht / 2, bz, PAL.hedge));
      p.push(boxAt(bs - 0.4, 0.15, bs - 0.4, bx, 0.145, bz, PAL.soil));
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          const fx = bx - bs / 2 + 1.3 + i * (bs - 2.6) / 3;
          const fz = bz - bs / 2 + 1.3 + j * (bs - 2.6) / 3;
          p.push(sphAt(0.55, 0.32, 0.55, fx, 0.34, fz, fcols[(i + j) % fcols.length], 6));
        }
    }

    const gx = R - 4.5;
    p.push(boxAt(7.5, 0.25, 5.5, gx, 0.125, 0, PAL.stone[0]));
    for (const dx of [-3, 0, 3])
      for (const dz of [-2, 2])
        p.push(boxAt(0.14, 3.0, 0.14, gx + dx, 1.6, dz, PAL.dark));
    p.push(boxAt(7.6, 0.14, 5.6, gx, 3.10, 0, PAL.dark));
    p.push(boxAt(7.6, 0.16, 0.18, gx, 3.30, 0, PAL.dark));
    p.push(boxAt(7.8, 0.06, 5.8, gx, 3.18, 0, 0x4a5a68));

    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) lampPost(p, dx, dz);
    for (const [dx, dz] of [[-R + 2.5, -R + 2.5], [R - 2.5, -R + 2.5],
                            [-R + 2.5, R - 2.5], [R - 2.5, R - 2.5]])
      trees.push({ x: dx, z: dz, scale: 0.85, hue: PAL.grass[0] });

    return { parts: p, trees };
  }

  /* ---------- 2. amphitheater ---------- */
  function buildAmphitheater(rng, level, size) {
    const p = [], trees = [];
    const R = size / 2;
    p.push(boxAt(size, 0.10, size, 0, 0.05, 0, PAL.grass[1]));
    p.push(cylY(R - 0.5, R - 0.5, 0.11, 0, 0.06, 0, 48, PAL.pave[0]));
    p.push(cylY(R - 1.0, R - 1.0, 0.13, 0, 0.07, 0, 48, PAL.pave[2]));

    const stageR = 5.5, stageH = 0.6;
    p.push(cylY(stageR, stageR, stageH, 0, stageH / 2, 0, 32, PAL.stone[0]));
    p.push(cylY(stageR - 0.3, stageR - 0.3, 0.10, 0, stageH + 0.05, 0, 32, PAL.wood[1]));

    const roofR = stageR + 1.5, roofH = 0.20, roofY = 4.5;
    p.push(cylY(roofR, roofR, roofH, 0, roofY, 0, 40, PAL.roof));
    p.push(cylY(roofR + 0.15, roofR + 0.15, 0.08, 0, roofY - 0.15, 0, 40, PAL.roofRim));
    const pillarN = 8;
    for (let i = 0; i < pillarN; i++) {
      const a = (i + 0.5) * Math.PI * 2 / pillarN;
      const x = Math.cos(a) * (stageR + 0.7);
      const z = Math.sin(a) * (stageR + 0.7);
      p.push(cylY(0.10, 0.13, roofY - roofH / 2, x, (roofY - roofH / 2) / 2, z, 8, PAL.dark));
      p.push(boxAt(0.32, 0.12, 0.32, x, roofY - 0.35, z, 0x9a9aa0));
    }
    p.push(cylY(0.10, 0.14, 0.6, 0, roofY + roofH / 2 + 0.3, 0, 8, PAL.dark));
    p.push(sphAt(0.22, 0.22, 0.22, 0, roofY + roofH / 2 + 0.7, 0, 0xd4b878, 8));

    const tierStart = stageR + 1.0;
    const tierDepth = 1.2, tierH = 0.32, tierCount = 5;
    const rOutLast = tierStart + tierCount * tierDepth;
    const yTopLast = 0.15 + tierCount * tierH;

    {
      const rWall = rOutLast + 0.04;
      const hWall = yTopLast - 0.15 - 0.04;
      const g = new THREE.CylinderGeometry(rWall, rWall, hWall, 40, 1, true, -Math.PI / 2, Math.PI);
      g.translate(0, 0.15 + hWall / 2, 0);
      p.push({ geo: g, color: PAL.wall });
    }

    for (const a of [0, Math.PI]) {
      const dir = Math.cos(a);
      for (let t = 0; t < tierCount; t++) {
        const midR = tierStart + (t + 0.5) * tierDepth;
        const topY = 0.15 + (t + 1) * tierH;
        const h = topY - 0.15;
        p.push(boxAt(tierDepth + 0.04, h, 0.10, dir * midR, 0.15 + h / 2, 0, PAL.wall));
        p.push(boxAt(tierDepth + 0.10, 0.06, 0.14, dir * midR, topY + 0.03, 0, 0x5a5450));
      }
    }

    const segCount = 24;
    const dA = Math.PI / segCount;
    const aisleArcs = [Math.PI * 0.28, Math.PI * 0.72];
    const aisleIdx = aisleArcs.map(arc => Math.round(arc / dA - 0.5));

    for (let t = 0; t < tierCount; t++) {
      const rIn = tierStart + t * tierDepth;
      const rOut = rIn + tierDepth;
      const yBot = 0.15 + t * tierH;
      const yTop = yBot + tierH;
      const col = (t % 2 === 0) ? PAL.tier0 : PAL.tier1;
      for (let i = 0; i < segCount; i++) {
        const isAisle = aisleIdx.indexOf(i) >= 0;
        const a0 = i * dA;
        const a1 = a0 + dA;
        p.push(sectorWedge(rIn, rOut, a0, a1, yBot, yTop, isAisle ? PAL.aisle : col));
      }
    }

    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (i + 0.5) * Math.PI / 6;
      lampPost(p, Math.cos(a) * (R - 1.8), Math.sin(a) * (R - 1.8));
    }
    for (const [tx, tz] of [[R - 3, -R + 3], [R - 3, R - 3], [-R + 3, -R + 3], [-R + 3, R - 3]])
      trees.push({ x: tx, z: tz, scale: 0.85, hue: PAL.grass[0] });

    return { parts: p, trees };
  }

  /* ---------- 3. japanese ---------- */
  function buildJapanese(rng, level, size) {
    const p = [], trees = [];
    const R = size / 2;

    p.push(boxAt(size, 0.10, size, 0, 0.05, 0, PAL.raked));
    for (let i = 0; i < 12; i++) {
      const z = -R + 2.5 + i * (size - 5) / 11;
      p.push(boxAt(9, 0.005, 0.12, -R + 6, 0.101, z, PAL.rakedL));
    }

    const px = 4, pz = -3;
    p.push(cylY(5.5, 5.5, 0.10, px, 0.06, pz, 22, PAL.water));
    p.push(cylY(5.0, 5.0, 0.11, px, 0.065, pz, 22, PAL.waterL));
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI * 2 / 12 + 0.3;
      const r = 5.6 + (i % 2) * 0.25;
      p.push(boxAt(0.7 + (i % 3) * 0.15, 0.4 + (i % 2) * 0.2, 0.65,
        px + Math.cos(a) * r, 0.20 + (i % 2) * 0.05, pz + Math.sin(a) * r, PAL.rock));
    }

    const bspan = 12, bWidth = 1.6, segs = 12, deckEndY = 0.26, bArch = 1.3;
    for (let i = 0; i < segs; i++) {
      const t = (i + 0.5) / segs;
      const sx = px - bspan / 2 + t * bspan;
      const dy = deckEndY + Math.sin(t * Math.PI) * bArch;
      const g = new THREE.BoxGeometry(bspan / segs + 0.06, 0.12, bWidth);
      g.translate(sx, dy, pz);
      p.push({ geo: g, color: PAL.wood[1] });
      for (const dz of [-bWidth / 2 + 0.12, bWidth / 2 - 0.12]) {
        const hh = 0.8;
        p.push(cylY(0.05, 0.05, hh, sx, dy + 0.06 + hh / 2, pz + dz, 5, PAL.wood[0]));
        const rr = new THREE.BoxGeometry(bspan / segs + 0.06, 0.07, 0.07);
        rr.translate(sx, dy + 0.06 + hh, pz + dz);
        p.push({ geo: rr, color: PAL.wood[0] });
      }
    }
    for (const side of [-1, 1]) {
      const sx = px + side * (bspan / 2 - 0.4);
      p.push(boxAt(0.9, 0.20, 1.9, sx, 0.10, pz, PAL.stone[0]));
      p.push(boxAt(1.1, 0.06, 2.1, sx, 0.23, pz, PAL.stone[1]));
    }

    const fbx = R - 6, fbz = R - 6;
    for (let i = 0; i < 8; i++) {
      const cx = fbx - 3 + i * 0.9;
      p.push(boxAt(0.5, 0.10, 1.2, cx, 0.10, fbz, PAL.rock));
    }
    p.push(boxAt(3.0, 0.12, 1.4, fbx, 0.32, fbz, PAL.wood[0]));
    for (const dx of [-1.3, 1.3])
      for (const dz of [-0.6, 0.6])
        p.push(cylY(0.05, 0.05, 0.5, fbx + dx, 0.12, fbz + dz, 5, PAL.wood[2]));
    for (const dz of [-0.55, 0.55])
      p.push(boxAt(3.0, 0.06, 0.06, fbx, 0.68, fbz + dz, PAL.wood[2]));

    const pgx = R - 6, pgz = -R + 6;
    const tiers = 3, tierPitch = 2.20, wallH = 1.40, eaveT = 0.10, roofH = 0.55, capH = 0.15;
    const baseY = 0.30;
    p.push(boxAt(5.5, 0.30, 5.5, pgx, baseY / 2, pgz, PAL.stone[0]));
    for (let t = 0; t < tiers; t++) {
      const s = 4.4 - t * 1.0, sNext = s - 1.0;
      const y0 = baseY + t * tierPitch;
      p.push(boxAt(s, wallH, s, pgx, y0 + wallH / 2, pgz, PAL.pagoda));
      const winW = 0.55, winH = 0.6, winT = 0.10;
      const wy = y0 + wallH * 0.55;
      p.push(boxAt(winT, winH, winW, pgx + s / 2 + winT / 2, wy, pgz, PAL.window));
      p.push(boxAt(winT, winH, winW, pgx - s / 2 - winT / 2, wy, pgz, PAL.window));
      p.push(boxAt(winW, winH, winT, pgx, wy, pgz + s / 2 + winT / 2, PAL.window));
      p.push(boxAt(winW, winH, winT, pgx, wy, pgz - s / 2 - winT / 2, PAL.window));
      const eaveW = s + 0.9;
      p.push(boxAt(eaveW, eaveT, eaveW, pgx, y0 + wallH + eaveT / 2, pgz, PAL.pagodaB));
      const roofBot = y0 + wallH + eaveT;
      const topSide = sNext + 0.2;
      const rb = eaveW / Math.SQRT2;
      const rt = topSide / Math.SQRT2;
      const roofGeo = new THREE.CylinderGeometry(rt, rb, roofH, 4);
      roofGeo.rotateY(Math.PI / 4);
      roofGeo.translate(pgx, roofBot + roofH / 2, pgz);
      p.push({ geo: roofGeo, color: PAL.pagodaR });
      const capY = roofBot + roofH;
      p.push(boxAt(topSide + 0.10, capH, topSide + 0.10, pgx, capY + capH / 2, pgz, PAL.pagodaB));
    }
    const topY = baseY + tiers * tierPitch;
    p.push(cylY(0.05, 0.05, 0.9, pgx, topY + 0.45, pgz, 5, 0x3a3a40));
    p.push(sphAt(0.14, 0.14, 0.14, pgx, topY + 1.00, pgz, 0xd4a840, 6));

    const thx = -R + 7, thz = -R + 5;
    p.push(boxAt(4.6, 0.20, 3.6, thx, 0.10, thz, PAL.stone[0]));
    for (const dx of [-2.0, 2.0])
      for (const dz of [-1.5, 1.5])
        p.push(cylY(0.10, 0.12, 2.2, thx + dx, 1.10, thz + dz, 6, PAL.wood[0]));
    p.push(boxAt(4.8, 0.14, 3.8, thx, 2.25, thz, PAL.wood[1]));
    pitchedRoof(p, thx, thz, 4.8, 3.8, 2.32, 1.0, 0x4a3a2a, 0.5, 0x2a1e18);
    p.push(boxAt(0.10, 1.8, 3.0, thx + 2.35, 1.10, thz, 0xf0e8d0));
    for (let i = 0; i < 4; i++)
      p.push(boxAt(0.12, 0.06, 3.0, thx + 2.35, 0.30 + i * 0.45, thz, PAL.wood[0]));

    const stepPath = [
      [-12.5,  0.2], [-11.1, -0.2], [-9.7, -0.6],
      [-8.5, -1.0],
      [-7.5, -1.9], [-6.6, -2.9], [-5.7, -3.9],
      [-7.6, -0.2], [-6.4,  1.0], [-5.0,  2.1],
      [-3.4,  3.1], [-1.6,  3.9], [ 0.3,  4.6],
      [ 2.3,  5.1], [ 4.3,  5.4], [ 6.3,  5.5],
    ];
    for (const [sx2, sz2] of stepPath) {
      p.push(cylY(0.50, 0.50, 0.06, sx2, 0.13, sz2, 10, PAL.stone[1]));
      p.push(cylY(0.42, 0.42, 0.08, sx2, 0.14, sz2, 10, PAL.stone[0]));
    }

    stoneLantern(p, px + 6.5, pz + 4);
    stoneLantern(p, px - 6.5, pz - 4);
    stoneLantern(p, R - 5, 4);
    stoneLantern(p, -R + 2, 3.5);
    stoneLantern(p, -R + 2, -3.5);

    const tx = -R + 3;
    p.push(cylY(0.28, 0.32, 4.5, tx, 2.25, -1.6, 8, PAL.torii));
    p.push(cylY(0.28, 0.32, 4.5, tx, 2.25,  1.6, 8, PAL.torii));
    p.push(boxAt(0.5, 0.5, 4.4, tx, 4.55, 0, PAL.torii));
    p.push(boxAt(0.4, 0.35, 3.6, tx, 3.5, 0, PAL.torii));
    p.push(boxAt(0.9, 0.5, 0.9, tx, 4.9, 0, PAL.toriiD));

    const fenceH = 1.6, gapHalf = 3.2, postStep = 1.4;
    for (const side of [-1, 1]) {
      const fz = side * (R - 0.9);
      for (let x = -R + 1; x <= R - 1; x += postStep)
        p.push(cylY(0.06, 0.06, fenceH, x, fenceH / 2, fz, 5, PAL.bamboo));
      for (const yy of [0.35, 0.75, 1.15])
        p.push(boxAt(2 * R - 2, 0.06, 0.08, 0, yy, fz, PAL.bambooR));
    }
    {
      const fx = R - 0.9;
      for (let z = -R + 1; z <= R - 1; z += postStep)
        p.push(cylY(0.06, 0.06, fenceH, fx, fenceH / 2, z, 5, PAL.bamboo));
      for (const yy of [0.35, 0.75, 1.15])
        p.push(boxAt(0.08, 0.06, 2 * R - 2, fx, yy, 0, PAL.bambooR));
    }
    {
      const fx = -R + 0.9;
      for (const [zmin, zmax] of [[-R + 1, -gapHalf], [gapHalf, R - 1]]) {
        for (let z = zmin; z <= zmax; z += postStep)
          p.push(cylY(0.06, 0.06, fenceH, fx, fenceH / 2, z, 5, PAL.bamboo));
        const cz = (zmin + zmax) / 2, len = zmax - zmin;
        for (const yy of [0.35, 0.75, 1.15])
          p.push(boxAt(0.08, 0.06, len, fx, yy, cz, PAL.bambooR));
      }
      for (const ez of [-gapHalf, gapHalf])
        p.push(cylY(0.10, 0.12, fenceH + 0.3, fx, (fenceH + 0.3) / 2, ez, 6, 0x6a5a3a));
    }

    for (const [cx, cz] of [[R - 4, R - 4], [R - 6.5, R - 3], [R - 3, R - 7]])
      trees.push({ x: cx, z: cz, scale: 0.85, hue: PAL.cherry });
    trees.push({ x: -R + 3, z: 6, scale: 0.8, hue: PAL.cherry });
    trees.push({ x: -R + 4, z: 9, scale: 0.8, hue: PAL.cherry });
    for (const [cx, cz] of [[-R + 8, R - 3], [-R + 12, R - 3.5], [0, R - 3], [4, R - 3.5], [8, R - 3]])
      trees.push({ x: cx, z: cz, scale: 0.85, hue: PAL.grass[(cx + cz) & 1 ? 0 : 1] });
    for (const [cx, cz] of [[-4, -R + 3], [0, -R + 3.2], [4, -R + 3]])
      trees.push({ x: cx, z: cz, scale: 0.85, hue: PAL.grass[0] });

    const bambooGrove = [[R - 4, -1], [R - 3.6, 0.5], [R - 4.4, 0.8],
                         [R - 3.4, -1.4], [R - 4.1, 1.5], [R - 3.1, 0.2]];
    for (const [bx2, bz2] of bambooGrove) {
      const hh = 3.6 + ((bx2 * 13 + bz2 * 7) % 10) * 0.1;
      p.push(cylY(0.08, 0.10, hh, bx2, hh / 2, bz2, 6, PAL.bamboo));
      for (let n = 0; n < 5; n++) {
        const ny = 1.0 + n * (hh - 1.2) / 5;
        p.push(cylY(0.09, 0.09, 0.06, bx2, ny, bz2, 6, PAL.bambooR));
      }
      p.push(sphAt(0.55, 0.45, 0.55, bx2, hh - 0.1, bz2, PAL.grass[2], 5));
    }

    for (const [mx, mz] of [[-R + 6, R - 4], [-R + 5.5, R - 6], [R - 6, -R + 3]])
      p.push(sphAt(0.9, 0.35, 0.9, mx, 0.10, mz, PAL.moss, 8));

    p.push(sphAt(0.35, 0.30, 0.35, 4.0, 0.15, 3.5, PAL.stone[0], 6));
    p.push(sphAt(0.28, 0.24, 0.28, 5.0, 0.12, 3.2, PAL.stone[1], 6));
    p.push(sphAt(0.22, 0.20, 0.22, 3.2, 0.10, 3.7, PAL.stone[2], 6));

    return { parts: p, trees };
  }

  /* ---------- 4. maze ---------- */
  function buildMaze(rng, level, size) {
    const p = [], trees = [];
    const R = size / 2;
    p.push(boxAt(size, 0.10, size, 0, 0.05, 0, PAL.grass[0]));
    for (const s of [-1, 1]) {
      p.push(boxAt(size, 0.11, 2.0, 0, 0.06, s * (R - 1.0), PAL.pave[0]));
      p.push(boxAt(2.0, 0.11, size, s * (R - 1.0), 0.06, 0, PAL.pave[0]));
    }
    const HH = 2.4, HT = 0.55, gapW = 2.6;
    const wall = (axis, crossPos, min, max, gapCenter) => {
      const segs = [];
      if (gapCenter == null) segs.push([min, max]);
      else {
        const gL = gapCenter - gapW / 2, gR = gapCenter + gapW / 2;
        if (gL > min) segs.push([min, gL]);
        if (max > gR) segs.push([gR, max]);
      }
      for (const [a, b] of segs) {
        if (b <= a) continue;
        if (axis === 'x') {
          p.push(boxAt(b - a, HH, HT, (a + b) / 2, HH / 2, crossPos, PAL.hedge));
          p.push(boxAt(b - a + 0.02, 0.10, HT + 0.06, (a + b) / 2, HH + 0.05, crossPos, PAL.hedgeTop));
        } else {
          p.push(boxAt(HT, HH, b - a, crossPos, HH / 2, (a + b) / 2, PAL.hedge));
          p.push(boxAt(HT + 0.06, 0.10, b - a + 0.02, crossPos, HH + 0.05, (a + b) / 2, PAL.hedgeTop));
        }
      }
    };
    const rings = [
      { r: R - 4.0, gap: 'W' },
      { r: R - 7.5, gap: 'E' },
      { r: R - 11.0, gap: 'S' },
    ];
    for (const { r, gap } of rings) {
      wall('x', -r, -r, r, gap === 'N' ? 0 : null);
      wall('x',  r, -r, r, gap === 'S' ? 0 : null);
      wall('z', -r, -r, r, gap === 'W' ? 0 : null);
      wall('z',  r, -r, r, gap === 'E' ? 0 : null);
    }
    p.push(cylY(4.0, 4.0, 0.15, 0, 0.075, 0, 28, PAL.pave[1]));
    p.push(cylY(3.4, 3.4, 0.16, 0, 0.08, 0, 28, PAL.pave[2]));
    p.push(cylY(1.2, 1.4, 0.5, 0, 0.25, 0, 16, PAL.stone[0]));
    p.push(cylY(0.8, 1.0, 0.4, 0, 0.70, 0, 16, PAL.stone[1]));
    p.push(cylY(1.0, 0.8, 0.3, 0, 1.05, 0, 16, PAL.stone[0]));
    p.push(sphAt(0.35, 0.4, 0.35, 0, 1.50, 0, PAL.stone[2], 8));
    p.push(cylY(0.95, 0.95, 0.03, 0, 1.31, 0, 16, PAL.waterL));
    p.push(cylY(1.05, 1.05, 0.03, 0, 0.55, 0, 16, PAL.waterL));
    const dc = (R - 2) * 0.7071;
    bench(p, -dc, -dc, Math.PI / 4);
    bench(p,  dc, -dc, -Math.PI / 4);
    bench(p, -dc,  dc, 3 * Math.PI / 4);
    bench(p,  dc,  dc, -3 * Math.PI / 4);
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) * Math.PI / 4;
      trees.push({ x: Math.cos(a) * (R - 0.5), z: Math.sin(a) * (R - 0.5),
                   scale: 0.75, hue: PAL.grass[i % PAL.grass.length] });
    }
    return { parts: p, trees };
  }

  /* ---------- 5. playground ---------- */
  function buildPlayground(rng, level, size) {
    const p = [], trees = [];
    const R = size / 2;
    p.push(boxAt(size, 0.10, size, 0, 0.05, 0, PAL.grass[1]));
    p.push(boxAt(size, 0.12, size, 0, 0.06, 0, PAL.rubberB));
    p.push(boxAt(size - 2, 0.13, size - 2, 0, 0.065, 0, 0x304a70));

    {
      const stripColors = [PAL.pgRed, PAL.pgYellow, PAL.pgGreen, PAL.pgYellow, PAL.pgRed];
      const stripW = 2.6;
      const totalW = stripColors.length * stripW;
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < stripColors.length; i++) {
          const x = -totalW / 2 + stripW / 2 + i * stripW;
          p.push(boxAt(stripW - 0.08, 0.06, 2.0, x, 0.12, sgn * 12.5, stripColors[i]));
        }
      }
    }

    const fh = 0.85;
    const fenceEdge = R - 0.6;
    const postStep = 1.54;
    const gateHalf = 1.6;
    const cornerR = 0.09;
    for (const [cx, cz] of [[-fenceEdge, -fenceEdge], [fenceEdge, -fenceEdge],
                            [fenceEdge, fenceEdge], [-fenceEdge, fenceEdge]])
      p.push(cylY(cornerR, cornerR, fh + 0.30, cx, (fh + 0.30) / 2, cz, 6, PAL.fence));

    const buildEdge = (ax, az, bx, bz, hasGate) => {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const n = Math.round(len / postStep);
      const step = len / n;
      const mid = len / 2;
      const regularDs = [];
      for (let i = 1; i < n; i++) regularDs.push(i * step);
      const gateL = hasGate ? mid - gateHalf : null;
      const gateR = hasGate ? mid + gateHalf : null;
      let finalDs;
      if (hasGate) {
        finalDs = regularDs.filter(d => d < gateL - 0.05 || d > gateR + 0.05);
        finalDs.push(gateL, gateR);
        finalDs.sort((a, b) => a - b);
      } else {
        finalDs = regularDs.slice();
      }
      const onGateEdge = d => hasGate && (Math.abs(d - gateL) < 0.01 || Math.abs(d - gateR) < 0.01);
      for (const d of finalDs) {
        const t = d / len;
        const x = ax + dx * t, z = az + dz * t;
        const r = onGateEdge(d) ? 0.09 : 0.05;
        const h = onGateEdge(d) ? fh + 0.30 : fh;
        p.push(cylY(r, r, h, x, h / 2, z, 6, PAL.fence));
      }
      const drawRail = (x1, z1, x2, z2, y) => {
        const ddx = x2 - x1, ddz = z2 - z1;
        const L = Math.hypot(ddx, ddz);
        if (L < 0.05) return;
        const ang = Math.atan2(ddz, ddx);
        const g = new THREE.BoxGeometry(L, 0.05, 0.05);
        g.rotateY(-ang);
        g.translate((x1 + x2) / 2, y, (z1 + z2) / 2);
        p.push({ geo: g, color: PAL.fence });
      };
      const railYs = [0.30, fh - 0.06];
      const pathDs = [0, ...finalDs, len];
      for (let k = 0; k < pathDs.length - 1; k++) {
        const dA = pathDs[k], dB = pathDs[k + 1];
        if (hasGate && Math.abs(dA - gateL) < 0.01 && Math.abs(dB - gateR) < 0.01) continue;
        const tA = dA / len, tB = dB / len;
        const xA = ax + dx * tA, zA = az + dz * tA;
        const xB = ax + dx * tB, zB = az + dz * tB;
        for (const ry of railYs) drawRail(xA, zA, xB, zB, ry);
      }
    };
    buildEdge(-fenceEdge, -fenceEdge,  fenceEdge, -fenceEdge, true);
    buildEdge( fenceEdge, -fenceEdge,  fenceEdge,  fenceEdge, false);
    buildEdge( fenceEdge,  fenceEdge, -fenceEdge,  fenceEdge, true);
    buildEdge(-fenceEdge,  fenceEdge, -fenceEdge, -fenceEdge, false);

    {
      const bx = -10, bz = -10;
      p.push(sphAt(2.2, 1.6, 2.2, bx, 1.6, bz, 0x7a7268, 12));
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5;
        p.push(sphAt(0.38, 0.28, 0.38,
          bx + Math.cos(a) * 1.5, 0.55 + (i % 2) * 0.55, bz + Math.sin(a) * 1.5,
          0x8a8278, 8));
      }
      for (let i = 0; i < 6; i++)
        p.push(boxAt(1.4, 1.0, 0.9, bx, 0.55, bz + 3.5 + i * 0.9,
          i % 2 === 0 ? PAL.pgGreen : PAL.pgYellow));
    }

    const tW = 2.4, tH = 3.4, tD = 2.4;
    const t1x = -2, t1z = -8, t2x = 3, t2z = -8;
    const platformY = 2.0;
    const tower = (tx, tz, accent) => {
      for (const dx of [-tW / 2 + 0.15, tW / 2 - 0.15])
        for (const dz of [-tD / 2 + 0.15, tD / 2 - 0.15])
          p.push(cylY(0.10, 0.12, tH, tx + dx, tH / 2, tz + dz, 8, PAL.dark));
      p.push(boxAt(tW, 0.14, tD, tx, platformY, tz, accent));
      const rH = 0.7, rW = 0.06;
      for (const dz of [-tD / 2 + 0.03, tD / 2 - 0.03]) {
        p.push(boxAt(tW, rH, rW, tx, platformY + rH / 2 + 0.07, tz + dz, PAL.dark));
        p.push(boxAt(tW, 0.06, rW, tx, platformY + rH + 0.07, tz + dz, accent));
      }
      for (const dx of [-tW / 2 + 0.03, tW / 2 - 0.03]) {
        p.push(boxAt(rW, rH, tD, tx + dx, platformY + rH / 2 + 0.07, tz, PAL.dark));
        p.push(boxAt(rW, 0.06, tD, tx + dx, platformY + rH + 0.07, tz, accent));
      }
      const wallH = platformY - 0.07;
      p.push(boxAt(tW - 0.1, wallH, 0.06, tx, wallH / 2, tz - tD / 2 + 0.05, accent));
      p.push(boxAt(tW - 0.1, wallH, 0.06, tx, wallH / 2, tz + tD / 2 - 0.05, accent));
      p.push(boxAt(0.06, wallH, tD - 0.1, tx - tW / 2 + 0.05, wallH / 2, tz, accent));
      const cap = new THREE.ConeGeometry(Math.max(tW, tD) * 0.85, 0.9, 4);
      cap.rotateY(Math.PI / 4);
      cap.translate(tx, tH + 0.5, tz);
      p.push({ geo: cap, color: accent });
      p.push(cylY(0.03, 0.03, 1.0, tx, tH + 1.5, tz, 5, PAL.dark));
      p.push(boxAt(0.5, 0.3, 0.02, tx + 0.25, tH + 1.85, tz, accent));
    };
    tower(t1x, t1z, PAL.pgRed);
    tower(t2x, t2z, PAL.pgBlue);

    const bridgeY = platformY + 0.05;
    const bridgeLen = t2x - t1x - tW;
    p.push(boxAt(bridgeLen, 0.10, 1.4, (t1x + t2x) / 2, bridgeY, t1z, PAL.pgYellow));
    for (const dz of [-0.65, 0.65]) {
      p.push(boxAt(bridgeLen, 0.06, 0.06, (t1x + t2x) / 2, bridgeY + 0.55, t1z + dz, PAL.dark));
      for (let bx = 0; bx <= 6; bx++) {
        const bx2 = t1x + tW / 2 + bx * bridgeLen / 6;
        p.push(cylY(0.03, 0.03, 0.5, bx2, bridgeY + 0.28, t1z + dz, 5, PAL.dark));
      }
    }

    const slideTilt = 0.54, slideL = 3.6;
    const slideTopZ = tD / 2;
    const slideMidZ = t2z + slideTopZ + (slideL / 2) * Math.cos(slideTilt);
    const slideMidY = platformY - (slideL / 2) * Math.sin(slideTilt);
    for (const off of [-0.5, 0.5]) {
      const sg = new THREE.BoxGeometry(0.7, 0.12, slideL);
      sg.rotateX(slideTilt);
      sg.translate(t2x + off, slideMidY, slideMidZ);
      p.push({ geo: sg, color: off < 0 ? PAL.pgYellow : PAL.pgGreen });
      for (const sx of [-0.36, 0.36]) {
        const rr = new THREE.BoxGeometry(0.06, 0.30, slideL);
        rr.rotateX(slideTilt);
        rr.translate(t2x + off + sx, slideMidY + 0.10, slideMidZ);
        p.push({ geo: rr, color: PAL.pgRed });
      }
    }
    const slideBaseZ = t2z + slideTopZ + slideL * Math.cos(slideTilt);
    p.push(boxAt(2.2, 0.13, 1.2, t2x, 0.13, slideBaseZ + 0.4, PAL.pgOrange));

    for (let i = 0; i < 7; i++)
      p.push(cylY(0.03, 0.03, tW, t1x - tW / 2 + 0.05, 0.4 + i * 0.4, t1z, 6, PAL.dark));
    for (const dz of [-tD / 2 + 0.15, tD / 2 - 0.15])
      p.push(cylY(0.06, 0.06, tH + 0.2, t1x - tW / 2 + 0.05, tH / 2, t1z + dz, 6, PAL.pgRed));

    {
      const mgx = 10, mgz = -10;
      p.push(cylY(2.2, 2.2, 0.10, mgx, 0.15, mgz, 24, 0xa8483a));
      p.push(cylY(0.28, 0.32, 0.4, mgx, 0.35, mgz, 12, PAL.dark));
      p.push(cylY(1.8, 1.8, 0.08, mgx, 0.55, mgz, 24, PAL.pgGreen));
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI * 2 / 6;
        p.push(cylY(0.06, 0.06, 1.1, mgx + Math.cos(a) * 1.4, 1.05, mgz + Math.sin(a) * 1.4, 6, PAL.pgRed));
      }
      p.push(cylY(0.06, 0.06, 1.6, mgx, 1.30, mgz, 6, PAL.pgRed));
    }

    {
      const spx = -10, spz = 4, spR = 3.2;
      p.push(cylY(spR, spR, 0.20, spx, 0.10, spz, 24, PAL.pave[0]));
      p.push(cylY(spR - 0.4, spR - 0.4, 0.16, spx, 0.08, spz, 24, PAL.sand));
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        p.push(boxAt(0.5, 0.30, 0.4,
          spx + Math.cos(a) * (spR + 0.1), 0.15, spz + Math.sin(a) * (spR + 0.1),
          PAL.stone[0]));
      }
    }

    {
      const sx = 0, sz = 0;
      const sH = 2.6, sSpan = 4.0, tilt = 0.22;
      const cosT = Math.cos(tilt);
      const legH = sH / cosT;
      const halfZ = (legH / 2) * Math.sin(tilt);
      for (const sx2 of [-sSpan / 2, sSpan / 2]) {
        const gA = new THREE.BoxGeometry(0.10, legH, 0.10);
        gA.rotateX(tilt);
        gA.translate(sx + sx2, sH / 2, sz - halfZ);
        p.push({ geo: gA, color: PAL.pgBlue });
        const gB = new THREE.BoxGeometry(0.10, legH, 0.10);
        gB.rotateX(-tilt);
        gB.translate(sx + sx2, sH / 2, sz + halfZ);
        p.push({ geo: gB, color: PAL.pgBlue });
      }
      const bar = new THREE.CylinderGeometry(0.08, 0.08, sSpan + 0.7, 8);
      bar.rotateZ(Math.PI / 2);
      bar.translate(sx, sH, sz);
      p.push({ geo: bar, color: PAL.pgBlue });
      for (const swx of [sx - 1.0, sx + 1.0]) {
        for (const cx of [-0.18, 0.18])
          p.push(cylY(0.02, 0.02, sH - 0.5, swx + cx, 0.5 + (sH - 0.5) / 2, sz, 4, PAL.dark));
        p.push(boxAt(0.55, 0.06, 0.30, swx, 0.5, sz, PAL.pgYellow));
        p.push(boxAt(0.57, 0.02, 0.32, swx, 0.47, sz, PAL.dark));
      }
    }

    {
      const hx = 10, hz = 0;
      p.push(boxAt(3.2, 2.2, 3.2, hx, 1.1, hz, PAL.pgCream));
      pitchedRoof(p, hx, hz, 3.2, 3.2, 2.20, 0.9, PAL.pgRed, 0.35, 0xa03028);
      p.push(boxAt(1.2, 1.6, 0.10, hx, 0.8, hz + 1.62, PAL.dark));
      p.push(boxAt(0.7, 0.7, 0.10, hx - 1.2, 1.4, hz + 1.62, PAL.pgBlue));
      p.push(boxAt(0.7, 0.7, 0.10, hx + 1.2, 1.4, hz + 1.62, PAL.pgBlue));
      p.push(cylY(0.16, 0.18, 0.9, hx + 0.9, 2.9, hz - 0.9, 6, PAL.stone[0]));
    }

    {
      const rider = (rx, rz, colA, colB) => {
        p.push(cylY(0.10, 0.10, 0.5, rx, 0.25, rz, 8, PAL.dark));
        p.push(sphAt(0.30, 0.30, 0.30, rx, 0.60, rz, colA, 8));
        p.push(boxAt(0.22, 0.32, 0.85, rx, 0.55, rz - 0.35, colB));
        p.push(cylY(0.05, 0.05, 0.9, rx, 0.95, rz, 6, PAL.dark));
        p.push(sphAt(0.15, 0.15, 0.15, rx, 1.45, rz, colA, 6));
      };
      rider(-12, 10, PAL.pgRed, PAL.pgYellow);
      rider(-10, 10, PAL.pgYellow, PAL.pgBlue);
      rider(-8, 10, PAL.pgBlue, PAL.pgGreen);
    }

    {
      const swx = 0, swz = 10;
      const ang = 0.12;
      const sinA = Math.sin(ang), cosA = Math.cos(ang);
      const plankLen = 3.6, plankY = 0.62, plankT = 0.10;
      p.push(cylY(0.25, 0.35, 0.5, swx, 0.25, swz, 8, PAL.dark));
      const plank = new THREE.BoxGeometry(plankLen, plankT, 0.35);
      plank.rotateZ(ang);
      plank.translate(swx, plankY, swz);
      p.push({ geo: plank, color: PAL.pgRed });
      for (const sgn of [-1, 1]) {
        const seatX = swx + sgn * 1.5;
        const plankTopY = plankY + sgn * 1.5 * sinA + (plankT / 2) * cosA;
        p.push(boxAt(0.7, 0.06, 0.40, seatX, plankTopY + 0.03, swz,
                     sgn < 0 ? PAL.pgYellow : PAL.pgBlue));
        const hx = swx + sgn * 1.55;
        const handleY = plankTopY + 0.06 + 0.25;
        p.push(cylY(0.035, 0.035, 0.5, hx, handleY, swz, 8, PAL.dark));
        p.push(boxAt(0.06, 0.05, 0.45, hx, handleY + 0.25, swz, PAL.dark));
      }
    }

    bench(p, 10, 12, 0);
    bench(p, 12, 10, -Math.PI / 2);
    trees.push({ x: 13, z: 13, scale: 0.9, hue: PAL.grass[0] });

    bench(p, -R + 1.5, -5, Math.PI / 2);
    bench(p, -R + 1.5,  5, Math.PI / 2);
    bench(p,  R - 1.5, -5, -Math.PI / 2);
    bench(p,  R - 1.5,  5, -Math.PI / 2);

    for (const [tx, tz] of [[-R + 2, -R + 2], [R - 2, -R + 2], [-R + 2, R - 2]])
      trees.push({ x: tx, z: tz, scale: 0.85, hue: PAL.grass[0] });

    return { parts: p, trees };
  }

  /* ---------- 6. market ---------- */
  function buildMarket(rng, level, size) {
    const p = [], trees = [];
    const W = size, D = size * 0.85;
    const hW = W / 2, hD = D / 2;
    // Grass fills the block: square W+2 × W+2 so it reaches the sidewalk on
    // both axes. Pave stays rectangular (W × D); grass just extends further
    // on the Z axis to close the gap.
    p.push(boxAt(W + 2, 0.10, W + 2, 0, 0.05, 0, PAL.grass[1]));
    p.push(boxAt(W, 0.12, D, 0, 0.06, 0, PAL.pave[0]));

    const tileS = 1.4;
    const nx = Math.floor(W / tileS), nz = Math.floor(D / tileS);
    for (let ix = 0; ix < nx; ix++)
      for (let iz = 0; iz < nz; iz++) {
        const tx = -hW + tileS / 2 + ix * tileS;
        const tz = -hD + tileS / 2 + iz * tileS;
        const h = ((ix * 73856093) ^ (iz * 19349663)) >>> 0;
        const c = ((ix + iz + (h >>> 5)) % 5 === 0) ? 0x8a8078 : PAL.pave[1];
        p.push(boxAt(tileS - 0.05, 0.14, tileS - 0.05, tx, 0.07, tz, c));
      }

    p.push(cylY(2.8, 2.8, 0.22, 0, 0.11, 0, 24, PAL.stone[0]));
    p.push(cylY(2.4, 2.4, 0.16, 0, 0.20, 0, 24, PAL.waterL));
    p.push(cylY(0.7, 0.9, 1.2, 0, 0.82, 0, 12, PAL.stone[1]));
    p.push(cylY(1.3, 0.7, 0.4, 0, 1.52, 0, 12, PAL.stone[0]));
    p.push(cylY(1.0, 1.0, 0.12, 0, 1.58, 0, 12, PAL.waterL));
    p.push(cylY(0.4, 0.5, 0.9, 0, 2.15, 0, 10, PAL.stone[1]));
    p.push(cylY(0.7, 0.4, 0.28, 0, 2.72, 0, 10, PAL.stone[0]));
    p.push(sphAt(0.26, 0.32, 0.26, 0, 3.12, 0, PAL.stone[2], 8));

    const buildStall = (cx, cz, yaw, colorMain) => {
      const local = [];
      const push = (geo, lx, ly, lz, color) => {
        if (yaw) geo.rotateY(yaw);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const rx = lx * c + lz * s, rz = -lx * s + lz * c;
        geo.translate(cx + rx, ly, cz + rz);
        local.push({ geo, color });
      };
      const W2 = 2.0, D2 = 2.0, postH = 2.6;
      for (const dx of [-W2 / 2, W2 / 2])
        for (const dz of [-D2 / 2, D2 / 2])
          push(new THREE.BoxGeometry(0.10, postH, 0.10), dx, postH / 2, dz, PAL.wood[0]);
      push(new THREE.BoxGeometry(1.8, 0.10, 0.9), 0, 1.05, 0.35, PAL.wood[1]);
      push(new THREE.BoxGeometry(1.9, 0.06, 1.0), 0, 1.10, 0.35, PAL.wood[0]);
      for (let i = 0; i < 4; i++) {
        const gi = (i * 7 + Math.abs(Math.round(cx * 13 + cz * 5))) % PAL.goods.length;
        push(new THREE.SphereGeometry(0.16, 6, 4), -0.6 + i * 0.4, 1.26, 0.35, PAL.goods[gi]);
      }
      for (let i = 0; i < 5; i++)
        push(new THREE.BoxGeometry(2.0, 0.28, 0.05), 0, 0.45 + i * 0.30, -D2 / 2 + 0.03,
             i % 2 === 0 ? colorMain : PAL.stripe);
      push(new THREE.BoxGeometry(0.05, 1.2, 1.6), -W2 / 2 + 0.02, 0.9, 0, PAL.wood[2]);
      push(new THREE.BoxGeometry(0.05, 1.2, 1.6),  W2 / 2 - 0.02, 0.9, 0, PAL.wood[2]);
      const localRoof = [];
      pitchedRoof(localRoof, 0, 0, 2.7, 2.4, postH, 0.55, colorMain, 0.15, 0x2a1e18);
      for (const it of localRoof) {
        if (yaw) it.geo.rotateY(yaw);
        it.geo.translate(cx, 0, cz);
        local.push(it);
      }
      const awningW = 2.7, awningD = 2.4, awningEave = 0.15;
      const ridgeH = 0.55;
      const halfD = awningD / 2 + awningEave;
      const ang = Math.atan2(ridgeH, halfD);
      const ww = awningW + 2 * awningEave;
      for (const dz2 of [0.55, 1.15]) {
        const y = postH + ridgeH - dz2 * (ridgeH / halfD);
        const st = new THREE.BoxGeometry(ww + 0.02, 0.10, 0.28);
        st.rotateX(ang);
        st.translate(0, y + 0.10, dz2);
        if (yaw) st.rotateY(yaw);
        st.translate(cx, 0, cz);
        local.push({ geo: st, color: PAL.stripe });
        const st2 = new THREE.BoxGeometry(ww + 0.02, 0.10, 0.28);
        st2.rotateX(-ang);
        st2.translate(0, y + 0.10, -dz2);
        if (yaw) st2.rotateY(yaw);
        st2.translate(cx, 0, cz);
        local.push({ geo: st2, color: PAL.stripe });
      }
      for (const it of local) p.push(it);
    };

    const stallPositions = [-9.6, -3.2, 3.2, 9.6];
    for (let i = 0; i < stallPositions.length; i++) {
      const zz = stallPositions[i];
      buildStall(-13, zz,  Math.PI / 2, PAL.stall[i % PAL.stall.length]);
      buildStall( 13, zz, -Math.PI / 2, PAL.stall[(i + 2) % PAL.stall.length]);
    }

    bench(p, -5,  4, -Math.PI / 3);
    bench(p,  5,  4,  Math.PI / 3);
    bench(p, -5, -4,  Math.PI / 3);
    bench(p,  5, -4, -Math.PI / 3);
    bench(p, -6,  0,  Math.PI / 2);
    bench(p,  6,  0, -Math.PI / 2);

    for (const [tx, tz] of [[-hW + 1.5, -hD + 1.5], [ hW - 1.5, -hD + 1.5],
                            [-hW + 1.5,  hD - 1.5], [ hW - 1.5,  hD - 1.5]])
      trees.push({ x: tx, z: tz, scale: 0.85, hue: PAL.grass[0] });
    for (const [lx, lz] of [[-hW + 1.2, 0], [hW - 1.2, 0], [0, -hD + 1.2], [0, hD - 1.2]])
      lampPost(p, lx, lz);

    return { parts: p, trees };
  }

  /* ============================================================
     Диспетчер
     ============================================================ */
  const BUILDERS = {
    botanical:    buildBotanical,
    amphitheater: buildAmphitheater,
    japanese:     buildJapanese,
    maze:         buildMaze,
    playground:   buildPlayground,
    market:       buildMarket,
  };

  function pickType(distanceFromCenter, rng) {
    const r = rng();
    if (distanceFromCenter < 0.3) return r < 0.5 ? 'botanical' : 'amphitheater';
    if (distanceFromCenter < 0.6) return r < 0.4 ? 'playground' : (r < 0.75 ? 'japanese' : 'maze');
    return r < 0.4 ? 'market' : (r < 0.75 ? 'japanese' : 'playground');
  }

  function add(opts) {
    const { geom, scene, cx, cz } = opts;
    if (!opts.THREE) throw new Error('MeridianParkKit.add: THREE required');
    if (!geom)       throw new Error('MeridianParkKit.add: geom required');

    // module-level THREE — нужен хелперам (boxAt/cylY/sphAt/coneY/pitchedRoof)
    THREE = opts.THREE;

    const size = opts.size != null ? opts.size : 30;
    const useMainRng = !!opts.useMainRng;
    const rng = useMainRng ? (opts.rng || Math.random)
                           : mulberry32(hashSeed(cx || 0, cz || 0, 0x51de77));

    const worldHalf = opts.worldHalf || 290;
    const distFromCenter = Math.hypot(cx || 0, cz || 0) / worldHalf;
    const seedForType = mulberry32(hashSeed(cx || 0, cz || 0, 0xabcd1234));
    const type = (opts.type && BUILDERS[opts.type]) ? opts.type
               : pickType(Math.min(distFromCenter, 1), seedForType);
    const level = (typeof opts.level === 'number') ? (opts.level | 0) : 1;

    const result = BUILDERS[type](rng, level, size);
    const geo = geom.mergeGeometries(result.parts);

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

    const treesOut = result.trees.map(t => ({
      x: t.x + (cx || 0),
      z: t.z + (cz || 0),
      scale: t.scale,
      hue: t.hue,
    }));

    return { parts: result.parts, trees: treesOut, mesh, type, level };
  }

  /* ============================================================
     Старый API makeMaterials — оставлен для совместимости
     ============================================================ */
  function makeMaterials(THREEArg) {
    return {
      lawn: new THREEArg.MeshStandardMaterial({ color: 0x4c7a3f, roughness: 1 }),
      pond: new THREEArg.MeshStandardMaterial({ color: 0x2b6a8f, roughness: 0.15, metalness: 0.4 }),
      path: new THREEArg.MeshStandardMaterial({ color: 0xb9a67e, roughness: 1 }),
    };
  }

  window.MeridianParkKit = {
    add, makeMaterials, pickType, TYPE_IDS, PAL, BUILDERS,
  };
})();
