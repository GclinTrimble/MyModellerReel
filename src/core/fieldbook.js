// Survey field books (#257, #258, #259, #269): the raw measurements behind survey points, so a field mistake (rod
// height, instrument height, prism constant, antenna, backsight) can be fixed in the office and the points follow.
// The model follows OGC InfraGML 1.0 Part 6 Survey (OGC 16-106r2): Survey, Equipment, InstrumentSetup, Observation,
// SurveyResult. Read from Trimble JobXML (.jxl). Pure module, Node-tested.
//
// Recompute works by difference: a point's new position is the controller's own result plus (our reduction with the
// edited values − our reduction with the original values). Unedited points stay exactly as the field software
// computed them (its station setup and grid corrections included); an edit moves them by what it changes.
import * as X from './xml.js';

export const STANDARD = 'OGC InfraGML 1.0 Part 6 Survey (16-106r2)';
const DEG = Math.PI / 180;
const R_EARTH = 6378137;

const val = (el, k) => {
  const c = el && X.kid(el, k);
  return c ? (c.text ?? '').trim() : el?.attrs?.[k];
};
const num = (el, k) => {
  const v = val(el, k);
  return v === undefined || v === '' || v === null || isNaN(+v) ? null : +v;
};
const xyz = (el) => (el && num(el, 'North') !== null ? { n: num(el, 'North'), e: num(el, 'East'), z: num(el, 'Elevation') ?? 0 } : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** True instrument / target height from how it was measured (slant to a notch: √(m² − h²) + v). */
export function trueHeight(raw) {
  if (!raw || raw.measured == null) return null;
  const h = raw.hOff || 0;
  const v = raw.vOff || 0;
  return /true/i.test(raw.method || 'TrueHeight') || (!h && !v) ? raw.measured : Math.sqrt(Math.max(0, raw.measured ** 2 - h ** 2)) + v;
}

/** GNSS antenna height to the phase centre: raw measurements add the antenna's offsets, corrected ones are final. */
export function antennaHeight(a) {
  if (!a) return 0;
  if (a.type !== 'Raw') return a.measured ?? 0;
  const m = (a.measured ?? 0) + (a.tape || 0);
  return (a.hOff ? Math.sqrt(Math.max(0, m * m - a.hOff * a.hOff)) : m) + (a.vOff || 0);
}

const noteText = (r) => X.all(r, 'Note').map((n) => (n.text ?? '').trim()).filter(Boolean).join(' / ');

/** Read a JobXML file into a field book: { standard, job, setups, bases, observations, results, notes, media, report }. */
export function readJobXml(text) {
  const root = X.parse(text);
  const job = X.kid(root, 'JOBFile');
  if (!job) throw new Error('Not a Trimble JobXML file (no <JOBFile>).');
  const book = X.kid(job, 'FieldBook');
  const recs = book ? book.children.filter((c) => c.name) : [];
  const byId = new Map(recs.filter((r) => r.attrs?.ID).map((r) => [r.attrs.ID, r]));
  const out = {
    standard: STANDARD,
    job: { name: job.attrs.jobName || '', product: job.attrs.product || '', version: job.attrs.productVersion || '', crs: null, projection: null, units: 'm' },
    instruments: {},
    setups: {},
    bases: {},
    observations: [],
    results: {},
    notes: [],
    media: [],
    report: { records: {}, kept: [], recompute: 0 },
  };
  const count = (k) => (out.report.records[k] = (out.report.records[k] || 0) + 1);
  const antennaOf = (id) => {
    const a = byId.get(id);
    if (!a) return null;
    const eq = byId.get(val(a, 'GPSEquipmentID'));
    return { measured: num(a, 'MeasuredHeight') ?? 0, type: val(a, 'MeasurementType') || 'Corrected', vOff: eq ? num(eq, 'AntennaVerticalOffset') || 0 : 0, hOff: eq ? num(eq, 'AntennaHorizontalOffset') || 0 : 0, tape: eq ? num(eq, 'AntennaTapeAdjustment') || 0 : 0, method: eq ? val(eq, 'AntennaMeasurementMethod') || '' : '', antenna: eq ? val(eq, 'AntennaType') || '' : '' };
  };
  for (const r of recs) {
    count(r.name);
    const time = r.attrs?.TimeStamp || '';
    const id = r.attrs?.ID;
    if (r.name === 'InstrumentRecord') out.instruments[id] = { type: val(r, 'Type') || '', serial: val(r, 'SerialNumber') || '', edm_ppm: num(r, 'EDMppm'), edm_precision: num(r, 'EDMPrecision') };
    else if (r.name === 'CoordinateSystemRecord') out.job.crs = { system: val(r, 'SystemName') || '', zone: val(r, 'ZoneName') || '', datum: val(r, 'DatumName') || '' };
    else if (r.name === 'ProjectionRecord') {
      const p = X.kid(r, 'Projection');
      if (p) out.job.projection = { type: val(p, 'Type'), lat0: num(p, 'CentralLatitude'), lon0: num(p, 'CentralLongitude'), fn: num(p, 'FalseNorthing'), fe: num(p, 'FalseEasting'), k0: num(p, 'Scale') };
    } else if (r.name === 'StationRecord') {
      const raw = X.kid(r, 'RawTheodoliteHeight');
      const atm = byId.get(val(r, 'AtmosphereID'));
      out.setups[id] = {
        id,
        kind: 'station',
        type: val(r, 'StationType') || '',
        station: val(r, 'StationName'),
        ih: num(r, 'TheodoliteHeight') ?? 0,
        raw: raw ? { measured: num(raw, 'MeasuredHeight'), method: val(raw, 'MeasurementMethod'), hOff: num(raw, 'HorizontalOffset') || 0, vOff: num(raw, 'VerticalOffset') || 0 } : null,
        instrument: val(r, 'InstrumentID') || null,
        scale: num(r, 'ScaleFactor') ?? 1,
        ppm: atm ? num(atm, 'PPM') ?? 0 : 0,
        refraction: atm ? num(atm, 'RefractionCoefficient') ?? 0.142 : 0.142,
        backsights: [],
        time,
        edits: {},
      };
    } else if (r.name === 'BackBearingRecord') {
      const s = out.setups[val(r, 'StationRecordID')];
      if (s) s.backsights.push({ id, point: val(r, 'BackSight'), hc1: num(r, 'Face1HorizontalCircle'), hc2: num(r, 'Face2HorizontalCircle'), oc: num(r, 'OrientationCorrection') || 0, oc_se: num(r, 'OrientationCorrectionStandardError') });
    } else if (r.name === 'ReferenceRecord') out.bases[id] = { id, kind: 'base', point: val(r, 'PointName'), antenna: antennaOf(val(r, 'AntennaID')), time, edits: {} };
    else if (r.name === 'NoteRecord') {
      const t = noteText(r);
      if (t) out.notes.push({ time, text: t, record: id });
    } else if (r.name === 'MediaFileRecord' || r.name === 'ImageRecord') {
      const f = val(r, 'FileName');
      if (f) out.media.push({ time, file: f.replace(/\\/g, '/'), record: val(r, 'RecordID') || val(r, 'PointRecordID') || null, setup: val(r, 'StationID') || null, kind: r.name === 'ImageRecord' ? 'image' : 'media' });
    } else if (r.name === 'PointRecord') {
      const circle = X.kid(r, 'Circle');
      if (val(r, 'Deleted') === 'true' && !circle && !X.kid(r, 'ECEFDeltas') && !X.kid(r, 'Grid') && !X.kid(r, 'ComputedGrid')) {
        for (const o of out.observations) if (o.name === val(r, 'Name')) o.deleted = true; // older jobs: a bare record deletes the point
        continue;
      }
      const tgt = byId.get(val(r, 'TargetID'));
      const ecef = X.kid(r, 'ECEFDeltas');
      const ref = val(r, 'ReferenceRecordID');
      const wgs = X.kid(r, 'WGS84');
      const prec = X.kid(r, 'Precision');
      const qc = X.kid(r, 'QualityControl1');
      const attrs = {};
      for (const f of X.all(r, 'Feature')) for (const a of X.kids(f, 'Attribute')) {
        const n = val(a, 'Name');
        const v = val(a, 'Value');
        if (n) attrs[n] = v === undefined || v === '' || isNaN(+v) ? v ?? '' : +v;
      }
      const o = {
        id,
        name: val(r, 'Name'),
        code: val(r, 'Code') || '',
        desc: val(r, 'Description1') || '',
        method: val(r, 'Method') || '',
        survey_method: val(r, 'SurveyMethod') || '',
        cls: val(r, 'Classification') || 'Normal',
        deleted: val(r, 'Deleted') === 'true',
        time,
        file: xyz(X.kid(r, 'ComputedGrid')) || xyz(X.kid(r, 'Grid')),
        edits: {},
      };
      if (Object.keys(attrs).length) o.attrs = attrs;
      if (circle) {
        o.kind = 'ts';
        o.setup = val(r, 'StationID') || null;
        o.circle = { ha: num(circle, 'HorizontalCircle'), va: num(circle, 'VerticalCircle'), sd: num(circle, 'EDMDistance'), face: val(circle, 'Face') || 'Face1', ha_se: num(circle, 'HorizontalCircleStandardError'), va_se: num(circle, 'VerticalCircleStandardError'), sd_se: num(circle, 'EDMDistanceStandardError') };
        const rawT = tgt && X.kid(tgt, 'RawTargetHeight');
        o.th = tgt ? num(tgt, 'TargetHeight') ?? 0 : 0;
        o.pc = tgt ? num(tgt, 'PrismConstant') ?? 0 : 0;
        o.prism = tgt ? val(tgt, 'PrismType') || '' : '';
        if (rawT && val(rawT, 'MeasurementMethod') && !/true/i.test(val(rawT, 'MeasurementMethod'))) o.th_raw = { measured: num(rawT, 'MeasuredHeight'), method: val(rawT, 'MeasurementMethod'), hOff: num(rawT, 'HorizontalOffset') || 0, vOff: num(rawT, 'VerticalOffset') || 0 };
      } else if (ecef && ref) {
        o.kind = 'gnss';
        o.base = ref;
        o.vector = { dx: num(ecef, 'DeltaX'), dy: num(ecef, 'DeltaY'), dz: num(ecef, 'DeltaZ') };
        o.antenna = antennaOf(val(r, 'AntennaID'));
      } else if (/keyed|coordinates|copied/i.test(`${o.method} ${o.survey_method}`)) o.kind = 'keyed';
      else {
        o.kind = 'computed'; // COGO, offsets, scans: kept as the controller computed them
        if (o.method) out.report.kept.includes(o.method) || out.report.kept.push(o.method);
      }
      if (prec) o.precision = { h: num(prec, 'Horizontal'), v: num(prec, 'Vertical') };
      if (qc) o.qc = { satellites: num(qc, 'NumberOfSatellites'), pdop: num(qc, 'PDOP'), hdop: num(qc, 'HDOP'), vdop: num(qc, 'VDOP') };
      if (wgs && num(wgs, 'Latitude') !== null) o.wgs84 = { lat: num(wgs, 'Latitude'), lon: num(wgs, 'Longitude'), h: num(wgs, 'Height') };
      out.observations.push(o);
    }
  }
  if (!out.job.crs?.system) {
    const cs = X.all(job, 'CoordinateSystem')[0]; // older jobs keep it in <Environment>
    if (cs) out.job.crs = { system: val(cs, 'SystemName') || '', zone: val(cs, 'ZoneName') || '', datum: val(cs, 'DatumName') || '' };
  }
  // results: the reduced coordinates when the job has them, else the field book's grid of the deciding observation
  const red = new Map();
  const reductions = X.kid(job, 'Reductions');
  for (const p of reductions ? X.kids(reductions, 'Point') : []) {
    const g = xyz(X.kid(p, 'Grid'));
    if (g) red.set(val(p, 'Name'), { ...g, code: val(p, 'Code') || '', desc: val(p, 'Description1') || '' });
  }
  for (const name of new Set(out.observations.map((o) => o.name))) {
    const o = decidingObservation(out, name);
    const g = red.get(name) || o?.file;
    if (o && g) out.results[name] = { obs: o.id, n: g.n, e: g.e, z: g.z };
  }
  out.report.recompute = out.observations.filter((o) => o.kind === 'ts' || o.kind === 'gnss').length;
  return out;
}

/** Which observation makes a point: the last one not deleted, measured points before backsights and checks. */
export function decidingObservation(book, name) {
  const live = book.observations.filter((o) => o.name === name && !o.deleted && (o.file || o.kind === 'ts' || o.kind === 'gnss'));
  const main = live.filter((o) => !/backsight|check/i.test(o.cls));
  return (main.length ? main : live).at(-1) || null;
}

/** Points to add for a book: name, N, E, Z, code, description, attributes and the observation behind each. */
export function bookPoints(book) {
  const obs = new Map(book.observations.map((o) => [o.id, o]));
  return Object.entries(book.results).map(([name, r]) => {
    const o = obs.get(r.obs);
    return { name, n: r.n, e: r.e, z: r.z, code: o?.code || '', desc: o?.desc || '', attrs: o?.attrs || {}, obs: r.obs };
  });
}

// ---------------------------------------------------------------- reduction

const orig = (rec, k) => (k in (rec.edits || {}) ? rec.edits[k] : rec[k]);

/** Grid position of a total-station shot: orientation from the backsight, curvature and refraction, heights. */
export function reduceShot({ station, backsight, bs, ha, va, sd, ih, th, scale = 1, refraction = 0.142 }) {
  if (!station || ha == null || va == null || sd == null) return null;
  let ori = 0;
  if (backsight && bs && bs.hc1 != null) ori = Math.atan2(backsight.e - station.e, backsight.n - station.n) / DEG - bs.hc1 + (bs.oc || 0);
  const az = (ha + ori) * DEG;
  const hd = sd * Math.sin(va * DEG);
  const vd = sd * Math.cos(va * DEG) + ((1 - refraction) * hd * hd) / (2 * R_EARTH);
  return { n: station.n + hd * scale * Math.cos(az), e: station.e + hd * scale * Math.sin(az), z: station.z + ih + vd - th };
}

/**
 * Recompute the points of a book after edits. pointNow(name) gives a point's current position in the model for
 * stations and bases the book does not measure. Returns { coords: Map(name → {n, e, z}), removed, moved }.
 */
export function recompute(book, pointNow = () => null) {
  const fileOf = (name) => book.results[name] || null;
  const current = new Map();
  const posNow = (name) => current.get(name) || pointNow(name) || fileOf(name);
  const coordOf = new Map(); // observation id → computed position
  for (const o of book.observations) {
    if (o.deleted) continue;
    // keyed-in points edited in place move by their edit; everything starts from the original position
    const base = 'file' in o.edits ? o.edits.file : o.file;
    let d = 'file' in o.edits && o.file && base ? [o.file.n - base.n, o.file.e - base.e, o.file.z - base.z] : [0, 0, 0];
    if (o.kind === 'ts') {
      const s = book.setups[o.setup];
      if (!s) continue;
      const bsNow = s.backsights[0];
      const bsOrig = s.edits.backsight !== undefined ? { ...bsNow, point: s.edits.backsight } : bsNow;
      const c = o.circle;
      const dsd = (o.pc - orig(o, 'pc')) + c.sd * (s.ppm - orig(s, 'ppm')) * 1e-6;
      const a = reduceShot({ station: fileOf(s.station), backsight: bsOrig && fileOf(bsOrig.point), bs: bsOrig, ha: c.ha, va: c.va, sd: c.sd, ih: orig(s, 'ih'), th: orig(o, 'th'), scale: orig(s, 'scale'), refraction: s.refraction });
      const b = reduceShot({ station: posNow(s.station), backsight: bsNow && posNow(bsNow.point), bs: bsNow, ha: c.ha, va: c.va, sd: c.sd + dsd, ih: s.ih, th: o.th, scale: s.scale, refraction: s.refraction });
      if (a && b) d = [b.n - a.n, b.e - a.e, b.z - a.z];
    } else if (o.kind === 'gnss') {
      const bs = book.bases[o.base];
      if (bs) {
        const was = fileOf(bs.point);
        const now = posNow(bs.point);
        const ah = (rec) => antennaHeight(rec.antenna);
        const ahOrig = (rec) => antennaHeight('antenna' in rec.edits ? rec.edits.antenna : rec.antenna);
        d = was && now ? [now.n - was.n, now.e - was.e, now.z - was.z] : [0, 0, 0];
        d[2] += ah(bs) - ahOrig(bs) - (ah(o) - ahOrig(o));
      }
    }
    if (!base) continue;
    // the deciding observation starts from the reduced coordinates, so an unedited job matches the controller exactly
    // shortcut: COGO and offset points keep their stored position, they do not follow edits of their source points
    const r = book.results[o.name];
    const start = r && r.obs === o.id ? r : base;
    const p = { n: start.n + d[0], e: start.e + d[1], z: start.z + d[2] };
    coordOf.set(o.id, p);
    // a station or base later in the job moves by this shot's change, from the point's own result
    const now = r ? { n: r.n + d[0], e: r.e + d[1], z: r.z + d[2] } : p;
    if (!/backsight|check/i.test(o.cls) || !current.has(o.name)) current.set(o.name, now);
  }
  const coords = new Map();
  const removed = [];
  const moved = [];
  for (const name of new Set(book.observations.map((o) => o.name))) {
    const o = decidingObservation(book, name);
    const p = o && coordOf.get(o.id);
    const was = fileOf(name);
    if (!p) {
      if (was) removed.push(name);
      continue;
    }
    coords.set(name, p);
    if (was) {
      const dd = { name, dn: p.n - was.n, de: p.e - was.e, dz: p.z - was.z };
      if (Math.hypot(dd.dn, dd.de, dd.dz) > 1e-6) moved.push(dd);
    }
  }
  return { coords, removed, moved };
}

// ---------------------------------------------------------------- listing and editing

const timeIn = (t, from, to) => (!from || t >= from) && (!to || t <= to);
const hhmm = (t) => (t || '').slice(11, 16);

/** Observations matching a filter: ids, names (globs), setup, base, kind, code, time range (ISO or "10:05"). */
export function selectObservations(book, f = {}) {
  const day = book.observations.find((o) => o.time)?.time.slice(0, 10) || '';
  const full = (t) => (t && /^\d\d:\d\d/.test(t) ? `${day}T${t.length === 5 ? `${t}:00` : t}` : t);
  const glob = (g) => new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  const names = f.names?.length ? f.names.map(glob) : null;
  const ids = f.ids?.length ? new Set(f.ids) : null;
  const station = f.setup && Object.values(book.setups).find((s) => s.id === f.setup || s.station === f.setup);
  return book.observations.filter(
    (o) =>
      (!ids || ids.has(o.id)) &&
      (!names || names.some((r) => r.test(o.name))) &&
      (!f.setup || (station && o.setup === station.id)) &&
      (!f.base || o.base === f.base || book.bases[o.base]?.point === f.base) &&
      (!f.kind || o.kind === f.kind) &&
      (!f.code || o.code.toUpperCase() === String(f.code).toUpperCase()) &&
      (f.deleted === undefined || o.deleted === f.deleted) &&
      timeIn(o.time, full(f.from), full(f.to)),
  );
}

const setField = (rec, k, v) => {
  if (same(rec[k], v)) return false;
  if (!(k in rec.edits)) rec.edits[k] = structuredClone(rec[k]);
  else if (same(rec.edits[k], v)) delete rec.edits[k]; // back to the original
  rec[k] = v;
  return true;
};

/**
 * Edit observations and setups. changes: target_height, prism_constant, antenna_height (measured, same method),
 * name, code, desc, deleted, n / e / z (keyed-in points); setup: instrument_height, backsight, scale, ppm;
 * base: base_antenna_height. Returns the edited record ids.
 */
export function editObservations(book, obs, changes) {
  const touched = new Set();
  for (const o of obs) {
    const ch = (k, v) => setField(o, k, v) && touched.add(o.id);
    if (changes.target_height != null) {
      if (o.kind !== 'ts') throw new Error(`${o.name} is not a total-station shot: use antenna_height for GNSS.`);
      ch('th', +changes.target_height);
    }
    if (changes.prism_constant != null && o.kind === 'ts') ch('pc', +changes.prism_constant);
    if (changes.antenna_height != null) {
      if (o.kind !== 'gnss') throw new Error(`${o.name} is not a GNSS observation: use target_height for total-station shots.`);
      ch('antenna', { ...o.antenna, measured: +changes.antenna_height, ...(changes.antenna_type ? { type: changes.antenna_type } : {}) });
    }
    for (const k of ['name', 'code', 'desc']) if (changes[k] != null) ch(k, String(changes[k]));
    if (changes.deleted != null) ch('deleted', !!changes.deleted);
    if (['n', 'e', 'z'].some((k) => changes[k] != null)) {
      if (o.kind !== 'keyed') throw new Error(`${o.name} is measured, not keyed in: edit its measurements instead.`);
      ch('file', { n: changes.n ?? o.file.n, e: changes.e ?? o.file.e, z: changes.z ?? o.file.z });
    }
    if (o.kind === 'ts' && ['instrument_height', 'backsight', 'scale', 'ppm'].some((k) => changes[k] != null)) {
      const s = book.setups[o.setup];
      if (changes.instrument_height != null && setField(s, 'ih', +changes.instrument_height)) touched.add(s.id);
      if (changes.scale != null && setField(s, 'scale', +changes.scale)) touched.add(s.id);
      if (changes.ppm != null && setField(s, 'ppm', +changes.ppm)) touched.add(s.id);
      if (changes.backsight != null && s.backsights[0] && s.backsights[0].point !== changes.backsight) {
        if (!('backsight' in s.edits)) s.edits.backsight = s.backsights[0].point;
        else if (s.edits.backsight === changes.backsight) delete s.edits.backsight;
        s.backsights[0].point = changes.backsight;
        touched.add(s.id);
      }
    }
    if (o.kind === 'gnss' && changes.base_antenna_height != null) {
      const b = book.bases[o.base];
      if (b && setField(b, 'antenna', { ...b.antenna, measured: +changes.base_antenna_height })) touched.add(b.id);
    }
  }
  return [...touched];
}

/** Every edit in the book with its original and new value. */
export function listEdits(book) {
  const out = [];
  const add = (kind, rec, label) => {
    for (const [k, was] of Object.entries(rec.edits || {})) {
      const now = k === 'backsight' ? rec.backsights[0]?.point : rec[k];
      const v = (x) => (k === 'antenna' ? x?.measured : k === 'file' ? `${x?.n?.toFixed(3)}, ${x?.e?.toFixed(3)}, ${x?.z?.toFixed(3)}` : x);
      out.push({ kind, id: rec.id, label, field: k === 'th' ? 'target_height' : k === 'pc' ? 'prism_constant' : k === 'ih' ? 'instrument_height' : k === 'antenna' ? 'antenna_height' : k, was: v(was), now: v(now) });
    }
  };
  for (const s of Object.values(book.setups)) add('setup', s, `Station ${s.station}`);
  for (const b of Object.values(book.bases)) add('base', b, `Base ${b.point}`);
  for (const o of book.observations) add('observation', o, `${o.name} ${hhmm(o.time)}`);
  return out;
}

/** A compact table of setups and their observations for people and AIs. */
export function summary(book, f = {}) {
  const rows = selectObservations(book, f);
  const setupsUsed = new Set(rows.map((o) => o.setup || o.base).filter(Boolean));
  const setups = [...Object.values(book.setups), ...Object.values(book.bases)]
    .filter((s) => setupsUsed.has(s.id))
    .map((s) => (s.kind === 'station' ? { id: s.id, kind: 'station', station: s.station, instrument_height: s.ih, backsight: s.backsights[0]?.point || null, scale: s.scale, ppm: s.ppm, time: s.time, edited: Object.keys(s.edits) } : { id: s.id, kind: 'base', point: s.point, antenna_height: s.antenna?.measured, antenna_type: s.antenna?.type, time: s.time, edited: Object.keys(s.edits) }));
  const obs = rows.map((o) => ({
    id: o.id,
    name: o.name,
    code: o.code,
    kind: o.kind,
    method: o.method,
    time: hhmm(o.time),
    setup: o.setup || o.base || null,
    ...(o.kind === 'ts' ? { target_height: o.th, prism_constant: o.pc, ha: o.circle.ha, va: o.circle.va, sd: o.circle.sd } : {}),
    ...(o.kind === 'gnss' ? { antenna_height: o.antenna?.measured, antenna_type: o.antenna?.type, precision: o.precision, satellites: o.qc?.satellites, pdop: o.qc?.pdop } : {}),
    ...(o.cls !== 'Normal' ? { classification: o.cls } : {}),
    ...(o.deleted ? { deleted: true } : {}),
    ...(Object.keys(o.edits).length ? { edited: Object.keys(o.edits) } : {}),
  }));
  return { job: book.job, standard: book.standard, setups, observations: obs, notes: book.notes.length, media: book.media.length, edits: listEdits(book).length };
}

// ---------------------------------------------------------------- quality checks (#269)

/**
 * Field checks a party chief would make. Each finding: { check, severity, message, ids, fix? } where fix is the
 * arguments of edit_survey_observations that would repair it.
 */
export function reviewBook(book, { residual = 0.01, precision = 0.05, pdop = 6, satellites = 6, duplicate = 0.05 } = {}) {
  const out = [];
  const live = book.observations.filter((o) => !o.deleted);
  // backsight orientation residuals (OrientationCorrection: angle in degrees → offset at the backsight distance)
  for (const s of Object.values(book.setups)) {
    for (const b of s.backsights) {
      const st = book.results[s.station];
      const bp = book.results[b.point];
      if (!st || !bp || b.oc == null) continue;
      const off = Math.abs(b.oc * DEG) * Math.hypot(bp.n - st.n, bp.e - st.e);
      if (off > residual) out.push({ check: 'backsight', severity: 'warning', message: `Station ${s.station}: the backsight to ${b.point} is ${(off * 1000).toFixed(0)} mm off (${(b.oc * 3600).toFixed(0)}").`, ids: [s.id] });
    }
  }
  // target height changes inside a setup: a run that differs from the heights before and after is a likely bust
  for (const s of Object.values(book.setups)) {
    // reflectorless (DR) shots have no rod: they neither break a run of target heights nor share its prism constant
    const shots = live.filter((o) => o.kind === 'ts' && o.setup === s.id && !/backsight/i.test(o.cls) && !/^DR/i.test(o.prism || ''));
    const runs = [];
    for (const o of shots) (runs.at(-1)?.th === o.th ? runs.at(-1).obs.push(o) : runs.push({ th: o.th, obs: [o] }));
    for (let i = 1; i < runs.length - 1; i++) {
      if (runs[i - 1].th === runs[i + 1].th && runs[i].obs.length < Math.max(runs[i - 1].obs.length, runs[i + 1].obs.length)) {
        const r = runs[i];
        out.push({ check: 'target_height', severity: 'warning', message: `Station ${s.station}: ${r.obs.length} shot(s) (${r.obs[0].name}…${r.obs.at(-1).name}, ${hhmm(r.obs[0].time)}–${hhmm(r.obs.at(-1).time)}) used a ${r.th.toFixed(3)} m target between shots at ${runs[i - 1].th.toFixed(3)} m: a rod height left unchanged?`, ids: r.obs.map((o) => o.id), fix: { ids: r.obs.map((o) => o.id), target_height: runs[i - 1].th } });
      }
    }
    const pcs = new Map();
    for (const o of shots) pcs.set(o.pc, [...(pcs.get(o.pc) || []), o]);
    if (pcs.size > 1) {
      const [main] = [...pcs.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      for (const [pc, list] of pcs) if (pc !== main) out.push({ check: 'prism_constant', severity: 'info', message: `Station ${s.station}: ${list.length} shot(s) with a ${(pc * 1000).toFixed(1)} mm prism constant, the rest at ${(main * 1000).toFixed(1)} mm.`, ids: list.map((o) => o.id), fix: { ids: list.map((o) => o.id), prism_constant: main } });
    }
  }
  // GNSS antenna heights: the same idea per base and session
  const gnss = live.filter((o) => o.kind === 'gnss' && o.antenna);
  const runs = [];
  for (const o of gnss) (runs.at(-1)?.h === o.antenna.measured && runs.at(-1).base === o.base ? runs.at(-1).obs.push(o) : runs.push({ h: o.antenna.measured, base: o.base, obs: [o] }));
  for (let i = 1; i < runs.length - 1; i++) {
    if (runs[i - 1].h === runs[i + 1].h && runs[i - 1].base === runs[i].base && runs[i].obs.length < Math.max(runs[i - 1].obs.length, runs[i + 1].obs.length)) {
      const r = runs[i];
      out.push({ check: 'antenna_height', severity: 'warning', message: `${r.obs.length} GNSS point(s) (${r.obs[0].name}…${r.obs.at(-1).name}) with a ${r.h} m antenna height between points at ${runs[i - 1].h} m.`, ids: r.obs.map((o) => o.id), fix: { ids: r.obs.map((o) => o.id), antenna_height: runs[i - 1].h } });
    }
  }
  for (const o of gnss) {
    const bad = [];
    if (o.precision && (o.precision.h > precision || o.precision.v > precision * 1.5)) bad.push(`precision ${o.precision.h?.toFixed(3)} / ${o.precision.v?.toFixed(3)} m`);
    if (o.qc?.pdop > pdop) bad.push(`PDOP ${o.qc.pdop.toFixed(1)}`);
    if (o.qc?.satellites != null && o.qc.satellites < satellites) bad.push(`${o.qc.satellites} satellites`);
    if (bad.length) out.push({ check: 'gnss_quality', severity: 'warning', message: `${o.name}: ${bad.join(', ')}.`, ids: [o.id] });
  }
  // the same name at different places
  const byName = new Map();
  for (const o of live) if (o.file && !/backsight|check/i.test(o.cls)) byName.set(o.name, [...(byName.get(o.name) || []), o]);
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const far = list.filter((o) => Math.hypot(o.file.n - list[0].file.n, o.file.e - list[0].file.e, o.file.z - list[0].file.z) > duplicate);
    if (far.length) out.push({ check: 'duplicate', severity: 'warning', message: `Point ${name} was stored ${list.length} times up to ${Math.max(...far.map((o) => Math.hypot(o.file.n - list[0].file.n, o.file.e - list[0].file.e))).toFixed(3)} m apart.`, ids: list.map((o) => o.id) });
  }
  // check shots against the stored point
  for (const o of live.filter((x) => /check/i.test(x.cls) && x.file)) {
    const r = book.results[o.name];
    if (!r) continue;
    const dh = Math.hypot(o.file.n - r.n, o.file.e - r.e);
    const dz = o.file.z - r.z;
    if (dh > residual * 2 || Math.abs(dz) > residual * 2) out.push({ check: 'check_shot', severity: 'warning', message: `Check on ${o.name}: ${(dh * 1000).toFixed(0)} mm in plan, ${(dz * 1000).toFixed(0)} mm in height.`, ids: [o.id] });
  }
  return out;
}

// ---------------------------------------------------------------- the model

/** Bring a recompute into the model: move, hide, restore or add the survey's points. Returns what changed. */
export function applyToDoc(doc, e, S, D) {
  const book = e.survey;
  book.points ||= {};
  const byName = new Map(S.points(doc).map((p) => [p.name, p]));
  const pointOf = (name) => doc.entities.find((x) => x.id === book.points[name] && S.isPoint(x)) || null;
  const pointNow = (name) => {
    const p = byName.get(name);
    return p ? { n: p.point.n, e: p.point.e, z: p.point.z } : null;
  };
  const r = recompute(book, pointNow);
  const added = [];
  for (const [name, c] of r.coords) {
    const o = decidingObservation(book, name);
    let p = pointOf(name);
    if (!p) {
      p = S.addPoint(doc, { name: byName.has(name) ? `${name}-1` : name, n: c.n, e: c.e, z: c.z, code: o?.code || '', desc: o?.desc || '', attrs: o?.attrs || {} });
      book.points[name] = p.id;
      added.push(name);
    }
    Object.assign(p.point, { n: c.n, e: c.e, z: c.z, code: o?.code ?? p.point.code, desc: o?.desc ?? p.point.desc, obs: o?.id, survey: e.id });
    delete p.point.deleted;
    p.visible = true;
    p.position = D.round3(S.toLocal(doc, p.point));
    p.material.color = S.codeColor(doc, p.point.code);
  }
  for (const name of new Set(book.observations.map((o) => o.name))) {
    if (r.coords.has(name)) continue;
    const p = pointOf(name);
    if (p && !p.point.deleted) {
      p.point.deleted = true; // hidden, not removed: restoring the observation brings it back with its links
      p.visible = false;
    }
  }
  return { moved: r.moved, removed: r.removed, added };
}

// ---------------------------------------------------------------- export (#263)

const f4 = (x) => (x == null ? undefined : Math.round(x * 1e6) / 1e6);
const purpose = (o) => (/backsight/i.test(o.cls) ? 'backsight' : /check/i.test(o.cls) ? 'check' : 'normal');

/** The field book as a LandXML 1.2 <Survey>, with the corrected values (what an edit changed is what is written). */
export function toLandXmlSurvey(book, Xm, name = 'Survey') {
  const targets = new Map();
  const tgt = (o) => {
    const k = `${o.th}|${o.pc}`;
    if (!targets.has(k)) targets.set(k, { id: `t${targets.size + 1}`, th: o.th, pc: o.pc, prism: o.prism });
    return targets.get(k).id;
  };
  const setups = Object.values(book.setups).map((s) =>
    Xm.el('InstrumentSetup', { id: s.id, stationName: s.station, instrumentHeight: f4(s.ih), ...(s.scale !== 1 ? { scaleFactor: f4(s.scale) } : {}) }, [
      Xm.el('InstrumentPoint', { pntRef: s.station }),
      ...s.backsights.map((b) => Xm.el('Backsight', { circle: f4(b.hc1) }, [Xm.el('BacksightPoint', { pntRef: b.point })])),
    ]),
  );
  const groups = Object.values(book.setups).map((s) =>
    Xm.el(
      'ObservationGroup',
      { id: `og-${s.id}`, setupID: s.id },
      book.observations
        .filter((o) => o.kind === 'ts' && o.setup === s.id && !o.deleted)
        .map((o) =>
          Xm.el('RawObservation', { setupID: s.id, targetSetupID: tgt(o), targetHeight: f4(o.th), horizAngle: f4(o.circle.ha), zenithAngle: f4(o.circle.va), slopeDistance: f4(o.circle.sd + (o.pc - orig(o, 'pc'))), purpose: purpose(o), timeStamp: o.time || undefined }, [Xm.el('TargetPoint', { pntRef: o.name })]),
        ),
    ),
  );
  const gps = [];
  const vectors = [];
  for (const b of Object.values(book.bases)) gps.push(Xm.el('GPSSetup', { id: b.id, stationName: b.point, antennaHeight: f4(antennaHeight(b.antenna)) }, [Xm.el('TargetPoint', { pntRef: b.point })]));
  for (const o of book.observations.filter((x) => x.kind === 'gnss' && !x.deleted)) {
    gps.push(Xm.el('GPSSetup', { id: `g-${o.id}`, stationName: o.name, antennaHeight: f4(antennaHeight(o.antenna)) }, [Xm.el('TargetPoint', { pntRef: o.name })]));
    vectors.push(Xm.el('GPSVector', { setupID_A: o.base, setupID_B: `g-${o.id}`, dX: f4(o.vector.dx), dY: f4(o.vector.dy), dZ: f4(o.vector.dz), startTime: o.time || undefined }));
  }
  return Xm.el('Survey', {}, [
    Xm.el('SurveyHeader', { name, startTime: book.observations.find((o) => o.time)?.time, desc: `${book.job.product} ${book.job.version}`.trim() || undefined }),
    Xm.el('Equipment', {}, Object.entries(book.instruments).map(([id, i]) => Xm.el('InstrumentDetails', { id, manufacturer: 'Trimble', model: i.type, serialNumber: i.serial || undefined }))),
    ...[...targets.values()].map((t) => Xm.el('TargetSetup', { id: t.id, targetHeight: f4(t.th), prismConstant: f4(t.pc), ...(t.prism ? { prismType: t.prism } : {}) })),
    ...setups,
    ...gps,
    ...groups,
    ...(vectors.length ? [Xm.el('ObservationGroup', { id: 'og-gnss' }, vectors)] : []),
  ]);
}

/** A field book back from a LandXML <Survey> element and its CgPoints (results: Map name → { n, e, z, code }). */
export function fromLandXmlSurvey(el, results) {
  const at = (e, k) => (e.attrs[k] === undefined || e.attrs[k] === '' ? null : +e.attrs[k]);
  const book = { standard: STANDARD, job: { name: X.kid(el, 'SurveyHeader')?.attrs.name || 'Survey', product: 'LandXML', version: '1.2', crs: null, projection: null, units: 'm' }, instruments: {}, setups: {}, bases: {}, observations: [], results: {}, notes: [], media: [], report: { records: {}, kept: [], recompute: 0 } };
  const targets = new Map(X.kids(el, 'TargetSetup').map((t) => [t.attrs.id, t]));
  for (const s of X.kids(el, 'InstrumentSetup'))
    book.setups[s.attrs.id] = { id: s.attrs.id, kind: 'station', type: '', station: s.attrs.stationName || X.kid(s, 'InstrumentPoint')?.attrs.pntRef, ih: at(s, 'instrumentHeight') ?? 0, raw: null, instrument: null, scale: at(s, 'scaleFactor') ?? 1, ppm: 0, refraction: 0.142, backsights: X.kids(s, 'Backsight').map((b) => ({ point: X.kid(b, 'BacksightPoint')?.attrs.pntRef, hc1: at(b, 'circle'), oc: 0 })), time: '', edits: {} };
  const gps = new Map(X.kids(el, 'GPSSetup').map((g) => [g.attrs.id, g]));
  const ant = (g) => ({ measured: at(g, 'antennaHeight') ?? 0, type: 'Corrected' });
  const id = () => `lx${book.observations.length + 1}`;
  for (const og of X.kids(el, 'ObservationGroup')) {
    for (const r of X.kids(og, 'RawObservation')) {
      const t = targets.get(r.attrs.targetSetupID);
      book.observations.push({ id: id(), name: X.kid(r, 'TargetPoint')?.attrs.pntRef, code: '', desc: '', method: 'DirectReading', survey_method: '', cls: r.attrs.purpose === 'backsight' ? 'BackSight' : r.attrs.purpose === 'check' ? 'Check' : 'Normal', deleted: false, time: r.attrs.timeStamp || '', file: null, edits: {}, kind: 'ts', setup: r.attrs.setupID || og.attrs.setupID, circle: { ha: at(r, 'horizAngle'), va: at(r, 'zenithAngle'), sd: at(r, 'slopeDistance'), face: 'Face1' }, th: at(r, 'targetHeight') ?? (t ? at(t, 'targetHeight') : 0) ?? 0, pc: t ? at(t, 'prismConstant') ?? 0 : 0, prism: t?.attrs.prismType || '' });
    }
    for (const v of X.kids(og, 'GPSVector')) {
      const b = gps.get(v.attrs.setupID_A);
      const r = gps.get(v.attrs.setupID_B);
      if (b && !book.bases[b.attrs.id]) book.bases[b.attrs.id] = { id: b.attrs.id, kind: 'base', point: b.attrs.stationName || X.kid(b, 'TargetPoint')?.attrs.pntRef, antenna: ant(b), time: '', edits: {} };
      if (r) book.observations.push({ id: id(), name: r.attrs.stationName || X.kid(r, 'TargetPoint')?.attrs.pntRef, code: '', desc: '', method: 'GpsRTK', survey_method: '', cls: 'Normal', deleted: false, time: v.attrs.startTime || '', file: null, edits: {}, kind: 'gnss', base: v.attrs.setupID_A, vector: { dx: at(v, 'dX'), dy: at(v, 'dY'), dz: at(v, 'dZ') }, antenna: ant(r) });
    }
  }
  for (const o of book.observations) o.code = results.get(o.name)?.code || '';
  // stations, backsights and bases with no shot of their own are control, keyed in from the CgPoints
  const control = new Set([...Object.values(book.setups).flatMap((s) => [s.station, ...s.backsights.map((b) => b.point)]), ...Object.values(book.bases).map((b) => b.point)]);
  for (const name of control)
    if (results.has(name) && !book.observations.some((o) => o.name === name && !/backsight|check/i.test(o.cls))) {
      const r = results.get(name);
      book.observations.unshift({ id: `lxk-${name}`, name, code: r.code || '', desc: '', method: 'Coordinates', survey_method: 'KeyedIn', cls: 'Normal', deleted: false, time: '', file: { n: r.n, e: r.e, z: r.z }, edits: {}, kind: 'keyed' });
    }
  for (const name of new Set(book.observations.map((o) => o.name))) {
    const o = decidingObservation(book, name);
    const r = results.get(name);
    if (o && r) {
      book.results[name] = { obs: o.id, n: r.n, e: r.e, z: r.z };
      o.file ||= { n: r.n, e: r.e, z: r.z };
    }
  }
  book.report.recompute = book.observations.filter((o) => o.kind === 'ts' || o.kind === 'gnss').length;
  return book;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The field book in OGC InfraGML 1.0 Part 6 Survey (16-106r2) element names, GML 3.2. */
export function toInfraGml(book, { name = 'Survey', crs = null } = {}) {
  const srs = crs?.epsg ? ` srsName="urn:ogc:def:crs:EPSG::${crs.epsg}"` : '';
  const id = (s) => String(s).replace(/[^\w.-]/g, '_');
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- ${STANDARD}: element names from the OGC schemas (schemas.opengis.net/infragml/part6/1.0); not validated against the XSD -->`,
    `<li:LandInfraDataset gml:id="ds-${id(name)}" xmlns:li="http://www.opengis.net/infragml/core/1.0" xmlns:lis="http://www.opengis.net/infragml/survey/1.0" xmlns:lise="http://www.opengis.net/infragml/equipment/1.0" xmlns:liso="http://www.opengis.net/infragml/observations/1.0" xmlns:lisr="http://www.opengis.net/infragml/surveyresults/1.0" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:xlink="http://www.w3.org/1999/xlink">`,
    ` <lis:Survey gml:id="survey-${id(name)}">`,
    `  <lis:ID><li:identifier>${esc(name)}</li:identifier></lis:ID>`,
    `  <lis:purposeOfSurvey>${esc(`${book.job.product} ${book.job.version}`.trim() || 'Field survey')}</lis:purposeOfSurvey>`,
  ];
  for (const [k, i] of Object.entries(book.instruments)) out.push(`  <lis:equipment><lise:Equipment gml:id="eq-${id(k)}"><gml:name>${esc(i.type)}</gml:name><lise:serialID>${esc(i.serial)}</lise:serialID><lise:controlSoftware>${esc(book.job.product)}</lise:controlSoftware><lise:softwareVersion>${esc(book.job.version)}</lise:softwareVersion></lise:Equipment></lis:equipment>`);
  for (const s of [...Object.values(book.setups), ...Object.values(book.bases)]) {
    const st = s.kind === 'station' ? s.station : s.point;
    const r = book.results[st];
    const what = s.kind === 'station' ? `instrument height ${f4(s.ih)} m; backsight ${esc(s.backsights[0]?.point || '')}` : `GNSS base; antenna height ${f4(antennaHeight(s.antenna))} m`;
    out.push(`  <lis:setup><liso:InstrumentPoint gml:id="ip-${id(s.id)}"><gml:description>${what}</gml:description><gml:name>${esc(st)}</gml:name>${r ? `<gml:location><gml:Point gml:id="ipp-${id(s.id)}"${srs}><gml:pos>${f4(r.n)} ${f4(r.e)} ${f4(r.z)}</gml:pos></gml:Point></gml:location>` : ''}</liso:InstrumentPoint></lis:setup>`);
  }
  for (const o of book.observations.filter((x) => !x.deleted && (x.kind === 'ts' || x.kind === 'gnss'))) {
    const head = `<gml:using xlink:href="#ip-${id(o.setup || o.base)}"/><gml:target xlink:href="#tp-${id(o.name)}"/>${o.time ? `<liso:resultTime><gml:TimeInstant gml:id="t-${id(o.id)}"><gml:timePosition>${esc(o.time)}</gml:timePosition></gml:TimeInstant></liso:resultTime>` : ''}`;
    if (o.kind === 'ts') {
      out.push(`  <lis:sampling><liso:AngularObservation gml:id="ha-${id(o.id)}">${head}<gml:resultOf/><liso:angle uom="deg">${f4(o.circle.ha)}</liso:angle><liso:angularType xlink:href="horizontal"/></liso:AngularObservation></lis:sampling>`);
      out.push(`  <lis:sampling><liso:AngularObservation gml:id="va-${id(o.id)}">${head}<gml:resultOf/><liso:angle uom="deg">${f4(o.circle.va)}</liso:angle><liso:angularType xlink:href="zenith"/></liso:AngularObservation></lis:sampling>`);
      out.push(`  <lis:sampling><liso:DistanceObservation gml:id="sd-${id(o.id)}">${head}<gml:resultOf/><liso:distance uom="m">${f4(o.circle.sd + (o.pc - orig(o, 'pc')))}</liso:distance><liso:distanceType xlink:href="slope"/></liso:DistanceObservation></lis:sampling><!-- ${esc(o.name)}: target height ${f4(o.th)} m, prism constant ${f4(o.pc)} m -->`);
    } else out.push(`  <lis:sampling><liso:GnssObservation gml:id="gn-${id(o.id)}">${head}<gml:resultOf>${f4(o.vector.dx)} ${f4(o.vector.dy)} ${f4(o.vector.dz)}</gml:resultOf><liso:antennaHeight uom="m">${f4(antennaHeight(o.antenna))}</liso:antennaHeight>${o.qc?.pdop != null ? `<liso:quality><liso:GnssQuality gml:id="q-${id(o.id)}"><liso:pDOP>${o.qc.pdop}</liso:pDOP></liso:GnssQuality></liso:quality>` : ''}</liso:GnssObservation></lis:sampling>`);
  }
  for (const [n, r] of Object.entries(book.results)) out.push(`  <lis:surveyResult><lisr:TargetPoint gml:id="tp-${id(n)}"><gml:name>${esc(n)}</gml:name><lisr:geometry><gml:Point gml:id="tpp-${id(n)}"${srs}><gml:pos>${f4(r.n)} ${f4(r.e)} ${f4(r.z)}</gml:pos></gml:Point></lisr:geometry><lisr:isComplete>true</lisr:isComplete></lisr:TargetPoint></lis:surveyResult>`);
  out.push(' </lis:Survey>', '</li:LandInfraDataset>', '');
  return out.join('\n');
}

/** A survey report as an HTML page: setups, bases, the edits (old and new), the points that moved, the checks. */
export function surveyReport(book, { name = 'Survey', moved = [], findings = [] } = {}) {
  const table = (rows, head) => `<table><thead><tr>${head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const mm = (x) => (x * 1000).toFixed(1);
  const edits = listEdits(book);
  const crs = book.job.crs?.system ? ` · ${book.job.crs.system}${book.job.crs.zone ? ` / ${book.job.crs.zone}` : ''}` : '';
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name)}: survey report</title>`,
    '<style>body{font:14px/1.5 system-ui,sans-serif;margin:2em;color:#1d2a33}table{border-collapse:collapse;margin:.5em 0 1.5em}th,td{border:1px solid #c8d0d6;padding:3px 8px;text-align:right}th:first-child,td:first-child{text-align:left}h1{font-size:20px}h2{font-size:16px;margin-top:1.5em}</style></head><body>',
    `<h1>${esc(name)}: survey report</h1>`,
    `<p>${esc(`${book.job.product} ${book.job.version}`.trim())}${esc(crs)} · ${book.observations.length} observations · ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC, MyModellerReel</p>`,
    '<h2>Station setups</h2>',
    table(Object.values(book.setups).map((s) => [s.station, s.ih.toFixed(3), s.backsights.map((b) => b.point).join(', '), s.backsights.map((b) => ((b.oc || 0) * 3600).toFixed(1)).join(', '), s.scale, (s.time || '').slice(0, 16).replace('T', ' ')]), ['Station', 'Instrument height (m)', 'Backsights', 'Orientation correction (")', 'Scale', 'Time']),
    Object.keys(book.bases).length ? `<h2>GNSS bases</h2>${table(Object.values(book.bases).map((b) => [b.point, antennaHeight(b.antenna).toFixed(3), b.antenna?.method || '']), ['Base', 'Antenna height to phase centre (m)', 'Measured to'])}` : '',
    '<h2>Edits</h2>',
    edits.length ? table(edits.map((e) => [e.label, e.field.replace(/_/g, ' '), e.was, e.now]), ['Record', 'Field', 'Was', 'Now']) : '<p>None: the points are where the field software put them.</p>',
    '<h2>Points moved by the edits</h2>',
    moved.length ? table(moved.map((m) => [m.name, mm(m.dn), mm(m.de), mm(m.dz)]), ['Point', 'dN (mm)', 'dE (mm)', 'dZ (mm)']) : '<p>None.</p>',
    '<h2>Checks</h2>',
    findings.length ? `<ul>${findings.map((f) => `<li>${esc(f.message)}</li>`).join('')}</ul>` : '<p>Nothing suspicious.</p>',
    '</body></html>',
    '',
  ].join('\n');
}
