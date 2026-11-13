// Phase 22 survey field books (#257–#260, #262, #269): JobXML setups and observations, recompute after edits, review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeCtx, near } from './helpers.js';
import * as FB from '../src/core/fieldbook.js';

// One total-station setup on S1 (backsight BS due north) with a run of shots at a 1.5 m rod and one shot left at 2.0 m;
// a GNSS base on B1 and an RTK rover. Synthetic numbers, consistent with each other (curvature and refraction at these
// distances are under 0.01 mm, so z = 10 + 1.6 − rod).
export const JOB = fs.readFileSync(new URL('./fixtures/jxl/kerb-pickup.jxl', import.meta.url), 'utf8');

const z = (ctx, name) => ctx.doc.entities.find((e) => e.name === name && e.type === 'point').point.z;

test('field book: setups, backsights, targets, GNSS bases and observations; heights reduced from how they were measured', () => {
  const b = FB.readJobXml(JOB);
  assert.equal(b.standard, FB.STANDARD);
  assert.equal(b.job.crs.zone, 'NZTM 2000');
  const s = Object.values(b.setups)[0];
  assert.deepEqual([s.station, s.ih, s.backsights[0].point], ['S1', 1.6, 'BS']);
  const p3 = b.observations.find((o) => o.name === 'P3');
  assert.deepEqual([p3.kind, p3.th, p3.pc], ['ts', 2, 0.002]);
  assert.equal(b.observations.find((o) => o.name === 'R1').kind, 'gnss');
  assert.equal(b.results.BS.obs, 'k2', 'a backsight shot does not replace the control point');
  near(FB.antennaHeight(b.bases.r1.antenna), 1.67932);
  near(FB.trueHeight({ measured: 1.473, method: 'SXNotch', hOff: 0.1398, vOff: 0.13803 }), 1.6043809);
  assert.equal(b.notes[0].text, 'Rod extended for the kerb');
  near(FB.reduceShot({ station: { n: 1000, e: 5000, z: 10 }, backsight: { n: 1100, e: 5000, z: 10 }, bs: { hc1: 0 }, ha: 90, va: 90, sd: 10, ih: 1.6, th: 1.5 }).e, 5010);
  assert.equal(FB.recompute(b).moved.length, 0, 'nothing edited: the controller\'s coordinates stand');
  assert.equal(FB.selectObservations(b, { from: '10:05', to: '10:21' }).length, 3);
});

test('edit a rod height found by review_survey: the point moves, revert puts it back; instrument and antenna heights', async () => {
  const { ctx, reg } = makeCtx();
  const r = await reg.run('import', { text: JOB, format: 'jxl' });
  assert.equal(r.created.points, 10);
  assert.equal(r.created['survey setups'], 2);
  const survey = ctx.doc.entities.find((e) => e.type === 'survey');
  assert.equal(r.survey, survey.id);
  assert.equal(ctx.doc.entities.find((e) => e.name === 'P1').point.survey, survey.id);

  const review = await reg.run('review_survey', {});
  const bust = review.list.find((f) => f.check === 'target_height');
  assert.match(bust.message, /P3/);
  assert.equal(bust.fix.target_height, 1.5);
  assert.ok(review.list.some((f) => f.check === 'gnss_quality' && /R2/.test(f.message)), 'weak GNSS fix flagged');

  const fixed = await reg.run('edit_survey_observations', bust.fix);
  assert.equal(fixed.moved, 1);
  near(z(ctx, 'P3'), 10.1);
  assert.deepEqual((await reg.run('list_survey', { edits: true })).edits.map((x) => [x.field, x.was, x.now]), [['target_height', 2, 1.5]]);
  assert.equal((await reg.run('compare_survey', {})).points[0].dz, 0.5);

  await reg.run('edit_survey_observations', { names: ['P3'], revert: true });
  near(z(ctx, 'P3'), 9.6);

  // "the instrument height was 1.65, not 1.6": every shot from that setup rises 5 cm, the control does not
  await reg.run('edit_survey_observations', { setup: 'S1', instrument_height: 1.65 });
  near(z(ctx, 'P1'), 10.15);
  near(z(ctx, 'P5'), 10.15);
  near(z(ctx, 'BS'), 10);
  // a rod height over a time range
  await reg.run('edit_survey_observations', { from: '10:30', to: '10:31', target_height: 1.45 });
  near(z(ctx, 'P4'), 10.2);
  // GNSS: rover antenna 10 cm higher → points 10 cm lower; base antenna 2 cm higher → rovers 2 cm higher
  await reg.run('edit_survey_observations', { names: ['R1'], antenna_height: 1.85 });
  near(z(ctx, 'R1'), 20.9);
  await reg.run('edit_survey_observations', { base: 'B1', base_antenna_height: 1.52 });
  near(z(ctx, 'R2'), 21.22);
  // delete a shot: its point hides; restore brings it back
  await reg.run('edit_survey_observations', { names: ['P2'], deleted: true });
  const p2 = ctx.doc.entities.find((e) => e.name === 'P2');
  assert.equal(p2.visible, false);
  await reg.run('edit_survey_observations', { names: ['P2'], deleted: false });
  assert.equal(p2.visible, true);
  // undo is one step per edit
  ctx.store.undo();
  assert.equal(ctx.doc.entities.find((e) => e.name === 'P2').visible, false);
});

