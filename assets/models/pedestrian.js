/* assets/models/pedestrian.js — procedural pedestrian rig.
 *
 * Восемь архетипов: две пары мужчин, две пары женщин, двое мальчиков,
 * две девочки. Внутри каждой пары — разная комплекция и причёска. Общая
 * геометрия на часть тела остаётся одна (InstancedMesh); различие тел
 * достигается per-instance scale в матрице.
 *
 *   const PED = MeridianPedestrians.createFactory({ THREE, helpers });
 *   const rig = PED.createRig(scene, 54);
 *   for (let i = 0; i < 54; i++) {
 *     rig.setInstance(i, i % PED.archetypes.length, shirt, skin);
 *   }
 *   rig.commitColors();
 *   // затем каждый кадр:
 *   rig.writeFigure(i, rig.instanceData[i], worldX, worldZ, { swing, bob });
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
 * Тело (14 InstancedMesh):
 *   torso:  chest + hips             — лате, раздельно масштабируются по XY;
 *   head:   сфера + запечённые глаза и нос;
 *   hair:   двухслойная оболочка (внешняя + внутренняя с обратным обходом);
 *   руки:   upperArm + foreArm + hand (плечо/локоть/кисть);
 *   ноги:   thigh + shin (бедро/колено, ступня запечена в shin).
 *
 * Единицы: метры, ступни на Y=0, +Y вверх, +Z вперёд. Взрослый ~1.8 м,
 * младший ребёнок ~1.3 м.
 * Contract: methodology/contracts/character-anatomy.md C-ANA-1…4.
 */
