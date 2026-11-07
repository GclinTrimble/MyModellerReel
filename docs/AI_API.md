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
| scene | `get_scene`, `get_entity` (faces with normals for push_pull), `list_elements`, `list_components`, `list_commands` (`query`, `toolset`), `select` (also `invert`), `select_where` (name, colour, tag, size, metadata, similar_to), `measure`, `bounds_of`, `raycast`, `find_free_space`, `what_is_at` (a point of the view), `screenshot` |
| arrange | `align`, `distribute`, `place_on` (top or any face), `against`, `stack` |
| create | `create_box`, `create_cylinder`, `create_cone`, `create_sphere`, `create_prism` (2D outline + height), `create_face` (any plane), `create_lathe` (revolve), `create_curve` (polyline, spline, bezier), `create_arc` (three-point, two-point with bulge, centre or pie, tangent), `sweep` (a profile along a curve or points), `place_component` |
| parametric | `set_params`, `get_dependencies`, `bake`, `list_profiles`, `define_profile`, `list_generators`, `create_parametric` |
| recipe | `save_recipe`, `list_recipes`, `replay_recipe`, `record_macro`, `stop_macro` |
| edit | `push_pull`, `move`, `rotate`, `scale`, `set_transform`, `duplicate` (linear + radial arrays), `mirror`, `delete`, `group`, `ungroup`, `set_pivot` (hinges), `set_material`, `set_properties`, `set_metadata`, `set_curve`, `imprint` (an outline on a face, for push_pull recesses, bosses and holes), `offset_face`, `move_elements` (a face, an edge such as "top front", a corner, or vertices), `repair_mesh`, `make_component` / `edit_component` / `make_unique` / `replace_component`, `set_tag_visibility`, `boolean`, `propose`, `undo`, `redo`, `new_model` (`duplicate` with `live: true` makes a live array) |
| view | `set_camera`, `set_view`, `zoom_extents`, `set_style`, `section`, `add_scene`, `go_to_scene` |
| animate | `add_keyframe`, `animate` (from/to or by, with easing), `build_sequence`, `turntable`, `explode`, `animate_along_path`, `stagger`, `add_motion` / `remove_motion` (spin, oscillate, wiggle, orbit, pulse), `add_marker` / `remove_marker`, `add_caption` / `remove_caption`, `remove_keyframes`, `set_timeline`, `get_animation`, `playback` |
| file | `save`, `open`, `import`, `export` (glb, gltf, obj, stl, png, video), `render_video` (mp4 H.264, webm VP9 with transparency, gif, png sequence; any size; frame by frame) |

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
