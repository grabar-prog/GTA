/* assets/models/pedestrian.js — procedural pedestrian rig.
 *
 * Восемь архетипов: две пары мужчин, две пары женщин, двое мальчиков,
 * две девочки. Внутри каждой пары — разная комплекция и причёска. Общая
 * геометрия на часть тела остаётся одна (InstancedMesh); различие тел
 * достигается per-instance scale в матрице, а причёска — отдельным
 * InstancedMesh (сфера над головой).
 *
 *   const PED = MeridianPedestrians.createFactory({ THREE, helpers });
 *   const rig = PED.createRig(scene, 54);
 *   for (let i = 0; i < 54; i++) {
 *     rig.setInstance(i, i % PED.archetypes.length, shirt, skin);
 *   }
 *   rig.commitColors();
 *
 * Внимание к регистру: массив архетипов называется `archetypes` на том, что
 * возвращает createFactory() / createRig(), и `ARCHETYPES` (большими) только
 * на window.MeridianPedestrians. Это разные объекты, и `PED.ARCHETYPES`
 * действительно undefined.
 *
 * Детерминизм: createRig() и setInstance() не трогают rng; индекс архетипа
 * задаёт вызывающий (в gta.html это i % archetypes.length — без rng). Порядок
 * rng-обращений в buildPeds() не меняется (contracts/README.md §4).
 *
 * Единицы: метры, ступни на Y=0, +Y вверх, +Z вперёд. Взрослый ~1.8 м,
 * самый младший ребёнок ~1.3 м.
 * Contract: methodology/contracts/character-anatomy.md C-ANA-1…3.
 */
