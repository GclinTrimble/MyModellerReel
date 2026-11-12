// Learning modules (#213, #214): the how-to pages as five modules of lessons. A lesson is done when the user runs one
// of its commands; lessons earn points, points give levels. Some lessons have guided steps: what to click, where, and
// how to tell the step is done. Pure, Node-tested; progress is kept by the app (settings), not in the model.

export const POINTS = 10;
export const LEVELS = [
  [0, 'Newcomer'],
  [30, 'Sketcher'],
  [80, 'Modeller'],
  [150, 'Designer'],
  [250, 'Engineer'],
  [400, 'Master builder'],
];

/**
 * A step: { text, target (CSS selector of what to highlight, or 'view'), done: { tool } | { command } | { entities: n } }.
 * done.command is met when that command has run since the step began; tool when it is the active tool.
 */
export const MODULES = [
  {
    id: 'm1',
    title: '1 Getting started',
    lessons: [
      { id: 'work-faster', commands: ['set_snaps', 'section', 'export'], guide: [
        { text: 'The side toolbar: right-click the rectangle button to see its variants.', target: '.toolbar .slot:nth-of-type(3)', done: { tool: 'rect3' }, hint: 'Pick "Rotated rectangle".' },
        { text: 'The view bar: open the standard views and pick Top.', target: '#viewbar', done: { command: 'set_view' } },
        { text: 'Turn grid snapping off in Snaps (the magnet).', target: '#viewbar', done: { command: 'set_snaps' } },
      ] },
      { id: 'multiple-views', commands: ['set_layout', 'set_pane'], guide: [
        { text: 'Open the Views drop-down in the view bar and choose Four views.', target: '#viewbar', done: { command: 'set_layout' } },
        { text: 'On the floating bar of a pane, choose another view (for example Left).', target: '.pane-head', done: { command: 'set_pane' } },
      ] },
      { id: 'first-steps-with-the-copilot', commands: ['download_ai_model', 'pull_ai_model', 'start_local_ai'] },
      { id: 'ask-the-copilot', commands: [] },
      { id: 'tabs-handles-walk-and-language', commands: ['set_gizmo', 'new_document', 'walk_to'] },
    ],
  },
  {
    id: 'm2',
    title: '2 Drawing',
    lessons: [
      { id: 'draw-and-edit', commands: ['create_face', 'create_arc', 'apply_material'], guide: [
        { text: 'Pick the Rectangle tool.', target: '.toolbar .slot:nth-of-type(3)', done: { tool: 'rectangle' } },
        { text: 'Draw a rectangle on the ground: click a corner, then the opposite corner.', target: 'view', done: { command: 'create_face' } },
        { text: 'Draw a second rectangle half over the first: it splits it.', target: 'view', done: { command: 'create_face' } },
        { text: 'Give it a textured material: Materials panel › Textured › Red brick.', target: '[data-tab="materials"]', done: { command: 'apply_material' } },
      ] },
      { id: 'dimension-and-label', commands: ['add_dimension', 'add_label'] },
      { id: 'organise-with-layers', commands: ['create_layer', 'set_layer'], guide: [
        { text: 'Open the Outliner panel.', target: '[data-tab="outliner"]', done: { panel: 'outliner' } },
        { text: 'Press + next to Layers and create a layer.', target: '[data-tab="outliner"]', done: { command: 'create_layer' } },
      ] },
      { id: 'put-a-pdf-in-place', commands: ['import_pdf', 'calibrate_underlay'] },
    ],
  },
  {
    id: 'm3',
    title: '3 Modelling',
    lessons: [
      { id: 'push-pull-and-components', commands: ['push_pull', 'make_component'], guide: [
        { text: 'Pick the Rectangle tool and draw a rectangle on the ground.', target: '.toolbar', done: { command: 'create_face' } },
        { text: 'Pick Push/Pull (P) and pull the rectangle up into a box.', target: '.toolbar', done: { command: 'push_pull' } },
      ] },
      { id: 'live-sweep-along-a-curve', commands: ['sweep'] },
      { id: 'component-library-and-sets', commands: ['place_component', 'insert_asset'] },
      { id: 'product-modelling', commands: ['fillet_edges', 'shell'] },
    ],
  },
  {
    id: 'm4',
    title: '4 Site and roads',
    lessons: [
      { id: 'survey-points-to-surface', commands: ['create_surface', 'import_points'], guide: [
        { text: 'Pick the Survey point tool and click five or more points on the ground.', target: '.toolbar', done: { entities: { type: 'point', count: 5 } } },
        { text: 'Select them with a box (right to left), right-click one: Create a surface from these points.', target: 'view', done: { command: 'create_surface' } },
        { text: 'Edit it: Site › Edit surface, then click a triangle to delete it.', target: '#menubar', done: { command: 'edit_triangles' } },
      ] },
      { id: 'site-setup', commands: ['set_coordinate_system', 'set_base_point'] },
      { id: 'road-through-terrain', commands: ['create_corridor', 'road_views'] },
      { id: 'road-earthworks', commands: ['corridor_volumes', 'corridor_solids'] },
    ],
  },
  {
    id: 'm5',
    title: '5 Presenting',
    lessons: [
      { id: 'present-a-design', commands: ['set_effects', 'set_environment'] },
      { id: 'construction-sequence-video', commands: ['render_video', 'build_sequence'] },
      { id: 'drawing-sheets-and-sections', commands: ['export_drawing'] },
      { id: 'share-viewer-ar-print', commands: ['export_web_viewer'] },
    ],
  },
];

export const allLessons = () => MODULES.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m.id })));

/** Finishing a lesson's guided steps earns this much more, once (#221). */
export const TUTORIAL_POINTS = 5;

/** Points, level, the next level and the badges (a module fully done) from the lessons done and tutorials finished. */
export function progress(done = [], tutorials = []) {
  const set = new Set(done);
  const lessons = allLessons();
  const guided = new Set(tutorials.filter((id) => lessons.some((l) => l.id === id && l.guide)));
  const points = lessons.filter((l) => set.has(l.id)).length * POINTS + guided.size * TUTORIAL_POINTS;
  let level = LEVELS[0];
  for (const L of LEVELS) if (points >= L[0]) level = L;
  const next = LEVELS.find(([p]) => p > points) || null;
  const modules = MODULES.map((m) => ({ id: m.id, title: m.title, done: m.lessons.filter((l) => set.has(l.id)).length, of: m.lessons.length }));
  return { points, level: level[1], next: next ? { level: next[1], points: next[0] } : null, lessons: set.size, tutorials: guided.size, modules, badges: modules.filter((m) => m.done === m.of).map((m) => m.title.replace(/^\d+ /, '')) };
}

/** The lessons a command completes. */
export const lessonsFor = (command) => allLessons().filter((l) => l.commands.includes(command)).map((l) => l.id);
