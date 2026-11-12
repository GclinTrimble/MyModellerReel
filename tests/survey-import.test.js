// Survey data import: delimited text with a column mapping (preview, then import), attributes on each point,
// LandXML point attributes, and a large file in reasonable time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as S from '../src/core/survey.js';

test('splitTable: delimiters, quotes, runs of spaces, comments, file lines', () => {
  assert.equal(S.detectDelimiter('# c\n1\t2\t3'), 'tab');
  assert.equal(S.detectDelimiter('1;2,5;3'), 'semicolon');
  assert.equal(S.detectDelimiter('1  2 3'), 'space');
  const t = S.splitTable('# comment\n\n1,"Smith, J",3\n"a ""b""",,x\n');
  assert.equal(t.delimiter, 'comma');
  assert.deepEqual([...t.rows[0]], ['1', 'Smith, J', '3']);
  assert.equal(t.rows[0].line, 3);
  assert.deepEqual([...t.rows[1]], ['a "b"', '', 'x']);
  assert.deepEqual([...S.splitTable('  1   2\t3 ', 'space').rows[0]], ['1', '2', '3']);
  assert.deepEqual([...S.splitTable('1|2|3', '|').rows[0]], ['1', '2', '3']);
});

test('guessColumns: header labels, else PNEZD', () => {
  const rows = S.splitTable('Point,Easting,Northing,Elev,Code,Diameter\n1,200,100,10,MH,0.6').rows;
  assert.ok(S.looksLikeHeader(rows));
  assert.deepEqual(S.guessColumns(rows).map((c) => c.role), ['name', 'e', 'n', 'z', 'code', 'attr']);
  assert.equal(S.guessColumns(rows)[5].name, 'Diameter');
  assert.deepEqual(S.guessColumns(S.splitTable('1,100,200,10,MH,x').rows).map((c) => c.role), ['name', 'n', 'e', 'z', 'code', 'desc']);
});

test('parseTable: column mapping, attributes typed, units, decimal commas, bad lines', () => {
  const text = 'ID;X;Y;H;Type;Material;Note\nA;200,5;100;10;MH;Concrete;cracked\nB;201;101;11;MH;PVC;\nC;oops;1;1;MH;;\n';
  const r = S.parseTable(text, { delimiter: 'semicolon', header: true, columns: ['name', 'e', 'n', 'z', 'code', { role: 'attr', name: 'material' }, 'ignore'] });
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.skipped, [4]);
  assert.deepEqual(r.rows[0], { name: 'A', n: 100, e: 200.5, z: 10, code: 'MH', desc: '', attrs: { material: 'Concrete' } });
  const ft = S.parseTable('1 10 20 30 GND 0.25', { delimiter: 'space', columns: ['name', 'n', 'e', 'z', 'code', { role: 'attr', name: 'depth' }], units: 'ft' });
  near(ft.rows[0].n, 3.048);
  assert.deepEqual(ft.rows[0].attrs, { depth: 0.25 }); // attributes are values, not converted
  assert.throws(() => S.parseTable('1,2', { columns: ['name', 'n'] }), /easting/);
  assert.throws(() => S.parseTable('1,2', { columns: ['bogus'] }), /role/);
  // the old format letters still work, extra columns become the description
  assert.deepEqual(S.parsePoints('1,100,200,10,MH,big one', { format: 'PNEZD' }).rows[0].desc, 'big one');
});

test('preview_points changes nothing; import_points keeps attributes on each point', async () => {
  const { ctx, reg } = makeCtx();
  const text = 'Point\tEasting\tNorthing\tElevation\tCode\tDiameter\tOwner\n1\t650000\t5400000\t100\tMH\t0.6\tCity\n2\t650010\t5400000\t100.5\tMH\t0.9\tCity\n';
  const p = await reg.run('preview_points', { text });
  assert.equal(p.delimiter, 'tab');
  assert.equal(p.header, true);
  assert.deepEqual(p.columns.map((c) => c.name || c.role), ['name', 'e', 'n', 'z', 'code', 'Diameter', 'Owner']);
  assert.equal(p.points, 2);
  assert.equal(p.sample.length, 3);
  assert.equal(ctx.doc.entities.length, 0);
  const r = await reg.run('import_points', { text, delimiter: 'tab', header: true, columns: ['name', 'e', 'n', 'z', 'code', { role: 'attr', name: 'Diameter' }, 'ignore'] });
  assert.equal(r.imported, 2);
  const pt = S.points(ctx.doc).find((x) => x.name === '2');
  assert.deepEqual(pt.point.attrs, { Diameter: 0.9 });
  near(pt.point.e, 650010);
  // the saved document keeps them as a field
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.doc)).entities.find((x) => x.name === '2').point.attrs, { Diameter: 0.9 });
});

test('LandXML points bring their feature properties as attributes', async () => {
  const { ctx, reg } = makeCtx();
  const xml = `<?xml version="1.0"?><LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><Units><Metric linearUnit="meter"/></Units>
<CgPoints><CgPoint name="MH1" code="MH">5400000 650000 100<Feature code="manhole"><Property label="Diameter" value="1.2"/><Property label="Owner" value="City"/></Feature></CgPoint>
<CgPoint name="T1" code="TREE">5400005 650005 101</CgPoint></CgPoints></LandXML>`;
  await reg.run('import', { text: xml, format: 'landxml' });
  const mh = S.points(ctx.doc).find((p) => p.name === 'MH1');
  assert.deepEqual(mh.point.attrs, { Diameter: 1.2, Owner: 'City' });
  near(mh.point.z, 100);
  assert.deepEqual(S.points(ctx.doc).find((p) => p.name === 'T1').point.attrs, {});
});

test('5000 points import in a few seconds', async () => {
  const { ctx, reg } = makeCtx();
  const rows = ['P,N,E,Z,Code,Depth'];
  for (let i = 0; i < 5000; i++) rows.push(`${i + 1},${5400000 + (i % 100)},${650000 + Math.floor(i / 100)},${100 + (i % 7) * 0.1},GND,${i % 3}`);
  const t0 = performance.now();
  const r = await reg.run('import_points', { text: rows.join('\n') });
  const ms = performance.now() - t0;
  assert.equal(r.imported, 5000);
  assert.equal(S.points(ctx.doc)[4999].point.attrs.Depth, 4999 % 3);
  assert.ok(ms < 5000, `took ${ms.toFixed(0)} ms`);
});