(function () {
  'use strict';

  const RIG = Object.freeze({ hip: .84, shoulder: 1.32, head: 1.58, hipX: .14, shX: .29 });

  const PALETTES = {
    shirt: [0x3a6ea5, 0xd94f4f, 0xe8b23a, 0x4fae7a, 0xb06ad0, 0xe0e0e0, 0x2c2f34, 0xd98a3a],
    skin:  [0xd9a878, 0xc98d5e, 0x8d5a3b, 0xf0c9a5],
  };

  // Восемь архетипов. build — [x, y, z] скейл на часть тела:
  //   torso.y — «рост» (hip → shoulder/head по вертикали);
  //   torso.x — ширина плеч и таза;
  //   leg.y   — длина ног (и, через hipY, высота всей фигуры).
  // hair — сфера над головой: scale относительный (× head-scale архетипа),
  // yOff — сдвиг от центра головы в долях её радиуса.
  const ARCHETYPES_RAW = [
    { id: 'man-stocky', label: 'Man · stocky',
      build: { torso: [1.15, 1.00, 1.15], head: [1.02, 1.02, 1.02],
               arm:   [1.10, 1.00, 1.10], leg:  [1.10, 1.00, 1.10] },
      hair: { scale: [1.03, 0.85, 1.03], yOff:  0.38, color: 0x2a1a12 } },

    { id: 'man-tall', label: 'Man · tall',
      build: { torso: [0.92, 1.08, 0.92], head: [0.98, 1.00, 0.98],
               arm:   [0.92, 1.10, 0.92], leg:  [0.92, 1.10, 0.92] },
      hair: { scale: [1.04, 0.95, 1.04], yOff:  0.24, color: 0x4b2e1e } },

    { id: 'woman-curvy', label: 'Woman · curvy',
      build: { torso: [1.05, 0.96, 1.00], head: [0.96, 0.98, 0.96],
               arm:   [0.90, 0.96, 0.90], leg:  [1.06, 0.96, 1.02] },
      hair: { scale: [1.06, 1.28, 1.06], yOff: -0.20, color: 0xd9b26a } },

    { id: 'woman-petite', label: 'Woman · petite',
      build: { torso: [0.88, 0.90, 0.88], head: [0.94, 0.96, 0.94],
               arm:   [0.85, 0.90, 0.85], leg:  [0.88, 0.90, 0.88] },
      hair: { scale: [1.06, 1.05, 1.06], yOff: -0.05, color: 0x1e1410 } },

    { id: 'boy',  label: 'Boy',
      build: { torso: [0.72, 0.72, 0.72], head: [0.86, 0.86, 0.86],
               arm:   [0.72, 0.72, 0.72], leg:  [0.72, 0.72, 0.72] },
      hair: { scale: [1.05, 0.82, 1.05], yOff:  0.35, color: 0x3a241a } },

    { id: 'boy-teen', label: 'Boy · teen',
      build: { torso: [0.86, 0.86, 0.86], head: [0.94, 0.94, 0.94],
               arm:   [0.86, 0.86, 0.86], leg:  [0.86, 0.86, 0.86] },
      hair: { scale: [1.03, 0.95, 1.03], yOff:  0.20, color: 0x241611 } },

    { id: 'girl', label: 'Girl',
      build: { torso: [0.70, 0.70, 0.70], head: [0.86, 0.86, 0.86],
               arm:   [0.68, 0.70, 0.68], leg:  [0.70, 0.70, 0.70] },
      hair: { scale: [1.06, 1.20, 1.06], yOff: -0.14, color: 0x8a5a30 } },

    { id: 'girl-teen', label: 'Girl · teen',
      build: { torso: [0.84, 0.84, 0.84], head: [0.92, 0.92, 0.92],
               arm:   [0.82, 0.84, 0.82], leg:  [0.84, 0.84, 0.84] },
      hair: { scale: [1.05, 1.10, 1.05], yOff:  0.00, color: 0x7a2f1a } },
  ];

  // Разворачиваем пивоты и hair-scale относительно головы. Вся арифметика —
  // здесь, чтобы updatePeds в gta.html только умножал.
  function derive(a) {
    const b = a.build;
    const hipY      = RIG.hip * b.leg[1];
    const shoulderY = hipY + (RIG.shoulder - RIG.hip) * b.torso[1];
    const headY     = hipY + (RIG.head     - RIG.hip) * b.torso[1];
    const shX       = RIG.shX  * b.torso[0];
    const hipX      = RIG.hipX * b.torso[0];
    const headR     = 0.21;   // базовый радиус сферы головы
    return {
      id: a.id, label: a.label,
      hipY, shoulderY, headY, shX, hipX,
      torsoScale: b.torso.slice(),
      headScale:  b.head.slice(),
      armScale:   b.arm.slice(),
      legScale:   b.leg.slice(),
      hairScale: [
        b.head[0] * a.hair.scale[0],
        b.head[1] * a.hair.scale[1],
        b.head[2] * a.hair.scale[2],
      ],
      hairYOff:  headR * b.head[1] * a.hair.yOff,
      hairColor: a.hair.color,
    };
  }

  const ARCHETYPES = ARCHETYPES_RAW.map(derive);

  function createFactory(opts) {
    const THREE = opts.THREE;
    if (!THREE) throw new Error('MeridianPedestrians.createFactory: THREE is required');
    const H = opts.helpers || {};
    if (typeof H.mergeGeometries !== 'function') {
      throw new Error('MeridianPedestrians.createFactory: helpers.mergeGeometries is required');
    }
    const mergeGeometries = H.mergeGeometries;
    const PAL  = Object.assign({}, PALETTES, opts.palettes || {});
    const ARCH = opts.archetypes || ARCHETYPES;
    const _col = new THREE.Color();

    function makeTorsoGeometry() {
      const g = new THREE.CapsuleGeometry(.27, .36, 4, 12);
      g.translate(0, .18, 0);
      return g;
    }
    function makeHeadGeometry() { return new THREE.SphereGeometry(.21, 12, 10); }
    function makeLegGeometry() {
      return mergeGeometries([
        { geo: new THREE.CapsuleGeometry(.13, .5, 4, 8).translate(0, -.37, 0), color: 0x2b313c },
        { geo: new THREE.BoxGeometry(.2, .13, .36).translate(0, -.75, .07), color: 0x1a1d22 },
      ]);
    }
    function makeArmGeometry() {
      const g = new THREE.CapsuleGeometry(.1, .42, 4, 8);
      g.translate(0, -.31, 0);
      return g;
    }
    function makeHairGeometry() { return new THREE.SphereGeometry(.21, 10, 8); }

    function createRig(scene, count) {
      const shirtMat = new THREE.MeshStandardMaterial({ roughness: .86 });
      const skinMat  = new THREE.MeshStandardMaterial({ roughness: .8 });
      const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });
      const hairMat  = new THREE.MeshStandardMaterial({ roughness: .7 });

      const torso = new THREE.InstancedMesh(makeTorsoGeometry(), shirtMat, count);
      const armL  = new THREE.InstancedMesh(makeArmGeometry(),   shirtMat, count);
      const armR  = new THREE.InstancedMesh(makeArmGeometry(),   shirtMat, count);
      const head  = new THREE.InstancedMesh(makeHeadGeometry(),  skinMat,  count);
      const hair  = new THREE.InstancedMesh(makeHairGeometry(),  hairMat,  count);
      const legL  = new THREE.InstancedMesh(makeLegGeometry(),   clothMat, count);
      const legR  = new THREE.InstancedMesh(makeLegGeometry(),   clothMat, count);
      const meshes = [torso, armL, armR, head, hair, legL, legR];
      for (const m of meshes) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }

      // instanceData[i] хранит развёрнутый архетип инстанса i. gta.html читает
      // его каждый кадр, чтобы взять пивоты и скейлы.
      const instanceData = new Array(count);
      const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
      const _p = new THREE.Vector3(), _s = new THREE.Vector3();

      // «Стоячая» поза: тело и голова — на оси, конечности — со сдвигом по X.
      function writeStanding(i, A, atX, atZ) {
        _q.identity();
        const body = (mesh, y, sc) =>
          mesh.setMatrixAt(i, _m.compose(_p.set(atX, y, atZ), _q, _s.set(sc[0], sc[1], sc[2])));
        body(torso, A.hipY,                A.torsoScale);
        body(head,  A.headY,               A.headScale);
        body(hair,  A.headY + A.hairYOff,  A.hairScale);
        const limb = (mesh, pivX, y, sc) =>
          mesh.setMatrixAt(i, _m.compose(_p.set(atX + pivX, y, atZ), _q, _s.set(sc[0], sc[1], sc[2])));
        limb(armL, -A.shX,  A.shoulderY, A.armScale);
        limb(armR,  A.shX,  A.shoulderY, A.armScale);
        limb(legL, -A.hipX, A.hipY,      A.legScale);
        limb(legR,  A.hipX, A.hipY,      A.legScale);
      }

      function setInstance(i, archetypeIdx, shirt, skin, atX, atZ) {
        const A = ARCH[archetypeIdx % ARCH.length] || ARCH[0];
        instanceData[i] = A;

        torso.setColorAt(i, _col.set(shirt));
        armL.setColorAt(i, _col);
        armR.setColorAt(i, _col);
        head.setColorAt(i, _col.set(skin));
        hair.setColorAt(i, _col.set(A.hairColor));

        writeStanding(i, A, atX || 0, atZ || 0);
      }

      // Back-compat: тот же архетип 0 для всех.
      function setColors(i, shirt, skin) { setInstance(i, 0, shirt, skin); }

      function commitColors() {
        for (const m of meshes) {
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          m.instanceMatrix.needsUpdate = true;
        }
      }

      return {
        torso, head, hair, armL, armR, legL, legR,
        meshes, instanceData,
        archetypes: ARCH,
        setInstance, setColors, commitColors,
      };
    }

    return {
      palettes: PAL, RIG,
      archetypes: ARCH,
      createRig,
      makeTorsoGeometry, makeHeadGeometry, makeLegGeometry, makeArmGeometry, makeHairGeometry,
    };
  }

  window.MeridianPedestrians = {
    createFactory, PALETTES, RIG,
    ARCHETYPES, ARCHETYPES_RAW,
  };
})();

