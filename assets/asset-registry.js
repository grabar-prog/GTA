/* assets/asset-registry.js — каталог моделей.
 *
 * Каждый model-файл зовёт MeridianAssets.register() один раз при загрузке.
 * assets/viewer.html обходит каталог и строит меню; game/gta.html про каталог
 * не знает — он читает те же модели через их фабрики.
 *
 * Запись:
 *   { id, label, group,
 *     makePreview(ctx) → THREE.Object3D,   // одна показательная инстанция
 *     notes?: string }
 *
 * ctx = { THREE, RoundedBoxGeometry, geom }.
 * rng — свежий mulberry32, если модели понадобится детерминизм.
 */
(function () {
  'use strict';
  const items = [];

  function register(entry) {
    if (!entry || !entry.id || typeof entry.makePreview !== 'function') {
      throw new Error('MeridianAssets.register: id + makePreview required');
    }
    if (items.some(e => e.id === entry.id)) {
      throw new Error('MeridianAssets.register: duplicate id ' + entry.id);
    }
    items.push(entry);
    return entry;
  }
  function list()  { return items.slice(); }
  function get(id) { return items.find(e => e.id === id) || null; }
  function groups() {
    const g = new Map();
    for (const e of items) {
      const k = e.group || 'Other';
      let arr = g.get(k);
      if (!arr) { arr = []; g.set(k, arr); }
      arr.push(e);
    }
    return g;
  }

  window.MeridianAssets = { register, list, get, groups };
})();
