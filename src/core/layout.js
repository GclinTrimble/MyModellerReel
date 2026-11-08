// Multiple views (#160, #161): where the 1 to 4 panes sit in the view area, and the bars that resize them. Pure maths;
// the renderer turns the rectangles (fractions of the area, 0–1 from the left and top) into canvases.

export const ARRANGEMENTS = ['columns', 'rows', 'grid', 'main_left', 'main_right', 'main_top', 'main_bottom'];
export const ROAD_VIEWS = ['profile', 'section']; // 2D drawings of a corridor (#167, #168)
export const VIEWS = ['perspective', 'top', 'front', 'back', 'left', 'right', 'bottom', 'iso', ...ROAD_VIEWS];
export const MAX_PANES = 4;

/** What a new pane shows: 3D first, then the plan and two elevations, like a drafting quad view. */
export const DEFAULT_PANES = [
  { view: 'perspective', projection: 'perspective' },
  { view: 'top', projection: 'parallel' },
  { view: 'front', projection: 'parallel' },
  { view: 'right', projection: 'parallel' },
];

const clamp = (x, lo = 0.15, hi = 0.85) => Math.min(hi, Math.max(lo, x));

/** A layout with defaults filled in: { count, arrangement, split: [x, y], panes: [...], max }. */
export function normalize(layout = {}) {
  const count = Math.min(MAX_PANES, Math.max(1, Math.round(layout.count || layout.panes?.length || 1)));
  let arrangement = ARRANGEMENTS.includes(layout.arrangement) ? layout.arrangement : count === 4 ? 'grid' : count === 3 ? 'main_left' : 'columns';
  if (arrangement === 'grid' && count < 3) arrangement = 'columns';
  const main = arrangement.startsWith('main_');
  const split = [0, 1].map((i) => clamp(layout.split?.[i] ?? (main && (i === 0) === /left|right/.test(arrangement) ? 0.6 : 0.5)));
  const panes = Array.from({ length: count }, (_, i) => ({ ...DEFAULT_PANES[i], ...(layout.panes?.[i] || {}) }));
  const max = Number.isInteger(layout.max) && layout.max >= 0 && layout.max < count ? layout.max : null;
  const out = { count, arrangement, split, panes, max };
  if (layout.station !== undefined) out.station = layout.station; // where the section panes cut the road
  return out;
}

const even = (n, i) => [i / n, (i + 1) / n];

/** Each pane's rectangle { x, y, w, h } (fractions). A maximised pane fills the area; the others get none. */
export function paneRects(layout) {
  const { count: n, arrangement: a, split: [sx, sy], max } = normalize(layout);
  if (max !== null) return Array.from({ length: n }, (_, i) => (i === max ? { x: 0, y: 0, w: 1, h: 1 } : null));
  if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  const r = (x0, x1, y0, y1) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  if (a === 'columns') return Array.from({ length: n }, (_, i) => (n === 2 ? r(...(i ? [sx, 1] : [0, sx]), 0, 1) : r(...even(n, i), 0, 1)));
  if (a === 'rows') return Array.from({ length: n }, (_, i) => (n === 2 ? r(0, 1, ...(i ? [sy, 1] : [0, sy])) : r(0, 1, ...even(n, i))));
  if (a === 'grid') {
    const cells = [r(0, sx, 0, sy), r(sx, 1, 0, sy), r(0, sx, sy, 1), r(sx, 1, sy, 1)];
    if (n === 3) cells[2] = r(0, 1, sy, 1); // three: two on top, one wide below
    return cells.slice(0, n);
  }
  // one big pane, the others shared along the opposite side
  const rest = n - 1;
  const out = [];
  if (a === 'main_left') out.push(r(0, sx, 0, 1), ...Array.from({ length: rest }, (_, i) => r(sx, 1, ...even(rest, i))));
  if (a === 'main_right') out.push(r(1 - sx, 1, 0, 1), ...Array.from({ length: rest }, (_, i) => r(0, 1 - sx, ...even(rest, i))));
  if (a === 'main_top') out.push(r(0, 1, 0, sy), ...Array.from({ length: rest }, (_, i) => r(...even(rest, i), sy, 1)));
  if (a === 'main_bottom') out.push(r(0, 1, 1 - sy, 1), ...Array.from({ length: rest }, (_, i) => r(...even(rest, i), 0, 1 - sy)));
  return out;
}

/**
 * The bars you drag to resize: { axis: 'x' | 'y', at, from, to, sign } — a vertical bar (axis x) at x = at from y = from to
 * to, moving split[0]; sign -1 when dragging right makes the split smaller (main pane on the right / bottom).
 */
export function splitters(layout) {
  const { count: n, arrangement: a, split: [sx, sy], max } = normalize(layout);
  if (max !== null || n === 1) return [];
  if (a === 'columns') return n === 2 ? [{ axis: 'x', at: sx, from: 0, to: 1, sign: 1 }] : [];
  if (a === 'rows') return n === 2 ? [{ axis: 'y', at: sy, from: 0, to: 1, sign: 1 }] : [];
  if (a === 'grid') return [{ axis: 'x', at: sx, from: 0, to: n === 3 ? sy : 1, sign: 1 }, { axis: 'y', at: sy, from: 0, to: 1, sign: 1 }];
  if (a === 'main_left') return [{ axis: 'x', at: sx, from: 0, to: 1, sign: 1 }];
  if (a === 'main_right') return [{ axis: 'x', at: 1 - sx, from: 0, to: 1, sign: -1 }];
  if (a === 'main_top') return [{ axis: 'y', at: sy, from: 0, to: 1, sign: 1 }];
  return [{ axis: 'y', at: 1 - sy, from: 0, to: 1, sign: -1 }];
}

/** The split after dragging a bar to a position (fraction along its axis). */
export function dragSplit(layout, bar, pos) {
  const l = normalize(layout);
  const i = bar.axis === 'x' ? 0 : 1;
  l.split[i] = clamp(bar.sign > 0 ? pos : 1 - pos);
  return l.split;
}

/** The camera direction (from the target to the eye) of a standard view, or null for a free perspective view. */
export function viewDirection(view) {
  return { top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], iso: [1, 0.8, 1] }[view] || null;
}
