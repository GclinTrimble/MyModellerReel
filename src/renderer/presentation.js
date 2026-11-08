// How the view looks (#57–#64): image textures and PBR maps, lights, environment lighting, post effects,
// presentation styles, path-traced stills and seamless AI textures. The settings live in the document
// (src/core/look.js has their defaults); this draws them.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import * as Assets from '../core/assets.js';
import * as LK from '../core/look.js';

// ---------------------------------------------------------------- textures

const textures = new Map();
/** A texture from an asset's image bytes (shared, decoded once). data: normal / roughness maps (no colour space). */
export function textureOf(asset, { data = false, onReady } = {}) {
  const key = `${asset}|${data ? 'data' : 'color'}`;
  let t = textures.get(key);
  if (t) {
    if (!t.image && onReady) t.userData.waiting.push(onReady);
    return t;
  }
  t = new THREE.Texture();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.waiting = onReady ? [onReady] : [];
  textures.set(key, t);
  const a = Assets.get(asset);
  if (a)
    createImageBitmap(new Blob([a.bytes], { type: a.mime }), { imageOrientation: 'flipY' })
      .then((img) => {
        t.image = img;
        t.flipY = false;
        t.needsUpdate = true;
        for (const fn of t.userData.waiting.splice(0)) fn();
      })
      .catch((e) => console.error(`texture ${asset}:`, e));
  return t;
}

/** UVs for a texture's projection, kept on the (shared) geometry while the projection does not change. */
function ensureUVs(g, tex) {
  const opts = { projection: tex?.projection || 'box', size: tex?.size || [1, 1], offset: tex?.offset || [0, 0], rotation: tex?.rotation || 0, plane: tex?.plane || 'top' };
  const key = JSON.stringify(opts);
  if (g.userData.uvKey === key) return;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  if (opts.projection === 'cylindrical') {
    g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    opts.radius = Math.max(s.x, s.z) / 2 || 1;
  }
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) uv.set(LK.uvFor([pos.getX(i), pos.getY(i), pos.getZ(i)], [nor.getX(i), nor.getY(i), nor.getZ(i)], opts), i * 2);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.userData.uvKey = key;
}

/** Textures and maps on a mesh's material; dirty() redraws when an image arrives. */
export function applyMaps(o, m, dirty) {
  if (!m.texture && !m.maps) return;
  ensureUVs(o.geometry, m.texture);
  const mat = o.material;
  if (m.texture) mat.map = textureOf(m.texture.asset, { onReady: dirty });
  const maps = m.maps || {};
  if (maps.normal) (mat.normalMap = textureOf(maps.normal, { data: true, onReady: dirty })), mat.normalScale.setScalar(m.normal_scale ?? 1);
  if (maps.roughness) mat.roughnessMap = textureOf(maps.roughness, { data: true, onReady: dirty });
  if (maps.ao) mat.aoMap = textureOf(maps.ao, { data: true, onReady: dirty });
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------- presentation styles

const PAPER = '#ffffff';
/** The material a style draws a shape with (null: its own). */
export function styleMaterial(style, opts) {
  if (style === 'hidden_line' || style === 'sketchy') return new THREE.MeshBasicMaterial({ color: PAPER, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: opts.clipping });
  if (style === 'monochrome') return new THREE.MeshStandardMaterial({ color: '#d8d6d0', roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: opts.clipping });
  return null;
}

/** Hand-drawn edges: each edge drawn twice, a little off and a little long. */
export function sketchEdges(edges, size) {
  const p = edges.attributes.position;
  const out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * size * 0.012;
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < p.count; i += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i);
      const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
      const d = b.clone().sub(a).multiplyScalar(0.04 + Math.abs(rnd()) / size);
      out.push(a.clone().sub(d).add(new THREE.Vector3(rnd(), rnd(), rnd())), b.clone().add(d).add(new THREE.Vector3(rnd(), rnd(), rnd())));
    }
  return new THREE.BufferGeometry().setFromPoints(out);
}

// ---------------------------------------------------------------- lights

