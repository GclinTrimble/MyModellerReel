// Survey replay (#282–#286): the day in numbers, the timeline plan, the instrument's line of sight, and the
// replay_survey command that puts them in the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as FB from '../src/core/fieldbook.js';
import * as RP from '../src/core/replay.js';
import * as INST from '../src/core/instruments.js';
import { JOB } from './fieldbook.test.js';

const book = () => FB.readJobXml(JOB);

test('survey stats: time on site, points per hour, setups, methods and the gaps', () => {
  const b = book();
  const s = RP.stats(b, { gap: 300 });
  assert.equal(s.points, 10);
  assert.ok(s.observations >= 10);
  assert.match(s.start, /^\d\d:\d\d$/);
  assert.ok(s.hours > 0 && s.points_per_hour > 0, 'a day with time stamps has a rate');
  assert.ok(s.setups.length >= 1);
  const st = s.setups[0];
  assert.equal(st.station, 'S1');
  assert.equal(st.instrument_height, 1.6);
  assert.ok(st.shots > 0 && st.mean_sight > 0 && st.longest_sight >= st.mean_sight);
  assert.ok(s.by_method.total_station > 0 && s.by_method.gnss > 0);
  assert.ok(s.target_heights.includes(1.5) && s.target_heights.includes(2), 'the rod bust shows as two heights used');
  assert.ok(s.walked > 0);
  assert.equal(s.deleted, b.observations.filter((o) => o.deleted).length);
});

test('timeline plan: clock keeps the gaps, event spaces evenly, speed shortens both', () => {
  const b = book();
  const clock = RP.plan(b, { mode: 'clock', seconds_per_hour: 60 });
  assert.equal(clock.mode, 'clock');
  assert.equal(clock.dots[0].t, 0);
  assert.ok(clock.duration > 0);
  const fast = RP.plan(b, { mode: 'clock', seconds_per_hour: 60, speed: 2 });
  near(fast.dots.at(-1).t, clock.dots.at(-1).t / 2, 1e-6);
  const ev = RP.plan(b, { mode: 'event', seconds_per_point: 0.5 });
  assert.equal(ev.mode, 'event');
  near(ev.dots[1].t - ev.dots[0].t, 0.5, 1e-9);
  near(ev.dots.at(-1).t, (ev.dots.length - 1) * 0.5, 1e-9);
  assert.ok(ev.dots.every((d, i) => i === 0 || d.t >= ev.dots[i - 1].t), 'dots are in field order');
  assert.ok(clock.bands.some((b) => b.station === 'S1' && b.kind === 'station'), 'the day reads as blocks of work, a band per setup');
  assert.throws(() => RP.plan(b, { mode: 'fast' }), /clock or event/);
});

test('line of sight: the telescope points at the prism, at the heights that were measured', () => {
  const b = book();
  const posOf = (n) => b.results[n] || null;
  const o = b.observations.find((x) => x.name === 'P1' && x.kind === 'ts');
  const p = RP.shotPose(b, o, posOf);
  const st = posOf('S1');
  near(p.trunnion.z, st.z + 1.6, 1e-9, 'the trunnion sits at the instrument height');
  near(p.height, o.th);
  // where the circle readings say the prism is, is where the point was computed, plus the rod
  const r = posOf('P1');
  near(p.foot.n, r.n, 2e-3);
  near(p.foot.e, r.e, 2e-3);
  near(p.foot.z, r.z, 2e-3);
  near(p.prism.z, p.foot.z + o.th, 1e-9);
  near(Math.hypot(p.prism.n - p.trunnion.n, p.prism.e - p.trunnion.e, p.prism.z - p.trunnion.z), o.circle.sd, 1e-6, 'the beam is the slope distance long');
  const g = RP.rovePose(b, b.observations.find((x) => x.kind === 'gnss'), posOf);
  near(g.antenna.z - g.foot.z, g.height, 1e-9);
  assert.equal(RP.poseOf(b, { kind: 'keyed' }, posOf), null);
});

