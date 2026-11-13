// Animation depth (#73, #76–#78, #85, #88): custom easing curves, reusable clips, constraints (attach, follow,
// look at), camera shots, 4D schedules (CSV, MS Project XML, Primavera XER) and key editing (retime, copy).
// Pure: animation.js calls the evaluation parts, commands.js the editing parts.
import { Matrix4, Vector3, Quaternion, Euler } from 'three';

// ---------------------------------------------------------------- easing curves (#77)

/** A CSS-style cubic-bezier(x1, y1, x2, y2) easing: u (time 0–1) → progress. */
export function cubicBezier([x1, y1, x2, y2]) {
  const bx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      bx(m) < u ? (lo = m) : (hi = m);
    }
    return by((lo + hi) / 2);
  };
}

// ---------------------------------------------------------------- clips (#88)

const D2R = Math.PI / 180;
const RELATIVE = new Set(['position', 'rotation', 'scale']);

/**
 * A clip from what targets do between from and to: per target and property, keys starting at 0. Transforms are kept
 * as changes from where the target was at `from` (so the clip works on another door elsewhere); scale as a factor.
 */
export function makeClip(doc, { name, targets, from, to, base }) {
  const tracks = [];
  targets.forEach((target, role) => {
    for (const tr of doc.animation.tracks) {
      if (tr.target !== target) continue;
      const keys = tr.keys.filter((k) => k.t >= from - 1e-6 && k.t <= to + 1e-6);
      if (!keys.length) continue;
      const b = base(target, tr.property);
      const rel = RELATIVE.has(tr.property) && Array.isArray(b);
      tracks.push({ role, property: tr.property, relative: rel, keys: keys.map((k) => ({ t: round(k.t - from), v: rel ? k.v.map((x, i) => round(tr.property === 'scale' ? x / (b[i] || 1) : x - b[i])) : structuredClone(k.v), ease: k.ease, ...(k.bezier ? { bezier: k.bezier } : {}) })) });
    }
  });
  if (!tracks.length) throw new Error('Nothing is animated there to make a clip of.');
  return { name, duration: round(to - from), roles: targets.length, tracks };
}

/** Keys of a clip played on targets from start (time scaled by speed): [{ target, property, t, v, ease, bezier }]. */
export function clipKeys(clip, targets, start, { base, speed = 1 }) {
  const out = [];
  for (const tr of clip.tracks) {
    const target = targets[tr.role % targets.length];
    const b = base(target, tr.property);
    for (const k of tr.keys) out.push({ target, property: tr.property, t: round(start + k.t / speed), v: tr.relative ? k.v.map((x, i) => round(tr.property === 'scale' ? x * (b[i] ?? 1) : x + (b[i] ?? 0))) : structuredClone(k.v), ease: k.ease, bezier: k.bezier });
  }
  return out;
}
const round = (x) => Math.round(x * 10000) / 10000;

// ---------------------------------------------------------------- constraints (#78)

const mat = (p, r, s = [1, 1, 1]) => new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R)), new Vector3(...s));
const decompose = (m) => {
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  m.decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q);
  return { position: p.toArray().map(round), rotation: [e.x, e.y, e.z].map((x) => round(x / D2R)), scale: s.toArray().map(round) };
};

/**
 * Constraints on top of keys and motions, in order: attach (child moves with parent from start to end, keeping the
 * offset it had at start), follow (position only), look_at (turns to face an entity or a point; yaw only by
 * default). pose(id) gives { position, rotation, scale } at the current time (animated or not).
 */
export function applyConstraints(doc, t, out, pose) {
  for (const c of doc.animation.constraints || []) {
    if (t < (c.start ?? 0) || (c.end !== undefined && c.end !== null && t > c.end)) {
      // after a detach the child stays where it was let go (unless keys move it later)
      if (c.type !== 'look_at' && c.end !== undefined && c.end !== null && t > c.end && c.hold !== false && !hasKeysAfter(doc, c.target, c.end)) {
        const at = constraintPose(doc, c, c.end, pose, true);
        if (at) Object.assign((out[c.target] ||= {}), c.type === 'follow' ? { position: at.position } : at);
      }
      continue;
    }
    const at = constraintPose(doc, c, t, pose, false);
    if (at) Object.assign((out[c.target] ||= {}), at);
  }
}
const hasKeysAfter = (doc, target, t) => doc.animation.tracks.some((tr) => tr.target === target && ['position', 'rotation'].includes(tr.property) && tr.keys.some((k) => k.t > t + 1e-6));

