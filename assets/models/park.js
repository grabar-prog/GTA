/* assets/models/park.js — городской квартал-парк.
 *
 * Заменяет одну ячейку сетки: газон, пруд, дорожка и кольцо деревьев.
 * Деревья НЕ строит — возвращает массив их позиций, чтобы вызывающий сам
 * решил, добавлять ли их в общий список инстансов или рисовать локально.
 *
 *   const treePositions = MeridianParkKit.add({
 *     THREE, scene, cx, cz, size, rng, materials?,
 *   });
 *
 * Детерминизм: 26 итераций, по 2 rng() на каждую (угол, радиус) — как в
 * старой buildPark() из gta.html (README.md §4).
 */
(function () {
  'use strict';

  function makeMaterials(THREE) {
    return {
      lawn: new THREE.MeshStandardMaterial({ color: 0x4c7a3f, roughness: 1 }),
      pond: new THREE.MeshStandardMaterial({ color: 0x2b6a8f, roughness: .15, metalness: .4 }),
      path: new THREE.MeshStandardMaterial({ color: 0xb9a67e, roughness: 1 }),
    };
  }

  function add(opts) {
    const { THREE, scene, cx, cz, size, rng, materials } = opts;
    const M = materials || makeMaterials(THREE);
    const s = size;

    const lawn = new THREE.Mesh(new THREE.BoxGeometry(s, 0.3, s), M.lawn);
    lawn.position.set(cx, 0.15, cz);
    lawn.receiveShadow = true;
    scene.add(lawn);

    const pond = new THREE.Mesh(new THREE.CircleGeometry(s * 0.22, 32), M.pond);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(cx + s * 0.12, 0.32, cz - s * 0.1);
    scene.add(pond);

    const path = new THREE.Mesh(new THREE.RingGeometry(s * 0.3, s * 0.42, 48), M.path);
    path.rotation.x = -Math.PI / 2;
    path.position.set(cx - s * 0.05, 0.31, cz + s * 0.05);
    scene.add(path);

    const trees = [];
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r = s * 0.42 + rng() * (s * 0.48 - s * 0.42);
      trees.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
    }
    return trees;
  }

  window.MeridianParkKit = { makeMaterials, add };

  if (window.MeridianAssets) {
    MeridianAssets.register({
      id: 'scenery/park',
      label: 'Park — lawn + pond + path',
      group: 'Scenery',
      notes: 'Возвращает позиции деревьев; сами деревья строит MeridianTreeKit.',
      makePreview: function (ctx) {
        const THREE = ctx.THREE;
        const group = new THREE.Group();
        let a = 0x55443322 | 0;
        const rng = () => {
          a = a + 0x6D2B79F5 | 0;
          let t = Math.imul(a ^ a >>> 15, 1 | a);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
        const trees = add({ THREE, scene: group, cx: 0, cz: 0, size: 20, rng });
        if (window.MeridianTreeKit) {
          const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
          const leafMat  = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, flatShading: true });
          let b = 0x11223344 | 0;
          const rng2 = () => {
            b = b + 0x6D2B79F5 | 0;
            let t = Math.imul(b ^ b >>> 15, 1 | b);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
          };
          MeridianTreeKit.build({ THREE, scene: group, trees,
                                  materials: { trunk: trunkMat, leaf: leafMat }, rng: rng2 });
        }
        return group;
      },
    });
  }
})();
