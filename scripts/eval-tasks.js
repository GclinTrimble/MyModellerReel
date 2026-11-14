// Eval tasks: a prompt, an optional starting scene, a score from the resulting scene (0..1), and a reference solution
// (the calls a good model would make; the "mock" model replays it, which also checks that every scorer can reach 1).
import fs from 'node:fs';
import * as D from '../src/core/document.js';
import { addScanCloud } from '../tests/fixtures/scancloud.js';
import { SITE, groundAt } from '../tests/fixtures/scan.js';

const ents = (doc) => doc.entities;
const size = (doc, e) => {
  const b = D.worldBox(doc, e);
  return b.max.map((x, k) => x - b.min[k]);
};
const close = (a, b, tol = 0.05) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const byName = (doc, re) => ents(doc).filter((e) => re.test(e.name));
const redish = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r > 150 && r > g * 1.5 && r > b * 1.5;
};
/** Score = share of checks that pass; notes name the failed ones. */
const checks = (list) => {
  const failed = list.filter(([, ok]) => !ok).map(([n]) => n);
  return { score: (list.length - failed.length) / list.length, failed };
};

export const TASKS = [
  {
    name: 'red-box',
    prompt: 'Create a red box 2 m wide, 1 m tall and 1 m deep.',
    check: (doc) => {
      const b = ents(doc).find((e) => e.mesh && close(size(doc, e)[0], 2) && close(size(doc, e)[1], 1) && close(size(doc, e)[2], 1));
      return checks([['one shape', ents(doc).length === 1], ['2 × 1 × 1 m', !!b], ['red', !!b && redish(b.material.color)], ['on the ground', !!b && close(D.worldBox(doc, b).min[1], 0)]]);
    },
    solution: [['create_box', { width: 2, height: 1, depth: 1, color: '#d03a2f' }]],
  },
  {
    name: 'sphere-on-box',
    prompt: 'There is a box called Plinth. Put a sphere of radius 0.5 m on top of it.',
    setup: [['create_box', { width: 1.2, height: 0.9, depth: 1.2, position: [3, 0, -2], name: 'Plinth' }]],
    check: (doc) => {
      const p = D.worldBox(doc, byName(doc, /plinth/i)[0]);
      const s = ents(doc).find((e) => e.mesh && e.mesh.f.length > 50);
      const b = s && D.worldBox(doc, s);
      return checks([['a sphere', !!s], ['radius 0.5', !!b && close(b.max[0] - b.min[0], 1)], ['resting on the plinth', !!b && close(b.min[1], p.max[1], 0.02)], ['over the plinth', !!b && close((b.min[0] + b.max[0]) / 2, 3, 0.1) && close((b.min[2] + b.max[2]) / 2, -2, 0.1)]]);
    },
    solution: [['create_sphere', { radius: 0.5, name: 'Ball' }], ['place_on', { ids: ['Ball'], target: 'Plinth' }]],
  },
  {
    name: 'column-row',
    prompt: 'Make a row of 5 cylindrical columns, 0.3 m radius and 3 m tall, spaced 2 m apart along x.',
    check: (doc) => {
      const cols = ents(doc).filter((e) => e.mesh && close(size(doc, e)[1], 3) && close(size(doc, e)[0], 0.6));
      const xs = cols.map((e) => D.worldBox(doc, e).min[0]).sort((a, b) => a - b);
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      return checks([['5 columns', cols.length === 5], ['2 m apart', gaps.length === 4 && gaps.every((g) => close(g, 2))], ['in one row', cols.every((e) => close(D.worldBox(doc, e).min[2], D.worldBox(doc, cols[0]).min[2]))]]);
    },
    solution: [['create_cylinder', { radius: 0.3, height: 3, name: 'Column' }], ['duplicate', { ids: ['Column'], offset: [2, 0, 0], count: 4 }]],
  },
  {
    name: 'table',
    prompt: 'Build a simple table: a 1.6 × 0.9 m top, 4 cm thick, its top surface at 75 cm, on four 5 cm square legs at the corners. Group it as "Table".',
    check: (doc) => {
      const g = byName(doc, /^table$/i)[0];
      const parts = g ? D.descendants(doc, g.id).filter((e) => e.mesh) : [];
      const top = parts.find((e) => close(size(doc, e)[0], 1.6, 0.05) && close(size(doc, e)[2], 0.9, 0.05));
      const legs = parts.filter((e) => e !== top && close(size(doc, e)[1], 0.71, 0.1));
      return checks([['a group named Table', !!g], ['a 1.6 × 0.9 top', !!top], ['top at 0.75 m', !!top && close(D.worldBox(doc, top).max[1], 0.75, 0.03)], ['four legs', legs.length === 4], ['legs on the floor', legs.length > 0 && legs.every((l) => close(D.worldBox(doc, l).min[1], 0, 0.02))]]);
    },
    solution: [
      ['create_box', { width: 1.6, height: 0.04, depth: 0.9, position: [0, 0.71, 0], name: 'Top' }],
      ['create_box', { width: 0.05, height: 0.71, depth: 0.05, position: [-0.75, 0, -0.4], name: 'Leg 1' }],
      ['create_box', { width: 0.05, height: 0.71, depth: 0.05, position: [0.75, 0, -0.4], name: 'Leg 2' }],
      ['create_box', { width: 0.05, height: 0.71, depth: 0.05, position: [0.75, 0, 0.4], name: 'Leg 3' }],
      ['create_box', { width: 0.05, height: 0.71, depth: 0.05, position: [-0.75, 0, 0.4], name: 'Leg 4' }],
      ['group', { ids: ['Top', 'Leg 1', 'Leg 2', 'Leg 3', 'Leg 4'], name: 'Table' }],
    ],
  },
  {
    name: 'slide-animation',
    prompt: 'Animate the box called Crate sliding 3 m along x over 2 seconds, starting at 0 s.',
    setup: [['create_box', { width: 1, height: 1, depth: 1, name: 'Crate' }]],
    check: (doc) => {
      const c = byName(doc, /crate/i)[0];
      const tr = doc.animation.tracks.find((t) => t.target === c?.id && t.property === 'position');
      const k = tr?.keys || [];
      return checks([['a position track', !!tr], ['starts at 0 s', k.length > 1 && close(k[0].t, 0)], ['ends at 2 s', k.length > 1 && close(k.at(-1).t, 2)], ['moves 3 m on x', k.length > 1 && close(k.at(-1).v[0] - k[0].v[0], 3)]]);
    },
    solution: [['animate', { target: 'Crate', property: 'position', by: [3, 0, 0], start: 0, end: 2 }]],
  },
  {
    name: 'hinged-door',
    prompt: 'The box "Door" is a door. Hinge it on its left side and animate it swinging open 90 degrees over 2 seconds.',
    setup: [['create_box', { width: 0.9, height: 2.1, depth: 0.05, name: 'Door' }]],
    check: (doc) => {
      const d = byName(doc, /door/i)[0];
      const tr = doc.animation.tracks.find((t) => t.target === d?.id && t.property === 'rotation');
      const turn = tr ? Math.abs(tr.keys.at(-1).v[1] - tr.keys[0].v[1]) : 0;
      const pivotX = d ? d.position[0] : 0;
      return checks([['a rotation track', !!tr], ['90° about y', close(turn, 90, 0.05)], ['hinged at the left edge', close(pivotX, -0.45, 0.05)], ['over 2 s', !!tr && close(tr.keys.at(-1).t - tr.keys[0].t, 2)]]);
    },
    solution: [['set_pivot', { id: 'Door', pivot: 'left' }], ['animate', { target: 'Door', property: 'rotation', by: [0, 90, 0], start: 0, end: 2 }]],
  },
  {
    name: 'align-distribute',
    prompt: 'Line up the three boxes A, B and C: align their fronts (z max) and space them evenly along x.',
    setup: [
      ['create_box', { width: 1, height: 1, depth: 1, position: [0, 0, 0.4], name: 'A' }],
      ['create_box', { width: 1, height: 1, depth: 2, position: [2.3, 0, -1], name: 'B' }],
      ['create_box', { width: 1, height: 1, depth: 1, position: [6, 0, 2], name: 'C' }],
    ],
    check: (doc) => {
      const bs = ['A', 'B', 'C'].map((n) => D.worldBox(doc, byName(doc, new RegExp(`^${n}$`))[0])).sort((a, b) => a.min[0] - b.min[0]);
      return checks([['fronts aligned', bs.every((b) => close(b.max[2], bs[0].max[2], 0.01))], ['even gaps', close(bs[1].min[0] - bs[0].max[0], bs[2].min[0] - bs[1].max[0], 0.02)]]);
    },
    solution: [['align', { ids: ['A', 'B', 'C'], axis: 'z', to: 'max' }], ['distribute', { ids: ['A', 'B', 'C'], axis: 'x' }]],
  },
  {
    name: 'tag-windows',
    prompt: 'Tag every shape whose name starts with "Window" with metadata role = window, then colour them light blue (#b8dbe2).',
    setup: [
      ['create_box', { width: 1, height: 1.2, depth: 0.1, name: 'Window 1' }],
      ['create_box', { width: 1, height: 1.2, depth: 0.1, position: [2, 0, 0], name: 'Window 2' }],
      ['create_box', { width: 5, height: 3, depth: 0.2, position: [0, 0, -1], name: 'Wall' }],
    ],
    check: (doc) => {
      const w = byName(doc, /^window/i);
      return checks([['windows tagged', w.length === 2 && w.every((e) => e.meta?.role === 'window')], ['windows blue', w.every((e) => e.material.color.toLowerCase() === '#b8dbe2')], ['wall untouched', !byName(doc, /wall/i)[0].meta && byName(doc, /wall/i)[0].material.color !== '#b8dbe2']]);
    },
    solution: [['select_where', { name: 'Window*' }], ['set_metadata', { values: { role: 'window' } }], ['set_material', { color: '#b8dbe2' }]],
  },
];

