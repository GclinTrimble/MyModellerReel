// Maps for a georeferenced model: web map tiles (lat/long ↔ tile), lat/long ↔ project grid for the projections we can
// compute (UTM zones, a few national transverse Mercator and Lambert grids, web Mercator), where a lat/long lands in the
// model, and the grid lines and labels of the view. Pure, Node-tested.
// shortcut: no datum shifts (ETRS89, NAD83, GDA2020 taken as WGS 84: about a metre), fine to place a map; use a real
// transformation library before using it for survey work.

const D2R = Math.PI / 180;
const R = 6378137; // WGS 84 / GRS80 semi-major axis
const F = 1 / 298.257223563;

/** The background maps. Attribution must stay on screen while a layer shows. */
export const LAYERS = {
  map: { name: 'Map', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attribution: '© OpenStreetMap contributors' },
  imagery: { name: 'Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  topo: { name: 'Topo', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', max: 19, attribution: 'Topo © Esri, HERE, Garmin, USGS' },
};
export const tileUrl = (layer, z, x, y) => LAYERS[layer].url.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/** Fractional web map tile of a lat/long at zoom z. */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * D2R);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
/** Lat/long of a (fractional) tile position at zoom z: [lon, lat]. */
export function tileToLonLat(x, y, z) {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / D2R];
}

// ---- projections
const E2 = F * (2 - F);
/** Transverse Mercator (Snyder's series, sub-millimetre within a zone). */
function tm({ lat0 = 0, lon0, k0, fe, fn }) {
  const ep2 = E2 / (1 - E2);
  const M = (p) => R * ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * p - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * p) + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * E2 ** 3) / 3072) * Math.sin(6 * p));
  const M0 = M(lat0 * D2R);
  return {
    forward(lon, lat) {
      const p = lat * D2R;
      const N = R / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
      const T = Math.tan(p) ** 2;
      const C = ep2 * Math.cos(p) ** 2;
      const A = Math.cos(p) * (lon - lon0) * D2R;
      const e = fe + k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
      const n = fn + k0 * (M(p) - M0 + N * Math.tan(p) * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
      return [e, n];
    },
    inverse(e, n) {
      const mu = (M0 + (n - fn) / k0) / (R * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
      const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
      const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
      const N1 = R / Math.sqrt(1 - E2 * Math.sin(p1) ** 2);
      const T1 = Math.tan(p1) ** 2;
      const C1 = ep2 * Math.cos(p1) ** 2;
      const R1 = (R * (1 - E2)) / (1 - E2 * Math.sin(p1) ** 2) ** 1.5;
      const D = (e - fe) / (N1 * k0);
      const lat = p1 - ((N1 * Math.tan(p1)) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
      const lon = lon0 * D2R + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(p1);
      return [lon / D2R, lat / D2R];
    },
  };
}
/** Lambert conformal conic, two standard parallels. */
function lcc({ lat1, lat2, lat0, lon0, fe, fn }) {
  const e = Math.sqrt(E2);
  const m = (p) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const [p1, p2, p0] = [lat1, lat2, lat0].map((x) => x * D2R);
  const nn = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const FF = m(p1) / (nn * t(p1) ** nn);
  const r0 = R * FF * t(p0) ** nn;
  return {
    forward(lon, lat) {
      const r = R * FF * t(lat * D2R) ** nn;
      const th = nn * (lon - lon0) * D2R;
      return [fe + r * Math.sin(th), fn + r0 - r * Math.cos(th)];
    },
    inverse(x, y) {
      const dx = x - fe;
      const dy = r0 - (y - fn);
      const r = Math.sign(nn) * Math.hypot(dx, dy);
      const tt = (r / (R * FF)) ** (1 / nn);
      let p = Math.PI / 2 - 2 * Math.atan(tt);
      for (let i = 0; i < 8; i++) p = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2));
      return [lon0 + Math.atan2(dx, dy) / nn / D2R, p / D2R];
    },
  };
}
const webMercator = {
  forward: (lon, lat) => [R * lon * D2R, R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2))],
  inverse: (x, y) => [x / R / D2R, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / D2R],
};
const utm = (zone, south) => tm({ lon0: zone * 6 - 183, k0: 0.9996, fe: 500000, fn: south ? 10000000 : 0 });
const GRIDS = {
  2193: () => tm({ lon0: 173, k0: 0.9996, fe: 1600000, fn: 10000000 }), // NZTM
  2157: () => tm({ lat0: 53.5, lon0: -8, k0: 0.99982, fe: 600000, fn: 750000 }), // Irish TM
  3006: () => tm({ lon0: 15, k0: 0.9996, fe: 500000, fn: 0 }), // SWEREF99 TM
  3067: () => tm({ lon0: 27, k0: 0.9996, fe: 500000, fn: 0 }), // TM35FIN
  3763: () => tm({ lat0: 39.66825833, lon0: -8.13310833, k0: 1, fe: 0, fn: 0 }), // Portugal TM06
  3414: () => tm({ lat0: 1.36666667, lon0: 103.83333333, k0: 1, fe: 28001.642, fn: 38744.572 }), // SVY21
  2154: () => lcc({ lat1: 49, lat2: 44, lat0: 46.5, lon0: 3, fe: 700000, fn: 6600000 }), // Lambert-93
  3812: () => lcc({ lat1: 49.83333333, lat2: 51.16666667, lat0: 50.797815, lon0: 4.35921583, fe: 649328, fn: 665262 }), // Belgian Lambert 2008
  3857: () => webMercator,
};

