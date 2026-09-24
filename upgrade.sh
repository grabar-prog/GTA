#!/usr/bin/env bash
# upgrade.sh — модель на файл + универсальный просмотрщик.
set -euo pipefail

# --- 0. sanity --------------------------------------------------------------
[[ -f assets/pedestrians.js ]] || { echo "run from repo root (assets/pedestrians.js not found)"; exit 1; }
[[ -f assets/main_person.js  ]] || { echo "assets/main_person.js not found";                 exit 1; }
[[ -f game/gta.html          ]] || { echo "game/gta.html not found";                          exit 1; }

BK="assets.bak.$(date +%Y%m%d_%H%M%S)"
cp -r assets "$BK"
echo "backup → $BK"

mkdir -p assets/models

# --- 1. assets/geom.js -----------------------------------------------------
cat > assets/geom.js <<'GEOM_EOF'
/* assets/geom.js — shared geometry sugar.
 *
 * Classic script. THREE is handed in by the caller: gta.html и viewer.html
 * импортят three как ES-модуль, а classic-скрипт соседний модуль через
 * file:// не подтянет. Кит создаётся один раз на страницу и раздаётся всем
 * моделям.
 *
 *   const geom = MeridianGeom.createKit({ THREE });
 *   geom.mergeGeometries([ geom.boxAt(...), { geo: ..., color: 0xff0000 } ]);
 *
 * Часть — либо голый BufferGeometry, либо {geo, color}. Всё сливается в ОДИН
 * буфер с vertex-colors — именно это даёт одной детальной машине один draw call.
 */
