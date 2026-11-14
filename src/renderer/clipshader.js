// Clip volumes in the shader (#290): one GLSL test injected with onBeforeCompile into any material (meshes, lines,
// fat lines, points, the point cloud material of cloudmaterial.js), fed by shared uniforms. A fragment the clips cut
// away is discarded (or stippled to a faint ghost). The test is clip.js visible(), in GLSL.
//   patchClip(material)              once per material (idempotent); keeps the material's own onBeforeCompile
//   updateClipUniforms(doc, pane)    before drawing a pane (1–4): the clips that pane sees, animated by the pose
//   patchTree(root, doc)             every material under root, with each entity's scope (clip ids / layers)
import * as THREE from 'three';
import * as CV from '../core/clip.js';

const arr = (n, f) => Array.from({ length: n }, f);
/** Shared by every patched material: setting a value here reaches them all at their next draw. */
export const uniforms = {
  mmrClipPlanes: { value: arr(CV.LIMITS.plane, () => new THREE.Vector4()) },
  mmrClipSlabs: { value: arr(CV.LIMITS.slab, () => new THREE.Vector4()) },
  mmrClipSlabHalf: { value: arr(CV.LIMITS.slab, () => 0) },
  mmrClipBoxes: { value: arr(CV.LIMITS.box, () => new THREE.Matrix4()) },
  mmrClipBoxHalf: { value: arr(CV.LIMITS.box, () => new THREE.Vector3()) },
  mmrClipBoxKeep: { value: arr(CV.LIMITS.box, () => 1) },
  mmrClipPane: { value: 0 }, // mask bits of the clips that cut this pane
  mmrClipCombine: { value: 0 }, // 0 any, 1 all
  mmrClipGhost: { value: 0 },
};

export const CLIP_GLSL = /* glsl */ `
uniform vec4 mmrClipPlanes[${CV.LIMITS.plane}];
uniform vec4 mmrClipSlabs[${CV.LIMITS.slab}];
uniform float mmrClipSlabHalf[${CV.LIMITS.slab}];
uniform mat4 mmrClipBoxes[${CV.LIMITS.box}];
uniform vec3 mmrClipBoxHalf[${CV.LIMITS.box}];
uniform float mmrClipBoxKeep[${CV.LIMITS.box}];
uniform int mmrClipPane;
uniform int mmrClipMask;
uniform int mmrClipCombine;
uniform int mmrClipGhost;
varying vec3 mmrClipWorld;
bool mmrClipped(vec3 p) {
  int on = mmrClipPane & mmrClipMask;
  if (on == 0) return false;
  for (int i = 0; i < ${CV.LIMITS.plane}; i++) if (((on >> (${CV.BIT0.plane} + i)) & 1) == 1 && dot(mmrClipPlanes[i].xyz, p) + mmrClipPlanes[i].w > 0.0) return true;
  for (int i = 0; i < ${CV.LIMITS.slab}; i++) if (((on >> (${CV.BIT0.slab} + i)) & 1) == 1 && abs(dot(mmrClipSlabs[i].xyz, p) + mmrClipSlabs[i].w) > mmrClipSlabHalf[i]) return true;
  bool inner = false;
  bool anyIn = false;
  bool allIn = true;
  for (int i = 0; i < ${CV.LIMITS.box}; i++) {
    if (((on >> (${CV.BIT0.box} + i)) & 1) == 0) continue;
    vec3 l = (mmrClipBoxes[i] * vec4(p, 1.0)).xyz;
    bool isIn = all(lessThanEqual(abs(l), mmrClipBoxHalf[i]));
    if (mmrClipBoxKeep[i] > 0.5) {
      inner = true;
      anyIn = anyIn || isIn;
      allIn = allIn && isIn;
    } else if (isIn) return true;
  }
  return inner && (mmrClipCombine == 1 ? !allIn : !anyIn);
}
`;
const MAIN = /void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/;
const VARY = 'varying vec3 mmrClipWorld;\n';

