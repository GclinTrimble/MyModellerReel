// The point cloud shader (#295–#297), shared by the thinned preview (scale.js cloudObject) and octree nodes
// (cloudlod.js): colour modes, size and shape, eye-dome lighting, the depth aids (x-ray, depth colour, fog, ghost
// outside the section), and the display filter. One material per cloud; it sets itself up for each pane as it is
// drawn (material.onBeforeRender), so pane 2 can show intensity while pane 1 shows RGB.
import * as THREE from 'three';
import * as CS from '../core/cloudstyle.js';
import * as CV from '../core/clip.js';
import { pointNormals } from '../core/cloudfeatures.js';
import { patchClip, CLIP_GLSL } from './clipshader.js';

const MODES = Object.fromEntries(CS.COLOR_BY.map((m, i) => [m, i]));
const EDL_LAYER = 7; // the clouds with eye-dome lighting join this layer for their own pass

/** What the view tells the clouds: the document (clips), focus distance for fog, points on screen, the ghost default. */
export const env = { doc: null, focus: null, points: 0, outside: 'hidden' };

const textures = new Map();
function lut(key, bytes) {
  let t = textures.get(key);
  if (!t) {
    if (textures.size > 64) textures.clear();
    t = new THREE.DataTexture(bytes(), 256, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    textures.set(key, t);
  }
  return t;
}

const VERT = /* glsl */ `
attribute vec3 rgb;
attribute float intensity;
attribute float classification;
attribute float returnNumber;
attribute float numberOfReturns;
attribute float gpsTime;
attribute float pointSource;
attribute float hag;
attribute float spacingRank;
uniform int uMode;
uniform int uHas; // 1 rgb, 2 intensity, 4 class, 8 returns, 16 time, 32 source, 64 normal, 128 hag, 256 spacing
uniform vec2 uRange;
uniform float uGamma;
uniform sampler2D uRamp;
uniform sampler2D uClasses;
uniform vec3 uColor;
uniform bool uRelative;
uniform float uSize, uMinPx, uMaxPx, uScreenH, uNodeSpacing, uPixelRatio;
uniform int uSizeMode;
uniform vec4 uElev; // min, max, on, above ground
uniform vec3 uInt;  // min, max, on
uniform int uReturns; // 0 all, 1 first, 2 last, 3 only
uniform vec3 uTime;
uniform vec4 uSource; uniform int uSourceN;
uniform float uDensity, uSpacing;
uniform int uDepth; // 0 off, 1 xray, 2 depth, 3 fog
uniform float uXray, uXraySat;
uniform bool uXrayDark;
uniform vec2 uDepthRange;
uniform vec3 uFog; // focus, near, far
uniform int uOutside; // what the clip volumes cut away: 1 hidden, 2 ghost
varying vec3 vColor;
varying float vAlpha;
varying float vGhost;

bool has(int bit) { return (uHas & bit) != 0; }
float hash01(uint i) { return float(((i * 2654435761u) >> 8u) & 0xffffu) / 65536.0; }
vec3 ramp(float t) { return texture2D(uRamp, vec2(clamp(t, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb; }
void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 cls = has(4) ? texture2D(uClasses, vec2((classification + 0.5) / 256.0, 0.5)) : vec4(0.7, 0.7, 0.7, 1.0);
  // the display filter (#297); cloudstyle.passes is the same test on the CPU
  if (cls.a < 0.5) { cull(); return; }
  float h = uElev.w > 0.5 ? (has(128) ? hag : world.y) : world.y;
  if (uElev.z > 0.5 && (h < uElev.x || h > uElev.y)) { cull(); return; }
  if (uInt.z > 0.5 && has(2) && (intensity < uInt.x || intensity > uInt.y)) { cull(); return; }
  if (uReturns > 0 && has(8)) {
    float n = max(numberOfReturns, 1.0);
    if ((uReturns == 1 && returnNumber != 1.0) || (uReturns == 2 && returnNumber != n) || (uReturns == 3 && n != 1.0)) { cull(); return; }
  }
  if (uTime.z > 0.5 && has(16) && (gpsTime < uTime.x || gpsTime > uTime.y)) { cull(); return; }
  if (uSourceN > 0 && has(32)) {
    bool ok = false;
    for (int k = 0; k < 4; k++) if (k < uSourceN && abs(pointSource - uSource[k]) < 0.5) ok = true;
    if (!ok) { cull(); return; }
  }
  if (uDensity < 1.0 && hash01(uint(gl_VertexID)) >= uDensity) { cull(); return; }
  if (uSpacing > 0.0 && has(256) && spacingRank < uSpacing) { cull(); return; }
  vGhost = 0.0;
  // the clip volumes' test goes on the next line (cloudMaterial): a cut point is culled or drawn as the ghost
  // MMR_CLIP_TEST

  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  bool ortho = projectionMatrix[3][3] == 1.0;

  // colour
  float t = 0.0;
  vec3 c = uColor;
  float span = max(uRange.y - uRange.x, 1e-6);
  if (uMode == 0) c = has(1) ? rgb : uColor;
  else if (uMode == 1 || uMode == 9) {
    t = has(2) ? pow(clamp((intensity - uRange.x) / span, 0.0, 1.0), 1.0 / max(uGamma, 0.01)) : 0.5;
    c = uMode == 9 && has(1) ? rgb * (0.25 + 0.75 * t) * 1.3 : ramp(t);
  }
  else if (uMode == 2) c = ramp(((uRelative && has(128) ? hag : world.y) - uRange.x) / span);
  else if (uMode == 3) c = cls.rgb;
  else if (uMode == 4) c = has(8) ? ramp((returnNumber - 1.0) / max(numberOfReturns - 1.0, 1.0)) : uColor;
  else if (uMode == 5) c = has(16) ? ramp((gpsTime - uRange.x) / span) : uColor;
  else if (uMode == 6) c = has(32) ? ramp((pointSource - uRange.x) / span) : uColor;
  else if (uMode == 7) c = has(64) ? normalize(normal) * 0.5 + 0.5 : uColor;
  if (uMode == 10 || uDepth == 2) c = ramp((dist - uDepthRange.x) / max(uDepthRange.y - uDepthRange.x, 1e-6));
  vAlpha = 1.0;
  if (uDepth == 3) {
    float f = 1.0 - clamp((dist - uFog.x - uFog.y) / max(uFog.z - uFog.y, 1e-6), 0.0, 1.0);
    if (f <= 0.0) { cull(); return; }
    vAlpha = f;
  }
  vColor = pow(max(c, 0.0), vec3(2.2)); // ramps, classes and rgb are sRGB; the output step encodes again
  if (uDepth == 1) {
    // x-ray: each point adds (night) or takes away (light sky) a little light; dense walls and kerbs build up
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, uXraySat);
    vColor = uXrayDark ? c * uXray : uXray * (1.0 - c * 0.6);
  }

  // size: pixels, metres in the world, or the node's spacing so gaps close at any zoom
  float scale = projectionMatrix[1][1] * uScreenH * 0.5 / (ortho ? 1.0 : max(dist, 1e-3));
  float px = uSize * uPixelRatio;
  if (uSizeMode == 1) px = uSize * scale;
  else if (uSizeMode == 2) px = max(uSize * uPixelRatio, uNodeSpacing * 1.6 * scale);
  px = clamp(px, uMinPx * uPixelRatio, uMaxPx * uPixelRatio);
  if (vGhost > 0.5) px = max(uPixelRatio, px * 0.6);
  gl_PointSize = px;
}`;

const FRAG = /* glsl */ `
uniform int uShape; // 0 square, 1 round, 2 paraboloid
uniform float uOpacity;
uniform int uDepth;
varying vec3 vColor;
varying float vAlpha;
varying float vGhost;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (uShape > 0 && r2 > 1.0) discard;
  vec3 c = vColor;
  if (uShape == 2) c *= 0.55 + 0.45 * sqrt(1.0 - r2);
  float a = uOpacity * vAlpha;
  if (vGhost > 0.5) { c = mix(c, vec3(0.3), 0.5); a *= 0.35; }
  gl_FragColor = vec4(c, uDepth == 1 ? 1.0 : a);
  if (uDepth != 1) {
    #include <colorspace_fragment>
  }
}`;

// ---------------------------------------------------------------- per pane state

/** What a cloud draws like in a pane: the uniforms and blending, worked out once per (entity, pane). */
function stateFor(mat, pane) {
  const e = mat.userData.entity;
  let s = mat.userData.states.get(pane);
  if (s) return s;
  const st = CS.styleOf(e, pane);
  const f = CS.filterOf(e, pane);
  const d = mat.userData.data;
  const dy = e.position?.[1] || 0;
  const range = d ? CS.autoRange(st, d, dy) : st.range || [0, 1];
  const ramp = CS.rampFor(st);
  const flags = (f.hide || []).join(',');
  s = {
    st,
    f,
    range,
    ramp: lut(`r${JSON.stringify(ramp)}`, () => CS.rampBytes(ramp)),
    classes: lut(`c${JSON.stringify(st.class_colors || {})}|${flags}`, () => CS.classBytes(st.class_colors, f.hide || [])),
    needs: { hag: !!(f.above_ground || st.above_ground), spacing: f.spacing > 0, normal: st.color_by === 'normal' },
  };
  mat.userData.states.set(pane, s);
  return s;
}

/** Attributes a filter needs that only the CPU can make (heights above ground, spacing ranks), added once. */
function ensure(geometry, needs) {
  // colour by normal (#300): PCA normals of the points drawn (the preview, or an octree node at its own spacing)
  // shortcut: computed on this thread once per geometry, about 0.1 s per 100 000 points; a worker if it shows
  const pos = geometry.attributes.position;
  if (needs.normal && !geometry.attributes.normal && pos?.itemSize === 3 && pos.array.length >= 30) geometry.setAttribute('normal', new THREE.BufferAttribute(pointNormals(pos.array), 3));
  const d = geometry.userData.cloudData;
  if (!d) return;
  if (needs.hag && !geometry.attributes.hag) geometry.setAttribute('hag', new THREE.BufferAttribute(CS.heightAboveGround(d.position, d.count, d.classification), 1));
  if (needs.spacing && !geometry.attributes.spacingRank) geometry.setAttribute('spacingRank', new THREE.BufferAttribute(CS.spacingRanks(d.position, d.count), 1));
}

const ALIASES = { rgb: ['color', 'colors', 'rgba'], gpsTime: ['gps_time', 'time'], pointSource: ['point_source', 'pointSourceId'] };
function aliases(g) {
  for (const [k, alts] of Object.entries(ALIASES)) if (!g.attributes[k]) for (const a of alts) if (g.attributes[a]) g.setAttribute(k, g.attributes[a]);
}

const size = new THREE.Vector2();
const sphere = new THREE.Sphere();
const camPos = new THREE.Vector3();
function before(renderer, scene, camera, geometry, object) {
  const m = this;
  const u = m.uniforms;
  const pane = renderer.mmrPane || 1;
  const s = stateFor(m, pane);
  const { st, f, range } = s;
  aliases(geometry);
  ensure(geometry, s.needs);
  const A = geometry.attributes;
  u.uHas.value = (A.rgb ? 1 : 0) | (A.intensity ? 2 : 0) | (A.classification ? 4 : 0) | (A.returnNumber ? 8 : 0) | (A.gpsTime ? 16 : 0) | (A.pointSource ? 32 : 0) | (A.normal ? 64 : 0) | (A.hag ? 128 : 0) | (A.spacingRank ? 256 : 0);
  const depth = st.depth;
  u.uMode.value = MODES[st.color_by] ?? 0;
  u.uRange.value.set(range[0], range[1]);
  u.uGamma.value = st.gamma;
  u.uRamp.value = s.ramp;
  u.uClasses.value = s.classes;
  u.uColor.value.set(st.color).convertLinearToSRGB();
  u.uRelative.value = !!st.above_ground;
  u.uSize.value = st.size;
  u.uSizeMode.value = CS.SIZE_MODES.indexOf(st.size_mode);
  u.uMinPx.value = st.min_px;
  u.uMaxPx.value = st.max_px;
  const target = renderer.getRenderTarget();
  if (target) size.set(target.width, target.height);
  else renderer.getDrawingBufferSize(size);
  u.uScreenH.value = size.y;
  u.uPixelRatio.value = target ? 1 : renderer.getPixelRatio();
  // adaptive: the node's spacing (octree), else the preview's average spacing
  u.uNodeSpacing.value = object.userData.spacing || geometry.userData.spacing || 0.05;
  u.uElev.value.set(f.elevation?.[0] ?? 0, f.elevation?.[1] ?? 0, f.elevation ? 1 : 0, f.above_ground ? 1 : 0);
  u.uInt.value.set(f.intensity?.[0] ?? 0, f.intensity?.[1] ?? 0, f.intensity ? 1 : 0);
  u.uReturns.value = Math.max(0, CS.RETURNS.indexOf(f.returns || 'all'));
  u.uTime.value.set(f.time?.[0] ?? 0, f.time?.[1] ?? 0, f.time ? 1 : 0);
  const src = (f.source || []).slice(0, 4);
  u.uSource.value.set(...[0, 1, 2, 3].map((k) => src[k] ?? -1));
  u.uSourceN.value = src.length;
  u.uDensity.value = f.density === undefined ? 1 : f.density / 100;
  u.uSpacing.value = f.spacing || 0;
  u.uDepth.value = CS.DEPTH.indexOf(depth);
  u.uXray.value = (st.xray_strength * 1.5) / Math.sqrt(Math.max(1, env.points || geometry.attributes.position?.count || 1) / 1000);
  u.uXraySat.value = st.xray_saturation ?? 0.35;
  // depth colour and fog: fitted to the cloud as seen from the camera
  sphere.copy(object.userData.cloudSphere || geometry.boundingSphere || sphere.set(camPos.set(0, 0, 0), 1));
  if (!object.userData.cloudSphere) sphere.applyMatrix4(object.matrixWorld);
  camera.getWorldPosition(camPos);
  const dc = camPos.distanceTo(sphere.center);
  u.uDepthRange.value.set(Math.max(0, dc - sphere.radius), dc + sphere.radius);
  const focus = typeof st.focus === 'number' ? st.focus : (st.focus === 'slab' ? slabDistance(camPos) : null) ?? env.focus ?? dc;
  u.uFog.value.set(focus, st.fog_near, Math.max(st.fog_far, st.fog_near + 0.01));
  u.uOutside.value = (st.outside || env.outside) === 'ghost' ? 2 : 1;
  u.uShape.value = CS.SHAPES.indexOf(st.shape);
  u.uOpacity.value = st.opacity;
  const xray = depth === 'xray';
  // x-ray: added light over a night sky, else dst × (1 − src) so density darkens a light background
  m.blending = xray ? (env.dark ? THREE.AdditiveBlending : THREE.CustomBlending) : THREE.NormalBlending;
  Object.assign(m, { blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcColorFactor });
  u.uXrayDark.value = !!env.dark;
  m.depthTest = !xray;
  m.depthWrite = !xray && st.opacity >= 1 && depth !== 'fog';
  m.transparent = xray || st.opacity < 1 || depth === 'fog' || u.uOutside.value === 2;
  m.uniformsNeedUpdate = true; // octree nodes share this material, each with its own spacing and sphere
}

/**
 * The material of a cloud entity (one per cloud, shared by its preview and octree nodes). data: the decoded preview
 * arrays when there are any (auto ranges); options.pane is accepted for symmetry: the pane is read per draw.
 */
export function cloudMaterial(e, { data = null } = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uMode: { value: 0 }, uHas: { value: 0 }, uRange: { value: new THREE.Vector2(0, 1) }, uGamma: { value: 1 },
      uRamp: { value: null }, uClasses: { value: null }, uColor: { value: new THREE.Color() }, uRelative: { value: false },
      uSize: { value: 2 }, uMinPx: { value: 1 }, uMaxPx: { value: 12 }, uScreenH: { value: 800 }, uNodeSpacing: { value: 0.05 }, uPixelRatio: { value: 1 }, uSizeMode: { value: 0 },
      uElev: { value: new THREE.Vector4() }, uInt: { value: new THREE.Vector3() }, uReturns: { value: 0 }, uTime: { value: new THREE.Vector3() },
      uSource: { value: new THREE.Vector4() }, uSourceN: { value: 0 }, uDensity: { value: 1 }, uSpacing: { value: 0 },
      uDepth: { value: 0 }, uXray: { value: 1 }, uXraySat: { value: 0.35 }, uXrayDark: { value: false }, uDepthRange: { value: new THREE.Vector2(0, 1) }, uFog: { value: new THREE.Vector3() },
      uOutside: { value: 1 },
      uShape: { value: 0 }, uOpacity: { value: 1 },
    },
  });
  m.userData = { cloud: true, entity: e, data, states: new Map() };
  m.onBeforeRender = before;
  // clip volumes (#290): the shared uniforms and mask, with the test per point in the vertex shader instead of per
  // fragment, so a cut point is culled whole or becomes the ghost (#296)
  patchClip(m);
  const clip = m.onBeforeCompile;
  m.onBeforeCompile = function (shader, renderer) {
    clip.call(this, shader, renderer);
    const fn = CLIP_GLSL.replace('varying vec3 mmrClipWorld;', '');
    shader.vertexShader = shader.vertexShader.replace('void main() {', `${fn}\nvoid main() {`).replace('// MMR_CLIP_TEST', 'if (mmrClipped(world.xyz)) { if (uOutside == 2 || mmrClipGhost == 1) vGhost = 1.0; else { cull(); return; } }');
    shader.fragmentShader = shader.fragmentShader.replace(/\n\s*if \(mmrClipped\(mmrClipWorld\)[^\n]*discard;/, '');
  };
  return m;
}