(function () {
  'use strict';

  function createKit(opts) {
    const THREE = opts.THREE;
    if (!THREE) throw new Error('MeridianGeom.createKit: THREE is required');
    const _WHITE = new THREE.Color(1, 1, 1);

    function mergeGeometries(parts) {
      const list = parts.map(p => {
        const src = (p && p.geo) || p;
        return { geo: src.index ? src.toNonIndexed() : src, color: p ? p.color : null };
      });
      let total = 0;
      for (const it of list) total += it.geo.attributes.position.count;
      const hasUV = list.every(it => !!it.geo.attributes.uv);
      const pos = new Float32Array(total * 3);
      const nor = new Float32Array(total * 3);
      const col = new Float32Array(total * 3);
      const uv  = hasUV ? new Float32Array(total * 2) : null;
      let off = 0, anyColor = false;
      const tmp = new THREE.Color();
      for (const it of list) {
        const g = it.geo;
        if (!g.attributes.normal) g.computeVertexNormals();
        const n = g.attributes.position.count;
        const c = it.color == null ? _WHITE : tmp.set(it.color);
        pos.set(g.attributes.position.array, off * 3);
        nor.set(g.attributes.normal.array, off * 3);
        if (hasUV) uv.set(g.attributes.uv.array, off * 2);
        for (let i = 0; i < n; i++) {
          const j = (off + i) * 3;
          col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
        }
        if (it.color != null) anyColor = true;
        off += n;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
      if (hasUV)    out.setAttribute('uv',    new THREE.BufferAttribute(uv, 2));
      if (anyColor) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return out;
    }

    function boxAt(w, h, d, x, y, z, color) {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function taperBox(w, h, d, x, y, z, sx, sz, color) {
      const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) { p.setX(i, p.getX(i) * sx); p.setZ(i, p.getZ(i) * sz); }
      }
      p.needsUpdate = true; g.computeVertexNormals(); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function cylX(r, h, x, y, z, seg, color) {
      const g = new THREE.CylinderGeometry(r, r, h, seg || 18);
      g.rotateZ(Math.PI / 2); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function cylZ(r, h, x, y, z, seg, color) {
      const g = new THREE.CylinderGeometry(r, r, h, seg || 14);
      g.rotateX(Math.PI / 2); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function cylY(r, h, x, y, z, color) {
      const g = new THREE.CylinderGeometry(r, r, h, 14); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function sphAt(rx, ry, rz, x, y, z, color, seg) {
      const s = seg || 14;
      const g = new THREE.SphereGeometry(1, s, s - 4);
      g.scale(rx, ry, rz); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function capY(r, l, x, y, z, color) {
      const g = new THREE.CapsuleGeometry(r, l, 4, 12); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function capX(r, l, x, y, z, color) {
      const g = new THREE.CapsuleGeometry(r, l, 4, 12); g.rotateZ(Math.PI / 2); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function capZ(r, l, x, y, z, color) {
      const g = new THREE.CapsuleGeometry(r, l, 4, 12); g.rotateX(Math.PI / 2); g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }
    function ebox(w, h, d, x, y, z, ry, color) {
      const g = new THREE.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      return color == null ? g : { geo: g, color };
    }

    return { THREE, mergeGeometries, boxAt, taperBox,
             cylX, cylY, cylZ, sphAt, capX, capY, capZ, ebox };
  }

  window.MeridianGeom = { createKit };
})();
GEOM_EOF

# --- 2. assets/asset-registry.js ------------------------------------------
cat > assets/asset-registry.js <<'REG_EOF'
/* assets/asset-registry.js — каталог моделей.
 *
 * Каждый model-файл зовёт MeridianAssets.register() один раз при загрузке.
 * assets/viewer.html обходит каталог и строит меню; game/gta.html про каталог
 * не знает — он читает те же модели через их фабрики.
 *
 * Запись:
 *   { id, label, group,
 *     makePreview(ctx) → THREE.Object3D,   // одна показательная инстанция
 *     notes?: string }
 *
 * ctx = { THREE, RoundedBoxGeometry, geom }.
 * rng — свежий mulberry32, если модели понадобится детерминизм.
 */
(function () {
  'use strict';
  const items = [];

  function register(entry) {
    if (!entry || !entry.id || typeof entry.makePreview !== 'function') {
      throw new Error('MeridianAssets.register: id + makePreview required');
    }
    if (items.some(e => e.id === entry.id)) {
      throw new Error('MeridianAssets.register: duplicate id ' + entry.id);
    }
    items.push(entry);
    return entry;
  }
  function list()  { return items.slice(); }
  function get(id) { return items.find(e => e.id === id) || null; }
  function groups() {
    const g = new Map();
    for (const e of items) {
      const k = e.group || 'Other';
      let arr = g.get(k);
      if (!arr) { arr = []; g.set(k, arr); }
      arr.push(e);
    }
    return g;
  }

  window.MeridianAssets = { register, list, get, groups };
})();
REG_EOF

# --- 3. assets/models/car.js ----------------------------------------------
cat > assets/models/car.js <<'CAR_EOF'
/* assets/models/car.js — кузова легковых: sedan, hatch, SUV, pickup, van.
 *
 * Classic-скрипт. Хелперы берутся из assets/geom.js — сам THREE сюда не приходит.
 * Регистрируется в MeridianAssets → viewer.html подхватывает автоматически.
 * game/gta.html читает тот же код через MeridianVehicles.createFactory.
 */
(function () {
  'use strict';

  const CAR_TYPES = [
    { name: 'sedan',  kind: 'car', w: .112, L: 4.5, W: 1.86, h: .62, cz: -.15, cl: 2.0, ch: .5,  taper: [.84, .70], wr: .35 },
    { name: 'hatch',  kind: 'car', w: .112, L: 3.9, W: 1.80, h: .60, cz:  .10, cl: 1.9, ch: .54, taper: [.82, .58], wr: .32 },
    { name: 'suv',    kind: 'car', w: .112, L: 4.7, W: 1.98, h: .72, cz: -.05, cl: 2.4, ch: .62, taper: [.90, .80], wr: .42, rails: true },
    { name: 'pickup', kind: 'car', w: .112, L: 5.2, W: 1.98, h: .68, cz:  .60, cl: 1.7, ch: .58, taper: [.86, .80], wr: .42, bed: true },
    { name: 'van',    kind: 'car', w: .112, L: 5.0, W: 2.00, h: .98, cz: -.10, cl: 2.6, ch: .72, taper: [.93, .90], wr: .38 }
  ];

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

  function makePreview(ctx) {
    const { THREE, geom } = ctx;
    const PAL = { trim: 0x15181d, glass: 0x10171f, dark: 0x23282f, chrome: 0xa9b3bd };
    const PAINT = [0xd23b3b, 0x2f7fd1, 0x2c2f34, 0xf0a526, 0x3fae6a];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .34, metalness: .55 });
    const group = new THREE.Group();
    const gap = 0.9;
    const total = CAR_TYPES.reduce((s, t) => s + t.W, 0) + (CAR_TYPES.length - 1) * gap;
    let x = -total / 2;
    for (let i = 0; i < CAR_TYPES.length; i++) {
      const t = CAR_TYPES[i];
      const m = new THREE.Mesh(makeGeometry(geom, t, PAINT[i % PAINT.length], PAL), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.x = x + t.W / 2;
      x += t.W + gap;
      group.add(m);
    }
    return group;
  }

  window.MeridianCarKit = { CAR_TYPES, makeGeometry };

  MeridianAssets.register({
    id: 'vehicle/car',
    label: 'Car — sedan · hatch · SUV · pickup · van',
    group: 'Vehicles',
    makePreview,
    notes: 'Один merged body на машину; краска — vertex-color, перекраска бесплатна.',
  });
})();
CAR_EOF

# --- 4. assets/models/bus.js ----------------------------------------------
cat > assets/models/bus.js <<'BUS_EOF'
/* assets/models/bus.js — городской и сочленённый автобус.
 *
 * doorSide приходит снаружи, а не выпадает монеткой: rng()-draw остаётся в
 * vehicles.js, где ему и положено быть по контракту детерминизма
 * (methodology/contracts/README.md §4).
 */
(function () {
  'use strict';

  const BUS_TYPES = [
    { name: 'bus',    kind: 'bus', w: .20, L: 12.0, W: 2.55, wr: .52, floorY: .75, roofY: 3.10, bandH: 1.35,
      track: 2.14, axles: [[ 3.4, .52, 1], [-3.6, .52, 1]] },
    { name: 'artbus', kind: 'bus', w: .07, L: 17.5, W: 2.55, wr: .52, floorY: .75, roofY: 3.10, bandH: 1.35, artic: true,
      track: 2.14, axles: [[ 6.6, .52, 1], [-1.4, .52, 1], [-6.6, .52, 1]] }
  ];

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

  function makePreview(ctx) {
    const { THREE, geom } = ctx;
    const PAL = { trim: 0x15181d, glass: 0x10171f, dark: 0x23282f, chrome: 0xa9b3bd,
                  busRoof: 0x9aa3bd, busRib: 0xb4bcc6, busDisplay: 0x14181d };
    const LIVERY = [0xe8e8ea, 0xf0a526];
    const PAINT  = [0x2f7fd1, 0x3fae6a];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .34, metalness: .55 });
    const group = new THREE.Group();
    const gap = 2.0;
    const total = BUS_TYPES.reduce((s, t) => s + t.W, 0) + (BUS_TYPES.length - 1) * gap;
    let x = -total / 2;
    for (let i = 0; i < BUS_TYPES.length; i++) {
      const t = BUS_TYPES[i];
      const m = new THREE.Mesh(makeGeometry(geom, t, PAINT[i], LIVERY[i], 1, PAL), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.x = x + t.W / 2;
      x += t.W + gap;
      group.add(m);
    }
    return group;
  }

  window.MeridianBusKit = { BUS_TYPES, makeGeometry };

  MeridianAssets.register({
    id: 'vehicle/bus',
    label: 'Bus — city · articulated',
    group: 'Vehicles',
    makePreview,
    notes: 'Двери выбираются per-vehicle coin-флипом в vehicles.js, не здесь.',
  });
})();
BUS_EOF

# --- 5. assets/models/semi.js ---------------------------------------------
cat > assets/models/semi.js <<'SEMI_EOF'
/* assets/models/semi.js — евро-фура: дневная кабина + шторный полуприцеп.
 *
 * trGap — зазор бампер→передняя часть прицепа; длина прицепа = L - trGap.
 * Цвет шторы (curt) и краска кабины (paint) приходят снаружи.
 */
(function () {
  'use strict';

  const TRUCK_TYPES = [
    { name: 'semi', kind: 'semi', w: .17, L: 16.4, W: 2.55, wr: .55, cabL: 2.8, trGap: 3.3, trailerW: 2.60,
      trFloor: 1.42, trTop: 4.00, track: 2.05,
      axles: [[ 6.4, .55, 1], [ 2.5, .55, 1.75], [-5.8, .52, 1.75], [-6.9, .52, 1.75]] }
  ];

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
    // Exhaust stack — единственное место, где нужен сам THREE (голый CylinderGeometry
    // с разными радиусами; cylY из geom.js даёт только равные).
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

  function makePreview(ctx) {
    const { THREE, geom } = ctx;
    const PAL = { trim: 0x15181d, glass: 0x10171f, dark: 0x23282f, chrome: 0xa9b3bd,
                  busRoof: 0x9aa3bd, busRib: 0xb4bcc6, marker: 0xd9a94a };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .34, metalness: .55 });
    const m = new THREE.Mesh(makeGeometry(geom, TRUCK_TYPES[0], 0xd23b3b, 0xd8dde3, PAL), mat);
    m.castShadow = true; m.receiveShadow = true;
    const group = new THREE.Group(); group.add(m);
    return group;
  }

  window.MeridianSemiKit = { TRUCK_TYPES, makeGeometry };

  MeridianAssets.register({
    id: 'vehicle/semi',
    label: 'Semi — day cab · curtain-sider',
    group: 'Vehicles',
    makePreview,
  });
})();
SEMI_EOF

# --- 6. assets/models/hero.js — переносим + добавляем регистрацию --------
cp assets/main_person.js assets/models/hero.js
cat >> assets/models/hero.js <<'HERO_APPEND_EOF'

/* --------------------------------------------------------------------------
 * Регистрация для viewer.html. Сам риг уже выставлен на window.MainPerson,
 * так что сюда не нужно ничего из внутреннего scope.
 * ------------------------------------------------------------------------ */
(function () {
  'use strict';
  if (!window.MeridianAssets) return;
  MeridianAssets.register({
    id: 'character/hero',
    label: 'Hero — procedural rig',
    group: 'Characters',
    notes: 'WALKS/RUNS из main_person.js; viewer гоняет hero.update(dt) в idle.',
    makePreview: function (ctx) {
      const hero = MainPerson.createHero({ THREE: ctx.THREE, RoundedBoxGeometry: ctx.RoundedBoxGeometry });
      const wrap = new ctx.THREE.Group();
      wrap.add(hero.group);
      wrap.userData.tick = function (t, dt) { hero.update(dt, { speed: 0, sprint: false }); };
      return wrap;
    },
  });
})();
HERO_APPEND_EOF

# --- 7. assets/models/pedestrian.js — переносим + добавляем регистрацию --
cp assets/pedestrians.js assets/models/pedestrian.js
cat >> assets/models/pedestrian.js <<'PED_APPEND_EOF'

/* --------------------------------------------------------------------------
 * Регистрация для viewer.html. Ставит N пешеходов в ряд, чтобы видеть
 * палитру рубашек/кожи вместе. Всё через window.MeridianPedestrians.
 * ------------------------------------------------------------------------ */
(function () {
  'use strict';
  if (!window.MeridianAssets) return;
  MeridianAssets.register({
    id: 'character/pedestrian',
    label: 'Pedestrian — instanced rig (×5)',
    group: 'Characters',
    notes: 'InstancedMesh; один меш на часть тела, шаг — одна Rx-качалка на конечность.',
    makePreview: function (ctx) {
      const THREE = ctx.THREE, geom = ctx.geom;
      const PED = MeridianPedestrians.createFactory({ THREE: THREE, helpers: geom });
      const N = 5;
      const group = new THREE.Group();
      const rig = PED.createRig(group, N);
      const PAL = PED.palettes, R = PED.RIG;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      const gap = 0.9, x0 = -(N - 1) * gap / 2;
      for (let i = 0; i < N; i++) {
        rig.setColors(i, PAL.shirt[i % PAL.shirt.length], PAL.skin[i % PAL.skin.length]);
        const x = x0 + i * gap;
        rig.torso.setMatrixAt(i, m.compose(p.set(x,               R.hip,      0), q, s));
        rig.head .setMatrixAt(i, m.compose(p.set(x,               R.head,     0), q, s));
        rig.armL .setMatrixAt(i, m.compose(p.set(x - R.shX,       R.shoulder, 0), q, s));
        rig.armR .setMatrixAt(i, m.compose(p.set(x + R.shX,       R.shoulder, 0), q, s));
        rig.legL .setMatrixAt(i, m.compose(p.set(x - R.hipX,      R.hip,      0), q, s));
        rig.legR .setMatrixAt(i, m.compose(p.set(x + R.hipX,      R.hip,      0), q, s));
      }
      rig.commitColors();
      for (const mesh of rig.meshes) mesh.instanceMatrix.needsUpdate = true;
      return group;
    },
  });
})();
PED_APPEND_EOF

# --- 8. assets/vehicles.js — сжимаем до сборщика --------------------------
cat > assets/vehicles.js <<'VEH_EOF'
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
VEH_EOF

# --- 9. assets/viewer.html ------------------------------------------------
cat > assets/viewer.html <<'VIEWER_EOF'
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meridian · просмотрщик ассетов</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0e141c; color: #dfe9f4;
               font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  canvas { display: block; }
  #ui { position: fixed; top: 16px; left: 16px; z-index: 2; display: flex; flex-direction: column;
        gap: 8px; min-width: 260px; user-select: none; }
  #ui h1 { margin: 0 0 4px; font-size: 14px; font-weight: 700; letter-spacing: .16em;
           text-transform: uppercase; color: #5fd0ff; }
  #picker { background: #16202c; color: inherit; border: 1px solid rgba(140,170,200,.24);
            border-radius: 8px; padding: 8px 10px; font: inherit; }
  #notes { font-size: 11.5px; color: #8ea3b8; max-width: 44ch; }
  #hint  { position: fixed; bottom: 12px; right: 16px; font-size: 11.5px; color: #5a8ba8;
           pointer-events: none; }