function constraintPose(doc, c, t, pose, frozen) {
  if (c.type === 'look_at') {
    const me = pose(c.target, t);
    const at = Array.isArray(c.at) ? c.at : pose(c.at, t)?.position;
    if (!me || !at) return null;
    const d = new Vector3(...at).sub(new Vector3(...me.position));
    const yaw = Math.atan2(d.x, d.z) / D2R + (c.yaw_offset || 0);
    if (!c.pitch) return { rotation: [me.rotation[0], round(yaw), me.rotation[2]] };
    const pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z)) / D2R;
    return { rotation: [round(pitch), round(yaw), 0] };
  }
  const p0 = pose(c.parent, c.start ?? 0);
  const p = pose(c.parent, t);
  const k0 = c.offset_pose || pose(c.target, c.start ?? 0);
  if (!p0 || !p || !k0) return null;
  if (c.type === 'follow') return { position: k0.position.map((x, i) => round(x + p.position[i] - p0.position[i])) };
  // attach: child world = parent(t) · parent(start)⁻¹ · child(start)
  const m = mat(p.position, p.rotation, p.scale).multiply(mat(p0.position, p0.rotation, p0.scale).invert()).multiply(mat(k0.position, k0.rotation, k0.scale));
  void frozen;
  return decompose(m);
}

// ---------------------------------------------------------------- shots (#85)

/** The camera of the shot at time t: { name, camera } (moving from camera to camera_end over the shot), or null. */
export function shotAt(doc, t) {
  const shots = doc.animation.shots || [];
  const s = shots.find((x) => t >= x.start - 1e-9 && t < x.end) || (t >= (shots.at(-1)?.end ?? Infinity) - 1e-9 ? null : null);
  if (!s) return null;
  if (!s.camera_end) return { name: s.name, camera: s.camera };
  const u = (t - s.start) / Math.max(1e-6, s.end - s.start);
  const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
  const mix = (a, b) => a.map((x, i) => round(x + (b[i] - x) * e));
  return { name: s.name, camera: { position: mix(s.camera.position, s.camera_end.position), target: mix(s.camera.target, s.camera_end.target), fov: round(s.camera.fov + ((s.camera_end.fov ?? s.camera.fov) - s.camera.fov) * e) } };
}

// ---------------------------------------------------------------- 4D schedules (#76)

const DAY = 86400000;
/** Dates as written in schedules: 2027-03-01, 2027-03-01T08:00:00, 01/03/2027 (day first), 3/1/2027 with us: true. */
export function parseDate(s, { us = false } = {}) {
  s = String(s ?? '').trim().replace(/^"|"$/g, '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [d, mo] = us ? [+m[2], +m[1]] : [+m[1], +m[2]];
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return Date.UTC(y, mo - 1, d, +(m[4] || 0), +(m[5] || 0));
  }
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{2,4})/); // 01-Mar-27 (P6)
  if (m) {
    const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
    if (mo >= 0) return Date.UTC(+m[3] < 100 ? 2000 + +m[3] : +m[3], mo, +m[1]);
  }
  return NaN;
}

const splitCsv = (line, sep) => {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) out.push(cur.trim()), (cur = '');
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

/**
 * Tasks from a schedule file: [{ id, name, start, finish (ms UTC), element, wbs }]. CSV / TSV with a header (Name or
 * Task, Start, Finish or End, optional ID, Element / Tag / Code), MS Project XML (MSPDI) or Primavera P6 XER.
 */
