// Ties: a curve (or mesh) vertex placed on a survey point stays on it. e.ties = [{ vertex, point, at }], at = the
// vertex's world position after the last sync. syncTies runs after every change (before the derived rebuild, so a
// surface using the line as a breakline follows): a point that moved pulls its vertex along; a vertex that was
// moved by an edit (it is no longer where the tie left it, nor on its point) lets go; a deleted point drops the tie
// and the vertex stays where it is.
import { Vector3, Matrix4 } from 'three';
import * as D from './document.js';
import * as R from './derived.js';

const EPS = 1e-4;
const verts = (e) => e.curve?.points || e.mesh?.v;
const pointWorld = (doc, p) => new Vector3().applyMatrix4(D.worldMatrix(doc, p));
const vertexWorld = (doc, e, k) => new Vector3(...verts(e)[k]).applyMatrix4(D.worldMatrix(doc, e));
const isPoint = (x) => x?.type === 'point';

/** What can be tied: curves and meshes, not annotations (their points are worked out) or linework (already on points). */
export function canTie(e) {
  return !!e && !e.annotation && !!verts(e);
}

/** Tie vertex k of e to point p (ids or entities). The vertex goes onto the point at the next sync. */
export function tie(doc, e, k, p) {
  if (!canTie(e)) throw new Error(`${e?.name || 'That'} has no vertices to tie (curves and shapes do).`);
  if (!Number.isInteger(k) || !verts(e)[k]) throw new Error(`${e.name} has vertices 0…${verts(e).length - 1}.`);
  if (!isPoint(p)) throw new Error('Ties go to survey points.');
  e.ties = [...(e.ties || []).filter((t) => t.vertex !== k), { vertex: k, point: p.id, at: vertexWorld(doc, e, k).toArray() }];
  return e.ties;
}

/** Drop the tie on vertex k (all of e's ties without k). Returns how many were dropped. */
export function untie(e, k) {
  const n = e.ties?.length || 0;
  e.ties = k === undefined ? [] : (e.ties || []).filter((t) => t.vertex !== k);
  const dropped = n - e.ties.length;
  if (!e.ties.length) delete e.ties;
  return dropped;
}

/** Every tie in the model (or of one entity), with names, for list_ties. */
export function listTies(doc, only = null) {
  const out = [];
  for (const e of doc.entities)
    if (e.ties && (!only || e.id === only.id))
      for (const t of e.ties) {
        const p = D.getEntity(doc, t.point);
        out.push({ id: e.id, name: e.name, vertex: t.vertex, point: t.point, point_name: p?.name, code: p?.point?.code || '' });
      }
  return out;
}

/** Bring every tied vertex up to date with its point (after every change). */
export function syncTies(doc) {
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  for (const e of doc.entities) {
    if (!e.ties) continue;
    const keep = [];
    for (const t of e.ties) {
      const p = byId.get(t.point);
      if (!isPoint(p) || !verts(e)?.[t.vertex]) continue; // the point (or the vertex) is gone: the vertex stays put
      const w = vertexWorld(doc, e, t.vertex);
      const to = pointWorld(doc, p);
      const edited = t.at && w.distanceTo(new Vector3(...t.at)) > EPS;
      if (w.distanceTo(to) > EPS) {
        if (edited) continue; // moved off its point by hand: it lets go
        if (e.derived) R.bake(e); // a hand change to a recipe's mesh
        const local = to.clone().applyMatrix4(new Matrix4().copy(D.worldMatrix(doc, e)).invert());
        verts(e)[t.vertex] = D.round3(local.toArray());
      }
      keep.push({ ...t, at: D.round3(to.toArray()) });
    }
    if (keep.length) e.ties = keep;
    else delete e.ties;
  }
}

/** Ties in a list as given to a command ([{ vertex, point }], point an id or a name), checked and added. */
export function addTies(doc, e, list = []) {
  for (const t of list) {
    const p = D.getEntity(doc, t.point) || doc.entities.find((x) => isPoint(x) && x.name === String(t.point));
    if (!p) throw new Error(`No survey point "${t.point}".`);
    tie(doc, e, t.vertex, p);
  }
}

/** After a paste or a copy: ties follow the copied points (idMap old → new); without them they are dropped. */
export function remapTies(e, idMap) {
  if (!e.ties) return;
  e.ties = e.ties.filter((t) => idMap.has(t.point)).map((t) => ({ ...t, point: idMap.get(t.point), at: null }));
  if (!e.ties.length) delete e.ties;
}

/** Where tied curves would go if the entities in moved went by delta (a live preview of a drag): world polylines. */
export function previewTies(doc, moved, delta) {
  const set = new Set(moved);
  const out = [];
  for (const e of doc.entities) {
    if (!e.curve || !e.ties || set.has(e.id)) continue;
    const hit = e.ties.filter((t) => set.has(t.point));
    if (!hit.length) continue;
    const m = D.worldMatrix(doc, e);
    const pts = e.curve.points.map((p) => new Vector3(...p).applyMatrix4(m));
    for (const t of hit) if (pts[t.vertex]) pts[t.vertex] = pointWorld(doc, D.getEntity(doc, t.point)).add(new Vector3(...delta));
    out.push({ id: e.id, points: e.curve.closed ? [...pts, pts[0]] : pts });
  }
  return out;
}