</style>
</head>
<body>

<div id="ui">
  <h1>Meridian · ассеты</h1>
  <select id="picker"></select>
  <div id="notes"></div>
</div>
<div id="hint">ЛКМ — вращение · колесо — зум · ПКМ — пан</div>

<!-- classic-скрипты: file:// не подтягивает соседние ES-модули -->
<script src="./geom.js"></script>
<script src="./asset-registry.js"></script>
<script src="./models/hero.js"></script>
<script src="./models/pedestrian.js"></script>
<script src="./models/car.js"></script>
<script src="./models/bus.js"></script>
<script src="./models/semi.js"></script>

<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }
}
</script>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ---------- сцена ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e141c);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 500);
camera.position.set(6, 4, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0xdfe9f4, 0x2a2f36, 2.0));
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(5, 8, 6); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { near: 0.5, far: 40, left: -12, right: 12, top: 12, bottom: -12 });
key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0x5fd0ff, 0.6); rim.position.set(-6, 3, -7); scene.add(rim);

const grid = new THREE.GridHelper(40, 40, 0x2a3a4a, 0x1a2530);
grid.material.transparent = true; grid.material.opacity = 0.55;
scene.add(grid);
const catcher = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.35 })
);
catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; scene.add(catcher);

/* ---------- каталог + ctx ---------- */
const geom = MeridianGeom.createKit({ THREE });
const ctx  = { THREE, RoundedBoxGeometry, geom };

