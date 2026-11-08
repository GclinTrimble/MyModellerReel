// Phase 17: roads through the terrain — sections, areas, volumes, solids, the finished ground and the commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as RD from '../src/core/roads.js';

const straight = (len = 100, y = 0) => Array.from({ length: len + 1 }, (_, i) => [i, y, 0, i]);
const flat = (z) => () => z;

test('section areas: fill above the ground, cut below, split where the line crosses it', () => {
  const line = [{ o: -5, y: 1 }, { o: 5, y: 1 }];
  near(RD.sectionAreas(line, flat(0)).fill, 10, 1e-9);
  near(RD.sectionAreas(line, flat(3)).cut, 20, 1e-9);
  const tilted = RD.sectionAreas([{ o: -4, y: -1 }, { o: 4, y: 1 }], flat(0));
  near(tilted.cut, 2, 1e-9);
  near(tilted.fill, 2, 1e-9);
});

test('a road 2 m below flat ground: both sides in cut, daylight on the ground, area as worked by hand', () => {
  const s = RD.sectionAt(straight(100, -2), 50, { lanes: [{ width: 3.5, crossfall: -2 }], shoulder: { width: 1, crossfall: -4 }, cut_slope: 2 }, flat(0));
  assert.equal(s.left, 'cut');
  assert.equal(s.right, 'cut');
  near(s.points[0].y, 0, 1e-6);
  near(s.points.at(-1).y, 0, 1e-6);
  // edge 2.11 m deep at 4.5 m; 2:1 slope out 4.22 m: per side 4.5 × 2 + the crossfall wedge + the slope triangle
  const side = 3.5 * 2 + (3.5 * 0.07) / 2 + 1 * (2.07 + 0.02) + 0.5 * 4.22 * 2.11;
  near(s.cut, 2 * side, 0.05);
  near(s.fill, 0, 1e-6);
});

test('ditch at the foot of a cut, benches on a high cut, a fill side on a slope', () => {
  const tpl = { ditch: { width: 0.6, depth: 0.5, slope: 3 }, bench: { every: 3, width: 2 } };
  const s = RD.sectionAt(straight(100, -10), 50, tpl, flat(0));
  assert.ok(s.points.some((q) => q.code === 'ditch'), 'a ditch');
  assert.equal(s.points.filter((q) => q.code === 'bench' && q.o > 0).length, 3, 'three benches climbing 10 m every 3 m');
  near(s.points.at(-1).y, 0, 1e-6);
  // ground falling to the right: left in cut, right in fill
  const side = RD.sectionAt(straight(100, 0), 50, {}, (x, z) => -z * 0.5);
  assert.equal(side.left, 'cut');
  assert.equal(side.right, 'fill');
  assert.ok(side.cut > 0 && side.fill > 0);
});

test('superelevation: on a curve the inside of the road is lower than the outside', () => {
  // a right-hand quarter circle (towards +z) of radius 40 m after 50 m straight
  const path = straight(50, 0);
  for (let k = 1; k <= 63; k++) {
    const a = (k / 63) * (Math.PI / 2);
    path.push([50 + 40 * Math.sin(a), 0, 40 - 40 * Math.cos(a), 50 + k * ((40 * Math.PI) / 2 / 63)]);
  }
  const ranges = RD.curveRanges(path);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0][2], 1, 'turns right');
  const s = RD.sectionAt(path, 80, { superelevation: { rate: 6, runoff: 20 } }, null, ranges);
  const lane = s.points.filter((q) => q.code === 'lane');
  const [inner, outer] = [lane.find((q) => q.o > 0), lane.find((q) => q.o < 0)];
  assert.ok(inner.y < -0.2 && outer.y > 0.2, `inside ${inner.y}, outside ${outer.y}`);
  const before = RD.sectionAt(path, 10, { superelevation: { rate: 6, runoff: 20 } }, null, ranges);
  near(before.points.find((q) => q.code === 'lane' && q.o < 0).y, -0.0875, 1e-6); // normal crossfall far from the curve
});

