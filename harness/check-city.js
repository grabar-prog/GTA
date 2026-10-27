/*
 * MERIDIAN CITY — headless smoke test.
 *
 *   npm i puppeteer-core                      # once, anywhere
 *   node harness/check-city.js                # from the repo root; puppeteer-core resolves upward
 *   NODE_PATH=<path>/node_modules node harness/check-city.js [path/to/gta.html]
 *
 * Boots the game in Edge/Chromium (SwiftShader), waits for the loader to hide, then verifies:
 *   · no page/console errors, loader hides, generation time
 *   · camera rig never dips under the asphalt for any pitch
 *   · day/night cycle drives window emission, moon billboard and the streetlight pool
 *   · TRAFFIC STAYS ON THE MAP: cars only use interior road lines 1…GRID-1 (lines 0 and GRID lie
 *     exactly on the border of the ground plane), never drift out of their lane, and wrap around at
 *     ±HALF instead of driving past the last pixel of asphalt.
 *   · LONG VEHICLES (city bus / articulated bus / euro semi-trailer): the fleet really contains them,
 *     every instanced wheel/lens buffer is sized to the mix (no instance left parked at the origin),
 *     and a 17 m body wrapping at ±HALF still stands on ground (|nose| ≤ HALF + GROUND_APRON).
 * JSON report + screenshots go to %TEMP%\meridian-check\ — nothing is written into the repo.
 * Exit code 0 = all checks green.
 *
 * The page surface is window.MERIDIAN (game/gta.html, § "surface for the harness"): every
 * page.evaluate() below opens with `const { … } = MERIDIAN;` and then works with local names.
 * MERIDIAN.dayTime and MERIDIAN.animate are accessors, so they are written through the namespace
 * rather than destructured — a destructure would snapshot the value at module-eval time.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The game lives in game/ since the repo split; resolve it explicitly so a bare
// `node harness/check-city.js` works from any cwd. Override with argv[2].
const HTML = process.argv[2] || path.join(__dirname, '..', 'game', 'gta.html');
const OUT = process.env.OUTDIR || path.join(os.tmpdir(), 'meridian-check');
const SIM_STEPS = 20000;          // × dt 0.05 ≈ 17 min of simulated traffic
const PITCHES = [-1.35, -0.6, 0, 0.6, 1.2];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  const t0 = Date.now();
  await page.goto('file:///' + HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loader').classList.contains('hidden'), { timeout: 90000 });
  const genMs = Date.now() - t0;

  // ---- traffic audit at spawn time ---------------------------------------
  const spawn = await page.evaluate(() => {
    const { cars, GRID, HALF, ROAD, CELL, GROUND_APRON, wheelMesh, headMesh, THREE } = MERIDIAN;
    return {
      cars: cars.length, GRID, HALF, ROAD, CELL,
      linesUsed: [...new Set(cars.map(c => c.lineIdx))].sort((a, b) => a - b),
      onBorderLine: cars.filter(c => c.lineIdx < 1 || c.lineIdx > GRID - 1).length,
      outsideGroundNow: cars.filter(c => Math.abs(c.x) > HALF || Math.abs(c.z) > HALF).length,
      maxCrossAbs: Math.max(...cars.map(c => Math.abs(c.axis === 0 ? c.x : c.z))),
      // distance from the car centre to its own road centreline — must be exactly ROAD/4 (one lane)
      maxLaneOffsetErr: Math.max(...cars.map(c => {
        const cross = c.axis === 0 ? c.x : c.z;
        return Math.abs(Math.abs(cross - (-HALF + c.lineIdx * CELL)) - ROAD / 4);
      })),
      // ---- fleet mix + instanced-buffer sizing ----------------------------
      // A semi rolls on four axles and an articulated bus on three, so a fixed N*4 buffer silently
      // overflows: the extra instances stay identity matrices at the origin (a wheel floating in the
      // sky). An *unwritten* instance always has translation.y === 0, a written one sits at radius.
      APRON: GROUND_APRON,
      // `kind` picks the geometry builder, so both bus bodies share it — count by type name as well
      fleet: (() => { const f = {}; for (const c of cars) f[c.type.name] = (f[c.type.name] || 0) + 1; return f; })(),
      kinds: (() => { const f = {}; for (const c of cars) f[c.kind] = (f[c.kind] || 0) + 1; return f; })(),
      artic: cars.filter(c => c.type.artic).length,
      longest: Math.max(...cars.map(c => c.type.L)),
      wheelsWanted: cars.reduce((s, c) => s + c.wheels.length, 0),
      wheelsCount: wheelMesh.count,
      unwrittenWheels: (() => {
        const m = new THREE.Matrix4(); let n = 0, wi = 0;
        for (const c of cars) {
          for (let k = 0; k < c.wheels.length; k++) {
            if (c.active) { wheelMesh.getMatrixAt(wi, m); if (!(m.elements[13] > 0.2)) n++; }
            wi++;
          }
        }
        return n; })(),
      unwrittenLenses: (() => {
        const m = new THREE.Matrix4(); let n = 0, li = 0;
        for (const c of cars) {
          if (c.active) {
            for (let k = 0; k < c.heads.length; k++) {
              headMesh.getMatrixAt(li, m); if (!(m.elements[13] > 0.2)) n++;
              li++;
            }
          } else {
            li += c.heads.length;
          }
        }
        return n; })(),
      // every body of the fleet must be inside the ground plane + apron right after generation
      maxNoseAbs: Math.max(...cars.map(c => Math.abs(c.axis === 0 ? c.z : c.x) + c.hl)),
      maxSideAbs: Math.max(...cars.map(c => Math.abs(c.axis === 0 ? c.x : c.z) + c.hw)),
    };
  });

  // ---- long pure-logic traffic simulation (no rendering) ------------------
  const sim = await page.evaluate((STEPS) => {
    const { cars, halfX, halfZ, updateCars, updatePeds, HALF } = MERIDIAN;
    let maxTravel = 0, maxCross = 0, wraps = 0, offRoad = 0, stuck = 0, maxNose = 0, maxSide = 0;
    const prevS = new Map(), prevCross = new Map();
    for (const c of cars) { prevS.set(c, c.s); prevCross.set(c, c.axis === 0 ? c.x : c.z); }
    // ---- right-of-way audit ---------------------------------------------------------
    // The rule under test is "first onto the square wins, otherwise the vehicle from the right", and it
    // has to survive minutes of driving, so three things are measured over the whole run: bodies never
    // overlap (perpendicular contacts are exactly what the rule exists to prevent), nobody freezes for
    // good, and a vehicle HELD by a crossing stops before the box it was denied. updatePeds runs next to
    // updateCars - stepping traffic alone leaves the crowd as statues standing in the carriageway, which
    // reads as a phantom gridlock that never happens with the real loop.
    const penOf = (p, q) => {
      const ox = halfX(p) + halfX(q) - Math.abs(p.x - q.x), oz = halfZ(p) + halfZ(q) - Math.abs(p.z - q.z);
      return (ox > 0 && oz > 0) ? Math.min(ox, oz) : 0;
    };
    const tagOf = c => c.type.name + '#' + cars.indexOf(c);
    const FROZEN_S = 25;                        // held longer than this straight is deadlocked, not waiting
    let perpFrames = 0, sameFrames = 0, maxPen = 0, maxPenEv = null;
    let yieldSeconds = 0, heldNoseMax = 0, gridlockAt = -1;
    const stillFor = new Map(), frozenMax = new Map();
    for (const c of cars) { stillFor.set(c, 0); frozenMax.set(c, 0); }
    // C-ROW-6 is about crossing the box face while DENIED. A car granted entry may legally wait inside
    // afterwards (rtc or a hold from a further-past in-box car), where stop < 0 by construction — so mark
    // each box visit at the moment of crossing and only measure cars that crossed with xGo=false.
    const prevKey = new Map(), prevStop = new Map(), crossedDenied = new Map();

    // warm-up: the first wave has to reach the intersections before anything is measured
    for (let w = 0; w < 5000; w++) { updateCars(0.05); updatePeds(0.05, w * 0.05); }

    for (let i = 0; i < STEPS; i++) {
      updateCars(0.05); updatePeds(0.05, 250 + i * 0.05);
      let frozenNow = 0;
      for (const c of cars) {
        const cross = c.axis === 0 ? c.x : c.z, travel = Math.abs(c.axis === 0 ? c.z : c.x);
        if (travel > maxTravel) maxTravel = travel;
        if (Math.abs(cross) > maxCross) maxCross = Math.abs(cross);
        const nose = travel + c.hl, side = Math.abs(cross) + c.hw;
        if (nose > maxNose) maxNose = nose;
        if (side > maxSide) maxSide = side;
        if (Math.abs(cross) > HALF || Math.abs(cross - prevCross.get(c)) > 1e-6) offRoad++;
        const d = c.s - prevS.get(c);
        if (Math.abs(d) > 25) wraps++;
        else if (c.speed < 0.3) stuck++;
        prevS.set(c, c.s); prevCross.set(c, cross);

        // --- right of way: yielding is a decision we want statistics about; crossing the box face while
        // denied is not, so -stop at rest (the nose sits in a square it was not given) is an error.
        if (c.yielding) yieldSeconds += 0.05;
        if (c.xs) {
          const k = c.xs.key;
          if (prevKey.get(c) !== k) { prevKey.set(c, k); prevStop.set(c, null); crossedDenied.set(c, false); }
          else if (!crossedDenied.get(c) && prevStop.get(c) >= 0 && c.xs.stop < 0 && !c.xGo) crossedDenied.set(c, true);
          prevStop.set(c, c.xs.stop);
        } else { prevKey.delete(c); prevStop.delete(c); crossedDenied.delete(c); }
        if (!c.xGo && c.xs && c.speed < 0.2 && crossedDenied.get(c) && -c.xs.stop > heldNoseMax) heldNoseMax = -c.xs.stop;
        if (c.speed < 0.3) {
          stillFor.set(c, stillFor.get(c) + 0.05);
          if (stillFor.get(c) > FROZEN_S) frozenNow++;
          if (stillFor.get(c) > frozenMax.get(c)) frozenMax.set(c, stillFor.get(c));
        } else stillFor.set(c, 0);
      }
      if (gridlockAt < 0 && frozenNow >= 3) gridlockAt = +(i * 0.05).toFixed(1);
      for (let a = 0; a < cars.length; a++) {
        const c = cars[a];
        for (let b = a + 1; b < cars.length; b++) {
          const o = cars[b];
          if (Math.abs(c.x - o.x) > 25 || Math.abs(c.z - o.z) > 25) continue;
          const pen = penOf(c, o);
          if (pen <= 0.05) continue;                       // bodies may pass close, never merge
          if (c.axis !== o.axis) perpFrames++; else sameFrames++;
          if (pen > maxPen) {
            maxPen = pen;
            maxPenEv = { t: +(i * 0.05).toFixed(1), A: tagOf(c), B: tagOf(o), pen: +pen.toFixed(2) };
          }
        }
      }
    }
    return {
      steps: STEPS, simMinutes: +(STEPS * 0.05 / 60).toFixed(1),
      maxTravelAbs: +maxTravel.toFixed(2), maxCrossAbs: +maxCross.toFixed(2),
      maxNoseAbs: +maxNose.toFixed(2), maxSideAbs: +maxSide.toFixed(2),
      wraps, offRoadSamples: offRoad, stuckFraction: +(stuck / (cars.length * STEPS)).toFixed(4),
      perpFrames, sameFrames, maxPen: +maxPen.toFixed(3), maxPenEv,
      yieldSeconds: Math.round(yieldSeconds), heldNoseMax: +heldNoseMax.toFixed(2), gridlockAt,
      deadlockCars: [...frozenMax.values()].filter(v => v > FROZEN_S).length,
    };
  }, SIM_STEPS);

  // ---- camera rig + day/night cycle --------------------------------------
  const cam = await page.evaluate((PITCHES) => {
    const { player, updatePlayer, camera } = MERIDIAN;
    const out = {};
    for (const p of PITCHES) {
      player.pitch = p; updatePlayer(3, 0);
      out[p.toFixed(2)] = +camera.position.y.toFixed(2);
    }
    return out;
  }, PITCHES);

  const cycle = await page.evaluate(() => {
    const { lampLightPool, glassMat, moonMesh, updateCycle } = MERIDIAN;
    const lampsOn = () => lampLightPool.filter(l => l.intensity > 0.01).length;
    MERIDIAN.dayTime = 0.83; updateCycle(0);
    const night = { emissive: +glassMat.emissiveIntensity.toFixed(2), moon: moonMesh.visible, lamps: lampsOn() };
    MERIDIAN.dayTime = 0.42; updateCycle(0);
    const day = { emissive: +glassMat.emissiveIntensity.toFixed(2), moon: moonMesh.visible, lamps: lampsOn() };
    return { night, day };
  });

  // ---- screenshots (rAF loop frozen, we drive the renderer ourselves) -----
  await page.evaluate(() => {
    const { updateCycle } = MERIDIAN;
    MERIDIAN.animate = () => {};                                // stop the game loop
    document.getElementById('start').classList.add('hidden');   // no intro panel over the canvas
    document.body.classList.add('playing');
    MERIDIAN.dayTime = 8.5 / 24; updateCycle(0);
  });
  const shoot = async (setup, name) => {
    await page.evaluate(setup);
    await page.screenshot({ path: path.join(OUT, name) });
  };
  await shoot(() => {
    const { player, CELL, HALF, updatePlayer, renderer, scene, camera } = MERIDIAN;
    player.x = CELL * 4 + CELL / 2; player.z = -HALF + CELL * 3; player.yaw = 0; player.pitch = 0.15;
    updatePlayer(3, 0); renderer.render(scene, camera);
  }, 'player-view.png');
  await shoot(() => {
    // standing on the west border road (x=-HALF) looking along it: no traffic belongs there
    const { player, HALF, ROAD, updatePlayer, renderer, scene, camera } = MERIDIAN;
    player.x = -HALF + ROAD / 4; player.z = -40; player.yaw = 0; player.pitch = 0.12;
    updatePlayer(3, 0); renderer.render(scene, camera);
  }, 'west-border-road.png');
  await shoot(() => {
    // tilted top-down over the west edge: every car must sit inside the asphalt square
    const { scene, camera, renderer } = MERIDIAN;
    const fog = scene.fog; scene.fog = null;
    camera.position.set(-250, 175, -140); camera.lookAt(-250, 0, 90);
    renderer.render(scene, camera); scene.fog = fog;
  }, 'topdown-west-edge.png');
  await shoot(() => {
    const { player, CELL, HALF, updatePlayer, renderer, scene, camera, updateCycle } = MERIDIAN;
    MERIDIAN.dayTime = 0.83; updateCycle(0);
    player.x = CELL * 4 + CELL / 2; player.z = -HALF + CELL * 3; player.yaw = 0; player.pitch = 0.15;
    updatePlayer(3, 0); renderer.render(scene, camera);
  }, 'night.png');

  // ---- close-ups of the long vehicles -------------------------------------
  // Park the camera on the kerb beside a live vehicle, three-quarters from behind: that is where
  // curtains/bellows/axles either read as a truck or fall apart. `kind` picks the specimen.
  const shootVehicle = async (what, name) => {
    const found = await page.evaluate((what) => {
      const { cars, updateCycle, camera, scene, renderer } = MERIDIAN;
      const pick = { semi: c => c.kind === 'semi', artic: c => !!c.type.artic, bus: c => c.kind === 'bus' && !c.type.artic };
      const c = cars.find(pick[what]); if (!c) return null;
      MERIDIAN.dayTime = 8.5 / 24; updateCycle(0);
      // local +Z is forward, +X to the right → stand off the kerb side, slightly behind the nose
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), sx = Math.cos(c.yaw), sz = -Math.sin(c.yaw);
      camera.position.set(c.x - fx * c.hl * 1.5 + sx * (c.hw + 6.5), 2.4, c.z - fz * c.hl * 1.5 + sz * (c.hw + 6.5));
      camera.lookAt(c.x, c.kind === 'car' ? 0.9 : 2.0, c.z);
      renderer.render(scene, camera);
      return { name: c.type.name, L: c.type.L, wheels: c.wheels.length };
    }, what);
    if (found) await page.screenshot({ path: path.join(OUT, name) });
    return found;
  };
  const shots = {
    semi: await shootVehicle('semi', 'long-semi.png'),
    artbus: await shootVehicle('artic', 'long-artbus.png'),
    bus: await shootVehicle('bus', 'long-bus.png'),
  };

  // minimap: long vehicles must read as bars, hatchbacks as stubs
  await page.evaluate(() => {
    const { cars, player, drawMinimap } = MERIDIAN;
    const c = cars.find(v => v.kind !== 'car') || cars[0];
    player.x = c.x; player.z = c.z; player.yaw = 0;
    drawMinimap();
  });
  const mmEl = await page.$('#minimap');
  if (mmEl) await mmEl.screenshot({ path: path.join(OUT, 'minimap.png') });

  // draw calls depend on frustum culling → always measure the same fixed viewpoint
  const stats = await page.evaluate(() => {
    const { scene, player, CELL, HALF, updatePlayer, renderer, camera, buildings, trees } = MERIDIAN;
    let meshes = 0; scene.traverse(o => { if (o.isMesh) meshes++; });
    player.x = CELL * 4 + CELL / 2; player.z = -HALF + CELL * 3; player.yaw = 0; player.pitch = 0.15;
    updatePlayer(3, 0); renderer.render(scene, camera);
    const i = renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geoms: i.memory.geometries,
             meshesInScene: meshes, buildings: buildings.length, trees: trees.length };
  });

  // ---- check 24: same-axis overlap after setTrafficMult round-trip --------
  // MERIDIAN_CHECK24_V3
  // Проверяет, что после включения всех машин (setTrafficMult(2.5)) и
  // возврата (1.0) в сцене нет same-axis перекрытий. Cross-axis пары
  // (на перекрёстках) допускаются естественно, они проверяются check 21.
  const reseat = await page.evaluate(() => {
    const { cars, halfX, halfZ, trafficAI } = MERIDIAN;
    // Защита: если surface block не выставил MERIDIAN.trafficAI, check 24
    // должен вернуть понятную ошибку, а не уронить harness с ReferenceError.
    if (!trafficAI) {
      return { error: 'trafficAI not exposed on window.MERIDIAN', atMax: null, backTo1: null };
    }

    const overlapsAfter = (m) => {
      trafficAI.setTrafficMult(m);
      const active = cars.filter(c => c.active);
      let same = 0, cross = 0, maxPen = 0, worst = null;
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const a = active[i], b = active[j];
          const ox = halfX(a) + halfX(b) - Math.abs(a.x - b.x);
          const oz = halfZ(a) + halfZ(b) - Math.abs(a.z - b.z);
          if (ox <= 0 || oz <= 0) continue;
          const pen = Math.min(ox, oz);
          if (a.axis === b.axis) same++; else cross++;
          if (pen > maxPen) {
            maxPen = pen;
            worst = { A: a.id, B: b.id, aAxis: a.axis, bAxis: b.axis,
                      aLine: a.lineIdx, bLine: b.lineIdx, pen: +pen.toFixed(2) };
          }
        }
      }
      return { same, cross, maxPen: +maxPen.toFixed(2), worst,
               activeCount: active.length };
    };

    const before = trafficAI.trafficMult;
    const atMax = overlapsAfter(2.5);
    const backTo1 = overlapsAfter(1.0);
    trafficAI.setTrafficMult(before);
    return { atMax, backTo1 };
  });

  // ---- check 25: lobby camera safety --------------------------------------
  // MERIDIAN_CHECK25
  // Promotes the scratchpad rig that verified the wall and slab pull-in to a permanent check.
  // see methodology/contracts/camera.md#C-CAM-6 (camera side) and
  // methodology/contracts/building-interiors.md#C-INT-2 (lobby = walkable floor + co-located slab).
  // For every lobby a virtual player stands at the lobby centre; the orbit is swept over pitch × yaw ×
  // {walk, sprint} distance exactly like the frame loop, pulled in by the game's own camClearT(). The
  // oracle below is independent of that function: it re-tests the final camera against the raw rects and
  // slabs, so an under-pull (a regression in camBoxT/camSlabT or a dropped registration) fails here instead
  // of reading as "seeing through buildings".
  const lobby = await page.evaluate((PITCHES) => {
    const { walkables, floorSlabs, buildingWalls, parkBlockers, camClearT, CAM_WALL_MARGIN, CAM_MIN_DIST } = MERIDIAN;
    const fail = (msg) => ({ error: msg, lobbies: 0, orphanSlabs: -1, poses: 0, pulledIn: 0, wallHits: 0, slabHits: 0, minCeilClearance: 0 });
    if (!camClearT || typeof CAM_WALL_MARGIN !== 'number' || !Array.isArray(parkBlockers))
      return fail('camClearT / camera constants not exposed on window.MERIDIAN');

    // C-INT-2: floor and slab share one footprint — a lobby is exactly such a pair. Park platforms also sit in
    // walkables but never register a slab, so they are ignored here by construction.
    const lobbies = [];
    let orphanSlabs = 0;
    for (const s of floorSlabs) {
      const w = walkables.find(w => Math.abs(w.x - s.x) < 1e-6 && Math.abs(w.z - s.z) < 1e-6 &&
                                   Math.abs(w.hw - s.hw) < 1e-6 && Math.abs(w.hd - s.hd) < 1e-6);
      if (!w) { orphanSlabs++; continue; }
      lobbies.push({ x: w.x, z: w.z, h: w.h, y: s.y });
    }
    if (!lobbies.length) return fail('no walk-in lobbies found');

    const rects = buildingWalls.concat(parkBlockers);
    // XZ interval of segment P→P+O against an axis-aligned rect — mirrors _rectT in game/gta.html.
    const segRect = (px, pz, ox, oz, cx, cz, hw, hd) => {
      let te = 0, tx = 1;
      if (Math.abs(ox) < 1e-6) { if (Math.abs(px - cx) >= hw) return null; }
      else { const a = (cx - hw - px) / ox, b = (cx + hw - px) / ox; te = Math.max(te, a < b ? a : b); tx = Math.min(tx, a < b ? b : a); if (te > tx) return null; }
      if (Math.abs(oz) < 1e-6) { if (Math.abs(pz - cz) >= hd) return null; }
      else { const a = (cz - hd - pz) / oz, b = (cz + hd - pz) / oz; te = Math.max(te, a < b ? a : b); tx = Math.min(tx, a < b ? b : a); if (te > tx) return null; }
      return [te, tx];
    };

    const m = CAM_WALL_MARGIN;
    // C-CAM-6 accepts one residual regime: where the CAM_MIN_DIST floor wins at extreme pitch, the camera may sit
    // up to +0.25 m above the underside (measured office +0.248 / shop +0.218).
    const SLAB_RESIDUAL = 0.25;   // see methodology/contracts/camera.md#C-CAM-6
    let poses = 0, pulledIn = 0, wallHits = 0, slabHits = 0, minCeilClearance = Infinity, firstHit = null;

    for (let li = 0; li < lobbies.length; li++) {
      const L = lobbies[li];
      const px = L.x, pz = L.z, py = L.h;
      if (L.y - py < minCeilClearance) minCeilClearance = L.y - py;
      // The sweep is ill-posed if the centre stands inside a collider rect — report it, do not count hits.
      for (const r of rects) {
        if (Math.abs(px - r.x) < r.hw && Math.abs(pz - r.z) < r.hd)
          return fail('lobby centre (' + px.toFixed(1) + ', ' + pz.toFixed(1) + ') inside a wall rect');
      }
      for (const pitch of PITCHES) {
        const sp = Math.sin(pitch), cp = Math.cos(pitch);
        if (cp <= 1e-6) continue;   // vertical orbit — the frame loop never runs it
        for (let k = 0; k < 16; k++) {
          const yaw = k * Math.PI / 8;
          // Walk and sprint orbits: pull-in is scale-free only after the min-distance floor, so test both.
          for (const dist of [6.2, 7.4]) {
            const ox = Math.sin(yaw) * dist * cp, oz = Math.cos(yaw) * dist * cp;
            const d2 = Math.max(CAM_MIN_DIST, dist * camClearT(px, pz, ox, oz, py, sp, cp));
            if (d2 < dist - 1e-9) pulledIn++;
            const cx = px + Math.sin(yaw) * d2 * cp;
            const cy = py + Math.max(0.35, 1.9 + d2 * sp);
            const cz = pz + Math.cos(yaw) * d2 * cp;
            poses++;

            // Walls: the segment player→camera must not enter any collider rect before its endpoint.
            for (const r of rects) {
              const iv = segRect(px, pz, cx - px, cz - pz, r.x, r.z, r.hw, r.hd);
              if (iv && iv[0] < 1 - 1e-6) {
                wallHits++;
                if (!firstHit) firstHit = { kind: 'wall', lobby: li, pitch, yaw, dist };
              }
            }
            // Slabs: the sightline head→camera must not cross a slab's margin plane over its footprint —
            // mirrors camSlabT's violation test on the final pose; the min-distance-floor regime is accepted only
            // within C-CAM-6's +0.25 m residual (SLAB_RESIDUAL).
            for (const s of floorSlabs) {
              const planeY = s.y - m;
              if (cy > planeY + 1e-9 && py + 1.4 < planeY) {
                const v = (planeY - (py + 1.4)) / (cy - (py + 1.4));
                const sx2 = px + v * (cx - px), sz2 = pz + v * (cz - pz);
                if (Math.abs(sx2 - s.x) < s.hw && Math.abs(sz2 - s.z) < s.hd) {
                  // Floor-won poses may sit above the margin plane — accepted only within C-CAM-6's residual.
                  const floorWon = d2 <= CAM_MIN_DIST + 1e-9;
                  if (!(floorWon && cy - s.y <= SLAB_RESIDUAL + 1e-6)) {
                    slabHits++;
                    if (!firstHit) firstHit = { kind: 'slab', lobby: li, pitch, yaw, dist };
                  }
                }
              }
            }
          }
        }
      }
    }

    return { lobbies: lobbies.length, orphanSlabs, poses, pulledIn, wallHits, slabHits,
             minCeilClearance: +minCeilClearance.toFixed(2), firstHit };
  }, PITCHES);

  const camYs = Object.values(cam);
  const checks = [
    ['no page errors', errs.length === 0],
    ['generation finished in time (' + genMs + ' ms)', genMs < 30000],
    ['camera stays above the asphalt for every pitch', camYs.every(y => y >= 0.3 && y <= 9)],
    ['night: windows glow, moon visible, lamps pooled on', cycle.night.emissive > 1 && cycle.night.moon && cycle.night.lamps >= 1],
    ['day: no window emission, moon hidden, lamps off', cycle.day.emissive < 0.05 && !cycle.day.moon && cycle.day.lamps === 0],
    ['cars spawn on interior road lines only (1…GRID-1)', spawn.onBorderLine === 0],
    ['no car outside the ground plane at spawn', spawn.outsideGroundNow === 0],
    ['every car sits in its lane (offset = ROAD/4)', spawn.maxLaneOffsetErr < 1e-6],
    ['traffic never leaves its lane over ' + sim.simMinutes + ' min', sim.offRoadSamples === 0],
    ['cross-axis stays inside the map (|' + spawn.HALF + '|, got ' + sim.maxCrossAbs + ')', sim.maxCrossAbs <= spawn.HALF],
    ['wrap happens at the ground border, not beyond it', sim.maxTravelAbs <= spawn.HALF + 1e-6],
    ['traffic keeps moving (stuck fraction < 0.2)', sim.stuckFraction < 0.2],
    ['through traffic still wraps around the map', sim.wraps > 0],
    // ---- long vehicles ---------------------------------------------------------
    ['fleet contains bus + articulated bus + semi (' + JSON.stringify(spawn.fleet) + ')',
      ['bus', 'artbus', 'semi'].every(k => (spawn.fleet[k] || 0) > 0)],
    ['longest body is a real long vehicle (' + spawn.longest + ' m)', spawn.longest >= 16],
    ['wheel buffer sized to the fleet (' + spawn.wheelsWanted + '/' + spawn.wheelsCount + ', unwritten ' + spawn.unwrittenWheels + ')',
      spawn.wheelsWanted === spawn.wheelsCount && spawn.unwrittenWheels === 0],
    ['lens buffers fully written (unwritten ' + spawn.unwrittenLenses + ')', spawn.unwrittenLenses === 0],
    ['wrapping overhang stays on the ground apron (' + sim.maxNoseAbs + ' ≤ ' + (spawn.HALF + spawn.APRON) + ')',
      sim.maxNoseAbs <= spawn.HALF + spawn.APRON + 1e-6],
    ['vehicle side stays inside the map (' + sim.maxSideAbs + ' ≤ ' + spawn.HALF + ')', sim.maxSideAbs <= spawn.HALF],
    ['close-ups of all three long kinds captured', !!(shots.semi && shots.artbus && shots.bus)],
    // ---- right of way at crossings (see the audit above) ------------------------------------
    ['no perpendicular bodies overlap over ' + sim.simMinutes + ' min (' + sim.perpFrames +
      ' contact frames, max penetration ' + sim.maxPen + ' m)', sim.perpFrames === 0],
    ['no vehicle frozen for good (' + sim.deadlockCars + ' deadlocked, gridlock at t=' + sim.gridlockAt + ')',
      sim.deadlockCars === 0 && sim.gridlockAt < 0],
    // C-ROW-6 as amended 2026-10-27: a denied car brakes toward its stop line; if the denial arrives later
    // than its braking distance it may cross the face and rest inside — bounded by v_max^2/(2*dec) from cruise.
    // Worst class (car): 14^2/(2*11) ≈ 8.9 m + one frame of travel at 14 m/s (0.7 m). Anything deeper means a
    // car moved faster than its own braking profile allows — see methodology/contracts/right-of-way.md#C-ROW-6
    ['a denied vehicle rests no deeper than its braking distance allows (worst nose overshoot ' + sim.heldNoseMax + ' m)',
      sim.heldNoseMax <= 9.6],
    // ---- check 24: reseat integrity ----------------------------------------
    // Both axes: same-axis overlaps are the seatAtTail same-lane bug (C-LANE-6);
    // cross-axis overlaps are a perpendicular seat collision, which the earlier
    // `same === 0` assertion did not fail (see `reseat.atMax.cross`). The
    // corresponding invariant for the 20k-step sim is check 21; this branch
    // guards the post-reseat state that the sim does not cover.
    ['no overlap after setTrafficMult round-trip (2.5: same ' + reseat.atMax.same +
      ', cross ' + reseat.atMax.cross +
      '; 1.0: same ' + reseat.backTo1.same +
      ', cross ' + reseat.backTo1.cross +
      '; maxPen ' + reseat.atMax.maxPen + ' m)',
      reseat.atMax.same === 0 && reseat.atMax.cross === 0 &&
      reseat.backTo1.same === 0 && reseat.backTo1.cross === 0],
    // ---- check 25: lobby camera safety (C-CAM-6 / C-INT) -------------------
    ['lobby camera safety: no wall/slab between camera and player (' + (lobby.error ? lobby.error :
      lobby.lobbies + ' lobbies, ' + lobby.poses + ' poses, pulled in ' + lobby.pulledIn +
      ', hits ' + (lobby.wallHits + lobby.slabHits) + ')'),
      !lobby.error && lobby.orphanSlabs === 0 && lobby.minCeilClearance > 1.7 &&
      lobby.wallHits === 0 && lobby.slabHits === 0],
  ];

  console.log(JSON.stringify({ html: HTML, genMs, stats, spawn, sim, cam, cycle, shots, lobby, errs }, null, 2));
  // ANSI colors: 32 = green, 31 = red, 1 = bold, 0 = reset.
  // Respect NO_COLOR (https://no-color.org/) and only colorize when stdout is a TTY,
  // so redirected/piped output stays clean for CI logs.
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code, s) => useColor ? `\x1b[1;${code}m${s}\x1b[0m` : s;
  const GREEN = s => paint(32, s);
  const RED   = s => paint(31, s);

  let ok = true;
  for (const [label, pass] of checks) {
    if (!pass) ok = false;
    console.log((pass ? GREEN('PASS') : RED('FAIL')) + '  ' + label);
  }
  console.log('screenshots -> ' + OUT);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
