/* assets/day-cycle.js — день/ночь: небо, свет, туман, текстуры.
 *
 * Модуль владеет:
 *   • сферой неба (ShaderMaterial с двумя uniform-цветами);
 *   • звёздами (Points) и луной (billboard);
 *   • цветом тумана (fogColor) и его установкой в scene.fog / renderer;
 *   • временем суток (dayTime 0..1) и производной night 0..1;
 *   • тремя процедурными текстурами: фасад (day), эмиссив-карта (ночь),
 *     асфальт+трава с градиентом к туману по краям.
 *
 * Модуль не владеет светильниками и материалами — они ему передаются и
 * он их только настраивает. Материалы, у которых есть emissiveIntensity,
 * перечисляются в opts.mats; всё, что там не указано, остаётся нетронутым.
 *
 *   const dayCycle = MeridianDayCycle.create({
 *     THREE, scene, renderer, camera, rng,
 *     DAY_LEN: 170,
 *     world: { GRID, CELL, ROAD },
 *     lights: { sun, moon, hemi },
 *     mats: { glassMat, buildingGlassMat, solidMat, headMat, tailMat, busGlassMat },
 *     pools: { lampLightPool },
 *     getPlayerPos: () => player,
 *     startTime: 8/24,
 *     onTick: ({ dayTime, night, hours, minutes, phase }) => { … HUD … },
 *   });
 *   dayCycle.buildSky();
 *   // в animate:
 *   dayCycle.update(dt);
 *
 * rng-контракт: create() не трогает rng. Методы makeFacadeTexture /
 * makeWindowEmissive / makeGroundTexture / buildSky расходуют rng ровно
 * в том же порядке и количестве, что и прежние функции в gta.html —
 * вызывающий обязан звать их в прежней последовательности.
 * (contracts/README.md §4)
 */