test('volumes by average end areas; a solid between two grids has the volume of the box', () => {
  const secs = [0, 50, 100].map((station) => ({ station, cut: 10, fill: 2 }));
  const v = RD.corridorVolumes(secs, { bulking: 1.25, shrinkage: 0.8 });
  near(v.totals.cut, 1000, 1e-9);
  near(v.totals.fill, 200, 1e-9);
  near(v.totals.cut_loose, 1250, 1e-9);
  near(v.totals.balance, 1000 - 250, 1e-9);
  assert.match(RD.volumesCsv(v.rows), /^station,cut_area_m2/);
  const top = [[[0, 1, 0], [2, 1, 0]], [[0, 1, 3], [2, 1, 3]]];
  const bottom = top.map((r) => r.map(([x, , z]) => [x, 0, z]));
  near(RD.signedVolume(RD.gridSolid(top, bottom)), 6, 1e-9);
});

test('commands: corridor in cut, sections, volumes, solids, the finished ground shown, then applied and undone', async () => {
  const { reg, ctx } = makeCtx();
  const pts = [];
  for (let i = 0; i <= 18; i++) for (let j = 0; j <= 8; j++) pts.push(`${i}_${j},${-40 + j * 10},${-40 + i * 10},0,GND`); // name, N, E, Z
  await reg.run('import_points', { text: pts.join('\n') });
  await reg.run('set_base_point', { e: 0, n: 0, z: 0 });
  await reg.run('create_surface', { name: 'EG' });
  await reg.run('create_alignment', { name: 'Road', points: [[0, 0], [100, 0]], pvis: [[0, -2], [100, -2]] });
  const c = await reg.run('create_corridor', { alignment: 'Road', surface: 'EG', name: 'Main road', template: { lanes: [{ width: 3.5, crossfall: -2 }], shoulder: { width: 1, crossfall: -4 }, cut_slope: 2 }, interval: 10 });
  const sec = await reg.run('road_section', { corridor: 'Main road', station: 50 });
  assert.equal(sec.left, 'cut');
  near(sec.cut_area, 27.5, 0.4);
  const prof = await reg.run('road_profile', { corridor: 'Main road' });
  near(prof.deepest_cut, 2, 1e-3);
  const v = await reg.run('corridor_volumes', { corridor: 'Main road' });
  near(v.totals.cut, 27.5 * 100, 50);
  assert.match(v.totals.verdict, /left over/);
  // pavement layers: earthworks go to the bottom of them, and each layer is a solid
  await reg.run('set_corridor', { id: c.id, template: { layers: [{ name: 'Asphalt', thickness: 0.1, material: 'Asphalt' }, { name: 'Base', thickness: 0.3, material: 'Crushed stone' }] } });
  const v2 = await reg.run('corridor_volumes', { corridor: 'Main road' });
  near(v2.totals.cut - v.totals.cut, 9 * 0.4 * 100, 20);
  const sol = await reg.run('corridor_solids', { corridor: 'Main road', topsoil: 0.2 });
  const by = Object.fromEntries(sol.solids.map((s) => [s.name, s]));
  near(by.Cut.volume_m3, v2.totals.cut, v2.totals.cut * 0.03);
  near(by.Asphalt.volume_m3, 9 * 0.1 * 100, 1);
  near(by.Base.volume_m3, 9 * 0.3 * 100, 2);
  near(by.Asphalt.tonnes, by.Asphalt.volume_m3 * 2.4, 1);
  assert.ok(by['Topsoil strip'].volume_m3 > 0);
  assert.equal(by.Fill, undefined, 'no fill in a cutting');
  // see the cut without changing the ground
  const eg = () => ctx.doc.entities.find((e) => e.name === 'EG');
  const before = JSON.stringify(eg().mesh);
  const fs = await reg.run('corridor_surface', { corridor: 'Main road' });
  assert.equal(eg().visible, false);
  assert.equal(JSON.stringify(eg().mesh), before, 'the ground is not edited');
  const fin = ctx.doc.entities.find((e) => e.id === fs.id);
  assert.ok(Math.min(...fin.mesh.v.map((q) => q[1] + fin.position[1])) < -2, 'the trench is in the finished ground');
  // write it for good, then undo
  await reg.run('apply_corridor', { corridor: 'Main road' });
  assert.ok(Math.min(...eg().mesh.v.map((q) => q[1] + eg().position[1])) < -2);
  assert.equal(ctx.doc.entities.some((e) => e.derived?.generator === 'finished_ground'), false);
  await reg.run('undo');
  assert.equal(JSON.stringify(eg().mesh), before);
});