/** Make a Points object a styled cloud: its material and what the view and snapping read. */
export function styleCloud(o, e, data) {
  o.material = cloudMaterial(e, { data });
  o.userData.pointcloud = true;
  o.userData.cloudEntity = e;
  return o;
}

// ---------------------------------------------------------------- eye-dome lighting

// The clouds with EDL in a pane are drawn once into a colour + depth target (the scene's onBeforeRender), left out of
// the main pass, and put back by one full-screen pass that shades by depth steps between neighbours (8 taps per
// pixel, not per point) and writes their depth, so meshes in front still hide them.
const EDL_FRAG = /* glsl */ `
uniform sampler2D tColor, tDepth;
uniform vec2 uSize;
uniform float uStrength, uRadius;
uniform vec3 uCam; // near, far, parallel
float edlDepth(float z) {
  // a log of the distance in perspective; plain metres (scaled) in parallel views
  if (uCam.z > 0.5) return (uCam.x + z * (uCam.y - uCam.x)) / 36.0;
  return log2(uCam.x * uCam.y / (uCam.y - z * (uCam.y - uCam.x)));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float z = texture2D(tDepth, uv).r;
  if (z >= 1.0) discard;
  float d = edlDepth(z);
  float sum = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.78539816;
    float n = texture2D(tDepth, uv + vec2(cos(a), sin(a)) * uRadius / uSize).r;
    if (n < 1.0) sum += max(0.0, d - edlDepth(n));
  }
  vec4 c = texture2D(tColor, uv);
  gl_FragColor = vec4(c.rgb / max(c.a, 1e-3) * exp(-sum / 8.0 * 300.0 * uStrength), c.a);
  gl_FragDepth = z;
  #include <colorspace_fragment>
}`;

