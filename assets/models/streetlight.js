/* assets/models/streetlight.js — уличный фонарь.
 *
 * Одна InstancedMesh на весь город: стойка + кронштейн + плафон слиты в
 * один буфер. Не отбрасывает тень — экономит shadow-pass на десятки
 * инстансов; свет от фонарей эмулируется пулом point light'ов в gta.html.
 *
 *   MeridianStreetlightKit.build({ THREE, geom, scene, poles, material });
 *
 * rng не потребляет.
 */
(function () {
  'use strict';

  function makePoleGeometry(THREE, geom) {
    const pole = new THREE.CylinderGeometry(0.12, 0.16, 7, 8);
    pole.translate(0, 3.5, 0);
    const arm = new THREE.BoxGeometry(1.4, 0.16, 0.16);
    arm.translate(0.7, 6.9, 0);
    const head = new THREE.BoxGeometry(0.7, 0.28, 0.34);
    head.translate(1.35, 6.75, 0);
    return geom.mergeGeometries([pole, arm, head]);
  }

  function build(opts) {
    const { THREE, geom, scene, poles, material } = opts;
    const geo = makePoleGeometry(THREE, geom);
    const mesh = new THREE.InstancedMesh(geo, material, poles.length);
    mesh.castShadow = false; mesh.receiveShadow = false;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const Y = new THREE.Vector3(0, 1, 0);

    poles.forEach((sl, i) => {
      const rot = sl.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      q.setFromAxisAngle(Y, rot);
      m.compose(p.set(sl.x, 0, sl.z), q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  window.MeridianStreetlightKit = { makePoleGeometry, build };

  if (window.MeridianAssets) {
    MeridianAssets.register({
      id: 'scenery/streetlight',
      label: 'Streetlight — instanced pole',
      group: 'Scenery',
      notes: 'InstancedMesh; свет — пул PointLight в gta.html, не здесь.',
      makePreview: function (ctx) {
        const THREE = ctx.THREE, geom = ctx.geom;
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: .55, metalness: .5 });
        const poles = [{ x: -1.6, z: 0, dir: 1 }, { x: 1.6, z: 0, dir: -1 }];
        build({ THREE, geom, scene: group, poles, material: mat });
        return group;
      },
    });
  }
})();
