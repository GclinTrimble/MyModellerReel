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
Every COGO result has a report line: give it to the user as it is.
Field data: before using a job, check it like a party chief would: backsight residuals, rod / target height changes
between consecutive shots (a forgotten rod change is the commonest bust), prism constants, instrument heights, GNSS
precisions and duplicate point names at different positions. Report what looks wrong with the shots involved and the
likely fix; do not change measurements without saying so. With a JobXML job in the model, review_survey does these checks
and edit_survey_observations applies the fix (by shot names, setup, base or time range); survey_report documents it.`,
    examples: [
      { title: 'Deed mapcheck', code: "await api.cogo_traverse({ from: 'POB', legs: [{ direction: 'N 45 30 E', distance: 120 }, { direction: 'S 44 30 E', distance: 80 }, { direction: 'S 45 30 W', distance: 120 }, { direction: 'N 44 30 W', distance: 80 }], close_to: 'POB', store: false });" },
      { title: 'Corner from two distances', code: "await api.cogo_intersect({ point1: 'CP1', distance1: 60, point2: 'CP2', distance2: 80, solution: '1', name: 'C1' });" },
    ],
  },
  roads: {
    label: 'Road design',
    description: 'Alignments, vertical profiles, cross-sections, corridors, superelevation, road earthworks',
    prompt: `Domain: road geometric design. Work from an alignment (create_alignment: points of intersection with radii,
a vertical profile of PVIs with parabolic vertical curves, or following the ground), then create_corridor with a
template, then corridor_surface, corridor_volumes and road_views (long section and cross-sections). Typical values,
unless the user gives their standard (Austroads, AASHTO, DMRB...): lanes 3.5 m (3.0-3.25 m local streets), normal
crossfall 2.5-3 % falling from the crown, sealed shoulders 1.0-2.5 m at 4 %, superelevation up to 6-8 % on curves
with 30-60 m runoff, longitudinal grade 0.5-8 % (at least 0.5 % for drainage on kerbed roads), crest and sag curves
long enough for sight distance (K about 10-60 by speed), cut batters 1:1.5-1:2 (H:V 1.5-2), fill batters 1:2-1:3,
table drains 0.5-0.6 m deep at the toe of cuts, pavement asphalt 0.04-0.1 m on 0.2-0.4 m crushed rock base. Name
corridors and alignments by road name; report lengths, chainages, minimum radius, maximum grade, cut / fill volumes and
the balance, and flag anything outside the values you assumed.`,
    examples: [
      { title: 'Alignment, corridor and volumes', code: "await api.create_alignment({ name: 'Access Road', points: [[0, 0], [80, 20], [160, 0]], radii: [0, 120, 0], surface: 'Existing ground' });\nawait api.create_corridor({ alignment: 'Access Road', surface: 'Existing ground', template: { lanes: [{ width: 3.5, crossfall: 2.5 }], shoulder: { width: 1, crossfall: 4 }, cut_slope: 2, fill_slope: 3, ditch: { width: 0.5, depth: 0.6 } }, name: 'Access Road corridor' });\nawait api.corridor_volumes({ corridor: 'Access Road corridor', bulking: 1.25, shrinkage: 0.9 });" },
    ],
  },
  drainage: {
    label: 'Drainage and utilities',
    description: 'Gravity pipes, manholes, trenches, culverts, swales; pipe grades, inverts and cover',
    prompt: `Domain: stormwater, wastewater and utilities. A gravity run goes manhole to manhole in straight lines; each
