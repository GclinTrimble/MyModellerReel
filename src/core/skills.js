// Domain skills (#96): system-prompt add-ons and example scripts per domain, selectable in Plumb and readable
// by any client (list_skills). Workflows (#97) are the step-by-step prompts the MCP server offers as MCP prompts.
// Plain data, no dependencies: the MCP server imports this file directly.

export const SKILLS = {
  architecture: {
    label: 'Architecture',
    description: 'Buildings, rooms, walls with openings, storeys, roofs, stairs',
    prompt: `Domain: architecture. Think in storeys (2.7–3.0 m floor to floor), walls 0.1–0.3 m thick, doors 0.9 × 2.1 m,
windows with a 0.9 m sill, stairs with 0.17–0.19 m rise and 0.25–0.30 m going. Use create_wall (with openings) for
walls and create_stairs for stairs: both stay parametric. Group each storey ("Ground floor", "First floor"), tag by
system (Walls, Floors, Roof, Openings) and set_metadata role/phase so quantities and 4D sequences work. Roofs: a
create_prism outline pushed up, or create_face slopes. Check: nothing floats, openings go through walls.`,
    examples: [
      { title: 'Two-storey shell', code: "for (let i = 0; i < 2; i++) {\n  const y = i * 3;\n  for (const [f, t] of [[[0,0],[8,0]], [[8,0],[8,6]], [[8,6],[0,6]], [[0,6],[0,0]]])\n    await api.create_wall({ from: f, to: t, height: 3, name: `Wall ${i}` });\n}" },
      { title: 'Stair to the first floor', code: "await api.create_stairs({ steps: 16, rise: 0.1875, run: 0.28, width: 1, position: [1, 0, 1] });" },
    ],
  },
  product: {
    label: 'Product design',
    description: 'Objects and devices: housings, fillet-like steps, exploded views, turntables',
    prompt: `Domain: product design. Work in millimetres expressed as metres (a 120 mm part is 0.12). Build from a few
clean primitives and booleans; keep wall thickness consistent (1.5–3 mm for plastic). Name every part, group the
assembly, set_metadata part numbers and material. Show it with explode (out-in) and a turntable, and render_video
with a transparent background for product shots.`,
    examples: [{ title: 'Exploded turntable reel', code: "await api.explode({ mode: 'out-in', start: 0, duration: 1.2, hold: 1.5 });\nawait api.turntable({ duration: 6 });" }],
  },
  jobsite: {
    label: 'Jobsite and heavy equipment',
    description: 'Earthworks, haul roads, kerbs, pipes, machines, construction (4D) sequences',
    prompt: `Domain: jobsite / civil construction. Roads are sweeps of a rectangle (carriageway) with kerb profiles along
create_curve edges; pipes and ducts are sweeps of the pipe profile; ditches subtract the ditch profile from the
ground. Machines: a body box plus tracks or wheels, grouped, moved with animate_along_path along haul roads
(forward x). Sequence work with markers per phase, build_sequence for structures, captions for phase names and
dates. Use realistic sizes: an excavator ~10 × 3 × 3 m, a truck ~8 × 2.5 × 3.5 m, lanes 3.5 m.`,
    examples: [
      { title: 'Haul road with kerbs', code: "const edge = await api.create_curve({ points: [[0,0,0],[20,0,5],[40,0,0]], kind: 'spline', name: 'Road centre' });\nawait api.sweep({ path: edge.id, profile: 'rectangle', profile_params: { width: 7, height: 0.05 }, color: '#3c3f44', name: 'Carriageway' });" },
      { title: 'Truck along the road', code: "await api.animate_along_path({ target: 'Truck', path: 'Road centre', start: 0, end: 8 });" },
    ],
  },
  takeoff: {
    label: 'Surface materials and takeoff',
    description: 'Paint asphalt, turf, gravel, concrete on surfaces; areas, volumes, weights, costs',
    prompt: `Domain: material takeoff. Surface materials (a library with code, colour, thickness m, density kg/m³, cost
per m²) are painted on the faces of a surface or mesh with paint_surface: inside a closed boundary curve (car parks,
lawns), fill from a seed face stopped by breaklines (kerbs, edges of seal) and by other paint, a brush (at + radius),
or all faces. Paint the big area first (all → Turf), then the details on top. material_takeoff gives 3D area, plan
area, volume (area × thickness), weight (× density) and cost; give a path for CSV, JSON or GeoJSON (OGC API Features
encoding, project coordinates, EPSG). Typical layers: asphalt 0.04–0.1 m at 2350 kg/m³, crushed rock base 0.15–0.3 m
at 2100, concrete 0.1–0.2 m at 2400, topsoil 0.1–0.15 m at 1600, turf 0.03 m. Set real values with
define_surface_material before reporting. show_surface_materials hides or isolates a material to check the paint.`,
    examples: [
      { title: 'Turf everywhere, asphalt in the car park, takeoff', code: "await api.paint_surface({ id: 'Site', material: 'Turf', all: true });\nawait api.paint_surface({ id: 'Site', material: 'Asphalt', inside: 'Car park boundary' });\nreturn await api.material_takeoff({ format: 'csv' });" },
    ],
  },
  survey: {
    label: 'Survey and COGO',
    description: 'Field book calculations: inverses, traverses, intersections, stations and offsets, curves, parcel areas, deed mapchecks',
    prompt: `Domain: land survey and COGO. Survey points have names and Northing / Easting / Elevation in project units; use
their names, not model coordinates. Directions may be azimuths (45.5, 45°30'00"), quadrant bearings (N45°30'E) or
turns from the last leg (R90 / L45 deflections, AR270 angle right from the backsight). cogo_inverse answers "what is
the bearing and distance", cogo_traverse turns field book or deed calls into points (sideshots with side: true, a
backsight for turned angles, close_to for the misclosure, precision 1:N and area, adjust: compass to spread it),
cogo_intersect finds a corner from two bearings, a bearing and a distance, two distances or two lines (two answers:
report both, store the one the user means), cogo_station_offset and cogo_offset_point work along a line, alignment
or linework (offset + right, − left), cogo_curve solves a curve from any two parts, cogo_area gives a parcel's area.
A legal description ("thence N 45°30' E 120.00 feet…") is a traverse that should close on the point of beginning:
run it with close_to, quote the misclosure and precision, and say if it does not close (worse than 1:10000 is poor).
Every COGO result has a report line: give it to the user as it is.`,
    examples: [
      { title: 'Deed mapcheck', code: "await api.cogo_traverse({ from: 'POB', legs: [{ direction: 'N 45 30 E', distance: 120 }, { direction: 'S 44 30 E', distance: 80 }, { direction: 'S 45 30 W', distance: 120 }, { direction: 'N 44 30 W', distance: 80 }], close_to: 'POB', store: false });" },
      { title: 'Corner from two distances', code: "await api.cogo_intersect({ point1: 'CP1', distance1: 60, point2: 'CP2', distance2: 80, solution: '1', name: 'C1' });" },
    ],
  },
  furniture: {
    label: 'Furniture and interiors',
    description: 'Tables, chairs, shelves, kitchens, room layouts',
    prompt: `Domain: furniture and interiors. Standard heights: table 0.75 m, seat 0.45 m, counter 0.9 m, shelf boards
18–25 mm, wall cabinets from 1.4 m. Build each piece from boards (create_box), group it, name it. Lay rooms out with
relations, not coordinates: against (a sofa to a wall), place_on (a lamp on a table), align and distribute, and
find_free_space for a new piece. Materials: Oak, Walnut, Steel, Glass, Plaster.`,
    examples: [{ title: 'Shelf of 4 boards', code: "for (let i = 0; i < 4; i++) await api.create_box({ width: 0.8, height: 0.02, depth: 0.3, position: [0, 0.35 * i, 0], name: `Board ${i + 1}`, color: '#b58a57' });" }],
  },
};

