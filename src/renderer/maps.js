// The model on a map: pick the base point on a web map (lat/long → set_base_point), and over the 3D view's ground a
// background map and an Easting / Northing grid with labels, chosen from a small layer button at the bottom left
// (set_view_overlay). Tiles load straight from the tile servers; their attribution stays on screen.
import * as THREE from 'three';
import * as GM from '../core/geomap.js';
import * as OGC from '../core/ogc.js';
import { h, icon } from './ui.js';

const TILE = 256;
const overlayOf = (doc) => ({ map: 'none', grid: false, radius: 300, opacity: 1, ...doc.settings.view_overlay });
export const placerOf = (doc) => GM.placer({ base: doc.geo?.base, epsg: doc.geo?.crs?.epsg, job: doc.geo?.crs?.projection, geolocation: doc.settings.geolocation });

/** A slippy map in an element: drag to pan, wheel to zoom, click to drop the pin. onPick(lon, lat). */
function slippy(el, { center, zoom, pin, layer = 'map', onPick }) {
  const s = { center, zoom, pin, layer };
  const tiles = h('div.map-tiles');
  const marker = h('div.map-pin', { hidden: true }, icon('map-pin', true));
  const attrib = h('div.map-attrib');
  el.append(tiles, marker, attrib);
  const draw = () => {
    const { width: w, height: hh } = el.getBoundingClientRect();
    const n = 2 ** s.zoom;
    const c = GM.lonLatToTile(...s.center, s.zoom);
    const imgs = [];
    for (let ty = Math.floor(c.y - hh / 2 / TILE); ty <= Math.floor(c.y + hh / 2 / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(c.x - w / 2 / TILE); tx <= Math.floor(c.x + w / 2 / TILE); tx++)
        imgs.push(h('img', { src: GM.tileUrl(s.layer, s.zoom, ((tx % n) + n) % n, ty), alt: '', draggable: 'false', style: { left: `${Math.round((tx - c.x) * TILE + w / 2)}px`, top: `${Math.round((ty - c.y) * TILE + hh / 2)}px` } }));
    }
    tiles.replaceChildren(...imgs);
    attrib.textContent = GM.LAYERS[s.layer].attribution;
    marker.hidden = !s.pin;
    if (s.pin) {
      const p = GM.lonLatToTile(...s.pin, s.zoom);
      Object.assign(marker.style, { left: `${(p.x - c.x) * TILE + w / 2}px`, top: `${(p.y - c.y) * TILE + hh / 2}px` });
    }
  };
  const at = (ev) => {
    const r = el.getBoundingClientRect();
    const c = GM.lonLatToTile(...s.center, s.zoom);
    return GM.tileToLonLat(c.x + (ev.clientX - r.left - r.width / 2) / TILE, c.y + (ev.clientY - r.top - r.height / 2) / TILE, s.zoom);
  };
  let drag = null;
  el.onpointerdown = (ev) => {
    el.setPointerCapture(ev.pointerId);
    drag = { x: ev.clientX, y: ev.clientY, c: GM.lonLatToTile(...s.center, s.zoom), moved: false };
  };
  el.onpointermove = (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) (s.center = GM.tileToLonLat(drag.c.x - dx / TILE, drag.c.y - dy / TILE, s.zoom)), draw();
  };
  el.onpointerup = (ev) => {
    if (drag && !drag.moved) (s.pin = at(ev)), onPick(...s.pin), draw();
    drag = null;
  };
  el.onwheel = (ev) => {
    ev.preventDefault();
    const z = Math.max(1, Math.min(GM.LAYERS[s.layer].max, s.zoom + (ev.deltaY < 0 ? 1 : -1)));
    if (z === s.zoom) return;
    // the place under the cursor stays under it
    const r = el.getBoundingClientRect();
    const [ox, oy] = [ev.clientX - r.left - r.width / 2, ev.clientY - r.top - r.height / 2];
    const p = GM.lonLatToTile(...at(ev), z);
    s.zoom = z;
    s.center = GM.tileToLonLat(p.x - ox / TILE, p.y - oy / TILE, z);
    draw();
  };
  return { s, draw };
}

