// Projects: a folder laid out by kind with an OGC GeoPackage as its database. Saved to a real temp folder (the
// GeoPackage through node:sqlite, as the main process writes it), reopened, and the database's settings win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeCtx } from './helpers.js';
import { writeGpkg, readGpkg } from '../src/core/gpkg.js';
import * as PJ from '../src/core/project.js';
import * as S from '../src/core/survey.js';
import * as Assets from '../src/core/assets.js';

/** ctx.io on a real folder: what the desktop app's IPC does, without Electron. The model file is the document as JSON. */
function folderIO(ctx) {
  const w = (p, data) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, typeof data === 'string' ? data : Buffer.from(data)));
  return {
    exists: async (p) => fs.existsSync(p),
    writeFile: async (p, d) => w(p, d),
    readText: async (p) => fs.readFileSync(p, 'utf8'),
    readBinary: async (p) => new Uint8Array(fs.readFileSync(p)),
    copyInto: async (src, dir) => {
      if (!fs.existsSync(src)) return { missing: true };
      const dest = path.join(dir, path.basename(src));
      if (fs.existsSync(dest)) return { path: dest };
      w(dest, fs.readFileSync(src));
      return { path: dest, copied: true };
    },
    writeModel: async (p, outside) => w(p, JSON.stringify({ doc: ctx.doc, packed: Object.keys(Assets.pack(ctx.doc)).filter((id) => !outside.has(id)) })),
    open: async (p) => ctx.store.replace(JSON.parse(fs.readFileSync(p, 'utf8')).doc),
    gpkgWrite: async (p, payload) => (payload.fresh && fs.rmSync(p, { force: true }), writeGpkg(DatabaseSync, p, payload)),
    gpkgRead: async (p) => readGpkg(DatabaseSync, p),
  };
}

test('folderFor, safeName, assetFile, inside', () => {
  assert.equal(PJ.folderFor('C:/jobs/Riverside.JXL'), 'survey');
  assert.equal(PJ.folderFor('site.fxl'), 'codes');
  assert.equal(PJ.folderFor('plan.dxf'), 'drawings');
  assert.equal(PJ.safeName('Bridge: stage 2/3.'), 'Bridge_ stage 2_3');
  assert.equal(PJ.assetFile('a1', { mime: 'application/pdf', name: 'Plan A.pdf' }), 'assets/Plan A-a1.pdf');
  assert.equal(PJ.assetFile('a2', { mime: 'application/x-mmr-points' }), null, 'no common type: stays in the model file');
  assert.ok(PJ.inside('C:\\Jobs\\P1\\survey\\a.csv', 'c:/jobs/p1'));
  assert.ok(!PJ.inside('C:/Jobs/P10/a.csv', 'C:/Jobs/P1'));
});

test('save_project lays out the folder and its GeoPackage; open_project reads it back, the database winning for settings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-project-'));
  try {
    const src = path.join(root, 'from-the-field');
    fs.mkdirSync(src);
    const csv = path.join(src, 'north-block.csv');
    fs.writeFileSync(csv, 'P,N,E,Z,CODE,DIA\n1,5400000,650000,10,MH,1.2\n2,5400010,650005,10.5,MH,0.9\n3,5400020,650000,11,KERB,\n');
    const { ctx, reg } = makeCtx();
    ctx.io = folderIO(ctx);
    await reg.run('set_coordinate_system', { epsg: 2193, name: 'NZGD2000 / NZTM' });
    await reg.run('define_feature_code', { code: 'MH', layer: 'Stormwater', attrs: [{ name: 'DIA', type: 'number', decimals: 2 }] });
    await reg.run('import_points', { path: csv, header: true });
    ctx.doc.entities.find((e) => e.type === 'point').point.attrs.LIT = true; // a yes / no attribute goes to the table as 1
    const pdf = Assets.put(new TextEncoder().encode('%PDF-1.4 a drawing'), { mime: 'application/pdf', name: 'Plan.pdf' });
    ctx.doc.entities.push({ id: 'u1', type: 'underlay', name: 'Plan', parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], material: { color: '#fff' }, visible: true, tag: 'Untagged', underlay: { asset: pdf, kind: 'pdf' } });

    const dir = path.join(root, 'Riverside upgrade').replace(/\\/g, '/');
    const r = await reg.run('save_project', { path: dir });
    assert.equal(r.name, 'Riverside upgrade');
    for (const f of ['project.gpkg', 'scene.usda', 'README.txt', 'models/Riverside upgrade.glb', 'survey/north-block.csv', 'codes/feature-codes.fxl', `assets/Plan-${pdf}.pdf`]) assert.ok(fs.existsSync(path.join(dir, f)), `${f} is in the project`);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'models/Riverside upgrade.glb'), 'utf8')).packed, [], 'the PDF is a file in assets/, not packed again');
    assert.deepEqual(ctx.doc.project.files.map((f) => [f.path, f.role]), [['survey/north-block.csv', 'survey']]);

    // the database: GIS tables in the project's EPSG, and the project's own tables
    const db = readGpkg(DatabaseSync, path.join(dir, 'project.gpkg'));
    const pts = db.tables.find((t) => t.table === 'survey_points');
    assert.equal(pts.epsg, 2193);
    assert.deepEqual(pts.features[0].geometry.coordinates, [650000, 5400000, 10]);
    assert.deepEqual([pts.features[0].properties.code, pts.features[0].properties.DIA, pts.features[0].properties.source, pts.features[0].properties.LIT], ['MH', 1.2, 'File: north-block.csv', 1]);
    const cfg = PJ.readConfig(db.attributes.find((t) => t.table === 'mmr_project').rows);
    assert.equal(cfg.crs.epsg, 2193);
    assert.ok(cfg.feature_codes.MH);
    assert.equal(db.attributes.find((t) => t.table === 'mmr_files').rows[0].original, csv.replace(/\\/g, '/'));

    // someone changes the coordinate system name and a code's layer in the database (QGIS, a script)
    const sql = new DatabaseSync(path.join(dir, 'project.gpkg'));
    sql.prepare('UPDATE mmr_project SET value = ? WHERE key = ?').run(JSON.stringify({ ...cfg.crs, name: 'NZTM2000 (edited)' }), 'crs');
    sql.prepare('UPDATE mmr_project SET value = ? WHERE key = ?').run(JSON.stringify({ ...cfg.feature_codes, MH: { ...cfg.feature_codes.MH, layer: 'Manholes' } }), 'feature_codes');
    sql.close();

    const b = makeCtx();
    b.ctx.io = folderIO(b.ctx);
    const o = await b.reg.run('open_project', { path: `${dir}/project.gpkg` });
    assert.deepEqual(o.from_database.sort(), ['crs', 'feature_codes']);
    assert.equal(S.geo(b.ctx.doc).crs.name, 'NZTM2000 (edited)');
    assert.equal(S.points(b.ctx.doc).find((p) => p.point.code === 'MH').tag, 'Manholes', 'codes reprocessed with the edited layer');
    assert.equal(b.ctx.doc.project.folder, dir);
    // saving again goes to the same folder (save routes to the project) and copies nothing twice
    const again = await b.reg.run('save', {});
    assert.equal(again.project, dir);
    assert.deepEqual(again.written.filter((f) => !f.startsWith('surfaces')), []);
    await assert.rejects(b.reg.run('open_project', { path: src }), /not a project folder/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
