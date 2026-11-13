// Help that answers (#241) and my own tools and skills (#242).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeCtx } from './helpers.js';
import * as UT from '../src/core/usertools.js';
import * as HA from '../src/core/helpask.js';
import { USER_SKILLS, skillPrompt } from '../src/core/skills.js';

test('lastTurnSteps: the newest turn that did something, even from the next turn', () => {
  const j = [{ command: 'a' }, { command: 'b' }, { command: 'c' }];
  assert.deepEqual(UT.lastTurnSteps(j, [1]).map((s) => s.command), ['b', 'c']);
  assert.deepEqual(UT.lastTurnSteps(j, [1, 3]).map((s) => s.command), ['b', 'c'], 'this turn did nothing yet: the one before');
  assert.deepEqual(UT.lastTurnSteps(j, []).map((s) => s.command), ['a', 'b', 'c']);
  assert.deepEqual(UT.lastTurnSteps([], [0]), []);
});

test('inferParams: named numbers become parameters, coordinates and foreign ids do not', () => {
  const { steps, params } = UT.inferParams([
    { command: 'create_curve', args: { points: [[0, 0, 0], [5, 0, 5]], name: 'Edge' }, made: 'e1' },
    { command: 'sweep', args: { path: 'e1', profile: 'kerb', profile_params: { width: 0.15, height: 0.3 } }, made: 'e2' },
    { command: 'move', args: { ids: ['e9'], by: [1, 0, 0] } },
    { command: 'create_box', args: { width: 0.15, height: 2 } },
  ]);
  assert.deepEqual(Object.keys(params), ['width', 'height', 'height_2']);
  assert.equal(params.width.default, 0.15);
  assert.equal(steps[1].args.profile_params.width, '{{width}}');
  assert.equal(steps[3].args.width, '{{width}}', 'the same value is the same parameter');
  assert.equal(steps[3].args.height, '{{height_2}}');
  assert.deepEqual(steps[0].args.points, [[0, 0, 0], [5, 0, 5]]);
  assert.equal(steps[2].args.ids, undefined, 'a hand pick is dropped: the tool acts on the selection');
});

test('save_tool turns the last turn into a command with parameters; the new ids follow', async () => {
  const { reg, ctx } = makeCtx();
  const saved = [];
  ctx.userLibrary = { save: async (x) => (saved.push(x), `${x.name}.tool.json`), remove: async () => {} };
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Before' });
  ctx.turnStarts = [ctx.doc.journal.length];
  const c = await reg.run('create_curve', { points: [[0, 0, 0], [4, 0, 0], [4, 0, 4]], name: 'Kerb line' });
  await reg.run('sweep', { path: c.id, profile: 'rectangle', profile_params: { width: 0.2, height: 0.15 } });
  ctx.turnStarts.push(ctx.doc.journal.length); // "save what we just did" comes in the next turn
  const r = await reg.run('save_tool', { name: 'Kerb return', description: 'A kerb along a corner' });
  assert.equal(r.tool, 'kerb_return');
  assert.equal(r.steps, 2);
  assert.deepEqual(Object.keys(r.params).sort(), ['height', 'width']);
  assert.equal(saved[0].kind, 'tool');
  assert.ok(reg.list().some((x) => x.name === 'kerb_return' && x.category === 'my tools'), 'listed like any command (API, MCP, search)');

  const n = ctx.doc.entities.length;
  const run = await reg.run('kerb_return', { width: 0.5 });
  assert.equal(ctx.doc.entities.length, n + 2);
  const sweep = ctx.doc.entities.at(-1);
  assert.equal(sweep.derived.params.profile_params?.width ?? sweep.derived.params.width, 0.5);
  assert.notEqual(sweep.derived.inputs?.path ?? run.made[0], c.id, 'the sweep follows the new curve, not the old one');
  assert.equal(run.made[0], ctx.doc.entities.at(-2).id);

  // one undo step, and listed
  assert.equal((await reg.run('list_my_tools', {})).tools[0].title, 'Kerb return');
  await assert.rejects(reg.run('save_tool', { name: 'create box', steps: [{ command: 'create_curve' }] }), /already a command/);
  await assert.rejects(reg.run('save_tool', { name: 'X', steps: [{ command: 'nope' }] }), /not a command/);
  await reg.run('delete_my_tool', { name: 'Kerb return' });
  assert.ok(!reg.commands.has('kerb_return'));
});