/** Pick the base point on a map: the pin's lat/long, a coordinate system that can take it, its elevation. */
export async function pickLocation(app) {
  const doc = app.store.doc;
  const placed = placerOf(doc);
  const start = placed?.origin || null;
  const fmt = (v) => (Math.round(v * 1e7) / 1e7).toString();
  const lat = h('input', { type: 'number', step: 'any', value: start ? fmt(start[1]) : '', placeholder: 'click the map', 'aria-label': 'Latitude' });
  const lon = h('input', { type: 'number', step: 'any', value: start ? fmt(start[0]) : '', placeholder: 'click the map', 'aria-label': 'Longitude' });
  const elev = h('input', { type: 'number', step: 'any', value: doc.geo?.base?.[2] ?? 0, 'aria-label': 'Elevation' });
  const crs = h('select', { 'aria-label': 'Coordinate system' });
  const grid = h('p.small.muted', {}, 'Click the map where the model origin is (drag to pan, wheel to zoom).');
  const box = h('div.map-pick', { role: 'application', 'aria-label': 'Map: drag to pan, wheel to zoom, click to place the base point' });
  const layerBtns = Object.entries(GM.LAYERS).map(([k, l]) => h('button.btn.sm', { type: 'button', 'aria-pressed': String(k === 'map'), onclick: () => ((map.s.layer = k), layerBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === layerBtns[Object.keys(GM.LAYERS).indexOf(k)]))), map.draw()) }, l.name));
  const cur = doc.geo?.crs;
  const update = async () => {
    const [la, lo] = [+lat.value, +lon.value];
    if (lat.value === '' || lon.value === '' || Math.abs(la) > 85 || Math.abs(lo) > 180) return;
    // the systems we can convert to, for this place; the project's own first when it can take it
    const r = await app.reg.run('suggest_coordinate_systems', { latitude: la, longitude: lo }).catch(() => ({ systems: [] }));
    const ok = [...(cur?.epsg && GM.projection(cur.epsg) ? [{ epsg: cur.epsg, name: cur.name || '', why: 'in use' }] : []), ...r.systems.filter((x) => GM.projection(x.epsg) && x.epsg !== cur?.epsg && x.epsg !== 3857)];
    const keep = crs.value;
    crs.replaceChildren(...ok.map((x) => h('option', { value: String(x.epsg) }, `EPSG:${x.epsg} ${x.name}${x.why === 'in use' ? ' (in use)' : ''}`)));
    if (ok.some((x) => String(x.epsg) === keep)) crs.value = keep;
    showGrid();
  };
  const showGrid = () => {
    const p = GM.projection(+crs.value);
    if (!p || lat.value === '') return;
    const [e, n] = p.forward(+lon.value, +lat.value);
    grid.textContent = `The model origin will be E ${e.toFixed(3)}  N ${n.toFixed(3)} in EPSG:${crs.value}. Nothing in the model moves.`;
  };
  crs.onchange = showGrid;
  const map = slippy(box, {
    center: start || [10, 30],
    zoom: start ? 16 : 2,
    pin: start,
    onPick: (lo2, la2) => ((lat.value = fmt(la2)), (lon.value = fmt(lo2)), update()),
  });
  for (const i of [lat, lon]) i.onchange = () => lat.value !== '' && lon.value !== '' && ((map.s.pin = map.s.center = [+lon.value, +lat.value]), map.s.zoom < 12 && (map.s.zoom = 16), map.draw(), update());
  const body = h(
    'div.panel.form',
    { style: { padding: 0 } },
    h('div.row', {}, ...layerBtns),
    box,
    h('div.row', {}, h('label.field.grow', {}, h('span', {}, 'Latitude'), lat), h('label.field.grow', {}, h('span', {}, 'Longitude'), lon), h('label.field', {}, h('span', {}, 'Elevation'), elev)),
    h('label.field', {}, h('span', {}, 'Coordinate system'), crs),
    grid,
  );
  const done = app.ui.modal('Base point from a map', body, [['Set base point', 'go'], ['Cancel', null]]);
  requestAnimationFrame(map.draw); // the box has its size once the dialog shows
  if (start) update();
  if ((await done) !== 'go') return;
  if (lat.value === '' || lon.value === '') return app.ui.toast('Click the map to place the base point first.', 'danger');
  try {
    const epsg = +crs.value;
    const name = crs.selectedOptions[0]?.textContent.replace(/^EPSG:\d+ /, '').replace(/ \(in use\)$/, '');
    if (epsg && epsg !== cur?.epsg) await app.reg.run('set_coordinate_system', { epsg, name });
    const r = await app.reg.run('set_base_point', { latitude: +lat.value, longitude: +lon.value, z: +elev.value || 0 });
    if (overlayOf(app.store.doc).map === 'none') await app.reg.run('set_view_overlay', { map: map.s.layer });
    app.ui.toast(`Base point E ${r.base[0]} N ${r.base[1]} (EPSG:${r.crs.epsg})`);
  } catch (e) {
    app.ui.toast(e.message, 'danger');
  }
}

