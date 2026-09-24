/* assets/models/semi.js — евро-фура: дневная кабина + шторный полуприцеп.
 *
 * trGap — зазор бампер→передняя часть прицепа; длина прицепа = L - trGap.
 * Цвет шторы (curt) и краска кабины (paint) приходят снаружи.
 */
(function () {
  'use strict';

  const TRUCK_TYPES = [
    { name: 'semi', kind: 'semi', w: .17, L: 16.4, W: 2.55, wr: .55, cabL: 2.8, trGap: 3.3, trailerW: 2.60,
      trFloor: 1.42, trTop: 4.00, track: 2.05,
      axles: [[ 6.4, .55, 1], [ 2.5, .55, 1.75], [-5.8, .52, 1.75], [-6.9, .52, 1.75]] }
  ];

  function makeGeometry(G, t, paint, curt, PAL) {
    const { mergeGeometries, boxAt, taperBox, cylZ, THREE } = G;
    const P = [], W = t.W, L = t.L, fz = L / 2;
    const cabF = fz, cabR = fz - t.cabL, cabBot = 1.15, cabTop = 3.60;
    const trZ1 = fz - t.trGap, trZ0 = -fz, trL = trZ1 - trZ0, trC = (trZ0 + trZ1) / 2, tw = t.trailerW;
    const boxH = t.trTop - t.trFloor, boxC = (t.trTop + t.trFloor) / 2;
    const railF = fz - 1.6, railR = trZ0;
    P.push(boxAt(1.3, .2, railF - railR, 0, 1.0, (railF + railR) / 2, PAL.trim));
    P.push(taperBox(W, cabTop - cabBot, t.cabL - .06, 0, (cabBot + cabTop) / 2,
                    (cabF + cabR) / 2 + .03, .97, .98, paint));
    P.push(boxAt(W - .04, .4, t.cabL * .75, 0, cabTop + .2, cabR + t.cabL * .375, paint));
    P.push(boxAt(tw, .1, trL + .1, 0, t.trTop + .06, trC, PAL.busRoof));
    P.push(boxAt(W - .45, 1.45, .12, 0, cabTop - 1.05, cabF + .03, PAL.glass));
    P.push(boxAt(W - .2, .2, .3, 0, cabTop + .02, cabF + .06, PAL.trim));
    for (const sx of [1, -1]) P.push(boxAt(.12, .95, 1.45, sx * (W / 2 + .04), cabTop - 1.1, cabR + .85, PAL.glass));
    P.push(cylZ(.3, 1.2,  .78, .92, 4.3, 14, PAL.chrome));
    P.push(cylZ(.3, 1.2, -.78, .92, 4.3, 14, PAL.chrome));
    P.push(boxAt(1.9, .12, 2.0, 0, 1.16, trZ1 - 1.6, PAL.dark));
    // Exhaust stack — единственное место, где нужен сам THREE (голый CylinderGeometry
    // с разными радиусами; cylY из geom.js даёт только равные).
    P.push({ geo: new THREE.CylinderGeometry(.09, .11, 1.7, 10)
                     .translate(W / 2 - .25, 2.05, cabR - .3), color: PAL.chrome });
    for (const sx of [1, -1]) for (const dz of [-.62, .62])
      P.push(boxAt(.16, .12, .1, sx * (W / 2 - .25), cabTop + .06, cabF - dz, PAL.marker));
    P.push(boxAt(1.9, .26, trL + .1, 0, t.trFloor - .14, trC, PAL.trim));
    P.push(taperBox(tw, boxH, trL - .15, 0, boxC, trC, .998, .998, curt));
    for (let z = trZ0 + 1.2; z < trZ1 - 1.0; z += 1.1) {
      P.push(boxAt(.07, boxH - .1, .1,  tw / 2 + .05, boxC, z, PAL.busRib));
      P.push(boxAt(.07, boxH - .1, .1, -tw / 2 - .05, boxC, z, PAL.busRib));
    }
    for (const sy of [t.trFloor + .16, t.trTop - .16]) {
      P.push(boxAt(.09, .16, trL - .1,  tw / 2 + .04, sy, trC, PAL.trim));
      P.push(boxAt(.09, .16, trL - .1, -tw / 2 - .04, sy, trC, PAL.trim));
    }
    const rdz = trZ0 - .05;
    P.push(boxAt(tw - .08, boxH - .12, .1, 0, boxC, rdz, curt));
    for (const dx of [-.62, .62]) P.push(boxAt(.07, boxH - .24, .09, dx, boxC, rdz - .07, PAL.chrome));
    for (const sx of [1, -1]) P.push(boxAt(.14, boxH, .16, sx * (tw / 2 - .07), boxC, rdz, PAL.trim));
    P.push(boxAt(tw - .5, .16, .34, 0, .62, trZ0 - .28, PAL.trim));
    for (const sx of [1, -1]) P.push(boxAt(.14, .5, .14, sx * (tw / 2 - .3), .9, trZ0 - .16, PAL.trim));
    P.push(boxAt(tw - .2, .07, 2.6, 0, 1.18, -6.35, PAL.trim));
    return mergeGeometries(P);
  }

  function makePreview(ctx) {
    const { THREE, geom } = ctx;
    const PAL = { trim: 0x15181d, glass: 0x10171f, dark: 0x23282f, chrome: 0xa9b3bd,
                  busRoof: 0x9aa3bd, busRib: 0xb4bcc6, marker: 0xd9a94a };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .34, metalness: .55 });
    const m = new THREE.Mesh(makeGeometry(geom, TRUCK_TYPES[0], 0xd23b3b, 0xd8dde3, PAL), mat);
    m.castShadow = true; m.receiveShadow = true;
    const group = new THREE.Group(); group.add(m);
    return group;
  }

  window.MeridianSemiKit = { TRUCK_TYPES, makeGeometry };

  MeridianAssets.register({
    id: 'vehicle/semi',
    label: 'Semi — day cab · curtain-sider',
    group: 'Vehicles',
    makePreview,
  });
})();
