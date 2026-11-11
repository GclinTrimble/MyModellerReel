// Phase 4 (AI workflows and insight): quantities, the design review's checks, domain skills, and the MCP server's
// resources and prompts (driven over stdio against a fake app API).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeCtx, near } from './helpers.js';
import { workflowText, WORKFLOWS, SKILLS } from '../src/core/skills.js';
import { reviewChecks } from '../src/core/review.js';

test('quantities: volume and area per material, metadata grouping through groups, sweep length, CSV', async () => {
  const { reg } = makeCtx();
  await reg.run('create_box', { width: 10, height: 0.3, depth: 8, name: 'Slab', color: '#a7a39a' }); // Concrete
  for (let i = 0; i < 4; i++) await reg.run('create_cylinder', { radius: 0.2, height: 3, position: [i * 3, 0.3, 0], name: `Column ${i + 1}`, color: '#a7a39a', segments: 64 });
  await reg.run('create_box', { width: 1, height: 2, depth: 0.05, name: 'Door', color: '#b58a57' });
  const g = await reg.run('group', { ids: ['Column 1', 'Column 2'], name: 'Core' });
  await reg.run('set_metadata', { ids: [g.id], values: { phase: 'P1', cost: 100 } });
  await reg.run('create_curve', { points: [[0, 0, 10], [30, 0, 10]], name: 'Edge' });
  await reg.run('sweep', { path: 'Edge', profile: 'kerb', name: 'Kerb' });
  const r = await reg.run('report_quantities', {});
  const concrete = r.rows.find((x) => x.group === 'Concrete');
  assert.equal(concrete.count, 5);
  near(concrete.volume, 10 * 0.3 * 8 + 4 * Math.PI * 0.04 * 3, 0.01);
  near(concrete.area, 2 * (80 + 3 + 2.4) + 4 * (2 * Math.PI * 0.04 + 2 * Math.PI * 0.2 * 3), 0.05);
  assert.equal(r.rows.find((x) => x.group === 'Oak').count, 1);
  near(r.totals.length, 30 + 30, 1e-6); // the curve, and the kerb swept along it
  const byPhase = await reg.run('report_quantities', { group_by: 'phase' });
  assert.equal(byPhase.rows.find((x) => x.group === 'P1').count, 2); // shapes inherit their group's metadata
  near(byPhase.rows.find((x) => x.group === 'P1').cost, 200);
  const byName = await reg.run('report_quantities', { group_by: 'name', format: 'csv' });
  assert.equal(byName.rows.find((x) => x.group === 'Column').count, 4);
  assert.match(byName.csv, /^name,count,area_m2,volume_m3,length_m,cost\n/);
  assert.match(byName.csv, /\nTotal,8,/);
  await assert.rejects(reg.run('report_quantities', { path: 'C:/x.csv' }), /desktop app/);
});

test('review: floating, collisions, below ground, units, broken parametric shapes', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 2, height: 1, depth: 2, name: 'Table' });
  await reg.run('create_box', { width: 0.3, height: 0.3, depth: 0.3, position: [0, 1, 0], name: 'Vase' }); // on the table: fine
  await reg.run('create_box', { width: 0.5, height: 0.5, depth: 0.5, position: [6, 2, 0], name: 'Balloon' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [0.5, 0, 0.5], name: 'Crate' }); // inside the table
  await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [-6, -0.5, 0], name: 'Sunk' });
  await reg.run('create_box', { width: 900, height: 1, depth: 1, position: [0, 0, -40], name: 'Wall in mm' });
  await reg.run('create_curve', { points: [[0, 0, 9], [3, 0, 9]], name: 'P' });
  await reg.run('sweep', { path: 'P', profile: 'pipe', name: 'Pipe' });
  await reg.run('delete', { ids: ['P'] });
  const issues = reviewChecks(ctx.doc);
  const kinds = (name) => issues.filter((i) => i.message.includes(name)).map((i) => i.kind);
  assert.deepEqual(kinds('Vase'), []);
  assert.deepEqual(kinds('Balloon'), ['floating']);
  assert.ok(kinds('Crate').includes('collision'));
  assert.deepEqual(kinds('Sunk'), ['below_ground']);
  assert.deepEqual(kinds('Wall in mm'), ['scale']);
  assert.ok(kinds('Pipe').includes('parametric'));
  const g = await reg.run('group', { ids: ['Table', 'Crate'], name: 'Set' }); // parts of one group may overlap
  assert.ok(g.id);
  assert.ok(!reviewChecks(ctx.doc).some((i) => i.kind === 'collision'));
  const r = await reg.run('review_model', {}); // no viewport here: checks only
  assert.equal(r.critique, undefined);
  assert.ok(r.issues.length >= 4 && r.stats.shapes === 7);
});

