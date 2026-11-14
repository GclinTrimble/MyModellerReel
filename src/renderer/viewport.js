// The 3D viewport: turns the document into three.js objects, renders, picks, and shows animation poses.
import * as THREE from 'three';
import { stage } from './render.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as G from '../core/geometry.js';
import * as D from '../core/document.js';
import * as A from '../core/animation.js';
import { samplePoints, dashify } from '../core/curves.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import * as SEC from '../core/section.js';
import * as CV from '../core/clip.js';
import * as CS from './clipshader.js';
import { Presentation, applyMaps, styleMaterial, sketchEdges, lightObject, seamless, defaultSky } from './presentation.js';
import * as L from '../core/layers.js';
import { textureFor, underlayGeometry, rasterOf } from './underlays.js';
import { bvh, cloudObject, cloudSnaps, underlaySnaps, Gizmo, floorAt } from './scale.js';
import { attachClouds, syncClouds } from './cloudmaterial.js';
import { invert as invertAffine } from '../core/underlay.js';
import { isSurface } from '../core/project.js';
import { viewDirection } from '../core/layout.js';
import { lineworkOffsets } from '../core/survey.js';
import { CloudLOD, clipPlanes } from './cloudlod.js';

const D2R = Math.PI / 180;
/** Where a survey point waits while the timeline has it hidden (#283): off the model, but a real number. */
const PARKED = 1e6;
export const AXIS_COLORS = { x: 0xd2453c, y: 0x2f6fb8, z: 0x3c9a4e }; // red, blue (up), green
const EDGE_COLOR = 0x1d262c;
const PROPOSAL_COLOR = '#e8bc5e';

export function meshGeometry(mesh) {
  const b = G.toBuffers(mesh);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
  if (b.color) g.setAttribute('color', new THREE.BufferAttribute(b.color, 3)); // sRGB-ish face colours, shown as given
  g.userData.triFace = b.triFace;
  return bvh(g);
}

export function makeMaterial(m, opts = {}) {
  const physical = m.transmission > 0 || m.clearcoat > 0;
  const mat = new (physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
    ...(physical ? { transmission: m.transmission || 0, ior: m.ior ?? 1.5, thickness: m.thickness ?? 0.01, clearcoat: m.clearcoat || 0, clearcoatRoughness: m.clearcoat_roughness ?? 0.1 } : {}),
    emissiveIntensity: m.emissive_intensity ?? 1,
    color: m.color,
    roughness: m.roughness ?? 0.85,
    metalness: m.metalness ?? 0,
    emissive: m.emissive || '#000000',
    side: THREE.DoubleSide,
    transparent: m.opacity < 1 || !!opts.xray,
    opacity: opts.xray ? Math.min(m.opacity, 0.45) : m.opacity,
    depthWrite: !(opts.xray || m.opacity < 1),
    clipShadows: true, // a section plane cuts the shadows too
    polygonOffset: true,
    polygonOffsetFactor: opts.flat ? -2 : 1, // lone faces win over the face they were drawn on; edges win over faces
    polygonOffsetUnits: opts.flat ? -2 : 1,
    vertexColors: !!opts.vertexColors,
  });
  if (opts.facets) facetShade(mat);
  return mat;
}

/**
 * Surfaces: a faint hillshade per triangle on top of the matte lighting. Near-level triangles all catch the sky the
 * same, so slope is exaggerated (×3) and lit from the sun's side, 45° up; at most ±FACET of the colour changes.
 */
