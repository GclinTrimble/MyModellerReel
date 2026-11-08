// Coordinate systems for a place (#189): which projected systems are used where, so nobody needs to know an EPSG
// number. UTM zones are worked out from the longitude; national grids come from a short table with their areas of use
// (west, south, east, north in degrees). Offline, pure, Node-tested.

/** National and regional grids: [epsg, name, country / region, [w, s, e, n]]. */
export const GRIDS = [
  [27700, 'OSGB36 / British National Grid', 'United Kingdom', [-8.8, 49.8, 1.9, 60.9]],
  [2157, 'IRENET95 / Irish Transverse Mercator', 'Ireland', [-10.6, 51.4, -5.3, 55.5]],
  [2154, 'RGF93 v1 / Lambert-93', 'France', [-5.2, 41.3, 9.6, 51.1]],
  [28992, 'Amersfoort / RD New', 'Netherlands', [3.2, 50.7, 7.3, 53.6]],
  [31370, 'Belge 1972 / Belgian Lambert 72', 'Belgium', [2.5, 49.5, 6.4, 51.5]],
  [3812, 'ETRS89 / Belgian Lambert 2008', 'Belgium', [2.5, 49.5, 6.4, 51.5]],
  [2056, 'CH1903+ / LV95', 'Switzerland', [5.9, 45.8, 10.5, 47.8]],
  [25832, 'ETRS89 / UTM zone 32N', 'Germany, Denmark, Norway (west), Italy (west)', [6, 38, 12, 72]],
  [25833, 'ETRS89 / UTM zone 33N', 'Germany (east), Austria, Norway, Sweden, Poland (west)', [12, 46, 18, 72]],
  [31467, 'DHDN / 3-degree Gauss-Kruger zone 3', 'Germany (legacy)', [7.5, 47.3, 10.5, 55.1]],
  [3006, 'SWEREF99 TM', 'Sweden', [10.0, 55.3, 24.2, 69.1]],
  [3067, 'ETRS89 / TM35FIN(E,N)', 'Finland', [19.1, 59.8, 31.6, 70.1]],
  [2180, 'ETRS89 / Poland CS92', 'Poland', [14.1, 49.0, 24.2, 54.9]],
  [25830, 'ETRS89 / UTM zone 30N', 'Spain (most), Portugal (east), France (west)', [-6, 35, 0, 62]],
  [3763, 'ETRS89 / Portugal TM06', 'Portugal', [-9.6, 36.9, -6.2, 42.2]],
  [6875, 'RDN2008 / Italy zone (N-E)', 'Italy', [6.6, 35.5, 18.6, 47.1]],
  [3003, 'Monte Mario / Italy zone 1', 'Italy (west, legacy)', [6.6, 36.6, 12.0, 47.1]],
  [2100, 'GGRS87 / Greek Grid', 'Greece', [19.6, 34.8, 28.3, 41.8]],
  [2193, 'NZGD2000 / New Zealand Transverse Mercator 2000', 'New Zealand', [166.4, -47.3, 178.6, -34.1]],
  [7855, 'GDA2020 / MGA zone 55', 'Australia (Victoria, NSW, Tasmania)', [144, -44, 150, -9]],
  [7856, 'GDA2020 / MGA zone 56', 'Australia (NSW, Queensland coast)', [150, -38, 156, -9]],
  [7854, 'GDA2020 / MGA zone 54', 'Australia (South Australia, Victoria west)', [138, -40, 144, -9]],
  [7850, 'GDA2020 / MGA zone 50', 'Australia (Western Australia)', [114, -36, 120, -12]],
  [3857, 'WGS 84 / Pseudo-Mercator', 'World (web maps)', [-180, -85, 180, 85]],
  [2232, 'NAD83 / Colorado Central (ftUS)', 'United States: Colorado', [-109.1, 38.1, -102.0, 40.1]],
  [2263, 'NAD83 / New York Long Island (ftUS)', 'United States: New York City', [-74.3, 40.5, -71.8, 41.3]],
  [2229, 'NAD83 / California zone 5 (ftUS)', 'United States: Los Angeles', [-121.5, 32.7, -114.1, 35.8]],
  [2227, 'NAD83 / California zone 3 (ftUS)', 'United States: San Francisco Bay', [-123.6, 36.7, -117.8, 38.7]],
  [2278, 'NAD83 / Texas South Central (ftUS)', 'United States: Houston, San Antonio', [-100.0, 27.8, -93.8, 30.7]],
  [3348, 'NAD83 / Statistics Canada Lambert', 'Canada', [-141, 40, -47, 86]],
  [6669, 'JGD2011 / Japan Plane Rectangular CS I', 'Japan (Nagasaki)', [128.2, 26.0, 130.5, 34.8]],
  [6677, 'JGD2011 / Japan Plane Rectangular CS IX', 'Japan (Tokyo)', [138.4, 29.3, 141.1, 37.9]],
  [2326, 'Hong Kong 1980 Grid System', 'Hong Kong', [113.8, 22.1, 114.5, 22.6]],
  [3414, 'SVY21 / Singapore TM', 'Singapore', [103.6, 1.1, 104.1, 1.5]],
  [22234, 'Cape / Lo35 (legacy SA grid)', 'South Africa (Lo35)', [32, -28, 33, -26]],
  [31983, 'SIRGAS 2000 / UTM zone 23S', 'Brazil (Rio de Janeiro, Sao Paulo)', [-48, -34, -42, 0]],
  [32198, 'NAD83 / Quebec Lambert', 'Canada: Quebec', [-79.8, 44.9, -57.1, 62.6]],
];