/** The ground map, the coordinate grid and its labels in the 3D view, and the layer chooser. */
export class GroundMap {
  constructor(app) {
    this.app = app;
    const vp = app.viewport;
    this.tiles = new THREE.Group();
    this.tiles.name = 'ground-map';
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2f6fb8, transparent: true, opacity: 0.55, depthWrite: false }));
    this.lines.renderOrder = -15;
    this.lines.frustumCulled = false;
    vp.scene.add(this.tiles, this.lines);
    this.cache = new Map(); // tile url → texture
    this.loader = new THREE.TextureLoader();
    this.loader.setCrossOrigin('anonymous');
    const wrap = vp.canvas.parentElement;
    this.attrib = h('div.view-attrib', { hidden: true });
    this.chooser = h('div.layer-chooser');
    wrap.append(this.attrib, this.chooser);
    this.open = false;
    this.key = '';
    app.store.on(() => this.sync());
    vp.listeners.add(() => this.frame());
    this.sync();
  }
  sync() {
    const doc = this.app.store.doc;
    const o = overlayOf(doc);
    const pl = placerOf(doc);
    const vp = this.app.viewport;
    if (o.map !== 'none' || o.grid) vp.grid.visible = false; // the map or the coordinate grid is the ground now
    const key = JSON.stringify([o.map, o.radius, pl?.origin, doc.geo?.base, doc.geo?.crs?.epsg]);
    if (key !== this.key) (this.key = key), this.buildTiles(o, pl);
    for (const m of this.tiles.children) (m.material.opacity = o.opacity), (m.material.transparent = o.opacity < 1);
    this.lines.material.color.set(o.map === 'imagery' ? 0xffffff : 0x2f6fb8); // white reads on photos
    this.lines.material.opacity = o.map === 'imagery' ? 0.75 : 0.55;
    this.attrib.hidden = o.map === 'none' || !pl;
    this.attrib.textContent = o.map !== 'none' ? GM.LAYERS[o.map].attribution : '';
    this.gridKey = null;
    this.drawChooser(o, pl);
    vp.dirty = true;
  }
  buildTiles(o, pl) {
    for (const m of this.tiles.children) m.geometry.dispose(), m.material.dispose();
    this.tiles.clear();
    if (o.map === 'none' || !pl) return;
    const [lon0, lat0] = pl.origin;
    const t = GM.tilesAround(lon0, lat0, o.radius, 8, GM.LAYERS[o.map].max);
    const n = 2 ** t.z;
    for (let y = t.y0; y <= t.y1; y++)
      for (let x = t.x0; x <= t.x1; x++) {
        const c = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([a, b]) => pl.toLocal(...GM.tileToLonLat(a, b, t.z)));
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap(([px, pz]) => [px, -0.004, pz]), 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
        g.setIndex([0, 3, 1, 1, 3, 2]);
        const url = GM.tileUrl(o.map, t.z, ((x % n) + n) % n, y);
        let tex = this.cache.get(url);
        if (!tex) {
          tex = this.loader.load(url, () => (this.app.viewport.dirty = true), undefined, () => console.warn(`map tile failed: ${url}`));
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          this.cache.set(url, tex);
        }
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, toneMapped: false }));
        m.renderOrder = -30; // under the drawing grid, underlays and the model
        this.tiles.add(m);
      }
  }
  /** Each frame: the grid around what the camera looks at, and its labels on the label layer. */
  frame() {
    const doc = this.app.store.doc;
    const o = overlayOf(doc);
    const base = doc.geo?.base;
    this.lines.visible = !!(o.grid && base);
    if (!this.lines.visible || this.app.viewport.rendering) return;
    const vp = this.app.viewport;
    const t = vp.controls.target;
    const span = Math.max(5, vp.camera.isOrthographicCamera ? (vp.camera.top - vp.camera.bottom) / vp.camera.zoom : vp.camera.position.distanceTo(t) * 1.4);
    const step = GM.gridStep(span * 2, 10);
    const [e0, n0] = [base[0] + t.x, base[1] - t.z];
    const es = GM.gridValues(e0 - span * 1.5, e0 + span * 1.5, step);
    const ns = GM.gridValues(n0 - span * 1.5, n0 + span * 1.5, step);
    const gk = `${step}|${es[0]}|${ns[0]}|${es.length}|${ns.length}`;
    if (gk !== this.gridKey) {
      this.gridKey = gk;
      const y = 0.003;
      const [x0, x1] = [es[0] - base[0], es.at(-1) - base[0]];
      const [z0, z1] = [-(ns[0] - base[1]), -(ns.at(-1) - base[1])];
      const pos = [...es.flatMap((e) => [e - base[0], y, z0, e - base[0], y, z1]), ...ns.flatMap((n) => [x0, y, -(n - base[1]), x1, y, -(n - base[1])])];
      this.lines.geometry.dispose();
      this.lines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.gridLines = { es, ns, x0, x1, z0, z1, step };
      vp.dirty = true;
    }
    this.drawLabels(base);
  }
  drawLabels(base) {
    const c = document.getElementById('label-layer');
    const vp = this.app.viewport;
    const L = this.gridLines;
    if (!c || !L) return;
    const lr = c.getBoundingClientRect();
    const r = vp.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, (r.left - lr.left) * dpr, (r.top - lr.top) * dpr);
    g.font = '600 11px "Open Sans", system-ui, sans-serif';
    g.textBaseline = 'middle';
    const v = new THREE.Vector3();
    const screen = (x, z) => (v.set(x, 0.003, z).project(vp.camera), v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 ? [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height] : null);
    // each line is labelled where it is lowest on screen (Eastings) or leftmost (Northings), inside the view; a label
    // that would cover another is left out
    const taken = [];
    const ch = this.chooser.getBoundingClientRect(); // nor under the layer button
    const under = (x, y, w) => x + r.left < ch.right && x + w + r.left > ch.left && y + r.top + 8 > ch.top && y + r.top - 8 < ch.bottom;
    const label = (text, pts, pick) => {
      let best = null;
      for (const p of pts) if (p && (!best || pick(p, best))) best = p;
      if (!best) return;
      const w = g.measureText(text).width;
      const x = Math.max(4, Math.min(r.width - w - 4, best[0] - w / 2));
      const y = Math.max(10, Math.min(r.height - 22, best[1]));
      if (under(x, y, w) || taken.some(([a, b, c]) => x < a + c + 6 && a < x + w + 6 && Math.abs(y - b) < 14)) return;
      taken.push([x, y, w]);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(text, x, y);
      g.fillStyle = '#1f4f7a';
      g.fillText(text, x, y);
    };
    const S = 40;
    for (const e of L.es) label(GM.gridLabel('E', e, L.step), Array.from({ length: S + 1 }, (_, i) => screen(e - base[0], L.z0 + ((L.z1 - L.z0) * i) / S)), (p, b) => p[1] > b[1]);
    for (const n of L.ns) label(GM.gridLabel('N', n, L.step), Array.from({ length: S + 1 }, (_, i) => screen(L.x0 + ((L.x1 - L.x0) * i) / S, -(n - base[1]))), (p, b) => p[0] < b[0]);
  }
  /** The layer button: one tile showing the current layer; open, a tile per layer, None and the grid. */
  drawChooser(o, pl) {
    const app = this.app;
    const thumb = (layer) => {
      if (!GM.LAYERS[layer]) return h('span.layer-thumb.none', {}, icon('prohibit'));
      const [lon, lat] = pl?.origin || [10, 30];
      const z = pl ? 15 : 2;
      const t = GM.lonLatToTile(lon, lat, z);
      return h('img.layer-thumb', { src: GM.tileUrl(layer, z, Math.floor(t.x), Math.floor(t.y)), alt: '' });
    };
    const set = (args) => app.reg.run('set_view_overlay', args).catch((e) => app.ui.toast(e.message, 'danger'));
    const tile = (label, inner, pressed, onclick, title) => h('button.layer-tile', { type: 'button', 'aria-pressed': String(pressed), title, onclick }, inner, h('span', {}, label));
    if (!this.open) {
      this.chooser.replaceChildren(tile('Layers', o.map !== 'none' ? thumb(o.map) : h('span.layer-thumb.none', {}, icon('stack')), false, () => ((this.open = true), this.drawChooser(o, pl)), 'Background map and coordinate grid'));
      return;
    }
    this.chooser.replaceChildren(
      ...Object.entries(GM.LAYERS).map(([k, l]) => tile(l.name, thumb(k), o.map === k, () => (pl ? set({ map: k }) : set({ map: k }).then(() => pickLocation(app))), pl ? `${l.name} under the model` : 'Place the model first: the map opens to pick its base point')),
      tile('None', thumb('none'), o.map === 'none', () => set({ map: 'none' })),
      tile('Grid', h('span.layer-thumb.none', {}, icon('grid-four')), o.grid, () => set({ grid: !o.grid }), app.store.doc.geo?.base ? 'Easting / Northing grid with labels' : 'Needs a base point'),
      ...(pl ? [] : [tile('Place…', h('span.layer-thumb.none', {}, icon('map-pin')), false, () => pickLocation(app), 'Pick the base point on a map')]),
      h('button.btn.icon.sm.layer-close', { type: 'button', 'aria-label': 'Close layers', onclick: () => ((this.open = false), this.drawChooser(o, pl)) }, icon('x')),
    );
  }
}

