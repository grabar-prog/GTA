/* assets/models/building.js — процедурное здание.
 *
 * Здание = два Mesh'а:
 *   • shell  — корпус + крышная плита + парапет + надстройки, слитые в один
 *              буфер с vertex colors (один draw call на всё здание);
 *   • glass  — четыре фасада, слитые в один буфер; UV размножены так, чтобы
 *              окно держало реальный шаг ~2.2 м и один ряд на этаж.
 *
 *   MeridianBuildingKit.add({
 *     THREE, geom, scene,
 *     materials: { solid, glass },
 *     cx, cz, w, d, h, rng, buildings,
 *   });
 *
 * Детерминизм: makeShellGeometry() потребляет rng() ровно в том же порядке и
 * количестве, что и старая addBuilding() из gta.html — один draw на цвет
 * корпуса, случайное число надстроек, опциональная антенна. Любое изменение
 * порядка здесь сдвинет rng-поток и перестроит весь город (README.md §4).
 */
(function () {
  'use strict';

  const BODY_HEXES = [0x8a94a2, 0x6f7d8c, 0xb3b9c1, 0x5c6b7a, 0x9aa0a8, 0x7d8894];
  const ROOF_HEX = 0x2c3138;
  const TRIM_HEX = 0x14171d;

  // rng-порядок: один вызов на цвет корпуса, один на число надстроек (1..3),
  // по 5 вызовов на надстройку (bw, bd, bh, bx, bz), один на бросок антенны
  // и по 3 вызова на антенну (h, x, z).
  function makeShellGeometry(THREE, geom, w, d, h, rng) {
    const mergeGeometries = geom.mergeGeometries;
    const solid = [];
    const add = (g, color) => solid.push({ geo: g, color });

    const body = new THREE.BoxGeometry(w, h, d);
    body.translate(0, h / 2, 0);
    add(body, BODY_HEXES[(rng() * BODY_HEXES.length) | 0]);

    const cap = new THREE.BoxGeometry(w + 0.5, 0.4, d + 0.5);
    cap.translate(0, h, 0);
    add(cap, ROOF_HEX);

    const par = (pw, pd, px, pz) => {
      const p = new THREE.BoxGeometry(pw, 1.2, pd);
      p.translate(px, h + 0.6, pz);
      add(p, TRIM_HEX);
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
      add(b, TRIM_HEX);
    }
    if (h > 36 && rng() < 0.7) {
      const ah = 5 + rng() * 6;
      const ax = -w / 2 + 1 + rng() * (w - 2);
      const az = -d / 2 + 1 + rng() * (d - 2);
      const a = new THREE.CylinderGeometry(0.08, 0.14, ah, 6);
      a.translate(ax, h + 5, az);
      add(a, TRIM_HEX);
    }
    return mergeGeometries(solid);
  }

  // UV-размножение — по реальному шагу окна (ww / 8.8) и высоте этажа
  // (floors / 16). Без него текстура растягивается на весь небоскрёб.
  function makeGlassGeometry(THREE, geom, w, d, h) {
    const floors = Math.max(2, Math.round(h / 3.1));
    const winH = Math.max(2, h - 3);
    const wy = h / 2 + 0.5;
    const face = (ww, pos, rotY) => {
      const pg = new THREE.PlaneGeometry(ww, winH);
      const uv = pg.attributes.uv.array;
      for (let i = 0; i < uv.length; i += 2) {
        uv[i]   *= ww / 8.8;
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

  function add(opts) {
    const { THREE, geom, scene, materials, cx, cz, w, d, h, rng, buildings } = opts;
    const shellGeo = makeShellGeometry(THREE, geom, w, d, h, rng);
    const glassGeo = makeGlassGeometry(THREE, geom, w, d, h);

    const shell = new THREE.Mesh(shellGeo, materials.solid);
    const glass = new THREE.Mesh(glassGeo, materials.glass);
    shell.position.set(cx, 0, cz);
    shell.castShadow = true; shell.receiveShadow = true;
    glass.position.set(cx, 0, cz);
    scene.add(shell, glass);

    if (buildings) buildings.push({ x: cx, z: cz, hw: w / 2, hd: d / 2 });
    return { shell, glass };
  }

  window.MeridianBuildingKit = {
    BODY_HEXES, ROOF_HEX, TRIM_HEX,
    makeShellGeometry, makeGlassGeometry, add,
  };

  // Регистрация для viewer.html: ряд из пяти зданий разной высоты. Материалы
  // локальные — текстур фасада здесь нет, только emissive-подсветка стёкол.
  if (window.MeridianAssets) {
    MeridianAssets.register({
      id: 'scenery/building',
      label: 'Buildings — shell + glass',
      group: 'Scenery',
      notes: 'Один draw call на здание: shell (vertex colors) + 4 фасада одним буфером.',
      makePreview: function (ctx) {
        const THREE = ctx.THREE, geom = ctx.geom;
        const group = new THREE.Group();
        const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: .04 });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x10171f, emissive: 0xffb86b, emissiveIntensity: 0.35, roughness: .28, metalness: .5 });
        // локальный mulberry32 — превью детерминировано и не трогает игру
        let a = 0x1a2b3c | 0;
        const rng = () => {
          a = a + 0x6D2B79F5 | 0;
          let t = Math.imul(a ^ a >>> 15, 1 | a);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
        const sizes = [[10,10,32],[8,8,20],[12,9,58],[9,9,14],[11,10,44]];
        const gap = 2.2;
        let x = 0;
        for (let i = 0; i < sizes.length; i++) {
          const [w, d, h] = sizes[i];
          const shell = new THREE.Mesh(makeShellGeometry(THREE, geom, w, d, h, rng), solidMat);
          const glass = new THREE.Mesh(makeGlassGeometry(THREE, geom, w, d, h), glassMat);
          shell.position.x = x + w / 2;
          glass.position.x = x + w / 2;
          shell.castShadow = true; shell.receiveShadow = true;
          group.add(shell, glass);
          x += w + gap;
        }
        group.position.x = -x / 2;
        return group;
      },
    });
  }
})();