function vertex(src) {
  if (src.includes('#include <project_vertex>'))
    return VARY + src.replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_INSTANCING
  mmrClipWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  mmrClipWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`);
  // fat lines (LineMaterial): each quad corner belongs to one end of its segment
  const at = src.includes('instanceStart') ? '(position.y < 0.5 ? instanceStart : instanceEnd)' : 'position';
  return VARY + src.replace(MAIN, (m) => `${m}\n  mmrClipWorld = (modelMatrix * vec4(${at}, 1.0)).xyz;`);
}
const fragment = (src) =>
  CLIP_GLSL + src.replace(MAIN, (m) => `${m}\n  if (mmrClipped(mmrClipWorld) && (mmrClipGhost == 0 || mod(gl_FragCoord.x, 3.0) >= 1.0 || mod(gl_FragCoord.y, 3.0) >= 1.0)) discard;`);

/** Make a material honour the clip volumes. Its mask (userData.mmrClip.value) says which clips cut it (-1: all). */
export function patchClip(m) {
  if (!m || m.userData.mmrClip?.isMmrClip || m.isRawShaderMaterial) return m;
  const mask = { value: -1, isMmrClip: true };
  m.userData.mmrClip = mask;
  const prev = m.onBeforeCompile;
  const key = m.customProgramCacheKey;
  m.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms, { mmrClipMask: mask });
    shader.vertexShader = vertex(shader.vertexShader);
    shader.fragmentShader = fragment(shader.fragmentShader);
  };
  // the default key is onBeforeCompile's source: ours is the same for every material, so keep the original one's
  m.customProgramCacheKey = function () {
    const own = this.onBeforeCompile;
    this.onBeforeCompile = prev;
    try {
      return `${key.call(this)}|mmrclip`;
    } finally {
      this.onBeforeCompile = own;
    }
  };
  m.needsUpdate = true;
  return m;
}

/** The clips as the pose shows them (clip:<name> keys; the old section target moves the active section plane). */
export function posedClips(doc, pose) {
  const active = doc.settings.section_active;
  return CV.clipsOf(doc).map((c) => {
    let x = CV.withPose(c, pose?.[`clip:${c.name}`]);
    if (pose?.section?.point && c.kind === 'plane' && c.name === active) x = { ...x, point: pose.section.point, normal: pose.section.normal || x.normal };
    return x;
  });
}

/** Fill the shared uniforms for one pane (1–4). Returns the slots (clip.js slots()). */
export function updateClipUniforms(doc, pane = 1, pose = null) {
  const sl = CV.slots(doc, posedClips(doc, pose));
  const U = uniforms;
  sl.plane.forEach((c, i) => U.mmrClipPlanes.value[i].set(...c.normal, -c.normal.reduce((s, n, k) => s + n * c.point[k], 0)));
  sl.slab.forEach((c, i) => {
    U.mmrClipSlabs.value[i].set(...c.normal, -c.normal.reduce((s, n, k) => s + n * c.point[k], 0));
    U.mmrClipSlabHalf.value[i] = c.thickness / 2;
  });
  sl.box.forEach((c, i) => {
    U.mmrClipBoxes.value[i].copy(CV.inverseMatrix(c));
    U.mmrClipBoxHalf.value[i].set(...c.size.map((s) => s / 2));
    U.mmrClipBoxKeep.value[i] = c.keep === 'outside' ? 0 : 1;
  });
  U.mmrClipPane.value = CV.paneMask(sl, pane);
  U.mmrClipCombine.value = doc.settings.clip_combine === 'all' ? 1 : 0;
  U.mmrClipGhost.value = doc.settings.show_clipped === 'ghost' ? 1 : 0;
  return sl;
}

/** The shadow pass draws depth with its own material: one patched copy per mask, so cut-away parts cast no shadow. */
const depthMats = new Map();
function depthFor(mask) {
  if (!depthMats.has(mask)) {
    const m = patchClip(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    m.userData.mmrClip.value = mask;
    depthMats.set(mask, m);
  }
  return depthMats.get(mask);
}

/**
 * Patch every material under root and give each its entity's mask: a clip scoped to ids / layers leaves the others
 * alone; a section cap (userData.clipName) is not cut by its own clip. A material shared by objects that need
 * different masks is copied.
 */
export function patchTree(root, doc, sl = CV.slots(doc)) {
  const scoped = CV.KINDS.some((k) => sl[k].some((c) => c.ids || c.layers));
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const seen = new Map();
  root.traverse((o) => {
    if (!o.material) return;
    let mask = -1;
    if (o.userData.clipName !== undefined) mask = sl.bit.has(o.userData.clipName) ? ~(1 << sl.bit.get(o.userData.clipName)) : -1;
    else if (scoped) {
      let x = o;
      while (x && x.userData.entityId === undefined) x = x.parent;
      mask = CV.scopeMask(doc, sl, x && byId.get(x.userData.entityId));
    }
    const mats = [].concat(o.material).map((m) => {
      if (seen.has(m) && seen.get(m) !== mask) {
        m = m.clone();
        delete m.userData.mmrClip;
      }
      seen.set(m, mask);
      patchClip(m).userData.mmrClip.value = mask;
      return m;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
    if (o.castShadow && o.isMesh) o.customDepthMaterial = depthFor(mask);
  });
}
