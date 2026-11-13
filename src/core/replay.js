// Survey replay (#282–#286): a field book read as a record of the day's work, not only as coordinates.
// stats() is the day in numbers, plan() lays the observations on the timeline, and shotPose() puts the instrument
// and the rod where they stood, pointing down the line of sight the circle readings describe. Pure, Node-tested.
import { antennaHeight } from './fieldbook.js';

const DEG = Math.PI / 180;
const ms = (t) => (t ? Date.parse(t) : NaN);
const hhmm = (t) => (t || '').slice(11, 16);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Observations worth replaying and counting: stored, not deleted, in the order they were taken. */
export const live = (book) => book.observations.filter((o) => !o.deleted).slice().sort((a, b) => (ms(a.time) || 0) - (ms(b.time) || 0));

/** A shot taken without a prism: reflectorless (DR) shots have no rod to stand. */
export const reflectorless = (o) => o.kind === 'ts' && /dr|reflectorless|direct\s*reflex/i.test(`${o.method} ${o.survey_method} ${o.prism || ''}`);

// ---------------------------------------------------------------- the day in numbers (#282)

/**
 * How the day went: time on site, points per hour, the gaps, a row per setup and per code, and the quality of the
 * GNSS work. Read from the book, so it stays right when points are edited or deleted. gap: idle seconds that count.
 */
export function stats(book, { gap = 300 } = {}) {
  const obs = live(book);
  const timed = obs.filter((o) => Number.isFinite(ms(o.time)));
  const t0 = timed.length ? ms(timed[0].time) : null;
  const t1 = timed.length ? ms(timed.at(-1).time) : null;
  const hours = t0 !== null ? (t1 - t0) / 3600000 : 0;
  const names = new Set(obs.map((o) => o.name));

  const gaps = [];
  for (let i = 1; i < timed.length; i++) {
    const s = (ms(timed[i].time) - ms(timed[i - 1].time)) / 1000;
    if (s >= gap) gaps.push({ from: hhmm(timed[i - 1].time), to: hhmm(timed[i].time), minutes: r1(s / 60), after: timed[i - 1].name, before: timed[i].name });
  }

  const setups = [];
  for (const o of obs) {
    if (o.kind !== 'ts' || !o.setup) continue;
    const s = book.setups[o.setup];
    let row = setups.find((x) => x.id === o.setup);
    if (!row) setups.push((row = { id: o.setup, station: s?.station || o.setup, instrument_height: s?.ih ?? null, backsight: s?.backsights[0]?.point || null, shots: 0, from: '', to: '', sights: [] }));
    row.shots++;
    row.from ||= hhmm(o.time);
    row.to = hhmm(o.time);
    if (o.circle?.sd) row.sights.push(o.circle.sd);
  }
  for (const row of setups) {
    row.mean_sight = r1(mean(row.sights));
    row.longest_sight = r1(row.sights.length ? Math.max(...row.sights) : null);
    row.minutes = r1(timeSpan(obs.filter((o) => o.setup === row.id)) / 60);
    delete row.sights;
  }

  const codes = {};
  for (const o of obs) codes[o.code || '(none)'] = (codes[o.code || '(none)'] || 0) + 1;

  const gnss = obs.filter((o) => o.kind === 'gnss');
  const prec = gnss.map((o) => o.precision?.h).filter(Number.isFinite);
  const pdop = gnss.map((o) => o.qc?.pdop).filter(Number.isFinite);
  const sats = gnss.map((o) => o.qc?.satellites).filter(Number.isFinite);

  // how far the crew carried the rod: plan distance between consecutive stored points
  let walked = 0;
  let last = null;
  for (const o of obs) {
    const p = book.results[o.name];
    if (!p) continue;
    if (last) walked += Math.hypot(p.n - last.n, p.e - last.e);
    last = p;
  }

  return {
    points: names.size,
    observations: obs.length,
    deleted: book.observations.length - obs.length,
    start: hhmm(timed[0]?.time),
    end: hhmm(timed.at(-1)?.time),
    hours: r1(hours),
    points_per_hour: hours > 0 ? r1(names.size / hours) : null,
    idle_minutes: r1(gaps.reduce((t, g) => t + g.minutes, 0)),
    gaps,
    by_method: {
      total_station: obs.filter((o) => o.kind === 'ts' && !reflectorless(o)).length,
      reflectorless: obs.filter(reflectorless).length,
      gnss: gnss.length,
      keyed: obs.filter((o) => o.kind === 'keyed').length,
      computed: obs.filter((o) => o.kind === 'computed').length,
    },
    checks: obs.filter((o) => /check/i.test(o.cls)).length,
    backsights: obs.filter((o) => /backsight/i.test(o.cls)).length,
    setups,
    bases: Object.values(book.bases).map((b) => ({ point: b.point, antenna_height: r3(antennaHeight(b.antenna)), antenna: b.antenna?.antenna || '' })),
    gnss_quality: gnss.length ? { worst_precision: r3(prec.length ? Math.max(...prec) : null), mean_pdop: r1(mean(pdop)), worst_pdop: r1(pdop.length ? Math.max(...pdop) : null), mean_satellites: r1(mean(sats)) } : null,
    target_heights: [...new Set(obs.filter((o) => o.kind === 'ts' && !reflectorless(o)).map((o) => r3(o.th)))].sort((a, b) => a - b),
    antenna_heights: [...new Set(gnss.map((o) => r3(antennaHeight(o.antenna))))].sort((a, b) => a - b),
    codes: Object.fromEntries(Object.entries(codes).sort((a, b) => b[1] - a[1])),
    walked: r1(walked),
    notes: book.notes.length,
    photos: book.media.length,
  };
}

