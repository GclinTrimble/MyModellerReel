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
| **Local (Ollama)**, default | Install [Ollama](https://ollama.com), then `ollama pull mistral` (or `mistral-small`, `qwen2.5`, `llama3.1`: any model with tool calling). URL `http://127.0.0.1:11434`. Small models get a 27-command core set plus plugins; `run_script` reaches the rest. |
| **Claude** | Anthropic API key. Default model `claude-sonnet-5-5`; `claude-opus-5-5` for big builds. Claude also receives viewport screenshots. |
| **OpenAI-compatible** | Any `/v1/chat/completions` server: Mistral's API (`https://api.mistral.ai/v1`), LM Studio, vLLM, llama.cpp. |

API keys live in the app's data folder and are only used by the main process; the page never sees them.
One AI turn (however many tool calls) is a single undo step.

## 2. Claude Desktop / Claude Code (MCP)

```bash
npm run mcp:config
```

adds this to `%APPDATA%\Claude\claude_desktop_config.json` (a backup is kept):

```json
{ "mcpServers": { "mymodellerreel": { "command": "node", "args": ["<project>\\src\\mcp\\server.js"] } } }
```

Restart Claude Desktop. Claude then lists every command as a tool. The server starts MyModellerReel on the first
tool call if it is closed, returns `screenshot` as an image, and reports errors so the model can correct itself.
For Claude Code: `claude mcp add mymodellerreel -- node <project>/src/mcp/server.js`.

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
| scene | `get_scene`, `get_entity` (faces with normals for push_pull), `list_commands`, `select`, `measure`, `screenshot` |
| create | `create_box`, `create_cylinder`, `create_cone`, `create_sphere`, `create_prism` (2D outline + height), `create_face` (any plane), `create_lathe` (revolve) |
| edit | `push_pull`, `move`, `rotate`, `scale`, `set_transform`, `duplicate` (linear + radial arrays), `mirror`, `delete`, `group`, `ungroup`, `set_pivot` (hinges), `set_material`, `set_properties`, `set_tag_visibility`, `boolean`, `undo`, `redo`, `new_model` |
| view | `set_camera`, `set_view`, `zoom_extents`, `set_style`, `section`, `add_scene`, `go_to_scene` |
| animate | `add_keyframe`, `animate` (from/to or by, with easing), `build_sequence`, `turntable`, `remove_keyframes`, `set_timeline`, `get_animation`, `playback` |
| file | `save`, `open`, `import`, `export` (glb, gltf, obj, stl, png, video) |
| extend | `run_script`, `create_plugin`, `list_plugins` |
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

`api.doc` is the live model JSON; `api.geometry` is the mesh kernel.

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

`mmr` also exposes `doc`, `THREE`, `geometry`, `animation` and `toast()`. Plugins → Reload picks up edits.
Ask the copilot "create a plugin that…" and it writes, saves and loads one with `create_plugin`.
