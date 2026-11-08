// Labels over the 3D view (#117, #131): survey point names / elevations / codes and alignment stations, drawn on a 2D
// canvas after each render, decluttered so they never pile up on each other.
import * as THREE from 'three';

const MAX = 1500;

export function drawLabels(app) {
  const c = document.getElementById('label-layer');
  if (!c) return;
  const vp = app.viewport;
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) (c.width = Math.round(r.width * dpr)), (c.height = Math.round(r.height * dpr));
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  if (vp.rendering) return; // not in rendered video frames
  const doc = app.store.doc;
  const mode = doc.settings.point_labels ?? 'name';
  g.scale(dpr, dpr);
  g.font = '600 11px "Open Sans", system-ui, sans-serif';
  g.textBaseline = 'middle';
  const taken = new Set();
  const cell = 12;
  const free = (x, y, w) => {
    const keys = [];
    for (let i = Math.floor(x / cell); i <= Math.floor((x + w) / cell); i++) keys.push(`${i},${Math.floor(y / cell)}`);
    if (keys.some((k) => taken.has(k))) return false;
    keys.forEach((k) => taken.add(k));
    return true;
  };
  const v = new THREE.Vector3();
  const tagOn = new Map(doc.tags.map((t) => [t.name, t.visible]));
  let n = 0;
  const label = (p, text, color) => {
    v.set(p[0], p[1], p[2]).project(vp.camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return;
    const x = ((v.x + 1) / 2) * r.width + 6;
    const y = ((1 - v.y) / 2) * r.height - 6;
    const w = g.measureText(text).width;
    if (!free(x, y, w)) return;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
    n++;
  };
  if (mode !== 'none')
    for (const e of doc.entities) {
      if (n > MAX) break;
      if (e.type !== 'point' || !e.visible || tagOn.get(e.tag) === false) continue;
      const pt = e.point;
      const text = mode === 'code' ? pt.code : mode === 'name_z' ? `${e.name}  ${pt.z.toFixed(3)}` : mode === 'all' ? `${e.name} ${pt.code} ${pt.z.toFixed(2)}` : e.name;
      if (text) label(e.position, text, '#1e3a4c');
    }
  // major contours: their elevation at the middle of the line (#121)
  const groups = new Map(doc.entities.filter((e) => e.contours).map((g) => [g.id, g]));
  for (const e of doc.entities) {
    if (n > MAX || !e.curve || !e.meta?.major || !groups.has(e.parent) || !e.visible || tagOn.get(e.tag) === false || !groups.get(e.parent).visible) continue;
    const pts = e.curve.points;
    const p = pts[Math.floor(pts.length / 2)];
    label([p[0] + e.position[0], p[1] + e.position[1], p[2] + e.position[2]], e.meta.elevation.toFixed(1), '#6b4e2e');
  }
  // dimension and label texts (#50, #51): always drawn, on a white plate
  for (const e of doc.entities) {
    const a = e.annotation;
    if (!a?.text_now || !a.at || !e.visible || tagOn.get(e.tag) === false) continue;
    v.set(...a.at).project(vp.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
    const x = ((v.x + 1) / 2) * r.width;
    const y = ((1 - v.y) / 2) * r.height;
    g.font = '600 12px "Open Sans", system-ui, sans-serif';
    const lines = a.text_now.split('\n');
    const w = Math.max(...lines.map((t) => g.measureText(t).width));
    const x0 = a.type === 'label' ? x + 4 : x - w / 2;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(x0 - 3, y - 9, w + 6, 16 * lines.length + 2);
    g.fillStyle = app.viewport.selection?.includes?.(e.id) ? '#c8553d' : '#1d262c';
    lines.forEach((t, i) => g.fillText(t, x0, y + i * 16));
    g.font = '600 11px "Open Sans", system-ui, sans-serif';
  }
  // alignment stations: 0+000, 0+020, …
  for (const e of doc.entities) {
    if (!e.alignment || !e.curve || !e.visible) continue;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...e.position), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    const pts = e.curve.points.map((p) => new THREE.Vector3(...p).applyMatrix4(m));
    const step = e.alignment.interval || 20;
    const start = e.alignment.start_station || 0;
    let s = 0;
    let next = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      if (s + 1e-6 >= next) {
        const st = start + next;
        label(pts[i].toArray(), `${Math.floor(st / 1000)}+${String(Math.round(st % 1000)).padStart(3, '0')}`, '#c8553d');
        next += step;
      }
    }
  }
}