const timeSpan = (list) => {
  const t = list.map((o) => ms(o.time)).filter(Number.isFinite);
  return t.length ? (Math.max(...t) - Math.min(...t)) / 1000 : 0;
};

// ---------------------------------------------------------------- the timeline (#283)

export const MODES = ['clock', 'event'];

/**
 * Lay a book's observations on the timeline.
 *  clock — the real time stamps, so travel and waiting show; seconds_per_hour sets the pace.
 *  event — one observation after another, so a day fits in a minute; seconds_per_point sets the pace.
 * speed multiplies both. epoch (ms) is a clock origin shared by several books, so two crews interleave as they worked.
 * Books with no time stamps fall back to event spacing whichever mode is asked for.
 */
export function plan(book, { mode = 'clock', speed = 1, seconds_per_hour = 90, seconds_per_point = 0.4, start = 0, epoch = null, tail = 1.5 } = {}) {
  if (!MODES.includes(mode)) throw new Error(`mode is clock or event, not "${mode}".`);
  const obs = live(book);
  if (!obs.length) throw new Error('That survey has no observations to replay.');
  const sp = Math.max(0.01, speed || 1);
  const timed = obs.every((o) => Number.isFinite(ms(o.time)));
  const by = timed && mode === 'clock' ? 'clock' : 'event';
  const t0 = epoch ?? (timed ? ms(obs[0].time) : 0);
  const at = (o, i) => (by === 'clock' ? start + ((ms(o.time) - t0) / 3600000) * (seconds_per_hour / sp) : start + (i * (seconds_per_point / sp)));

  const dots = obs.map((o, i) => ({
    id: o.id,
    name: o.name,
    code: o.code || '',
    kind: reflectorless(o) ? 'dr' : o.kind,
    cls: /backsight|check/i.test(o.cls) ? o.cls.toLowerCase() : '',
    setup: o.setup || o.base || '',
    time: hhmm(o.time),
    t: Math.round(Math.max(0, at(o, i)) * 1000) / 1000,
  }));

  // the day as blocks of work: a band per run of shots from the same setup or base
  const bands = [];
  for (const d of dots) {
    const b = bands.at(-1);
    if (b && b.setup === d.setup) b.t1 = d.t;
    else bands.push({ setup: d.setup, station: book.setups[d.setup]?.station || book.bases[d.setup]?.point || '', kind: book.bases[d.setup] ? 'base' : book.setups[d.setup] ? 'station' : 'other', t0: d.t, t1: d.t });
  }

  return { mode: by, speed: sp, dots, bands, epoch: t0, start, duration: Math.round((dots.at(-1).t + tail) * 1000) / 1000 };
}

// ---------------------------------------------------------------- where the instrument stood (#285, #286)

/**
 * The geometry of one total-station shot, in project coordinates: where the tripod stood, where its trunnion axis
 * is (the instrument height above the station), which way the telescope points, and where the prism and the foot of
 * the rod are. It follows the circle readings, not the stored coordinate, so a wrong rod or instrument height shows
 * up as the rod standing above or below the ground. posOf(name) gives a point's position { n, e, z }.
 * shortcut: the grid scale factor is left out (sub-millimetre over a sight), it belongs to the reduction, not the view.
 */
export function shotPose(book, o, posOf) {
  if (o.kind !== 'ts' || !o.circle) return null;
  const s = book.setups[o.setup];
  const st = s && posOf(s.station);
  if (!st || o.circle.ha == null || o.circle.va == null || o.circle.sd == null) return null;
  const bs = s.backsights[0];
  const bp = bs && posOf(bs.point);
  const ori = bp && bs.hc1 != null ? Math.atan2(bp.e - st.e, bp.n - st.n) / DEG - bs.hc1 + (bs.oc || 0) : 0;
  const az = o.circle.ha + ori;
  const va = o.circle.va;
  const sd = o.circle.sd;
  const hd = sd * Math.sin(va * DEG);
  const vd = sd * Math.cos(va * DEG);
  const trunnion = { n: st.n, e: st.e, z: st.z + s.ih };
  const prism = { n: trunnion.n + hd * Math.cos(az * DEG), e: trunnion.e + hd * Math.sin(az * DEG), z: trunnion.z + vd };
  return {
    kind: 'ts',
    station: st,
    trunnion,
    prism,
    foot: { ...prism, z: prism.z - o.th },
    azimuth: ((az % 360) + 360) % 360,
    zenith: va,
    distance: sd,
    ih: s.ih,
    height: o.th,
    beam: !reflectorless(o),
  };
}

/** Where the rover pole stood for a GNSS shot: its foot at the point, the antenna phase centre above it. */
export function rovePose(book, o, posOf) {
  if (o.kind !== 'gnss') return null;
  const p = posOf(o.name);
  if (!p) return null;
  const h = antennaHeight(o.antenna);
  return { kind: 'gnss', foot: { ...p }, antenna: { ...p, z: p.z + h }, height: h, precision: o.precision?.h ?? null };
}

/** The pose of whichever instrument took an observation, or null when nothing was standing (keyed and computed points). */
export const poseOf = (book, o, posOf) => (o.kind === 'ts' ? shotPose(book, o, posOf) : o.kind === 'gnss' ? rovePose(book, o, posOf) : null);
