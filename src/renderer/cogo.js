// The COGO panel (#228): survey calculations whose answer and preview in the view update as you type. Points come from
// the model's names or a click in the view; Store adds the new points in one undo step; every answer goes into a report
// to copy. The maths is core/cogo.js (the commands the AI calls use the same); storing goes through those commands.
import * as THREE from 'three';
import * as CG from '../core/cogo.js';
import * as S from '../core/survey.js';
import { readAngle, readNumber } from '../core/fields.js';
import { h, icon, surveyViews } from './ui.js';
import { buildForm } from './forms.js';

const CALCS = [
  { id: 'inverse', label: 'Inverse', icon: 'ruler', cmd: 'cogo_inverse', hint: 'Bearing, distance and grade between points.' },
  { id: 'traverse', label: 'Traverse', icon: 'path', cmd: 'cogo_traverse', store: true, hint: 'New points from directions and distances. Enter adds the next leg.' },
  { id: 'intersect', label: 'Intersect', icon: 'intersect', cmd: 'cogo_intersect', store: true, hint: 'A new point where bearings, distances or lines meet.' },
  { id: 'station_offset', label: 'Station', icon: 'arrows-split', cmd: 'cogo_station_offset', hint: 'How far along a line a point is, and how far right or left.' },
  { id: 'offset_point', label: 'Offset point', icon: 'map-pin-line', cmd: 'cogo_offset_point', store: true, hint: 'A new point at a station and offset along a line.' },
  { id: 'curve', label: 'Curve', icon: 'bezier-curve', cmd: 'cogo_curve', hint: 'Type any two parts of a curve; the rest follows.' },
  { id: 'area', label: 'Area', icon: 'polygon', cmd: 'cogo_area', hint: 'Area and perimeter of a parcel through its corners, in order.' },
];
const PREVIEW = 0x2f6f86;
const NEW = 0xc8553d;

export class CogoPanel {
  constructor(app) {
    this.app = app;
    this.calc = CALCS[0];
    this.log = [];
    this.group = new THREE.Group();
    this.group.renderOrder = 999;
    this.answer = h('div.cogo-answer', { role: 'status', 'aria-live': 'polite' });
    this.storeBtn = h('button.btn.primary', { onclick: () => this.store(), title: 'Store the new point(s) (Ctrl+Enter)' }, icon('check-circle'), 'Store');
    this.body = h('div.cogo-body');
    this.logEl = h('div.cogo-log', { role: 'log', 'aria-label': 'COGO report' });
    this.calcs = h('div.cogo-calcs', { role: 'radiogroup', 'aria-label': 'Calculation' });
    this.el = h(
      'div.panel.cogo',
      { onkeydown: (e) => e.key === 'Enter' && e.ctrlKey && (e.preventDefault(), this.calc.store && this.store()) },
      surveyViews({ show: (t) => app.ui.show(t) }, 'cogo'),
      this.calcs,
      this.body,
      h('div.card.cogo-result', {}, this.answer, h('div.row', {}, h('span.grow'), h('button.btn.sm', { onclick: () => this.copy(this.current?.report), title: 'Copy the answer' }, icon('copy'), 'Copy'), this.storeBtn)),
      h('div.row', {}, h('h3.grow', {}, 'Report'), h('button.icon-btn.sm', { title: 'Copy the report', 'aria-label': 'Copy the report', onclick: () => this.copy(this.log.join('\n\n')) }, icon('copy')), h('button.icon-btn.sm', { title: 'Clear the report', 'aria-label': 'Clear the report', onclick: () => ((this.log = []), this.drawLog()) }, icon('trash'))),
      this.logEl,
    );
    this.el.addEventListener('input', () => this.later());
    this.el.addEventListener('change', () => this.later());
    this.el.addEventListener('click', (e) => e.target.closest('.form-modes') && this.later());
    this.choose(this.calc.id);
    this.drawLog();
  }

  /** Into the dock (kept between renders, so what is typed stays). */
  mount(body) {
    if (body.firstChild !== this.el) body.replaceChildren(this.el);
    if (!this.group.parent) this.app.viewport.scene.add(this.group);
    if (this.names !== this.pointNames()) this.choose(this.calc.id, this.typed()); // new points: fresh lists, what was typed kept
    else this.update();
  }
  pointNames() {
    return S.points(this.app.store.doc).map((p) => p.name).join('\n');
  }
  typed() {
    try {
      return this.form.read({ quiet: true });
    } catch {
      return {};
    }
  }
  /** Out of the dock: the preview goes too. */
  unmount() {
    this.clearPreview();
    this.group.removeFromParent();
    this.app.viewport.dirty = true;
  }

