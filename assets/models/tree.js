/* assets/models/tree.js — уличное/парковое дерево.
 *
 * Одна инстанс-пара на весь город: trunks + leaves. Геометрия —
 * цилиндр-ствол и низкополигональный icosahedron-крона; цвет кроны
 * задаётся per-instance HSL и слегка варьируется.
 *
 *   MeridianTreeKit.build({ THREE, scene, trees, materials, rng });
 *
 * Детерминизм: 4 rng() на дерево — rand(.75,1.5) для скейла, rng() на
 * поворот, и два rng() на setHSL (hue, lightness). Порядок соответствует
 * старой buildTrees() из gta.html (README.md §4).
 */
(function () {
  'use strict';

  function makeTrunkGeometry(THREE) {
    const g = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 7);
    g.translate(0, 1.1, 0);
    return g;
  }
  function makeLeafGeometry(THREE) {
    const g = new THREE.IcosahedronGeometry(1.5, 0);
    g.scale(1, 1.15, 1);
    g.translate(0, 3.1, 0);
    return g;
  }

  function build(opts) {
    const { THREE, scene, trees, materials, rng } = opts;
    const trunkGeo = makeTrunkGeometry(THREE);
    const leafGeo  = makeLeafGeometry(THREE);

    const trunks = new THREE.InstancedMesh(trunkGeo, materials.trunk, trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo,  materials.leaf,  trees.length);
    trunks.castShadow = true; leaves.castShadow = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const p = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    const Y = new THREE.Vector3(0, 1, 0);

    trees.forEach((t, i) => {
      // Always consume one rng() for scale, whatever the branch. The count
      // per tree stays 1 (scale) + 1 (rotation) + 2 (crown colour) = 4, so
      // adding park trees with explicit hue / scale does not shift the
      // seeded stream for the rest of the city.
      const scVar = rng();
      const sc = (t.scale != null)
        ? t.scale * (0.85 + scVar * 0.30)      // ±15 % jitter around the given scale
        : 0.75 + scVar * 0.75;                 // legacy city tree
      const rot = rng() * Math.PI * 2;
      p.set(t.x, 0, t.z);
      q.setFromAxisAngle(Y, rot);
      s.set(sc, sc, sc);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);

      const cVar1 = rng();                     // two rng() calls either way
      const cVar2 = rng();
      if (t.hue != null) {
        // Per-tree hex colour (sakura pink, autumn red, anything). Small
        // per-instance lightness jitter so a grove of sakura does not read
        // as one flat slab of pink.
        col.setHex(t.hue);
        col.offsetHSL((cVar1 - 0.5) * 0.02, 0, (cVar2 - 0.5) * 0.08);
      } else {
        col.setHSL(0.28 + cVar1 * 0.06, 0.45, 0.32 + cVar2 * 0.12);
      }
      leaves.setColorAt(i, col);
    });

    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

    scene.add(trunks, leaves);
    return { trunks, leaves };
  }

  window.MeridianTreeKit = { makeTrunkGeometry, makeLeafGeometry, build };

  if (window.MeridianAssets) {
    MeridianAssets.register({
      id: 'scenery/tree',
      label: 'Trees — instanced row',
      group: 'Scenery',
      notes: 'InstancedMesh на ствол и крону; цвет кроны — per-instance HSL.',
      makePreview: function (ctx) {
        const THREE = ctx.THREE;
        const group = new THREE.Group();
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
        const leafMat  = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, flatShading: true });
        let a = 0x99aa77 | 0;
        const rng = () => {
          a = a + 0x6D2B79F5 | 0;
          let t = Math.imul(a ^ a >>> 15, 1 | a);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
        const N = 8, gap = 2.6;
        const trees = [];
        for (let i = 0; i < N; i++) trees.push({ x: (i - (N - 1) / 2) * gap, z: 0 });
        build({ THREE, scene: group, trees, materials: { trunk: trunkMat, leaf: leafMat }, rng });
        return group;
      },
    });
  }
})();