(function () {
  'use strict';

  const SKY = {
    day:   { top: 0x7fb8ea, bot: 0x4a6d96 },
    dusk:  { top: 0x3a4a78, bot: 0x8a4520 },
    night: { top: 0x060c24, bot: 0x060a14 },
  };

  function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function create(opts) {
    const THREE = opts.THREE;
    if (!THREE)     throw new Error('MeridianDayCycle.create: THREE is required');
    if (!opts.scene)    throw new Error('MeridianDayCycle.create: scene is required');
    if (!opts.renderer) throw new Error('MeridianDayCycle.create: renderer is required');
    if (typeof opts.rng !== 'function') throw new Error('MeridianDayCycle.create: rng is required');

    const scene    = opts.scene;
    const renderer = opts.renderer;
    const camera   = opts.camera;
    const rng      = opts.rng;

    const DAY_LEN  = opts.DAY_LEN || 170;
    const world    = opts.world  || {};
    const GRID     = world.GRID != null ? world.GRID : 10;
    const CELL     = world.CELL != null ? world.CELL : 58;
    const ROAD     = world.ROAD != null ? world.ROAD : 16;
    const WORLD    = GRID * CELL;

    const lights   = opts.lights || {};
    const sun      = lights.sun;
    const moon     = lights.moon;
    const hemi     = lights.hemi;

    const mats     = opts.mats || {};
    const pools    = opts.pools || {};
    const lampPool = pools.lampLightPool || null;

    const getPlayerPos = opts.getPlayerPos || (() => ({ x: 0, z: 0 }));
    const onTick       = opts.onTick || null;

    let dayTime = (typeof opts.startTime === 'number') ? opts.startTime : 8 / 24;
    let night   = 0;

    // Sky/moon/stars — создаются в buildSky(). До этого null.
    let skyMat = null, stars = null, moonMesh = null;

    // fogColor — публичный (harness его может смотреть) и один на всё:
    // он же идёт в scene.fog, и в renderer.setClearColor, и в небо.
    const fogColor = new THREE.Color(0x9fb6c8);

    // Скретч-цвета модуля: раньше были на уровне модуля в gta.html.
    const _t = new THREE.Color();
    const _b = new THREE.Color();
    const _warm = new THREE.Color();
    const _dir = new THREE.Vector3();

    /* ============================================================
       Текстуры. rng-порядок критичен.
       ============================================================ */
    function makeFacadeTexture() {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 256;
      const x = c.getContext('2d');
      x.fillStyle = '#0a0b0e'; x.fillRect(0, 0, 128, 256);
      for (let gy = 0; gy < 16; gy++) for (let gx = 0; gx < 4; gx++) {
        const wx = gx * 32 + 7, wy = gy * 16 + 4, ww = 18, wh = 9;
        x.fillStyle = '#151a22'; x.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
        const g = x.createLinearGradient(0, wy, 0, wy + wh);
        g.addColorStop(0, '#3b4c60');
        g.addColorStop(0.5, '#28394a');
        g.addColorStop(1, '#171f28');
        x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
        x.strokeStyle = 'rgba(255,255,255,.06)';
        x.beginPath();
        x.moveTo(wx + ww / 2, wy);
        x.lineTo(wx + ww / 2, wy + wh);
        x.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    function makeWindowEmissive() {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 256;
      const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, 128, 256);
      for (let gy = 0; gy < 16; gy++) for (let gx = 0; gx < 4; gx++) {
        if (rng() < 0.34) continue;
        const wx = gx * 32 + 7, wy = gy * 16 + 4, ww = 18, wh = 9;
        x.fillStyle = `rgba(255,${(190 + rng() * 45) | 0},${(120 + rng() * 70) | 0},1)`;
        x.fillRect(wx, wy, ww, wh);
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    function makeGroundTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 1024;
      const x = c.getContext('2d');
      const cellPx = CELL / WORLD * 1024;
      const roadPx = ROAD / WORLD * 1024;

      x.fillStyle = '#3a4638'; x.fillRect(0, 0, 1024, 1024);
      // Точки травы. 9000 × 4 rng() — прежний контракт; не менять порядок.
      for (let i = 0; i < 9000; i++) {
        const px = rng() * 1024, py = rng() * 1024;
        x.fillStyle = `rgba(${rng() < 0.5 ? 70 : 36},${rng() < 0.5 ? 86 : 52},40,.05)`;
        x.fillRect(px, py, 2, 2);
      }
      // Асфальт вдоль каждой дорожной линии.
      x.fillStyle = '#2b2f34';
      for (let i = 0; i <= GRID; i++) {
        const p = i * cellPx;
        x.fillRect(p - roadPx / 2, 0, roadPx, 1024);
        x.fillRect(0, p - roadPx / 2, 1024, roadPx);
      }
      // Периферийный градиент к цвету тумана. В UV-пространстве игровая карта
      // занимает [apron/S, (WORLD+apron)/S] с каждой стороны; крайние пиксели
      // текстуры ClampToEdge тянет дальше — поэтому именно они должны быть
      // цвета тумана.
      const APRON_FRAC = 0.085;
      const EDGE_PX = Math.round(1024 * APRON_FRAC);
      // Значение согласовано с day.bot * 0.55 (см. update): 0x4a6d96 * 0.55
      // визуально попадает в этот тон.
      const APRON_FOG_HEX = '74,109,150';
      const grad = (x0, y0, x1, y1, rx, ry, rw, rh, flip) => {
        const gr = x.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, 'rgba(' + APRON_FOG_HEX + ',' + (flip ? 0 : 1) + ')');
        gr.addColorStop(1, 'rgba(' + APRON_FOG_HEX + ',' + (flip ? 1 : 0) + ')');
        x.fillStyle = gr;
        x.fillRect(rx, ry, rw, rh);
      };
      grad(0, 0, EDGE_PX, 0,                         0, 0, EDGE_PX, 1024, false);
      grad(1024 - EDGE_PX, 0, 1024, 0,               1024 - EDGE_PX, 0, EDGE_PX, 1024, true);
      grad(0, 0, 0, EDGE_PX,                         0, 0, 1024, EDGE_PX, false);
      grad(0, 1024 - EDGE_PX, 0, 1024,               0, 1024 - EDGE_PX, 1024, EDGE_PX, true);

      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }

    /* ============================================================
       Сфера неба + звёзды + луна. rng-порядок критичен.
       ============================================================ */
    function buildSky() {
      const geo = new THREE.SphereGeometry(650, 32, 16);
      skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          topColor:    { value: new THREE.Color() },
          bottomColor: { value: new THREE.Color() },
          offset:      { value: 8 },
          exponent:    { value: 0.7 },
        },
        vertexShader: 'varying vec3 vP;' +
          'void main(){vec4 w=modelMatrix*vec4(position,1.);vP=w.xyz;' +
          'gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'uniform vec3 topColor,bottomColor;uniform float offset,exponent;' +
          'varying vec3 vP;void main(){float h=normalize(vP+vec3(0.,offset,0.)).y;' +
          'gl_FragColor=vec4(mix(bottomColor,topColor,pow(max(h,0.),exponent)),1.);}',
      });
      scene.add(new THREE.Mesh(geo, skyMat));

      const sc = document.createElement('canvas');
      sc.width = sc.height = 64;
      const sx = sc.getContext('2d');
      const gr = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.4, 'rgba(255,255,255,.6)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      sx.fillStyle = gr;
      sx.fillRect(0, 0, 64, 64);
      const starTex = new THREE.CanvasTexture(sc);

      const cnt = 900;
      const pos = new Float32Array(cnt * 3);
      const col = new Float32Array(cnt * 3);
      // 900 × 4 rng() — прежний контракт.
      for (let i = 0; i < cnt; i++) {
        const u = rng() * Math.PI * 2;
        const v = Math.acos(rng());
        const r = 600;
        pos[i * 3]     = r * Math.sin(v) * Math.cos(u);
        pos[i * 3 + 1] = Math.abs(r * Math.cos(v)) * 0.9 + 40;
        pos[i * 3 + 2] = r * Math.sin(v) * Math.sin(u);
        const b = 0.5 + rng() * 0.5;
        col[i * 3]     = b;
        col[i * 3 + 1] = b;
        col[i * 3 + 2] = b * (0.85 + rng() * 0.15);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      sg.setAttribute('color',    new THREE.BufferAttribute(col, 3));
      stars = new THREE.Points(sg, new THREE.PointsMaterial({
        size: 2.4, map: starTex, transparent: true, depthWrite: false,
        vertexColors: true, sizeAttenuation: false,
      }));
      scene.add(stars);

      // Луна — билборд-диск. Ориентация и позиция ставятся в update().
      const mc = document.createElement('canvas');
      mc.width = mc.height = 128;
      const mx = mc.getContext('2d');
      const mg = mx.createRadialGradient(64, 64, 0, 64, 64, 64);
      mg.addColorStop(0, '#fff7e6');
      mg.addColorStop(0.5, '#f3ead2');
      mg.addColorStop(0.85, '#c9bfa6');
      mg.addColorStop(1, 'rgba(200,190,160,0)');
      mx.fillStyle = mg;
      mx.beginPath();
      mx.arc(64, 64, 60, 0, 7);
      mx.fill();
      moonMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(mc),
          transparent: true, depthWrite: false, fog: false,
        })
      );
      scene.add(moonMesh);
    }

    /* ============================================================
       Тик. Один вызов на кадр.
       ============================================================ */
    function update(dt) {
      dayTime = (dayTime + dt / DAY_LEN) % 1;

      const ang  = dayTime * Math.PI * 2 - Math.PI / 2;
      const sunY = Math.sin(ang);
      const sunX = Math.cos(ang);
      const elev = sunY;
      night = smoothstep(0.06, -0.14, elev);

      // Верх/низ неба.
      if (elev > 0) {
        const k = smoothstep(-0.02, 0.35, elev);
        _t.setHex(SKY.dusk.top).lerp(_warm.setHex(SKY.day.top), k);
        _b.setHex(SKY.dusk.bot).lerp(_warm.setHex(SKY.day.bot), k);
      } else {
        const k = smoothstep(0, -0.4, elev);
        _t.setHex(SKY.dusk.top).lerp(_warm.setHex(SKY.night.top), k);
        _b.setHex(SKY.dusk.bot).lerp(_warm.setHex(SKY.night.bot), k);
      }
      if (skyMat) {
        skyMat.uniforms.topColor.value.copy(_t);
        skyMat.uniforms.bottomColor.value.copy(_b);
      }

      // Туман и clear color.
      fogColor.copy(_b).multiplyScalar(0.55);
      if (scene.fog) scene.fog.color.copy(fogColor);
      renderer.setClearColor(fogColor, 1);

      // Полусферический свет.
      if (hemi) {
        hemi.intensity = lerp(0.75, 0.14, night);
        hemi.color.copy(_t);
      }

      // Солнце: позиция, target — герой, интенсивность, оттенок.
      _dir.set(sunX, sunY, 0.28).normalize();
      const pp = getPlayerPos();
      if (sun) {
        sun.position.copy(_dir).multiplyScalar(160);
        sun.target.position.set(pp.x, 0, pp.z);
        sun.target.updateMatrixWorld();
        sun.intensity = lerp(1.5, 0, night) * smoothstep(-0.05, 0.12, elev);
        _warm.setHSL(lerp(0.13, 0.62, night), lerp(0.7, 0.85, night), lerp(0.6, 0.4, night));
        sun.color.copy(_warm);
      }
      if (moon) {
        moon.position.copy(_dir).multiplyScalar(-160);
        moon.intensity = lerp(0.05, 0.28, night);
      }
      if (moonMesh) {
        moonMesh.position.copy(_dir).multiplyScalar(-520);
        if (camera) moonMesh.lookAt(camera.position);
        moonMesh.visible = elev < 0.14;
      }

      // Звёзды.
      if (stars) stars.material.opacity = smoothstep(0.05, -0.1, elev) * 0.9;

      // Материалы: эмиссия привязана к night.
      if (mats.glassMat)          mats.glassMat.emissiveIntensity          = night * 1.7;
      if (mats.buildingGlassMat)  mats.buildingGlassMat.emissiveIntensity  = night * 1.4;
      if (mats.busGlassMat)       mats.busGlassMat.emissiveIntensity       = night * 1.4;
      if (mats.solidMat)          mats.solidMat.emissiveIntensity          = night * 0.02;
      if (mats.headMat)           mats.headMat.emissiveIntensity           = night * 3.0;
      if (mats.tailMat)           mats.tailMat.emissiveIntensity           = 0.12 + night * 1.2;

      // Фонари — только интенсивность, visible не трогаем (см. contracts).
      if (lampPool) for (const l of lampPool) l.intensity = lerp(0, 2.4, night);

      // HUD-хук. Никакого DOM внутри модуля.
      if (onTick) {
        const hh = Math.floor(dayTime * 24);
        const mm = Math.floor((dayTime * 24 % 1) * 60);
        const phase =
          hh < 5  ? 'NIGHT'    :
          hh < 8  ? 'DAWN'     :
          hh < 12 ? 'MORNING'  :
          hh < 17 ? 'AFTERNOON':
          hh < 20 ? 'DUSK'     : 'EVENING';
        onTick({ dayTime, night, hours: hh, minutes: mm, phase });
      }
    }

    return {
      buildSky, update,
      makeFacadeTexture, makeWindowEmissive, makeGroundTexture,
      get skyMat()   { return skyMat;   },
      get stars()    { return stars;    },
      get moonMesh() { return moonMesh; },
      get dayTime()  { return dayTime;  },
      set dayTime(v) { dayTime = v;     },
      get night()    { return night;    },
      fogColor,
      SKY,
    };
  }

  window.MeridianDayCycle = { create, SKY };
})();