let rectReady = false;
/** A light entity: the light and a small marker to pick it by (hidden in renders). */
export function lightObject(e, clipping) {
  const L = e.light;
  const g = new THREE.Group();
  let light;
  if (L.kind === 'spot') {
    light = new THREE.SpotLight(L.color, L.intensity, L.distance || 0, ((L.angle ?? 35) * Math.PI) / 180, L.penumbra ?? 0.4, 2);
    light.target.position.fromArray(L.target ? L.target.map((x, k) => x - e.position[k]) : [0, -1, 0]);
    g.add(light.target);
  } else if (L.kind === 'area') {
    if (!rectReady) RectAreaLightUniformsLib.init(), (rectReady = true);
    light = new THREE.RectAreaLight(L.color, L.intensity, L.width ?? 1, L.height ?? 0.5);
    light.lookAt(...(L.target ? L.target.map((x, k) => x - e.position[k]) : [0, -1, 0]));
  } else light = new THREE.PointLight(L.color, L.intensity, L.distance || 0, 2);
  if (L.shadows && light.shadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0005;
  }
  light.userData.base = L.intensity;
  g.add(light);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: L.color, clippingPlanes: clipping }));
  marker.userData.lightMarker = true;
  g.add(marker);
  if (L.kind === 'area') {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(L.width ?? 1, L.height ?? 0.5), new THREE.MeshBasicMaterial({ color: L.color, side: THREE.DoubleSide }));
    panel.quaternion.copy(light.quaternion);
    panel.raycast = () => {};
    g.add(panel);
  }
  g.userData.light = light;
  return g;
}

// ---------------------------------------------------------------- environment

/** An equirectangular gradient sky as a texture (for presets without a file). */
function gradientSky(top, horizon, bottom) {
  const c = Object.assign(document.createElement('canvas'), { width: 8, height: 256 });
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.48, horizon);
  grad.addColorStop(0.52, horizon);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SKIES = { sky: ['#6f9fd8', '#dfeaf2', '#8a8676'], sunset: ['#3b4f7d', '#f2b880', '#6b5a4a'], night: ['#03060f', '#1c2740', '#0b0b0d'] };
const ENV_INTENSITY = { studio: 0.45, sky: 0.8, sunset: 0.7, night: 0.35, hdri: 1 };
const skyCache = {};
/** The plain background for the default environment at a sun elevation: day, dusk or night. */
export function defaultSky(elevation, day) {
  if (elevation > 6) return day;
  return (skyCache[elevation > -4 ? 'dusk' : 'night'] ||= elevation > -4 ? gradientSky('#33466e', '#e9a877', '#5c5048') : gradientSky('#02040b', '#111a2e', '#08080a'));
}

export class Presentation {
  constructor(vp) {
    this.vp = vp;
    this.envKey = 'default';
    this.fxKey = '';
    this.pmrem = new THREE.PMREMGenerator(vp.renderer);
  }

  /** Bring the environment and effects in line with the document. */
  sync(doc) {
    const env = doc.settings.environment || { preset: 'default' };
    const key = JSON.stringify(env);
    if (key !== this.envKey) this.setEnvironment(env).catch((e) => console.error('environment:', e));
    const fx = doc.settings.effects;
    this.vp.renderer.toneMappingExposure = (fx?.exposure ?? 1) * (env.exposure ?? 1);
  }

