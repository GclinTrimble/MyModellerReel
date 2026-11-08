# AI, API, MCP and plugins

Everything in MyModellerReel goes through **one command registry** (`src/core/commands.js`). The tool bar, menus,
the in-app copilot, the HTTP API, the MCP server and plugins all call the same commands, so:

- anything a person can do, an AI can do;
- anything a plugin adds is instantly a button, an AI tool, an HTTP endpoint and an MCP tool.

`list_commands` returns every command with its JSON Schema. Conventions (also sent to every AI):
metres, **Y is up**, X red, Z green; new shapes sit on the ground with their pivot at the centre of their base;
entities are referenced by id (`e12`) or exact name; omitting ids means "the selection".

## 1. The copilot (inside the app)

AI tab → type what you want. Provider in Settings:

| Provider | Setup |
| --- | --- |
| **Local (Ollama)**, default | Install [Ollama](https://ollama.com), then `ollama pull mistral` (or `mistral-small`, `qwen2.5`, `llama3.1`: any model with tool calling). URL `http://127.0.0.1:11434`. Small models get a routed subset per request (see below). |
| **Claude** | Anthropic API key. Default model `claude-sonnet-5-5`; `claude-opus-5-5` for big builds. Claude also receives viewport screenshots. |
| **OpenAI-compatible** | Any `/v1/chat/completions` server: Mistral's API (`https://api.mistral.ai/v1`), LM Studio, vLLM, llama.cpp. |

API keys live in the app's data folder and are only used by the main process; the page never sees them.
One AI turn (however many tool calls) is a single undo step. With **Propose** on (the branch icon in the copilot
header, or AI → Propose), the turn's changes show as a tinted preview with red ghosts for removals, and wait for
Accept or Reject. Any client can do the same with `propose` (`start`, `accept`, `reject`, `status`).

**Tool routing for local models.** Small models pick worse tools as the list grows, so Ollama models get about 18
tools per request: an always-on core (`get_scene`, `get_entity`, `list_commands`, `run_script`, `select`,
`undo`), the commands already used in the chat, and the best keyword matches for the request (with one example
call each). Settings → AI → *Tools for local models* switches to a fixed toolset or all commands. The model can find
the rest with `list_commands` and a `query`. Every command checks its arguments: unambiguous slips (`"2"` for 2,
one id for a list, a JSON string for an array) are fixed, and real mistakes come back as errors that name the
expected type, the valid values or the closest command, so the model can retry.

**Eval harness.** `npm run eval -- --model ollama:mistral --model anthropic:claude-sonnet-5-5` runs the tasks in
`scripts/eval-tasks.js` through the same agent loop and scores the resulting scene. `--routing off` compares with the
full tool list, `--task <name>` runs one task, `--json out.json` keeps the rows. `--model mock` replays the
reference solutions (it is also the harness's own test).

## 2. Claude Desktop / Claude Code (MCP)

```bash
npm run mcp:config
```

adds this to `%APPDATA%\Claude\claude_desktop_config.json` (a backup is kept):

```json
{ "mcpServers": { "mymodellerreel": { "command": "node", "args": ["<project>\\src\\mcp\\server.js"] } } }
```

Restart Claude Desktop. Claude then lists every command as a tool, can read **resources** (`mmr://scene`,
`mmr://selection`, `mmr://guide`, `mmr://animation`, `mmr://quantities`, `mmr://commands`) and offers **prompts** for
common workflows (`build_house`, `assembly_sequence`, `turntable_reel`, `review_model`, and `skill_<domain>` for each
domain skill). The server starts MyModellerReel on the first
tool call if it is closed, returns `screenshot` as an image, and reports errors so the model can correct itself.
For Claude Code: `claude mcp add mymodellerreel -- node <project>/src/mcp/server.js`.
For MCP clients that handle few tools well, add `"env": { "MMR_TOOLSETS": "modelling,animation" }` to the server
config: only those toolsets (modelling, animation, query, view, files, ai) and the core are listed.

## 3. HTTP API (scripts, other apps, agents)

Listens on `127.0.0.1:7717`. Every request needs `Authorization: Bearer <token>`; the port and token are in
`%APPDATA%\MyModellerReel\api.json`. Requests that carry a browser `Origin` are refused, so web pages cannot drive it.

| Request | Does |
| --- | --- |
| `GET /api/health` | `{ ok, app, version }` |
| `GET /api/commands` | every command and its schema |
| `GET /api/guide` | the conventions text |
| `POST /api/run` `{ command, args }` | runs one command → `{ ok, result }` or `{ ok: false, error }` |
| `POST /api/batch` `{ commands: [{command, args}], stopOnError }` | runs several |
| `GET /api/screenshot?width=1024` | PNG of the 3D view |
| `GET /api/window-screenshot` | PNG of the whole window (for UI agents) |
| `POST /api/input` `{ events: [...] }` | synthetic mouse/keyboard events (Electron `sendInputEvent` format, plus `{type:'wait',ms}`), coordinates in DIPs |

```powershell
$a = Get-Content "$env:APPDATA\MyModellerReel\api.json" | ConvertFrom-Json
Invoke-RestMethod "http://127.0.0.1:$($a.port)/api/run" -Method Post -Headers @{Authorization="Bearer $($a.token)"} `
  -ContentType 'application/json' -Body '{"command":"create_box","args":{"width":2,"height":1,"depth":1}}'
```

## 4. Commands at a glance

| Category | Commands |
| --- | --- |
| help and app | `list_howtos` (help pages by intent), `open_howto`, `list_templates`, `new_from_template`, `model_info`, `check_for_updates`, `restart_to_update` |
| scene | `get_scene`, `get_entity` (faces with normals for push_pull), `list_elements`, `list_components`, `list_commands` (`query`, `toolset`), `select` (also `invert`), `select_where` (name, colour, tag, size, metadata, similar_to), `measure`, `bounds_of`, `raycast`, `find_free_space`, `what_is_at` (a point of the view), `screenshot` |
| arrange | `align`, `distribute`, `place_on` (top or any face), `against`, `stack` |
| create | `create_box`, `create_cylinder`, `create_cone`, `create_sphere`, `create_prism` (2D outline + height), `create_face` (any plane), `create_lathe` (revolve), `create_curve` (polyline, spline, bezier), `create_arc` (three-point, two-point with bulge, centre or pie, tangent), `sweep` (a profile along a curve or points), `place_component` |
| parametric | `set_params`, `get_dependencies`, `bake`, `list_profiles`, `define_profile`, `list_generators`, `create_parametric` |
| recipe | `save_recipe`, `list_recipes`, `replay_recipe`, `record_macro`, `stop_macro` |
| edit | `copy`, `cut`, `paste` (in place, between models, keeping real-world position), `purge`, `push_pull`, `move`, `rotate`, `scale`, `set_transform`, `duplicate` (linear + radial arrays), `mirror`, `delete`, `group`, `ungroup`, `set_pivot` (hinges), `set_material`, `set_properties`, `set_metadata`, `set_curve`, `imprint` (an outline on a face, for push_pull recesses, bosses and holes), `offset_face`, `move_elements` (a face, an edge such as "top front", a corner, or vertices), `repair_mesh`, `make_component` / `edit_component` / `make_unique` / `replace_component`, `set_tag_visibility`, `boolean`, `propose`, `undo`, `redo`, `new_model` (`duplicate` with `live: true` makes a live array) |
| terrain | `set_coordinate_system`, `set_base_point`, `set_units`, `add_point` (N/E/Z, a model point, COGO bearing + distance, or a grid), `edit_points`, `import_points` (PNEZD/PENZD/XYZ text), `export_points`, `query_points`, `add_breakline`, `add_boundary`, `edit_linework`, `define_feature_code` / `load_feature_library` / `export_feature_library` / `process_codes` (field codes to linework and objects), `create_surface` (live TIN), `set_surface_sources`, `rebuild_surface`, `edit_triangles`, `check_surface`, `cut_fill` (map), `volume_report`, `cut_fill_at`, `create_alignment` / `set_alignment` (arcs and vertical curves), `create_corridor` (daylighting), `design_line_slope`, `design_plane`, `design_trench`, `design_offset_surface`, `design_road`, `surface_contours` (live, labelled) / `export_contours` / `label_contours`, `analyze_surface` (elevation, slope, aspect, difference; legend), `surface_profile`, `cross_sections`, `create_pad` / `set_batter` (batters that daylight, merged design surface), `smooth_surface`, `terrain_from_contours`, `assign_contour_elevations`, `create_terrain` / `sculpt_terrain` / `stamp` (sculpting), `drape`, `drape_image`, `water_level`, `import_terrain` (GeoTIFF / ASCII grid DEM), `text_to_points` |
| look | `set_style` (render_style: shaded, hidden_line, monochrome, sketchy), `set_camera` (lens mm, projection parallel, two_point), `set_effects` (ao, bloom, outline, dof, exposure, vignette), `set_environment` (studio, sky, sunset, night, hdri), `create_light` / `set_light` (point, spot, area), `set_texture` (image at real size: box, planar, cylindrical), `set_material_maps` (glass, clear coat, normal / roughness / AO maps), `set_geolocation`, `set_sun_time`, `animate_sun` (sun studies), `render_image` (path-traced still), `ai_render`, `generate_texture` (image model: ComfyUI or OpenAI-compatible) |
| annotate | `add_dimension` (linear, aligned, radial, diameter, angular; follows the geometry), `add_label` (leader + live text template: {name} {area} {footprint} {volume} {height} {elevation} {meta.key}), `edit_annotation`, `list_annotations`, `add_guide` / `clear_guides`, `define_line_type` (and `line_type` / `line_weight` on `set_properties` and layers), `check_clashes` (real overlaps, volume and depth), `section_cut` |
| power tools | `fillet_edges`, `chamfer_edges`, `loft`, `shell`, `thicken`, `inset_face`, `extrude_faces`, `divide_edge`, `weld_edges`, `split_solid`, `intersect_faces`, `subdivide` (Catmull-Clark), `deform` (taper, twist, bend, lattice; live), `simplify_mesh`, `set_symmetry`, `create_rectangle` (3 points), `set_axes` (turned axes, grid snap), `import_2d` (SVG / DXF floor plans), `curves_to_faces`, `array_grid`, `array_path`, `insert_asset` / `list_assets` (component library), `save_selection` / `select_set` / `delete_selection_set`; `set_layer` folder, `set_style` color_by |
| animation depth | `save_clip` / `apply_clip` / `list_clips` (reusable, relative), `simulate_physics` (rigid bodies baked to keys), `add_shot` / `remove_shot` (camera cuts, moving shots), `add_audio` / `remove_audio` (mixed into MP4 / WebM), `animate_section` (section reveal), `attach` / `follow` / `look_at` / `remove_constraints`, `set_ease` (cubic-bezier curves), `retime`, `copy_keys`, `delete_keys`, `import_schedule` (4D from CSV, MS Project XML, P6 XER) |
| drawings | `pdf_info`, `import_pdf` (pages, drawing scale "1:500"), `import_image` (PNG, JPG, TIFF; world files and GeoTIFF tags place it), `list_underlays`, `set_underlay` (opacity, fade, black and white, crop, height, hidden PDF layers), `calibrate_underlay` (scale by a known distance, orient by a bearing, move onto a survey point, drawing scale), `add_control_pair` / `edit_control_pair` / `georeference_underlay` (Helmert or affine least squares, local coordinates) / `georef_report`, `export_world_file`, `pdf_linework_stats`, `extract_linework` (filter by PDF layer, colour, width, dashes, window; welded, joined, hatching skipped), `list_drawing_text`, `elevate_linework` (constant, surface, grade, slope, spot-height text), `linework_to_breaklines`, `extrude_linework`, `sweep_linework` |
| drafting | `offset_curve`, `trim`, `extend`, `fillet`, `chamfer`, `join_curves`, `explode_curve`, `break_curve`, `simplify_curve`, `divide_curve` |
| layers | `query_features` (by layer, code, attribute values and ranges, elevation, inside a boundary), `edit_attributes` (bulk, checked against the layer schema), `create_layer`, `set_layer` (globs: "C-ROAD/*"; colour, lock, line type, weight, attribute schema, current), `list_layers`, `move_to_layer`, `merge_layers`, `map_layers`, `save_layer_state`, `restore_layer_state` |
| view | `view_back`, `view_forward`, `zoom_window`, `set_units` (display: mm, cm, m, in, ft, ft-in; precision), `set_camera`, `set_view`, `zoom_extents`, `set_style`, `section`, `add_scene`, `go_to_scene` |
| animate | `add_keyframe`, `animate` (from/to or by, with easing), `build_sequence`, `turntable`, `explode`, `animate_along_path`, `stagger`, `add_motion` / `remove_motion` (spin, oscillate, wiggle, orbit, pulse), `add_marker` / `remove_marker`, `add_caption` / `remove_caption`, `remove_keyframes`, `set_timeline`, `get_animation`, `playback` |
| file | `export_drawing` (PDF / SVG sheet: views to scale, dimensions, title block), `export_section` (SVG filled to scale, DXF), `save`, `open`, `list_formats`, `import` (LandXML, IFC, DXF, Trimble JobXML and FXL, GeoJSON, Shapefile, glb, gltf, obj, stl, fbx; returns a report of what came in and what was skipped), `export` (glb, gltf, obj, stl, png, video, landxml, ifc with `schema` IFC4 / IFC4X3, dxf), `render_video` (mp4 H.264, webm VP9 with transparency, gif, png sequence; any size; frame by frame) |

Every time parameter (`start`, `end`, `time`, `from`, `to`) takes seconds or a **marker** name with an optional
offset: `add_marker { name: "roof", time: 12 }`, then `animate { …, start: "roof", end: "roof + 2" }`.
| extend | `run_script`, `create_plugin`, `list_plugins` |
| ai | `review_model` (floating parts, collisions, below ground, units, broken parametric shapes, plus a vision critique of four views; `include_images` returns them), `list_skills`, `use_skill` (architecture, product, jobsite, furniture) |
| report | `report_quantities` (count, area m², volume m³, length m, cost by material, tag, name, kind or a metadata key; CSV or JSON file) |
| plugin | whatever plugins add (built in: `create_stairs`, `create_wall` with openings) |

### `run_script`

JavaScript run inside the app as one undo step. Every command is a function on `api`:

```js
const ids = [];
for (let i = 0; i < 8; i++) {
  const c = await api.create_cylinder({ radius: 0.25, height: 4, position: [Math.cos(i * Math.PI / 4) * 5, 0, Math.sin(i * Math.PI / 4) * 5] });
  ids.push(c.id);
}
await api.build_sequence({ ids, effect: 'grow', stagger: 0.25 });
return ids;
```

`api.doc` is the live model JSON; `api.geometry` is the mesh kernel; `params` holds the script's `params` argument.
A script is all or nothing: if it throws, the model is left as it was (every single command is atomic too).

## 4b. Parametric shapes, sweeps and recipes

- **Parametric shapes.** `create_*` shapes, sweeps, live arrays and plugin objects keep their recipe
  (`get_entity` → `derived: { generator, inputs, params }`). `set_params` changes it and the shape rebuilds; so does
  everything made from it, in dependency order, inside the same undo step. A cycle or a deleted input shows as an
  `error` on the entity instead of breaking the model. `bake` freezes one into a plain shape; push/pull and booleans
  bake automatically.
- **Sweeps.** `sweep { path, profile, profile_params, anchor, mirror }`: `path` is a curve entity (the sweep follows
  the curve when it moves or `set_curve` changes it) or points; `profile` is a name from `list_profiles` (rectangle,
  pipe, handrail, kerb, gutter, i_beam, channel, angle, ditch, retaining_wall, moulding) or `[[u, v], …]`.
  `define_profile` saves your own, from points or from a drawn face. Corners are mitred; the profile stays upright.
- **Recipes.** Every change is journaled (`doc.journal`) with the selection made explicit. `save_recipe` keeps it (or
  steps you write, with `"{{expr}}"` placeholders over `params`); `replay_recipe { name, params }` rebuilds the model
  with other values as one undo step. `record_macro` / `stop_macro` capture what you do next as a recipe and a
  `run_script` snippet, or (`as: "plugin"`) as a plugin command.

## 5. Plugins

A plugin is one ES module in `%APPDATA%\MyModellerReel\plugins\` (yours) or `plugins\` (built in):

```js
export default function (mmr) {
  mmr.registerCommand({
    name: 'create_table',
    description: 'Table with four legs',
    params: { type: 'object', properties: { width: { type: 'number' }, depth: { type: 'number' } } },
    async run({ width = 1.6, depth = 0.9 }, mmr) {
      const top = await mmr.run('create_box', { width, depth, height: 0.04, position: [0, 0.71, 0], name: 'Top', color: '#b58a57' });
      const legs = [];
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        legs.push((await mmr.run('create_box', { width: 0.05, depth: 0.05, height: 0.71, position: [x * (width / 2 - 0.05), 0, z * (depth / 2 - 0.05)] })).id);
      return mmr.run('group', { ids: [top.id, ...legs], name: 'Table' });
    },
  });
  mmr.addToolbarButton({ icon: 'table', label: 'Table', command: 'create_table' });
}
```

`mmr` also exposes `doc`, `THREE`, `geometry`, `animation`, `csg.booleanMeshes` and `toast()`. Library → Reload
picks up edits.

A plugin can also add a **generator**, so its shapes keep their parameters:

```js
mmr.registerGenerator('shelf', {
  description: 'Bookshelf',
  params: { width: 'm', shelves: 'count' },
  run: ({ params: { width = 0.8, shelves = 4 } }) => ({ mesh: /* { v: [[x,y,z]…], f: [[i,j,k…]…] } in local space */ }),
});
// then: mmr.run('create_parametric', { generator: 'shelf', params: { width: 1.2 } }); later set_params changes it
```

Generators with `world: true` build in world space and return `G.recenter(mesh)` (`{ mesh, origin }`), like the
built-in `sweep` and `array`. The built-in plugin's `create_stairs` and `create_wall` work this way.
Ask the copilot "create a plugin that…" and it writes, saves and loads one with `create_plugin`.