const targets = new WeakMap();
function edlQuad(scene) {
  const q = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: EDL_FRAG,
      uniforms: { tColor: { value: null }, tDepth: { value: null }, uSize: { value: new THREE.Vector2() }, uStrength: { value: 1 }, uRadius: { value: 1.4 }, uCam: { value: new THREE.Vector3() } },
    }),
  );
  Object.assign(q, { frustumCulled: false, visible: false, renderOrder: -1 });
  q.raycast = () => {};
  q.userData.edlQuad = true;
  scene.add(q);
  return q;
}

function edlBefore(renderer, scene, camera, outer) {
  if (renderer.mmrEdlPrepass) return;
  const quad = (scene.userData.edlQuad ||= edlQuad(scene));
  quad.visible = false;
  const pane = renderer.mmrPane || 1;
  const list = [];
  scene.traverseVisible((o) => {
    if (o.isPoints && o.material?.userData?.cloud) {
      const st = stateFor(o.material, pane).st;
      if (st.edl && st.depth !== 'xray') list.push([o, st]);
    }
  });
  if (!list.length) return;
  if (outer) size.set(outer.width, outer.height);
  else renderer.getDrawingBufferSize(size);
  let rt = targets.get(renderer);
  if (!rt || rt.width !== size.x || rt.height !== size.y) {
    rt?.dispose();
    rt = new THREE.WebGLRenderTarget(size.x, size.y, { depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType), depthBuffer: true });
    targets.set(renderer, rt);
  }
  const keep = { mask: camera.layers.mask, bg: scene.background, env: scene.environment, auto: renderer.autoClear, clear: renderer.getClearAlpha() };
  for (const [o] of list) o.layers.enable(EDL_LAYER);
  camera.layers.set(EDL_LAYER);
  Object.assign(scene, { background: null, environment: null });
  renderer.mmrEdlPrepass = true;
  try {
    renderer.setRenderTarget(rt);
    renderer.setClearAlpha(0);
    renderer.clear();
    renderer.render(scene, camera);
  } finally {
    renderer.mmrEdlPrepass = false;
    for (const [o] of list) o.layers.disable(EDL_LAYER);
    camera.layers.mask = keep.mask;
    Object.assign(scene, { background: keep.bg, environment: keep.env });
    renderer.autoClear = keep.auto;
    renderer.setClearAlpha(keep.clear);
    renderer.setRenderTarget(outer);
  }
  // the main pass draws the full-screen quad in their place
  const st = list[0][1];
  const u = quad.material.uniforms;
  u.tColor.value = rt.texture;
  u.tDepth.value = rt.depthTexture;
  u.uSize.value.set(size.x, size.y);
  u.uStrength.value = st.edl_strength;
  u.uRadius.value = st.edl_radius * (outer ? 1 : renderer.getPixelRatio());
  u.uCam.value.set(camera.near, camera.far, camera.isOrthographicCamera ? 1 : 0);
  quad.material.transparent = list.some(([, s]) => s.opacity < 1 || s.depth === 'fog' || (s.outside || env.outside) === 'ghost');
  quad.visible = true;
  scene.userData.edlHidden = list.map(([o]) => ((o.visible = false), o));
}
function edlAfter(renderer, scene) {
  if (renderer.mmrEdlPrepass) return;
  for (const o of scene.userData.edlHidden || []) o.visible = true;
  scene.userData.edlHidden = null;
  if (scene.userData.edlQuad) scene.userData.edlQuad.visible = false;
}