const FACET = 0.14;
const FACET_LIGHT = { value: new THREE.Vector3(-0.5, 0.7071, -0.5) };
function facetShade(mat) {
  mat.customProgramCacheKey = () => 'facets';
  mat.onBeforeCompile = (s) => {
    s.uniforms.facetLight = FACET_LIGHT;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacetN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvFacetN = mat3(modelMatrix) * objectNormal;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFacetN;\nuniform vec3 facetLight;').replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      vec3 fn = normalize(vFacetN) * (gl_FrontFacing ? 1.0 : -1.0);
      fn = normalize(vec3(fn.x * 3.0, fn.y, fn.z * 3.0));
      float hill = dot(fn, facetLight);
      gl_FragColor.rgb *= 1.0 + ${FACET.toFixed(2)} * clamp((hill - 0.7071) / 0.2929, -1.0, 1.0);`,
    );
  };
}

export function applyTransform(obj, e) {
  obj.position.fromArray(e.position);
  obj.rotation.set(e.rotation[0] * D2R, e.rotation[1] * D2R, e.rotation[2] * D2R);
  obj.scale.fromArray(e.scale);
}

let RING = null;
/** A ring sprite for the tied-vertex marks (drawn once). */
function ringTexture() {
  if (RING) return RING;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(16, 16, 12, 0, Math.PI * 2);
  g.stroke();
  return (RING = new THREE.CanvasTexture(c));
}

/**
 * Build the object tree for a document. Used by the viewport and by exporters (edges: false).
 * cache (the viewport's): geometry per mesh object, so an edit re-uploads only the shapes it changed.
 */
/** A surface's geometry with UVs onto an underlay's picture (#132): each vertex looks up its spot on the drawing. */
function drapedGeometry(geometry, e, u) {
  const g = geometry.clone();
  const pos = g.attributes.position;
  const inv = invertAffine(u.underlay.affine);
  const [ox, , oz] = e.position;
  const up = u.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const X = pos.getX(i) + ox - up[0];
    const Y = -(pos.getZ(i) + oz - up[2]);
    const s = inv[0] * X + inv[1] * Y + inv[2];
    const t = inv[3] * X + inv[4] * Y + inv[5];
    uv[i * 2] = s / u.underlay.size[0];
    uv[i * 2 + 1] = 1 - t / u.underlay.size[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A curve drawn with its line type (dashes) and weight (mm → px), ByLayer (#156). */
function styledLine(doc, e, pts, clipping, fat = true) {
  const color = L.colorOf(doc, e);
  const st = L.lineStyle(doc, e);
  if (!fat) st.weight = 0; // exports: plain lines (fat lines are meshes of quads)
  if (!st.pattern.length && !(st.weight > 0.3)) return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color, clippingPlanes: clipping }));
  const segs = dashify(pts, st.pattern);
  const px = Math.max(1, st.weight * 4);
  if (px <= 1.2 || !fat) return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs.flat().map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color, clippingPlanes: clipping }));
  const g = new LineSegmentsGeometry().setPositions(segs.flat(2));
  return new LineSegments2(g, new LineMaterial({ color, linewidth: px, clippingPlanes: clipping }));
}

export function buildModel(doc, { edges = true, xray = false, wireframe = false, clipping = [], cache = null, underlay = null, fat = false, style = 'shaded', dirty = () => {} } = {}) {
  const styled = style !== 'shaded' && style;
  if (styled === 'hidden_line' || styled === 'sketchy') edges = true;
  const root = new THREE.Group();
  root.name = 'Model';
  const objs = new Map();
  const tagVisible = new Map(doc.tags.map((t) => [t.name, t.visible]));
  // shortcut: keyed by the mesh object; commands always replace e.mesh, a script that edits one in place is not seen
  const geo = (mesh) => {
    if (!cache) return { geometry: meshGeometry(mesh), edges: null };
    let c = cache.map.get(mesh);
    if (!c) cache.map.set(mesh, (c = { geometry: meshGeometry(mesh), edges: null }));
    cache.used.add(c);
    return c;
  };
  // a symbol tinted by an attribute (S.symbolTransform): its parts take the colour, the shared definition does not
  const tints = new Map();
  for (const t of doc.entities) if (t.tint) for (const d of D.descendants(doc, t.id)) tints.set(d.id, t.tint);
  for (let e of doc.entities) {
    if (tints.has(e.id)) e = { ...e, material: { ...e.material, color: tints.get(e.id) }, byLayer: false };
    let o;
    if (e.mesh) {
      const g = geo(e.mesh);
      const drape = e.drape && underlay ? doc.entities.find((x) => x.id === e.drape.underlay && x.underlay) : null;
      o = new THREE.Mesh(drape ? drapedGeometry(g.geometry, e, drape) : g.geometry, makeMaterial(e.mesh.fc && !drape ? { ...e.material, color: '#ffffff' } : e.byLayer || doc.settings.color_by === 'layer' ? { ...e.material, color: L.colorOf(doc, e) } : e.material, { xray, flat: e.mesh.f.length === 1, vertexColors: !!e.mesh.fc && !drape, facets: isSurface(e) && !drape }));
      if (drape) (o.material.map = underlay(drape).material.map), (o.material.color.set('#ffffff')), (o.userData.draped = true);
      else if (!styled) applyMaps(o, e.material, dirty);
      const sm = styled && styleMaterial(styled, { clipping });
      if (sm) (o.material.dispose(), (o.material = sm), (o.userData.styled = true));
      o.material.clippingPlanes = clipping;
      o.castShadow = o.receiveShadow = true;
      if (wireframe) o.material.visible = false;
      if (edges || wireframe) {
        const eg = (g.edges ||= withImprints(featureEdges(o.geometry), e.mesh));
        if (styled === 'sketchy') {
          o.geometry.computeBoundingSphere();
          eg.userData.sketch ||= sketchEdges(eg, Math.max(0.5, o.geometry.boundingSphere.radius));
        }
        const lines = new THREE.LineSegments(
          styled === 'sketchy' ? eg.userData.sketch : eg,
          new THREE.LineBasicMaterial({ color: styled ? '#1d1d1d' : EDGE_COLOR, clippingPlanes: clipping }),
        );
        lines.raycast = () => {};
        lines.userData.isEdges = true;
        o.add(lines);
      }
      if (e.show_triangles && !wireframe) {
        // every triangle edge over the shading, to review a TIN (show_triangles)
        const tl = new THREE.LineSegments((g.wire ||= new THREE.WireframeGeometry(g.geometry)), new THREE.LineBasicMaterial({ color: '#22313a', transparent: true, opacity: 0.6, clippingPlanes: clipping }));
        tl.raycast = () => {};
        o.add(tl);
      }
    } else if (e.pointcloud?.octree?.status === 'ready') {
      // an octree (#294): its nodes stream in under this group; the thinned preview shows until the root arrives
      o = new THREE.Group();
      o.userData.octree = true;
      o.userData.pointcloud = true;
      if (e.pointcloud.asset && e.pointcloud.count) {
        const pv = cloudObject(e);
        pv.userData.preview = true;
        o.add(pv);
      }
    } else if (e.pointcloud) {
      o = cloudObject(e);
    } else if (e.light) {
      o = lightObject(e, clipping);
      for (const c of o.children) if (c.userData.lightMarker) (c.userData.entityId = e.id), (c.geometry.userData.triFace = []);
    } else if (e.type === 'point') {
      o = new THREE.Object3D(); // drawn by the shared point cloud below; this keeps its place in the tree
      o.userData.isPoint = true;
    } else if (e.line) {
      const pts = e.line.points.map((id) => doc.entities.find((x) => x.id === id)).filter(Boolean).map((p) => new THREE.Vector3(...p.position));
      if (e.line.closed && pts.length > 2) pts.push(pts[0]);
      o = styledLine(doc, e, pts.map((p) => p.toArray()), clipping, fat);
      for (const off of lineworkOffsets(doc, e)) o.add(styledLine(doc, e, off.path, clipping, fat)); // they follow its points
      o.userData.isCurve = true;
    } else if (e.curve) {
      const sp = samplePoints(e.curve);
      o = styledLine(doc, e, e.curve.closed && sp.length > 2 && e.curve.kind === 'polyline' && G.len(G.sub(sp[0], sp.at(-1))) > 1e-9 ? [...sp, sp[0]] : sp, clipping, fat);
      o.userData.isCurve = true;
    } else if (e.underlay && underlay) o = underlay(e);
    else o = new THREE.Group();
    o.name = e.name;
    o.userData.entityId = e.id;
    if (e.meta) o.userData.meta = e.meta; // glTF extras: other tools see the metadata too
    applyTransform(o, e);
    o.visible = e.visible && tagVisible.get(e.tag) !== false;
    objs.set(e.id, o);
  }
  for (const e of doc.entities) (e.parent && objs.get(e.parent) ? objs.get(e.parent) : root).add(objs.get(e.id));
  // survey points: one point cloud for all of them (thousands of points, one draw call), coloured by code
  const pts = doc.entities.filter((e) => e.type === 'point' && objs.get(e.id).visible);
  if (pts.length) {
    const pos = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    const c = new THREE.Color();
    pts.forEach((p, i) => {
      pos.set(p.position, i * 3);
      c.set(p.material.color).toArray(col, i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const cloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    cloud.name = 'Survey points';
    cloud.renderOrder = 2;
    cloud.userData.pointIds = pts.map((p) => p.id);
    cloud.userData.colors = col.slice();
    root.add(cloud);
  }
  return { root, objs };
}

export /**
 * Crease and outline edges only. Booleans leave T-junctions, so a seam between two coplanar triangles can look
 * like a boundary; an edge is dropped when there is coplanar surface on both of its sides.
 */
function featureEdges(geo) {
  const eg = new THREE.EdgesGeometry(geo, 25);
  const tris = geo.attributes.position.count / 3;
  if (tris > 4000) return eg; // shortcut: skip the cleanup on big imports; move it to a worker if those matter
  const p = geo.attributes.position;
  const T = [];
  for (let i = 0; i < tris; i++) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i * 3);
    const b = new THREE.Vector3().fromBufferAttribute(p, i * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, i * 3 + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-14) continue;
    T.push({ tri: new THREE.Triangle(a, b, c), n: n.normalize(), d: n.dot(a) });
  }
  const covered = (q, n) => T.some((t) => Math.abs(t.n.dot(n)) > 0.9999 && Math.abs(t.n.dot(q) - t.d) < 1e-4 && t.tri.containsPoint(q));
  const e = eg.attributes.position;
  const keep = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < e.count; i += 2) {
    a.fromBufferAttribute(e, i);
    b.fromBufferAttribute(e, i + 1);
    const m = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).normalize();
    // the faces that own this edge: any triangle that contains the midpoint
    const owners = T.filter((t) => Math.abs(t.n.dot(m) - t.d) < 1e-4 && t.tri.closestPointToPoint(m, new THREE.Vector3()).distanceToSquared(m) < 1e-10);
    const interior = owners.length && owners.every((t) => {
      const side = t.n.clone().cross(dir).multiplyScalar(1e-3);
      return covered(m.clone().add(side), t.n) && covered(m.clone().sub(side), t.n);
    });
    if (!interior) keep.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  eg.dispose();
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
}

/** Add the outlines of imprinted faces to an edge geometry. */
function withImprints(edges, mesh) {
  const extra = G.imprintEdges(mesh);
  if (!extra.length) return edges;
  const old = edges.attributes.position.array;
  const pos = new Float32Array(old.length + extra.length * 6);
  pos.set(old);
  extra.forEach(([a, b], i) => pos.set([...a, ...b], old.length + i * 6));
  edges.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return edges;
}

export function skyTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Viewport {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.input = canvas; // the canvas of the pane being worked in (#162): picking and screen maths use it
    this.store = store;
    this.extra = []; // the other panes (#160), drawn after this one; see panes.js
    // alpha: render_video can leave the background transparent
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = this.skyBackground = skyTexture('#cfe1e6', '#f4efe6');
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }; // one finger draws or selects, two orbit and zoom (#113)
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('end', () => this.pushView()); // after the user orbits, pans or zooms
    this.views = [];
    this.viewAt = -1;

    this.hemi = new THREE.HemisphereLight(0xeef4f6, 0x8a7f6c, 1.6);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.18 }));
    this.ground.receiveShadow = true;
    this.ground.position.y = -0.001;
    this.grid = new THREE.GridHelper(100, 100, 0xb9b2a3, 0xd9d2c4);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.grid.position.y = -0.002;
    this.grid.material.depthWrite = false; // a drawing on the ground paints over it
    this.grid.renderOrder = -20; // before underlays (-10), so a drawing on the ground covers the grid
    this.axes = new THREE.Group();
    for (const [k, dir] of Object.entries({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] })) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...dir).multiplyScalar(60)]);
      this.axes.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: AXIS_COLORS[k] })));
      const neg = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...dir).multiplyScalar(-60)]),
        new THREE.LineDashedMaterial({ color: AXIS_COLORS[k], dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.6 }),
      );
      neg.computeLineDistances();
      this.axes.add(neg);
    }
    this.scene.add(this.ground, this.grid, this.axes);

    this.modelRoot = new THREE.Group();
    this.overlay = new THREE.Group();
    this.scene.add(this.modelRoot, this.overlay);
    this.objs = new Map();
    this.selection = [];
    this.pose = null; // animation overrides currently shown
    this.raycaster = new THREE.Raycaster();
    this.listeners = new Set();
    this.proposed = new Set(); // ids an AI proposal added or changed (tinted until accepted)
    this.look = new Presentation(this);
    attachClouds(this); // point cloud styles (#295): pane numbers, eye-dome lighting, fog focus, legends
    this.clouds = new CloudLOD(this); // point cloud octrees streamed per pane (#294)
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 5000);
    this.persp = this.camera;
    this.ghosts = new THREE.Group(); // what a proposal would remove
    this.scene.add(this.ghosts);

    this.setCamera(store.doc.camera);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.dirty && !this.rendering) this.render();
    };
    loop();
  }

  resize() {
    if (this.rendering) return; // render_video owns the size until it is done
    const r = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    this.renderer.setSize(r.width, r.height, false);
    this.setAspect(r.width / Math.max(1, r.height));
    this.dirty = true;
  }

  /** The picture's width / height, for both cameras. */
  setAspect(a) {
    this.persp.aspect = a;
    this.persp.updateProjectionMatrix();
    if (this.camera.isOrthographicCamera) this.fitOrtho();
  }
  /** The parallel camera sees what the perspective one sees at the target's distance. */
  fitOrtho() {
    const d = this.camera.position.distanceTo(this.controls.target);
    const h = 2 * d * Math.tan((this.persp.fov * Math.PI) / 360);
    const aspect = this.persp.aspect || 1;
    Object.assign(this.ortho, { left: (-h * aspect) / 2, right: (h * aspect) / 2, top: h / 2, bottom: -h / 2 });
    this.ortho.updateProjectionMatrix();
  }

  render() {
    this.dirty = false;
    const now = performance.now();
    if (this.lastFrame) this.fps = 0.9 * (this.fps || 60) + 0.1 * (1000 / Math.max(1, now - this.lastFrame));
    this.lastFrame = now;
    this.draw();
    for (const fn of this.listeners) fn();
    for (const p of this.extra) if (p.visible) this.withPane(p, () => p.draw());
  }

  /**
   * Run fn as if another pane were this one (#162): its camera, controls and canvas, so tools, picking and camera
   * commands work there. The pane keeps whichever camera (perspective or parallel) fn left it with.
   */
  withPane(p, fn) {
    if (!p || p.main) return fn();
    const keep = { camera: this.camera, controls: this.controls, persp: this.persp, ortho: this.ortho, input: this.input, paneNow: this.paneNow, mainState: this.mainState };
    if (!this.paneNow) this.mainState = keep;
    Object.assign(this, { camera: p.camera, controls: p.controls, persp: p.persp, ortho: p.ortho, input: p.canvas, paneNow: p });
    try {
      return fn();
    } finally {
      p.camera = this.camera;
      Object.assign(this, keep);
    }
  }

  /** One frame as the document wants it: projection, two-point perspective, effects; light markers not in renders. */
  draw() {
    const s = this.store.doc.settings;
    this.syncProjection();
    if (s.two_point && this.camera.isPerspectiveCamera) this.levelCamera();
    const show = !this.rendering;
    this.modelRoot.traverse((o) => o.userData.lightMarker && (o.visible = show));
    this.clipFor(1);
    const outline = this.scene.getObjectByName('Clip volumes'); // the clips' edges and handles: not in renders
    if (outline) outline.visible = show;
    this.updateClouds(this.camera, this.renderer.getSize(new THREE.Vector2()), 1);
    this.look.draw(this.store.doc);
  }

  /** The cloud nodes this pane's camera should see (#294); its clip volumes (#290) leave whole nodes out. */
  updateClouds(camera, size, pane = this.paneNow ? this.paneNow.i + 1 : 1) {
    const doc = this.store.doc;
    this.clouds.update(camera, size.x, size.y, clipPlanes(CV.clipsOf(doc).filter((c) => CV.inPane(c, pane)), doc.settings.clip_combine === 'all'));
  }

  /** The main pane's camera and target, even while another pane is being worked in. */
  mainCam() {
    return this.paneNow ? this.mainState.camera : this.camera;
  }
  mainTarget() {
    return (this.paneNow ? this.mainState.controls : this.controls).target;
  }

  /** Parallel projection (#68): an orthographic camera that frames what the perspective one did. */
  syncProjection() {
    const want = (this.paneNow ? this.paneNow.cfg.projection : this.store.doc.settings.projection) === 'parallel';
    if (want === this.camera.isOrthographicCamera) return;
    const from = this.camera;
    const to = want ? this.ortho : this.persp;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    this.camera = to;
    this.controls.object = to;
    if (want) {
      this.ortho.zoom = 1;
      this.ortho.near = -5000;
      this.ortho.far = 5000;
      this.fitOrtho();
    } else to.updateProjectionMatrix();
    this.controls.update();
  }

  /** Two-point perspective (#68): the camera looks level and the picture is shifted, so verticals stay vertical. */
  levelCamera() {
    const c = this.camera;
    const t = this.controls.target;
    c.lookAt(t.x, c.position.y, t.z);
    c.updateMatrixWorld();
    c.updateProjectionMatrix();
    const v = t.clone().project(c);
    const shift = new THREE.Matrix4().makeTranslation(0, -v.y, 0);
    c.projectionMatrix.premultiply(shift);
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
  }

  /** Rebuild everything from the document. shortcut: full rebuild per change; fine to a few thousand entities. */
  rebuild() {
    const doc = this.store.doc;
    const s = doc.settings;
    this.clipping = []; // clip volumes are drawn by the shader (clipshader.js, #290); renderer.clippingPlanes is SectionTool's preview
    this.clouds.detach(); // streamed cloud nodes outlive the rebuild
    for (const o of this.modelRoot.children) disposeTree(o, false); // geometry is cached, see below
    this.modelRoot.clear();
    this.geoCache ||= { map: new WeakMap(), live: new Set() };
    this.geoCache.used = new Set();
    const { root, objs } = buildModel(doc, { edges: s.edges, xray: s.xray, wireframe: s.wireframe, clipping: this.clipping, cache: this.geoCache, underlay: (e) => this.underlayObject(e), fat: true, style: s.render_style || 'shaded', dirty: () => (this.dirty = true) });
    this.look.sync(doc);
    // free the GPU buffers of shapes that are gone or changed
    for (const c of this.geoCache.live) if (!this.geoCache.used.has(c)) c.geometry.dispose(), c.edges?.dispose(), c.wire?.dispose();
    this.geoCache.live = this.geoCache.used;
    if (root.children.length) this.modelRoot.add(...root.children);
    this.objs = objs;
    for (const [id, o] of objs) if (o.userData.octree) this.clouds.attach(doc.entities.find((x) => x.id === id), o);
    this.clouds.sync(new Set([...objs].filter(([, o]) => o.userData.octree).map(([id]) => id)));
    if (s.section_fill !== false) for (const c of CV.slots(doc).box.concat(CV.slots(doc).slab, CV.slots(doc).plane)) this.modelRoot.add(clipCaps(doc, c));
    CS.patchTree(this.modelRoot, doc);
    syncClouds(this);
    this.grid.visible = this.axes.visible = s.grid;
    // the drawing grid follows the drawing axes (#32): turned, moved, cells of the grid step
    const ax = s.axes;
    this.grid.rotation.y = ((ax?.angle || 0) * Math.PI) / 180;
    this.grid.position.set(ax?.origin?.[0] || 0, -0.002, ax?.origin?.[2] || 0);
    const step = ax?.grid > 0 ? ax.grid : 1;
    this.grid.scale.set(step, 1, step);
    this.renderer.shadowMap.enabled = s.shadows;
    this.sun.castShadow = s.shadows;
    this.ground.visible = s.shadows;
    this.updateSun();
    this.vertexCache = null;
    if (this.pose) this.applyPose(this.pose, false);
    this.highlight(this.selection);
    this.dirty = true;
  }

  updateSun(sun = this.store.doc.settings.sun) {
    const { azimuth, elevation } = sun;
    // below the horizon it is night; low sun is warm and weak
    const k = Math.max(0, Math.min(1, elevation / 12));
    this.sun.intensity = 2.2 * k;
    this.sun.color.set(elevation < 12 ? '#ffc58a' : '#fff4e0');
    const env = this.store.doc.settings.environment;
    const preset = env?.preset || 'default';
    if (preset === 'default') this.hemi.intensity = 0.12 + 1.48 * Math.max(0, Math.min(1, (elevation + 6) / 18));
    // the plain sky follows the sun unless the environment shows its own picture
    const own = (preset === 'hdri' || ['sky', 'sunset', 'night'].includes(preset)) && env.background !== false;
    if (!own && (!this.rendering || this.scene.background)) this.scene.background = defaultSky(elevation, this.skyBackground);
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const size = box.isEmpty() ? 10 : Math.max(10, box.getSize(new THREE.Vector3()).length());
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const az = azimuth * D2R;
    const el = elevation * D2R;
    this.sun.position.set(c.x + Math.sin(az) * Math.cos(el) * size * 2, c.y + Math.sin(el) * size * 2, c.z - Math.cos(az) * Math.cos(el) * size * 2);
    this.sun.target.position.copy(c);
    FACET_LIGHT.value.set(Math.sin(az), 1, -Math.cos(az)).normalize(); // the sun's side, 45° up: it adds to the sun's shading
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -size;
    cam.right = cam.top = size;
    cam.near = 0.1;
    cam.far = size * 5;
    cam.updateProjectionMatrix();
  }

  /** Show the model as it is at an animation time: transforms, visibility, opacity, colour, camera. */
  applyPose(pose, moveCamera = true) {
    this.pose = pose;
    const doc = this.store.doc;
    for (const e of doc.entities) {
      const o = this.objs.get(e.id);
      if (!o) continue;
      const p = pose?.[e.id] || {};
      o.position.fromArray(p.position || e.position);
      const r = p.rotation || e.rotation;
      o.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
      o.scale.fromArray(p.scale || e.scale);
      const tagOn = doc.tags.find((t) => t.name === e.tag)?.visible !== false;
      o.visible = (p.visible ?? e.visible) && tagOn;
      if (o.userData.light) {
        o.userData.light.color.set(p.color || e.light.color);
        o.userData.light.intensity = o.userData.light.userData.base * (p.opacity ?? 1);
      }
      if (o.isMesh && !o.userData.underlay && !o.userData.isCurve && !o.userData.styled) {
        const op = p.opacity ?? e.material.opacity;
        o.material.opacity = doc.settings.xray ? Math.min(op, 0.45) : op;
        o.material.transparent = op < 1 || doc.settings.xray;
        o.material.depthWrite = !o.material.transparent;
        if (!o.userData.underlay && !o.userData.draped) o.material.color.set(p.color || (e.mesh?.fc ? '#ffffff' : L.colorOf(doc, e))); // colour maps show as given
        for (const c of o.children) if (c.userData.isEdges) c.material.opacity = op, (c.material.transparent = op < 1);
      }
    }
    // survey points share one point cloud, so the timeline hides them by leaving them out of it (#283: a replay
    // shows each point as it was measured). Only rebuilt when the set actually changes.
    const cloud = this.modelRoot?.getObjectByName('Survey points');
    if (cloud) {
      // a hidden point is parked far away rather than taken out, so every index into the cloud stays what it was
      // (selection colours, picking and snapping all go by index)
      const pos = cloud.geometry.attributes.position;
      cloud.userData.basePos ||= pos.array.slice();
      let moved = false;
      cloud.userData.pointIds.forEach((id, i) => {
        const away = pose?.[id]?.visible === false;
        if (away === (pos.array[i * 3 + 1] > PARKED / 2)) return;
        pos.array.set(away ? [PARKED, PARKED, PARKED] : cloud.userData.basePos.subarray(i * 3, i * 3 + 3), i * 3);
        moved = true;
      });
      if (moved) {
        pos.needsUpdate = true;
        cloud.frustumCulled = false; // its bounding sphere now holds the parked points
        cloud.geometry.boundingSphere = null;
      }
    }
    const cam = pose?.camera;
    if (moveCamera && cam) this.setCamera({ position: cam.position, target: cam.target, fov: cam.fov });
    this.dirty = true; // the clips follow the pose in clipFor()
    this.updateSun(pose?.sun || doc.settings.sun);
    this.dirty = true;
  }

  /**
   * The clip volumes for one pane (1–4), before it is drawn (#290): the shader's uniforms, and the section fill of
   * each clip shown only where that clip cuts and while the timeline does not move it (the fill is built at rest).
   */
  clipFor(pane = 1) {
    const doc = this.store.doc;
    const sl = CS.updateClipUniforms(doc, pane, this.posed());
    const at = new Map(CV.clipsOf(doc).map((c) => [c.name, c]));
    for (const o of this.modelRoot.children) {
      if (!o.userData.caps) continue;
      const c = at.get(o.userData.clipName);
      const posed = sl[c?.kind]?.find((x) => x.name === c.name);
      o.visible = !!posed && CV.inPane(c, pane) && JSON.stringify(CV.normalize(c)) === JSON.stringify(posed);
    }
    return sl;
  }
  /** The animation pose with a clip handle's drag on top (clipgizmo.js previews through clipPreview). */
  posed() {
    return this.clipPreview ? { ...this.pose, ...this.clipPreview } : this.pose;
  }
  /** The pane being drawn or worked in, 1–4. */
  paneNumber() {
    return this.paneNow ? this.paneNow.i + 1 : 1;
  }
  /** Is this world point shown in the current pane for this entity (not cut away by a clip volume)? */
  unclipped(p, entityId) {
    const doc = this.store.doc;
    if (!CV.clipsOf(doc).length) return true;
    return CV.visible(doc, p.toArray ? p.toArray() : p, { pane: this.paneNumber(), entity: entityId && D.getEntity(doc, entityId), clips: CS.posedClips(doc, this.posed()) });
  }

  /** The on-canvas handles (#67) on the one selected entity, when the gizmo is on. */
  syncGizmo() {
    const mode = this.store.doc.settings.gizmo;
    if (!mode && !this.gizmo) return;
    this.gizmo ||= new Gizmo(this, (id, t) => this.onGizmo?.(id, t));
    const o = mode && this.selection.length === 1 ? this.objs.get(this.selection[0]) : null;
    this.gizmo.sync(mode, o && !o.userData.underlay ? o : null);
  }

  /** Light up entities and draw a path ([[x, y, z], …]) without changing the selection (a surface's members). */
  peek(ids = [], path = null, closed = false) {
    this.peeked = ids.length || path ? { ids, path, closed } : null;
    this.highlight(this.selection);
  }

  /** The peek drawn again (after a rebuild): its points as bold dots, its path as a line, over everything. */
  drawPeek(doc) {
    if (this.peekGroup) this.overlay.remove(this.peekGroup), this.peekGroup.traverse((o) => o.geometry?.dispose()), (this.peekGroup = null);
    if (!this.peeked) return;
    const { ids, path, closed } = this.peeked;
    const pts = ids.map((id) => doc.entities.find((e) => e.id === id && e.type === 'point')).filter(Boolean);
    const peek = (this.peekGroup = new THREE.Group());
    const mat = { color: '#ff4f9a', depthTest: false, transparent: true }; // apart from the gold selection and the point colours
    if (pts.length) peek.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...D.worldMatrix(doc, p).elements.slice(12, 15)))), new THREE.PointsMaterial({ ...mat, size: 13, sizeAttenuation: false })));
    if (path?.length >= 2) peek.add(new (closed ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(path.map((q) => new THREE.Vector3(...q))), new THREE.LineBasicMaterial(mat)));
    peek.traverse((o) => (o.renderOrder = 3));
    this.overlay.add(peek);
  }

  highlight(ids) {
    const same = ids.length === this.selection?.length && ids.every((x, i) => x === this.selection[i]);
    if (!same) this.peeked = null; // a new selection ends a peek; a rebuild keeps it
    this.selection = ids;
    queueMicrotask(() => this.syncGizmo());
    const doc = this.store.doc;
    this.drawPeek(doc);
    const lit = new Set(this.peeked?.ids || []);
    for (const id of ids) for (const d of [id, ...D.descendants(doc, id).map((x) => x.id)]) lit.add(d);
    const cloud = this.modelRoot.children.find((o) => o.isPoints && !o.userData.pointcloud);
    if (cloud) {
      const col = cloud.geometry.attributes.color;
      col.array.set(cloud.userData.colors);
      cloud.userData.pointIds.forEach((id, i) => lit.has(id) && col.array.set([0.91, 0.74, 0.37], i * 3));
      col.needsUpdate = true;
    }
    for (const [id, o] of this.objs) {
      const ent = doc.entities.find((e) => e.id === id);
      if (!ent) continue; // just deleted: the rebuild that follows drops its object (#184: erasing lines and dimensions)
      if (o.userData.isCurve) o.material.color.set(lit.has(id) ? '#e8bc5e' : this.proposed.has(id) ? PROPOSAL_COLOR : L.colorOf(doc, ent) || '#2f6f86');
      if (o.userData.underlay) o.material.color.set(lit.has(id) ? '#f3dfb0' : '#ffffff');
      if (!o.isMesh || o.userData.underlay || o.userData.isCurve || !o.material.emissive) continue;
      const on = lit.has(id);
      const proposed = this.proposed.has(id);
      o.material.emissive.set(on ? '#2f6f86' : proposed ? PROPOSAL_COLOR : doc.entities.find((e) => e.id === id)?.material.emissive || '#000000');
      o.material.emissiveIntensity = on ? 0.35 : proposed ? 0.45 : 1;
      for (const c of o.children) if (c.userData.isEdges) c.material.color.set(on ? '#2f6f86' : EDGE_COLOR);
    }
    this.showTies(doc, ids);
    this.dirty = true;
  }

  /** Tied vertices of the selected curves (point ties): orange rings on top of the curve. */
  showTies(doc, ids) {
    if (this.tieMarks) this.scene.remove(this.tieMarks), this.tieMarks.geometry.dispose(), (this.tieMarks = null);
    const at = [];
    for (const id of ids) {
      const e = D.getEntity(doc, id);
      if (!e?.ties || !e.curve) continue;
      const m = new THREE.Matrix4().fromArray(D.worldMatrix(doc, e).elements);
      for (const t of e.ties) if (e.curve.points[t.vertex]) at.push(new THREE.Vector3(...e.curve.points[t.vertex]).applyMatrix4(m));
    }
    if (!at.length) return;
    this.tieMarks = new THREE.Points(new THREE.BufferGeometry().setFromPoints(at), new THREE.PointsMaterial({ color: 0xe0782f, size: 13, sizeAttenuation: false, depthTest: false, map: ringTexture(), transparent: true, alphaTest: 0.3 }));
    this.tieMarks.renderOrder = 996;
    this.scene.add(this.tieMarks);
  }

  /** Tint what a pending proposal adds or changes, and draw red ghosts of what it removes. */
  showProposal(diff) {
    this.proposed = new Set(diff ? [...diff.added, ...diff.changed].flatMap((id) => [id, ...D.descendants(this.store.doc, id).map((x) => x.id)]) : []);
    for (const o of this.ghosts.children) disposeTree(o);
    this.ghosts.clear();
    if (diff?.removed.length) {
      const { root, objs } = buildModel(diff.before, { edges: false });
      root.updateMatrixWorld(true);
      const mat = new THREE.MeshBasicMaterial({ color: 0xd2453c, transparent: true, opacity: 0.28, depthWrite: false });
      for (const id of diff.removed) {
        const o = objs.get(id);
        if (!o?.isMesh) continue;
        const g = new THREE.Mesh(o.geometry.clone(), mat);
        g.matrixAutoUpdate = false;
        g.matrix.copy(o.matrixWorld);
        g.raycast = () => {};
        this.ghosts.add(g);
      }
      disposeTree(root);
    }
    this.highlight(this.selection);
  }

  // ---------------------------------------------------------------- camera
  getCamera() {
    return {
      position: D.round3(this.camera.position.toArray()),
      target: D.round3(this.controls.target.toArray()),
      fov: this.persp.fov,
      projection: (this.paneNow ? this.paneNow.cfg.projection : this.store.doc.settings.projection) || 'perspective',
      two_point: !this.paneNow && !!this.store.doc.settings.two_point,
    };
  }
  setCamera({ position, target, fov }) {
    if (position) this.camera.position.fromArray(position);
    if (target) this.controls.target.fromArray(target);
    if (fov) {
      this.persp.fov = fov;
      this.persp.updateProjectionMatrix();
    }
    this.syncProjection();
    if (this.camera.isOrthographicCamera) (this.ortho.zoom = 1), this.fitOrtho();
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.dirty = true;
    if (!this.restoring) this.pushView();
  }
  /** View history (#70): every settled camera, so back / forward step through them. */
  pushView() {
    const v = this.getCamera();
    const last = this.views[this.viewAt];
    if (last && JSON.stringify(last) === JSON.stringify(v)) return;
    this.views = this.views.slice(0, this.viewAt + 1).concat([v]).slice(-50);
    this.viewAt = this.views.length - 1;
  }
  stepView(k) {
    const i = this.viewAt + k;
    if (i < 0 || i >= this.views.length) throw new Error(k < 0 ? 'No earlier view.' : 'No later view.');
    this.viewAt = i;
    this.restoring = true;
    try {
      this.setCamera(this.views[i]);
    } finally {
      this.restoring = false;
    }
    return { view: i + 1, of: this.views.length, ...this.views[i] };
  }
  viewBack() {
    return this.stepView(-1);
  }
  viewForward() {
    return this.stepView(1);
  }
  /** Zoom so a window of the view (fractions, 0–1 from the left and top) fills it. */
  zoomWindow(x0, y0, x1, y1) {
    const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [t, b] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (r - l < 0.005 || b - t < 0.005) throw new Error('Drag a bigger window.');
    const cx = (l + r) / 2;
    const cy = (t + b) / 2;
    const hit = this.pickAt(cx, cy);
    const ray = this.raycaster.ray;
    const target = hit?.point || ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()) || this.controls.target.clone().add(ray.direction.clone().multiplyScalar(this.camera.position.distanceTo(this.controls.target)));
    const k = Math.max(r - l, b - t);
    const dist = target.distanceTo(this.camera.position) * k;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.setCamera({ position: target.clone().add(dir.multiplyScalar(dist)).toArray(), target: target.toArray() });
    return this.getCamera();
  }
  modelBox(ids = null) {
    const box = new THREE.Box3();
    const list = ids ? ids.map((id) => this.objs.get(id)).filter(Boolean) : this.modelRoot.children;
    for (const o of list) box.expandByObject(o);
    return box;
  }
  zoomExtents(ids = null, dir = null) {
    const box = this.modelBox(ids);
    if (box.isEmpty()) box.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2, 3));
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getBoundingSphere(new THREE.Sphere()).radius;
    const d = dir || this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = r / Math.sin((this.persp.fov * D2R) / 2) * 1.05;
    this.setCamera({ position: c.clone().add(d.multiplyScalar(dist)).toArray(), target: c.toArray() });
  }
  setView(preset) {
    this.zoomExtents(null, new THREE.Vector3(...(viewDirection(preset) || viewDirection('iso'))).normalize());
  }

  // ---------------------------------------------------------------- picking & projection
  ndc(ev) {
    const r = this.input.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  ray(ev) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    return this.raycaster.ray;
  }
  /** The loaded point cloud point under the mouse (#294), at full precision with its attributes, or null. */
  cloudPoint(ev, px = 6) {
    if (!this.clouds.cache.size) return null;
    const [w, h] = [this.input.clientWidth || this.canvas.clientWidth, this.input.clientHeight || this.canvas.clientHeight];
    this.updateClouds(this.camera, { x: w, y: h }); // the nodes this pane's camera sees
    const pane = this.paneNow ? this.paneNow.i + 1 : 1;
    const doc = this.store.doc;
    const clips = CV.clipsOf(doc);
    const keep = clips.length ? (p, entity) => CV.visible(doc, [p.x, p.y, p.z], { pane, entity, clips }) : null;
    return this.clouds.nearest(this.ray(ev).clone(), this.camera, h, px, keep);
  }
  /** The same at fractions of the view (0–1 from the left and top). */
  cloudPointAt(fx, fy, px = 6) {
    const r = this.input.getBoundingClientRect();
    return this.cloudPoint({ clientX: r.left + fx * r.width, clientY: r.top + fy * r.height }, px);
  }
  /** First visible face under the mouse: { entityId, faceIndex, point, normal } in world space. */
  pick(ev) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const meshes = [];
    this.modelRoot.traverseVisible((o) => o.isMesh && !o.userData.underlay && !o.userData.isCurve && !o.userData.cap && o.material.visible !== false && meshes.push(o));
    const hits = this.raycaster.intersectObjects(meshes, false).filter((h) => this.unclipped(h.point, h.object.userData.entityId)); // what a clip volume cuts away is not picked
    const h = hits[0];
    if (!h) return null;
    const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate(); // back side of a lone face
    return { entityId: h.object.userData.entityId, faceIndex: h.object.geometry.userData.triFace[h.faceIndex], point: h.point.clone(), normal, object: h.object };
  }
  /** The survey point under the mouse, using the ray pick() just set. */
  pickPoint() {
    const cloud = this.modelRoot.children.find((o) => o.isPoints && !o.userData.pointcloud);
    if (!cloud) return null;
    this.raycaster.params.Points.threshold = 0.01 * this.camera.position.distanceTo(this.controls.target);
    const h = this.raycaster.intersectObject(cloud, false).find((x) => this.unclipped(x.point, cloud.userData.pointIds[x.index]));
    return h ? { entityId: cloud.userData.pointIds[h.index], faceIndex: -1, point: h.point.clone(), normal: new THREE.Vector3(0, 1, 0), object: cloud, survey: true } : null;
  }

  /** A drawing (underlay) under the mouse, using the ray pick() just set: they are skipped by pick() so drawing over them works. */
  pickUnderlay(id = null) {
    const list = [];
    this.modelRoot.traverseVisible((o) => o.userData.underlay && (!id || o.userData.entityId === id) && list.push(o));
    const h = this.raycaster.intersectObjects(list, false)[0];
    return h ? { entityId: h.object.userData.entityId, faceIndex: -1, point: h.point.clone(), normal: new THREE.Vector3(0, 1, 0), object: h.object, underlay: true } : null;
  }

  /** An underlay's textured sheet (its picture arrives when pdf.js / the image decoder is done). */
  underlayObject(e) {
    const u = e.underlay;
    const tex = textureFor(u, this.renderer, (err) => {
      if (err) window.mmr?.toast?.(`${e.name}: ${err.message}`, 'danger');
      this.dirty = true;
    });
    const o = new THREE.Mesh(underlayGeometry(u), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: u.opacity ?? 1, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8, clippingPlanes: this.clipping })); // pushed back in depth: linework on it always wins
    o.renderOrder = -10 + (u.draw_order || 0);
    o.userData.underlay = true;
    return o;
  }

  /** The curve under the mouse (curves have no faces: faceIndex -1), using the ray pick() just set. */
  pickCurve() {
    const lines = [];
    this.modelRoot.traverseVisible((o) => o.userData.isCurve && lines.push(o));
    if (!lines.length) return null;
    this.raycaster.params.Line.threshold = 0.012 * this.camera.position.distanceTo(this.controls.target);
    const h = this.raycaster.intersectObjects(lines, false).find((x) => this.unclipped(x.point, x.object.userData.entityId));
    return h ? { entityId: h.object.userData.entityId, faceIndex: -1, point: h.point.clone(), normal: new THREE.Vector3(0, 1, 0), object: h.object, curve: true } : null;
  }

  /** The dimension or label whose text is under the pointer (#184): texts are drawn in 2D, so they are found on screen. */
  pickAnnotation(ev, radius = 28) {
    let best = null;
    for (const e of this.store.doc.entities) {
      const a = e.annotation;
      if (!a?.at || e.visible === false) continue;
      const s = this.toScreen(new THREE.Vector3(...a.at));
      if (s.behind) continue;
      const d = Math.hypot(s.x - ev.clientX, s.y - ev.clientY);
      if (d < radius && (!best || d < best.d)) best = { d, e };
    }
    return best && { entityId: best.e.id, faceIndex: -1, point: new THREE.Vector3(...best.e.annotation.at), normal: new THREE.Vector3(0, 1, 0), annotation: true };
  }

  /** pick() at a viewport point given as fractions (0..1 from the left and top). */
  pickAt(x, y) {
    const r = this.input.getBoundingClientRect();
    this.modelRoot.updateMatrixWorld(true);
    return this.pick({ clientX: r.left + x * r.width, clientY: r.top + y * r.height });
  }
  toScreen(p) {
    const v = p.clone().project(this.camera);
    const r = this.input.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width + r.left, y: ((1 - v.y) / 2) * r.height + r.top, behind: v.z > 1 };
  }
  /** World-space vertices and edge midpoints of visible shapes, for inference snapping. */
  snapPoints() {
    if (this.vertexCache) return this.vertexCache;
    const pts = [];
    this.modelRoot.updateMatrixWorld(true);
    // survey points (point ties): they win over an endpoint at the same place, and say which point they are
    const cloud = this.modelRoot.children.find((o) => o.isPoints && !o.userData.pointcloud);
    if (cloud?.visible) {
      const pos = cloud.geometry.attributes.position;
      cloud.userData.pointIds.forEach((id, i) => {
        const e = this.store.doc.entities.find((x) => x.id === id);
        if (e) pts.push({ p: new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(cloud.matrixWorld), kind: 'Survey point', point: id, label: e.name + (e.point?.code ? ` · ${e.point.code}` : '') });
      });
    }
    for (const [id, o] of this.objs) {
      const e = this.store.doc.entities.find((x) => x.id === id);
      if (e?.curve && o.visible) {
        const w = e.curve.points.map((p) => new THREE.Vector3(...p).applyMatrix4(o.matrixWorld));
        w.forEach((p, k) => (pts.push({ p, kind: 'Endpoint' }), k && e.curve.kind === 'polyline' && pts.push({ p: p.clone().lerp(w[k - 1], 0.5), kind: 'Midpoint' })));
      }
      if (e?.pointcloud && o.visible) pts.push(...cloudSnaps(o));
      if (e?.underlay && o.visible && this.store.doc.settings.snap_underlays && e.underlay.kind === 'pdf') {
        const s = underlaySnaps(this.store.doc, e, () => (this.vertexCache = null));
        if (s) pts.push(...s);
      }
      if (!e?.mesh || !o.visible || e.mesh.v.length > 5000) continue;
      const w = e.mesh.v.map((p) => new THREE.Vector3(...p).applyMatrix4(o.matrixWorld));
      for (const p of w) pts.push({ p, kind: 'Endpoint' });
      for (const f of e.mesh.f) for (let k = 0; k < f.length; k++) pts.push({ p: w[f[k]].clone().lerp(w[f[(k + 1) % f.length]], 0.5), kind: 'Midpoint' });
    }
    return (this.vertexCache = pts);
  }

  /** Four standard views for a design review (iso, front, top, right); the camera is put back afterwards. */
  async reviewShots(width = 768) {
    const cam = this.getCamera();
    const shots = [];
    try {
      for (const v of ['iso', 'front', 'top', 'right']) {
        this.setView(v);
        shots.push(await this.screenshot({ width }));
      }
    } finally {
      this.setCamera(cam);
    }
    return shots;
  }

  /** Draw statistics (#111): calls and triangles of the last frame, and frames per second. */
  stats() {
    const i = this.renderer.info.render;
    const c = this.clouds.stats;
    return { draw_calls: i.calls, rendered_triangles: i.triangles, fps: this.fps ? Math.round(this.fps) : null, ...(this.clouds.clouds.size ? { cloud_points: c.points, cloud_nodes: c.nodes, cloud_loaded: c.loaded, cloud_pending: c.pending, cloud_cache_mb: c.cache_mb } : {}) };
  }
  /** Stand at eye height over what is under a point, looking towards another (#69). */
  walkTo(position, lookAt, eye = 1.6) {
    const p = new THREE.Vector3(...position);
    p.y = floorAt(this, p.setY(1e4), 0) + eye; // the top surface under the spot, at any height
    const t = lookAt ? new THREE.Vector3(...lookAt) : p.clone().add(new THREE.Vector3(0, 0, -5));
    if (Math.abs(t.y - p.y) < 1e-6 && lookAt === undefined) t.y = p.y;
    this.setCamera({ position: p.toArray(), target: t.toArray(), fov: 60 });
    return { position: p.toArray().map((x) => Math.round(x * 1000) / 1000), eye };
  }
  /** An underlay's picture as grey pixels (#150) and as an image (#151). */
  async underlayPixels(e, maxSide = 2000) {
    const { canvas } = await rasterOf(e.underlay, maxSide);
    const c = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(canvas, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const gray = new Uint8Array(c.width * c.height);
    for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0;
    return { gray, w: c.width, h: c.height };
  }
  async underlayImage(e, maxSide = 1400) {
    const { canvas } = await rasterOf(e.underlay, maxSide);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /** A path-traced still (#63) at the given size: PNG bytes. */
  async pathTrace(opts) {
    await this.clouds.settle(() => this.render());
    return this.look.pathTrace(opts, stage, (n, of) => this.onStatus?.(`Path tracing: ${n} of ${of} samples…`));
  }
  /** A seamless version of an image (base64 PNG) for AI textures (#65): PNG bytes. */
  seamless(b64) {
    return seamless(b64);
  }

  /**
   * An orthographic picture of what is visible, for drawing sheets (#55): JPEG data URL, its pixel size, the metres
   * it covers and the model's size in it. preset: top | bottom | front | back | left | right | iso.
   */
  async orthoShot(preset, { pxPerM = 160, maxPx = 2400 } = {}) {
    const dirs = { top: [0, 1, 0], bottom: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], iso: [1, 0.8, 1] };
    const d = new THREE.Vector3(...(dirs[preset] || dirs.iso)).normalize();
    const box = new THREE.Box3();
    this.modelRoot.updateMatrixWorld(true);
    const doc = this.store.doc;
    const note = (o) => D.getEntity(doc, o.userData.entityId)?.annotation;
    // guides run 200 m each way: off the sheet; dimensions and labels do not size the views
    const hidden = [];
    this.modelRoot.traverseVisible((o) => note(o)?.type === 'guide' && hidden.push(o));
    hidden.forEach((o) => (o.visible = false));
    this.modelRoot.traverseVisible((o) => {
      if (!o.geometry || o.userData.isEdges || o.userData.underlay || note(o)) return;
      o.geometry.boundingBox || o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    if (box.isEmpty()) {
      hidden.forEach((o) => (o.visible = true));
      throw new Error('Nothing visible to draw.');
    }
    const up = Math.abs(d.y) > 0.99 ? new THREE.Vector3(0, 0, d.y > 0 ? -1 : 1) : new THREE.Vector3(0, 1, 0);
    const x = up.clone().cross(d).normalize();
    const y = d.clone().cross(x);
    const c = box.getCenter(new THREE.Vector3());
    let [w, h, depth] = [0, 0, 0];
    for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(cx, cy, cz).sub(c);
      w = Math.max(w, Math.abs(v.dot(x)) * 2);
      h = Math.max(h, Math.abs(v.dot(y)) * 2);
      depth = Math.max(depth, Math.abs(v.dot(d)) * 2);
    }
    const m = 0.06 * Math.max(w, h, 0.1);
    const [W0, H0] = [w + 2 * m, h + 2 * m];
    const k = Math.min(pxPerM, maxPx / Math.max(W0, H0));
    const [W, H] = [Math.max(16, Math.round(W0 * k)), Math.max(16, Math.round(H0 * k))];
    const cam = new THREE.OrthographicCamera(-W0 / 2, W0 / 2, H0 / 2, -H0 / 2, 0.01, depth * 4 + 10);
    cam.position.copy(c).addScaledVector(d, depth * 2 + 5);
    cam.up.copy(y);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    const persp = this.camera;
    const undo = stage(this, W, H, false);
    const ground = this.ground.visible;
    this.ground.visible = false;
    this.scene.background = new THREE.Color('#ffffff');
    try {
      this.camera = cam;
      this.renderer.render(this.scene, cam);
      return { image: this.canvas.toDataURL('image/jpeg', 0.9), px: [W, H], extent: [W0, H0], model: [w, h] };
    } finally {
      this.camera = persp;
      hidden.forEach((o) => (o.visible = true));
      this.ground.visible = ground;
      undo();
      this.render();
    }
  }

  async screenshot({ width = 1024 } = {}) {
    await this.clouds.settle(() => this.render(), 5000); // the frame's cloud nodes, loaded
    const src = this.canvas;
    const w = Math.min(width, src.width);
    const h = Math.round((src.height / src.width) * w);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/png');
  }
}

/** The section fill of a clip volume (#290): every face that cuts a solid (clip.js capLoops), named for clipFor(). */
function clipCaps(doc, clip) {
  const grp = new THREE.Group();
  Object.assign(grp.userData, { caps: true, clipName: clip.name });
  let faces = [];
  try {
    faces = CV.capLoops(doc, clip);
  } catch {
    return grp;
  }
  for (const f of faces) if (f.cuts.length) grp.add(sectionCaps(f, clip.name));
  return grp;
}

/** Filled caps where a plane cuts solids (#54), in a darker tone of each solid's colour, outlined. */
function sectionCaps(cut, clipName) {
  const grp = new THREE.Group();
  grp.userData.clipName = clipName;
  const { n, u, v } = cut.frame;
  const at = (x, y) => new THREE.Vector3(...G.add(G.add(cut.point, G.scl(u, x)), G.scl(v, y))).addScaledVector(new THREE.Vector3(...n), -0.0005);
  for (const c of cut.cuts) {
    const pos = [];
    for (const a of c.areas) {
      const flat = [a.outer, ...a.holes].flat();
      for (const t of THREE.ShapeUtils.triangulateShape(a.outer.map(([x, y]) => new THREE.Vector2(x, y)), a.holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))))) for (const k of t) pos.push(...at(...flat[k]).toArray());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: SEC.shade(c.color, 0.62), side: THREE.DoubleSide }));
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(c.loops.flatMap((l) => l.flatMap((p, i) => [new THREE.Vector3(...p), new THREE.Vector3(...l[(i + 1) % l.length])]))), new THREE.LineBasicMaterial({ color: 0x111111 }));
    m.raycast = lines.raycast = () => {};
    m.userData.cap = lines.userData.cap = true;
    m.userData.clipName = lines.userData.clipName = clipName; // not cut by its own clip (clipshader patchTree)
    grp.add(m, lines);
  }
  return grp;
}

export function disposeTree(o, geometry = true) {
  o.traverse((x) => {
    if (geometry || x.userData.isCurve || x.userData.cap || x.userData.underlay || x.userData.draped) x.geometry?.dispose();
    if (x.material) [].concat(x.material).forEach((m) => m.dispose());
  });
}