test('save_skill: instructions and a toolset, picked like a domain skill, saved as a file', async () => {
  const { reg, ctx } = makeCtx();
  const files = {};
  ctx.userLibrary = { save: async (x) => (files[UT.fileName(x)] = JSON.stringify(x)), remove: async (x) => delete files[UT.fileName(x)] };
  await reg.run('save_skill', { name: 'Site kerbs', description: 'Kerbs my way', prompt: 'Kerbs are 150 mm high.', toolset: ['sweep', 'create_curve'] });
  assert.ok(files['site_kerbs.skill.json']);
  assert.match(skillPrompt('site_kerbs'), /150 mm[\s\S]*Commands for this work: sweep, create_curve/);
  assert.ok((await reg.run('list_skills', {})).some((s) => s.name === 'site_kerbs' && s.mine));
  await reg.run('use_skill', { name: 'site_kerbs' });
  assert.equal(ctx.skill, 'site_kerbs');
  await assert.rejects(reg.run('save_skill', { name: 'Bad', prompt: 'x', toolset: ['nope'] }), /not a command/);
  // a file read back (import, startup) is the same skill
  assert.deepEqual(UT.parseUserFile(files['site_kerbs.skill.json']), USER_SKILLS.site_kerbs);
  assert.throws(() => UT.parseUserFile('{"kind":"virus"}'), /Not a MyModellerReel/);
  await reg.run('delete_my_tool', { name: 'site_kerbs' });
  assert.equal(ctx.skill, null);
  assert.deepEqual(files, {});
});

test('ask_help: sections from the pages, an answer that cites them, and Show me', async () => {
  const { reg, ctx } = makeCtx();
  ctx.help = { read: async (id) => fs.readFileSync(new URL(`../docs/how-to/${id}.md`, import.meta.url), 'utf8') };
  const offline = await reg.run('ask_help', { question: 'how do I sweep a kerb along a curve' });
  assert.equal(offline.answer, null, 'no model: the sections alone');
  assert.equal(offline.sources[0].id, 'live-sweep-along-a-curve');
  assert.ok(offline.commands.some((c) => c.name === 'sweep'));
  assert.deepEqual(offline.show, { kind: 'tool', arg: 'curve' });

  let asked;
  ctx.ai = { text: async (req) => ((asked = req), 'Draw the path with the Curve tool, then Sweep [1].') };
  const r = await reg.run('ask_help', { question: 'how do I sweep a kerb along a curve' });
  assert.match(asked.text, /\[1\] Run a kerb along a curve/);
  assert.match(asked.system, /Plumb/);
  assert.deepEqual(r.cited, [1]);
  // F1 over a tool asks about that tool
  const f1 = await reg.run('ask_help', { question: 'How do I use the Trim tool?', tool: 'trim' });
  assert.deepEqual(f1.show, { kind: 'tool', arg: 'trim' });
  assert.ok(f1.sources.some((s) => s.id === 'pdf-linework-to-3d'), 'the pages that use the tool are read');
});

test('splitSections and showMe', () => {
  const s = HA.splitSections('# T\n\nIntro text\n\n## In the app\n\n1. Click\n![x](a.jpg)\n\n## Good to know\n\nMore');
  assert.deepEqual(s.map((x) => x.heading), ['Intro', 'In the app', 'Good to know']);
  assert.ok(!s[1].text.includes('a.jpg'));
  assert.deepEqual(HA.showMe({ sections: [{ id: 'work-faster' }], commands: [] }), { kind: 'guide', arg: 'work-faster' });
  assert.deepEqual(HA.showMe({ sections: [], commands: [{ name: 'cut_fill' }] }), { kind: 'do', arg: 'cut_fill' });
});