/** Hook EDL into a scene: every renderer (each pane, effects, render_video) runs it around its draw. */
export function attachEdl(scene) {
  const before = scene.onBeforeRender;
  const after = scene.onAfterRender;
  scene.onBeforeRender = function (renderer, sc, camera, target) {
    before.call(this, renderer, sc, camera, target);
    edlBefore(renderer, sc, camera, target);
  };
  scene.onAfterRender = function (renderer, sc, camera, target) {
    edlAfter(renderer, sc);
    after.call(this, renderer, sc, camera, target);
  };
}

// ---------------------------------------------------------------- the CPU side: what is shown, legend

/** Is point i of a cloud object shown in a pane (filter and clip volumes)? Snapping and picking use it. */
export function shown(o, pane = 1) {
  const m = o.material;
  const g = o.geometry;
  const d = g.userData.cloudData;
  if (!m?.userData?.cloud || !d) return () => true;
  const clips = env.doc ? CV.clipsOf(env.doc) : [];
  const key = `${pane}|${JSON.stringify(clips)}|${env.doc?.settings.clip_combine}`;
  if (g.userData.shownKey === key && g.userData.shownMat === m) return g.userData.shownFn;
  const s = stateFor(m, pane);
  const dy = m.userData.entity.position?.[1] || 0;
  const more = { hag: s.needs.hag ? CS.heightAboveGround(d.position, d.count, d.classification) : undefined, spacing: s.needs.spacing ? CS.spacingRanks(d.position, d.count) : undefined };
  const e = m.userData.entity;
  const p = e.position || [0, 0, 0];
  const fn = (i) => {
    if (!CS.passes(CS.pointAt(d, i, dy, more), s.f)) return false;
    if (!clips.length) return true;
    const w = [0, 1, 2].map((k) => d.position[i * 3 + k] + p[k]); // shortcut: clouds are moved, not turned
    return CV.visible(env.doc, w, { pane, entity: e, clips });
  };
  Object.assign(g.userData, { shownKey: key, shownMat: m, shownFn: fn });
  return fn;
}