test('skills and workflows', async () => {
  const { ctx, reg } = makeCtx();
  const list = await reg.run('list_skills', {});
  assert.deepEqual(list.map((s) => s.name), ['architecture', 'product', 'jobsite', 'survey', 'furniture']);
  const arch = (await reg.run('list_skills', { name: 'architecture' }))[0];
  assert.ok(arch.prompt.includes('storeys') && arch.examples.length);
  const u = await reg.run('use_skill', { name: 'jobsite' });
  assert.equal(ctx.skill, 'jobsite');
  assert.match(u.prompt, /haul roads/);
  await reg.run('use_skill', { name: 'none' });
  assert.equal(ctx.skill, null);
  assert.match(workflowText('build_house', { storeys: 3 }), /3-storey house with a 8 × 6 m/);
  assert.match(workflowText('turntable_reel'), /"My model"/);
  for (const name of Object.keys(SKILLS)) assert.ok(WORKFLOWS[`skill_${name}`]);
  assert.throws(() => workflowText('nope'), /No workflow/);
});

test('MCP server: resources and prompts, images from tools, over stdio', async () => {
  const seen = [];
  const api = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    seen.push(`${req.method} ${req.url} ${body}`);
    if (req.url === '/api/health') return json({ ok: true });
    if (req.url === '/api/guide') return json('GUIDE TEXT');
    if (req.url === '/api/commands') return json({ ok: true, result: [{ name: 'get_scene', description: 'd', params: { type: 'object', properties: {} }, category: 'scene' }] });
    const b = body ? JSON.parse(body) : {};
    if (req.url === '/api/batch') return json(b.commands.map((c) => ({ ok: true, result: { id: c.args.id, faces: [] } })));
    if (b.command === 'get_scene') return json({ ok: true, result: { entities: [{ id: 'e1' }], selection: ['e1'] } });
    if (b.command === 'review_model') return json({ ok: true, result: { issues: [], images: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'] } });
    return json({ ok: false, error: `unexpected ${b.command}` });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-mcp-'));
  fs.writeFileSync(path.join(home, 'api.json'), JSON.stringify({ port: api.address().port, token: 't' }));
  const p = spawn(process.execPath, ['src/mcp/server.js'], { env: { ...process.env, MMR_HOME: home }, stdio: ['pipe', 'pipe', 'ignore'] });
  const replies = new Map();
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      replies.set(m.id, m);
    }
  });
  let n = 0;
  const ask = async (method, params) => {
    const id = ++n;
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    for (let k = 0; k < 200 && !replies.has(id); k++) await new Promise((r) => setTimeout(r, 10));
    const m = replies.get(id);
    assert.ok(m, `no reply to ${method}`);
    return m;
  };
  try {
    const init = await ask('initialize', {});
    assert.ok(init.result.capabilities.resources && init.result.capabilities.prompts);
    assert.equal(init.result.serverInfo.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
    const res = (await ask('resources/list')).result.resources.map((r) => r.uri);
    assert.deepEqual(res.slice(0, 6), ['mmr://scene', 'mmr://selection', 'mmr://guide', 'mmr://animation', 'mmr://quantities', 'mmr://commands']);
    assert.ok(res.includes('mmr://howto/put-a-pdf-in-place'), 'the how-to pages are resources');
    assert.match((await ask('resources/read', { uri: 'mmr://howto/hinge-a-door' })).result.contents[0].text, /^# Hinge a door/);
    assert.equal((await ask('resources/read', { uri: 'mmr://guide' })).result.contents[0].text, 'GUIDE TEXT');
    assert.deepEqual(JSON.parse((await ask('resources/read', { uri: 'mmr://scene' })).result.contents[0].text).selection, ['e1']);
    assert.deepEqual(JSON.parse((await ask('resources/read', { uri: 'mmr://selection' })).result.contents[0].text), [{ id: 'e1', faces: [] }]);
    assert.match((await ask('resources/read', { uri: 'mmr://nope' })).error.message, /Unknown resource/);
    const prompts = (await ask('prompts/list')).result.prompts.map((x) => x.name);
    assert.ok(prompts.includes('assembly_sequence') && prompts.includes('skill_jobsite'));
    const pr = (await ask('prompts/get', { name: 'assembly_sequence', arguments: { seconds: 20 } })).result;
    assert.match(pr.messages[0].content.text, /20 s construction sequence/);
    const shot = (await ask('tools/call', { name: 'review_model', arguments: { include_images: true } })).result.content;
    assert.deepEqual(shot.map((c) => c.type), ['image', 'image', 'text']);
    assert.equal(shot[1].data, 'BBBB');
  } finally {
    p.kill();
    api.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