test('instruments are closed shapes with the parts the replay drives', () => {
  const ts = INST.totalStation(1.6);
  const names = [];
  const walk = (s) => (names.push(s.name), (s.children || []).forEach(walk));
  walk(ts);
  for (const part of ['Tripod', 'Alidade', 'Telescope', 'Sight line']) assert.ok(names.includes(part), `${part} is a named part`);
  const alidade = ts.children.find((c) => c.name === 'Alidade');
  const tel = alidade.children.find((c) => c.name === 'Telescope');
  near(alidade.position[1] + tel.position[1], 1.6, 1e-9, 'the trunnion axis ends up at the instrument height');
  const beam = tel.children.find((c) => c.name === 'Sight line');
  const zs = beam.mesh.v.map((p) => p[2]);
  near(Math.min(...zs), -1, 1e-6, 'the beam is one metre of −Z, for the replay to scale');
  near(Math.max(...zs), 0, 1e-6);
  assert.ok(INST.prismRod(1.8).children.find((c) => c.name === 'Prism').position[1] === 1.8);
});

test('replay_survey: points appear in field order, the rig stands, and a rebuild leaves one replay behind', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('import', { text: JOB, format: 'jxl' });
  const r = await reg.run('replay_survey', { mode: 'event', seconds_per_point: 0.5 });
  const doc = ctx.doc;
  assert.equal(r.surveys.length, 1);
  assert.equal(r.mode, 'event');
  assert.ok(doc.animation.duration >= r.duration - 1);

  const p1 = doc.entities.find((e) => e.name === 'P1');
  const track = doc.animation.tracks.find((t) => t.target === p1.id && t.property === 'visible');
  assert.deepEqual(track.keys.map((k) => k.v), [false, true], 'a point is hidden until it was measured');
  assert.equal(track.keys[0].ease, 'step');

  const station = doc.entities.find((e) => e.name === 'Total station');
  assert.ok(station && doc.entities.some((e) => e.name === 'Prism rod') && doc.entities.some((e) => e.name === 'GNSS rover'));
  assert.ok(doc.entities.filter((e) => e.tag === 'Survey replay').length > 6, 'the rig is tagged so it can be hidden');
  const alidade = doc.entities.find((e) => e.name === 'Alidade');
  const turn = doc.animation.tracks.find((t) => t.target === alidade.id && t.property === 'rotation');
  assert.ok(turn.keys.length > 1 && turn.keys.some((k) => k.v[1] !== turn.keys[0].v[1]), 'the alidade turns between shots');
  assert.ok(doc.animation.markers.some((x) => x.name.startsWith('Station S1')));
  assert.ok(doc.animation.replays[0].dots.length >= 10);

  const before = doc.entities.length;
  await reg.run('replay_survey', { mode: 'clock' });
  assert.equal(doc.animation.replays.length, 1, 'a rebuild replaces the replay, it does not stack');
  assert.equal(doc.entities.length, before, 'and reuses the same number of parts');
  assert.equal(doc.animation.markers.filter((x) => x.replay).length, doc.animation.replays[0].bands.length);

  const c = await reg.run('replay_survey', { clear: true });
  assert.ok(c.cleared > 0);
  assert.equal(doc.entities.some((e) => e.tag === 'Survey replay'), false);
  assert.equal(doc.animation.tracks.some((t) => t.target === p1.id), false, 'clearing gives the points back');
  assert.equal(doc.animation.markers.length, 0);
});

test('survey_stats command and a growing surface', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('import', { text: JOB, format: 'jxl' });
  const s = await reg.run('survey_stats', {});
  assert.equal(s.points, 10);
  assert.ok(s.setups.length >= 1);
  await reg.run('replay_survey', { mode: 'event', grow: true, grow_steps: 4 });
  const stages = ctx.doc.entities.filter((e) => /TIN \d/.test(e.name));
  assert.ok(stages.length >= 2, 'the surface is built in stages');
  assert.ok(stages.every((e) => e.mesh.f.length), 'each stage is a triangulation');
  const last = stages.at(-1);
  assert.ok(last.mesh.v.length >= stages[0].mesh.v.length, 'later stages hold more of the day');
});