export function parseSchedule(text, { us = false } = {}) {
  const src = String(text).replace(/^﻿/, '');
  let tasks = [];
  if (/<Project[\s>]/.test(src) && /<Tasks>/.test(src)) {
    for (const [, body] of src.matchAll(/<Task>([\s\S]*?)<\/Task>/g)) {
      const get = (k) => body.match(new RegExp(`<${k}>([^<]*)</${k}>`))?.[1];
      if (get('Summary') === '1' || !get('Name')) continue;
      tasks.push({ id: get('UID') || get('ID'), name: get('Name'), start: parseDate(get('Start')), finish: parseDate(get('Finish')), wbs: get('WBS') || '' });
    }
  } else if (/^ERMHDR/m.test(src) || /^%T\s+TASK/m.test(src)) {
    let fields = null;
    let inTask = false;
    for (const line of src.split(/\r?\n/)) {
      const cells = line.split('\t');
      if (cells[0] === '%T') (inTask = cells[1] === 'TASK'), (fields = null);
      else if (cells[0] === '%F' && inTask) fields = cells.slice(1);
      else if (cells[0] === '%R' && inTask && fields) {
        const r = Object.fromEntries(fields.map((f, i) => [f, cells[i + 1]]));
        const start = r.target_start_date || r.early_start_date || r.act_start_date;
        const end = r.target_end_date || r.early_end_date || r.act_end_date;
        tasks.push({ id: r.task_code || r.task_id, name: r.task_name, start: parseDate(start), finish: parseDate(end), wbs: r.wbs_id || '' });
      }
    }
  } else {
    const lines = src.split(/\r?\n/).filter((l) => l.trim());
    const sep = [',', ';', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
    const head = splitCsv(lines[0], sep).map((h) => h.toLowerCase());
    const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const [ci, cn, cs, cf, ce] = [col('id', 'task id', 'code'), col('name', 'task', 'activity', 'description'), col('start', 'begin'), col('finish', 'end', 'due'), col('element', 'tag', 'layer', 'object', 'elements')];
    if (cn < 0 || cs < 0 || cf < 0) throw new Error('A schedule CSV needs Name (or Task), Start and Finish (or End) columns.');
    for (const l of lines.slice(1)) {
      const c = splitCsv(l, sep);
      tasks.push({ id: ci >= 0 ? c[ci] : String(tasks.length + 1), name: c[cn], start: parseDate(c[cs], { us }), finish: parseDate(c[cf], { us }), element: ce >= 0 ? c[ce] : '' });
    }
  }
  return scheduleTasks(tasks);
}

/** Tasks given directly ({ name, start, finish as dates or ms, element }), checked and sorted like a parsed schedule. */
export function scheduleTasks(list, { us = false } = {}) {
  const ms = (d) => (typeof d === 'number' ? d : parseDate(String(d ?? ''), { us }));
  const tasks = list.map((x, i) => ({ ...x, id: String(x.id ?? i + 1), name: x.name, start: ms(x.start), finish: ms(x.finish), element: x.element || '' })).filter((x) => x.name && Number.isFinite(x.start) && Number.isFinite(x.finish));
  if (!tasks.length) throw new Error('No tasks with a name, a start and a finish date.');
  for (const x of tasks) if (x.finish < x.start) [x.start, x.finish] = [x.finish, x.start];
  return tasks.sort((a, b) => a.start - b.start);
}

/** Seconds on the timeline for a date: the first start is 0, one day lasts secondsPerDay. */
export const scheduleTime = (ms, t0, secondsPerDay) => round(((ms - t0) / DAY) * secondsPerDay);

/**
 * Which entities a task builds: by the task's element column (a tag, a name, or several separated by |), or by
 * matching the task name against tags, names or a metadata field.
 */
export function matchTask(doc, task, { by = 'auto', field = null } = {}) {
  const top = doc.entities.filter((e) => !e.parent && e.type !== 'light' && !e.annotation);
  const keys = (task.element || '').split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const name = task.name.toLowerCase();
  const hit = (e) => {
    if (field) return [task.id, task.name].map((x) => String(x).toLowerCase()).includes(String(e.meta?.[field] ?? '').toLowerCase());
    if (keys.length) return keys.some((k) => e.tag?.toLowerCase() === k || e.name.toLowerCase() === k || e.name.toLowerCase().startsWith(`${k} `));
    if (by === 'tag' || by === 'auto') if (e.tag && e.tag !== 'Untagged' && name.includes(e.tag.toLowerCase())) return true;
    if (by === 'name' || by === 'auto') return name.includes(e.name.toLowerCase()) || e.name.toLowerCase().includes(name);
    return false;
  };
  return top.filter(hit).map((e) => e.id);
}

/** The date caption's text at time t: "Tue 2 Mar 2027 · Foundations, Frame". */
export function dateText(c, t) {
  const day = Math.floor(t / c.seconds_per_day + 1e-9);
  const d = new Date(c.start_date + day * DAY);
  const s = `${'Sun Mon Tue Wed Thu Fri Sat'.split(' ')[d.getUTCDay()]} ${d.getUTCDate()} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const now = (c.tasks || []).filter((x) => t >= x.start - 1e-9 && t <= x.end + 1e-9).map((x) => x.name);
  return now.length ? `${s} · ${now.slice(0, 3).join(', ')}${now.length > 3 ? ` +${now.length - 3}` : ''}` : s;
}

// ---------------------------------------------------------------- key editing (#73)

/** Scale and shift the keys of targets that fall in [from, to] about `from`: t → from + (t − from)·scale + offset. */
export function retime(doc, { targets = null, from = 0, to = Infinity, scale = 1, offset = 0 }) {
  if (!(scale > 0)) throw new Error('scale must be above 0.');
  let n = 0;
  for (const tr of doc.animation.tracks) {
    if (targets && !targets.includes(tr.target)) continue;
    for (const k of tr.keys) if (k.t >= from - 1e-9 && k.t <= to + 1e-9) (k.t = Math.max(0, round(from + (k.t - from) * scale + offset))), n++;
    // keys that landed on each other: the moved one wins
    tr.keys.sort((a, b) => a.t - b.t);
    tr.keys = tr.keys.filter((k, i, a) => i === a.length - 1 || Math.abs(a[i + 1].t - k.t) > 1e-3);
  }
  const last = Math.max(0, ...doc.animation.tracks.flatMap((tr) => tr.keys.map((k) => k.t)));
  if (last > doc.animation.duration) doc.animation.duration = Math.ceil(last);
  return n;
}

/** Copy the keys of one target (optionally only [from, to], only some properties) to others, shifted by offset. */
export function copyKeys(doc, source, dests, { from = 0, to = Infinity, offset = 0, properties = null }) {
  const add = [];
  for (const tr of doc.animation.tracks) {
    if (tr.target !== source || (properties && !properties.includes(tr.property))) continue;
    for (const k of tr.keys) if (k.t >= from - 1e-9 && k.t <= to + 1e-9) for (const d of dests) add.push({ target: d, property: tr.property, t: round(k.t + offset), v: structuredClone(k.v), ease: k.ease, bezier: k.bezier });
  }
  if (!add.length) throw new Error('No keys to copy there.');
  return add;
}