  choose(id, preset = {}) {
    this.calc = CALCS.find((c) => c.id === id) || CALCS[0];
    this.calcs.replaceChildren(...CALCS.map((c) => h('button.cogo-calc', { type: 'button', role: 'radio', 'aria-checked': String(c === this.calc), title: c.hint, onclick: () => this.choose(c.id) }, icon(c.icon), h('span', {}, c.label))));
    this.storeBtn.hidden = !this.calc.store;
    const pick = (n, hint) => this.app.tools.pickPoints(n, hint).then((pts) => pts.map((p) => p.toArray()));
    if (this.calc.id === 'traverse') this.form = this.traverseForm(preset);
    else {
      const c = this.app.reg.commands.get(this.calc.cmd);
      this.form = buildForm(this.app, c, preset, { pick });
    }
    this.names = this.pointNames();
    this.body.replaceChildren(h('p.small.muted', {}, this.calc.hint), this.form.el);
    this.update();
  }

  /** The traverse: a start, an optional backsight, and a table of legs that grows as you press Enter. */
  traverseForm(preset = {}) {
    const doc = this.app.store.doc;
    const list = `cogo-points-${Date.now()}`;
    const names = S.points(doc).slice(0, 2000);
    const ptInput = (label, value, ph) => h('label.field', {}, h('span', {}, label), h('input', { value: value || '', list, placeholder: ph, 'aria-label': label }));
    const from = ptInput('Start at', preset.from ?? names.at(-1)?.name, names[0] ? `e.g. ${names[0].name}` : 'a point name');
    const back = ptInput('Backsight (for turns)', preset.backsight, 'a point, or a bearing you arrive with');
    const close = ptInput('Closes on (optional)', preset.close_to, 'the point it should end on');
    const adjust = h('input', { type: 'checkbox', checked: preset.adjust === 'compass' });
    const code = h('input', { value: preset.code || '', placeholder: 'e.g. TRAV', 'aria-label': 'Code for the new points' });
    const rows = h('tbody');
    const row = (l = {}) => {
      const dir = h('input.cogo-dir', { value: l.direction ?? '', placeholder: rows.children.length ? 'N45E, 90, R90' : 'N45°30\'E or 45.5', 'aria-label': 'Direction' });
      const dist = h('input.form-num', { value: l.distance ?? '', inputmode: 'decimal', placeholder: '0.000', 'aria-label': 'Distance' });
      const dz = h('input.form-num', { value: l.dz ?? '', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Height difference' });
      const side = h('input', { type: 'checkbox', checked: !!l.side, title: 'Sideshot: measure from here without moving on', 'aria-label': 'Sideshot' });
      const tr = h('tr', {}, h('td.muted', {}, ''), h('td', {}, dir), h('td', {}, dist), h('td', {}, dz), h('td', {}, side), h('td', {}, h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Remove this leg', onclick: () => (tr.remove(), number(), this.later()) }, icon('x'))));
      const next = (e) => {
        if (e.key !== 'Enter' || e.ctrlKey) return;
        e.preventDefault();
        if (tr === rows.lastElementChild && dir.value.trim() && dist.value.trim()) rows.append(row());
        number();
        (tr.nextElementSibling?.querySelector('.cogo-dir') || dir).focus();
      };
      dist.onkeydown = next;
      dz.onkeydown = next;
      dir.onkeydown = (e) => void (e.key === 'Enter' && !e.ctrlKey && (e.preventDefault(), dist.focus()));
      dir.oninput = () => dir.setAttribute('aria-invalid', String(!!(dir.value.trim() && readAngle(dir.value).error)));
      tr.read = () => {
        if (!dir.value.trim() && !dist.value.trim()) return null;
        const d = readAngle(dir.value);
        if (d.error || d.value === undefined) throw new Error(d.error || 'A leg needs a direction.');
        const n = readNumber(dist.value, { minimum: 0 });
        if (n.error || n.value === undefined) throw new Error(n.error || 'A leg needs a distance.');
        const z = readNumber(dz.value);
        return { direction: d.value, distance: n.value, ...(z.value ? { dz: z.value } : {}), ...(side.checked ? { side: true } : {}) };
      };
      return tr;
    };
    const number = () => [...rows.children].forEach((tr, i) => (tr.firstChild.textContent = String(i + 1)));
    for (const l of preset.legs || []) rows.append(row(l));
    rows.append(row());
    number();
    const val = (lbl) => lbl.querySelector('input').value.trim();
    const el = h(
      'div.cmd-form.cogo-trav',
      {},
      h('datalist', { id: list }, names.map((p) => h('option', { value: p.name }, p.point?.code || ''))),
      h('div.form-row', {}, from, back),
      h('div.qty', {}, h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Direction', 'Distance', 'dz', 'Side', ''].map((c) => h('th', {}, c)))), rows)),
      h('div.form-row', {}, close, h('label.field', {}, h('span', {}, 'Code'), code)),
      h('label.check', {}, adjust, h('span', {}, 'Spread the misclosure (compass rule)')),
    );
    return {
      el,
      read() {
        const legs = [...rows.children].map((tr) => tr.read()).filter(Boolean);
        if (!val(from)) throw new Error('Start at a point.');
        if (!legs.length) throw new Error('Type a direction and a distance.');
        return { from: val(from), legs, ...(val(back) ? { backsight: val(back) } : {}), ...(val(close) ? { close_to: val(close), adjust: adjust.checked ? 'compass' : 'none' } : {}), ...(code.value.trim() ? { code: code.value.trim() } : {}) };
      },
    };
  }

  later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), 120);
  }

  /** Solve what is typed so far: the answer, and lines and new points in the view. */
  update() {
    let sol = null;
    let why = '';
    try {
      const args = this.form.read({ quiet: true });
      sol = CG.solve(this.app.store.doc, this.calc.id, args);
      this.args = args;
    } catch (e) {
      why = e.message;
    }
    this.current = sol;
    this.storeBtn.disabled = !sol?.points?.length;
    this.storeBtn.lastChild.textContent = sol?.points?.length > 1 ? `Store ${sol.points.length} points` : 'Store point';
    const u = S.geo(this.app.store.doc).units || 'm';
    this.answer.replaceChildren(...(sol ? [h('div.cogo-facts', {}, ...CG.facts(this.calc.id, sol.result, u).map(([k, v]) => h('div.cogo-fact', {}, h('span.overline', {}, k), h('b', {}, String(v))))), h('details.cogo-lines', { open: this.linesOpen, ontoggle: (e) => (this.linesOpen = e.target.open) }, h('summary.small', {}, 'Details'), ...sol.report.split('\n').map((l) => h('div.cogo-line.small', {}, l)))] : [h('div.muted.small', {}, / is needed\.$/.test(why) ? `Fill in ${why.replace(/ is needed\.$/, '').toLowerCase()} to see the answer.` : why.replace(/^\w[\w ]*: /, '') || 'Fill in the fields to see the answer.')]));
    this.preview(sol);
  }

  preview(sol) {
    this.clearPreview();
    const doc = this.app.store.doc;
    const at = (p) => new THREE.Vector3(...S.toLocal(doc, { n: p.n, e: p.e, z: p.z ?? 0 }));
    for (const line of sol?.lines || []) {
      if (line.length < 2) continue;
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line.map(at)), new THREE.LineDashedMaterial({ color: PREVIEW, dashSize: 0.6, gapSize: 0.3, depthTest: false }));
      l.computeLineDistances();
      l.renderOrder = 999;
      this.group.add(l);
    }
    if (sol?.points?.length) {
      const g = new THREE.BufferGeometry().setFromPoints(sol.points.map(at));
      const p = new THREE.Points(g, new THREE.PointsMaterial({ color: NEW, size: 10, sizeAttenuation: false, depthTest: false }));
      p.renderOrder = 1000;
      this.group.add(p);
    }
    this.app.viewport.dirty = true;
  }
  clearPreview() {
    for (const o of this.group.children) o.geometry?.dispose(), o.material?.dispose();
    this.group.clear();
  }

  async store() {
    if (!this.current?.points?.length) return;
    try {
      const r = await this.app.reg.run(this.calc.cmd, this.args);
      const names = (r.stored || []).map((p) => p.name);
      this.app.ui.toast(`Stored ${names.length === 1 ? `point ${names[0]}` : `${names.length} points: ${names.join(', ')}`}`);
      this.record(r.report, names);
      this.choose(this.calc.id, this.calc.id === 'traverse' ? { from: names.at(-1) } : this.args); // the new names in the lists
    } catch (e) {
      this.app.ui.toast(e.message, 'danger');
    }
  }
  record(report, stored = []) {
    if (!report) return;
    this.log.unshift(`${this.calc.label}${stored.length ? ` → stored ${stored.join(', ')}` : ''}\n${report}`);
    this.drawLog();
  }
  drawLog() {
    this.logEl.replaceChildren(...(this.log.length ? this.log.map((t) => h('pre.cogo-entry', {}, t)) : [h('p.small.muted', {}, 'Stored answers are listed here. Copy them into a field book or an e-mail.')]));
  }
  copy(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => this.app.ui.toast('Copied.'));
    if (text === this.current?.report && !this.calc.store) this.record(text);
  }
}
