// The model on a map: pick the base point on a web map (lat/long → set_base_point), and over the 3D view's ground a
// background map and an Easting / Northing grid with labels, chosen from a small layer button at the bottom left
// (set_view_overlay). Tiles load straight from the tile servers; their attribution stays on screen.
import * as THREE from 'three';
import * as GM from '../core/geomap.js';
import { h, icon } from './ui.js';

const TILE = 256;
const overlayOf = (doc) => ({ map: 'none', grid: false, radius: 300, opacity: 1, ...doc.settings.view_overlay });
const placerOf = (doc) => GM.placer({ base: doc.geo?.base, epsg: doc.geo?.crs?.epsg, geolocation: doc.settings.geolocation });

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
