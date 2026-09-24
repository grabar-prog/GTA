/* assets/pedestrians.js — procedural pedestrian rig.
 *
 * Shared by game/gta.html. Loaded as a CLASSIC script for the same file:// reason as
 * assets/main_person.js: sibling ES-module imports are blocked, classic <script src> is not.
 *
 *   const PED = MeridianPedestrians.createFactory({ THREE, helpers: { mergeGeometries } });
 *   const rig = PED.createRig(scene, 54);          // builds + adds the six InstancedMeshes
 *   for (let i = 0; i < 54; i++) {
 *     rig.setColors(i, shirt, skin);               // one call per walker, inside the caller's rng loop
 *   }
 *   rig.commitColors();
 *
 * Colour contract: PALETTES.shirt / .skin are mutable at load time. Two ways to override:
 *   MeridianPedestrians.PALETTES.shirt = [0x111111, 0x222222];   // before createFactory()
 *   createFactory({ THREE, helpers, palettes: { shirt: [...] } });
 * Per-instance colours are written through InstancedMesh.setColorAt, so overriding the palette
 * before the rig is created is enough — there is no vertex-colour bake and no repaint cost.
 *
 * Determinism: createRig() and setColors() do NOT consume rng; the caller stays in charge of the
 * seeded stream (methodology/contracts/README.md §4). The call pattern above reproduces the
 * original in-line loop's draw order exactly.
 *
 * Units: metres, feet at Y = 0, +Y up, +Z forward. A ~1.8 m walker; crown ≈ 1.79.
 * Contract: methodology/contracts/character-anatomy.md C-ANA-1…3, asset-contract.md C-ASSET-1.
 */
(function () {
  'use strict';

  // Pivot heights of a ~1.8 m walker. Limbs hang from their own pivot so a single Rx() swing
  // animates them (C-ANA-3). `head` is the world Y of the head sphere *centre* — the geometry is
  // built around its own origin, so an instance Y *is* the head centre (C-ANA-2).
  const RIG = Object.freeze({ hip: .84, shoulder: 1.32, head: 1.58, hipX: .14, shX: .29 });

  // Mutable at load time. Arrays are indexed modulo .length by the caller.
  const PALETTES = {
    shirt: [0x3a6ea5, 0xd94f4f, 0xe8b23a, 0x4fae7a, 0xb06ad0, 0xe0e0e0, 0x2c2f34, 0xd98a3a],
    skin:  [0xd9a878, 0xc98d5e, 0x8d5a3b, 0xf0c9a5],
  };

  function createFactory(opts) {
    const THREE = opts.THREE;
    if (!THREE) throw new Error('MeridianPedestrians.createFactory: THREE is required');
    const H = opts.helpers || {};
    if (typeof H.mergeGeometries !== 'function') {
      throw new Error('MeridianPedestrians.createFactory: helpers.mergeGeometries is required');
    }
    const mergeGeometries = H.mergeGeometries;
    // Merge, not replace: an override of { shirt } keeps the default skin palette and vice versa.
    const PAL = Object.assign({}, PALETTES, opts.palettes || {});
    // The instance-colour writer needs its own Color scratch — the caller's is not assumed.
    const _col = new THREE.Color();

    // Root = hips. The capsule tops out at y=1.47 so the head (centre 1.58, r .21) sticks out above
    // it. It used to be (.26,.5)+translate .39 → top 1.78, exactly the crown of the head: the sphere
    // sat *inside* the torso and every walker rendered headless (C-ANA-1).
    function makeTorsoGeometry() {
      const g = new THREE.CapsuleGeometry(.27, .36, 4, 12);
      g.translate(0, .18, 0);
      return g;
    }
    // Centred on its origin → instance Y is the head centre (C-ANA-2). No baked-in offset.
    function makeHeadGeometry() { return new THREE.SphereGeometry(.21, 12, 10); }
    // Trouser + sole, merged — one buffer per leg.
    function makeLegGeometry() {
      return mergeGeometries([
        { geo: new THREE.CapsuleGeometry(.13, .5, 4, 8).translate(0, -.37, 0), color: 0x2b313c },
        { geo: new THREE.BoxGeometry(.2, .13, .36).translate(0, -.75, .07), color: 0x1a1d22 },
      ]);
    }
    // Sleeve capsule hanging from its own shoulder pivot (C-ANA-3).
    function makeArmGeometry() {
      const g = new THREE.CapsuleGeometry(.1, .42, 4, 8);
      g.translate(0, -.31, 0);
      return g;
    }

    function createRig(scene, count) {
      const shirtMat = new THREE.MeshStandardMaterial({ roughness: .86 });   // tinted per instance
      const skinMat  = new THREE.MeshStandardMaterial({ roughness: .8 });    // tinted per instance
      const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });

      const torso = new THREE.InstancedMesh(makeTorsoGeometry(), shirtMat, count);
      const armL  = new THREE.InstancedMesh(makeArmGeometry(),   shirtMat, count);
      const armR  = new THREE.InstancedMesh(makeArmGeometry(),   shirtMat, count);
      const head  = new THREE.InstancedMesh(makeHeadGeometry(),  skinMat,  count);
      const legL  = new THREE.InstancedMesh(makeLegGeometry(),   clothMat, count);
      const legR  = new THREE.InstancedMesh(makeLegGeometry(),   clothMat, count);
      const meshes = [torso, armL, armR, head, legL, legR];
      for (const m of meshes) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }

      // Colour writes are separated from the build so the CALLER keeps the seeded rng draw order:
      // setColors() is called once per walker inside the caller's position loop — one shirt and one
      // skin pick per iteration — and commitColors() flushes once, right before updatePeds starts.
      // setColorAt auto-creates instanceColor; there is no per-frame cost.
      function setColors(i, shirt, skin) {
        torso.setColorAt(i, _col.set(shirt));
        armL.setColorAt(i, _col);
        armR.setColorAt(i, _col);
        head.setColorAt(i, _col.set(skin));
      }
      function commitColors() {
        for (const m of [torso, armL, armR, head]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }

      return { torso, head, armL, armR, legL, legR, meshes, setColors, commitColors };
    }

    return {
      palettes: PAL, RIG, createRig,
      makeTorsoGeometry, makeHeadGeometry, makeLegGeometry, makeArmGeometry,
    };
  }

  window.MeridianPedestrians = { createFactory, PALETTES, RIG };
})();