/** The legend of a cloud in a pane, as cloudstyle.legend gives it. */
export function legendOf(o, pane = 1) {
  const m = o.material;
  const s = stateFor(m, pane);
  const d = m.userData.data;
  let classes = m.userData.classes;
  if (!classes && s.st.color_by === 'classification') classes = m.userData.classes = d?.classification ? CS.classCounts(d, {}) : [];
  return CS.legend(s.st, s.range, (classes || []).map((c) => ({ ...c, visible: !s.f.hide?.includes(c.code) })));
}

/** Legend HTML for a view corner. */
export function legendHtml(L, name) {
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  if (L.kind === 'ramp') return `<div class="cloud-legend-title">${esc(name)} · ${esc(L.title)}</div><div class="cloud-legend-ramp" style="background:linear-gradient(90deg,${L.stops.join(',')})"></div><div class="cloud-legend-ends"><span>${esc(L.low)}</span><span>${esc(L.high)}</span></div>`;
  if (L.kind === 'classes') return `<div class="cloud-legend-title">${esc(name)} · ${esc(L.title)}</div>${L.items.map((c) => `<div class="cloud-legend-class${c.visible ? '' : ' off'}"><i style="background:${c.color}"></i>${c.code} ${esc(c.name)}</div>`).join('')}`;
  return '';
}