/* --------------------------------------------------------------------------
 * Регистрация для viewer.html. Все восемь архетипов в ряд, лицом к камере.
 * Анимации: static и walk.
 * ------------------------------------------------------------------------ */
(function () {
  'use strict';
  if (!window.MeridianAssets) return;

  MeridianAssets.register({
    id: 'character/pedestrian',
    label: 'Pedestrians — 8 archetypes',
    group: 'Characters',
    notes: 'InstancedMesh; разное тело — через per-instance scale, причёска — отдельный меш.',
    makePreview: function (ctx) {
      const THREE = ctx.THREE, geom = ctx.geom;
      const PED = MeridianPedestrians.createFactory({ THREE: THREE, helpers: geom });

      // N берём из factory-return (archetypes, lowercase). На window-неймспейсе
      // массив называется ARCHETYPES — это разные объекты.
      const N = PED.archetypes.length;
      const group = new THREE.Group();
      const rig = PED.createRig(group, N);
      const PAL = PED.palettes;

      const gap = 0.9, x0 = -(N - 1) * gap / 2;
      const rows = [];
      for (let i = 0; i < N; i++) {
        const x = x0 + i * gap;
        rows.push({ x: x, phase: i * 0.9 });
        rig.setInstance(i, i,
          PAL.shirt[i % PAL.shirt.length],
          PAL.skin [(i + 1) % PAL.skin.length],
          x, 0);
      }
      rig.commitColors();

      const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
      const _p = new THREE.Vector3(), _s = new THREE.Vector3();
      const _X = new THREE.Vector3(1, 0, 0);

      function writeStatic() {
        _q.identity();
        for (let i = 0; i < N; i++) {
          const A = rig.instanceData[i];
          const x = rows[i].x;
          const body = (mesh, y, sc) =>
            mesh.setMatrixAt(i, _m.compose(_p.set(x, y, 0), _q, _s.set(sc[0], sc[1], sc[2])));
          body(rig.torso, A.hipY,               A.torsoScale);
          body(rig.head,  A.headY,              A.headScale);
          body(rig.hair,  A.headY + A.hairYOff, A.hairScale);
          const limb = (mesh, pivX, y, sc) =>
            mesh.setMatrixAt(i, _m.compose(_p.set(x + pivX, y, 0), _q, _s.set(sc[0], sc[1], sc[2])));
          limb(rig.armL, -A.shX,  A.shoulderY, A.armScale);
          limb(rig.armR,  A.shX,  A.shoulderY, A.armScale);
          limb(rig.legL, -A.hipX, A.hipY,      A.legScale);
          limb(rig.legR,  A.hipX, A.hipY,      A.legScale);
        }
        for (const m of rig.meshes) m.instanceMatrix.needsUpdate = true;
      }

      function writeWalk(t) {
        for (let i = 0; i < N; i++) {
          const A = rig.instanceData[i];
          const x = rows[i].x, ph = rows[i].phase;
          const sw  = Math.sin(t * 6 + ph) * 0.7;
          const bob = Math.abs(Math.cos(t * 6 + ph)) * 0.03;
          _q.identity();
          const body = (mesh, y, sc) =>
            mesh.setMatrixAt(i, _m.compose(_p.set(x, y, 0), _q, _s.set(sc[0], sc[1], sc[2])));
          body(rig.torso, A.hipY,               A.torsoScale);
          body(rig.head,  A.headY,              A.headScale);
          body(rig.hair,  A.headY + A.hairYOff, A.hairScale);
          const limb = (mesh, pivX, y, swing, sc) => {
            _q.setFromAxisAngle(_X, swing);
            mesh.setMatrixAt(i, _m.compose(
              _p.set(x + pivX, y + bob, 0), _q, _s.set(sc[0], sc[1], sc[2])));
          };
          limb(rig.armL, -A.shX,  A.shoulderY, -sw, A.armScale);
          limb(rig.armR,  A.shX,  A.shoulderY,  sw, A.armScale);
          limb(rig.legL, -A.hipX, A.hipY,       sw, A.legScale);
          limb(rig.legR,  A.hipX, A.hipY,      -sw, A.legScale);
        }
        for (const m of rig.meshes) m.instanceMatrix.needsUpdate = true;
      }

      writeStatic();
      group.userData.animations = [
        { id: 'static', label: 'Static' },
        { id: 'walk',   label: 'Walk (instanced)' },
      ];
      group.userData.currentAnimation = 'static';
      group.userData.setAnimation = function (id) {
        group.userData.currentAnimation = id;
        if (id === 'static') writeStatic();
      };
      group.userData.tick = function (t /*, dt */) {
        if (group.userData.currentAnimation === 'walk') writeWalk(t);
      };
      return group;
    },
  });
})();