/** forward(lon, lat) → [E, N] and inverse(E, N) → [lon, lat] for an EPSG code we can compute, or null. */
export function projection(epsg) {
  const c = +epsg;
  if (!c) return null;
  if (GRIDS[c]) return GRIDS[c]();
  for (const [base, south] of [[32600, false], [32700, true], [25800, false], [26900, false]]) if (c > base && c <= base + 60) return utm(c - base, south); // WGS 84, ETRS89, NAD83 UTM
  if (c >= 7846 && c <= 7859) return utm(c - 7800, true); // GDA2020 MGA
  if (c >= 28348 && c <= 28358) return utm(c - 28300, true); // GDA94 MGA
  return null;
}

/**
 * Where lat/longs land in the model: { origin: [lon, lat] of the model origin, toLocal(lon, lat) → [x, z], grid: whether
 * it went through the project grid }. Through the projection when the coordinate system has one and a base point is
 * set (model x = E − base E, z = −(N − base N)); else around the geolocation on a local plane; null without either.
 */
export function placer({ base, epsg, geolocation }) {
  const p = projection(epsg);
  if (p && base)
    return {
      origin: p.inverse(base[0], base[1]),
      grid: true,
      toLocal(lon, lat) {
        const [e, n] = p.forward(lon, lat);
        return [e - base[0], -(n - base[1])];
      },
    };
  const g = geolocation;
  if (!g || !Number.isFinite(g.latitude) || !Number.isFinite(g.longitude)) return null;
  const [x0, y0] = webMercator.forward(g.longitude, g.latitude);
  const k = Math.cos(g.latitude * D2R); // web Mercator stretches by 1 / cos(lat)
  return {
    origin: [g.longitude, g.latitude],
    grid: false,
    toLocal(lon, lat) {
      const [x, y] = webMercator.forward(lon, lat);
      return [(x - x0) * k, -(y - y0) * k];
    },
  };
}

/** The tiles that cover `radius` metres around a lat/long with at most `across` tiles each way: { z, x0, y0, x1, y1 }. */
export function tilesAround(lon, lat, radius, across = 6, max = 19) {
  const world = 2 * Math.PI * R * Math.cos(lat * D2R); // metres around the parallel
  const z = Math.max(1, Math.min(max, Math.floor(Math.log2((world * (across - 1)) / (2 * radius)))));
  const c = lonLatToTile(lon, lat, z);
  const half = radius / (world / 2 ** z);
  const n = 2 ** z;
  const clampY = (v) => Math.max(0, Math.min(n - 1, v));
  return { z, x0: Math.floor(c.x - half), x1: Math.floor(c.x + half), y0: clampY(Math.floor(c.y - half)), y1: clampY(Math.floor(c.y + half)) };
}

/** A round grid spacing (1, 2, 5 × 10ⁿ) that gives about `lines` lines over `span`. */
export function gridStep(span, lines = 8) {
  const raw = Math.max(span, 1e-9) / lines;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}
/** The multiples of step between lo and hi (at most 200). */
export function gridValues(lo, hi, step) {
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 && out.length < 200; v += step) out.push(Math.round(v / step) * step);
  return out;
}
/** A grid label: "E 512 300", "N 5 400 050.5". */
export function gridLabel(axis, v, step) {
  const dec = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  const [i, f] = Math.abs(v).toFixed(dec).split('.');
  return `${axis} ${v < 0 ? '−' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f ? `.${f}` : ''}`;
}