pipe has invert levels at both ends, a grade (fall / length, %), a diameter and cover to the finished surface. Typical
values unless told otherwise: minimum grade 0.5 % for stormwater (1 in 200), 1 in 60-1 in 150 for small sewers,
self-cleansing velocity 0.6-0.7 m/s, minimum cover 0.6 m in verges and 0.9-1.2 m under roads, manholes at every change
of grade or direction and at most 90-120 m apart, inverts dropping at least 20-30 mm across a manhole, trench width
about the pipe diameter + 0.3-0.6 m. Build trenches with design_trench (from / to manholes, invert levels or grade, side
slopes), pipes with sweep using the pipe profile along the invert line (centre at invert + radius), manholes as
cylinders on the inverts. Name assets by id (SW-MH01, SW-P01) and set_metadata diameter, material, invert_in / invert_out,
grade; report a pipe schedule (from, to, length, grade, cover min) and flag grades or cover below the minimum.`,
    examples: [
      { title: 'Trench between two manholes at 1 % fall', code: "await api.design_trench({ from: 'MH1', to: 'MH2', depth: 1.2, grade: 1, bottom: 0.6, side_slope: 1, surface: 'Existing ground', name: 'Trench MH1-MH2' });" },
    ],
  },
  earthworks: {
    label: 'Earthworks and site grading',
    description: 'Existing ground, pads and platforms, batters, cut / fill, stockpiles, haul and balance',
    prompt: `Domain: earthworks. Start from an existing ground surface (survey points, breaklines, boundary, or a point
cloud's ground), keep it as "Existing ground", and design on top: create_pad for building pads and platforms (level or
graded top, cut and fill batters daylighting to the ground, merge for a design surface), design_plane / design_line_slope
for graded areas, corridors for roads and channels. Volumes with cut_fill / volume_report between existing and design
(or a level), with bulking (rock 1.3-1.6, clay 1.2-1.3, sand 1.1-1.15) and compaction / shrinkage (0.85-0.95), within a
boundary per stage or area. Strip topsoil (0.1-0.3 m) first and report it apart. Batters: 1:2 typical in clay and fill,
1:1 or steeper only in rock. Aim for a cut / fill balance; report cut, fill, net, imported or exported material and the
areas, and stage work with markers and build_sequence for a 4D sequence.`,
    examples: [
      { title: 'Pad and cut / fill', code: "await api.create_pad({ outline: 'Pad outline', elevation: 12.5, surface: 'Existing ground', cut_slope: 2, fill_slope: 2, merge: true, name: 'Building pad' });\nawait api.cut_fill({ existing: 'Existing ground', design: 'Design surface', bulking: 1.25, shrinkage: 0.9 });" },
    ],
  },
  scans: {
    label: 'Point clouds and scans',
    description: 'Work in a site scan: describe, classify, clip and slice, detect and extract footprints, walls and kerbs, check by eye, propose',
    prompt: `Domain: working in a point cloud (a laser or drone scan of a site, road corridor or building). Never ask for raw
points: commands answer with counts, statistics and ids. Start with describe_cloud (bounds in project E/N/Z, density,
classes, the ground, levels = flat floors and roofs, walls = dominant bearings). Classes are ASPRS LAS 1.4: 2 ground,
3/4/5 low/medium/high vegetation, 6 building, 7 and 18 noise, 11 road surface. If the scan is unclassified run
classify_cloud (inside propose { action: 'start' }) and read its before / after counts; fix classes by hand with
select_points then set_point_class (define_point_class names user classes 64–255, e.g. 64 Kerb); hide vegetation and
noise with set_cloud_filter; export_point_cloud writes LAS 1.4 with the edited classes. Isolate what you work on: add_clip
box around a feature (fit_clip, align_clip to two points of a wall or kerb), add_slice at a level (above: 'ground' for a
plan cut 1.2 m up) or across an alignment at a station, slice_series for every floor or every 20 m. Extract with
detect_planes (walls, roofs, ground: faces to align a clip to), detect_corners (CORNER survey points at wall corners),
detect_edges kind kerb along an alignment (kerb top and bottom lines; step for retaining walls, wall_top,
intersections for eaves and ridges); extract_footprint (buildings), trace_slice (wall lines from a level slice),
extract_edges (edges of seal, as_breaklines for the surface). Each on its own layer (Footprints, Walls, Kerbs,
Corners). Then check by eye: view_clip on the slice in pane 2, set_cloud_style { depth: 'xray' },
select the new linework, screenshot, compare lines and points, and say what is off. Results you make are proposals
(propose: true, or propose { action: 'start' } first): the person accepts them. Deleting points, overwriting or
unlocking classes: ask_user first. Typical tolerances: walls ±2 cm, kerbs ±3 cm in plan and ±1 cm in height, footprints
square to ±5°.`,
    toolset: ['describe_cloud', 'list_cloud_classes', 'set_cloud_filter', 'set_cloud_style', 'classify_cloud', 'select_points', 'set_point_class', 'define_point_class', 'export_point_cloud', 'detect_planes', 'detect_corners', 'add_clip', 'fit_clip', 'align_clip', 'add_slice', 'slice_series', 'view_clip', 'slice_points', 'detect_edges', 'extract_footprint', 'trace_slice', 'extract_edges', 'screenshot', 'propose'],
    examples: [
      { title: 'Look at a scan', code: "const d = await api.describe_cloud({});\nreturn { points: d.points, classes: d.classes, levels: d.levels, walls: d.walls };" },
      { title: 'A box around the culvert, seen from the side', code: "await api.add_clip({ kind: 'box', name: 'Culvert', center: [80, 0, -33.8], size: [3, 3, 4] });\nawait api.add_slice({ at: 'line', points: [[78, 0, -33.8], [82, 0, -33.8]], thickness: 4, name: 'Culvert side' });\nawait api.view_clip({ name: 'Culvert side', pane: 2 });" },
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
  scan_to_plan: {
    description: 'Scan to plan: slice a scanned building or site, draft footprints and wall lines on layers, check them against the points, propose',
    arguments: [{ name: 'level', description: 'height of the plan cut above the ground (default 1.2 m)' }, { name: 'cloud', description: 'the point cloud (default the first)' }],
    text: `Draft a plan from the scan {{cloud|(the first point cloud)}} in MyModellerReel.
