// Pick first (#234) and the Tool tab (#235): a command with point arguments starts in the view. A cursor tip names
// what to pick and takes typed values (x, y, z · @dx, dy, dz · a distance along the rubber band); the optional
// arguments wait in the side panel's Tool tab, remembered per command. After the last point the command runs (one
// undo step). The modal form stays one click away. Generic: the steps come from the schema (fields.pickSteps).
import * as THREE from 'three';
import { h, icon } from './ui.js';
import { buildForm, human } from './forms.js';
import { pickSteps, readTyped } from '../core/fields.js';

const KEY = 'mymodellerreel.toolOptions';
const SNAP = 0.25; // m: a pick this close to a named point uses its name, as the form does
const r3 = (p) => p.map((x) => Math.round(x * 1000) / 1000);
const loadAll = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
};

export class PickFirst {
  constructor(app) {
    this.app = app;
    this.s = null;
    this.mouse = { clientX: innerWidth / 2, clientY: innerHeight / 2 }; // where the tip first shows
    addEventListener('pointermove', (e) => (this.mouse = { clientX: e.clientX, clientY: e.clientY }), true);
  }
  get active() {
    return !!this.s;
  }

  /** Pick the points of command name in the view, then run it. Resolves with its result (undefined: cancelled). */
  start(name, preset = {}) {
    this.stop();
    const app = this.app;
    const c = app.reg.commands.get(name);
    const steps = pickSteps(c.params, preset);
    // the Tool tab: the command without what is picked and without modes (the full form has those)
    const picked = new Set([...steps.map((st) => st.key), ...(c.params.ui?.modes || []).flatMap((m) => m.fields)]);
    const props = Object.fromEntries(Object.entries(c.params.properties || {}).filter(([k]) => !picked.has(k)));
    const opts = { ...c, params: { ...c.params, properties: props, required: (c.params.required || []).filter((k) => props[k]), ui: undefined } };
    const saved = loadAll()[name] || {};
    const form = buildForm(app, opts, { ...saved, ...preset });
    const title = c.title || human(name);
    return new Promise((resolve) => {
      const s = (this.s = { name, c, steps, form, preset, title, pts: [], hover: null, resolve });
      s.err = h('div.form-error.form-top', { role: 'alert' });
      s.prompt = h('p.pick-prompt', {});
      s.panel = h(
        'div.panel.form.tool-panel',
        {},
        h('h3', {}, icon('crosshair'), ' ', title),
        s.prompt,
        s.err,
        Object.keys(props).length ? form.el : h('p.small.muted', {}, 'No options.'),
        h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: () => this.finish() }, icon('play'), 'Run'), h('button.btn', { type: 'button', title: 'Every argument in a form', onclick: () => this.toForm() }, icon('textbox'), 'Form'), h('button.btn', { type: 'button', onclick: () => this.cancel() }, 'Cancel')),
      );
      // the cursor tip: what to pick, and a box for typed values (Tab between x, y, z)
      s.inputs = ['x', 'y', 'z'].map((a) => h('input.pick-in', { 'aria-label': a, placeholder: a, autocomplete: 'off', spellcheck: false, onkeydown: (e) => this.typedKey(e) }));
      s.msg = h('div.pick-msg', { role: 'alert' });
      s.tipText = h('div.pick-what', {});
      s.tip = h('div.pick-tip', { role: 'dialog', 'aria-label': title }, s.tipText, h('div.pick-ins', {}, ...s.inputs, h('button.btn.sm', { type: 'button', title: 'Every argument in a form', onclick: () => this.toForm() }, 'Form')), s.msg);
      document.body.append(s.tip);
      this.place(this.mouse);
      s.prevTab = app.ui.tab;
      app.ui.toolTab(true);
      this.changed([]);
      this.pick();
    });
  }

  /** The picking itself: one pickPoints for every step. */
  async pick() {
    const s = this.s;
    const total = s.steps.some((st) => st.count === Infinity) ? 0 : s.steps.reduce((n, st) => n + st.count, 0);
    const pts = await this.app.tools.pickPoints(total, this.what(0), this);
    if (this.s !== s || s.leaving) return;
    s.tip.hidden = true;
    if (!this.enough(pts)) return this.end(undefined);
    s.pts = pts;
    this.finish();
  }

  // ---- what the pick tool asks (tools.js PickTool)
  hover(p, ev) {
    const s = this.s;
    s.hover = p.toArray();
    if (s.inputs.includes(document.activeElement)) return; // typing: the box stays put
    s.inputs.forEach((x, i) => (x.placeholder = String(Math.round(s.hover[i] * 100) / 100)));
    this.place(ev);
  }
  /** The tip just below and right of the cursor, inside the view (the side panel stays clear). */
  place(ev) {
    const s = this.s;
    const r = s.tip.getBoundingClientRect();
    const v = this.app.viewport.canvas.parentElement.getBoundingClientRect();
    s.tip.style.left = `${Math.max(v.left + 8, Math.min(ev.clientX + 18, v.right - r.width - 8))}px`;
    s.tip.style.top = `${Math.max(v.top + 8, Math.min(ev.clientY + 22, v.bottom - r.height - 8))}px`;
  }
  accept(p, i) {
    const st = this.stepAt(i);
    if (st?.names && Array.isArray(this.value(p))) return (this.s.msg.textContent = 'Click on a survey point.'), false;
    return true;
  }
  changed(pts) {
    const s = this.s;
    s.pts = pts;
    s.msg.textContent = '';
    const w = this.what(pts.length);
    s.tipText.textContent = w;
    s.prompt.textContent = w;
    this.app.tools.status(w);
  }
  enough(pts) {
    return pts.length >= this.s.steps.reduce((n, st) => n + (st.count === Infinity ? 2 : st.count), 0);
  }

  /** The step the i-th point is for, and the words for it. */
  stepAt(i) {
    for (const st of this.s.steps) {
      if (i < st.count) return { ...st, i };
      i -= st.count;
    }
    return null;
  }
  what(i) {
    const st = this.stepAt(i);
    const typed = i ? 'type x, y, z, @dx, dy, dz or a distance' : 'type x, y, z';
    if (!st) return 'Enter to run, Esc to step back.';
    const label = human(st.key);
    if (!st.many) return `${label}: pick it, or ${typed}. Esc steps back.`;
    const of = st.count === Infinity ? `${st.i + 1}` : `${st.i + 1} of ${st.count}`;
    return `${label} (${of}): pick a point, or ${typed}.${st.count === Infinity && st.i >= 2 ? ' Enter when done.' : ''} Esc steps back.`;
  }

  /** A picked spot as the command takes it: the named point there, else its coordinates. */
  value(p) {
    const a = p.toArray();
    const pt = this.app.store.doc.entities.find((e) => e.type === 'point' && Math.hypot(...e.position.map((x, i) => x - a[i])) < SNAP);
    return pt?.name || r3(a);
  }
  /** The picked points as arguments: each step its key. */
  pickedArgs() {
    const s = this.s;
    const out = {};
    let i = 0;
    for (const st of s.steps) {
      const vals = s.pts.slice(i, st.count === Infinity ? undefined : i + st.count).map((p) => this.value(p));
      i += vals.length;
      if (vals.length) out[st.key] = st.many ? vals : vals[0];
    }
    return out;
  }

  // ---- the typed-value box
  typedKey(e) {
    const s = this.s;
    e.stopPropagation();
    const text = s.inputs.map((x) => x.value.trim()).filter(Boolean).join(', ');
    const tool = this.app.tools.tool;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!text) return tool?.finish?.();
      const last = s.pts.at(-1);
      const r = readTyped(text, { from: last ? last.toArray() : null, toward: s.hover });
      if (r.error) return (s.msg.textContent = r.error);
      s.inputs.forEach((x) => (x.value = ''));
      s.inputs[0].focus();
      tool?.add?.(new THREE.Vector3(...r.value));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (text) return s.inputs.forEach((x) => (x.value = ''));
      s.inputs.forEach((x) => x.blur());
      tool?.key?.(e);
    }
  }
  /** A number, @ or minus typed over the view goes to the box (app.js). */
  typeKey(ev) {
    const s = this.s;
    if (!s || s.tip.hidden || ev.ctrlKey || ev.metaKey || ev.altKey || !/^[0-9.,@＠\-−]$/.test(ev.key)) return false;
    s.inputs[0].focus();
    s.inputs[0].value += ev.key;
    return true;
  }

  // ---- ending
  /** Run with the points picked and the Tool tab's options; on an error the tab stays with the message. */
  async finish() {
    const s = this.s;
    if (!s) return;
    if (this.app.tools.id === 'pick' && !s.tip.hidden) return this.app.tools.tool.finish(); // still picking: Enter
    s.err.textContent = '';
    try {
      const opts = s.form.read();
      const r = await this.app.reg.run(s.name, { ...s.preset, ...opts, ...this.pickedArgs() });
      const { name: _n, ...keep } = opts; // the name is for one thing, not every next one
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...loadAll(), [s.name]: keep }));
      } catch {}
      this.app.ui.toast(r?.name ? `${s.title}: ${r.name}` : `${s.title}: done`);
      this.end(r);
    } catch (e) {
      s.err.textContent = e.message;
      this.app.ui.show('tool');
    }
  }
  /** The last resort: the modal form with what is picked and typed so far. */
  async toForm() {
    const s = this.s;
    if (!s) return;
    let opts = {};
    try {
      opts = s.form.read({ quiet: true });
    } catch {}
    const preset = { ...s.preset, ...opts, ...this.pickedArgs() };
    this.end(undefined, false);
    s.resolve(await this.app.ui.commandDialog(s.name, preset, { form: true }));
  }
  cancel() {
    if (this.s) this.end(undefined);
  }
  stop() {
    this.cancel();
  }
  end(result, resolve = true) {
    const s = this.s;
    if (!s) return;
    s.leaving = true;
    this.s = null;
    s.tip.remove();
    if (this.app.tools.id === 'pick') this.app.tools.set('select');
    this.app.ui.toolTab(false, s.prevTab);
    if (resolve) s.resolve(result);
  }
  /** The Tool tab's content. */
  panel() {
    return this.s?.panel || h('p.small.muted', {}, 'Run a command with points to pick, such as Design: trench.');
  }
}