// ---------------------------------------------------------------- the view's side

/** Once per viewport: pane numbers on renderers, the EDL pre-pass, Alt-hover focus for fog, the legends. */
export function attachClouds(vp) {
  vp.renderer.mmrPane = 1;
  attachEdl(vp.scene);
  // fog focus: the cloud point under the cursor while Alt is held (#296)
  document.addEventListener('pointermove', (ev) => {
    if (!ev.altKey || !vp.objs) return;
    const canvas = ev.target.closest?.('canvas');
    const pane = vp.extra?.find((p) => p.canvas === canvas);
    if (canvas !== vp.canvas && !pane) return;
    const cam = pane ? pane.camera : vp.camera;
    const r = canvas.getBoundingClientRect();
    let best = null;
    let bd = 900; // within 30 px
    const v = new THREE.Vector3();
    for (const o of vp.objs.values()) {
      if (!o.userData.cloudEntity || !o.visible) continue;
      const p = o.geometry.attributes.position;
      const ok = shown(o, pane ? pane.i + 1 : 1);
      const step = Math.max(1, Math.floor(p.count / 60000));
      for (let i = 0; i < p.count; i += step) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).project(cam);
        if (v.z > 1 || v.z < -1) continue;
        const dx = ((v.x + 1) / 2) * r.width + r.left - ev.clientX;
        const dy = ((1 - v.y) / 2) * r.height + r.top - ev.clientY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd && ok(i)) (bd = d2), (best = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
      }
    }
    if (best) {
      env.focus = best.distanceTo(cam.getWorldPosition(new THREE.Vector3()));
      vp.dirty = true;
    }
  });
  vp.listeners.add(() => legends(vp));
}

