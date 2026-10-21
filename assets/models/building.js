/* assets/models/building.js — процедурные здания, семь типов.
 *
 * Семь builders, каждый возвращает три массива частей:
 *   walls     — сплошные стены, крыши, рамы, отделка
 *   glassLit  — окна, горящие ночью (glassMat с emissive)
 *   glassDark — окна, не горящие ночью (glassDarkMat без emissive)
 *
 * Ориентация. Каждый builder строит здание лицом к локальному +Z.
 * add() применяет yaw и разворачивает здание целиком; footprint в
 * buildings[] пересчитывается с учётом поворота на 90°.
 *
 * Цвет стен. Палитра типа + HSL jitter от rng. Каждое здание слегка
 * отличается от соседей.
 *
 *   MeridianBuildingKit.add({
 *     THREE, geom, scene,
 *     materials: { solid, glass, glassDark },
 *     cx, cz, w, d, h,
 *     rng, buildings,
 *     type, level, worldHalf, litRatio,
 *     facing,   // 'S'|'N'|'E'|'W', default 'S' (+Z)
 *   });
 *
 * Классический <script>, читает window.MeridianGeom.createKit().
 */
(function () {
  'use strict';

  // ============ Палитры ============
  const PAL = {
    cottage:     [0xe8dcc8, 0xd8c8b0, 0xe0c8b0, 0xd0b898, 0xe8d0b8],
    house:       [0xe8dcc8, 0xd8c8b0, 0xe0c8b0, 0xd0b898, 0xe8d0b8],
    rowhouse:    [0xe8dcc8, 0xd8b898, 0xcbbba0, 0xe0c8a8],
    shop:        [0xb0a898, 0xc0b8a8, 0xa8a090, 0xb8b0a0],
    residential: [0xc4a890, 0xbca088, 0xd0b498, 0xb89880],
    office:      [0xa8b0b8, 0x9ca4ac, 0xb0b8c0, 0x9aa4ae],
    tower:       [0xa8b0b8, 0x9ca4ac, 0xb0b8c0, 0xa0a8b0],
    roofA:       [0x7a4a3a, 0x5a4530, 0x6a5540, 0x4a5560, 0x6a3030],
    trim:        0x2a1e18,
    wood:        0x6a4a2a,
    woodDark:    0x3a2818,
    door:        [0x8a3a2a, 0x2a4a6a, 0x3a6a4a, 0x6a4a2a, 0x3a2a1a],
    glass:       0x8fb4d0,
    glassFrame:  0x5a4030,
    glassFrameMetal: 0x30363c,
    brickA:      0x9a4a3a, brickB: 0x8a3a2a,
    brickC:      0xa85a4a, brickD: 0x8e4535,
    plinth:      0x6a4a3a,
    plinthCap:   0x2a1e18,
    path:        0xb8a888,
    garden:      0x4a7a3a, bush: 0x3a6a30,
    fenceRail:   0xe8e4dc, fencePost: 0xdcb088,
    balconyRail: 0x3a2a24, balconyFloor: 0x8a7a6a,
    bandStone:   0x7a8288, bandCap: 0x5a6268,
    metal:       0x9098a0, metalDark: 0x30343a, metalLight: 0x808890,
    ac:          0x6a7078, acDark: 0x3a4048,
    // lobbies
    lobbyFloor:  0xc8b8a0, lobbyCeil: 0xe8e0d0, lobbyWall: 0xe8dcc8,
    lobbyDesk:   0x5a3a22, lobbyDeskTop: 0x2a1e18,
    lobbyLight:  0xfff0c8,
    liftDoor:    0x9098a0, liftFrame: 0x1a1e24, liftIndicator: 0xff8c3a,
    intShelf:    0x9a7a58,
    goods: [0xd83a4a, 0xe8c04a, 0x5fc87a, 0x9a5ac8, 0xe88a3a, 0x3a7ac8],
    shutter:     0x2a4a6a,
    woodShop:    0x3a2818, shopGlassBright: 0x9fc4dc,
    beacon:      0xff2a2a,
  };

  const TYPE_IDS = ['cottage','house','rowhouse','shop','residential','office','tower'];
  const DEFAULT_LIT_RATIO = 0.40;

  // ============ Утилиты ============
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
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---- per-type palette + HSL jitter ----
  function pickWallColor(rng, type) {
    const pal = PAL[type] || PAL.residential;
    const base = pal[(rng() * pal.length) | 0];
    const c = new THREE.Color(base);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(
      hsl.h + (rng() - 0.5) * 0.03,
      clamp(hsl.s + (rng() - 0.5) * 0.10, 0, 1),
      clamp(hsl.l + (rng() - 0.5) * 0.08, 0.1, 0.95)
    );
    return c.getHex();
  }

  // ============ Низкоуровневые примитивы ============
  let THREE = null;

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
  function tri(parts, ax, ay, az, bx, by, bz, cx, cy, cz, color) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([ax,ay,az, bx,by,bz, cx,cy,cz]), 3));
    g.computeVertexNormals();
    parts.push({ geo: g, color });
  }
  function mergeGeometries(parts) {
    const list = parts.map(p => ({
      geo: p.geo.index ? p.geo.toNonIndexed() : p.geo,
      color: p.color,
    }));
    let total = 0;
    for (const it of list) total += it.geo.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let off = 0;
    const tmp = new THREE.Color();
    for (const it of list) {
      const g = it.geo;
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      const c = tmp.set(it.color == null ? 0xffffff : it.color);
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      for (let i = 0; i < n; i++) {
        const j = (off + i) * 3;
        col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
      }
      off += n;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    return out;
  }

  // ============ Общие формы ============
  // Двускатная крыша, конёк по X, скаты падают к ±Z, gable-треугольники
  // закрывают торцы ±X. wallTop — уровень верх стены.
  function pitchedRoof(parts, cx, cz, w, d, wallTop, ridgeH, roofColor, oh, ridgeColor, gableColor) {
    const halfD = d / 2, outer = halfD + oh;
    const slope = ridgeH / halfD;
    const yRidge = wallTop + ridgeH;
    const yEave  = wallTop - oh * slope;
    const yMid   = (yRidge + yEave) / 2;
    const drop   = yRidge - yEave;
    const theta  = Math.atan2(drop, outer);
    const len    = Math.hypot(drop, outer);
    const ww     = w + 2 * oh;

    const s1 = new THREE.BoxGeometry(ww, 0.14, len);
    s1.rotateX(theta); s1.translate(cx, yMid, cz + outer / 2);
    parts.push({ geo: s1, color: roofColor });
    const s2 = new THREE.BoxGeometry(ww, 0.14, len);
    s2.rotateX(-theta); s2.translate(cx, yMid, cz - outer / 2);
    parts.push({ geo: s2, color: roofColor });

    const rr = new THREE.BoxGeometry(ww + 0.10, 0.16, 0.24);
    rr.translate(cx, yRidge + 0.06, cz);
    parts.push({ geo: rr, color: ridgeColor || roofColor });

    const gxE = cx + w / 2, gxW = cx - w / 2;
    const zS = cz + halfD, zN = cz - halfD;
    const gc = gableColor || roofColor;
    tri(parts, gxE, wallTop, zS,  gxE, wallTop, zN,  gxE, yRidge, cz,  gc);
    tri(parts, gxE, wallTop, zN,  gxE, wallTop, zS,  gxE, yRidge, cz,  gc);
    tri(parts, gxW, wallTop, zN,  gxW, wallTop, zS,  gxW, yRidge, cz,  gc);
    tri(parts, gxW, wallTop, zS,  gxW, wallTop, zN,  gxW, yRidge, cz,  gc);
  }

  // Окно в три слоя: рама (внешняя), перекладины, стекло (внутреннее).
  // Стекло вынесено в glassLit; рама и перекладины в walls.
  function addWindow(walls, glassLit, glassDark, x, y, pos, axis, outward, winW, winH, isLit) {
    const FRAME_D = 0.06, FRAME_FRONT = 0.030, BORDER = 0.08;
    const GLASS_T = 0.02, GLASS_FRONT = 0.010;
    const MUL_T = 0.015, MUL_FRONT = 0.022;
    const sgn = outward;
    const putW = (w, h, d, lx, ly, lz, color) => {
      if (axis === 'z') walls.push(boxAt(w, h, d, x + lx, y + ly, pos + sgn * lz, color));
      else              walls.push(boxAt(d, h, w, pos + sgn * lz, y + ly, x + lx, color));
    };
    const putG = (w, h, d, lx, ly, lz, color) => {
      const arr = (isLit && isLit(x, y, pos)) ? glassLit : glassDark;
      if (axis === 'z') arr.push(boxAt(w, h, d, x + lx, y + ly, pos + sgn * lz, color));
      else              arr.push(boxAt(d, h, w, pos + sgn * lz, y + ly, x + lx, color));
    };
    const fz = FRAME_FRONT - FRAME_D / 2;
    putW(winW + 2 * BORDER, BORDER, FRAME_D,  0,  winH / 2 + BORDER / 2, fz, PAL.glassFrame);
    putW(winW + 2 * BORDER, BORDER, FRAME_D,  0, -winH / 2 - BORDER / 2, fz, PAL.glassFrame);
    putW(BORDER, winH, FRAME_D, -winW / 2 - BORDER / 2, 0, fz, PAL.glassFrame);
    putW(BORDER, winH, FRAME_D,  winW / 2 + BORDER / 2, 0, fz, PAL.glassFrame);
    putG(winW, winH, GLASS_T, 0, 0, GLASS_FRONT - GLASS_T / 2, PAL.glass);
    const mz = MUL_FRONT - MUL_T / 2;
    putW(winW, 0.05, MUL_T, 0, 0, mz, PAL.glassFrame);
    putW(0.05, winH, MUL_T, 0, 0, mz, PAL.glassFrame);
  }

  // Балкон: плита, три ограждения, пять прутьев спереди, три с боков.
  function addBalcony(p, x, y, pos, outward, bw, bd) {
    const sgn = outward;
    const fT = 0.14, rH = 0.95, rT = 0.06;
    p.push(boxAt(bw, fT, bd, x, y - fT / 2, pos + sgn * bd / 2, PAL.balconyFloor));
    const railZ = pos + sgn * (bd - rT / 2);
    p.push(boxAt(bw, rH, rT, x, y + rH / 2, railZ, PAL.balconyRail));
    for (const sx of [-1, 1])
      p.push(boxAt(rT, rH, bd, x + sx * (bw / 2 - rT / 2), y + rH / 2, pos + sgn * bd / 2, PAL.balconyRail));
    p.push(boxAt(bw + 0.08, 0.05, rT + 0.04, x, y + rH + 0.02, railZ, PAL.balconyRail));
    for (let i = 1; i < 5; i++)
      p.push(boxAt(0.04, rH - 0.10, 0.04, x - bw / 2 + i * bw / 5, y + rH / 2 - 0.02, railZ, PAL.balconyRail));
    for (const sx of [-1, 1]) {
      const sideX = x + sx * (bw / 2 - rT / 2);
      for (let i = 1; i < 3; i++)
        p.push(boxAt(0.04, rH - 0.10, 0.04, sideX, y + rH / 2 - 0.02, pos + sgn * (i * bd / 3), PAL.balconyRail));
    }
  }

  // Кирпичный ряд по прямоугольнику (одна сторона). Пропускает кирпичи,
  // попадающие в openings[] (границы проёмов).
  function brickWall(p, x0, x1, yCenter, z, rowH, bw, bd, openings, seed) {
    const gap = 0.015;
    const cols = [PAL.brickA, PAL.brickB, PAL.brickC, PAL.brickD];
    const n = Math.ceil((x1 - x0) / (bw + gap)) + 1;
    const xStart = x0 + (bw + gap) / 2;
    for (let i = 0; i < n; i++) {
      const bx = xStart + i * (bw + gap);
      if (bx + bw / 2 > x1 + 0.001) break;
      let skip = false;
      for (const [a, b] of openings) {
        if (bx + bw / 2 > a && bx - bw / 2 < b) { skip = true; break; }
      }
      if (skip) continue;
      p.push(boxAt(bw, rowH, bd, bx, yCenter, z, cols[(i + seed) % 4]));
    }
  }

  // Кирпичная труба, четыре стороны, mortar-ядро.
  function brickChimney(p, cx, cz, chW, chD, y0, y1) {
    const h = y1 - y0;
    p.push(boxAt(chW - 0.04, h, chD - 0.04, cx, y0 + h / 2, cz, 0x3a2a24));
    const rowH = 0.16, gap = 0.02, bw = 0.20, bd = 0.06;
    const rows = Math.floor((h - 0.08) / (rowH + gap));
    const cols = [PAL.brickA, PAL.brickB, PAL.brickC, PAL.brickD];
    for (let r = 0; r < rows; r++) {
      const y = y0 + 0.08 + rowH / 2 + r * (rowH + gap);
      const off = (r % 2) * (bw / 2);
      for (let i = -3; i <= 3; i++) {
        const bx = cx + i * (bw + gap) + off;
        if (Math.abs(bx - cx) + bw / 2 > chW / 2 + 0.001) continue;
        p.push(boxAt(bw, rowH, bd, bx, y, cz + chD / 2, cols[(r + i + 8) % 4]));
        p.push(boxAt(bw, rowH, bd, bx, y, cz - chD / 2, cols[(r + i + 9) % 4]));
      }
      for (let i = -3; i <= 3; i++) {
        const bz = cz + i * (bw + gap) + off;
        if (Math.abs(bz - cz) + bw / 2 > chD / 2 + 0.001) continue;
        p.push(boxAt(bd, rowH, bw, cx - chW / 2, y, bz, cols[(r + i + 10) % 4]));
        p.push(boxAt(bd, rowH, bw, cx + chW / 2, y, bz, cols[(r + i + 11) % 4]));
      }
    }
    p.push(boxAt(chW + 0.14, 0.10, chD + 0.14, cx, y1 + 0.05, cz, 0x5a4a40));
    p.push(boxAt(chW - 0.20, 0.12, chD - 0.20, cx, y1 + 0.16, cz, 0x1a1a1a));
  }

  // ============================================================
  // 1. Cottage
  // ============================================================
  function buildCottage(rng, hintW, hintD, hintH, paint, litRatio) {
    const walls = [], glassLit = [], glassDark = [];
    const W = clamp(hintW, 6.5, 10);
    const D = clamp(hintD, 6, 9.5);
    const H = clamp(3.0 + (hintH - 3) * 0.15, 2.8, 4.2);
    const baseH = 0.35;
    const wallY0 = baseH - 0.07;
    const wallY1 = wallY0 + H;
    const ridgeH = 2.0;
    const eave = 0.4;
    const isLit = makeLitFn(hashSeed(0, 0, 0x51de77), litRatio);

    walls.push(boxAt(W + 0.3, baseH, D + 0.3, 0, baseH / 2, 0, PAL.plinth));
    walls.push(boxAt(W, H, D, 0, wallY0 + H / 2, 0, paint));
    pitchedRoof(walls, 0, 0, W, D, wallY1, ridgeH, PAL.roofA[0], eave, PAL.trim, paint);

    brickChimney(walls, W / 2 - 1.0, -D / 4, 0.85, 0.85, wallY1 - 0.4, wallY1 + ridgeH + 0.5);

    // door front
    const doorW = 1.2, doorH = 2.1;
    const doorYc = baseH + doorH / 2;
    const doorColor = pick(rng, PAL.door);
    walls.push(boxAt(doorW + 0.16, doorH + 0.14, 0.06, 0, doorYc, D / 2 + 0.03, PAL.trim));
    walls.push(boxAt(doorW, doorH, 0.10, 0, doorYc, D / 2 + 0.06, doorColor));
    walls.push(sphAt(0.06, 0.06, 0.06, doorW / 2 - 0.15, doorYc, D / 2 + 0.12, 0xd4b878, 8));
    walls.push(boxAt(doorW + 0.6, baseH, 0.55, 0, baseH / 2, D / 2 + 0.40, PAL.path));

    // windows: 2 front, 2 back, 1 per side
    const winW = 1.1, winH = 1.1, winY = baseH + 1.55;
    const winOffX = W / 2 - 1.5;
    addWindow(walls, glassLit, glassDark, -winOffX, winY,  D / 2, 'z', +1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark,  winOffX, winY,  D / 2, 'z', +1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark, -winOffX, winY, -D / 2, 'z', -1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark,  winOffX, winY, -D / 2, 'z', -1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark, 0, winY,  W / 2, 'x', +1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark, 0, winY, -W / 2, 'x', -1, winW, winH, isLit);

    // awning
    {
      const pw = 2.6, pd = 1.4, awY = wallY1 - 0.35, tilt = 0.30;
      const drop = pd * Math.sin(tilt), runZ = pd * Math.cos(tilt);
      const cY = awY - drop / 2, cZ = D / 2 + runZ / 2 - 0.02;
      const b = new THREE.BoxGeometry(pw, 0.12, pd);
      b.rotateX(tilt); b.translate(0, cY, cZ);
      walls.push({ geo: b, color: PAL.woodDark });
      const postTop = awY - drop, postZ = D / 2 + runZ - 0.20;
      for (const sx of [-1, 1])
        walls.push(boxAt(0.12, postTop, 0.12, sx * (pw / 2 - 0.15), postTop / 2, postZ, PAL.wood));
      walls.push(boxAt(pw - 0.10, 0.10, 0.10, 0, postTop - 0.05, postZ, PAL.woodDark));
    }

    // front garden with split beds
    const yardX = W / 2 + 1.6;
    const yardZ0 = D / 2 + 0.30, yardZ1 = D / 2 + 4.75;
    const yardD = yardZ1 - yardZ0, yardZc = (yardZ0 + yardZ1) / 2;
    const pathW = 1.2, gateHalf = 1.05;
    {
      const bedW = (yardX - pathW / 2) - 0.15;
      walls.push(boxAt(bedW, 0.22, yardD - 0.4, -(pathW / 2 + bedW / 2), 0.11, yardZc, PAL.garden));
      walls.push(boxAt(bedW, 0.22, yardD - 0.4,  (pathW / 2 + bedW / 2), 0.11, yardZc, PAL.garden));
      for (let i = 0; i < 3; i++) {
        const z = yardZc - 1.4 + i * 1.4;
        const bx = pathW / 2 + bedW / 2;
        walls.push(sphAt(0.28, 0.34, 0.28,  bx, 0.42, z, PAL.bush, 8));
        walls.push(sphAt(0.28, 0.34, 0.28, -bx, 0.42, z, PAL.bush, 8));
      }
    }
    {
      const zA = D / 2 + 0.68, zB = yardZ1 - 0.15, steps = 6;
      const tLen = (zB - zA) / steps;
      for (let i = 0; i < steps; i++)
        walls.push(boxAt(pathW - 0.10, 0.24, tLen - 0.06, 0, 0.12, zA + (i + 0.5) * tLen, PAL.path));
    }
    {
      const fH = 0.85, fx = yardX, fzBack = D / 2 + 0.20, fzFront = yardZ1;
      const step = 1.3;
      for (const sx of [-1, 1]) {
        walls.push(boxAt(0.18, fH + 0.20, 0.18, sx * fx, (fH + 0.20) / 2, fzFront, PAL.fencePost));
        const n = Math.max(1, Math.round((fzFront - fzBack) / step));
        for (let i = 0; i <= n; i++) {
          const z = fzBack + i * (fzFront - fzBack) / n;
          walls.push(boxAt(0.08, fH, 0.08, sx * fx, fH / 2, z, PAL.fencePost));
        }
        for (const ry of [0.30, 0.68])
          walls.push(boxAt(0.06, 0.06, fzFront - fzBack, sx * fx, ry, (fzBack + fzFront) / 2, PAL.fenceRail));
      }
      const n = Math.max(1, Math.round((2 * fx) / step));
      for (let i = 0; i <= n; i++) {
        const x = -fx + i * (2 * fx) / n;
        if (Math.abs(x) < gateHalf + 0.05) continue;
        walls.push(boxAt(0.08, fH, 0.08, x, fH / 2, fzFront, PAL.fencePost));
      }
      for (const sx of [-1, 1])
        walls.push(boxAt(0.20, fH + 0.20, 0.20, sx * gateHalf, (fH + 0.20) / 2, fzFront, PAL.fencePost));
      const rLen = fx - gateHalf;
      for (const ry of [0.30, 0.68]) {
        walls.push(boxAt(rLen, 0.06, 0.06, -(gateHalf + rLen / 2), ry, fzFront, PAL.fenceRail));
        walls.push(boxAt(rLen, 0.06, 0.06,  (gateHalf + rLen / 2), ry, fzFront, PAL.fenceRail));
      }
    }

    return { walls, glassLit, glassDark, w: W + 2, d: D + 3.6, h: wallY1 + ridgeH + 0.6 };
  }

  // ============================================================
  // 2. House (2 этажа, ставни, кирпичный цоколь)
  // ============================================================
  function buildHouse(rng, hintW, hintD, hintH, paint, litRatio) {
    const walls = [], glassLit = [], glassDark = [];
    const W = clamp(hintW, 7, 9.5);
    const D = clamp(hintD, 6, 8.5);
    const floorH = 3.2, floors = 2;
    const H = floors * floorH;
    const baseH = 0.45;
    const wallY0 = baseH - 0.07, wallY1 = wallY0 + H;
    const ridgeH = 2.2, eave = 0.35;
    const isLit = makeLitFn(hashSeed(0, 0, 0x51de77), litRatio);

    walls.push(boxAt(W + 0.4, baseH, D + 0.4, 0, baseH / 2, 0, PAL.plinth));
    walls.push(boxAt(W, H, D, 0, wallY0 + H / 2, 0, paint));
    pitchedRoof(walls, 0, 0, W, D, wallY1, ridgeH, PAL.roofA[1], eave, PAL.trim, paint);

    // brick base course
    for (let r = 0; r < 2; r++) {
      const y = baseH + 0.07 + r * 0.145;
      brickWall(walls, -W / 2, W / 2, y,  D / 2 + 0.01, 0.13, 0.30, 0.05, [[-1.0, 1.0]], 8);
      brickWall(walls, -W / 2, W / 2, y, -D / 2 - 0.01, 0.13, 0.30, 0.05, [], 9);
    }

    brickChimney(walls, W / 2 - 1.2, -D / 4, 0.9, 0.9, wallY1 - 0.4, wallY1 + ridgeH + 0.7);

    // door
    const doorW = 1.3, doorH = 2.3;
    const doorYc = baseH + doorH / 2;
    walls.push(boxAt(doorW + 0.18, doorH + 0.16, 0.06, 0, doorYc, D / 2 + 0.03, PAL.trim));
    walls.push(boxAt(doorW, doorH, 0.10, 0, doorYc, D / 2 + 0.06, pick(rng, PAL.door)));
    walls.push(sphAt(0.06, 0.06, 0.06, doorW / 2 - 0.18, doorYc, D / 2 + 0.12, 0xd4b878, 8));
    walls.push(boxAt(doorW + 0.9, baseH - 0.02, 0.7, 0, (baseH - 0.02) / 2, D / 2 + 0.55, PAL.path));

    // windows with shutters on the front
    const winW = 1.2, winH = 1.5;
    const gfWinY = baseH + 1.55;
    const gfWinX = W / 2 - 1.6;
    const ffWinY = baseH + floorH + 1.55;
    const addShutters = (x, y) => {
      const sw = 0.35, sh = winH + 0.10, st = 0.05, ox = winW / 2 + 0.08 + sw / 2, tilt = 0.10;
      for (const sgnX of [-1, 1]) {
        const g = new THREE.BoxGeometry(sw, sh, st);
        g.rotateY(sgnX * tilt);
        g.translate(sgnX * ox, 0, 0);
        g.translate(x, y, D / 2 + 0.03 + st / 2);
        walls.push({ geo: g, color: PAL.shutter });
      }
    };
    // front ground
    addWindow(walls, glassLit, glassDark, -gfWinX, gfWinY,  D / 2, 'z', +1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark,  gfWinX, gfWinY,  D / 2, 'z', +1, winW, winH, isLit);
    addShutters(-gfWinX, gfWinY);
    addShutters( gfWinX, gfWinY);
    // back ground
    addWindow(walls, glassLit, glassDark, -gfWinX, gfWinY, -D / 2, 'z', -1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark,  gfWinX, gfWinY, -D / 2, 'z', -1, winW, winH, isLit);
    // sides ground
    addWindow(walls, glassLit, glassDark, 0, gfWinY,  W / 2, 'x', +1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark, 0, gfWinY, -W / 2, 'x', -1, winW, winH, isLit);
    // front first
    addWindow(walls, glassLit, glassDark, 0, ffWinY,  D / 2, 'z', +1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark, -gfWinX, ffWinY,  D / 2, 'z', +1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark,  gfWinX, ffWinY,  D / 2, 'z', +1, winW, winH, isLit);
    addShutters(0, ffWinY);
    addShutters(-gfWinX, ffWinY);
    addShutters( gfWinX, ffWinY);
    // back first
    addWindow(walls, glassLit, glassDark, 0, ffWinY, -D / 2, 'z', -1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark, -gfWinX, ffWinY, -D / 2, 'z', -1, winW, winH, isLit);
    addWindow(walls, glassLit, glassDark,  gfWinX, ffWinY, -D / 2, 'z', -1, winW, winH, isLit);
    // sides first (two each)
    for (const sx of [-1, 1]) {
      addWindow(walls, glassLit, glassDark, -1.2, ffWinY, sx * W / 2, 'x', sx, winW, winH, isLit);
      addWindow(walls, glassLit, glassDark,  1.2, ffWinY, sx * W / 2, 'x', sx, winW, winH, isLit);
    }

    // porch awning (tilted)
    {
      const pw = 2.8, pd = 1.3, awY = baseH + floorH - 0.15, tilt = 0.32;
      const drop = pd * Math.sin(tilt), runZ = pd * Math.cos(tilt);
      const cY = awY - drop / 2, cZ = D / 2 + runZ / 2 - 0.02;
      const b = new THREE.BoxGeometry(pw, 0.12, pd);
      b.rotateX(tilt); b.translate(0, cY, cZ);
      walls.push({ geo: b, color: PAL.woodDark });
      const postTop = awY - drop, postZ = D / 2 + runZ - 0.20;
      for (const sx of [-1, 1])
        walls.push(boxAt(0.14, postTop, 0.14, sx * (pw / 2 - 0.15), postTop / 2, postZ, PAL.wood));
      walls.push(boxAt(pw - 0.15, 0.10, 0.10, 0, postTop - 0.05, postZ, PAL.woodDark));
    }

    return { walls, glassLit, glassDark, w: W + 2, d: D + 3, h: wallY1 + ridgeH + 0.7 };
  }

  // ============================================================
  // 3. Rowhouse (4 юнита)
  // ============================================================
  function buildRowhouse(rng, hintW, hintD, hintH, paint, litRatio) {
    const walls = [], glassLit = [], glassDark = [];
    const units = 4;
    const unitW = clamp(hintW / units, 2.8, 3.4);
    const W = units * unitW;
    const D = clamp(hintD, 6, 8);
    const floorH = 3.0, floors = 3;
    const H = floors * floorH;
    const baseH = 0.32;
    const wallY0 = baseH - 0.06, wallY1 = wallY0 + H;
    const ridgeH = 1.8, eave = 0.35;
    const isLit = makeLitFn(hashSeed(0, 0, 0x51de77), litRatio);

    walls.push(boxAt(W + 0.1, baseH, D + 0.1, 0, baseH / 2, 0, PAL.plinth));

    const wallTints = PAL.rowhouse;
    const doorTints = PAL.door;

    for (let u = 0; u < units; u++) {
      const ux = -W / 2 + (u + 0.5) * unitW;
      const doorX = ux - 0.75;
      const wallCol = wallTints[(u + (paint & 0xff)) % wallTints.length];

      walls.push(boxAt(unitW - 0.02, H, D, ux, wallY0 + H / 2, 0, wallCol));

      // door
      const dW = 1.05, dH = 2.20, dYc = baseH + dH / 2;
      walls.push(boxAt(dW + 0.14, dH + 0.14, 0.06, doorX, dYc, D / 2 + 0.03, PAL.trim));
      walls.push(boxAt(dW, dH, 0.10, doorX, dYc, D / 2 + 0.06, doorTints[u % doorTints.length]));
      walls.push(sphAt(0.05, 0.05, 0.05, doorX + dW / 2 - 0.14, dYc, D / 2 + 0.12, 0xd4b878, 8));
      walls.push(boxAt(dW + 0.7, baseH - 0.02, 0.6, doorX, (baseH - 0.02) / 2, D / 2 + 0.50, PAL.path));

      // windows
      const winW = 1.0, winH = 1.35;
      addWindow(walls, glassLit, glassDark, ux + 0.75, baseH + 1.55, D / 2, 'z', +1, 1.1, winH, isLit);
      for (let f = 1; f < floors; f++) {
        const fy = baseH + f * floorH + 1.35;
        addWindow(walls, glassLit, glassDark, ux - 0.7, fy,  D / 2, 'z', +1, winW, winH, isLit);
        addWindow(walls, glassLit, glassDark, ux + 0.7, fy,  D / 2, 'z', +1, winW, winH, isLit);
      }
      for (let f = 0; f < floors; f++) {
        const fy = baseH + f * floorH + 1.55;
        addWindow(walls, glassLit, glassDark, ux - 0.7, fy, -D / 2, 'z', -1, winW, winH, isLit);
        addWindow(walls, glassLit, glassDark, ux + 0.7, fy, -D / 2, 'z', -1, winW, winH, isLit);
      }

      // ledge over the door
      walls.push(boxAt(dW + 0.4, 0.10, 0.30, doorX, baseH + dH + 0.18, D / 2 + 0.15, PAL.woodDark));

      // base brick course (skip under door)
      for (let r = 0; r < 2; r++) {
        const y = baseH + 0.07 + r * 0.145;
        brickWall(walls, ux - unitW / 2 + 0.02, ux + unitW / 2 - 0.02, y, D / 2 + 0.01,
                  0.13, 0.28, 0.05, [[doorX - dW / 2 - 0.1, doorX + dW / 2 + 0.1]], 8 + r + u);
      }
    }

    // dividers
    for (let u = 1; u < units; u++) {
      const ux = -W / 2 + u * unitW;
      walls.push(boxAt(0.04, H, D + 0.02, ux, baseH - 0.06 + H / 2, 0, PAL.woodDark));
    }

    // roof
    pitchedRoof(walls, 0, 0, W, D, wallY1, ridgeH, PAL.roofA[2], eave, PAL.trim, paint);

    // end windows on the two exposed side walls
    for (let f = 0; f < floors; f++) {
      const fy = baseH + f * floorH + 1.55;
      addWindow(walls, glassLit, glassDark, -1.5, fy, -W / 2 + 0.01, 'x', -1, 1.0, 1.35, isLit);
      addWindow(walls, glassLit, glassDark,  1.5, fy, -W / 2 + 0.01, 'x', -1, 1.0, 1.35, isLit);
      addWindow(walls, glassLit, glassDark, -1.5, fy,  W / 2 - 0.01, 'x', +1, 1.0, 1.35, isLit);
      addWindow(walls, glassLit, glassDark,  1.5, fy,  W / 2 - 0.01, 'x', +1, 1.0, 1.35, isLit);
    }

    // chimney
    brickChimney(walls, W / 2 - 1.0, -D / 4, 0.85, 0.85, wallY1 - 0.3, wallY1 + ridgeH + 0.5);

    return { walls, glassLit, glassDark, w: W + 0.5, d: D + 0.5, h: wallY1 + ridgeH + 0.5 };
  }

  // ============================================================
  // 4. Shop (3 этажа, стеклянная витрина, лобби-магазин)
  // ============================================================
  function buildShop(rng, hintW, hintD, hintH, paint, litRatio) {
    const walls = [], glassLit = [], glassDark = [];
    const W = clamp(hintW, 9, 13);
    const D = clamp(hintD, 7, 10);
    const floorH = 3.2, floors = 3;
    const H = floors * floorH;
    const baseH = 0.35;
    const wallY0 = baseH - 0.07, wallY1 = wallY0 + H;
    const wT = 0.16;
    const isLit = makeLitFn(hashSeed(0, 0, 0x51de77), litRatio);

    walls.push(boxAt(W + 0.4, baseH, D + 0.4, 0, baseH / 2, 0, PAL.plinth));

    const backDoorW = 1.10, backDoorH = 2.20;
    const backDoorX = 0;
    const backDoorY1 = baseH + backDoorH;
    const bdz = -D / 2 + wT / 2, fdz = D / 2 - wT / 2;

    // side walls full
    walls.push(boxAt(wT, H, D - 2 * wT, -W / 2 + wT / 2, wallY0 + H / 2, 0, paint));
    walls.push(boxAt(wT, H, D - 2 * wT,  W / 2 - wT / 2, wallY0 + H / 2, 0, paint));

    // back wall (around back door)
    walls.push(boxAt(backDoorX - backDoorW / 2 - (-W / 2), H, wT,
                    (-W / 2 + backDoorX - backDoorW / 2) / 2, wallY0 + H / 2, bdz, paint));
    walls.push(boxAt(backDoorW, wallY1 - backDoorY1, wT,
                    backDoorX, backDoorY1 + (wallY1 - backDoorY1) / 2, bdz, paint));
    walls.push(boxAt(W / 2 - (backDoorX + backDoorW / 2), H, wT,
                    (W / 2 + backDoorX + backDoorW / 2) / 2, wallY0 + H / 2, bdz, paint));
    // closed rear door slab
    walls.push(boxAt(backDoorW, backDoorH - 0.02, 0.06, backDoorX, baseH + backDoorH / 2, -D / 2 + 0.03, PAL.woodDark));
    walls.push(boxAt(backDoorW + 0.14, 0.07, 0.05, backDoorX, backDoorY1 + 0.035, -D / 2 - 0.02, PAL.trim));
    walls.push(boxAt(0.07, backDoorH, 0.05, backDoorX - backDoorW / 2 - 0.035, baseH + backDoorH / 2, -D / 2 - 0.02, PAL.trim));
    walls.push(boxAt(0.07, backDoorH, 0.05, backDoorX + backDoorW / 2 + 0.035, baseH + backDoorH / 2, -D / 2 - 0.02, PAL.trim));
    walls.push(sphAt(0.055, 0.055, 0.055, backDoorX + backDoorW / 2 - 0.15, baseH + backDoorH / 2, -D / 2 + 0.08, 0xd4b878, 8));

    // front wall pieces around the door and the shopfront opening
    const doorW = 1.4, doorH = 2.4;
    const doorX = -W / 2 + 1.5;
    const doorY1 = baseH + doorH;
    const shopX0 = -1.6, shopX1 = 4.5;
    const gfY0 = baseH + 0.12, gfY1 = baseH + floorH - 0.55;
    const SFO = 0.06;

    const fp = (x0, x1, y0, y1) =>
      walls.push(boxAt(x1 - x0, y1 - y0, wT, (x0 + x1) / 2, (y0 + y1) / 2, fdz, paint));
    fp(-W / 2, doorX - doorW / 2, wallY0, wallY1);
    fp(doorX - doorW / 2, doorX + doorW / 2, doorY1, wallY1);
    fp(doorX + doorW / 2, shopX0 - SFO, wallY0, wallY1);
    fp(shopX0 - SFO, shopX1 + SFO, gfY1 + SFO, wallY1);
    fp(shopX1 + SFO, W / 2, wallY0, wallY1);
    // sill under the shopfront
    {
      const sillY0 = 0.06, sillY1 = gfY0;
      const sillZ = D / 2 - wT - 0.01;
      walls.push(boxAt(shopX1 - shopX0, sillY1 - sillY0, wT,
                       (shopX0 + shopX1) / 2, sillY0 + (sillY1 - sillY0) / 2, sillZ, paint));
    }

    // brick base course
    const frontOpenings = [[shopX0 - 0.02, shopX1 + 0.02], [doorX - doorW / 2 - 0.02, doorX + doorW / 2 + 0.02]];
    for (let r = 0; r < 2; r++) {
      const y = baseH + 0.07 + r * 0.145;
      brickWall(walls, -W / 2, W / 2, y,  D / 2 + 0.01, 0.13, 0.30, 0.05, frontOpenings, 8 + r);
      brickWall(walls, -W / 2, W / 2, y, -D / 2 - 0.01, 0.13, 0.30, 0.05, [[-0.55, 0.55]], 10 + r);
    }

    // ============ SHOPFRONT ============
    {
      const sW = shopX1 - shopX0, sH = gfY1 - gfY0;
      const FRAME_D = 0.08, FRAME_FRONT = 0.040, BORDER = 0.12;
      const PIL_T = 0.04, PIL_FRONT = 0.030;
      const sCx = (shopX0 + shopX1) / 2, sCy = (gfY0 + gfY1) / 2;
      const fzZ = D / 2 - 0.02;
      const put = (w, h, d, lx, ly, lz, color) =>
        walls.push(boxAt(w, h, d, sCx + lx, sCy + ly, fzZ + lz, color));
      const frameZ = FRAME_FRONT - FRAME_D / 2;
      put(sW + 2 * BORDER, BORDER, FRAME_D, 0,  sH / 2 + BORDER / 2, frameZ, PAL.woodShop);
      put(sW + 2 * BORDER, BORDER, FRAME_D, 0, -sH / 2 - BORDER / 2, frameZ, PAL.woodShop);
      put(BORDER, sH, FRAME_D, -sW / 2 - BORDER / 2, 0, frameZ, PAL.woodShop);
      put(BORDER, sH, FRAME_D,  sW / 2 + BORDER / 2, 0, frameZ, PAL.woodShop);
      for (let k = 1; k < 4; k++) {
        const px = -sW / 2 + k * sW / 4;
        put(PIL_T, sH, PIL_T, px, 0, PIL_FRONT - PIL_T / 2, PAL.woodShop);
      }
      put(sW, PIL_T, PIL_T, 0, sH / 2 - sH / 3, PIL_FRONT - PIL_T / 2, PAL.woodShop);
      // glass pane — wide, backed by interior
      const glassW = sW + 2 * BORDER - 0.02, glassH = sH + 2 * BORDER - 0.02;
      glassLit.push(boxAt(glassW, glassH, 0.03,
                          sCx, sCy, fzZ + 0.014 - 0.015, PAL.shopGlassBright));
    }

    // ============ INTERIOR (lobby + shelves) ============
    {
      const iy0 = baseH + 0.02, iyTop = baseH + floorH - 0.10;
      const iXMin = -W / 2 + wT + 0.02, iXMax = W / 2 - wT - 0.02;
      const iZFront = D / 2 - wT - 0.02, iZBack = -D / 6;
      const iW = iXMax - iXMin, iD = iZFront - iZBack, iZc = (iZFront + iZBack) / 2;

      walls.push(boxAt(iW, 0.05, iD, 0, iy0 - 0.025, iZc, PAL.lobbyFloor));
      walls.push(boxAt(iW + 0.20, 0.10, iD + 0.20, 0, iyTop + 0.05, iZc, PAL.lobbyWall));
      walls.push(boxAt(0.04, iyTop - iy0, iD, iXMin + 0.02, (iy0 + iyTop) / 2, iZc, PAL.lobbyWall));
      walls.push(boxAt(0.04, iyTop - iy0, iD, iXMax - 0.02, (iy0 + iyTop) / 2, iZc, PAL.lobbyWall));
      walls.push(boxAt(iW + 0.15, iyTop - iy0, 0.14, 0, (iy0 + iyTop) / 2, iZBack - 0.07, PAL.lobbyWall));

      // shelf wall on the back partition
      const shZ = iZBack + 0.02 + 0.35 / 2;
      const levels = [iy0 + 0.55, iy0 + 1.15, iy0 + 1.75, iy0 + 2.35];
      for (let li = 0; li < levels.length; li++) {
        const y = levels[li];
        walls.push(boxAt(iW - 0.1, 0.05, 0.35, 0, y, shZ, PAL.intShelf));
        for (let i = 0; i < 6; i++) {
          const px = -iW / 2 + 0.5 + i * (iW - 1.0) / 5;
          walls.push(boxAt(0.26, 0.28, 0.26, px, y + 0.165, shZ, PAL.goods[(i + li) % 6]));
        }
      }
      // two side racks
      for (const sx of [-1, 1]) {
        const rX = sx > 0 ? iXMax - 0.20 : iXMin + 0.20;
        const rZ0 = iZBack + 0.4, rZ1 = iZBack + 3.4;
        for (let li = 0; li < levels.length; li++) {
          const y = levels[li];
          walls.push(boxAt(0.35, 0.05, rZ1 - rZ0, rX, y, (rZ0 + rZ1) / 2, PAL.intShelf));
          for (let i = 0; i < 3; i++) {
            const pz = rZ0 + 0.5 + i * (rZ1 - rZ0 - 1.0) / 2;
            walls.push(boxAt(0.26, 0.28, 0.26, rX, y + 0.165, pz, PAL.goods[(i + li + 3) % 6]));
          }
        }
      }
      // counter
      walls.push(boxAt(2.8, 0.85, 0.7, 2.0, iy0 + 0.425, 0.6, PAL.woodShop));
      walls.push(boxAt(2.95, 0.06, 0.85, 2.0, iy0 + 0.88, 0.6, PAL.lobbyDeskTop));
      // pendant lamp
      walls.push(cylY(0.02, 0.02, iyTop - iy0 - 2.4, 2.0, (iyTop + iy0 + 2.4) / 2, 0.6, 6, PAL.metalDark));
      const shade = new THREE.ConeGeometry(0.28, 0.24, 14, 1, true);
      shade.translate(2.0, iy0 + 2.28, 0.6);
      walls.push({ geo: shade, color: PAL.metalDark });
      walls.push(sphAt(0.10, 0.10, 0.10, 2.0, iy0 + 2.22, 0.6, PAL.lobbyLight, 8));
    }

    // front door frame trim
    {
      const trimT = 0.10, trimD = 0.06, z = D / 2 + 0.03;
      walls.push(boxAt(doorW + 2 * trimT, trimT, trimD, doorX, doorY1 + trimT / 2, z, PAL.trim));
      walls.push(boxAt(trimT, doorH, trimD, doorX - doorW / 2 - trimT / 2, baseH + doorH / 2, z, PAL.trim));
      walls.push(boxAt(trimT, doorH, trimD, doorX + doorW / 2 + trimT / 2, baseH + doorH / 2, z, PAL.trim));
    }
    // open door leaf (swung outward)
    {
      const leafW = doorW - 0.04, leafH = doorH - 0.04, leafT = 0.05, barT = 0.10;
      const openAngle = 1.0;
      const hx = doorX - doorW / 2, hy = baseH + doorH / 2, hz = D / 2 - 0.02;
      const leafParts = () => [
        { geo: new THREE.BoxGeometry(leafW, barT, leafT).translate(leafW / 2,  leafH / 2 - barT / 2, 0) },
        { geo: new THREE.BoxGeometry(leafW, barT, leafT).translate(leafW / 2, -leafH / 2 + barT / 2, 0) },
        { geo: new THREE.BoxGeometry(barT, leafH - 2 * barT, leafT).translate(barT / 2, 0, 0) },
        { geo: new THREE.BoxGeometry(barT, leafH - 2 * barT, leafT).translate(leafW - barT / 2, 0, 0) },
      ];
      for (const p of leafParts()) {
        p.geo.rotateY(-openAngle); p.geo.translate(hx, hy, hz);
        walls.push({ geo: p.geo, color: PAL.trim });
      }
      const gl = new THREE.BoxGeometry(leafW - 2 * barT - 0.02, leafH - 2 * barT - 0.02, leafT * 0.5)
                 .translate(leafW / 2, 0, 0);
      gl.rotateY(-openAngle); gl.translate(hx, hy, hz);
      glassLit.push({ geo: gl, color: PAL.glass });
    }

    // ============ SIGN ============
    {
      const sw = 5.2, sh = 0.65, sy = 3.85;
      walls.push(boxAt(sw, sh, 0.08, (shopX0 + shopX1) / 2, sy, D / 2 + 0.04, PAL.trim));
      walls.push(boxAt(sw - 0.14, sh - 0.14, 0.10, (shopX0 + shopX1) / 2, sy, D / 2 + 0.09, 0x2a4a8a));
      for (let i = 0; i < 3; i++)
        walls.push(boxAt(0.55, 0.09, 0.02, (shopX0 + shopX1) / 2 - 0.9 + i * 0.9, sy, D / 2 + 0.14, 0xf0f0e8));
    }
    // awning
    {
      const awW = (shopX1 - shopX0) + 0.6, awX = (shopX0 + shopX1) / 2;
      const awDepth = 1.3, awY = gfY1 + 0.25, tilt = 0.34;
      const drop = awDepth * Math.sin(tilt), runZ = awDepth * Math.cos(tilt);
      const cY = awY - drop / 2, cZ = D / 2 + runZ / 2 - 0.02;
      const b = new THREE.BoxGeometry(awW, 0.10, awDepth);
      b.rotateX(tilt); b.translate(awX, cY, cZ);
      walls.push({ geo: b, color: 0x8a2a2a });
      walls.push(boxAt(awW, 0.18, 0.05, awX, awY - drop - 0.09, D / 2 + runZ - 0.03, 0xd8c8b0));
    }

    // ============ FLOOR BANDS + UPPER WINDOWS ============
    const winW = 1.3, winH = 1.5;
    const floorYs = [];
    for (let f = 1; f < floors; f++) floorYs.push(baseH + f * floorH + 1.55);
    const winXsFront = [-W / 2 + 3.2, 0, W / 2 - 3.2];
    for (const fy of floorYs) {
      for (const wx of winXsFront) {
        addWindow(walls, glassLit, glassDark, wx, fy,  D / 2, 'z', +1, winW, winH, isLit);
        addWindow(walls, glassLit, glassDark, wx, fy, -D / 2, 'z', -1, winW, winH, isLit);
      }
      for (const wz of [-1.8, 1.8]) {
        addWindow(walls, glassLit, glassDark, wz, fy,  W / 2, 'x', +1, winW, winH, isLit);
        addWindow(walls, glassLit, glassDark, wz, fy, -W / 2, 'x', -1, winW, winH, isLit);
      }
    }

    // cornice + flat roof + parapet
    walls.push(boxAt(W + 0.5, 0.30, D + 0.5, 0, wallY1 - 0.15, 0, PAL.trim));
    const roofThk = 0.20;                       // ← hoisted: the return below reads it too
    {
      walls.push(boxAt(W + 0.5, roofThk, D + 0.5, 0, wallY1 + roofThk / 2, 0, PAL.bandStone));
      const parW = W + 0.5, parD = D + 0.5, parH = 0.6, parT = 0.15;
      const py0 = wallY1 + roofThk;
      walls.push(boxAt(parW, parH, parT, 0, py0 + parH / 2,  parD / 2 - parT / 2, PAL.bandStone));
      walls.push(boxAt(parW, parH, parT, 0, py0 + parH / 2, -parD / 2 + parT / 2, PAL.bandStone));
      walls.push(boxAt(parT, parH, parD - 2 * parT,  parW / 2 - parT / 2, py0 + parH / 2, 0, PAL.bandStone));
      walls.push(boxAt(parT, parH, parD - 2 * parT, -parW / 2 + parT / 2, py0 + parH / 2, 0, PAL.bandStone));
      // AC + vents omitted (never visible from the street)
    }

    // forecourt
    walls.push(boxAt(doorW + (shopX1 - shopX0) + 2.0, 0.06, 0.7, (doorX + (shopX0 + shopX1) / 2) / 2,
                     (baseH - 0.02) / 2, D / 2 + 0.55, PAL.path));

    return {
      walls, glassLit, glassDark,
      w: W + 0.6, d: D + 1.5, h: wallY1 + roofThk + 0.6,
      // Walk-in: door gap on the local +Z face, and the lobby floor.
      outerW: W + 0.4, outerD: D + 0.4,
      entries: [{ x: doorX, w: doorW }],
      interior: { hw: W / 2 - 0.1, hd: D / 2 + 0.2, floorY: baseH + 0.02 },
    };
  }

  // ============================================================
  // 5. Residential (5 этажей, балконы, слуховые окна)
  // ============================================================
  function buildResidential(rng, hintW, hintD, hintH, paint, litRatio) {
    const walls = [], glassLit = [], glassDark = [];
    const W = clamp(hintW, 11, 16);
    const D = clamp(hintD, 9, 12);
    const floorH = 2.9, floors = 5;
    const H = floors * floorH;
    const baseH = 0.45;
    const wallY0 = baseH - 0.07, wallY1 = wallY0 + H;
    const ridgeH = 2.6, eave = 0.45;
    const isLit = makeLitFn(hashSeed(0, 0, 0x51de77), litRatio);

    walls.push(boxAt(W + 0.5, baseH, D + 0.5, 0, baseH / 2, 0, PAL.plinth));
    walls.push(boxAt(W, H, D, 0, wallY0 + H / 2, 0, paint));

    // shop strip on the ground floor
    const shopX0 = -W / 2 + 1.6, shopX1 = W / 2 - 1.6;
    const shopY0 = baseH + 0.15, shopY1 = baseH + floorH - 0.55;
    {
      const sW = shopX1 - shopX0, sH = shopY1 - shopY0;
      const cx = (shopX0 + shopX1) / 2, cy = (shopY0 + shopY1) / 2;
      const fz = D / 2 - 0.10, gz = D / 2 - 0.22;
      const BORDER = 0.10;
      const put = (w, h, d, lx, ly, lz, color) =>
        walls.push(boxAt(w, h, d, cx + lx, cy + ly, fz + lz, color));
      put(sW + 2 * BORDER, BORDER, 0.10, 0,  sH / 2 + BORDER / 2, 0, PAL.woodShop);
      put(sW + 2 * BORDER, BORDER, 0.10, 0, -sH / 2 - BORDER / 2, 0, PAL.woodShop);
      put(BORDER, sH, 0.10, -sW / 2 - BORDER / 2, 0, 0, PAL.woodShop);
      put(BORDER, sH, 0.10,  sW / 2 + BORDER / 2, 0, 0, PAL.woodShop);
      for (let k = 1; k < 4; k++) put(0.05, sH, 0.10, -sW / 2 + k * sW / 4, 0, 0, PAL.woodShop);
      put(sW, 0.05, 0.10, 0, sH / 2 - sH / 3, 0, PAL.woodShop);
      glassLit.push(boxAt(sW + 2 * BORDER - 0.02, sH + 2 * BORDER - 0.02, 0.03, cx, cy, gz, PAL.shopGlassBright));
    }
    // sign over the shopfront
    walls.push(boxAt((shopX1 - shopX0) * 0.9, 0.65, 0.08, 0, shopY1 + 0.55, D / 2 + 0.04, PAL.trim));
    walls.push(boxAt((shopX1 - shopX0) * 0.9 - 0.14, 0.51, 0.10, 0, shopY1 + 0.55, D / 2 + 0.09, 0x8a3a4a));

    // door
    const doorW = 1.4, doorH = 2.4;
    const doorYc = baseH + doorH / 2;
    walls.push(boxAt(doorW + 0.18, doorH + 0.16, 0.06, 0, doorYc, D / 2 + 0.03, PAL.trim));
    walls.push(boxAt(doorW, doorH, 0.10, 0, doorYc, D / 2 + 0.06, pick(rng, PAL.door)));
    walls.push(sphAt(0.06, 0.06, 0.06, doorW / 2 - 0.18, doorYc, D / 2 + 0.12, 0xd4b878, 8));
    walls.push(boxAt(doorW + 1.0, baseH - 0.02, 0.8, 0, (baseH - 0.02) / 2, D / 2 + 0.55, PAL.path));

    // upper-floor windows + balconies on even floors
    const winW = 1.2, winH = 1.5;
    const winXsFront = [-W / 2 + 2.0, -W / 6 - 0.4, W / 6 + 0.4, W / 2 - 2.0];
    for (let f = 1; f < floors; f++) {
      const fy = baseH + f * floorH + 1.55;
      for (const wx of winXsFront) {
        addWindow(walls, glassLit, glassDark, wx, fy,  D / 2, 'z', +1, winW, winH, isLit);
        addWindow(walls, glassLit, glassDark, wx, fy, -D / 2, 'z', -1, winW, winH, isLit);
      }
      for (const wz of [-D / 4 - 0.3, 0, D / 4 + 0.3]) {
        addWindow(walls, glassLit, glassDark, wz, fy,  W / 2, 'x', +1, winW, winH, isLit);
        addWindow(walls, glassLit, glassDark, wz, fy, -W / 2, 'x', -1, winW, winH, isLit);
      }
      if (f % 2 === 0) {
        addBalcony(walls, -W / 2 + 2.0, baseH + f * floorH + 0.05, D / 2, +1, 2.6, 1.2);
        addBalcony(walls,  W / 2 - 2.0, baseH + f * floorH + 0.05, D / 2, +1, 2.6, 1.2);
      }
    }
    // ground-floor back windows
    for (const wx of [-W / 4, W / 4])
      addWindow(walls, glassLit, glassDark, wx, baseH + 1.55, -D / 2, 'z', -1, winW, winH, isLit);
    // ground-floor side windows
    for (const sx of [-1, 1])
      addWindow(walls, glassLit, glassDark, 0, baseH + 1.55, sx * W / 2, 'x', sx, winW, winH, isLit);

    // roof
    pitchedRoof(walls, 0, 0, W, D, wallY1, ridgeH, PAL.roofA[3], eave, PAL.trim, paint);

    // dormer windows on the front slope
    for (const dx of [-W / 4, W / 4]) {
      const dW = 1.5, dD = 2.5, dH = 1.5;
      const zc = D * 0.275;
      const slope = ridgeH / (D / 2);
      const zFront = zc + dD / 2, zBack = zc - dD / 2;
      const yFrontRoof = wallY1 + ridgeH - zFront * slope;
      const yBackRoof  = wallY1 + ridgeH - zBack  * slope;
      const dBottom = yFrontRoof - 0.35;
      const dTop    = Math.min(dBottom + dH, yBackRoof - 0.02);
      walls.push(boxAt(dW, dTop - dBottom, dD, dx, (dBottom + dTop) / 2, zc, paint));
      const winCentreY = (yFrontRoof + dTop) / 2;
      addWindow(walls, glassLit, glassDark, dx, winCentreY, zFront, 'z', +1, 0.9, 0.9, isLit);
      pitchedRoof(walls, dx, zc, dW, dD, dTop, 0.35, PAL.roofA[2], 0.15, PAL.trim, paint);
    }

    return { walls, glassLit, glassDark, w: W + 1, d: D + 1, h: wallY1 + ridgeH + 0.5 };
  }

  // ============================================================
  // 6. Office (8 этажей, лобби с лифтами)
  // ============================================================
  function buildOffice(rng, hintW, hintD, hintH, paint, litRatio) {
    const walls = [], glassLit = [], glassDark = [];
    const W = clamp(hintW, 12, 18);
    const D = clamp(hintD, 9, 13);
    const floors = 8, floorH = 3.4;
    const H = floors * floorH;
    const baseH = 0.55;
    const wallY0 = baseH - 0.07, wallY1 = wallY0 + H;
    const wT = 0.16;
    const isLit = makeLitFn(hashSeed(0, 0, 0x51de77), litRatio);

    walls.push(boxAt(W + 0.6, baseH, D + 0.6, 0, baseH / 2, 0, PAL.bandCap));
    // Ground floor is built from curtain-wall segments below — no full-volume
    // box here. That box occluded the lobby glass and the entrance door
    // (both at fz = D/2 - 0.05, i.e. inside it), so the office looked sealed
    // at street level. Upper floors come from the H - floorH box below.

    const lobbyX0 = -W / 2 + 3.5, lobbyX1 = W / 2 - 3.5;
    const lobbyY0 = baseH + 0.35, lobbyY1 = baseH + floorH - 0.55;
    const doorW = 2.4, doorH = 2.6, doorX = 0, doorY1 = baseH + doorH;
    const gfY0 = baseH + 0.40, gfY1 = baseH + floorH - 0.30;
    const fz = D / 2 - 0.05;

    // lobby glass curtain wall (front) — split around door bay
    {
      const gfGlassH = gfY1 - gfY0, gfYc = (gfY0 + gfY1) / 2;
      const sideW = (W - 0.15 - doorW - 0.20) / 2;
      glassLit.push(boxAt(sideW, gfGlassH, 0.04, -doorW / 2 - 0.10 - sideW / 2, gfYc, fz, PAL.glass));
      glassLit.push(boxAt(sideW, gfGlassH, 0.04,  doorW / 2 + 0.10 + sideW / 2, gfYc, fz, PAL.glass));
      const topH = gfY1 - (doorY1 + 0.05);
      if (topH > 0.05)
        glassLit.push(boxAt(doorW + 0.20, topH, 0.04, 0, doorY1 + 0.05 + topH / 2, fz, PAL.glass));
      // back + sides
      glassLit.push(boxAt(W - 0.15, gfGlassH, 0.04, 0, gfYc, -D / 2 + 0.05, PAL.glass));
      glassLit.push(boxAt(0.04, gfGlassH, D - 0.15,  W / 2 - 0.05, gfYc, 0, PAL.glass));
      glassLit.push(boxAt(0.04, gfGlassH, D - 0.15, -W / 2 + 0.05, gfYc, 0, PAL.glass));
    }

    // base course under the curtain glass (the missing lower block): closes
    // the gap between podium top and glass bottom that left the ground-floor
    // glazing floating over air; front split around the entrance bay so the
    // door opening stays clear, ends stop at the corner columns' inner face
    // to avoid coplanar faces with them
    {
      const bY0 = baseH, bY1 = gfY0, bH = bY1 - bY0, bYc = (bY0 + bY1) / 2;
      const bayHalf = doorW / 2 + 0.10;   // matches the front glass split
      for (const s of [-1, 1]) {
        const segW = W / 2 - 0.6 - bayHalf;
        walls.push(boxAt(segW, bH, wT, s * (bayHalf + segW / 2), bYc, fz, paint));
      }
      walls.push(boxAt(W - 1.2, bH, wT, 0, bYc, -fz, paint));
      for (const s of [-1, 1])
        walls.push(boxAt(wT, bH, D - 1.2, s * (W / 2 - 0.05), bYc, 0, paint));
    }

    // corner columns
    const colR = 0.30;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      walls.push(boxAt(colR * 2, floorH, colR * 2, sx * (W / 2 - colR), baseH + floorH / 2, sz * (D / 2 - colR), PAL.wallDark));

    // ground-floor mullions
    for (let i = 1; i < 6; i++) {
      const px = -W / 2 + 0.4 + i * (W - 0.8) / 6;
      if (Math.abs(px) < 1.7) continue;
      walls.push(boxAt(0.06, gfY1 - gfY0, 0.10, px, (gfY0 + gfY1) / 2,  D / 2 - 0.03, PAL.glassFrameMetal));
      walls.push(boxAt(0.06, gfY1 - gfY0, 0.10, px, (gfY0 + gfY1) / 2, -D / 2 + 0.03, PAL.glassFrameMetal));
    }
    for (let i = 1; i < 5; i++) {
      const pz = -D / 2 + 0.4 + i * (D - 0.8) / 5;
      walls.push(boxAt(0.10, gfY1 - gfY0, 0.06,  W / 2 - 0.03, (gfY0 + gfY1) / 2, pz, PAL.glassFrameMetal));
      walls.push(boxAt(0.10, gfY1 - gfY0, 0.06, -W / 2 + 0.03, (gfY0 + gfY1) / 2, pz, PAL.glassFrameMetal));
    }

    // top rail over ground floor
    walls.push(boxAt(W + 0.20, 0.35, D + 0.20, 0, baseH + floorH - 0.15, 0, PAL.trim));

    // upper block from floor 1 to top
    walls.push(boxAt(W, H - floorH, D, 0, wallY0 + floorH + (H - floorH) / 2, 0, paint));

    // ground-floor lobby interior
    {
      const intZBack = -D / 2 + wT + 0.02;
      const iy0 = baseH + 0.10, iyTop = baseH + floorH - 0.25;
      const fiX0 = -W / 2 + 0.07, fiX1 = W / 2 - 0.07;
      const fiZ0 = -D / 2 + 0.07, fiZ1 = D / 2 - 0.07;
      const fiW = fiX1 - fiX0, fiD = fiZ1 - fiZ0, fiZc = (fiZ0 + fiZ1) / 2;
      // Slab and ceiling reach the interior face of the curtain glass so no gap
      // opens at the wall; the curtain glass is the lobby wall.
      walls.push(boxAt(fiW, 0.08, fiD, 0, iy0 - 0.04, fiZc, PAL.lobbyFloor));
      walls.push(boxAt(fiW, 0.10, fiD, 0, iyTop + 0.05, fiZc, PAL.lobbyCeil));
      // No interior wall lining. The old cream side panels + back partition
      // blocked the view out through the curtain glass, and the back partition
      // sat in front of the elevator doors (eZ = intZBack + 0.02, doors at
      // eZ + 0.05) so the lift bay was hidden. The glass is the wall now.
      // elevators
      const eW = 1.4, eH = 2.4;
      const eY0 = iy0 + 0.05, eY1 = eY0 + eH;
      const eZ = intZBack + 0.02;
      // backing slab behind the four lift frames: without it the frames and
      // doors hang in front of bare curtain glass (frame back at eZ - 0.03,
      // glass inner face at -D/2 + 0.07); kept narrow so the rest of the rear
      // stays open glazing — a full partition would hide the lift bay again
      {
        const lbY0 = iy0 - 0.05, lbY1 = eY1 + 0.35;
        walls.push(boxAt(8.4, lbY1 - lbY0, (eZ - 0.03) - (-D / 2 + 0.07), 0, (lbY0 + lbY1) / 2, ((eZ - 0.03) + (-D / 2 + 0.07)) / 2, PAL.lobbyWall));
      }
      for (const ex of [-3.0, -1.0, 1.0, 3.0]) {
        walls.push(boxAt(eW + 0.26, eH + 0.26, 0.06, ex, (eY0 + eY1) / 2, eZ, PAL.liftFrame));
        const half = eW / 2 - 0.02;
        walls.push(boxAt(half, eH, 0.06, ex - half / 2 - 0.01, (eY0 + eY1) / 2, eZ + 0.05, PAL.liftDoor));
        walls.push(boxAt(half, eH, 0.06, ex + half / 2 + 0.01, (eY0 + eY1) / 2, eZ + 0.05, PAL.liftDoor));
        walls.push(boxAt(0.02, eH, 0.02, ex, (eY0 + eY1) / 2, eZ + 0.09, PAL.liftFrame));
        walls.push(boxAt(eW, 0.15, 0.04, ex, eY1 + 0.22, eZ + 0.04, PAL.liftFrame));
        walls.push(boxAt(0.22, 0.08, 0.02, ex, eY1 + 0.22, eZ + 0.07, PAL.liftIndicator));
      }
      // reception desk
      walls.push(boxAt(3.2, 1.10, 0.9, 3.5, iy0 + 0.55, 2.2, PAL.lobbyDesk));
      walls.push(boxAt(3.38, 0.06, 1.08, 3.5, iy0 + 1.13, 2.2, PAL.lobbyDeskTop));
      // two plants
      for (const sx of [-1, 1]) {
        const px = sx * 3.0, pz = D / 2 - 1.3;
        walls.push(cylY(0.35, 0.30, 0.60, px, iy0 + 0.30, pz, 10, PAL.plinth));
        walls.push(sphAt(0.55, 0.55, 0.55, px, iy0 + 1.20, pz, PAL.bush, 10));
        walls.push(sphAt(0.40, 0.45, 0.40, px + 0.15, iy0 + 1.55, pz + 0.15, PAL.garden, 8));
      }
      // ceiling lights
      for (const lx of [-4, -2, 0, 2, 4]) for (const lz of [-2.5, 0, 2.5])
        walls.push(boxAt(1.4, 0.04, 0.5, lx, iyTop - 0.02, lz, PAL.lobbyLight));
    }

    // entrance portal + open door leaves
    {
      const fr = 0.14;
      walls.push(boxAt(doorW + 2 * fr, fr, 0.12, 0, doorY1 + fr / 2, fz + 0.05, PAL.metalLight));
      walls.push(boxAt(fr, doorH, 0.12, -doorW / 2 - fr / 2, baseH + doorH / 2, fz + 0.05, PAL.metalLight));
      walls.push(boxAt(fr, doorH, 0.12,  doorW / 2 + fr / 2, baseH + doorH / 2, fz + 0.05, PAL.metalLight));
      const leafW = doorW / 2 - 0.04, leafH = doorH - 0.06, leafT = 0.07, barT = 0.09, ang = 1.15;
      for (const side of [-1, 1]) {
        const hingeX = side * (doorW / 2 - 0.02);
        const sign = side, angle = side === -1 ? -ang : ang;
        const X = v => v * sign;
        const parts = [
          new THREE.BoxGeometry(leafW, barT, leafT).translate(X(leafW / 2),  leafH / 2 - barT / 2, 0),
          new THREE.BoxGeometry(leafW, barT, leafT).translate(X(leafW / 2), -leafH / 2 + barT / 2, 0),
          new THREE.BoxGeometry(barT, leafH - 2 * barT, leafT).translate(X(barT / 2), 0, 0),
          new THREE.BoxGeometry(barT, leafH - 2 * barT, leafT).translate(X(leafW - barT / 2), 0, 0),
        ];
        for (const g of parts) { g.rotateY(angle); g.translate(hingeX, baseH + doorH / 2, fz); walls.push({ geo: g, color: PAL.glassFrameMetal }); }
        const gl = new THREE.BoxGeometry(leafW - 2 * barT - 0.04, leafH - 2 * barT - 0.04, leafT * 0.45).translate(X(leafW / 2), 0, 0);
        gl.rotateY(angle); gl.translate(hingeX, baseH + doorH / 2, fz);
        glassLit.push({ geo: gl, color: PAL.glass });
      }
    }
    // canopy
    {
      const canW = doorW + 2.4, canD = 2.0, canY = doorY1 + 0.60;
      walls.push(boxAt(canW, 0.16, canD, 0, canY, D / 2 + canD / 2 - 0.10, PAL.bandCap));
      walls.push(boxAt(canW + 0.10, 0.05, canD + 0.10, 0, canY - 0.10, D / 2 + canD / 2 - 0.10, PAL.metalDark));
      for (const sx of [-1, 1])
        walls.push(cylY(0.08, 0.09, canY - 0.10, sx * (canW / 2 - 0.30), (canY - 0.10) / 2, D / 2 + canD - 0.30, 10, PAL.metalDark));
    }
    walls.push(boxAt(doorW + 2.0, baseH - 0.02, 0.9, 0, (baseH - 0.02) / 2, D / 2 + 0.60, PAL.path));

    // upper-floor windows: 6 front/back, 4 sides
    const winW = 1.7, winH = 2.15, winY = 1.85;
    const nFront = 6, pitchF = W / nFront;
    const frontXs = [];
    for (let i = 0; i < nFront; i++) frontXs.push(-W / 2 + (i + 0.5) * pitchF);
    const nSide = 4, pitchS = D / nSide;
    const sideZs = [];
    for (let i = 0; i < nSide; i++) sideZs.push(-D / 2 + (i + 0.5) * pitchS);
    for (let f = 1; f < floors; f++) {
      const fy = baseH + f * floorH + winY;
      for (const wx of frontXs) {
        addWindow(walls, glassLit, glassDark, wx, fy,  D / 2, 'z', +1, winW, winH, isLit);
        addWindow(walls, glassLit, glassDark, wx, fy, -D / 2, 'z', -1, winW, winH, isLit);
      }
      for (const wz of sideZs) {
        addWindow(walls, glassLit, glassDark, wz, fy,  W / 2, 'x', +1, winW, winH, isLit);
        addWindow(walls, glassLit, glassDark, wz, fy, -W / 2, 'x', -1, winW, winH, isLit);
      }
    }
    // floor bands
    for (let f = 1; f < floors; f++) {
      const y = baseH + f * floorH - 0.15;
      walls.push(boxAt(W + 0.04, 0.14, 0.02, 0, y,  D / 2 + 0.01, PAL.bandStone));
      walls.push(boxAt(W + 0.04, 0.14, 0.02, 0, y, -D / 2 - 0.01, PAL.bandStone));
      walls.push(boxAt(0.02, 0.14, D + 0.04,  W / 2 + 0.01, y, 0, PAL.bandStone));
      walls.push(boxAt(0.02, 0.14, D + 0.04, -W / 2 - 0.01, y, 0, PAL.bandStone));
    }
    // pilasters at bay boundaries
    for (let i = 0; i <= nFront; i++) {
      const px = -W / 2 + i * pitchF;
      if (Math.abs(px) > W / 2 - 0.001) continue;
      walls.push(boxAt(0.30, H - floorH, 0.05, px, wallY0 + floorH + (H - floorH) / 2,  D / 2 + 0.025, PAL.wallLight));
      walls.push(boxAt(0.30, H - floorH, 0.05, px, wallY0 + floorH + (H - floorH) / 2, -D / 2 - 0.025, PAL.wallLight));
    }
    for (let i = 0; i <= nSide; i++) {
      const pz = -D / 2 + i * pitchS;
      if (Math.abs(pz) > D / 2 - 0.001) continue;
      walls.push(boxAt(0.05, H - floorH, 0.30,  W / 2 + 0.025, wallY0 + floorH + (H - floorH) / 2, pz, PAL.wallLight));
      walls.push(boxAt(0.05, H - floorH, 0.30, -W / 2 - 0.025, wallY0 + floorH + (H - floorH) / 2, pz, PAL.wallLight));
    }

    // cornice + roof + parapet
    walls.push(boxAt(W + 0.6, 0.35, D + 0.6, 0, wallY1 - 0.15, 0, PAL.trim));
    walls.push(boxAt(W + 0.7, 0.10, D + 0.7, 0, wallY1 + 0.05, 0, PAL.bandCap));
    const roofThk = 0.20;
    walls.push(boxAt(W + 0.7, roofThk, D + 0.7, 0, wallY1 + 0.20 + roofThk / 2, 0, PAL.wallLight));
    const parW = W + 0.7, parD = D + 0.7, parH = 0.6, parT = 0.16;
    const parY0 = wallY1 + 0.20 + roofThk;
    walls.push(boxAt(parW, parH, parT, 0, parY0 + parH / 2,  parD / 2 - parT / 2, PAL.bandStone));
    walls.push(boxAt(parW, parH, parT, 0, parY0 + parH / 2, -parD / 2 + parT / 2, PAL.bandStone));
    walls.push(boxAt(parT, parH, parD - 2 * parT,  parW / 2 - parT / 2, parY0 + parH / 2, 0, PAL.bandStone));
    walls.push(boxAt(parT, parH, parD - 2 * parT, -parW / 2 + parT / 2, parY0 + parH / 2, 0, PAL.bandStone));

    // rooftop mechanical penthouse
    {
      const pw = 5.5, pd = 4.5, ph = 2.4, px = -W / 4, pz = -D / 4;
      walls.push(boxAt(pw, ph, pd, px, parY0 + ph / 2, pz, PAL.wallLight));
      walls.push(boxAt(pw + 0.3, 0.16, pd + 0.3, px, parY0 + ph + 0.08, pz, PAL.bandCap));
    }
    // AC units symmetric about x=0
    for (let i = 0; i < 4; i++) {
      const ax = -3.75 + i * 2.5, az = D / 4 + 0.4;
      walls.push(boxAt(1.8, 0.85, 1.2, ax, parY0 + 0.425, az, PAL.ac));
      walls.push(boxAt(1.8, 0.08, 1.2, ax, parY0 + 0.89, az, PAL.acDark));
    }
    // antenna
    walls.push(cylY(0.06, 0.08, 4.5, W / 4 + 1, parY0 + 2.25, -D / 4, 8, PAL.metalDark));
    walls.push(boxAt(0.5, 0.05, 0.05, W / 4 + 1, parY0 + 3.6, -D / 4, PAL.metalDark));
    walls.push(boxAt(0.5, 0.05, 0.05, W / 4 + 1, parY0 + 4.2, -D / 4, PAL.metalDark));
    walls.push(sphAt(0.10, 0.10, 0.10, W / 4 + 1, parY0 + 4.55, -D / 4, PAL.beacon, 8));

    // plaza
    {
      const pz = D / 2 + 4.5, pw = W + 6.0, pd = 7.0;
      walls.push(boxAt(pw, 0.06, pd, 0, 0.03, pz, PAL.path));
      for (const sx of [-1, 1]) {
        const bx = sx * (pw / 2 - 2.5), bz = pz - 2.0;
        walls.push(boxAt(2.4, 0.60, 2.4, bx, 0.30, bz, PAL.plinth));
        walls.push(sphAt(0.85, 0.60, 0.85, bx, 0.90, bz, PAL.bush, 10));
      }
    }

    return {
      walls, glassLit, glassDark,
      w: W + 0.7, d: D + 0.7, h: wallY1 + roofThk + parH + 0.4,
      outerW: W + 0.6, outerD: D + 0.6,
      entries: [{ x: 0, w: 2.4 }],   // doorW in the builder is 2.4
      interior: { hw: W / 2 - 0.1, hd: D / 2 + 0.3, floorY: baseH + 0.10 },
    };
  }

  // ============================================================
  // 7. Tower (три ступенчатых яруса, сплошное остекление)
  // ============================================================
  function curtainTier(walls, glassLit, yBase, floors, W, D, coreColor, isLit) {
    const floorH = 3.0, tierH = floors * floorH;
    const halfW = W / 2, halfD = D / 2, yMid = yBase + tierH / 2;
    walls.push(boxAt(W - 0.6, tierH - 0.2, D - 0.6, 0, yMid, 0, coreColor));
    for (let f = 0; f <= floors; f++) {
      const ys = yBase + f * floorH;
      if (ys > yBase + tierH + 0.01) break;
      walls.push(boxAt(W - 0.5, 0.10, D - 0.5, 0, ys + 0.05, 0, PAL.wallDark));
    }
    const colR = 0.22;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      walls.push(boxAt(colR * 2, tierH, colR * 2, sx * (halfW - colR), yMid, sz * (halfD - colR), PAL.wallDark));
    // continuous glass ribbon (into glassLit)
    glassLit.push(boxAt(W - 0.10, tierH, 0.03, 0, yMid,  halfD - 0.03, PAL.glass));
    glassLit.push(boxAt(W - 0.10, tierH, 0.03, 0, yMid, -halfD + 0.03, PAL.glass));
    glassLit.push(boxAt(0.03, tierH, D - 0.10,  halfW - 0.03, yMid, 0, PAL.glass));
    glassLit.push(boxAt(0.03, tierH, D - 0.10, -halfW + 0.03, yMid, 0, PAL.glass));
    // spandrel bands
    const spH = 0.85;
    for (let f = 0; f < floors; f++) {
      const yb = yBase + f * floorH + spH / 2;
      walls.push(boxAt(W - 0.10, spH, 0.06, 0, yb,  halfD - 0.10, PAL.wallDark));
      walls.push(boxAt(W - 0.10, spH, 0.06, 0, yb, -halfD + 0.10, PAL.wallDark));
      walls.push(boxAt(0.06, spH, D - 0.10,  halfW - 0.10, yb, 0, PAL.wallDark));
      walls.push(boxAt(0.06, spH, D - 0.10, -halfW + 0.10, yb, 0, PAL.wallDark));
    }
    // vertical mullions
    const pitch = 1.5;
    const nF = Math.max(1, Math.floor((W - 0.8) / pitch));
    for (let i = 1; i < nF; i++) {
      const px = -halfW + 0.40 + i * (W - 0.80) / nF;
      walls.push(boxAt(0.05, tierH, 0.08, px, yMid,  halfD - 0.05, PAL.glassFrameMetal));
      walls.push(boxAt(0.05, tierH, 0.08, px, yMid, -halfD + 0.05, PAL.glassFrameMetal));
    }
    const nS = Math.max(1, Math.floor((D - 0.8) / pitch));
    for (let i = 1; i < nS; i++) {
      const pz = -halfD + 0.40 + i * (D - 0.80) / nS;
      walls.push(boxAt(0.08, tierH, 0.05,  halfW - 0.05, yMid, pz, PAL.glassFrameMetal));
      walls.push(boxAt(0.08, tierH, 0.05, -halfW + 0.05, yMid, pz, PAL.glassFrameMetal));
    }
  }

  function buildTower(rng, hintW, hintD, hintH, paint, litRatio) {
    const walls = [], glassLit = [], glassDark = [];
    const isLit = makeLitFn(hashSeed(0, 0, 0x51de77), litRatio);
    const baseH = 0.5, gfH = 4.5;
    const W1 = clamp(hintW, 10, 13), D1 = clamp(hintD, 8, 10);
    const W2 = W1 * 0.79, D2 = D1 * 0.80;
    const W3 = W1 * 0.58, D3 = D1 * 0.60;
    const t1F = 15, t2F = 3, t3F = 2;
    const yBase = baseH, yGFTop = baseH + gfH;
    const yT1Top = yGFTop + t1F * 3;
    const yT2Top = yT1Top + t2F * 3;
    const yT3Top = yT2Top + t3F * 3;

    walls.push(boxAt(W1 + 0.6, baseH, D1 + 0.6, 0, baseH / 2, 0, PAL.bandCap));
    walls.push(boxAt(W1 + 0.7, 0.08, D1 + 0.7, 0, baseH + 0.04, 0, PAL.plinthCap));
    walls.push(boxAt(W1 - 0.05, 0.36, D1 - 0.05, 0, yBase + 0.20, 0, PAL.trim));

    // lobby
    const intX0 = -W1 / 2 + 0.35, intX1 = W1 / 2 - 0.35;
    const intZBack = -D1 / 2 + 0.35, intZFront = D1 / 2 - 0.35;
    const intY0 = yBase + 0.10, intY1 = yBase + gfH - 0.25;
    const iW = intX1 - intX0, iD = intZFront - intZBack, iZc = (intZFront + intZBack) / 2;

    walls.push(boxAt(iW, 0.08, iD, 0, intY0 - 0.04, iZc, PAL.lobbyFloor));
    walls.push(boxAt(iW, 0.10, iD, 0, intY1 + 0.05, iZc, PAL.lobbyCeil));
    // No interior wall lining: the old side panels and back partition sat ~30 cm
    // inside the curtain glass, so the ground-floor side/rear facades read as
    // solid walls instead of see-through lobby glazing, and the partition buried
    // the lift doors (door slabs at eZ + 0.05 fell inside its volume). The glass
    // is the wall now — same treatment as buildOffice's lobby.

    // four elevators
    {
      const eW = 1.4, eH = 2.4, eY0 = intY0 + 0.05, eY1 = eY0 + eH, eZ = intZBack + 0.02;
      // backing slab behind the four lift frames: without it the frames and
      // doors hang in front of bare curtain glass (frame back at eZ - 0.03,
      // glass inner face at -D1/2 + 0.07); kept narrow so the rest of the rear
      // stays open glazing — a full partition would hide the lift bay again
      {
        const lbY0 = intY0 - 0.05, lbY1 = eY1 + 0.35;
        walls.push(boxAt(8.4, lbY1 - lbY0, (eZ - 0.03) - (-D1 / 2 + 0.07), 0, (lbY0 + lbY1) / 2, ((eZ - 0.03) + (-D1 / 2 + 0.07)) / 2, PAL.lobbyWall));
      }
      for (const ex of [-3.0, -1.0, 1.0, 3.0]) {
        walls.push(boxAt(eW + 0.26, eH + 0.26, 0.06, ex, (eY0 + eY1) / 2, eZ, PAL.liftFrame));
        const half = eW / 2 - 0.02;
        walls.push(boxAt(half, eH, 0.06, ex - half / 2 - 0.01, (eY0 + eY1) / 2, eZ + 0.05, PAL.liftDoor));
        walls.push(boxAt(half, eH, 0.06, ex + half / 2 + 0.01, (eY0 + eY1) / 2, eZ + 0.05, PAL.liftDoor));
        walls.push(boxAt(eW, 0.15, 0.04, ex, eY1 + 0.22, eZ + 0.04, PAL.liftFrame));
        walls.push(boxAt(0.22, 0.08, 0.02, ex, eY1 + 0.22, eZ + 0.07, PAL.liftIndicator));
      }
    }
    // reception
    walls.push(boxAt(3.2, 1.10, 0.9, 3.5, intY0 + 0.55, 2.2, PAL.lobbyDesk));
    walls.push(boxAt(3.38, 0.06, 1.08, 3.5, intY0 + 1.13, 2.2, PAL.lobbyDeskTop));
    for (const sx of [-1, 1]) {
      const px = sx * 3.0, pz = D1 / 2 - 1.3;
      walls.push(cylY(0.35, 0.30, 0.60, px, intY0 + 0.30, pz, 10, PAL.plinth));
      walls.push(sphAt(0.55, 0.55, 0.55, px, intY0 + 1.20, pz, PAL.bush, 10));
    }
    for (const lx of [-4, -2, 0, 2, 4]) for (const lz of [-2.5, 0, 2.5])
      walls.push(boxAt(1.4, 0.04, 0.5, lx, intY1 - 0.02, lz, PAL.lobbyLight));

    // ground-floor curtain wall
    const gfY0 = yBase + 0.40, gfY1 = yBase + gfH - 0.30;
    const gfGlassH = gfY1 - gfY0, gfYc = (gfY0 + gfY1) / 2;
    const doorW = 3.0, doorY0 = gfY0, doorY1 = gfY0 + 2.80, doorH = doorY1 - doorY0, doorYc = (doorY0 + doorY1) / 2;
    const gfZ = D1 / 2 - 0.05;
    // front split
    {
      const sideW = (W1 - 0.15 - doorW - 0.20) / 2;
      glassLit.push(boxAt(sideW, gfGlassH, 0.04, -doorW / 2 - 0.10 - sideW / 2, gfYc, gfZ, PAL.glass));
      glassLit.push(boxAt(sideW, gfGlassH, 0.04,  doorW / 2 + 0.10 + sideW / 2, gfYc, gfZ, PAL.glass));
      const topH = gfY1 - (doorY1 + 0.05);
      if (topH > 0.05) glassLit.push(boxAt(doorW + 0.20, topH, 0.04, 0, doorY1 + 0.05 + topH / 2, gfZ, PAL.glass));
    }
    glassLit.push(boxAt(W1 - 0.15, gfGlassH, 0.04, 0, gfYc, -D1 / 2 + 0.05, PAL.glass));
    glassLit.push(boxAt(0.04, gfGlassH, D1 - 0.15,  W1 / 2 - 0.05, gfYc, 0, PAL.glass));
    glassLit.push(boxAt(0.04, gfGlassH, D1 - 0.15, -W1 / 2 + 0.05, gfYc, 0, PAL.glass));

    // corner columns of ground floor
    const colR = 0.30;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      walls.push(boxAt(colR * 2, gfH, colR * 2, sx * (W1 / 2 - colR), yBase + gfH / 2, sz * (D1 / 2 - colR), PAL.wallDark));

    // ground floor mullions
    for (let i = 1; i < 6; i++) {
      const px = -W1 / 2 + 0.4 + i * (W1 - 0.8) / 6;
      if (Math.abs(px) < 1.7) continue;
      walls.push(boxAt(0.06, gfGlassH, 0.10, px, gfYc,  D1 / 2 - 0.03, PAL.glassFrameMetal));
      walls.push(boxAt(0.06, gfGlassH, 0.10, px, gfYc, -D1 / 2 + 0.03, PAL.glassFrameMetal));
    }
    for (let i = 1; i < 5; i++) {
      const pz = -D1 / 2 + 0.4 + i * (D1 - 0.8) / 5;
      walls.push(boxAt(0.10, gfGlassH, 0.06,  W1 / 2 - 0.03, gfYc, pz, PAL.glassFrameMetal));
      walls.push(boxAt(0.10, gfGlassH, 0.06, -W1 / 2 + 0.03, gfYc, pz, PAL.glassFrameMetal));
    }

    // top rail over ground floor
    walls.push(boxAt(W1 + 0.20, 0.35, D1 + 0.20, 0, yGFTop - 0.15, 0, PAL.trim));

    // door portal + open leaves
    {
      const fr = 0.14;
      walls.push(boxAt(doorW + 2 * fr, fr, 0.12, 0, doorY1 + fr / 2, gfZ + 0.05, PAL.metalLight));
      walls.push(boxAt(fr, doorH, 0.12, -doorW / 2 - fr / 2, doorYc, gfZ + 0.05, PAL.metalLight));
      walls.push(boxAt(fr, doorH, 0.12,  doorW / 2 + fr / 2, doorYc, gfZ + 0.05, PAL.metalLight));
      const leafW = doorW / 2 - 0.04, leafH = doorH - 0.06, leafT = 0.07, barT = 0.09, ang = 1.15;
      for (const side of [-1, 1]) {
        const hingeX = side * (doorW / 2 - 0.02);
        const sign = side, angle = side === -1 ? -ang : ang;
        const X = v => v * sign;
        const parts = [
          new THREE.BoxGeometry(leafW, barT, leafT).translate(X(leafW / 2),  leafH / 2 - barT / 2, 0),
          new THREE.BoxGeometry(leafW, barT, leafT).translate(X(leafW / 2), -leafH / 2 + barT / 2, 0),
          new THREE.BoxGeometry(barT, leafH - 2 * barT, leafT).translate(X(barT / 2), 0, 0),
          new THREE.BoxGeometry(barT, leafH - 2 * barT, leafT).translate(X(leafW - barT / 2), 0, 0),
        ];
        for (const g of parts) { g.rotateY(angle); g.translate(hingeX, doorYc, gfZ); walls.push({ geo: g, color: PAL.glassFrameMetal }); }
        const gl = new THREE.BoxGeometry(leafW - 2 * barT - 0.04, leafH - 2 * barT - 0.04, leafT * 0.45).translate(X(leafW / 2), 0, 0);
        gl.rotateY(angle); gl.translate(hingeX, doorYc, gfZ);
        glassLit.push({ geo: gl, color: PAL.glass });
      }
    }

    // canopy
    {
      const canW = doorW + 2.4, canD = 2.0, canY = doorY1 + 0.60;
      walls.push(boxAt(canW, 0.16, canD, 0, canY, D1 / 2 + canD / 2 - 0.10, PAL.bandCap));
      walls.push(boxAt(canW + 0.10, 0.05, canD + 0.10, 0, canY - 0.10, D1 / 2 + canD / 2 - 0.10, PAL.metalDark));
      for (const sx of [-1, 1])
        walls.push(cylY(0.08, 0.09, canY - 0.10, sx * (canW / 2 - 0.30), (canY - 0.10) / 2, D1 / 2 + canD - 0.30, 10, PAL.metalDark));
    }
    walls.push(boxAt(doorW + 2.0, baseH - 0.02, 1.0, 0, (baseH - 0.02) / 2, D1 / 2 + 0.60, PAL.path));

    // three tiers
    curtainTier(walls, glassLit, yGFTop, t1F, W1, D1, PAL.core, isLit);
    walls.push(boxAt(W1 + 0.5, 0.30, D1 + 0.5, 0, yT1Top - 0.15, 0, PAL.bandCap));
    curtainTier(walls, glassLit, yT1Top, t2F, W2, D2, 0x2a2e34, isLit);
    walls.push(boxAt(W2 + 0.5, 0.30, D2 + 0.5, 0, yT2Top - 0.15, 0, PAL.bandCap));
    curtainTier(walls, glassLit, yT2Top, t3F, W3, D3, 0x2a2e34, isLit);
    walls.push(boxAt(W3 + 0.5, 0.30, D3 + 0.5, 0, yT3Top - 0.15, 0, PAL.bandCap));

    // roof + parapet
    const roofThk = 0.35;
    walls.push(boxAt(W3 + 0.5, roofThk, D3 + 0.5, 0, yT3Top + roofThk / 2, 0, PAL.wallLight));
    const parW = W3 + 0.5, parD = D3 + 0.5, parH = 0.7, parT = 0.20, parY0 = yT3Top + roofThk;
    walls.push(boxAt(parW, parH, parT, 0, parY0 + parH / 2,  parD / 2 - parT / 2, PAL.bandStone));
    walls.push(boxAt(parW, parH, parT, 0, parY0 + parH / 2, -parD / 2 + parT / 2, PAL.bandStone));
    walls.push(boxAt(parT, parH, parD - 2 * parT,  parW / 2 - parT / 2, parY0 + parH / 2, 0, PAL.bandStone));
    walls.push(boxAt(parT, parH, parD - 2 * parT, -parW / 2 + parT / 2, parY0 + parH / 2, 0, PAL.bandStone));

    // mechanical + antenna
    const mechW = 4.5, mechD = 3.5, mechH = 2.8;
    walls.push(boxAt(mechW, mechH, mechD, 0, parY0 + mechH / 2, 0, PAL.wallLight));
    walls.push(boxAt(mechW + 0.30, 0.16, mechD + 0.30, 0, parY0 + mechH + 0.08, 0, PAL.bandCap));
    const antY0 = parY0 + mechH + 0.10, antH = 8.0;
    walls.push(cylY(0.10, 0.14, antH, 0, antY0 + antH / 2, 0, 8, PAL.metalDark));
    walls.push(boxAt(1.0, 0.06, 0.06, 0, antY0 + antH * 0.50, 0, PAL.metalDark));
    walls.push(boxAt(0.70, 0.06, 0.06, 0, antY0 + antH * 0.75, 0, PAL.metalDark));
    walls.push(sphAt(0.18, 0.18, 0.18, 0, antY0 + antH + 0.20, 0, PAL.beacon, 8));

    // plaza
    {
      const pz = D1 / 2 + 4.5, pw = W1 + 6.0, pd = 7.0;
      walls.push(boxAt(pw, 0.06, pd, 0, 0.03, pz, PAL.path));
      for (const sx of [-1, 1]) {
        const bx = sx * (pw / 2 - 2.5), bz = pz - 2.0;
        walls.push(boxAt(2.4, 0.60, 2.4, bx, 0.30, bz, PAL.plinth));
        walls.push(sphAt(0.85, 0.60, 0.85, bx, 0.90, bz, PAL.bush, 10));
      }
    }

    return {
      walls, glassLit, glassDark,
      w: W1 + 0.7, d: D1 + 0.7,
      h: parY0 + mechH + antH + 0.4,
      outerW: W1 + 0.6, outerD: D1 + 0.6,
      entries: [{ x: 0, w: 3.0 }],   // doorW in the builder is 3.0
      interior: { hw: W1 / 2 - 0.3, hd: D1 / 2 + 0.3, floorY: yBase + 0.10 },
    };
  }

  // ============ Lit-hash for windows ============
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

  // ============ Dispatcher ============
  function pickType(distFromCenter, rng) {
    const r = rng();
    if (distFromCenter < 0.28) return r < 0.55 ? 'tower' : 'office';
    if (distFromCenter < 0.58) return r < 0.40 ? 'office' : (r < 0.80 ? 'residential' : 'shop');
    if (distFromCenter < 0.82) return r < 0.50 ? 'residential' : (r < 0.80 ? 'house' : 'rowhouse');
    return r < 0.50 ? 'cottage' : 'house';
  }
  function pickLevel(h) {
    if (h < 8)  return 0;
    if (h < 20) return 1;
    return 2;
  }

  const FACING_YAW = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2, '+z': 0, '+x': Math.PI/2, '-z': Math.PI, '-x': -Math.PI/2 };

  function add(opts) {
    THREE = opts.THREE;
    const { geom, scene, materials, cx, cz, rng, buildings,
            colliders, walkables } = opts;
    if (!THREE || !geom || !scene) throw new Error('MeridianBuildingKit.add: THREE, geom, scene required');
    if (!materials || !materials.solid) throw new Error('MeridianBuildingKit.add: materials.solid required');

    const W_in = opts.w || 12;
    const D_in = opts.d || 10;
    const H_in = opts.h || 20;
    const worldHalf = opts.worldHalf || 290;
    const distFromCenter = Math.hypot(cx, cz) / worldHalf;

    const baseSeed = hashSeed(cx, cz, (opts.seedSalt | 0) || 0x51de77);
    const seedRng = mulberry32(baseSeed);
    const finalType = (opts.type && TYPE_IDS.indexOf(opts.type) >= 0) ? opts.type
                      : pickType(clamp(distFromCenter, 0, 1), seedRng);
    const finalLevel = (typeof opts.level === 'number') ? (opts.level | 0) : pickLevel(H_in);

    const localRng = mulberry32(baseSeed ^ 0x9e3779b1);
    const ratio = (typeof opts.litRatio === 'number') ? opts.litRatio : DEFAULT_LIT_RATIO;
    const paint = pickWallColor(localRng, finalType);

    const builders = {
      cottage:     buildCottage,
      house:       buildHouse,
      rowhouse:    buildRowhouse,
      shop:        buildShop,
      residential: buildResidential,
      office:      buildOffice,
      tower:       buildTower,
    };
    const result = builders[finalType](localRng, W_in, D_in, H_in, paint, ratio);

    const wallGeo = mergeGeometries(result.walls);
    const litGeo  = result.glassLit.length  ? mergeGeometries(result.glassLit)  : null;
    const darkGeo = result.glassDark.length ? mergeGeometries(result.glassDark) : null;

    const yaw = FACING_YAW[opts.facing] || 0;

    const shell = new THREE.Mesh(wallGeo, materials.solid);
    shell.position.set(cx, 0, cz);
    shell.rotation.y = yaw;
    shell.castShadow = true;
    shell.receiveShadow = true;
    shell.userData.buildingType = finalType;
    shell.userData.buildingLevel = finalLevel;
    scene.add(shell);

    let litMesh = null, darkMesh = null;
    if (litGeo && materials.glass) {
      litMesh = new THREE.Mesh(litGeo, materials.glass);
      litMesh.position.set(cx, 0, cz);
      litMesh.rotation.y = yaw;
      litMesh.castShadow = false; litMesh.receiveShadow = false;
      scene.add(litMesh);
    }
    if (darkGeo && materials.glassDark) {
      darkMesh = new THREE.Mesh(darkGeo, materials.glassDark);
      darkMesh.position.set(cx, 0, cz);
      darkMesh.rotation.y = yaw;
      darkMesh.castShadow = false; darkMesh.receiveShadow = false;
      scene.add(darkMesh);
    }

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const swap = Math.abs(sinY) > 0.5;

    if (buildings) {
      // Solid outer AABB — kept for the minimap and the harness, which want
      // one rectangle per building. Collision reads `colliders` instead.
      const hw = (swap ? result.d : result.w) / 2;
      const hd = (swap ? result.w : result.d) / 2;
      buildings.push({ x: cx, z: cz, hw, hd });
    }

    // Collision registration. Builders that declare `entries` (a walk-in
    // doorway on the local +Z face) get a hollow shell of four thin walls
    // with a gap for the door, plus a walkable floor rect for the lobby.
    // Builders without entries register one solid AABB — no interior.
    if (colliders) {
      const oW = result.outerW || result.w;
      const oD = result.outerD || result.d;
      const hwO = oW / 2, hdO = oD / 2;
      const WALL_T = 0.35;

      if (result.entries && result.entries.length) {
        const rects = [];
        rects.push({ x: -hwO + WALL_T / 2, z: 0, hw: WALL_T / 2, hd: hdO });
        rects.push({ x:  hwO - WALL_T / 2, z: 0, hw: WALL_T / 2, hd: hdO });
        rects.push({ x: 0, z: -hdO + WALL_T / 2, hw: hwO, hd: WALL_T / 2 });
        // Collision gap is wider than the visible door: PLAYER_R is 0.5,
        // and the shop door mesh is 1.4 m — 0.4 m of free travel for
        // the body centre is too tight to hit at walking speed.
        const gaps = result.entries
          .map(e => [e.x - e.w / 2 - 0.30, e.x + e.w / 2 + 0.30])
          .sort((a, b) => a[0] - b[0]);
        let cursor = -hwO;
        for (const [a, b] of gaps) {
          const segA = Math.max(cursor, -hwO);
          const segB = Math.min(a,     hwO);
          if (segB > segA) {
            rects.push({ x: (segA + segB) / 2, z: hdO - WALL_T / 2,
                         hw: (segB - segA) / 2, hd: WALL_T / 2 });
          }
          cursor = Math.max(cursor, b);
        }
        if (cursor < hwO) {
          rects.push({ x: (cursor + hwO) / 2, z: hdO - WALL_T / 2,
                       hw: (hwO - cursor) / 2, hd: WALL_T / 2 });
        }
        for (const r of rects) {
          const wx = cx + r.x * cosY + r.z * sinY;
          const wz = cz - r.x * sinY + r.z * cosY;
          colliders.push({ x: wx, z: wz,
                           hw: swap ? r.hd : r.hw,
                           hd: swap ? r.hw : r.hd });
        }
      } else {
        colliders.push({ x: cx, z: cz, hw: hwO, hd: hdO });
      }

      if (result.interior && walkables) {
        const it = result.interior;
        const ix = it.x || 0, iz = it.z || 0;
        const wx = cx + ix * cosY + iz * sinY;
        const wz = cz - ix * sinY + iz * cosY;
        walkables.push({ x: wx, z: wz,
                         hw: swap ? it.hd : it.hw,
                         hd: swap ? it.hw : it.hd,
                         h: it.floorY });
      }
    }

    return { mesh: shell, glassMesh: litMesh, glassDarkMesh: darkMesh,
             type: finalType, level: finalLevel, paint };
  }

  window.MeridianBuildingKit = {
    PAL, TYPE_IDS, DEFAULT_LIT_RATIO,
    pickType, pickLevel, pickWallColor,
    add,
    buildCottage, buildHouse, buildRowhouse, buildShop,
    buildResidential, buildOffice, buildTower,
    FACING_YAW,
    _setThree: t => { THREE = t; },   // для тестов
  };

  /* ---------- viewer.html preview ---------- */
  if (window.MeridianAssets) {
    const BUILDERS = {
      cottage: buildCottage, house: buildHouse, rowhouse: buildRowhouse,
      shop: buildShop, residential: buildResidential,
      office: buildOffice, tower: buildTower,
    };
    // Representative plot per type; each builder clamps to its own range.
    const PREVIEW_HINTS = {
      cottage: [12, 10, 7], house: [13, 11, 9], rowhouse: [14, 10, 8],
      shop: [15, 12, 8], residential: [16, 12, 16], office: [15, 11, 27],
      tower: [13, 9, 40],
    };
    const NOTES = {
      cottage: 'Single-storey detached house.',
      house: 'Two-storey house with a gabled roof.',
      rowhouse: 'Terraced townhouse.',
      shop: 'Three storeys, ground-floor storefront with lobby.',
      residential: 'Mid-rise apartment block.',
      office: 'Eight floors, glass curtain-wall lobby with four lifts.',
      tower: 'Stepped curtain-wall high-rise, three tiers.',
    };
    for (const id of TYPE_IDS) {
      const hints = PREVIEW_HINTS[id];
      MeridianAssets.register({
        id: 'building/' + id,
        label: 'Building — ' + id,
        group: 'Buildings',
        notes: NOTES[id],
        makePreview: function (ctx) {
          THREE = ctx.THREE;    // module-level; read by boxAt/cylY/... via closure
          const rng = mulberry32(hashSeed(1, id.length, 0x5eed));   // fixed seed — stable preview
          const paint = pickWallColor(mulberry32(hashSeed(2, id.length, 0x5eed)), id);
          const res = BUILDERS[id](rng, hints[0], hints[1], hints[2], paint, DEFAULT_LIT_RATIO);
          const group = new THREE.Group();
          const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 });
          const glassMat = new THREE.MeshStandardMaterial({ color: PAL.glass, transparent: true, opacity: 0.45, roughness: 0.15, metalness: 0.3 });
          group.add(new THREE.Mesh(mergeGeometries(res.walls), solidMat));
          const glassParts = res.glassLit.concat(res.glassDark);
          if (glassParts.length) group.add(new THREE.Mesh(mergeGeometries(glassParts), glassMat));
          return group;
        },
      });
    }
  }
})();