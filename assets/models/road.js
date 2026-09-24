/* assets/models/road.js — дорожная инфраструктура.
 *
 * Дорога — это фон + три независимых InstancedMesh:
 *   • buildBackground — та же плоскость с UV-shrunk текстурой (трава + асфальт);
 *   • buildSidewalks  — тротуары с бордюром, шириной SIDEWALK каждая сторона;
 *   • buildMarkings   — осевые штрихи (0.15×3 м, шаг 7 м) и краевые линии;
 *   • buildCrossings  — полосы зебры 0.5×ROAD на каждом перекрёстке.
 *
 * Всё «нарисованное» — реальные метры, поэтому линии резкие на любом
 * расстоянии. Текстура фона при этом может оставаться 1024² — её задача
 * только трава и асфальт, никаких тонких элементов.
 *
 *   MeridianRoadKit.buildAll({
 *     THREE, geom, scene, groundTex,
 *     grid, cell, road, sidewalk, half, apron,
 *   });
 *
 * rng не потребляет — вызывающий сохраняет свою последовательность
 * (contracts/README.md §4).
 */
(function () {
  'use strict';

  // Параметры зебры. Общие для buildCrossings() и buildMarkings() —
  // разметка должна знать, где кончается дорожка перехода, чтобы не
  // рисовать штрихи поверх полос.
  const CROSS_DEPTH = 4.0;   // глубина дорожки перехода вдоль дороги, м
  const CROSS_GAP = 1.2;     // отступ дорожки от края перекрёстка, м

  /* ---------- background: одна плоскость с UV-shrunk ---------- */
  function buildBackground(THREE, scene, groundTex, worldSize, apron) {
    // Апрон вокруг WORLD: крайние дороги «уходят» за карту как языки асфальта.
    const S = worldSize + apron * 2;
    const g = new THREE.PlaneGeometry(S, S);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    // Внутренний WORLD-квадрат (x:±HALF) мапится в [0,1]:
    // uv' = (uv*S - apron) / WORLD.
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) * S - apron) / worldSize, (uv.getY(i) * S - apron) / worldSize);
    }
    uv.needsUpdate = true;
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: groundTex, roughness: .96 }));
    scene.add(m);
    return m;
  }

  /* ---------- sidewalks ---------- */
  // Плита + бордюр слиты в один буфер: бордюр на −X стороне локальной
  // геометрии, поэтому при yaw=0 он смотрит в сторону −X (в сторону дороги,
  // если тротуар справа от вертикальной дороги). Остальные ориентации —
  // через поворот инстанса.
  function makeSidewalkGeometry(THREE, geom, cell, road, sw) {
    const len = cell - road;
    return geom.mergeGeometries([
      { geo: new THREE.BoxGeometry(sw, 0.15, len).translate(0, 0.075, 0), color: 0xb8b0a5 },
      { geo: new THREE.BoxGeometry(0.18, 0.22, len).translate(-sw / 2 + 0.09, 0.11, 0), color: 0x8a8580 },
    ]);
  }

  function buildSidewalks(THREE, geom, scene, grid, cell, road, sw, half) {
    const geo = makeSidewalkGeometry(THREE, geom, cell, road, sw);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });
    const items = [];
    const swOff = road / 2 + sw / 2;

    for (let axis = 0; axis < 2; axis++) {
      // axis 0 — дорога идёт по Z; axis 1 — по X.
      // Только внутренние дороги: k=1..grid-1, краевые линии выходят за HALF.
      for (let k = 1; k <= grid - 1; k++) {
        const lineCoord = -half + k * cell;
        for (let i = 0; i < grid; i++) {
          const segCenter = -half + i * cell + cell / 2;
          for (let side = -1; side <= 1; side += 2) {
            let cx, cz, yaw;
            if (axis === 0) {
              cx = lineCoord + side * swOff;
              cz = segCenter;
              yaw = side > 0 ? 0 : Math.PI;
            } else {
              cx = segCenter;
              cz = lineCoord + side * swOff;
              yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            }
            if (Math.abs(cx) > half - sw / 2 + 0.01) continue;
            if (Math.abs(cz) > half - sw / 2 + 0.01) continue;
            items.push({ x: cx, y: 0, z: cz, yaw });
          }
        }
      }
    }

    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const Y = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      q.setFromAxisAngle(Y, it.yaw);
      m.compose(p.set(it.x, it.y, it.z), q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  /* ---------- markings: dashes + edges ---------- */
  function buildMarkings(THREE, geom, scene, grid, cell, road, half) {
    // Полная длина сегмента между осями соседних перекрёстков.
    const segLen = cell - road;
    // Но рисовать можно только МЕЖДУ зебрами: зебра сидит на расстоянии
    // (BOX + CROSS_GAP + CROSS_DEPTH) от центра перекрёстка, значит от
    // центра сегмента до ближнего края полосы зебры — столько же.
    const BOX = road / 2;
    const paintHalf = Math.max(0, cell / 2 - BOX - CROSS_GAP - CROSS_DEPTH);
    const paintLen  = paintHalf * 2;

    const DASH_LEN = 3;
    const DASH_STEP = 7;                              // штрих 3 м + промежуток 4 м
    // Сколько штрихов влезает в зону рисования, распределяем симметрично
    // относительно центра сегмента.
    const nDash = Math.max(1, Math.floor((paintLen - DASH_LEN) / DASH_STEP) + 1);
    const totalDash = (nDash - 1) * DASH_STEP + DASH_LEN;
    const startOff = -totalDash / 2 + DASH_LEN / 2;

    const dashGeo = new THREE.BoxGeometry(0.15, 0.012, DASH_LEN).translate(0, 0.006, 0);
    // Краевые линии — той же длины, что и общая зона рисования.
    const edgeGeo = new THREE.BoxGeometry(0.15, 0.012, paintLen).translate(0, 0.006, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf0e8d0, roughness: .8 });

    const dashes = [], edges = [];

    for (let axis = 0; axis < 2; axis++) {
      for (let k = 1; k <= grid - 1; k++) {
        const lineCoord = -half + k * cell;
        for (let i = 0; i < grid; i++) {
          const segCenter = -half + i * cell + cell / 2;
          // осевые штрихи
          for (let d = 0; d < nDash; d++) {
            const off = startOff + d * DASH_STEP;
            let x, z, yaw;
            if (axis === 0) { x = lineCoord; z = segCenter + off; yaw = 0; }
            else            { x = segCenter + off; z = lineCoord; yaw = Math.PI / 2; }
            if (Math.abs(x) > half - 1 || Math.abs(z) > half - 1) continue;
            dashes.push({ x, y: 0, z, yaw });
          }
          // краевые линии (сплошные, по обе стороны от осевой)
          for (let side = -1; side <= 1; side += 2) {
            const edgeOff = road / 2 - 0.3;
            let x, z, yaw;
            if (axis === 0) { x = lineCoord + side * edgeOff; z = segCenter; yaw = 0; }
            else            { x = segCenter; z = lineCoord + side * edgeOff; yaw = Math.PI / 2; }
            if (Math.abs(x) > half - 1 || Math.abs(z) > half - 1) continue;
            edges.push({ x, y: 0, z, yaw });
          }
        }
      }
    }

    function makeInstanced(geo, its) {
      const mesh = new THREE.InstancedMesh(geo, mat, its.length);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      const Y = new THREE.Vector3(0, 1, 0);
      its.forEach((it, i) => {
        q.setFromAxisAngle(Y, it.yaw);
        m.compose(p.set(it.x, it.y, it.z), q, s);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      return mesh;
    }
    return {
      dashes: makeInstanced(dashGeo, dashes),
      edges:  makeInstanced(edgeGeo, edges),
    };
  }

  /* ---------- crossings: зебры на 4 подходах к каждому перекрёстку ----------
   Полоса — длинный белый прямоугольник, вытянутый ПОПЕРЁК движения пешехода.
   Пешеход, переходящий вертикальную дорогу (идущую по Z), шагает по X:
     • полоса длинная по Z (глубина перехода), узкая по X (0.5 м);
     • ряды полос укладываются по X с шагом stripeW+gap.
   Для горизонтальной дороги — то же с поворотом на 90°.
   Полосы занимают всю ширину дороги по X (или по Z), дорожка перехода
   глубиной CROSS_DEPTH ставится снаружи перекрёстка на gapFromBox. */
  function buildCrossings(THREE, geom, scene, grid, cell, road, half) {
    const BOX = road / 2;
    const stripeW = 0.5;
    const gap = 0.5;
    const gapFromBox = CROSS_GAP;     // локальный псевдоним: в формулах ниже читается лучше

    // Полоса: узкая по X (0.5), длинная по Z (CROSS_DEPTH).
    // При yaw=0 — готова для перехода через вертикальную дорогу;
    // при yaw=π/2 — для перехода через горизонтальную.
    const geo = new THREE.BoxGeometry(stripeW, 0.012, CROSS_DEPTH).translate(0, 0.006, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf0e8d0, roughness: .8 });

    const N = Math.max(4, Math.floor(road / (stripeW + gap)));   // сколько полос влезает по ширине
    const totalW = N * stripeW + (N - 1) * gap;                  // ширина зебры по дороге
    const startOff = -totalW / 2 + stripeW / 2;                  // центр первой полосы

    const items = [];
    for (let a = 1; a <= grid - 1; a++) {
      for (let b = 1; b <= grid - 1; b++) {
        const xC = -half + a * cell;
        const zC = -half + b * cell;

        // --- переход через вертикальную дорогу (дорога по Z, пешеход по X) ---
        // Ряды полос укладываются по X. Смещение от края перекрёстка — по Z.
        for (let side = -1; side <= 1; side += 2) {
          const z = zC + side * (BOX + gapFromBox + CROSS_DEPTH / 2);
          if (Math.abs(z) > half - 1) continue;
          for (let i = 0; i < N; i++) {
            const x = xC + startOff + i * (stripeW + gap);
            if (Math.abs(x) > half - 1) continue;
            items.push({ x, y: 0, z, yaw: 0 });
          }
        }

        // --- переход через горизонтальную дорогу (дорога по X, пешеход по Z) ---
        // Ряды полос укладываются по Z. Смещение от края перекрёстка — по X.
        for (let side = -1; side <= 1; side += 2) {
          const x = xC + side * (BOX + gapFromBox + CROSS_DEPTH / 2);
          if (Math.abs(x) > half - 1) continue;
          for (let i = 0; i < N; i++) {
            const z = zC + startOff + i * (stripeW + gap);
            if (Math.abs(z) > half - 1) continue;
            items.push({ x, y: 0, z, yaw: Math.PI / 2 });
          }
        }
      }
    }

    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const p = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1);
    const Y = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      q.setFromAxisAngle(Y, it.yaw);
      m.compose(p.set(it.x, it.y, it.z), q, sv);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  /* ---------- единая точка входа ---------- */
  function buildAll(opts) {
    const { THREE, geom, scene, groundTex, grid, cell, road, sidewalk, half, apron } = opts;
    const bg = buildBackground(THREE, scene, groundTex, grid * cell, apron);
    const sw = buildSidewalks(THREE, geom, scene, grid, cell, road, sidewalk, half);
    const mk = buildMarkings(THREE, geom, scene, grid, cell, road, half);
    const cr = buildCrossings(THREE, geom, scene, grid, cell, road, half);
    return { bg, sidewalks: sw, dashes: mk.dashes, edges: mk.edges, crossings: cr };
  }

  window.MeridianRoadKit = {
    buildAll, buildBackground, buildSidewalks, buildMarkings, buildCrossings,
    makeSidewalkGeometry,
  };

  /* ---------- viewer.html preview ---------- */
  if (window.MeridianAssets) {
    MeridianAssets.register({
      id: 'scenery/road',
      label: 'Road — sidewalks · markings · zebra',
      group: 'Scenery',
      notes: 'Тротуары, разметка и зебры — InstancedMesh реальных размеров; фон — плоскость.',
      makePreview: function (ctx) {
        const THREE = ctx.THREE, geom = ctx.geom;
        const group = new THREE.Group();

        // Маленькая сцена: 1 перекрёсток, 3 внутренние дороги.
        const CELL = 30, ROAD = 8, SW = 3.5, HALF = 45, GRID = 3;

        // Фоновая плоскость (без текстуры — только цвет травы + серый асфальт).
        const bg = new THREE.Mesh(
          new THREE.PlaneGeometry(HALF * 2, HALF * 2),
          new THREE.MeshStandardMaterial({ color: 0x3a4638, roughness: 1 })
        );
        bg.rotation.x = -Math.PI / 2;
        bg.receiveShadow = true;
        group.add(bg);

        // Асфальт поверх травы: три дороги вдоль каждой оси.
        const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: .95 });
        for (let k = 0; k < GRID; k++) {
          const c = -HALF + k * CELL + CELL / 2;
          const road1 = new THREE.Mesh(new THREE.BoxGeometry(ROAD, 0.001, HALF * 2), asphaltMat);
          road1.position.set(c, 0.001, 0);
          group.add(road1);
          const road2 = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, 0.001, ROAD), asphaltMat);
          road2.position.set(0, 0.001, c);
          group.add(road2);
        }

        buildSidewalks(THREE, geom, group, GRID, CELL, ROAD, SW, HALF);
        buildMarkings(THREE, geom, group, GRID, CELL, ROAD, HALF);
        buildCrossings(THREE, geom, group, GRID, CELL, ROAD, HALF);
        return group;
      },
    });
  }
})();
