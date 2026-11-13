// Elevation from web services (#elevation): DTM / DSM tiles streamed like map tiles (Terrarium and Terrain-RGB PNG,
// GeoTIFF from WMTS, WMS or OGC WCS 2.0 GetCoverage), heights sampled where needed, and an area turned into a grid for
// a surface (surfaces.js demMesh). Pure: the app decodes the images (io.imageRgba, io.demRead). Node-tested.

const R = 6378137;
const D2R = Math.PI / 180;

/** Heights packed in RGB: Terrarium (Mapzen / AWS terrain tiles) and Terrain-RGB (Mapbox, MapTiler). Metres. */
export const ENCODINGS = {
  terrarium: (r, g, b) => r * 256 + g + b / 256 - 32768,
  mapbox: (r, g, b) => -10000 + (r * 65536 + g * 256 + b) * 0.1,
};

/** RGBA pixels of an encoded PNG tile to heights (transparent pixels have no height: NaN). */
export function decodeRgba(rgba, width, height, encoding) {
  const f = ENCODINGS[encoding];
  if (!f) throw new Error(`Unknown elevation encoding "${encoding}": terrarium, mapbox or geotiff.`);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3] === 0 ? NaN : f(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return out;
}

/** A tile's raster as a height grid: no-data values (GeoTIFF nodata, ±3.4e38) become NaN. */
export function cleanHeights(values, nodata = null) {
  const out = Float32Array.from(values);
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i]) || out[i] === nodata || Math.abs(out[i]) > 1e6) out[i] = NaN;
  return out;
}

/** Fractional web map tile of a lon / lat at zoom z. */
function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * D2R);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

/** Ground size of one pixel of a 256 px tile at zoom z and latitude lat, metres. */
export const pixelSize = (z, lat) => (2 * Math.PI * R * Math.cos(lat * D2R)) / (256 * 2 ** z);

/** The zoom whose pixels are about `spacing` metres at this latitude (capped to max). */
export const zoomFor = (spacing, lat, max = 18) => Math.max(0, Math.min(max, Math.round(Math.log2((2 * Math.PI * R * Math.cos(lat * D2R)) / (256 * spacing)))));

/** The tiles { z, x, y } covering a lon / lat box at zoom z. */
export function tilesIn([w, s, e, n], z) {
  const [x0, y0] = tileXY(w, n, z).map(Math.floor);
  const [x1, y1] = tileXY(e, s, z).map(Math.floor);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}

/**
 * Height at a lon / lat from loaded tiles: tiles is a Map "z/x/y" → { width, height, values }. The deepest zoom that has
 * the place wins; bilinear between pixel centres, NaN where there is no data.
 */
export function heightAt(tiles, lon, lat, maxZoom = 22) {
  for (let z = maxZoom; z >= 0; z--) {
    const [fx, fy] = tileXY(lon, lat, z);
    const t = tiles.get(`${z}/${Math.floor(fx)}/${Math.floor(fy)}`);
    if (!t) continue;
    const px = (fx - Math.floor(fx)) * t.width - 0.5;
    const py = (fy - Math.floor(fy)) * t.height - 0.5;
    const c0 = Math.max(0, Math.min(t.width - 1, Math.floor(px)));
    const r0 = Math.max(0, Math.min(t.height - 1, Math.floor(py)));
    const c1 = Math.min(t.width - 1, c0 + 1);
    const r1 = Math.min(t.height - 1, r0 + 1);
    const [u, v] = [Math.max(0, Math.min(1, px - c0)), Math.max(0, Math.min(1, py - r0))];
    const at = (r, c) => t.values[r * t.width + c];
    const q = [[at(r0, c0), (1 - u) * (1 - v)], [at(r0, c1), u * (1 - v)], [at(r1, c0), (1 - u) * v], [at(r1, c1), u * v]].filter(([h, w]) => Number.isFinite(h) && w > 0);
    if (!q.length) return Number.isFinite(at(r0, c0)) ? at(r0, c0) : NaN;
    const wsum = q.reduce((s, [, w]) => s + w, 0);
    return q.reduce((s, [h, w]) => s + h * w, 0) / wsum;
  }
  return NaN;
}

/**
 * A grid of heights over a box of project coordinates [E0, N0, E1, N1] every `spacing` metres, for demMesh:
 * { width, height, values, nodata, affine } (affine to project E / N). toLonLat(E, N) → [lon, lat]; sample(lon, lat) → height.
 */
export function areaGrid([e0, n0, e1, n1], spacing, toLonLat, sample) {
  const width = Math.max(2, Math.round((e1 - e0) / spacing) + 1);
  const height = Math.max(2, Math.round((n1 - n0) / spacing) + 1);
  if (width * height > 4e6) throw new Error(`That is ${width} × ${height} samples: use a larger spacing or a smaller area.`);
  const values = new Float32Array(width * height);
  let found = 0;
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const h = sample(...toLonLat(e0 + c * spacing, n1 - r * spacing));
      values[r * width + c] = Number.isFinite(h) ? h : -9999;
      if (Number.isFinite(h)) found++;
    }
  if (!found) throw new Error('The elevation service has no heights in that area.');
  // demMesh samples pixel centres (+0.5): the affine puts those centres on the grid nodes
  return { width, height, values, nodata: -9999, affine: [spacing, 0, e0 - spacing / 2, 0, -spacing, n1 + spacing / 2], found };
}
