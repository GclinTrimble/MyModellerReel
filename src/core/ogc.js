// OGC web services as layers (#264–#268, #270): read the capabilities of WMTS 1.0, WMS 1.3, WFS 2.0 and OGC API
// (Tiles, Features) services, build their tile and feature requests, save a layer set as an OWS Context document and
// a style as SLD / SE. Pure, no network: the app fetches through its main process. Node-tested.
import * as X from './xml.js';

/** What we implement, per standard: docs/standards/ogc.md lists the same with its tests. */
export const CONFORMANCE = [
  { standard: 'OGC WMTS 1.0.0 (07-057r7)', classes: ['GetCapabilities', 'GetTile KVP', 'GetTile RESTful (ResourceURL template)'], not: ['GetFeatureInfo', 'SOAP'] },
  { standard: 'OGC Two Dimensional Tile Matrix Set 2.0 (17-083r4)', classes: ['WebMercatorQuad (EPSG:3857) tile matrix sets'], not: ['other tile matrix sets are listed but not drawn'] },
  { standard: 'OGC API - Tiles 1.0 (20-057)', classes: ['core', 'tileset', 'collections map tiles in WebMercatorQuad'], not: ['vector tiles'] },
  { standard: 'OGC WMS 1.3.0 (06-042)', classes: ['GetCapabilities', 'GetMap in EPSG:3857, one request per tile'], not: ['GetFeatureInfo', 'SLD_BODY'] },
  { standard: 'OGC WCS 2.0.1 (09-110r4) with the CRS (11-053r1) and scaling (12-039) extensions', classes: ['GetCapabilities', 'GetCoverage KVP per Web Mercator tile, GeoTIFF, as elevation (DTM / DSM)'], not: ['DescribeCoverage', 'range subsetting', 'other output formats'] },
  { standard: 'OGC WFS 2.0 (09-025r2)', classes: ['GetCapabilities', 'GetFeature with BBOX, COUNT / STARTINDEX paging, GeoJSON output, FES 2.0 PropertyIsEqualTo filters'], not: ['GML 3.2 output parsing', 'transactions', 'stored queries'] },
  { standard: 'OGC API - Features Part 1 Core 1.0 (17-069r4)', classes: ['core', 'geojson', 'bbox', 'limit and next links'], not: ['html'] },
  { standard: 'OGC API - Features Part 2 CRS by Reference 1.0 (18-058)', classes: ['crs: OGC:CRS84 requested; the project CRS when the collection offers it'], not: [] },
  { standard: 'OGC API - Features Part 3 Filtering (19-079r2)', classes: ['filter with filter-lang=cql2-text'], not: ['cql2-json'] },
  { standard: 'OGC OWS Context GeoJSON 1.0 (14-055r2)', classes: ['core', 'WMTS, WMS, WFS offerings'], not: [] },
  { standard: 'OGC Symbology Encoding 1.1 (05-077r4) / SLD 1.1 (05-078r4)', classes: ['LineSymbolizer, PolygonSymbolizer, PointSymbolizer, TextSymbolizer, PropertyIsEqualTo rules'], not: ['graphics, functions'] },
  { standard: 'OGC axis order policy (08-038r7)', classes: ['EPSG:4326 and urn:ogc:def:crs:EPSG::4326 latitude first; OGC:CRS84 longitude first'], not: [] },
];

export const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
const val = (el, k) => {
  const c = el && X.kid(el, k);
  return c ? (c.text ?? '').trim() : undefined;
};
const href = (el) => el?.attrs?.['xlink:href'] || el?.attrs?.href || '';
const base = (u) => String(u).split('?')[0];

/** Is this CRS URI / code latitude-first (OGC axis order)? Only geographic EPSG codes are; CRS84 is not. */
export function latFirst(crs) {
  const s = String(crs || '');
  if (/CRS84|CRS:84/i.test(s)) return false;
  return /(^|[:/])(4326|4258|4283|7844|4167|4269|4617|4189)$/.test(s.replace(/\s/g, ''));
}

// ---------------------------------------------------------------- capabilities