test('a moved control point carries the setup on it: recompute_survey', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('import', { text: JOB, format: 'jxl' });
  await reg.run('edit_survey_observations', { names: ['S1'], n: 1000.05 });
  near(ctx.doc.entities.find((e) => e.name === 'P1').point.n, 1000.05);
  near(ctx.doc.entities.find((e) => e.name === 'P1').point.e, 5010, 1e-3);
  const list = await reg.run('list_survey', { kind: 'ts' });
  assert.equal(list.setups[0].station, 'S1');
  assert.ok(list.observations.length >= 6);
});

test('export an edited survey: LandXML 1.2 Survey round trip, InfraGML Part 6, the HTML report (#263)', async () => {
  const { ctx, reg } = makeCtx();
  const files = {};
  ctx.io = { writeText: async (p, t) => (files[p] = t), readText: async (p) => files[p] };
  await reg.run('import', { text: JOB, format: 'jxl' });
  await reg.run('edit_survey_observations', { names: ['P3'], target_height: 1.5 });
  await reg.run('export', { format: 'landxml', path: 'C:/x/job.xml' });
  const xml = files['C:/x/job.xml'];
  assert.match(xml, /<InstrumentSetup id="s1" stationName="S1" instrumentHeight="1.6"/);
  assert.match(xml, /<RawObservation[^>]*targetHeight="1.5"[^>]*>\s*<TargetPoint pntRef="P3"/, 'the corrected rod height is written');
  assert.match(xml, /<GPSVector setupID_A="r1"/);
  const back = makeCtx();
  back.ctx.io = ctx.io;
  const r = await back.reg.run('import', { path: 'C:/x/job.xml', format: 'landxml' });
  assert.equal(r.created['survey setups'], 2);
  const s2 = back.ctx.doc.entities.find((e) => e.type === 'survey').survey;
  assert.equal(Object.values(s2.setups)[0].ih, 1.6);
  assert.equal(s2.observations.find((o) => o.name === 'P3').th, 1.5);
  near(back.ctx.doc.entities.find((e) => e.name === 'P3').point.z, 10.1);
  assert.equal(FB.recompute(s2).moved.length, 0, 'read back, it stands as written');
  // the instrument height edit still works on the round-tripped book
  await back.reg.run('edit_survey_observations', { setup: 'S1', instrument_height: 1.7 });
  near(back.ctx.doc.entities.find((e) => e.name === 'P1').point.z, 10.2);

  await reg.run('export', { format: 'infragml', path: 'C:/x/job.gml' });
  const gml = files['C:/x/job.gml'];
  for (const el of ['li:LandInfraDataset', 'lis:Survey', 'liso:InstrumentPoint', 'liso:AngularObservation', 'liso:DistanceObservation', 'liso:GnssObservation', 'lisr:TargetPoint']) assert.ok(gml.includes(`<${el}`), el);
  const rep = await reg.run('survey_report', { path: 'C:/x/report.html' });
  assert.equal(rep.edits, 1);
  assert.match(files['C:/x/report.html'], /target height<\/td><td>2<\/td><td>1.5/);
});