// Civil tasks: a gently sloping existing ground of survey points (N, E, Z) to work on.
const GROUND = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) GROUND.push(['add_point', { name: `G${i}${j}`, n: 1000 + i * 30, e: 5000 + j * 30, z: 10 + i * 0.6 + j * 0.3, code: 'NS' }]);
const SURFACE = [...GROUND, ['create_surface', { name: 'Existing ground' }]];
const gen = (doc, g) => ents(doc).filter((e) => e.derived?.generator === g);
const yOf = (doc, z) => z - (doc.geo?.base?.[2] || 0);

TASKS.push(
  {
    name: 'survey-surface',
    prompt: 'Make an existing ground surface called "Existing ground" from all the survey points.',
    setup: GROUND,
    check: (doc) => {
      const s = gen(doc, 'surface')[0];
      return checks([['a TIN surface', !!s], ['named Existing ground', s?.name === 'Existing ground'], ['built from the 16 points', s?.derived?.report?.points === 16]]);
    },
    solution: [['create_surface', { name: 'Existing ground' }]],
  },
  {
    name: 'pipe-trench',
    prompt: 'Survey points MH1 and MH2 are manholes. Dig a trench from MH1 to MH2 cut from "Existing ground": 1.2 m deep at MH1, falling at 1 %, 0.6 m bottom width, 1:1 side slopes. Name it "Trench MH1-MH2".',
    setup: [...SURFACE, ['add_point', { name: 'MH1', n: 1030, e: 5015, z: 10.75, code: 'MH' }], ['add_point', { name: 'MH2', n: 1030, e: 5065, z: 11.25, code: 'MH' }]],
    check: (doc) => {
      const t = byName(doc, /trench/i).find((e) => e.mesh);
      const b = t && D.worldBox(doc, t);
      return checks([['a trench', !!t], ['named Trench MH1-MH2', t?.name === 'Trench MH1-MH2'], ['about 50 m long', !!b && close(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]), 50, 0.15)], ['bottom at the 1 % invert', !!b && close(b.min[1], yOf(doc, 10.75 - 1.2 - 0.5), 0.02)]]);
    },
    solution: [['design_trench', { from: 'MH1', to: 'MH2', depth: 1.2, grade: 1, bottom: 0.6, side_slope: 1, surface: 'Existing ground', name: 'Trench MH1-MH2' }]],
  },
  {
    name: 'road-corridor',
    prompt: 'Design an access road through points G00, G11 and G33 (a 60 m radius curve at G11) following "Existing ground": two 3.5 m lanes at 2.5 % crossfall, 1 m shoulders at 4 %, cut batters 1:2 and fill batters 1:3. Call the corridor "Access Road".',
    setup: SURFACE,
    check: (doc) => {
      const c = gen(doc, 'corridor')[0];
      const t = c?.derived?.params?.template || {};
      const lanes = t.lanes || [];
      return checks([['a corridor', !!c], ['named Access Road', /access road/i.test(c?.name || '')], ['3.5 m lanes at 2.5 %', lanes.length > 0 && lanes.every((l) => close(l.width, 3.5) && close(l.crossfall, 2.5))], ['1 m shoulders at 4 %', close(t.shoulder?.width ?? 0, 1) && close(t.shoulder?.crossfall ?? 0, 4)], ['batters 2 and 3', close(t.cut_slope ?? 0, 2) && close(t.fill_slope ?? 0, 3)], ['an alignment with the curve', ents(doc).some((e) => e.alignment && (e.alignment.radii || []).some((r) => close(r, 60)))]]);
    },
    solution: [
      ['create_alignment', { name: 'Access Road centreline', points: ['G00', 'G11', 'G33'], radii: [0, 60, 0], surface: 'Existing ground' }],
      ['create_corridor', { alignment: 'Access Road centreline', surface: 'Existing ground', name: 'Access Road', template: { lanes: [{ width: 3.5, crossfall: 2.5 }, { width: 3.5, crossfall: 2.5 }], shoulder: { width: 1, crossfall: 4 }, cut_slope: 2, fill_slope: 3 } }],
    ],
  },
  {
    name: 'level-cut-fill',
    prompt: 'Work out the earthworks to level "Existing ground" at elevation 11.0 m, with a bulking factor of 1.25. Show the cut/fill map.',
    setup: SURFACE,
    check: (doc) => {
      const m = ents(doc).find((e) => e !== byName(doc, /^existing ground$/i)[0] && e.mesh && /cut|fill/i.test(e.name));
      return checks([['a cut/fill map', !!m]]);
    },
    solution: [['cut_fill', { existing: 'Existing ground', elevation: 11, bulking: 1.25 }]],
  },
  {
    name: 'survey-rod-bust',
    prompt: 'I imported my kerb pickup job. Check it for field mistakes and fix what you find.',
    setup: [['import', { text: fs.readFileSync(new URL('../tests/fixtures/jxl/kerb-pickup.jxl', import.meta.url), 'utf8'), format: 'jxl' }]],
    check: (doc) => {
      const book = ents(doc).find((e) => e.survey)?.survey;
      const p3 = book?.observations.find((o) => o.name === 'P3');
      const others = book?.observations.filter((o) => o.kind === 'ts' && o.name !== 'P3') || [];
      const z = ents(doc).find((e) => e.name === 'P3')?.point?.z;
      return checks([['P3 rod height fixed to 1.5 m', !!p3 && close(p3.th, 1.5, 0.001)], ['P3 moved up 0.5 m', z !== undefined && close(z, 10.1, 0.002)], ['the other shots untouched', others.every((o) => !Object.keys(o.edits).length)]]);
    },
    solution: [['review_survey', {}], ['edit_survey_observations', { names: ['P3'], target_height: 1.5 }]],
  },
);

