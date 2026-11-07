// #158: the help pages break loudly when the app changes under them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCtx } from './helpers.js';
import { HOWTOS, AREAS, findHowtos } from '../src/core/howto.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs', 'how-to');
const ui = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'ui.js'), 'utf8');
const tools = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'tools.js'), 'utf8');
// plugin commands live in the renderer, not in the core registry
const PLUGIN = new Set(['create_stairs', 'create_wall']);

test('every page exists, sits in a known area, and names only real commands, tools, actions and pages', () => {
  const { reg } = makeCtx();
  const names = new Set(reg.list().map((c) => c.name));
  for (const h of HOWTOS) {
    assert.ok(AREAS.includes(h.area), `${h.id}: area ${h.area}`);
    const md = fs.readFileSync(path.join(DOCS, `${h.id}.md`), 'utf8');
    for (const c of h.commands) assert.ok(names.has(c) || PLUGIN.has(c), `${h.id}: command ${c}`);
    for (const t of h.tools) assert.match(tools, new RegExp(`id: '${t}'`), `${h.id}: tool ${t}`);
    for (const [, c] of md.matchAll(/api\.([a-z_]+)\(/g)) assert.ok(names.has(c) || PLUGIN.has(c), `${h.id}: api.${c} in its code`);
    for (const [, kind, arg] of md.matchAll(/\]\((action|tool|do|howto):([\w-]+)\)/g)) {
      if (kind === 'action') assert.match(ui, new RegExp(`\\b${arg}: \\{ label`), `${h.id}: action ${arg}`);
      if (kind === 'tool') assert.match(tools, new RegExp(`id: '${arg}'`), `${h.id}: tool ${arg}`);
      if (kind === 'do') assert.ok(names.has(arg), `${h.id}: do:${arg}`);
      if (kind === 'howto') assert.ok(HOWTOS.some((x) => x.id === arg), `${h.id}: howto:${arg}`);
    }
    for (const [, src] of md.matchAll(/!\[[^\]]*\]\((media\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(DOCS, src)), `${h.id}: ${src} is missing (run scripts/docs-media.mjs)`);
    assert.ok(!h.video || /\.mp4\)/.test(md), `${h.id}: animation pages show their video`);
  }
});

test('search by intent finds the right page', async () => {
  assert.equal(findHowtos('how do I georeference a pdf')[0].id, 'put-a-pdf-in-place');
  assert.equal(findHowtos('cut and fill volumes')[0].id, 'cut-and-fill-for-a-pad');
  assert.equal(findHowtos('door hinge animation')[0].id, 'hinge-a-door');
  assert.equal(findHowtos('open an ifc file')[0].id, 'bring-in-landxml-ifc-dxf');
  const { reg } = makeCtx();
  assert.equal((await reg.run('list_howtos', { query: 'export to ifc' }))[0].id, 'share-with-bim-tools');
  const page = await reg.run('open_howto', { id: 'hinge-a-door' });
  assert.equal(page.title, 'Hinge a door and animate it opening');
});