(function () {
  'use strict';

  /* ============================================================
     RIG constants — пивоты эталонной фигуры ~1.8 м.
     Всё, что дальше, — производные от них и от скейлов архетипа.
     ============================================================ */
  const RIG = Object.freeze({
    hipY: 0.86, shoulderY: 1.32, headY: 1.58,
    hipX: 0.10, shX: 0.22,
    headR: 0.16,
    waistY: 1.04, pelvisBottomY: 0.72,
    upperArmLen: 0.26, foreArmLen: 0.24,
    thighLen: 0.38, shinLen: 0.39,
  });

  // Мутабельно до createFactory(). Индексируется по модулю .length вызывающим.
  const PALETTES = {
    shirt: [0x3a6ea5, 0xd94f4f, 0xe8b23a, 0x4fae7a, 0xb06ad0, 0xe0e0e0, 0x2c2f34, 0xd98a3a],
    skin:  [0xd9a878, 0xc98d5e, 0x8d5a3b, 0xf0c9a5],
  };

  /* ============================================================
     8 ARCHETYPES

     build — [x, y, z] скейл на часть тела:
       chest.y  — «рост» (waist → shoulder/head по вертикали);
       chest.x  — ширина плеч;
       hips.x   — ширина таза; у мужчин шире chest, у женщин — hips.
       leg.y    — длина ног (и, через hipY, высота всей фигуры).

     hair — оболочка волос:
       size[0], size[2] — горизонтальные радиусы в единицах headR (не
                          меньше 1.16, иначе внутренняя стенка проваливается
                          внутрь черепа и её не видно);
       size[1]          — вертикальный радиус, задаёт «длину» причёски;
       offset[1]        — сдвиг центра оболочки по Y, в единицах headR.
                          Компенсация: макушка волос = offset[1] + size[1] ≈
                          1.12…1.16 — на 12–16 % выше макушки головы.
                          Меньше 1.10 — голова просвечивает между полигонами.
       offset[2]        — сдвиг назад, чтобы причёска «сидела» на затылке.

     Правило (size[1] + offset[1]) — инвариант: у коротких стрижек
     (мужчины, мальчики) size[1] ≈ 1.0, значит offset[1] ≈ +0.15;
     у длинных — size[1] ≈ 1.5, offset[1] ≈ −0.4, сумма та же.
     ============================================================ */
  const ARCHETYPES_RAW = [
    { id:'man-stocky', label:'Man · stocky',
      height: 0.96,
      chest: [1.22, 1.02, 1.15], hips: [1.05, 1.00, 1.05],
      arm:   [1.18, 1.02, 1.18], leg:  [1.15, 1.02, 1.15],
      head:  [0.98, 0.98, 0.98],
      hair:  { size:[1.16, 1.00, 1.16], offset:[0,  0.15, -0.02], color: 0x201410 },
      skin:  0xc98d5e, shirt:0x3a6ea5, pants:0x2b313c },

    { id:'man-tall', label:'Man · tall',
      height: 1.10,
      chest: [1.05, 1.08, 0.92], hips: [0.92, 1.05, 0.92],
      arm:   [0.92, 1.05, 0.92], leg:  [0.94, 1.05, 0.94],
      head:  [0.98, 1.00, 0.98],
      hair:  { size:[1.16, 1.08, 1.16], offset:[0,  0.06, -0.02], color: 0x3a2418 },
      skin:  0xd9a878, shirt:0xd94f4f, pants:0x3a3f4a },

    { id:'woman-curvy', label:'Woman · curvy',
      height: 0.97,
      chest: [0.92, 0.98, 1.00], hips: [1.22, 1.00, 1.10],
      arm:   [0.88, 0.98, 0.88], leg:  [1.04, 0.98, 1.02],
      head:  [0.98, 1.00, 0.98],
      hair:  { size:[1.24, 1.55, 1.24], offset:[0, -0.42, -0.08], color: 0xe8c070 },
      skin:  0xe4c0a0, shirt:0x4fae7a, pants:0x2b313c },

    { id:'woman-petite', label:'Woman · petite',
      height: 0.90,
      chest: [0.90, 0.92, 0.90], hips: [1.05, 0.92, 0.95],
      arm:   [0.85, 0.92, 0.85], leg:  [0.92, 0.92, 0.92],
      head:  [1.00, 1.02, 1.00],
      hair:  { size:[1.20, 1.30, 1.20], offset:[0, -0.16, -0.05], color: 0x100a08 },
      skin:  0xa0714a, shirt:0xb06ad0, pants:0x2a3a4a },

    { id:'boy', label:'Boy',
      height: 0.66,
      chest: [0.88, 0.90, 0.88], hips: [0.92, 0.90, 0.90],
      arm:   [0.88, 0.90, 0.88], leg:  [0.90, 0.90, 0.90],
      head:  [1.15, 1.15, 1.15],
      hair:  { size:[1.16, 1.00, 1.16], offset:[0,  0.15, -0.02], color: 0x2a1810 },
      skin:  0xd9a878, shirt:0xe8b23a, pants:0x1a1d22 },

    { id:'boy-teen', label:'Boy · teen',
      height: 0.86,
      chest: [1.00, 0.96, 0.94], hips: [0.95, 0.96, 0.95],
      arm:   [0.96, 0.96, 0.96], leg:  [0.96, 0.96, 0.96],
      head:  [1.06, 1.06, 1.06],
      hair:  { size:[1.16, 1.06, 1.16], offset:[0,  0.08, -0.02], color: 0x1a100a },
      skin:  0xc98d5e, shirt:0xe0e0e0, pants:0x2c2f34 },

    { id:'girl', label:'Girl',
      height: 0.64,
      chest: [0.86, 0.90, 0.86], hips: [0.94, 0.90, 0.90],
      arm:   [0.85, 0.90, 0.85], leg:  [0.90, 0.90, 0.90],
      head:  [1.15, 1.15, 1.15],
      hair:  { size:[1.24, 1.48, 1.24], offset:[0, -0.36, -0.06], color: 0xc06a2a },
      skin:  0xe4c0a0, shirt:0xd94f4f, pants:0x4a3a2a },

    { id:'girl-teen', label:'Girl · teen',
      height: 0.84,
      chest: [0.92, 0.92, 0.90], hips: [1.08, 0.92, 0.95],
      arm:   [0.88, 0.92, 0.88], leg:  [0.94, 0.92, 0.94],
      head:  [1.05, 1.05, 1.05],
      hair:  { size:[1.24, 1.52, 1.24], offset:[0, -0.36, -0.06], color: 0x8a2a10 },
      skin:  0xd9a878, shirt:0x2c2f34, pants:0x2a3a4a },
  ];

  // Разворачиваем пивоты, длины сегментов и мировые скейлы. Вся арифметика —
  // здесь, чтобы updatePeds в gta.html только умножал. `hairTop` гарантирует,
  // что макушка волос минимум на 12 % радиуса выше головы: если size[1]
  // меньше 1.0, offset[1] подтягивается до безопасного уровня.
  function derive(a) {
    const h = a.height;
    const H = RIG.headR;
    const safeTop = 1.12;   // offset[1] + size[1] — минимальная сумма
    const neededOffset = safeTop - a.hair.size[1];
    const hairOffsetY = Math.max(a.hair.offset[1], neededOffset);
    return {
      id: a.id, label: a.label,
      hipY:           RIG.hipY           * h,
      shoulderY:      RIG.shoulderY      * h,
      headY:          RIG.headY          * h,
      waistY:         RIG.waistY         * h,
      pelvisBottomY:  RIG.pelvisBottomY  * h,
      hipX: RIG.hipX * a.chest[0],
      shX:  RIG.shX  * a.chest[0],
      chestScale: a.chest,
      hipsScale:  a.hips,
      headScale:  a.head,
      armScale:   [a.arm[0], a.arm[1] * h, a.arm[2]],
      legScale:   [a.leg[0], a.leg[1] * h, a.leg[2]],
      hairScale: [
        a.hair.size[0] * H * a.head[0],
        a.hair.size[1] * H * a.head[1],
        a.hair.size[2] * H * a.head[2],
      ],
      hairYOff: hairOffsetY * H * a.head[1],
      hairZOff: a.hair.offset[2] * H * a.head[2],
      hairColor: a.hair.color,
      upperArmLen: RIG.upperArmLen * a.arm[1] * h,
      foreArmLen:  RIG.foreArmLen  * a.arm[1] * h,
      thighLen:    RIG.thighLen    * a.leg[1] * h,
      shinLen:     RIG.shinLen     * a.leg[1] * h,
      skin: a.skin, shirt: a.shirt, pants: a.pants,
    };
  }

  const ARCHETYPES = ARCHETYPES_RAW.map(derive);

  /* ============================================================
     GEOMETRY BUILDERS
     Каждая часть имеет origin в своём пивоте и тянется вниз (-Y).
     ============================================================ */

  // Копия геометрии с обратным обходом вершин в каждом треугольнике. После
  // этого computeVertexNormals даёт нормали, смотрящие «внутрь» — то, что
  // нужно для внутренней стенки оболочки волос. Экспортируется наружу как
  // утилита: другим моделям может пригодиться.
  function reversedWinding(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }

  function makeChestGeometry(THREE) {
    // Лате: от waist (y=0) до низа шеи (y=0.38). Ширина задаётся
    // per-instance скейлом по X.
    const pts = [
      new THREE.Vector2(0.00, 0.00),
      new THREE.Vector2(0.11, 0.00),
      new THREE.Vector2(0.13, 0.06),
      new THREE.Vector2(0.15, 0.14),
      new THREE.Vector2(0.17, 0.22),
      new THREE.Vector2(0.19, 0.28),
      new THREE.Vector2(0.17, 0.31),
      new THREE.Vector2(0.12, 0.33),
      new THREE.Vector2(0.075, 0.35),
      new THREE.Vector2(0.075, 0.38),
      new THREE.Vector2(0.00, 0.38),
    ];
    return new THREE.LatheGeometry(pts, 14);
  }
  function makeHipsGeometry(THREE) {
    // Лате: от pelvis bottom (y=0) до waist (y=0.32).
    const pts = [
      new THREE.Vector2(0.00, 0.00),
      new THREE.Vector2(0.10, 0.00),
      new THREE.Vector2(0.14, 0.06),
      new THREE.Vector2(0.15, 0.14),
      new THREE.Vector2(0.14, 0.22),
      new THREE.Vector2(0.12, 0.30),
      new THREE.Vector2(0.11, 0.32),
      new THREE.Vector2(0.00, 0.32),
    ];
    return new THREE.LatheGeometry(pts, 14);
  }
  function makeHeadGeometry(THREE, mergeGeometries) {
    // Сфера + запечённые глаза и нос. Цвета запечены в vertex colors и
    // умножаются на instance skin, поэтому глаза остаются тёмными при любом
    // оттенке кожи.
    const H = RIG.headR;
    const eyeR = H * 0.16;
    return mergeGeometries([
      new THREE.SphereGeometry(H, 16, 14),
      { geo: new THREE.SphereGeometry(eyeR, 6, 5).translate( H * 0.34, H * 0.08, H * 0.94),
        color: 0x080608 },
      { geo: new THREE.SphereGeometry(eyeR, 6, 5).translate(-H * 0.34, H * 0.08, H * 0.94),
        color: 0x080608 },
      { geo: new THREE.ConeGeometry(H * 0.11, H * 0.20, 6).rotateX(Math.PI / 2)
             .translate(0, -H * 0.05, H * 0.95), color: 0xa07a5c },
    ]);
  }
  function makeHairGeometry(THREE, mergeGeometries) {
    // Двухслойная оболочка: внешняя сфера r=1.00 и внутренняя r=0.90 с
    // вывернутыми нормалями. Открытый передний сектор (~65°) оставляет лицо
    // и глаза, сомкнутые кромки дают видимую толщину стенки ~2 см. Без
    // внутреннего слоя с боку причёска выглядит срезанной плёнкой.
    const phiStart    = Math.PI * 0.68;
    const phiLength   = Math.PI * 1.64;
    const thetaStart  = 0;
    const thetaLength = Math.PI * 0.80;
    const outer = new THREE.SphereGeometry(1.00, 24, 18, phiStart, phiLength, thetaStart, thetaLength);
    const inner = new THREE.SphereGeometry(0.90, 24, 18, phiStart, phiLength, thetaStart, thetaLength);
    return mergeGeometries([outer, reversedWinding(inner)]);
  }
  function makeUpperArmGeometry(THREE) {
    const g = new THREE.CapsuleGeometry(0.045, RIG.upperArmLen - 0.09, 4, 10);
    g.translate(0, -RIG.upperArmLen / 2, 0);
    return g;
  }
  function makeForeArmGeometry(THREE) {
    const g = new THREE.CapsuleGeometry(0.038, RIG.foreArmLen - 0.076, 4, 10);
    g.translate(0, -RIG.foreArmLen / 2, 0);
    return g;
  }
  function makeHandGeometry(THREE) {
    return new THREE.SphereGeometry(0.045, 8, 6);
  }
  function makeThighGeometry(THREE) {
    const g = new THREE.CapsuleGeometry(0.075, RIG.thighLen - 0.15, 4, 10);
    g.translate(0, -RIG.thighLen / 2, 0);
    return g;
  }
  function makeShinGeometry(THREE, mergeGeometries) {
    // Голень + запечённая ступня. Ступня — почти чёрный цвет, поэтому
    // рендерится как обувь независимо от цвета штанов.
    return mergeGeometries([
      new THREE.CapsuleGeometry(0.055, RIG.shinLen - 0.11 - 0.06, 4, 10)
        .translate(0, -(RIG.shinLen - 0.06) / 2, 0),
      { geo: new THREE.BoxGeometry(0.11, 0.06, 0.22)
             .translate(0, -RIG.shinLen + 0.03, 0.055), color: 0x1a1c20 },
    ]);
  }

  /* ============================================================
     FACTORY
     ============================================================ */
  function createFactory(opts) {
    const THREE = opts.THREE;
    if (!THREE) throw new Error('MeridianPedestrians.createFactory: THREE is required');
    const H = opts.helpers || {};
    if (typeof H.mergeGeometries !== 'function') {
      throw new Error('MeridianPedestrians.createFactory: helpers.mergeGeometries is required');
    }
    const mergeGeometries = H.mergeGeometries;
    const PAL  = Object.assign({}, PALETTES, opts.palettes || {});
    const ARCH = (opts.archetypes || ARCHETYPES_RAW).map(derive);
    const _col = new THREE.Color();

    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    const X_AXIS = new THREE.Vector3(1, 0, 0);

    function createRig(scene, count) {
      const simpleMat = new THREE.MeshStandardMaterial({ roughness: 0.86 });
      const skinMat   = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
      const clothMat  = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
      // DoubleSide — страховка на случай, если камера заглянет под кромку;
      // в норме двухслойная геометрия волос даёт правильные нормали с обеих
      // сторон без этого.
      const hairMat   = new THREE.MeshStandardMaterial({
        roughness: 0.68, metalness: 0.02, side: THREE.DoubleSide,
      });

      const mk = (geo, mat) => {
        const m = new THREE.InstancedMesh(geo, mat, count);
        m.castShadow = true; m.frustumCulled = false; scene.add(m);
        return m;
      };

      const chest     = mk(makeChestGeometry(THREE),                   simpleMat);
      const hips      = mk(makeHipsGeometry(THREE),                    simpleMat);
      const head      = mk(makeHeadGeometry(THREE, mergeGeometries),   skinMat);
      const hair      = mk(makeHairGeometry(THREE, mergeGeometries),   hairMat);
      const upperArmL = mk(makeUpperArmGeometry(THREE),                simpleMat);
      const upperArmR = mk(makeUpperArmGeometry(THREE),                simpleMat);
      const foreArmL  = mk(makeForeArmGeometry(THREE),                 simpleMat);
      const foreArmR  = mk(makeForeArmGeometry(THREE),                 simpleMat);
      const handL     = mk(makeHandGeometry(THREE),                    simpleMat);
      const handR     = mk(makeHandGeometry(THREE),                    simpleMat);
      const thighL    = mk(makeThighGeometry(THREE),                   simpleMat);
      const thighR    = mk(makeThighGeometry(THREE),                   simpleMat);
      const shinL     = mk(makeShinGeometry(THREE, mergeGeometries),   clothMat);
      const shinR     = mk(makeShinGeometry(THREE, mergeGeometries),   clothMat);

      const meshes = [chest, hips, head, hair,
                      upperArmL, upperArmR, foreArmL, foreArmR,
                      handL, handR, thighL, thighR, shinL, shinR];

      const instanceData = new Array(count);
      const _m  = new THREE.Matrix4(), _q  = new THREE.Quaternion();
      const _qy = new THREE.Quaternion(), _qa = new THREE.Quaternion();
      const _p  = new THREE.Vector3(),   _s  = new THREE.Vector3();
      const _v  = new THREE.Vector3();

      // Единая точка записи: цвета + «стоячая» поза по умолчанию. Viewer
      // полагается на матрицы сразу после setInstance (game всё равно
      // перепишет их каждый кадр через writeFigure).
      function setInstance(i, archIdx, shirt, skin, pants, atX) {
        const A = ARCH[archIdx % ARCH.length] || ARCH[0];
        instanceData[i] = A;
        const x = atX || 0;

        const shirtC = shirt !== undefined ? shirt : A.shirt;
        const skinC  = skin  !== undefined ? skin  : A.skin;
        const pantsC = pants !== undefined ? pants : A.pants;

        chest.setColorAt(i, _col.set(shirtC));
        upperArmL.setColorAt(i, _col);
        upperArmR.setColorAt(i, _col);
        foreArmL.setColorAt(i, _col);
        foreArmR.setColorAt(i, _col);
        handL.setColorAt(i, _col.set(skinC));
        handR.setColorAt(i, _col);
        head.setColorAt(i, _col);
        hips.setColorAt(i, _col.set(pantsC));
        thighL.setColorAt(i, _col);
        thighR.setColorAt(i, _col);
        shinL.setColorAt(i, _col);
        shinR.setColorAt(i, _col);
        hair.setColorAt(i, _col.set(A.hairColor));

        writeFigure(i, A, x, 0, null);
      }

      // Универсальный писатель матриц. Если pose null — фигура стоит в
      // нейтральной позе. Иначе pose.swing (радианы) качает руки и ноги в
      // противофазе, pose.bob (метры) поднимает торс на полшага.
      function writeFigure(i, A, x, z, pose) {
        const swing = pose ? pose.swing : 0;
        const bob   = pose ? pose.bob   : 0;
        const yaw   = pose && pose.yaw !== undefined ? pose.yaw : 0;
        const cosY  = Math.cos(yaw), sinY = Math.sin(yaw);

        // Единый поворот всей фигуры по Y. Позиции конечностей — поворот
        // локальных пивотов вокруг центра фигуры (x, z); их ориентация —
        // общий quaternion _qy, домноженный на Rx-качалку.
        _qy.setFromAxisAngle(Y_AXIS, yaw);

        // Локальный сдвиг (lx, lz) → мировая позиция после поворота по Y.
        // Y-матрица Three.js: [cos 0 sin; 0 1 0; -sin 0 cos].
        const rotXZ = (lx, lz) => ({
          x:  lx * cosY + lz * sinY,
          z: -lx * sinY + lz * cosY,
        });

        // --- torso: chest + hips отдельно ---
        chest.setMatrixAt(i, _m.compose(_p.set(x, A.waistY, z), _qy,
                                        _s.set(A.chestScale[0], A.chestScale[1], A.chestScale[2])));
        hips .setMatrixAt(i, _m.compose(_p.set(x, A.pelvisBottomY, z), _qy,
                                        _s.set(A.hipsScale[0], A.hipsScale[1], A.hipsScale[2])));

        // --- head + hair (hairZOff тоже вращается по Y) ---
        const headWorldY = A.headY + bob * 0.4;
        head.setMatrixAt(i, _m.compose(_p.set(x, headWorldY, z), _qy,
                                       _s.set(A.headScale[0], A.headScale[1], A.headScale[2])));
        const hOff = rotXZ(0, A.hairZOff);
        hair.setMatrixAt(i, _m.compose(_p.set(x + hOff.x, headWorldY + A.hairYOff, z + hOff.z), _qy,
                                       _s.set(A.hairScale[0], A.hairScale[1], A.hairScale[2])));

        // --- arms ---
        const shLY = A.shoulderY, shRY = A.shoulderY;
        const loL = rotXZ(-A.shX, 0), loR = rotXZ(A.shX, 0);
        const shLX = x + loL.x, shLZ = z + loL.z;
        const shRX = x + loR.x, shRZ = z + loR.z;

        _q.setFromAxisAngle(X_AXIS,  swing);
        const qArmL = _qa.copy(_qy).multiply(_q);
        upperArmL.setMatrixAt(i, _m.compose(_p.set(shLX, shLY, shLZ), qArmL,
                                            _s.set(A.armScale[0], A.armScale[1], A.armScale[2])));
        _v.set(0, -A.upperArmLen, 0).applyQuaternion(qArmL);
        const elbLx = shLX + _v.x, elbLy = shLY + _v.y, elbLz = shLZ + _v.z;
        foreArmL.setMatrixAt(i, _m.compose(_p.set(elbLx, elbLy, elbLz), qArmL,
                                           _s.set(A.armScale[0], A.armScale[1], A.armScale[2])));
        _v.set(0, -A.foreArmLen, 0).applyQuaternion(qArmL);
        handL.setMatrixAt(i, _m.compose(_p.set(elbLx + _v.x, elbLy + _v.y, elbLz + _v.z), qArmL,
                                        _s.set(A.armScale[0], A.armScale[1], A.armScale[2])));

        _q.setFromAxisAngle(X_AXIS, -swing);
        const qArmR = _qa.copy(_qy).multiply(_q);
        upperArmR.setMatrixAt(i, _m.compose(_p.set(shRX, shRY, shRZ), qArmR,
                                            _s.set(A.armScale[0], A.armScale[1], A.armScale[2])));
        _v.set(0, -A.upperArmLen, 0).applyQuaternion(qArmR);
        const elbRx = shRX + _v.x, elbRy = shRY + _v.y, elbRz = shRZ + _v.z;
        foreArmR.setMatrixAt(i, _m.compose(_p.set(elbRx, elbRy, elbRz), qArmR,
                                           _s.set(A.armScale[0], A.armScale[1], A.armScale[2])));
        _v.set(0, -A.foreArmLen, 0).applyQuaternion(qArmR);
        handR.setMatrixAt(i, _m.compose(_p.set(elbRx + _v.x, elbRy + _v.y, elbRz + _v.z), qArmR,
                                        _s.set(A.armScale[0], A.armScale[1], A.armScale[2])));

        // --- legs ---
        const loHL = rotXZ(-A.hipX, 0), loHR = rotXZ(A.hipX, 0);
        const hipLX = x + loHL.x, hipLZ = z + loHL.z;
        const hipRX = x + loHR.x, hipRZ = z + loHR.z;
        const hipYBob = A.hipY + bob;

        _q.setFromAxisAngle(X_AXIS, -swing);
        const qLegL = _qa.copy(_qy).multiply(_q);
        thighL.setMatrixAt(i, _m.compose(_p.set(hipLX, hipYBob, hipLZ), qLegL,
                                         _s.set(A.legScale[0], A.legScale[1], A.legScale[2])));
        _v.set(0, -A.thighLen, 0).applyQuaternion(qLegL);
        shinL.setMatrixAt(i, _m.compose(_p.set(hipLX + _v.x, hipYBob + _v.y, hipLZ + _v.z), qLegL,
                                        _s.set(A.legScale[0], A.legScale[1], A.legScale[2])));

        _q.setFromAxisAngle(X_AXIS,  swing);
        const qLegR = _qa.copy(_qy).multiply(_q);
        thighR.setMatrixAt(i, _m.compose(_p.set(hipRX, hipYBob, hipRZ), qLegR,
                                         _s.set(A.legScale[0], A.legScale[1], A.legScale[2])));
        _v.set(0, -A.thighLen, 0).applyQuaternion(qLegR);
        shinR.setMatrixAt(i, _m.compose(_p.set(hipRX + _v.x, hipYBob + _v.y, hipRZ + _v.z), qLegR,
                                        _s.set(A.legScale[0], A.legScale[1], A.legScale[2])));
      }

      function commitColors() {
        for (const m of meshes) {
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          m.instanceMatrix.needsUpdate = true;
        }
      }

      // Back-compat: старый вызов «один архетип для всех». Использует
      // цвета без переопределения палитры архетипа.
      function setColors(i, shirt, skin) { setInstance(i, 0, shirt, skin); }

      return {
        chest, hips, head, hair,
        upperArmL, upperArmR, foreArmL, foreArmR, handL, handR,
        thighL, thighR, shinL, shinR,
        meshes, instanceData,
        archetypes: ARCH,
        setInstance, setColors, commitColors,
        writeFigure,
      };
    }

    return {
      palettes: PAL, RIG,
      archetypes: ARCH,
      createRig,
      makeChestGeometry, makeHipsGeometry, makeHeadGeometry,
      makeHairGeometry, makeUpperArmGeometry, makeForeArmGeometry, makeHandGeometry,
      makeThighGeometry, makeShinGeometry,
      reversedWinding,
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
          undefined, x);
      }
      rig.commitColors();

      let tAcc = 0;
      group.userData.animations = [
        { id: 'static', label: 'Static' },
        { id: 'walk',   label: 'Walk (instanced)' },
      ];
      group.userData.currentAnimation = 'static';
      group.userData.setAnimation = function (id) {
        group.userData.currentAnimation = id;
        if (id === 'static') {
          for (let i = 0; i < N; i++) {
            rig.writeFigure(i, rig.instanceData[i], rows[i].x, 0, null);
          }
          for (const m of rig.meshes) m.instanceMatrix.needsUpdate = true;
        }
      };
      group.userData.tick = function (t, dt) {
        if (group.userData.currentAnimation !== 'walk') return;
        tAcc += dt;
        for (let i = 0; i < N; i++) {
          const sw  = -Math.sin(tAcc * 5 + rows[i].phase) * 0.55;
          const bob = Math.abs(Math.cos(tAcc * 5 + rows[i].phase)) * 0.018;
          rig.writeFigure(i, rig.instanceData[i], rows[i].x, 0, { swing: sw, bob });
        }
        for (const m of rig.meshes) m.instanceMatrix.needsUpdate = true;
      };
      return group;
    },
  });
})();