  async setEnvironment(env) {
    const vp = this.vp;
    const key = JSON.stringify(env);
    this.envKey = key;
    let tex = null;
    if (env.preset === 'studio') tex = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    else if (SKIES[env.preset]) tex = gradientSky(...SKIES[env.preset]);
    else if (env.preset === 'hdri' && env.asset) {
      const a = Assets.get(env.asset);
      if (!a) throw new Error('The HDRI file is missing: set it again.');
      const loader = /exr/.test(a.mime) || /\.exr$/i.test(a.name) ? new EXRLoader() : new HDRLoader();
      const d = loader.parse(a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + a.bytes.byteLength));
      tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.flipY = true;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.needsUpdate = true;
    }
    if (this.envKey !== key) return; // changed again meanwhile
    // the path tracer takes the panorama itself (three r187 has no cube-UV chunk for its PMREM converter)
    this.envSource = tex && tex.mapping === THREE.EquirectangularReflectionMapping ? tex : null;
    const pm = this.envSource ? this.pmrem.fromEquirectangular(tex).texture : tex;
    vp.scene.environment = pm;
    vp.scene.environmentIntensity = env.intensity ?? ENV_INTENSITY[env.preset] ?? 1;
    const rot = ((env.rotation || 0) * Math.PI) / 180;
    vp.scene.environmentRotation.set(0, rot, 0);
    vp.scene.backgroundRotation.set(0, rot, 0);
    vp.scene.background = tex && env.background !== false && env.preset !== 'studio' ? tex : defaultSky(vp.store.doc.settings.sun.elevation, vp.skyBackground);
    vp.hemi.intensity = env.preset === 'default' ? 1.6 : env.preset === 'night' ? 0.08 : 0.5;
    vp.dirty = true;
  }

  // ---------------------------------------------------------------- effects
  composerFor(fx) {
    const vp = this.vp;
    const key = JSON.stringify(fx);
    const size = vp.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.composer && this.fxKey === key && this.camera === vp.camera) {
      if (this.size.x !== size.x || this.size.y !== size.y) (this.size = size), this.composer.setPixelRatio(1), this.composer.setSize(size.x, size.y);
      return this.composer;
    }
    this.composer?.dispose();
    const c = new EffectComposer(vp.renderer);
    c.setPixelRatio(1);
    c.setSize(size.x, size.y);
    c.addPass(new RenderPass(vp.scene, vp.camera));
    if (fx.ao > 0) {
      const ao = new GTAOPass(vp.scene, vp.camera, size.x, size.y);
      ao.blendIntensity = fx.ao;
      c.addPass(ao);
    }
    if (fx.outline) {
      this.outline = new OutlinePass(size, vp.scene, vp.camera);
      Object.assign(this.outline, { edgeStrength: 4, edgeThickness: 1.5, edgeGlow: 0 });
      this.outline.visibleEdgeColor.set('#151515');
      this.outline.hiddenEdgeColor.set('#151515');
      c.addPass(this.outline);
    } else this.outline = null;
    if (fx.dof) (this.bokeh = new BokehPass(vp.scene, vp.camera, { focus: 10, aperture: 0.0025, maxblur: 0.012 })), c.addPass(this.bokeh);
    else this.bokeh = null;
    if (fx.bloom > 0) c.addPass(new UnrealBloomPass(size, fx.bloom * 1.2, 0.5, 0.82));
    c.addPass(new OutputPass());
    if (fx.vignette > 0) {
      const v = new ShaderPass(VignetteShader);
      v.uniforms.darkness.value = 0.6 + fx.vignette * 1.2;
      v.uniforms.offset.value = 1;
      c.addPass(v);
    }
    Object.assign(this, { composer: c, fxKey: key, camera: vp.camera, size });
    return c;
  }

  /** Draw a frame: with the document's effects when there are any. */
  draw(doc) {
    const vp = this.vp;
    const fx = doc.settings.effects;
    if (!LK.effectsOn(fx)) return void vp.renderer.render(vp.scene, vp.camera);
    const c = this.composerFor(fx);
    if (this.outline) {
      const sel = [];
      vp.modelRoot.traverseVisible((o) => o.isMesh && !o.userData.underlay && !o.userData.isCurve && !o.userData.lightMarker && sel.push(o));
      this.outline.selectedObjects = sel;
    }
    if (this.bokeh) {
      const focus = fx.focus ?? vp.camera.position.distanceTo(vp.controls.target);
      this.bokeh.uniforms.focus.value = focus;
      this.bokeh.uniforms.aperture.value = 0.0025 * (2.8 / (fx.aperture || 2.8)) * (10 / Math.max(1, focus));
    }
    c.render();
  }

  // ---------------------------------------------------------------- path-traced stills
  async pathTrace({ width, height, samples, bounces }, stage, onProgress) {
    const vp = this.vp;
    const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
    const t0 = performance.now();
    const undo = stage(vp, width, height, false);
    const extra = new THREE.Group();
    const saved = { env: vp.scene.environment, bg: vp.scene.background, ground: vp.ground.visible };
    const markers = [];
    vp.modelRoot.traverse((o) => o.userData.lightMarker && o.visible && (markers.push(o), (o.visible = false)));
    let pt;
    try {
      // light by the environment's panorama, or a sky for the default and studio looks; a floor to stand on
      if (this.envSource) vp.scene.environment = this.envSource;
      else {
        const sky = new GradientEquirectTexture();
        sky.topColor.set(saved.env ? '#ffffff' : '#9cc2e8');
        sky.bottomColor.set(saved.env ? '#bdbab4' : '#e9e3d6');
        sky.update();
        vp.scene.environment = sky;
        if (!saved.env) vp.scene.background = sky;
      }
      const box = new THREE.Box3().setFromObject(vp.modelRoot);
      const r = box.isEmpty() ? 50 : box.getSize(new THREE.Vector3()).length() * 4;
      const floor = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#d9d4c8', roughness: 0.95 }));
      floor.position.y = Math.min(0, box.isEmpty() ? 0 : box.min.y) - 0.002;
      extra.add(floor);
      vp.ground.visible = false;
      vp.scene.add(extra);
      pt = new WebGLPathTracer(vp.renderer);
      pt.bounces = bounces;
      pt.filterGlossyFactor = 0.5;
      pt.tiles.set(2, 2);
      pt.renderToCanvas = true;
      Object.assign(pt, { renderDelay: 0, fadeDuration: 0, minSamples: 1 });
      pt.setScene(vp.scene, vp.camera);
      // shaders compile in the background first; then each call adds a tile of a sample
      const deadline = performance.now() + 20 * 60e3;
      let told = 0;
      while (pt.samples < samples && performance.now() < deadline) {
        pt.renderSample();
        if (performance.now() - told > 500) (told = performance.now()), onProgress?.(Math.floor(pt.samples), samples);
        await yieldNow();
      }
      if (pt.samples < 1) throw new Error('The path tracer did not start (the graphics card may not support it).');
      const blob = await new Promise((res) => vp.canvas.toBlob(res, 'image/png'));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, samples: Math.floor(pt.samples), seconds: Math.round((performance.now() - t0) / 100) / 10 };
    } finally {
      pt?.dispose();
      vp.scene.remove(extra);
      extra.traverse((o) => (o.geometry?.dispose(), o.material?.dispose()));
      Object.assign(vp.scene, { environment: saved.env, background: saved.bg });
      vp.ground.visible = saved.ground;
      markers.forEach((o) => (o.visible = true));
      undo();
      vp.render();
    }
  }
}