/** The distance from the eye to the first slab clip (fog with focus: 'slab'). */
function slabDistance(eye) {
  const c = env.doc && CV.clipsOf(env.doc).find((x) => x.kind === 'slab' && x.enabled !== false);
  if (!c) return null;
  const n = CV.normalize(c).normal;
  return Math.abs(n[0] * (eye.x - c.point[0]) + n[1] * (eye.y - c.point[1]) + n[2] * (eye.z - c.point[2]));
}

/** After every rebuild: the clips, points on screen, meshes as edges only beside an x-ray cloud. */
export function syncClouds(vp) {
  const doc = vp.store.doc;
  const s = doc.settings;
  env.doc = doc;
  // a ghost when the view shows what clips cut away, or a clip asks for it for clouds (set_clip outside: ghost)
  env.outside = s.show_clipped === 'ghost' || CV.clipsOf(doc).some((c) => c.enabled !== false && c.outside === 'ghost') ? 'ghost' : 'hidden';
  env.dark = ['night'].includes(s.environment?.preset);
  let points = 0;
  let xray = false;
  for (const o of vp.objs.values()) {
    if (!o.userData.cloudEntity) continue;
    points += o.geometry.attributes.position?.count || 0;
    xray ||= CS.styleOf(o.userData.cloudEntity).depth === 'xray';
  }
  env.points = points;
  if (xray) vp.modelRoot.traverse((o) => o.isMesh && !o.userData.underlay && o.material && !Array.isArray(o.material) && (o.material = Object.assign(o.material.clone(), { colorWrite: false })));
  vp.legendKey = null;
}