/** What kind of service a response is: wmts | wms | wfs | ogcapi | null. */
export function sniff(text) {
  const t = String(text).slice(0, 3000);
  if (/^\s*[{[]/.test(t)) return 'ogcapi';
  if (/<(\w+:)?Capabilities[\s>][\s\S]*WMTS|xmlns(:\w+)?="http:\/\/www\.opengis\.net\/wmts/.test(t)) return 'wmts';
  if (/WMS_Capabilities|WMT_MS_Capabilities/.test(t)) return 'wms';
  if (/WFS_Capabilities/.test(t)) return 'wfs';
  if (/<(\w+:)?Capabilities[\s>][\s\S]*opengis\.net\/wcs\/2/.test(t)) return 'wcs';
  return null;
}

const Z0_SCALE = 559082264.0287178; // WebMercatorQuad scale denominator at zoom 0 (0.28 mm pixels)
/** For a tile matrix set: the matrix id of each web map zoom level, or null when it is not Web Mercator. */
export function webMercatorZooms(set) {
  if (!/3857|900913|GoogleMapsCompatible|WebMercatorQuad/i.test(`${set.crs} ${set.wellKnown || ''} ${set.id}`)) return null;
  const zooms = [];
  for (const m of set.matrices) {
    const z = Math.log2(Z0_SCALE / m.scale);
    const tl = m.topLeft || [];
    const okCorner = tl.length < 2 || Math.abs(Math.abs(tl[0]) - 20037508.34) < 10 || Math.abs(Math.abs(tl[1]) - 20037508.34) < 10;
    if (Math.abs(z - Math.round(z)) < 0.01 && okCorner) zooms[Math.round(z)] = m.id;
  }
  return zooms.length ? zooms : null;
}

/** Read GetCapabilities XML (WMTS, WMS, WFS): { kind, version, title, provider, layers, sets?, getTile?, getMap?, getFeature? }. */
export function readCapabilities(text, url = '') {
  const kind = sniff(text);
  if (!kind || kind === 'ogcapi') throw new Error('Not a WMTS, WMS, WFS or WCS capabilities document.');
  const root = X.parse(text).children.find((c) => c.name && !c.name.startsWith('?'));
  const ident = X.kid(root, 'ServiceIdentification') || X.kid(root, 'Service');
  const provider = val(X.kid(root, 'ServiceProvider'), 'ProviderName') || X.all(root, 'ContactOrganization')[0]?.text.trim() || '';
  const out = { kind, version: root.attrs.version || '', title: val(ident, 'Title') || '', provider, url, layers: [] };
  const op = (name) => {
    const o = X.all(root, 'Operation').find((x) => x.attrs.name === name);
    const get = o && X.all(o, 'Get')[0];
    return get ? href(get) : '';
  };
  if (kind === 'wmts') {
    const contents = X.kid(root, 'Contents');
    out.sets = {};
    for (const s of X.kids(contents, 'TileMatrixSet')) {
      const set = { id: val(s, 'Identifier'), crs: val(s, 'SupportedCRS') || '', wellKnown: val(s, 'WellKnownScaleSet') || '', matrices: X.kids(s, 'TileMatrix').map((m) => ({ id: val(m, 'Identifier'), scale: +val(m, 'ScaleDenominator'), topLeft: X.nums(val(m, 'TopLeftCorner') || ''), size: [+val(m, 'TileWidth') || 256, +val(m, 'TileHeight') || 256], extent: [+val(m, 'MatrixWidth'), +val(m, 'MatrixHeight')] })) };
      set.zooms = webMercatorZooms(set);
      out.sets[set.id] = set;
    }
    out.getTile = op('GetTile');
    for (const l of X.kids(contents, 'Layer')) {
      const styles = X.kids(l, 'Style').map((s) => ({ id: val(s, 'Identifier'), default: s.attrs.isDefault === 'true' }));
      const tile = X.kids(l, 'ResourceURL').find((r) => r.attrs.resourceType === 'tile');
      out.layers.push({
        id: val(l, 'Identifier'),
        title: val(l, 'Title') || val(l, 'Identifier'),
        abstract: val(l, 'Abstract') || '',
        styles,
        formats: X.kids(l, 'Format').map((f) => f.text.trim()),
        sets: X.kids(l, 'TileMatrixSetLink').map((s) => val(s, 'TileMatrixSet')),
        template: tile?.attrs.template || '',
        templateFormat: tile?.attrs.format || '',
        dimensions: Object.fromEntries(X.kids(l, 'Dimension').map((d) => [val(d, 'Identifier'), val(d, 'Default') || val(d, 'Value') || ''])),
      });
    }
  } else if (kind === 'wms') {
    out.getMap = href(X.all(X.all(root, 'GetMap')[0] || { children: [] }, 'OnlineResource')[0]) || url;
    const walk = (l, inherited) => {
      const crs = [...inherited, ...X.kids(l, 'CRS').map((c) => c.text.trim()), ...X.kids(l, 'SRS').map((c) => c.text.trim())];
      const name = val(l, 'Name');
      if (name) out.layers.push({ id: name, title: val(l, 'Title') || name, abstract: val(l, 'Abstract') || '', styles: X.kids(l, 'Style').map((s) => ({ id: val(s, 'Name') })), crs: [...new Set(crs)], attribution: val(X.kid(l, 'Attribution'), 'Title') || '' });
      for (const c of X.kids(l, 'Layer')) walk(c, crs);
    };
    for (const l of X.kids(X.kid(root, 'Capability'), 'Layer')) walk(l, []);
    out.formats = X.all(X.all(root, 'GetMap')[0] || { children: [] }, 'Format').map((f) => f.text.trim());
  } else if (kind === 'wcs') {
    // coverages (DTM, DSM…): GetCoverage per web map tile needs the CRS and scaling extensions
    out.getCoverage = op('GetCoverage') || url;
    const profiles = X.all(root, 'Profile').map((p) => p.text.trim());
    out.crsExtension = profiles.some((p) => /WCS_service-extension_crs/.test(p));
    out.scaling = profiles.some((p) => /WCS_service-extension_scaling/.test(p));
    out.geotiff = profiles.some((p) => /geotiff/i.test(p)) || X.all(root, 'formatSupported').some((x) => /tiff/i.test(x.text));
    for (const c of X.all(root, 'CoverageSummary')) out.layers.push({ id: val(c, 'CoverageId'), title: val(c, 'Title') || val(c, 'CoverageId'), abstract: val(c, 'Abstract') || '' });
  } else {
    out.getFeature = op('GetFeature') || url;
    const formats = X.all(X.all(root, 'Operation').find((x) => x.attrs.name === 'GetFeature') || { children: [] }, 'Value').map((v) => v.text.trim());
    for (const f of X.all(root, 'FeatureType')) out.layers.push({ id: val(f, 'Name'), title: val(f, 'Title') || val(f, 'Name'), abstract: val(f, 'Abstract') || '', crs: [val(f, 'DefaultCRS') || val(f, 'DefaultSRS'), ...X.kids(f, 'OtherCRS').map((c) => c.text.trim())].filter(Boolean), formats: [...formats, ...X.all(f, 'Format').map((x) => x.text.trim())] });
    out.json = out.layers.some((l) => l.formats.some((x) => /json/i.test(x))) || formats.some((x) => /json/i.test(x));
  }
  return out;
}

/** An OGC API landing page and its /collections: { kind: 'ogcapi', title, layers: [{ id, title, crs, features, tiles }] }. */
export function readOgcApi(landing, collections, url = '') {
  const cols = collections?.collections || [];
  return {
    kind: 'ogcapi',
    title: landing?.title || '',
    provider: landing?.attribution || '',
    url: base(url).replace(/\/$/, ''),
    layers: cols.map((c) => ({
      id: c.id,
      title: c.title || c.id,
      abstract: c.description || '',
      crs: c.crs || [CRS84],
      storageCrs: c.storageCrs || null,
      features: (c.links || []).some((l) => /items/.test(l.rel) || /\/items/.test(l.href || '')) || c.itemType === 'feature',
      tiles: (c.links || []).some((l) => /tilesets-map|tiles/.test(l.rel || '')),
      attribution: c.attribution || '',
    })),
  };
}

// ---------------------------------------------------------------- requests

const q = (u, params) => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${u}${u.includes('?') ? (/[?&]$/.test(u) ? '' : '&') : '?'}${s}`;
};
/** Web Mercator bounds of tile x, y at zoom z: [minx, miny, maxx, maxy] metres. */
export function tileBounds(z, x, y) {
  const s = (2 * 20037508.342789244) / 2 ** z;
  return [-20037508.342789244 + x * s, 20037508.342789244 - (y + 1) * s, -20037508.342789244 + (x + 1) * s, 20037508.342789244 - y * s];
}

/**
 * The URL of one web map tile (zoom z, column x, row y in WebMercatorQuad) for a layer:
 * { type: xyz | wmts | wms | ogcapi, url, layer, style, format, set, zooms, dimensions }. null when the layer has no
 * matrix at that zoom.
 */
export function tileUrl(L, z, x, y) {
  if (L.type === 'xyz') return L.url.replace('{z}', z).replace('{x}', x).replace(/\{-?y\}/, y).replace('{s}', 'abc'[(x + y) % 3]);
  if (L.type === 'wms') {
    const [a, b, c, d] = tileBounds(z, x, y);
    return q(base(L.url), { SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: L.layer, STYLES: L.style || '', CRS: 'EPSG:3857', BBOX: `${a},${b},${c},${d}`, WIDTH: 256, HEIGHT: 256, FORMAT: L.format || 'image/png', TRANSPARENT: 'TRUE' });
  }
  if (L.type === 'ogcapi') return `${base(L.url).replace(/\/$/, '')}/collections/${encodeURIComponent(L.layer)}/map/tiles/WebMercatorQuad/${z}/${y}/${x}?f=${/jpe?g/.test(L.format || '') ? 'jpg' : 'png'}`;
  if (L.type === 'wcs') {
    const [a, b, c, d] = tileBounds(z, x, y);
    const crs = 'http://www.opengis.net/def/crs/EPSG/0/3857';
    return `${q(base(L.url), { SERVICE: 'WCS', VERSION: '2.0.1', REQUEST: 'GetCoverage', COVERAGEID: L.layer, FORMAT: 'image/tiff', SUBSETTINGCRS: crs, OUTPUTCRS: crs })}&SUBSET=x(${a},${c})&SUBSET=y(${b},${d})&SCALESIZE=x(256),y(256)`;
  }
  if (L.type === 'wmts') {
    const m = L.zooms?.[z];
    if (m === undefined || m === null) return null;
    if (L.template)
      return L.template
        .replace(/\{TileMatrixSet\}/gi, L.set)
        .replace(/\{TileMatrix\}/gi, m)
        .replace(/\{TileRow\}/gi, y)
        .replace(/\{TileCol\}/gi, x)
        .replace(/\{Style\}/gi, L.style || 'default')
        .replace(/\{(\w+)\}/g, (all, k) => L.dimensions?.[k] ?? all);
    return q(base(L.url), { SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0', LAYER: L.layer, STYLE: L.style || 'default', FORMAT: L.format || 'image/png', TILEMATRIXSET: L.set, TILEMATRIX: m, TILEROW: y, TILECOL: x });
  }
  throw new Error(`Unknown map layer type "${L.type}".`);
}

/** A layer from a service's capabilities, ready for tileUrl / featuresUrl. Throws when it cannot be drawn. */
export function layerFrom(caps, { layer, style, format, set } = {}) {
  const l = caps.layers.find((x) => x.id === layer) || (caps.layers.length === 1 ? caps.layers[0] : null);
  if (!l) throw new Error(`No layer "${layer}" in that service. It has: ${caps.layers.slice(0, 20).map((x) => x.id).join(', ')}${caps.layers.length > 20 ? '…' : ''}`);
  const common = { layer: l.id, title: l.title, attribution: [l.attribution, caps.provider, caps.title].filter(Boolean)[0] || '' };
  if (caps.kind === 'wmts') {
    const sets = (set ? [set] : l.sets).map((id) => caps.sets[id]).filter(Boolean);
    const s = sets.find((x) => x.zooms) || null;
    if (!s) throw new Error(`"${l.id}" has no Web Mercator tile matrix set (it offers ${l.sets.join(', ')}). Add it from the service's WMS instead, or ask its provider for WebMercatorQuad.`);
    const fmt = format || l.templateFormat || l.formats.find((f) => /png/.test(f)) || l.formats[0] || 'image/png';
    return { type: 'wmts', url: caps.getTile || caps.url, ...common, style: style || l.styles.find((x) => x.default)?.id || l.styles[0]?.id || 'default', format: fmt, set: s.id, zooms: s.zooms, template: l.template, dimensions: l.dimensions };
  }
  if (caps.kind === 'wcs') {
    if (!caps.crsExtension || !caps.scaling) throw new Error('That WCS cannot reproject and scale (the CRS and scaling extensions), so it cannot stream as tiles.');
    return { type: 'wcs', kind: 'elevation', encoding: 'geotiff', url: caps.getCoverage || caps.url, ...common };
  }
  if (caps.kind === 'wms') return { type: 'wms', url: caps.getMap || caps.url, ...common, style: style || '', format: format || (caps.formats || []).find((f) => /png/.test(f)) || 'image/png' };
  if (caps.kind === 'wfs') return { type: 'wfs', kind: 'features', url: caps.getFeature || caps.url, ...common, json: caps.json, crs: l.crs };
  if (caps.kind === 'ogcapi') return l.features ? { type: 'ogcapi-features', kind: 'features', url: caps.url, ...common, crs: l.crs } : { type: 'ogcapi', url: caps.url, ...common, format: format || 'image/png' };
  throw new Error('Unknown service.');
}

const fesEqual = (where) =>
  `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">${Object.keys(where).length > 1 ? '<fes:And>' : ''}${Object.entries(where).map(([k, v]) => `<fes:PropertyIsEqualTo><fes:ValueReference>${X.escape(k)}</fes:ValueReference><fes:Literal>${X.escape(v)}</fes:Literal></fes:PropertyIsEqualTo>`).join('')}${Object.keys(where).length > 1 ? '</fes:And>' : ''}</fes:Filter>`;
const cqlEqual = (where) => Object.entries(where).map(([k, v]) => `${k}=${typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`}`).join(' AND ');

/**
 * Features in a lon / lat box: the URL for a WFS 2.0 GetFeature or an OGC API - Features items request, in CRS84
 * (longitude first, no axis-order doubt). where: { attribute: value } equality; cql: CQL2 text (OGC API only).
 */
export function featuresUrl(L, bbox, { limit = 1000, start = 0, where = null, cql = null } = {}) {
  const [w, s, e, n] = bbox.map((v) => +(+v).toFixed(7));
  if (L.type === 'wfs') {
    if (cql) throw new Error('CQL2 filters need an OGC API - Features service; for WFS use where (attribute = value).');
    const filter = where && Object.keys(where).length ? fesEqual(where) : null;
    // CRS84 when the service offers it (longitude first); else EPSG:4326, latitude first (OGC axis order)
    const crs84 = !L.crs?.length || L.crs.some((c) => /CRS84/i.test(c));
    const srs = crs84 ? 'urn:ogc:def:crs:OGC:1.3:CRS84' : 'urn:ogc:def:crs:EPSG::4326';
    const box = crs84 ? `${w},${s},${e},${n},${srs}` : `${s},${w},${n},${e},${srs}`;
    return q(base(L.url), { SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: L.layer, COUNT: limit, STARTINDEX: start || undefined, SRSNAME: srs, OUTPUTFORMAT: 'application/json', ...(filter ? { FILTER: filter } : { BBOX: box }) });
  }
  if (L.type === 'ogcapi-features') {
    const filter = cql || (where && Object.keys(where).length ? cqlEqual(where) : null);
    return q(`${base(L.url).replace(/\/$/, '')}/collections/${encodeURIComponent(L.layer)}/items`, { f: 'json', bbox: `${w},${s},${e},${n}`, limit, offset: start || undefined, ...(filter ? { filter, 'filter-lang': 'cql2-text' } : {}) });
  }
  throw new Error(`${L.title || L.layer} is a map layer, not a feature layer.`);
}

/** Add a page of features, skipping ones already seen (servers that ignore paging send the same page again). Returns how many were new. */
export function addPage(list, seen, features) {
  let added = 0;
  for (const f of features) {
    const k = f.id ?? JSON.stringify([f.geometry, f.properties]);
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(f);
    added++;
  }
  return added;
}

/** The next page of an OGC API - Features response (its rel=next link), or null. */
export const nextLink = (fc) => (fc?.links || []).find((l) => l.rel === 'next')?.href || null;

/** Longitude / latitude order of a response, whatever the server did: swaps every position when the first one only
 *  is far closer to the requested box read latitude first. Returns whether it swapped. */
export function fixAxes(fc, [w, s, e, n]) {
  const first = (c) => (typeof c?.[0] === 'number' ? c : c && first(c[0]));
  const c = (fc.features || []).map((f) => first(f.geometry?.coordinates)).find(Boolean);
  const [cx, cy] = [(w + e) / 2, (s + n) / 2];
  // swapped only when the position read the other way round is far closer to the box asked for
  if (!c || Math.hypot(c[1] - cx, c[0] - cy) * 10 > Math.hypot(c[0] - cx, c[1] - cy)) return false;
  const sw = (p) => (typeof p[0] === 'number' ? [p[1], p[0], ...p.slice(2)] : p.map(sw));
  for (const f of fc.features) if (f.geometry?.coordinates) f.geometry.coordinates = sw(f.geometry.coordinates);
  return true;
}

/** Reproject a GeoJSON FeatureCollection in place: forward(lon, lat) → [E, N]; heights kept. */
export function projectGeoJson(fc, forward) {
  const tr = (c) => (typeof c[0] === 'number' ? [...forward(c[0], c[1]), ...c.slice(2)] : c.map(tr));
  const geom = (g) => {
    if (!g) return;
    if (g.type === 'GeometryCollection') g.geometries.forEach(geom);
    else g.coordinates = tr(g.coordinates);
  };
  for (const f of fc.features || []) geom(f.geometry);
  delete fc.crs;
  return fc;
}

// ---------------------------------------------------------------- OWS Context (OGC 14-055r2, GeoJSON encoding)

const OWC = 'http://www.opengis.net/spec/owc-geojson/1.0/req';
const OFFER = { wmts: `${OWC}/wmts`, wms: `${OWC}/wms`, wfs: `${OWC}/wfs`, wcs: `${OWC}/wcs`, ogcapi: 'http://www.opengis.net/spec/ogcapi-tiles-1/1.0/conf/core', 'ogcapi-features': 'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core', xyz: 'https://mymodellerreel.app/owc/xyz' };
const KIND = Object.fromEntries(Object.entries(OFFER).map(([k, v]) => [v, k]));

/** Layers (map and feature) as an OWS Context GeoJSON document. bbox: [w, s, e, n] in degrees, optional. */
export function toOwsContext(layers, { title = 'Map layers', bbox = null, updated = new Date().toISOString() } = {}) {
  return {
    type: 'FeatureCollection',
    id: `urn:uuid:mmr-${title.replace(/\W+/g, '-').toLowerCase()}`,
    properties: { lang: 'en', title, updated, links: { profiles: [{ href: `${OWC.replace('/req', '')}/core` }] } },
    ...(bbox ? { bbox } : {}),
    features: layers.map((L, i) => ({
      type: 'Feature',
      id: L.id || `layer-${i + 1}`,
      geometry: null,
      properties: {
        title: L.name || L.title || L.layer,
        updated,
        active: L.visible !== false,
        ...(L.attribution ? { rights: L.attribution } : {}),
        offerings: [
          {
            code: OFFER[L.type],
            operations: [{ code: L.type === 'xyz' ? 'GetTile' : L.kind === 'features' ? 'GetFeature' : L.type === 'wms' ? 'GetMap' : 'GetTile', method: 'GET', href: L.url }],
            ...(L.style && typeof L.style === 'object' ? { styles: [{ name: 'style', content: { type: 'application/vnd.ogc.se+xml', text: toSld(L.style, L.layer) } }] } : {}),
          },
        ],
        'mmr:layer': { type: L.type, kind: L.kind, layer: L.layer, style: L.style, format: L.format, set: L.set, zooms: L.zooms, template: L.template, dimensions: L.dimensions, opacity: L.opacity ?? 1, where: L.where, cql: L.cql, service: L.service, encoding: L.encoding, max_zoom: L.max_zoom },
      },
    })),
  };
}

/** Layers back from an OWS Context GeoJSON document (ours, or another writer's WMTS / WMS / WFS offerings). */
export function fromOwsContext(doc) {
  const j = typeof doc === 'string' ? JSON.parse(doc) : doc;
  if (j.type !== 'FeatureCollection' || !Array.isArray(j.features)) throw new Error('Not an OWS Context GeoJSON document.');
  return j.features
    .map((f) => {
      const p = f.properties || {};
      const o = (p.offerings || []).find((x) => KIND[x.code]) || p.offerings?.[0];
      const op = o?.operations?.[0];
      const own = p['mmr:layer'] || {};
      const type = own.type || KIND[o?.code];
      if (!type || !op?.href) return null;
      const url = new URL(op.href, 'http://x');
      const layer = own.layer || url.searchParams.get('LAYERS') || url.searchParams.get('LAYER') || url.searchParams.get('TYPENAMES') || url.searchParams.get('typeName') || '';
      const sld = o.styles?.find((s) => /se\+xml|sld/.test(s.content?.type || ''))?.content?.text;
      return { ...own, type, kind: own.kind || (type === 'wfs' || type === 'ogcapi-features' ? 'features' : type === 'wcs' ? 'elevation' : 'map'), name: p.title || layer, url: op.href, layer, visible: p.active !== false, opacity: own.opacity ?? 1, attribution: p.rights || '', ...(own.style ? {} : sld ? { style: fromSld(sld) } : {}) };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- styles (Symbology Encoding 1.1 subset)

/** { stroke, width, fill, fill_opacity, point, size, label, rules: [{ where: { attr: value }, stroke, fill }] } → SE FeatureTypeStyle. */
export function toSld(style = {}, name = 'layer') {
  const sym = (s) => {
    const out = [];
    if (s.fill) out.push(`<se:PolygonSymbolizer><se:Fill><se:SvgParameter name="fill">${s.fill}</se:SvgParameter><se:SvgParameter name="fill-opacity">${s.fill_opacity ?? 0.4}</se:SvgParameter></se:Fill>${s.stroke ? `<se:Stroke><se:SvgParameter name="stroke">${s.stroke}</se:SvgParameter></se:Stroke>` : ''}</se:PolygonSymbolizer>`);
    if (s.stroke) out.push(`<se:LineSymbolizer><se:Stroke><se:SvgParameter name="stroke">${s.stroke}</se:SvgParameter><se:SvgParameter name="stroke-width">${s.width ?? 1}</se:SvgParameter></se:Stroke></se:LineSymbolizer>`);
    if (s.point) out.push(`<se:PointSymbolizer><se:Graphic><se:Mark><se:WellKnownName>circle</se:WellKnownName><se:Fill><se:SvgParameter name="fill">${s.point}</se:SvgParameter></se:Fill></se:Mark><se:Size>${s.size ?? 6}</se:Size></se:Graphic></se:PointSymbolizer>`);
    if (s.label) out.push(`<se:TextSymbolizer><se:Label><ogc:PropertyName>${X.escape(s.label)}</ogc:PropertyName></se:Label></se:TextSymbolizer>`);
    return out.join('');
  };
  const rule = (s, where) => `<se:Rule>${where ? `<ogc:Filter>${Object.entries(where).map(([k, v]) => `<ogc:PropertyIsEqualTo><ogc:PropertyName>${X.escape(k)}</ogc:PropertyName><ogc:Literal>${X.escape(v)}</ogc:Literal></ogc:PropertyIsEqualTo>`).join('')}</ogc:Filter>` : '<se:ElseFilter/>'}${sym(s)}</se:Rule>`;
  const rules = [...(style.rules || []).map((r) => rule({ ...style, ...r, label: style.label }, r.where)), rule(style, null)];
  return `<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.1.0" xmlns="http://www.opengis.net/sld" xmlns:se="http://www.opengis.net/se" xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><se:Name>${X.escape(name)}</se:Name><UserStyle><se:FeatureTypeStyle>${rules.join('')}</se:FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
}

