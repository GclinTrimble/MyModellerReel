// Underlay pictures (#140): a PDF page drawn by pdf.js, or an image (TIFF through geotiff), turned into a texture with
// its fade and monochrome applied, cached so moving or re-styling the model does not redraw the page.
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import * as PDF from '../core/pdf.js';
import * as U from '../core/underlay.js';
import { triangulateFace } from '../core/geometry.js';

const MAX_SIDE = 8192; // shortcut: one texture per page, capped; tile big sheets when 8k px is not sharp enough
const rasters = new Map(); // asset|page|hidden → Promise<canvas>
const textures = new Map(); // raster key|fade|mono → THREE.Texture

let geotiff;
async function loadGeoTiff() {
  if (geotiff) return geotiff;
  await new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = '../../node_modules/geotiff/dist-browser/geotiff.js';
    s.onload = ok;
    s.onerror = () => bad(new Error('Could not load the TIFF reader.'));
    document.head.append(s);
  });
  return (geotiff = window.GeoTIFF);
}

/** A GeoTIFF elevation grid (#37): band 0 as heights, thinned to about max samples a side, with its placement. */
export async function demRead(bytes, maxSide = 1200) {
  const GT = await loadGeoTiff();
  const img = await (await GT.fromArrayBuffer(bytes.slice().buffer)).getImage();
  const [W, H] = [img.getWidth(), img.getHeight()];
  const k = Math.max(1, Math.ceil(Math.max(W, H) / maxSide));
  const [w, h] = [Math.floor(W / k), Math.floor(H / k)];
  const [band] = await img.readRasters({ width: w, height: h, samples: [0], resampleMethod: 'nearest' });
  let affine = null;
  try {
    const [ox, oy] = img.getOrigin();
    const [rx, ry] = img.getResolution();
    affine = [rx * (W / w), 0, ox, 0, ry * (H / h), oy];
  } catch {
    // no placement tags
  }
  const nd = img.getGDALNoData?.();
  return { width: w, height: h, values: Float32Array.from(band), nodata: nd ?? -9999, affine };
}

/** Size and placement tags of a TIFF (for import_image). */
export async function tiffInfo(bytes) {
  const GT = await loadGeoTiff();
  const img = await (await GT.fromArrayBuffer(bytes.slice().buffer)).getImage();
  const tags = {};
  try {
    const [ox, oy] = img.getOrigin();
    const [rx, ry] = img.getResolution();
    Object.assign(tags, { ModelPixelScale: [rx, -ry, 0], ModelTiepoint: [0, 0, 0, ox, oy, 0] });
  } catch {
    // no georeferencing in this TIFF
  }
  return { width: img.getWidth(), height: img.getHeight(), tags };
}

async function rasterOf(u, maxSide) {
  const key = `${u.asset}|${u.page || 0}|${(u.hidden_layers || []).join(',')}`;
  if (!rasters.has(key)) rasters.set(key, draw(u, maxSide).catch((e) => (rasters.delete(key), Promise.reject(e))));
  return { key, canvas: await rasters.get(key) };
}

async function draw(u, maxSide) {
  const a = Assets.get(u.asset);
  if (!a) throw new Error('The file of this underlay is missing: import it again.');
  if (u.kind === 'pdf') {
    const pdf = await PDF.open(a.bytes, u.asset);
    const page = await pdf.getPage(u.page);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, maxSide / Math.max(vp1.width, vp1.height)) });
    const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    let optionalContentConfigPromise;
    if (u.hidden_layers?.length) {
      const cfg = await pdf.getOptionalContentConfig();
      for (const [id, grp] of cfg) if (u.hidden_layers.includes(grp.name)) cfg.setVisibility(id, false);
      optionalContentConfigPromise = Promise.resolve(cfg);
    }
    await page.render({ canvas: c, canvasContext: g, viewport: vp, optionalContentConfigPromise }).promise;
    return c;
  }
  if (a.mime === 'image/tiff') {
    const GT = await loadGeoTiff();
    const img = await (await GT.fromArrayBuffer(a.bytes.slice().buffer)).getImage();
    const step = Math.max(1, Math.ceil(Math.max(img.getWidth(), img.getHeight()) / maxSide));
    const [w, h] = [Math.floor(img.getWidth() / step), Math.floor(img.getHeight() / step)];
    const rgb = await img.readRGB({ width: w, height: h, interleave: true });
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const data = new ImageData(w, h);
    for (let i = 0, j = 0; i < w * h; i++, j += 3) data.data.set([rgb[j], rgb[j + 1], rgb[j + 2], 255], i * 4);
    c.getContext('2d').putImageData(data, 0, 0);
    return c;
  }
  const bmp = await createImageBitmap(new Blob([a.bytes], { type: a.mime }));
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** A texture for an underlay, blank until its picture is ready (then onReady re-renders the view). */
export function textureFor(u, renderer, onReady) {
  const maxSide = Math.min(MAX_SIDE, renderer?.capabilities.maxTextureSize || MAX_SIDE);
  const look = `${u.asset}|${u.page || 0}|${(u.hidden_layers || []).join(',')}|${u.fade || 0}|${u.mono ? 1 : 0}`;
  if (textures.has(look)) return textures.get(look);
  const tex = new THREE.CanvasTexture(Object.assign(document.createElement('canvas'), { width: 1, height: 1 }));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer?.capabilities.getMaxAnisotropy() || 1;
  textures.set(look, tex);
  rasterOf(u, maxSide)
    .then(({ canvas }) => {
      const c = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
      const g = c.getContext('2d');
      g.filter = u.mono ? 'grayscale(1) contrast(1.4)' : 'none';
      g.drawImage(canvas, 0, 0);
      g.filter = 'none';
      if (u.fade) (g.fillStyle = `rgba(255,255,255,${u.fade})`), g.fillRect(0, 0, c.width, c.height);
      tex.dispose(); // the GPU copy was sized for the 1 px placeholder: let three allocate it again
      tex.image = c;
      tex.needsUpdate = true;
      onReady?.();
    })
    .catch((e) => {
      textures.delete(look);
      onReady?.(e);
    });
  return tex;
}

/** The underlay's mesh in its entity's local space: the page rectangle (or its crop), UVs over the picture. */
export function underlayGeometry(u) {
  const outline = u.clip?.length > 2 ? u.clip : [[0, 0], [u.size[0], 0], [u.size[0], u.size[1]], [0, u.size[1]]];
  const v = outline.map(([s, t]) => {
    const [X, Y] = U.apply(u.affine, [s, t]);
    return [X, -0.01, -Y]; // 1 cm down: linework and models at its height draw over it
  });
  const tris = triangulateFace({ v, f: [v.map((_, i) => i)] }, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat().flatMap((i) => v[i]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(tris.flat().flatMap((i) => [outline[i][0] / u.size[0], 1 - outline[i][1] / u.size[1]]), 2));
  g.computeVertexNormals();
  return g;
}
