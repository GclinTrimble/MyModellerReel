# MyModellerReel

<img src="resources/icon.png" alt="MyModellerReel logo" width="96">

**Model it. Reel it. Ship it.** An AI-first desktop 3D modeller with SketchUp-style push/pull modelling,
a keyframe animation timeline for sequencing, and GLB as its native file. Every tool is also a command that
Claude, a local Mistral model, scripts and plugins can call (Plumb, the in-app assistant; the MCP server; the local HTTP API).

Part of the My…Reel family (MySnipReel, MyVoiceReel, MyMotionReel); it uses the family's Darkroom design system.

## Run it

```bash
npm install
```

```bash
npm start
```

Electron's binary download is an install script; if your npm blocks install scripts, run `node node_modules/electron/install.js` once.

## What it does

- **Modelling**: Line, Rectangle, Circle, Polygon, Push/Pull, Move/copy/arrays, Rotate, Scale, Tape, Paint, Eraser,
  Section plane, Orbit/Pan/Zoom. Inference snapping (endpoints, midpoints, axes, faces), arrow-key axis locks and the
  Measurements box: while a tool works, just type `2`, `3,2`, `150mm`, `45`, `x5`.
- **Solids and structure**: groups (edit inside with double-click), pivots/hinges, mirror, radial arrays, booleans
  (union, subtract, intersect), tags, hide/lock, PBR materials.
- **Modelling depth**: draw on a face and push/pull it into a recess, a boss or a hole (imprint), offset/inset faces,
  move a face, edge or corner (roof slopes), arcs (Arc tool, A), mesh repair for imports, and components: edit one
  window and every copy updates (shared geometry, lighter files).
- **Survey-grade terrain**: survey points with names, codes and labels (Point tool, N, COGO, import PNEZD/CSV),
  feature codes that turn field codes into breaklines and objects, live TIN surfaces with breaklines, boundaries and
  surface checks, cut/fill maps and volume reports, alignments with corridors that daylight to the ground, and quick
  designs (sloped line, plane, trench, road). A Survey tab lists and edits every point.
- **Reading and shaping terrain**: live labelled contours, slope / elevation / aspect colours with a legend, profiles
  and cross-sections as charts, building pads with cut and fill batters merged into a design surface, smoothing,
  surfaces from contour lines, a sculpting brush (raise, lower, flatten, smooth, terrace), stamps, draping objects and
  aerial images on the ground, water levels, and real terrain from GeoTIFF or ASCII grid DEMs.
- **Drawings and georeferencing**: place PDF pages and images (world files, GeoTIFF) as underlays, calibrate them
  (a known distance, a bearing, a point) or georeference them from control points with residuals, in local project
  coordinates. Extract a PDF's vector linework by layer, colour and window; draft on it (offset, trim, extend, fillet,
  chamfer, join, break); then take it to 3D: heights from spot-level text, breaklines for the surface, buildings from
  footprints, kerbs swept along lines. A layer panel with colours, locks, the current layer and saved states.
- **Annotate and document**: dimensions (Dimension tool, D) and labels (Label tool, K) that follow the geometry and
  keep their text up to date, construction guides, 3D text for signs and titles, line types and weights on screen
  (ByLayer), a clash check on the real shapes, filled section cuts exported to SVG or DXF, and drawing sheets (PDF or
  SVG) with views to scale, overall dimensions and a title block.
- **Modelling power tools**: fillet and chamfer edges, shell, loft, thicken, extrude faces, subdivision smoothing,
  live deformers (taper, twist, bend, lattice), split / intersect / divide / weld, decimation, symmetry while
  editing, 3-point rectangles, turned drawing axes with grid snap, SVG / DXF floor plans to faces, grid and path
  arrays, a component library (starter trees, people, cars, benches, street lights; drop in your own GLBs),
  selection sets, layer folders and colour by layer.
- **Scans, sharing and your way of working**: point clouds (PLY, LAS, XYZ) with a ground surface from them, scanned
  drawings vectorised, drawings read for their scale and title, snapping to PDFs, versions and autosaves inside the
  file, document tabs, a one-file web viewer, USDZ for phone AR, 3MF for printing, GLB compression, free CC0 assets
  from Poly Haven, text to 3D, drag handles, a walk mode, your own shortcuts, voice to Plumb, and French menus.
- **Multiple views**: split the view into 2, 3 or 4 panes (3D, plan, elevations), each with its own camera, view,
  projection and wireframe; draw in any of them, resize them with the bars, maximise one, or move one to its own window
  on a second screen.
- **Roads through the terrain**: corridors with ditches, benches, a slope per side, pavement layers and superelevation;
  the road views (3D, plan, profile, cross-section) side by side; the cut through the ground shown without changing
  it, then written in when you decide; earthwork volumes with the balance, and the cut, fill and pavement as solids
  with their tonnages.
- **Quicker to use**: a short toolbar with grouped tools, navigation and views in the view bar, right-click menus, snap
  control, window and crossing selection, section planes you can manage, one Export dialog, and an AI setup that finds
  the models on your PC.
- **Drawing that behaves**: shapes drawn over a face split it, grips on corners and edges, arcs three ways and arc
  segments in lines, dimensions and labels you can still move and style, textured materials (brick, wood, stone, grass…),
  Site and Drawings ribbons, a coordinate system picker and a base point set from a point you know.