const inside = ([w, s, e, n], lon, lat) => lon >= w && lon <= e && lat >= s && lat <= n;

/** The WGS 84 UTM zone for a place (Norway and Svalbard exceptions included). */
export function utmZone(lon, lat) {
  let zone = Math.floor((((lon + 180) % 360) + 360) % 360 / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) zone = lon < 9 ? 31 : lon < 21 ? 33 : lon < 33 ? 35 : lon < 42 ? 37 : zone;
  const north = lat >= 0;
  return { zone, north, epsg: (north ? 32600 : 32700) + zone, name: `WGS 84 / UTM zone ${zone}${north ? 'N' : 'S'}` };
}

/**
 * Coordinate systems for a place and / or words (a country, a name, a code): [{ epsg, name, area, why }], best first.
 * With a place: the national grids that cover it, its UTM zone (WGS 84, and ETRS89 in Europe, NAD83 in North
 * America), then web Mercator. With words only: the grids whose name, area or code match.
 */
export function suggest({ latitude = null, longitude = null, query = '' } = {}) {
  const out = [];
  const add = (epsg, name, area, why) => !out.some((x) => x.epsg === epsg) && out.push({ epsg, name, area, why });
  const words = String(query).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const matches = (g) => words.every((w) => `${g[0]} ${g[1]} ${g[2]}`.toLowerCase().includes(w));
  const here = latitude !== null && longitude !== null && Number.isFinite(+latitude) && Number.isFinite(+longitude);
  if (here) {
    const [lat, lon] = [+latitude, +longitude];
    for (const g of GRIDS) if (g[0] !== 3857 && inside(g[3], lon, lat) && (!words.length || matches(g))) add(g[0], g[1], g[2], 'covers this place');
    const u = utmZone(lon, lat);
    if (lon >= -16 && lon <= 40 && lat >= 34 && lat <= 72 && u.north && u.zone >= 28 && u.zone <= 38) add(25800 + u.zone, `ETRS89 / UTM zone ${u.zone}N`, 'Europe', 'the UTM zone of this place (ETRS89, Europe)');
    if (lon >= -170 && lon <= -50 && lat >= 14 && u.north && u.zone >= 1 && u.zone <= 23) add(26900 + u.zone, `NAD83 / UTM zone ${u.zone}N`, 'North America', 'the UTM zone of this place (NAD83)');
    add(u.epsg, u.name, 'World', 'the UTM zone of this place (WGS 84)');
  }
  if (words.length) for (const g of GRIDS) if (matches(g)) add(g[0], g[1], g[2], 'matches your words');
  const zone = String(query).match(/utm\s*(?:zone\s*)?(\d{1,2})\s*([ns])?/i);
  if (zone) {
    const z = +zone[1];
    const south = /s/i.test(zone[2] || '');
    if (z >= 1 && z <= 60) add((south ? 32700 : 32600) + z, `WGS 84 / UTM zone ${z}${south ? 'S' : 'N'}`, 'World', 'the UTM zone you asked for');
  }
  if (here && !words.length) add(3857, 'WGS 84 / Pseudo-Mercator', 'World (web maps)', 'web maps');
  return out;
}