/* --------------------------------------------------------------------------
 * Регистрация для viewer.html. Ставит N пешеходов в ряд.
 * Анимации: static (rest-pose) и walk (процедурная качалка, как updatePeds).
 * ------------------------------------------------------------------------ */
(function () {
  'use strict';
  if (!window.MeridianAssets) return;

  MeridianAssets.register({
    id: 'character/pedestrian',
    label: 'Pedestrian — instanced rig (×5)',
    group: 'Characters',
    notes: 'InstancedMesh; один меш на часть тела, качание вокруг плеча/бедра.',
    makePreview: function (ctx) {
      const THREE = ctx.THREE, geom = ctx.geom;
      const PED = MeridianPedestrians.createFactory({ THREE: THREE, helpers: geom });
      const N = 5;
      const group = new THREE.Group();
      const rig = PED.createRig(group, N);
      const PAL = PED.palettes, R = PED.RIG;

      // Позиции по X в ряду + фазовые сдвиги, чтобы строй не шагал синхронно.
      const gap = 0.9, x0 = -(N - 1) * gap / 2;
      const rows = [];
      for (let i = 0; i < N; i++) {
        rows.push({ x: x0 + i * gap, phase: i * 1.37 });
        rig.setColors(i, PAL.shirt[i % PAL.shirt.length], PAL.skin[i % PAL.skin.length]);
      }
      rig.commitColors();

      const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
      const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
      const _X = new THREE.Vector3(1, 0, 0);

      // В превью yaw = 0, поэтому rotation вокруг X; локальный pivot уже в матрице.
      function writeLimb(mesh, i, x, pivX, pivY, swing, bob) {
        _q.setFromAxisAngle(_X, swing);
        mesh.setMatrixAt(i, _m.compose(_p.set(x + pivX, pivY + bob, 0), _q, _s));
      }
      function writeStatic() {
        _q.identity();
        for (let i = 0; i < N; i++) {
          const x = rows[i].x;
          rig.torso.setMatrixAt(i, _m.compose(_p.set(x, R.hip,  0), _q, _s));
          rig.head .setMatrixAt(i, _m.compose(_p.set(x, R.head, 0), _q, _s));
          writeLimb(rig.armL, i, x, -R.shX,  R.shoulder,  0, 0);
          writeLimb(rig.armR, i, x,  R.shX,  R.shoulder,  0, 0);
          writeLimb(rig.legL, i, x, -R.hipX, R.hip,       0, 0);
          writeLimb(rig.legR, i, x,  R.hipX, R.hip,       0, 0);
        }
        for (const m of rig.meshes) m.instanceMatrix.needsUpdate = true;
      }
      function writeWalk(t) {
        _q.identity();
        for (let i = 0; i < N; i++) {
          const x = rows[i].x;
          const sw  = Math.sin(t * 6 + rows[i].phase) * 0.7;
          const bob = Math.abs(Math.cos(t * 6 + rows[i].phase)) * 0.03;
          rig.torso.setMatrixAt(i, _m.compose(_p.set(x, R.hip,  0), _q, _s));
          rig.head .setMatrixAt(i, _m.compose(_p.set(x, R.head, 0), _q, _s));
          writeLimb(rig.armL, i, x, -R.shX,  R.shoulder, -sw, bob);
          writeLimb(rig.armR, i, x,  R.shX,  R.shoulder,  sw, bob);
          writeLimb(rig.legL, i, x, -R.hipX, R.hip,       sw, bob);
          writeLimb(rig.legR, i, x,  R.hipX, R.hip,      -sw, bob);
        }
        for (const m of rig.meshes) m.instanceMatrix.needsUpdate = true;
      }

      writeStatic();   // сразу валидная поза, до первого tick

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
