/* assets/traffic-ai.js — поведение машин: пересечения, lane following,
 * unstick, headlight pool, множитель плотности.
 *
 * Владелец модуля — единственный consumer массива cars после того, как
 * buildCars() их создал. Никакие rng() здесь не потребляются: расстановка
 * машин делается в buildCars, а этот модуль только ведёт их по дорогам.
 *
 *   const trafficAI = MeridianTrafficAI.create({
 *     THREE, scene, camera,
 *     cars, peds, player, lanes,
 *     CAR_COUNT_BASE, CAR_COUNT_MAX,
 *     CELL, ROAD, HALF,
 *     headlightPool,             // массив, будет наполняться
 *     getNight: () => curNight,
 *     initialMult: 1,
 *     onMultChanged: (mult, activeCars, maxCars) => { … HUD … },
 *   });
 *
 * Методы:
 *   trafficAI.updateCars(dt)         — один кадр; НЕ пишет instanced-матрицы
 *   trafficAI.updateHeadlights()     — раздать SpotLight'ы ближайшим машинам
 *   trafficAI.buildHeadlightPool()   — создать пул (один раз в boot)
 *   trafficAI.setTrafficMult(m)      — 0..2.5, меняет число активных машин
 *   trafficAI.trafficMult / .activeCars — геттеры
 *   trafficAI.laneKey, .wrapGap, .inBox, .clearOfBox — утилиты для buildCars
 *
 * Контракт rng: create() и все методы ниже — rng не тратят. Порядок
 * rng-вызовов в gta.html не меняется (contracts/README.md §4).
 */