const pickerEl = document.getElementById('picker');
const notesEl  = document.getElementById('notes');

let current = null;

function clearCurrent() {
  if (!current) return;
  scene.remove(current);
  current.traverse(o => {
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    if (o.material && o.material.dispose) o.material.dispose();
  });
  current = null;
}

function show(id) {
  clearCurrent();
  const entry = MeridianAssets.get(id);
  if (!entry) return;
  const obj = entry.makePreview(ctx);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(obj);
  current = obj;

  // вписать в кадр
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);
  const dist = maxDim / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.4;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(dist, dist * 0.7, dist));
  controls.update();

  notesEl.textContent = entry.notes || '';
  document.title = 'Meridian · ' + entry.label;
}

/* ---------- меню ---------- */
for (const [gname, items] of MeridianAssets.groups()) {
  const og = document.createElement('optgroup');
  og.label = gname;
  for (const it of items) {
    const op = document.createElement('option');
    op.value = it.id; op.textContent = it.label;
    og.appendChild(op);
  }
  pickerEl.appendChild(og);
}
const all = MeridianAssets.list();
if (all.length) { pickerEl.value = all[0].id; show(all[0].id); }
pickerEl.addEventListener('change', () => show(pickerEl.value));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------- цикл ---------- */
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  const t  = clock.getElapsedTime();
  if (current && current.userData && current.userData.tick) current.userData.tick(t, dt);
  controls.update();
  renderer.render(scene, camera);
});
</script>
</body>
</html>
VIEWER_EOF