/**
 * The user's own skills (#242), saved with save_skill and loaded from the user library at startup. Same shape as a
 * SKILLS entry plus `toolset` (command names it uses): { name, label, description, prompt, toolset, examples }.
 * See usertools.js for the file format.
 */
export const USER_SKILLS = {};

/** The text added to Plumb's system prompt for a skill (or '' for none). */
export function skillPrompt(name) {
  const s = SKILLS[name] || USER_SKILLS[name];
  if (!s) return '';
  const ex = s.examples?.length ? `\nExamples (run_script):\n${s.examples.map((x) => `// ${x.title}\n${x.code}`).join('\n')}` : '';
  return `${s.prompt}${s.toolset?.length ? `\nCommands for this work: ${s.toolset.join(', ')}.` : ''}${ex}`;
}

/** Common workflows, offered to MCP clients as prompts. {{arg}} placeholders are filled from the prompt's arguments. */
export const WORKFLOWS = {
  build_house: {
    description: 'Model a small house: walls with openings, floors, a roof, grouped and tagged',
    arguments: [{ name: 'storeys', description: 'number of storeys (default 2)' }, { name: 'footprint', description: 'width × depth in metres (default 8 × 6)' }],
    text: `Model a small {{storeys|2}}-storey house with a {{footprint|8 × 6}} m footprint in MyModellerReel: walls with a door and windows
(create_wall with openings), a floor slab per storey, and a pitched roof. Group each storey, tag Walls / Floors / Roof,
and set_metadata role on doors and windows. Then save_recipe "House" with a storeys parameter. Check with get_scene
and a screenshot, and summarise in a few lines.`,
  },
  assembly_sequence: {
    description: '4D construction / assembly sequence of the current model, with markers and captions',
    arguments: [{ name: 'seconds', description: 'length of the reel (default 12)' }],
    text: `Turn the current MyModellerReel model into a {{seconds|12}} s construction sequence: add_marker per phase, build_sequence
bottom-up per phase (stagger where it helps), add_caption with each phase name, and a slow turntable or camera path.
Play it back (playback) and check a few times with screenshots. Do not render unless asked.`,
  },
  turntable_reel: {
    description: 'A presentation reel: turntable, title, render to MP4',
    arguments: [{ name: 'title', description: 'title text' }, { name: 'path', description: 'output .mp4 path' }],
    text: `Make a presentation reel of the current model: a turntable over 8 s, a title caption "{{title|My model}}" for the first
2.5 s, then render_video to {{path|(ask me where)}} at 1920 × 1080.`,
  },
  review_model: {
    description: 'Check the model for floating parts, collisions and scale errors, and fix what is clearly wrong',
    arguments: [],
    text: `Run review_model on the current MyModellerReel model. Explain the issues it finds in plain words, fix the ones that
are clearly mistakes (use place_on, align, set_params, move), leave design choices alone, then run review_model again.`,
  },
};
for (const [name, s] of Object.entries(SKILLS))
  WORKFLOWS[`skill_${name}`] = { description: `Work as a ${s.label.toLowerCase()} modeller: ${s.description}`, arguments: [{ name: 'task', description: 'what to build' }], text: `${skillPrompt(name)}\n\nTask: {{task|(ask me what to build)}}` };

/** A workflow's text with its arguments filled in ("{{name|default}}"). */
export function workflowText(name, args = {}) {
  const w = WORKFLOWS[name];
  if (!w) throw new Error(`No workflow "${name}". Workflows: ${Object.keys(WORKFLOWS).join(', ')}.`);
  return w.text.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, (_, k, d) => (args[k] !== undefined && args[k] !== '' ? String(args[k]) : (d ?? '')));
}
