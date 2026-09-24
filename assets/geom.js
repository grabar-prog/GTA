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