# --- 10. game/gta.html — порядок <script> и переход на MeridianGeom -------
python3 - <<'PYEOF'
import re, sys

p = 'game/gta.html'
s = open(p, encoding='utf-8').read()

# 10a. Порядок classic-скриптов
old_scripts = ('<script src="../assets/main_person.js"></script>\n'
               '<script src="../assets/vehicles.js"></script>\n'
               '<script src="../assets/pedestrians.js"></script>')
new_scripts = ('<script src="../assets/geom.js"></script>\n'
               '<script src="../assets/asset-registry.js"></script>\n'
               '<script src="../assets/models/hero.js"></script>\n'
               '<script src="../assets/models/pedestrian.js"></script>\n'
               '<script src="../assets/models/car.js"></script>\n'
               '<script src="../assets/models/bus.js"></script>\n'
               '<script src="../assets/models/semi.js"></script>\n'
               '<script src="../assets/vehicles.js"></script>')
if old_scripts not in s:
    print('WARN: script block not found — update order manually', file=sys.stderr)
else:
    s = s.replace(old_scripts, new_scripts)

# 10b. Заменяем локальные sugar-хелперы на kit из geom.js
start_marker = '/* ---------- geometry helpers (no BufferGeometryUtils in this build) ---------- */'
end_marker   = '/* ---------- constants ---------- */'
i = s.find(start_marker)
j = s.find(end_marker)
if i == -1 or j == -1 or j <= i:
    print('WARN: helper block markers not found — left as-is', file=sys.stderr)