- **Friendly to use**: forms in plain words with the right control for each value, a New layer dialog, the outliner
  as a tree with drag and drop, components that follow the mouse, grouped menus and a ribbon for every menu, a path /
  alignment tool with corner radii, civil sweep profiles, surface editing by hand, and lessons with points and guided steps.
- **Animation depth**: reusable clips, a dope sheet (multi-select, drag, copy / paste, retime) and an easing curve
  editor, attach / follow / look-at constraints (a crane picking a beam), rigid-body physics baked to keys, camera
  shots with cuts, music and voiceover mixed into the render, an animated section reveal, and 4D sequences from a
  project schedule (CSV, MS Project XML, Primavera P6 XER) with the dates on screen.
- **Rendering and presentation**: styles (hidden line, monochrome, sketchy), camera lenses, parallel projection and
  two-point perspective, post effects (ambient occlusion, bloom, depth of field, vignette), environment lighting
  (studio, sky, sunset, night, HDRI), point / spot / area lights for night scenes, image textures at real size and
  physical materials (glass, clear coat, maps), the real sun from a geolocation, date and time with sun studies on
  the timeline, path-traced photoreal stills, and AI render / AI textures through a local ComfyUI or an images API.
- **Help by intent**: Help › How do I… (F1): a page per goal ("Put a PDF site plan in place", "Work out cut and fill
  for a pad"…) with step pictures, GIFs and videos, "Do it" buttons, a prompt for Plumb and the commands. Also in
  [docs/how-to](docs/how-to/README.md) and as MCP resources.
- **Getting started**: a start screen with templates (a house, a product turntable, a jobsite, a construction
  sequence), a 2-minute tour, automatic updates from GitHub releases.
- **Open formats**: LandXML (points, TIN surfaces, alignments with profiles, linework), IFC (BIM elements with
  storeys, property sets, layers and georeferencing, out as IFC4 or IFC4X3) and DXF (layers with colours and line
  types, polylines with arcs, blocks as components, 3D faces), in and out, with an import report. Feature layers
  have an attribute table. Field and GIS data: Trimble JobXML (.jxl) and feature libraries (.fxl), GeoJSON and
  Shapefiles (in and out, with attributes).
- **Parametric**: shapes keep their parameters (change a box's width or a stair's steps later), curves (Curve tool, U),
  sweeps along curves with a profile library (pipe, kerb, gutter, I-beam, retaining wall…) that follow the curve live,
  live arrays, recipes that rebuild a model with other values, and a macro recorder.
- **Animation and sequencing**: timeline with draggable keyframes and easing for position, rotation, scale, opacity,
  colour, visibility and the camera; Auto-key; build sequences (4D construction style); turntables; scenes;
  markers to aim at ("at the roof marker"), captions and titles, procedural motion (spin, oscillate, wiggle, orbit,
  pulse), exploded views, animation along a path (trucks, cranes, fly-throughs), stagger; **frame-accurate video
  render** to MP4 (H.264), WebM (transparent), GIF or PNG frames at any size; animation is saved into the GLB.
- **AI-first**: Plumb, the assistant panel (plumb: true and exact, a builder's word; Claude, Ollama/Mistral, any OpenAI-compatible API), one undo step per AI turn or a
  proposal to accept or reject, tool routing for small local models, relational placement (place on, against, stack,
  align, distribute), scene queries (raycast, free space, what is at a point), smart selection and metadata,
  screenshots for vision models, `run_script` for parametric work, AI-written plugins, and `npm run eval` to compare
  models on the same tasks. Domain skills (architecture, product, jobsite, furniture) for Plumb, a design review
  (AI → Review my model), a quantities report (File → Quantities), and MCP resources and prompts.
- **Open**: GLB/glTF/OBJ/STL/FBX in, GLB/glTF/OBJ/STL/PNG/MP4/WebM out. MyModellerReel `.glb` files reopen fully
  editable and still open in Blender, Unreal, Unity or any glTF viewer.

## Connect Claude Desktop

```bash
npm run mcp:config
```

Restart Claude Desktop and ask it to build something; it starts the app if needed. Details, the HTTP API and the
plugin format: [docs/AI_API.md](docs/AI_API.md).

## Use your local Mistral

Install Ollama, `ollama pull mistral`, keep Ollama running. Plumb uses it by default (Settings → AI to switch).

## Docs

| | |
| --- | --- |
| [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) | SketchUp 2026 teardown (its 187 commands) mapped to what is built, AI-reachable or planned |
| [docs/AI_API.md](docs/AI_API.md) | Plumb (the in-app assistant), MCP, HTTP API, `run_script`, plugins |
| [docs/BRAND.md](docs/BRAND.md) | name, logo, colours |

## Project layout

```
src/core/       pure, tested: mesh kernel, document + undo, animation, the command registry (the API)
src/main/       Electron main: window, settings, file access, AI provider proxy, local HTTP API
src/renderer/   viewport (three.js), tools, UI panels, timeline, Plumb (the assistant), file I/O, bootstrap (app.js)
src/mcp/        zero-dependency MCP server (stdio) bridging to the HTTP API
plugins/        built-in plugins (stairs, walls with openings)
tests/          node --test suites for the core
```

```bash
npm test
```

Shortcuts: Space select · L line · R rectangle · C circle · G polygon · P push/pull · M move · Q rotate · S scale ·
T tape · B paint · E eraser · X section · O orbit · H pan · Shift+Z zoom extents · K key selection ·
Shift+Space play · Ctrl+T timeline · Ctrl+K palette · Ctrl+J ask AI. Middle mouse orbits, right mouse pans.
