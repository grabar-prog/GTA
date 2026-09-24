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
  const spawn = await page.evaluate(() => ({
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
    // ---- fleet mix + instanced-buffer sizing ------------------------------------
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
    unwrittenWheels: (() => { const m = new THREE.Matrix4(); let n = 0;
      for (let i = 0; i < wheelMesh.count; i++) { wheelMesh.getMatrixAt(i, m); if (!(m.elements[13] > 0.2)) n++; } return n; })(),
    unwrittenLenses: (() => { const m = new THREE.Matrix4(); let n = 0;
      for (let i = 0; i < headMesh.count; i++) { headMesh.getMatrixAt(i, m); if (!(m.elements[13] > 0.2)) n++; } return n; })(),
    // every body of the fleet must be inside the ground plane + apron right after generation
    maxNoseAbs: Math.max(...cars.map(c => Math.abs(c.axis === 0 ? c.z : c.x) + c.hl)),
    maxSideAbs: Math.max(...cars.map(c => Math.abs(c.axis === 0 ? c.x : c.z) + c.hw)),
  }));

  // ---- long pure-logic traffic simulation (no rendering) ------------------
  const sim = await page.evaluate((STEPS) => {
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

        // --- right of way: yielding is a decision we want statistics about; being stuck inside a denied
        // box is not, so -stop > 0 (the nose crossed into a square it was not given) is an error.
        if (c.yielding) yieldSeconds += 0.05;
        if (!c.xGo && c.xs && c.speed < 0.2 && -c.xs.stop > heldNoseMax) heldNoseMax = -c.xs.stop;
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
    const out = {};
    for (const p of PITCHES) {
      player.pitch = p; updatePlayer(3, 0);
      out[p.toFixed(2)] = +camera.position.y.toFixed(2);
    }
    return out;
  }, PITCHES);

  const cycle = await page.evaluate(() => {
    const lampsOn = () => lampLightPool.filter(l => l.visible).length;
    dayTime = 0.83; updateCycle(0);
    const night = { emissive: +glassMat.emissiveIntensity.toFixed(2), moon: moonMesh.visible, lamps: lampsOn() };
    dayTime = 0.42; updateCycle(0);
    const day = { emissive: +glassMat.emissiveIntensity.toFixed(2), moon: moonMesh.visible, lamps: lampsOn() };
    return { night, day };
  });

  // ---- screenshots (rAF loop frozen, we drive the renderer ourselves) -----
  await page.evaluate(() => {
    animate = () => {};                                        // stop the game loop
    document.getElementById('start').classList.add('hidden');   // no intro panel over the canvas
    document.body.classList.add('playing');
    dayTime = 8.5 / 24; updateCycle(0);
  });
  const shoot = async (setup, name) => {
    await page.evaluate(setup);
    await page.screenshot({ path: path.join(OUT, name) });
  };
  await shoot(() => {
    player.x = CELL * 4 + CELL / 2; player.z = -HALF + CELL * 3; player.yaw = 0; player.pitch = 0.15;
    updatePlayer(3, 0); renderer.render(scene, camera);
  }, 'player-view.png');
  await shoot(() => {
    // standing on the west border road (x=-HALF) looking along it: no traffic belongs there
    player.x = -HALF + ROAD / 4; player.z = -40; player.yaw = 0; player.pitch = 0.12;
    updatePlayer(3, 0); renderer.render(scene, camera);
  }, 'west-border-road.png');
  await shoot(() => {
    // tilted top-down over the west edge: every car must sit inside the asphalt square
    const fog = scene.fog; scene.fog = null;
    camera.position.set(-250, 175, -140); camera.lookAt(-250, 0, 90);
    renderer.render(scene, camera); scene.fog = fog;
  }, 'topdown-west-edge.png');
  await shoot(() => {
    dayTime = 0.83; updateCycle(0);
    player.x = CELL * 4 + CELL / 2; player.z = -HALF + CELL * 3; player.yaw = 0; player.pitch = 0.15;
    updatePlayer(3, 0); renderer.render(scene, camera);
  }, 'night.png');

  // ---- close-ups of the long vehicles -------------------------------------
  // Park the camera on the kerb beside a live vehicle, three-quarters from behind: that is where
  // curtains/bellows/axles either read as a truck or fall apart. `kind` picks the specimen.
  const shootVehicle = async (what, name) => {
    const found = await page.evaluate((what) => {
      const pick = { semi: c => c.kind === 'semi', artic: c => !!c.type.artic, bus: c => c.kind === 'bus' && !c.type.artic };
      const c = cars.find(pick[what]); if (!c) return null;
      dayTime = 8.5 / 24; updateCycle(0);
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
    const c = cars.find(v => v.kind !== 'car') || cars[0];
    player.x = c.x; player.z = c.z; player.yaw = 0;
    drawMinimap();
  });
  const mmEl = await page.$('#minimap');
  if (mmEl) await mmEl.screenshot({ path: path.join(OUT, 'minimap.png') });

  // draw calls depend on frustum culling → always measure the same fixed viewpoint
  const stats = await page.evaluate(() => {
    let meshes = 0; scene.traverse(o => { if (o.isMesh) meshes++; });
    player.x = CELL * 4 + CELL / 2; player.z = -HALF + CELL * 3; player.yaw = 0; player.pitch = 0.15;
    updatePlayer(3, 0); renderer.render(scene, camera);
    const i = renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geoms: i.memory.geometries,
             meshesInScene: meshes, buildings: buildings.length, trees: trees.length };
  });

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
    ['a held vehicle stops before the box it was denied (worst nose overshoot ' + sim.heldNoseMax + ' m)',
      sim.heldNoseMax <= 0.6],
  ];

  console.log(JSON.stringify({ html: HTML, genMs, stats, spawn, sim, cam, cycle, shots, errs }, null, 2));
  let ok = true;
  for (const [label, pass] of checks) { if (!pass) ok = false; console.log((pass ? 'PASS  ' : 'FAIL  ') + label); }
  console.log('screenshots -> ' + OUT);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