/** The subset above back from SLD / SE XML (another writer's too: the first stroke, fill, mark and label it finds). */
export function fromSld(xml) {
  const root = X.parse(xml);
  const param = (el, n) => X.all(el, 'SvgParameter').concat(X.all(el, 'CssParameter')).find((p) => p.attrs.name === n)?.text.trim();
  const read = (r) => {
    const s = {};
    const line = X.all(r, 'LineSymbolizer')[0];
    const poly = X.all(r, 'PolygonSymbolizer')[0];
    const pt = X.all(r, 'PointSymbolizer')[0];
    const tx = X.all(r, 'TextSymbolizer')[0];
    if (line) (s.stroke = param(line, 'stroke')), (s.width = +(param(line, 'stroke-width') || 1));
    if (poly) (s.fill = param(X.all(poly, 'Fill')[0] || poly, 'fill')), (s.fill_opacity = +(param(poly, 'fill-opacity') || 0.4)), (s.stroke ||= param(X.all(poly, 'Stroke')[0] || { children: [] }, 'stroke'));
    if (pt) (s.point = param(pt, 'fill')), (s.size = +(val(X.all(pt, 'Graphic')[0], 'Size') || 6));
    if (tx) s.label = X.all(tx, 'PropertyName')[0]?.text.trim();
    for (const k of Object.keys(s)) if (s[k] === undefined || Number.isNaN(s[k])) delete s[k];
    return s;
  };
  const rules = X.all(root, 'Rule');
  const els = rules.find((r) => X.all(r, 'ElseFilter').length || !X.all(r, 'Filter').length) || rules[0];
  const style = els ? read(els) : {};
  const more = rules
    .filter((r) => r !== els && X.all(r, 'PropertyIsEqualTo').length)
    .map((r) => ({ where: Object.fromEntries(X.all(r, 'PropertyIsEqualTo').map((p) => [X.all(p, 'PropertyName')[0]?.text.trim() || X.all(p, 'ValueReference')[0]?.text.trim(), X.all(p, 'Literal')[0]?.text.trim()])), ...read(r) }))
    .map(({ label, ...r }) => r);
  return { ...style, ...(more.length ? { rules: more } : {}) };
}