else:
    replacement = (
        '/* ---------- geometry sugar — from assets/geom.js ----------\n'
        ' * boxAt / taperBox / cylX / … теперь живут в assets/geom.js\n'
        ' * (classic-скрипт, подключён выше). Кит создаётся здесь один раз и\n'
        ' * разворачивается деструктуризацией — дальше по файлу имена те же. */\n'
        'const geom = MeridianGeom.createKit({ THREE });\n'
        'const { mergeGeometries, boxAt, taperBox, cylX, cylY, cylZ,\n'
        '        sphAt, capX, capY, capZ, ebox } = geom;\n\n'
    )
    s = s[:i] + replacement + s[j:]

# 10c. createFactory-вызовы: helpers: geom
s = s.replace(
    "const V = MeridianVehicles.createFactory({\n"
    "  THREE,\n"
    "  helpers: { mergeGeometries, boxAt, taperBox, cylX, cylZ },\n"
    "});",
    "const V = MeridianVehicles.createFactory({ THREE, helpers: geom });"
)
s = s.replace(
    "const PED = MeridianPedestrians.createFactory({\n"
    "  THREE,\n"
    "  helpers: { mergeGeometries },\n"
    "});",
    "const PED = MeridianPedestrians.createFactory({ THREE, helpers: geom });"
)

open(p, 'w', encoding='utf-8').write(s)
print('gta.html patched')
PYEOF

# --- 11. удаляем старые файлы (теперь они в models/) ---------------------
rm -f assets/main_person.js assets/pedestrians.js

# --- 12. итог -------------------------------------------------------------
echo
echo "=== Готово. Новое дерево: ==="
find assets -maxdepth 2 -type f | sort
echo
echo "Бэкап: $BK"
echo
echo "Проверка:"
echo "  • откройте assets/viewer.html — в селекторе должны быть все 5 моделей;"
echo "  • откройте game/gta.html    — город и трафик должны работать как раньше."