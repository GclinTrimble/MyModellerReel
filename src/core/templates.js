// Start templates (#109): small, complete models to begin from, each one a list of ordinary commands (so a template
// is also an example of how to drive the app).
const range = (n) => [...Array(n).keys()];

export const TEMPLATES = [
  {
    id: 'empty',
    name: 'Empty model (metres)',
    description: 'A blank model in metres.',
    icon: 'file',
    steps: () => [],
  },
  {
    id: 'empty-feet',
    name: 'Empty model (feet and inches)',
    description: 'A blank model that shows lengths in feet and inches (commands stay in metres).',
    icon: 'ruler',
    steps: () => [['set_units', { display: 'ft-in', precision: 16 }]],
  },
  {
    id: 'house',
    name: 'Architecture: a small house',
    description: 'Slab, walls with roles and fire ratings, a pitched roof, a door and windows on layers, two scenes. Ready to export to IFC.',
    icon: 'house-line',
    steps: () => {
      const wall = (name, w, d, p) => ['create_box', { width: w, height: 2.8, depth: d, position: p, name, color: '#e9e4d8', tag: 'A-WALL' }];
      return [
        ['create_layer', { name: 'A-WALL', color: '#e9e4d8' }],
        ['create_layer', { name: 'A-SLAB', color: '#a7a39a' }],
        ['create_layer', { name: 'A-ROOF', color: '#8a4b3a' }],
        ['create_layer', { name: 'A-DOOR', color: '#5e3f2b' }],
        ['create_layer', { name: 'A-GLAZ', color: '#7fb0c2' }],
        ['create_box', { width: 10.6, height: 0.25, depth: 8.6, position: [0, -0.25, 0], name: 'Ground slab', color: '#a7a39a', tag: 'A-SLAB' }],
        wall('North wall', 10, 0.3, [0, 0, -4]),
        wall('South wall', 10, 0.3, [0, 0, 4]),
        wall('West wall', 0.3, 8, [-5, 0, 0]),
        wall('East wall', 0.3, 8, [5, 0, 0]),
        ['set_metadata', { ids: ['North wall', 'South wall', 'West wall', 'East wall'], values: { role: 'wall', fire_rating: 'EI60', load_bearing: true } }],
        ['create_face', { points: [[-5.4, 2.8, -4.4], [5.4, 2.8, -4.4], [0, 5.2, -4.4]], name: 'Roof', color: '#8a4b3a', tag: 'A-ROOF' }],
        ['push_pull', { id: 'Roof', face: 0, distance: 8.8 }],
        ['set_metadata', { ids: ['Roof'], values: { role: 'roof' } }],
        ['create_box', { width: 1.1, height: 2.2, depth: 0.35, position: [-2, 0, 4], name: 'Front door', color: '#5e3f2b', tag: 'A-DOOR' }],
        ['set_metadata', { ids: ['Front door'], values: { role: 'door' } }],
        ...range(2).map((i) => ['create_box', { width: 1.4, height: 1.3, depth: 0.35, position: [1 + i * 2.4, 1, 4], name: `Window ${i + 1}`, color: '#7fb0c2', tag: 'A-GLAZ' }]),
        ['set_metadata', { ids: ['Window 1', 'Window 2'], values: { role: 'window', u_value: 1.1 } }],
        ['set_pivot', { id: 'Front door', pivot: 'left' }],
        ['set_camera', { position: [16, 9, 18], target: [0, 1.5, 0] }],
        ['add_scene', { name: 'Street view' }],
        ['set_camera', { position: [0, 30, 0.01], target: [0, 0, 0] }],
        ['add_scene', { name: 'Plan' }],
        ['go_to_scene', { name: 'Street view' }],
      ];
    },
  },
  {
    id: 'product',
    name: 'Product reel: a turntable',
    description: 'A lamp on a plinth with a title, turning once in 8 seconds: render it to MP4 straight away.',
    icon: 'film-strip',
    steps: () => [
      ['create_cylinder', { radius: 1.2, height: 0.3, name: 'Plinth', color: '#d9d4c7' }],
      ['create_lathe', { profile: [[0, 0], [0.35, 0], [0.12, 0.08], [0.06, 1.2], [0.3, 1.25], [0.22, 1.6], [0, 1.65]], position: [0, 0.3, 0], name: 'Lamp', color: '#c8553d' }],
      ['set_material', { ids: ['Lamp'], metalness: 0.6, roughness: 0.3 }],
      ['turntable', { duration: 8, turns: 1 }],
      ['add_caption', { text: 'Desk lamp', style: 'title', start: 0, end: 3 }],
    ],
  },
  {
    id: 'site',
    name: 'Jobsite: terrain, pad and road',
    description: 'Survey points of a gently sloping field, a live surface, a building pad with its cut and fill, and an access road with a corridor.',
    icon: 'mountains',
    steps: () => {
      const rows = [];
      for (const i of range(9)) for (const j of range(9)) rows.push(`${i * 9 + j + 1},${5400000 + i * 10},${650000 + j * 10},${(100 + i * 0.35 + Math.sin(j / 2) * 0.8).toFixed(3)},GND`);
      return [
        ['import_points', { text: rows.join('\n') }],
        ['create_surface', { name: 'Existing ground' }],
        ['cut_fill', { existing: 'Existing ground', elevation: 101.5, name: 'Pad cut/fill' }],
        ['create_alignment', { name: 'Access road', points: ['1', '41', '81'], radii: [25] }],
        ['set_alignment', { id: 'Access road', pvis: [[0, 100.2], [60, 101], [113, 102.8]] }],
        ['create_corridor', { alignment: 'Access road', surface: 'Existing ground', template: { lanes: [{ width: 3, crossfall: -2.5 }], cut_slope: 1.5, fill_slope: 2 }, interval: 4 }],
        ['set_view', { preset: 'iso' }],
      ];
    },
  },
  {
    id: 'sequence',
    name: 'Construction sequence',
    description: 'A small frame building that rises piece by piece, with phase captions: a 4D-style reel.',
    icon: 'stack',
    steps: () => [
      ['create_box', { width: 8, height: 0.3, depth: 6, position: [0, 0, 0], name: 'Foundation', color: '#a7a39a' }],
      ...[[-3.6, -2.6], [3.6, -2.6], [-3.6, 2.6], [3.6, 2.6]].map(([x, z], i) => ['create_box', { width: 0.3, height: 3, depth: 0.3, position: [x, 0.3, z], name: `Column ${i + 1}`, color: '#5e6b73' }]),
      ['create_box', { width: 8, height: 0.25, depth: 6, position: [0, 3.3, 0], name: 'Roof deck', color: '#d9d4c7' }],
      ['build_sequence', { ids: ['Foundation', 'Column 1', 'Column 2', 'Column 3', 'Column 4', 'Roof deck'], effect: 'rise' }],
      ['add_caption', { text: 'Week 1: foundation', style: 'caption', start: 0, end: 2 }],
      ['add_caption', { text: 'Week 2–3: frame and roof', style: 'caption', start: 2, end: 6 }],
    ],
  },
];