// Scan tasks (#302) on the synthetic corridor scan (tests/fixtures/scan.js): model x east, y up, z south of its corner.
const SCAN = [(ctx) => addScanCloud(ctx.doc, { points: 60000 })];
const O = SITE.origin;
const local = ([e, n]) => [e - O[0], -(n - O[1])]; // E, N → model x, z
const clipsOf = (doc) => (doc.clips || []).filter((c) => c.enabled !== false);
const CULVERT = (() => {
  const [[e, n0], [, n1]] = SITE.culvert.axis;
  const r = SITE.culvert.diameter / 2;
  const y = groundAt(e, (n0 + n1) / 2) - O[2] + r; // the pipe axis sits one radius above the ditch invert
  return { min: [e - O[0] - r, y - r, -(n1 - O[1])], max: [e - O[0] + r, y + r, -(n0 - O[1])] };
})();
const vol = (s) => s[0] * s[1] * s[2];
/** World points of a curve entity. */
const curveWorld = (doc, e) => {
  const m = D.worldMatrix(doc, e).elements;
  return e.curve.points.map(([x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]);
};
const onLayer = (doc, re) => ents(doc).filter((e) => e.curve && re.test(e.tag || ''));
/** Plan distance from [x, z] to a segment. */
const segDist = ([x, z], [a, b]) => {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
};
const ringDist = (p, ring) => Math.min(...ring.map((a, i) => segDist(p, [a, ring[(i + 1) % ring.length]])));

TASKS.push(
  {
    name: 'scan-culvert-box',
    prompt: 'In the site scan there is a culvert mouth in the ditch south of the road, about 80 m east of the west edge (an unclassified pipe, class 1). Put a clip box tightly around the culvert so I only see it.',
    setup: SCAN,
    check: (doc) => {
      const b = clipsOf(doc).find((c) => c.kind === 'box' && c.keep !== 'outside');
      const lo = b && b.center.map((c, k) => c - b.size[k] / 2);
      const hi = b && b.center.map((c, k) => c + b.size[k] / 2);
      const level = b && (b.rotation || [0, 0, 0]).every((r) => Math.abs(r) < 1);
      const holds = !!b && level && [0, 1, 2].every((k) => lo[k] <= CULVERT.min[k] + 0.02 && hi[k] >= CULVERT.max[k] - 0.02);
      const truth = vol(CULVERT.max.map((x, k) => x - CULVERT.min[k]));
      return checks([['an inside box', !!b], ['it holds the culvert', holds], ['at most 20 % extra volume', !!b && vol(b.size) <= 1.2 * truth]]);
    },
    solution: [['add_clip', { kind: 'box', name: 'Culvert', center: CULVERT.min.map((x, k) => (x + CULVERT.max[k]) / 2), size: CULVERT.max.map((x, k) => (x - CULVERT.min[k]) * 1.05) }]],
  },
  {
    name: 'scan-hide-vegetation',
    prompt: 'Hide the trees and bushes in the site scan, keep everything else.',
    setup: SCAN,
    check: (doc) => {
      const f = ents(doc).find((e) => e.pointcloud)?.pointcloud.filter || {};
      const hide = f.hide || [];
      return checks([['trees hidden (5)', hide.includes(5)], ['shrubs hidden (3)', hide.includes(3)], ['ground, road and buildings kept', ![2, 6, 11].some((c) => hide.includes(c))]]);
    },
    solution: [['set_cloud_filter', { classes: { hide: [3, 4, 5] } }]],
  },
  {
    name: 'scan-slice-level',
    prompt: 'Make a level slice of the site scan that cuts through the walls of both buildings, so I can draft them, and look at the slice square-on from above.',
    setup: SCAN,
    check: (doc) => {
      const s = clipsOf(doc).find((c) => c.kind === 'slab' && Math.abs(c.normal?.[1]) > 0.999);
      const y = s?.point[1];
      // the site slopes: one level cuts both buildings' walls only above the higher base and under the lower eaves
      const cuts = y !== undefined && SITE.buildings.every((b) => y > b.base - O[2] + 0.3 && y < b.base - O[2] + 4.7);
      const looks = !!s && (doc.settings.layout?.panes || []).some((p) => p.slice === s.name);
      return checks([['a level slab', !!s], ['through the walls of both buildings', cuts], ['thin (≤ 0.5 m)', !!s && s.thickness <= 0.5], ['seen square-on', looks]]);
    },
    solution: [['describe_cloud', {}], ['add_slice', { at: 'elevation', z: 105, name: 'Plan cut' }], ['view_clip', { name: 'Plan cut' }]],
  },
  {
    name: 'scan-footprints',
    skip: 'extract_footprint (#301) is not on main yet',
    prompt: 'Find the building footprints on this site scan and draft them on a Footprints layer.',
    setup: SCAN,
    check: (doc) => {
      const rings = onLayer(doc, /footprint/i).map((e) => curveWorld(doc, e).map(([x, , z]) => [x, z]));
      const truth = SITE.buildings.map((b) => b.footprint.map(local));
      // Hausdorff in plan, both ways, between each true footprint and the nearest drafted ring
      const haus = truth.map((t) => Math.min(...rings.map((r) => Math.max(...t.map((p) => ringDist(p, r)), ...r.map((p) => ringDist(p, t))))));
      return checks([['two footprints', rings.length === 2], ['within 0.3 m of the truth', haus.every((h) => h <= 0.3)]]);
    },
    solution: [['extract_footprint', { classes: [6], layer: 'Footprints' }]],
  },
  {
    name: 'scan-kerbs',
    skip: 'extract_edges (#301) and detect_edges (#300) are not on main yet',
    prompt: 'Extract the kerb lines along Main road from the site scan, on a Kerbs layer.',
    setup: [...SCAN, ['create_alignment', { name: 'Main road', points: SITE.road.centreline.map(local) }]],
    check: (doc) => {
      const lines = onLayer(doc, /kerb/i).flatMap((e) => curveWorld(doc, e).map(([x, , z]) => [x, z]));
      const kerbs = SITE.kerbs.map((k) => k.line.map(local));
      const near = lines.filter((p) => kerbs.some((k) => segDist(p, k) <= 0.05));
      const span = (k) => {
        const xs = lines.filter((p) => segDist(p, k) <= 0.05).map((p) => p[0]);
        return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
      };
      const covered = kerbs.every((k) => span(k) >= 80);
      return checks([['kerb lines drawn', lines.length > 0], ['within 5 cm of the kerbs', !!lines.length && near.length === lines.length], ['both kerbs, 80 m or more each', covered]]);
    },
    solution: [['extract_edges', { kind: 'kerb', alignment: 'Main road', layer: 'Kerbs' }]],
  },
);