/** Let the page breathe without timers (a window in the background has its timers slowed to a crawl). */
const yieldNow = () => new Promise((res) => {
  const c = new MessageChannel();
  c.port1.onmessage = () => res();
  c.port2.postMessage(0);
});

// ---------------------------------------------------------------- seamless AI textures

/** Make an image tile without seams: its half-shifted copy at the borders, the original in the middle. → PNG bytes. */
export async function seamless(b64) {
  const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
  const [W, H] = [img.width, img.height];
  const a = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ga = a.getContext('2d', { willReadFrequently: true });
  ga.drawImage(img, 0, 0);
  const A = ga.getImageData(0, 0, W, H);
  const b = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const gb = b.getContext('2d', { willReadFrequently: true });
  for (const [x, y] of [[0, 0], [-W, 0], [0, -H], [-W, -H]]) gb.drawImage(img, x + W / 2, y + H / 2);
  const B = gb.getImageData(0, 0, W, H);
  const out = ga.createImageData(W, H);
  const ss = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.min(x, W - 1 - x, y, H - 1 - y) / (Math.min(W, H) / 2); // 0 at the border, 1 in the middle
      const w = ss(0.15, 0.55, d);
      const i = (y * W + x) * 4;
      for (let k = 0; k < 4; k++) out.data[i + k] = A.data[i + k] * w + B.data[i + k] * (1 - w);
    }
  ga.putImageData(out, 0, 0);
  const blob = await new Promise((res) => a.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