/**
 * The design's web map and feature layers (#264, #265, #266): OGC WMTS / API - Tiles / WMS / XYZ tiles and WFS / OGC
 * API - Features vectors, streamed around what the camera looks at, in the project's coordinate system. Requests go
 * through the main process (keys, cache, offline). Bottom of the list draws first.
 */
export class MapLayers {
  constructor(app) {
    this.app = app;
    const vp = app.viewport;
    this.root = new THREE.Group();
    this.root.name = 'map-layers';
    vp.scene.add(this.root);
    this.groups = new Map(); // layer id → { key, group, center, radius }
    this.textures = new Map(); // tile url → Promise<texture>
    this.features = new Map(); // layer id + area → GeoJSON
    this.errors = new Map(); // layer id → last error
    this.attrib = h('div.view-attrib.map-layers-attrib', { hidden: true });
    vp.canvas.parentElement.append(this.attrib);
    app.store.on(() => this.sync());
    vp.listeners.add(() => (this.follow(), this.paint()));
    this.sync();
  }
  get list() {
    return this.app.store.doc.settings.map_layers || [];
  }
  /** Where the view looks and how far: the area to stream. */
  view() {
    const vp = this.app.viewport;
    const t = vp.controls.target;
    const span = vp.camera.isOrthographicCamera ? (vp.camera.top - vp.camera.bottom) / vp.camera.zoom : vp.camera.position.distanceTo(t) * 1.2;
    return { x: t.x, z: t.z, radius: Math.max(60, Math.min(4000, span)) };
  }
  sync() {
    const pl = placerOf(this.app.store.doc);
    const keep = new Set();
    this.list.forEach((L, i) => {
      keep.add(L.id);
      let g = this.groups.get(L.id);
      const key = JSON.stringify([L.url, L.layer, L.type, L.style, L.where, L.cql, L.format, pl?.origin, this.app.store.doc.geo?.base]);
      if (!g) this.groups.set(L.id, (g = { group: new THREE.Group(), key: null }));
      if (!g.group.parent) this.root.add(g.group);
      g.group.visible = L.visible !== false && !!pl;
      g.group.renderOrder = -29 + i;
      for (const m of g.group.children) for (const o of [m, ...m.children]) if (o.material) (o.material.opacity = (o.userData.alpha ?? 1) * (L.opacity ?? 1)), (o.material.transparent = true), (o.renderOrder = -29 + i);
      if (g.key !== key) (g.key = key), (g.area = null);
    });
    for (const [id, g] of this.groups) if (!keep.has(id)) this.clear(g), g.group.removeFromParent(), this.groups.delete(id);
    const shown = this.list.filter((L) => L.visible !== false && L.attribution);
    this.attrib.hidden = !shown.length || !pl;
    this.attrib.textContent = [...new Set(shown.map((L) => L.attribution))].join(' · ');
    this.follow(true);
    this.app.viewport.dirty = true;
  }
  clear(g) {
    for (const m of g.group.children) m.traverse((o) => (o.geometry?.dispose(), o.material?.dispose()));
    g.group.clear();
  }
  /** Each frame: when the view moved well away from what a layer streamed, stream again. */
  follow(force = false) {
    const pl = placerOf(this.app.store.doc);
    if (!pl || !this.list.length || this.app.viewport.rendering) return;
    if (this.list.some((L) => L.visible !== false)) this.app.viewport.grid.visible = false; // the map is the ground now
    const v = this.view();
    for (const L of this.list) {
      const g = this.groups.get(L.id);
      if (!g || L.visible === false) continue;
      const a = g.area;
      if (!force && a && Math.hypot(v.x - a.x, v.z - a.z) < a.radius * 0.35 && v.radius < a.radius * 1.6 && v.radius > a.radius * 0.45) continue;
      if (a && !force && g.pending) continue;
      g.area = { ...v, radius: L.kind === 'features' ? Math.min(v.radius * 1.2, 800) : v.radius * 1.5 };
      g.pending = true;
      (L.kind === 'features' ? this.streamFeatures(L, g, pl) : this.streamTiles(L, g, pl))
        .then(() => this.errors.delete(L.id))
        .catch((e) => {
          if (!this.errors.has(L.id)) this.app.ui.toast(`${L.name}: ${e.message}`, 'danger');
          this.errors.set(L.id, e.message);
        })
        .finally(() => ((g.pending = false), (this.app.viewport.dirty = true)));
    }
  }
  texture(L, url) {
    if (!this.textures.has(url))
      this.textures.set(
        url,
        this.app.io.ogcGet(url, { binary: true, service: L.service }).then(async (r) => {
          const bmp = await createImageBitmap(new Blob([r.bytes], { type: r.type || 'image/png' }), { imageOrientation: 'flipY' });
          const tex = new THREE.Texture(bmp);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          tex.flipY = false;
          tex.needsUpdate = true;
          return tex;
        }),
      );
    return this.textures.get(url);
  }
  async streamTiles(L, g, pl) {
    const a = g.area;
    const [lon, lat] = pl.toLonLat(a.x, a.z);
    const t = GM.tilesAround(lon, lat, a.radius, 8, L.max_zoom ?? 20);
    const n = 2 ** t.z;
    const meshes = [];
    const jobs = [];
    for (let y = t.y0; y <= t.y1; y++)
      for (let x = t.x0; x <= t.x1; x++) {
        const url = OGC.tileUrl(L, t.z, ((x % n) + n) % n, y);
        if (!url) continue;
        const c = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([p, q]) => pl.toLocal(...GM.tileToLonLat(p, q, t.z)));
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap(([px, pz]) => [px, -0.003, pz]), 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
        geo.setIndex([0, 3, 1, 1, 3, 2]);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: L.opacity ?? 1, depthWrite: false, toneMapped: false, visible: false }));
        m.renderOrder = g.group.renderOrder;
        meshes.push(m);
        jobs.push(this.texture(L, url).then((tex) => ((m.material.map = tex), (m.material.visible = true), (m.material.needsUpdate = true), (this.app.viewport.dirty = true)), () => null));
      }
    if (!meshes.length) throw new Error(`no tiles at zoom ${t.z} for this layer`);
    this.clear(g);
    g.group.add(...meshes);
    const done = await Promise.all(jobs);
    if (done.every((x) => x === null)) throw new Error('the service sent no tiles here');
  }
  async streamFeatures(L, g, pl) {
    const a = g.area;
    const corners = [[a.x - a.radius, a.z - a.radius], [a.x + a.radius, a.z + a.radius]].map(([p, q]) => pl.toLonLat(p, q));
    const bbox = [Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]), Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1])];
    // pages of 1000 (servers cap a page), up to 5000 features around the view
    const fc = { type: 'FeatureCollection', features: [] };
    const seen = new Set();
    let url = OGC.featuresUrl(L, bbox, { limit: 1000, where: L.where, cql: L.cql });
    for (let page = 0; url && page < 5; page++) {
      const part = JSON.parse((await this.app.io.ogcGet(url, { service: L.service })).text);
      if (!part.features) throw new Error('the service did not send GeoJSON features');
      OGC.fixAxes(part, bbox);
      const fresh = OGC.addPage(fc.features, seen, part.features);
      // servers may send fewer than a page and still have more: page on until an empty one
      url = L.type === 'ogcapi-features' ? OGC.nextLink(part) : fresh ? OGC.featuresUrl(L, bbox, { limit: 1000, start: (page + 1) * 1000, where: L.where }) : null;
    }
    const style = typeof L.style === 'object' && L.style ? L.style : {};
    const lines = new Map(); // colour → positions
    const pts = new Map();
    const fills = [];
    const labels = [];
    const local = (c) => pl.toLocal(c[0], c[1]);
    const add = (map, col, arr) => map.set(col, [...(map.get(col) || []), ...arr]);
    for (const f of fc.features) {
      const s = OGC.styleFor(style, f.properties || {});
      const stroke = s.stroke || '#d9480f';
      const parts = !f.geometry ? [] : f.geometry.type === 'GeometryCollection' ? f.geometry.geometries : [f.geometry];
      for (const gm of parts) {
        const c = gm.coordinates;
        const ring = (r2) => {
          const p = r2.map(local);
          add(lines, stroke, p.slice(1).flatMap((q, i) => [p[i][0], 0.02, p[i][1], q[0], 0.02, q[1]]));
          return p;
        };
        if (gm.type === 'Point' || gm.type === 'MultiPoint') for (const q of gm.type === 'Point' ? [c] : c) add(pts, s.point || stroke, [local(q)[0], 0.03, local(q)[1]]);
        else if (gm.type === 'LineString') ring(c);
        else if (gm.type === 'MultiLineString') c.forEach(ring);
        else if (gm.type === 'Polygon' || gm.type === 'MultiPolygon')
          for (const poly of gm.type === 'Polygon' ? [c] : c) {
            const rings = poly.map(ring);
            if (s.fill) fills.push({ rings, fill: s.fill, alpha: s.fill_opacity ?? 0.25 });
          }
        if (s.label && f.properties?.[s.label] !== undefined) {
          const ring = gm.type === 'Polygon' ? c[0].slice(0, -1) : gm.type === 'MultiPolygon' ? c[0][0].slice(0, -1) : null;
          const first = gm.type === 'Point' ? c : ring ? [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length] : gm.type === 'LineString' ? c[Math.floor(c.length / 2)] : null; // polygons: labelled at the middle of their outline
          if (first) labels.push({ at: local(first), text: String(f.properties[s.label]) });
        }
      }
    }
    this.clear(g);
    const order = g.group.renderOrder;
    for (const { rings, fill, alpha } of fills) {
      const shape = new THREE.Shape(rings[0].map(([x, z]) => new THREE.Vector2(x, -z)));
      shape.holes = rings.slice(1).map((r2) => new THREE.Path(r2.map(([x, z]) => new THREE.Vector2(x, -z))));
      const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.01, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: alpha * (L.opacity ?? 1), depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.userData.alpha = alpha;
      m.renderOrder = order;
      g.group.add(m);
    }
    for (const [col, pos] of lines) {
      const o = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: L.opacity ?? 1, depthWrite: false }));
      o.renderOrder = order;
      o.frustumCulled = false;
      g.group.add(o);
    }
    for (const [col, pos] of pts) {
      const o = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), new THREE.PointsMaterial({ color: col, size: style.size ?? 7, sizeAttenuation: false, transparent: true, opacity: L.opacity ?? 1, depthWrite: false }));
      o.renderOrder = order;
      g.group.add(o);
    }
    g.labels = labels.slice(0, 300);
    g.count = fc.features.length;
  }
  /** Feature labels on the label layer, after the point and grid labels. */
  paint() {
    const c = document.getElementById('label-layer');
    const vp = this.app.viewport;
    if (!c || vp.rendering || !this.list.some((L) => this.groups.get(L.id)?.labels?.length)) return;
    const lr = c.getBoundingClientRect();
    const r = vp.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const g2d = c.getContext('2d');
    g2d.setTransform(dpr, 0, 0, dpr, (r.left - lr.left) * dpr, (r.top - lr.top) * dpr);
    g2d.font = '600 11px "Open Sans", system-ui, sans-serif';
    g2d.textBaseline = 'middle';
    const v = new THREE.Vector3();
    for (const L of this.list) {
      const g = this.groups.get(L.id);
      if (!g?.labels?.length || L.visible === false) continue;
      for (const { at, text } of g.labels) {
        v.set(at[0], 0.03, at[1]).project(vp.camera);
        if (v.z >= 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
        const [x, y] = [((v.x + 1) / 2) * r.width + 5, ((1 - v.y) / 2) * r.height];
        g2d.lineWidth = 3;
        g2d.strokeStyle = 'rgba(255,255,255,0.9)';
        g2d.strokeText(text, x, y);
        g2d.fillStyle = '#5c2a0c';
        g2d.fillText(text, x, y);
      }
    }
  }
}