(function () {
  'use strict';

  function create(opts) {
    const THREE  = opts.THREE;
    const scene  = opts.scene;
    const camera = opts.camera;
    const cars   = opts.cars;
    const peds   = opts.peds;
    const player = opts.player;
    const lanes  = opts.lanes;
    const headlightPool = opts.headlightPool || [];
    const getNight = opts.getNight || (() => 0);
    const onMultChanged = opts.onMultChanged || null;

    if (!THREE) throw new Error('MeridianTrafficAI.create: THREE required');
    if (!scene) throw new Error('MeridianTrafficAI.create: scene required');
    if (!cars)  throw new Error('MeridianTrafficAI.create: cars array required');
    if (!lanes) throw new Error('MeridianTrafficAI.create: lanes Map required');

    const CELL  = opts.CELL  != null ? opts.CELL  : 58;
    const ROAD  = opts.ROAD  != null ? opts.ROAD  : 16;
    const HALF  = opts.HALF  != null ? opts.HALF  : 290;
    const CAR_COUNT_BASE = opts.CAR_COUNT_BASE != null ? opts.CAR_COUNT_BASE : 52;
    const CAR_COUNT_MAX  = opts.CAR_COUNT_MAX  != null ? opts.CAR_COUNT_MAX  : 130;

    // -------- константы --------
    const BOX          = ROAD / 2;
    const CROSS_LOOK   = CELL + BOX;
    const TIE_MARGIN   = 0.45;
    const CLEAR_MARGIN = 1.0;
    const CROSS_DMIN   = 1.2;
    const STALL_HOLD   = 2.5;
    const UNSTICK_S    = 3;
    const REVERSE_V    = 2.6;
    const REV_MAX      = 14;
    const CAR_LIMIT    = HALF;
    const TRACK        = CAR_LIMIT * 2;
    const HEADLIGHT_POOL_SIZE   = 12;   // 6 машин × 2 фары
    const HEADLIGHT_NEAR_PLAYER = 18;

    const _m4d = new THREE.Matrix4();
    const _ql  = new THREE.Quaternion();

    // Состояние, которое было let-переменными в gta.html.
    let mult = (typeof opts.initialMult === 'number') ? opts.initialMult : 1;
    let activeCars = 0;
    let curNight = 0;

    // -------- утилиты --------
    const laneKey = c => c.axis + ':' + c.lineIdx + ':' + c.dir;
    const modm = (x, m) => ((x % m) + m) % m;

    function wrapGap(a, b) {
      const d = Math.abs(a - b) % TRACK;
      return Math.min(d, TRACK - d);
    }
    function inBox(along, hl) {
      const d = modm(along + HALF, CELL);
      return d < BOX + hl + 2 || d > CELL - BOX - hl - 2;
    }
    function clearOfBox(along, hl) {
      const m = BOX + hl + 2;
      let d = modm(along + HALF, CELL);
      if (d < m) along += m - d;
      else if (d > CELL - m) along -= d - (CELL - m);
      return modm(along + HALF, TRACK) - HALF;
    }

    /* ---- intersection helpers (полный комментарий был в gta.html) ---- */
    const lineCoord = k => -HALF + k * CELL;
    const laneCoord = v => lineCoord(v.lineIdx) + (v.axis === 0 ? v.dir : -v.dir) * ROAD / 4;
    const halfX = v => v.axis === 0 ? v.hw : v.hl;
    const halfZ = v => v.axis === 0 ? v.hl : v.hw;
    const fromRight = (c, o) => o.dir === (c.axis === 0 ? -c.dir : c.dir);

    function leaderAhead(c) {
      const g = lanes.get(laneKey(c));
      let best = null, bd = Infinity;
      if (g) for (const o of g) {
        if (o === c || !o.active) continue;
        let d = (o.s - c.s) * c.dir;
        if (d <= 0) d += TRACK;
        if (d < bd) { bd = d; best = o; }
      }
      return best ? { car: best, d: bd } : null;
    }

    function pathGap(c, ox, oz, pad) {
      const dx = ox - c.x, dz = oz - c.z;
      if (dx * dx + dz * dz > 2600) return Infinity;
      const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
      const lx = dx * co - dz * si, lz = dx * si + dz * co;
      if (lz < -c.hl || Math.abs(lx) > c.hw + pad) return Infinity;
      return lz - c.hl;
    }

    function bodyGap(c, perpOnly) {
      let best = Infinity;
      for (const o of cars) {
        if (!o.active) continue;
        if (o === c || (perpOnly && o.axis === c.axis)) continue;
        const dF = c.axis === 0 ? (o.z - c.z) * c.dir : (o.x - c.x) * c.dir;
        if (dF > 70) continue;
        const lat = c.axis === 0 ? Math.abs(o.x - c.x) : Math.abs(o.z - c.z);
        const latH = c.axis === 0 ? halfX(o) : halfZ(o);
        const oF   = c.axis === 0 ? halfZ(o) : halfX(o);
        if (lat > latH + c.hw + 0.2) continue;
        if (dF + oF <= 0) continue;
        const d = dF - oF - c.hl;
        if (d < best) best = d;
      }
      return best;
    }

    function bodyGapBehind(c) {
      let best = Infinity;
      for (const o of cars) {
        if (!o.active) continue;
        if (o === c || o.axis !== c.axis) continue;
        const dF = c.axis === 0 ? (o.z - c.z) * c.dir : (o.x - c.x) * c.dir;
        if (dF >= 0 || dF < -45) continue;
        const lat = c.axis === 0 ? Math.abs(o.x - c.x) : Math.abs(o.z - c.z);
        const latH = c.axis === 0 ? halfX(o) : halfZ(o);
        const oB   = c.axis === 0 ? halfZ(o) : halfX(o);
        if (lat > latH + c.hw + 0.2) continue;
        const d = -dF - oB - c.hl;
        if (d < best) best = d;
      }
      return best;
    }

    function approachLimit(c, d, standoff) {
      const free = d - standoff;
      return free <= 0 ? 0 : Math.min(Math.sqrt(2 * c.dec * free), c.cruise);
    }

    function crossState(c) {
      const rel = c.s + HALF;
      const dNext = modm(c.dir > 0 ? -rel : rel, CELL);
      const xN = Math.round((c.s + c.dir * dNext + HALF) / CELL);
      let xIdx = xN, dc = dNext;
      if (dNext >= BOX + c.hl) {
        if (CELL - dNext < BOX + c.hl) { xIdx = xN - (c.dir > 0 ? 1 : -1); dc = -(CELL - dNext); }
        else if (dNext > CROSS_LOOK) return null;
      }
      return {
        key: (c.axis === 0 ? c.lineIdx + ':' + xIdx : xIdx + ':' + c.lineIdx),
        xIdx, dc, stop: dc - c.hl - BOX,
      };
    }

    function clearance(c, o) {
      if (o.axis === c.axis) return -Infinity;   // same-axis: no conflict, no hold (C-ROW-4)
      const dC = (laneCoord(o) - c.s) * c.dir;
      if (dC < -c.hl - o.hw || dC > CROSS_LOOK + 30) return -Infinity;
      const tClear = (dC + c.hl + o.hw) / Math.max(c.cruise, 0.5) + CLEAR_MARGIN;
      const dO = (laneCoord(c) - o.s) * o.dir;
      if (dO <= 0) return -Infinity;
      return tClear - Math.max(dO - o.hl, 0) / Math.max(o.cruise, 0.5);
    }

    function roomToClear(c) {
      const xs = c.xs;
      if (!xs) return true;
      if (c.lead && c.lead.car.speed < 2 &&
          c.lead.d < xs.dc + BOX + c.hl + c.lead.car.hl + 2) return false;
      for (const o of xs.list) {
        if (o === c || o.axis === c.axis || o.speed >= 1) continue;
        const dC = (laneCoord(o) - c.s) * c.dir;
        if (dC < -c.hl - o.hw) continue;
        if (Math.abs(laneCoord(c) - o.s) > o.hl + c.hw) continue;
        return false;
      }
      return true;
    }

    function arbitrateCrossings() {
      const crossings = new Map();
      for (const c of cars) {
        if (!c.active) continue;
        c.xs = null; c.xGo = true;
        if (c.reverse) continue;
        const xs = crossState(c);
        if (!xs) continue;
        let list = crossings.get(xs.key);
        if (!list) { list = []; crossings.set(xs.key, list); }
        c.xs = xs; xs.list = list; list.push(c);
      }
      for (const list of crossings.values()) {
        if (list.length < 2) continue;
        for (const c of list) c._inBox = Math.abs(c.xs.dc) < BOX + c.hl;
        list.sort((a, b) => {
          const ai = a._inBox ? 0 : 1, bi = b._inBox ? 0 : 1;
          if (ai !== bi) return ai - bi;
          if (ai === 0) return a.xs.dc - b.xs.dc;
          const ta = a.xs.stop / Math.max(a.cruise, 0.5);
          const tb = b.xs.stop / Math.max(b.cruise, 0.5);
          if (Math.abs(ta - tb) > TIE_MARGIN) return ta < tb ? -1 : 1;
          if (a.axis !== b.axis) {
            if (fromRight(a, b)) return 1;
            if (fromRight(b, a)) return -1;
          }
          return a.id - b.id;
        });
        for (const c of list) {
          if (c._inBox) { c.xGo = true; continue; }
          let hold = -Infinity;
          for (let j = 0; j < list.length; j++) {
            const o = list[j];
            if (o === c) break;
            if (o.speed < 0.5 && o.stall > STALL_HOLD) continue;
            const h = clearance(c, o);
            if (h > hold) hold = h;
          }
          const tE = Math.max(c.xs.stop, 0) / Math.max(c.cruise, 0.5);
          c.xGo = tE >= hold && roomToClear(c);
          if (!c.xGo && c.speed < 0.5 && c.stall > STALL_HOLD &&
              bodyGap(c, true) > 1 && roomToClear(c)) c.xGo = true;
        }
      }
    }

    function unstickCars(dt) {
      for (const c of cars) {
        if (!c.active) continue;
        if (c.reverse) {
          const gap = bodyGapBehind(c);
          const lim = gap - 0.6 <= 0 ? 0 : Math.min(REVERSE_V, Math.sqrt(2 * c.dec * (gap - 0.6)));
          c.speed += Math.max(-c.dec * dt, Math.min(c.acc * dt, lim - c.speed));
          const step = c.speed * dt;
          if (c.axis === 0) c.z -= c.dir * step; else c.x -= c.dir * step;
          c.revDist += step;
          c.spin -= c.speed * dt / c.wr;
          const xs = crossState(c);
          const clear = (!xs || xs.dc >= BOX + c.hl - 0.2) && gap > 2.5;
          if (c.revDist > REV_MAX || clear || c.speed < 0.05) {
            c.reverse = 0; c.revDist = 0; c.unstick = 0; c.speed = 0;
          }
          c.s = c.axis === 0 ? c.z : c.x;
          c.mesh.position.set(c.x, 0, c.z);
          c.mesh.rotation.y = c.yaw;
          continue;
        }
        const xs = c.xs;
        const wedged = !!xs && Math.abs(xs.dc) < BOX + c.hl && c.speed < 0.4 && bodyGap(c, true) < 1.5;
        c.unstick = wedged ? c.unstick + dt : 0;
        if (wedged && c.unstick > UNSTICK_S) { c.reverse = 1; c.revDist = 0; c.braking = false; }
      }
    }

    function updateCars(dt) {
      for (const c of cars) {
        if (!c.active) continue;
        c.lead = leaderAhead(c);
        if (c.speed < 0.5) c.stall += dt; else c.stall = 0;
      }
      arbitrateCrossings();
      unstickCars(dt);
      for (const c of cars) {
        if (!c.active) continue;
        if (c.reverse) continue;
        let target = c.cruise;
        const lead = c.lead;
        if (lead) target = Math.min(target, approachLimit(c, lead.d, c.dmin));
        c.yielding = !!c.xs && !c.xGo;
        if (c.yielding) target = Math.min(target, approachLimit(c, Math.max(c.xs.stop, 0), CROSS_DMIN));
        const bg = bodyGap(c, false);
        if (bg < Infinity) target = Math.min(target, approachLimit(c, bg, c.dmin));
        let gp = pathGap(c, player.x, player.z, 0.5);
        for (const p of peds) {
          const d = pathGap(c, p.x, p.z, 0.3);
          if (d < gp) gp = d;
        }
        if (gp < Infinity) target = Math.min(target, approachLimit(c, gp, c.dmin));
        const a = target > c.speed ? c.acc : c.dec;
        c.braking = target < c.speed - 0.35;
        c.speed += Math.max(-a * dt, Math.min(a * dt, target - c.speed));
        if (c.axis === 0) c.z += c.dir * c.speed * dt;
        else c.x += c.dir * c.speed * dt;
        if (Math.abs(c.z) > CAR_LIMIT) c.z = -Math.sign(c.z) * CAR_LIMIT;
        if (Math.abs(c.x) > CAR_LIMIT) c.x = -Math.sign(c.x) * CAR_LIMIT;
        c.s = c.axis === 0 ? c.z : c.x;
        c.spin += c.speed * dt / c.wr;
        c.mesh.position.set(c.x, 0, c.z);
        c.mesh.rotation.y = c.yaw;
      }
      // writeCarInstances() вызывается из gta.html — модуль не знает
      // про InstancedMesh и не должен.
    }

    /* ---- headlights ---- */
    function buildHeadlightPool() {
      if (headlightPool.length) return;
      for (let i = 0; i < HEADLIGHT_POOL_SIZE; i++) {
        const l = new THREE.SpotLight(0xfff2d0, 0, 30, 0.42, 0.6, 1.5);
        l.visible = true;                 // «выключено» — это intensity=0
        l.castShadow = false;
        scene.add(l);
        scene.add(l.target);
        headlightPool.push(l);
      }
    }

    const _hlCand = [];
    function updateHeadlights() {
      if (!headlightPool.length) return;
      curNight = getNight();
      if (curNight < 0.05) {
        for (const l of headlightPool) l.intensity = 0;
        return;
      }
      const camx = camera.position.x, camz = camera.position.z;
      const px = player.x, pz = player.z;
      const near2 = HEADLIGHT_NEAR_PLAYER * HEADLIGHT_NEAR_PLAYER;
      _hlCand.length = 0;
      for (const c of cars) {
        if (!c.active) continue;
        const dx = camx - c.x, dz = camz - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 80 * 80) continue;
        const dxP = px - c.x, dzP = pz - c.z;
        const near = (dxP * dxP + dzP * dzP) < near2;
        if (!near) {
          const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
          const len = Math.sqrt(d2) || 1;
          if ((fx * dx + fz * dz) / len < 0.2) continue;
        }
        _hlCand.push({ c, d2, near });
      }
      _hlCand.sort((a, b) => {
        if (a.near !== b.near) return a.near ? -1 : 1;
        return a.d2 - b.d2;
      });
      const intensity = curNight * 0.9;
      for (let i = 0; i < headlightPool.length; i++) {
        const l = headlightPool[i];
        const carIdx = (i / 2) | 0;
        const headIdx = i & 1;
        if (carIdx >= _hlCand.length) { l.intensity = 0; continue; }
        const c = _hlCand[carIdx].c;
        const H = c.heads[headIdx];
        const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
        const wx = H[0] * cy + H[2] * sy;
        const wz = -H[0] * sy + H[2] * cy;
        l.position.set(c.x + wx, H[1], c.z + wz);
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        l.target.position.set(c.x + fx * 20, 0.5, c.z + fz * 20);
        l.target.updateMatrixWorld();
        l.intensity = intensity;
      }
    }

    /* ---- плотность трафика ---- */
        /* seatAtTail(c) — при включении (setTrafficMult вверх) машина
     * встаёт в хвост своего lane, а не в исходную точку спавна.
     *
     * Причина: неактивные машины сохраняют свои (x,z) из buildCars(),
     * а активные за время простоя могут уехать вперёд и обернуться.
     * Включение в исходной точке даёт same-axis overlap в одном lane —
     * leaderAhead видит "себя же", bodyGap пропускает (dF + oF <= 0),
     * unstickCars не трогает same-axis. Никто не разрешает коллизию.
     *
     * Хвост lane гарантированно свободен: машина встаёт за последней
     * активной с отступом MIN_SEAT_GAP.
     *
     * MERIDIAN_RESEAT
     */

    /* seatAtTail(c) — при включении (setTrafficMult вверх) машина
     * встаёт в хвост своего lane, а не в исходную точку спавна.
     *
     * v2 (2026-09-26):
     *   · убран лимит CROSS_LOOK * 2 = 132 м — при 52 активных на 36 lane
     *     расстояние между соседями в среднем 400 м, и farthestAhead
     *     часто оставался -Infinity.
     *   · добавлена проверка cross-axis: если новая позиция в перекрёстке
     *     с поперечной активной — сдвигаемся дальше.
     *   · если после 8 попыток место не найдено — возвращаем false,
     *     applyActiveCount откладывает включение этой машины.
     *
     * MERIDIAN_RESEAT_V2
     */

    

    

    

    /* ============================================================
     seatAtTail(c, targetActive) — v3
     ============================================================
     При включении машины (setTrafficMult вверх) ставит её в хвост своего
     lane, учитывая:
       · длину самой дальней активной машины в lane (farthestCar.hl),
       · неактивные машины, которые включатся ТЕМ ЖЕ вызовом (o.id < targetActive),
       · конфликты И по своей оси (same-axis gap), И по перпендикулярной
         (OBB-пересечение на перекрёстке).

     Возвращает true, если место найдено и машина пересажена, false — если
     за MAX_ATTEMPTS попыток свободного места не нашлось.

     MERIDIAN_RESEAT_V3
     */
    const MIN_SEAT_GAP = 4;      // метры между хвостом и включаемой машиной
    const MAX_ATTEMPTS = 12;     // число попыток сдвига вперёд по 20 м

    function conflictsAt(c, targetActive) {
      for (const o of cars) {
        if (o === c) continue;
        // Машины, которые не активны и не станут активными при этом
        // вызове, нас не интересуют — они останутся под землёй.
        if (!o.active && o.id >= targetActive) continue;

        if (o.axis === c.axis && o.lineIdx === c.lineIdx && o.dir === c.dir) {
          // Тот же lane — проверяем gap по s.
          const rel = Math.abs((o.s - c.s));
          const wrapped = Math.min(rel, TRACK - rel);
          if (wrapped < c.hl + o.hl + MIN_SEAT_GAP) return true;
        } else {
          // Разные оси или разные lane — проверяем OBB-пересечение.
          const ox = halfX(o) + c.hw - Math.abs(o.x - c.x);
          const oz = halfZ(o) + c.hl - Math.abs(o.z - c.z);
          if (ox > 0 && oz > 0) return true;
        }
      }
      return false;
    }

    function seatAtTail(c, targetActive) {
      // 1. Ищем самую дальнюю машину в lane среди тех, что активны ИЛИ
      //    станут активными в этом вызове. Запоминаем и её саму.
      let farthestAhead = 0;
      let farthestCar = null;
      for (const o of cars) {
        if (o === c) continue;
        if (o.axis !== c.axis || o.lineIdx !== c.lineIdx || o.dir !== c.dir) continue;
        if (!o.active && o.id >= targetActive) continue;

        // Расстояние ВПЕРЁД от c до o с учётом wrap-around (кольцо TRACK).
        const raw = (o.s - c.s) * c.dir;
        const aheadDist = ((raw % TRACK) + TRACK) % TRACK;
        // aheadDist близко к 0 или TRACK означает "почти на том же месте" —
        // берём как конфликт, чтобы не встать внутрь.
        if (aheadDist > TRACK / 2) continue;   // o позади нас по циклу

        if (aheadDist > farthestAhead) {
          farthestAhead = aheadDist;
          farthestCar = o;
        }
      }

      // 2. Базовая позиция — за farthestCar с учётом ЕГО длины.
      let baseShift;
      if (farthestCar) {
        baseShift = farthestAhead + farthestCar.hl + c.hl + MIN_SEAT_GAP;
      } else {
        baseShift = 0;   // lane пуст — не двигаем
      }

      // 3. Пробуем baseShift, потом +20, +40, ... до MAX_ATTEMPTS.
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const shift = baseShift + attempt * 20;
        const newS = c.s + c.dir * shift;
        const wrapped = ((newS + HALF) % TRACK + TRACK) % TRACK - HALF;
        const oldS = c.s, oldX = c.x, oldZ = c.z;

        if (c.axis === 0) c.z = wrapped; else c.x = wrapped;
        c.s = wrapped;

        if (!conflictsAt(c, targetActive)) {
          c.mesh.position.set(c.x, 0, c.z);
          c.spin = 0;
          c.speed = 0;
          c.braking = false;
          c.xs = null; c.xGo = true; c.lead = null;
          return true;
        }

        // откатываем
        c.s = oldS; c.x = oldX; c.z = oldZ;
      }

      return false;   // за MAX_ATTEMPTS попыток места не нашли — отложить
    }

    function applyActiveCount() {
      const targetActive = Math.max(0, Math.min(CAR_COUNT_MAX,
        Math.round(CAR_COUNT_BASE * mult)));

      // Случай 1: расширение — часть машин включается.
      if (targetActive > activeCars) {
        // Перебираем включаемых по возрастанию id: те, что включатся
        // раньше, должны быть пересажены первыми, чтобы следующие их видели.
        const toActivate = cars
          .filter(c => !c.active && c.id < targetActive)
          .sort((a, b) => a.id - b.id);

        for (const c of toActivate) {
          c.active = true;   // временно активна, чтобы следующие её видели
          if (!seatAtTail(c, targetActive)) {
            c.active = false;   // отложить
            c.mesh.position.y = -1000;
          } else {
            c.mesh.position.y = 0;
          }
        }
      }

      // Случай 2: сужение — часть машин выключается.
      if (targetActive < activeCars) {
        for (const c of cars) {
          if (c.active && c.id >= targetActive) {
            c.active = false;
            c.mesh.position.y = -1000;
          }
        }
      }

      // Пересчёт реального числа активных (некоторые могли быть отложены).
      if (cars.length) {
        let real = 0;
        for (const c of cars) if (c.active) real++;
        activeCars = real;
      } else {
        activeCars = targetActive;
      }

      if (onMultChanged) onMultChanged(mult, activeCars, CAR_COUNT_MAX);
    }

    function setTrafficMult(m) {
      mult = Math.max(0, Math.min(2.5, Math.round(m * 20) / 20));
      applyActiveCount();
    }

    // Первичная раскладка активных — до того, как начнётся updateCars.
    applyActiveCount();

    return {
      // Управление
      updateCars, updateHeadlights, buildHeadlightPool, setTrafficMult,
      // Геттеры
      get trafficMult() { return mult; },
      get activeCars()  { return activeCars; },
      // Для buildCars
      laneKey, wrapGap, inBox, clearOfBox,
      // Для диагностики и тестов
      arbitrateCrossings, unstickCars, leaderAhead, pathGap,
      bodyGap, bodyGapBehind, approachLimit,
      crossState, clearance, roomToClear,
      halfX, halfZ,
      // Публичные константы
      BOX, CROSS_LOOK, TIE_MARGIN, CLEAR_MARGIN, CROSS_DMIN,
      STALL_HOLD, UNSTICK_S, REVERSE_V, REV_MAX,
      CAR_LIMIT, TRACK, HEADLIGHT_POOL_SIZE, HEADLIGHT_NEAR_PLAYER,
      CAR_COUNT_BASE, CAR_COUNT_MAX,
      headlightPool,
    };
  }

  window.MeridianTrafficAI = { create };
})();