/** The legend of the selected (or first) cloud in each pane's bottom-right corner. */
function legends(vp) {
  const objs = [...(vp.objs?.values() || [])].filter((o) => o.userData.cloudEntity && o.material?.userData?.cloud && o.visible);
  const sel = objs.find((o) => vp.selection.includes(o.userData.cloudEntity.id)) || objs[0];
  const panes = [{ canvas: vp.canvas, n: 1 }, ...(vp.extra || []).filter((p) => p.visible && !p.win && p.canvas.style.display !== 'none').map((p) => ({ canvas: p.canvas, n: p.i + 1 }))];
  const key = sel ? `${sel.material.uuid}|${sel.userData.cloudEntity.id}|${panes.map((p) => `${p.n}:${p.canvas.offsetLeft},${p.canvas.offsetTop},${p.canvas.offsetWidth},${p.canvas.offsetHeight}`).join(';')}` : '';
  if (key === vp.legendKey) return;
  vp.legendKey = key;
  const host = vp.canvas.parentElement;
  host.querySelectorAll('.cloud-legend').forEach((x) => x.remove());
  if (!sel) return;
  for (const p of panes) {
    const html = legendHtml(legendOf(sel, p.n), sel.userData.cloudEntity.name);
    if (!html) continue;
    const el = document.createElement('div');
    el.className = 'cloud-legend';
    el.innerHTML = html;
    Object.assign(el.style, { left: `${p.canvas.offsetLeft + p.canvas.offsetWidth - 10}px`, top: `${p.canvas.offsetTop + p.canvas.offsetHeight - 10}px` });
    host.append(el);
  }
}