/** The colour of a feature under a style: the first rule whose where matches, else the style's own. */
export function styleFor(style = {}, props = {}) {
  const r = (style.rules || []).find((x) => Object.entries(x.where || {}).every(([k, v]) => String(props[k]) === String(v)));
  return { ...style, ...(r || {}) };
}

/** Does a GeoJSON geometry (project E, N) touch or cross a polyline [[E, N], …] within tol metres? */
export function touches(g, line, tol = 0.5) {
  if (!g || line.length < 1) return false;
  const segs = (pts) => pts.slice(1).map((p, i) => [pts[i], p]);
  const dist = (p, [a, b]) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const cross = ([a, b], [c, d]) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  };
  const inside = (p, ring) => {
    let k = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > p[1] !== ring[j][1] > p[1] && p[0] < ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) k = !k;
    return k;
  };
  const L = segs(line.length > 1 ? line : [line[0], line[0]]);
  const near = (pts) => pts.some((p) => L.some((s) => dist(p, s) <= tol)) || line.some((q) => segs(pts).some((s) => dist(q, s) <= tol)) || segs(pts).some((s) => L.some((t) => cross(s, t)));
  const parts = g.type === 'GeometryCollection' ? g.geometries : [g];
  return parts.some((p) => {
    const c = p.coordinates;
    if (p.type === 'Point') return near([c]);
    if (p.type === 'MultiPoint' || p.type === 'LineString') return near(c);
    if (p.type === 'MultiLineString') return c.some(near);
    const polys = p.type === 'Polygon' ? [c] : p.type === 'MultiPolygon' ? c : [];
    return polys.some((rings) => rings.some(near) || line.some((q) => inside(q, rings[0])));
  });
}