1. describe_cloud: note the classes, the ground, the levels and the wall bearings. If there is no building class (6), run
   propose { action: 'start' } then classify_cloud { steps: ['noise', 'ground', 'vegetation', 'buildings'] }, and accept
   (propose { action: 'accept' }) only if the counts look right.
2. Hide vegetation and noise: set_cloud_filter { classes: { hide: [3, 4, 5, 7, 18] } }.
3. Footprints: detect_corners { classes: [6], layer: 'Corners', propose: true } gives the corner points to check;
   extract_footprint { classes: [6], layer: 'Footprints', propose: true } draws the outlines.
4. Walls: add_slice { at: 'elevation', z: {{level|1.2}}, above: 'ground', name: 'Plan cut' } (slice_series for several floors),
   then trace_slice { name: 'Plan cut', layer: 'Walls', propose: true }.
5. Check: view_clip { name: 'Plan cut', pane: 2 }, set_cloud_style { depth: 'xray' }, select the new lines, screenshot,
   and compare lines and points; fix what is off.
6. Leave it as a proposal and summarise: how many footprints and walls, their sizes, what looked doubtful.`,
  },
  scan_to_kerbs: {
    description: 'Kerb lines from a road scan along an alignment: edges, breaklines, a surface that follows them, the quality report explained',
    arguments: [{ name: 'alignment', description: 'the road alignment or centreline (default Main road)' }, { name: 'cloud', description: 'the point cloud (default the first)' }],
    text: `Extract the kerb lines along {{alignment|Main road}} from the scan {{cloud|(the first point cloud)}}.
1. describe_cloud; make sure the road (11) and ground (2) classes exist (propose { action: 'start' } and classify_cloud { steps: ['ground', 'road'] } otherwise).
2. Look at a few cross-sections: slice_series { at: 'station', alignment: '{{alignment|Main road}}', from: 0, to: (its length), step: 20,
   thickness: 0.5 } and view_clip in pane 2: the kerb is a 100–200 mm step at the road edge.
3. detect_edges { kind: 'kerb', alignment: '{{alignment|Main road}}', layer: 'Kerbs', propose: true }: kerb top and bottom
   lines with their height; extract_edges { kind: 'kerb', …, as_breaklines: true } (#301) also makes the surface follow them.
4. Check: a level slab over the road, set_cloud_style { depth: 'xray' }, select the kerb lines, screenshot; step_slice
   through the sections to see the lines sit on the kerb top and bottom.
5. Explain the quality report: length found, gaps, RMS to the points, where it is doubtful. Leave it as a proposal.`,
  },
  classify_and_clean: {
    description: 'Classify a scan (noise, ground, vegetation, buildings, road), review the counts, hide vegetation and noise',
    arguments: [{ name: 'cloud', description: 'the point cloud (default the first)' }],
    text: `Classify and clean the scan {{cloud|(the first point cloud)}}.
1. describe_cloud and list_cloud_classes: what is classified already?
2. propose { action: 'start' }, then classify_cloud { steps: ['noise', 'ground', 'vegetation', 'buildings', 'road'],
   only_unclassified: true }. Never overwrite existing or locked classes (overwrite: true, lock: false), and never
   delete points (set_point_class delete), without asking me (ask_user).
3. Review the before / after counts per class (ground usually 40–80 % of a site scan); say what looks wrong. Fix small
   mistakes by hand: select_points (within a clip, classes, elevation, grow_from) then set_point_class { class }.
   Leave the proposal for me to accept.
4. Hide vegetation and noise: set_cloud_filter { classes: { hide: [3, 4, 5, 7, 18] } }, colour by class
   (set_cloud_style { color_by: 'classification' }), screenshot, and summarise what is shown.`,
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
