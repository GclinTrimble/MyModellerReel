// Sun by place and time (#66, #87): the sun's azimuth (degrees clockwise from true north) and elevation for a
// latitude / longitude and a moment, from the usual low-precision solar formulas (about 0.01°; refraction ignored).
// The model's north can be turned: north_angle is true north measured clockwise from the model's −z.

const R = Math.PI / 180;
const mod = (x, m) => ((x % m) + m) % m;

/** Sun position at a UTC instant (Date or ms). Returns { azimuth, elevation } in degrees. */
export function sunPosition(when, lat, lon) {
  const n = (+when) / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = mod(357.528 + 0.9856003 * n, 360) * R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R;
  const eps = (23.439 - 0.0000004 * n) * R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = mod(280.46061837 + 360.98564736629 * n, 360);
  const ha = (gmst + lon) * R - ra;
  const phi = lat * R;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { azimuth: mod(az / R, 360), elevation: el / R };
}

/** "2026-06-21" + "14:30" (local clock at utc_offset hours) → a UTC instant (ms). */
export function localTime(date, time = '12:00', utcOffset = 0) {
  const d = String(date).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!d) throw new Error(`Date "${date}": use YYYY-MM-DD.`);
  const t = String(time).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!t) throw new Error(`Time "${time}": use HH:MM.`);
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +(t[2] || 0)) - utcOffset * 3600000;
}

export const hours = (time) => {
  const t = String(time).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!t) throw new Error(`Time "${time}": use HH:MM.`);
  return +t[1] + (+(t[2] || 0)) / 60;
};
export const clock = (h) => `${String(Math.floor(mod(h, 24))).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/** The geolocation of a document, with defaults (Greenwich, the time zone from the longitude). */
export function geoOf(doc) {
  const g = doc.settings.geolocation || {};
  return { latitude: g.latitude ?? 51.48, longitude: g.longitude ?? 0, north_angle: g.north_angle ?? 0, utc_offset: g.utc_offset ?? Math.round((g.longitude ?? 0) / 15), place: g.place || '' };
}

/** The sun in model terms (azimuth from the model's −z) for a local date and time at the document's place. */
export function modelSun(doc, date, time) {
  const g = geoOf(doc);
  const s = sunPosition(localTime(date, time, g.utc_offset), g.latitude, g.longitude);
  return { azimuth: Math.round(mod(s.azimuth + g.north_angle, 360) * 100) / 100, elevation: Math.round(s.elevation * 100) / 100, true_azimuth: Math.round(s.azimuth * 100) / 100 };
}

/**
 * A sun study on the timeline (doc.animation.sun): { date, from, to, start, end } sweeps the clock over a day;
 * { time, from_date, to_date, start, end } the same hour over a span of dates. Returns the sun at timeline time t.
 */
export function sunAt(doc, t) {
  const s = doc.animation.sun;
  if (!s) return null;
  const u = Math.max(0, Math.min(1, (t - s.start) / Math.max(1e-6, s.end - s.start)));
  if (s.from_date) {
    const a = Date.parse(`${s.from_date}T00:00:00Z`);
    const b = Date.parse(`${s.to_date}T00:00:00Z`);
    const day = new Date(a + u * (b - a)).toISOString().slice(0, 10);
    return { ...modelSun(doc, day, s.time || '12:00'), date: day, time: s.time || '12:00' };
  }
  const h = hours(s.from) + u * (hours(s.to) - hours(s.from));
  return { ...modelSun(doc, s.date, clock(h)), date: s.date, time: clock(h) };
}
