# MyModellerReel

<img src="resources/icon.png" alt="MyModellerReel logo" width="96">

**Model it. Reel it. Ship it.** An AI-first desktop 3D modeller with SketchUp-style push/pull modelling,
a keyframe animation timeline for sequencing, and GLB as its native file. Every tool is also a command that
Claude, a local Mistral model, scripts and plugins can call (in-app copilot, MCP server, local HTTP API).

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
- **Parametric**: shapes keep their parameters (change a box's width or a stair's steps later), curves (Curve tool, U),
  sweeps along curves with a profile library (pipe, kerb, gutter, I-beam, retaining wall…) that follow the curve live,
  live arrays, recipes that rebuild a model with other values, and a macro recorder.
- **Animation and sequencing**: timeline with draggable keyframes and easing for position, rotation, scale, opacity,
  colour, visibility and the camera; Auto-key; build sequences (4D construction style); turntables; scenes;
  markers to aim at ("at the roof marker"), captions and titles, procedural motion (spin, oscillate, wiggle, orbit,
  pulse), exploded views, animation along a path (trucks, cranes, fly-throughs), stagger; **frame-accurate video
  render** to MP4 (H.264), WebM (transparent), GIF or PNG frames at any size; animation is saved into the GLB.
- **AI-first**: copilot panel (Claude, Ollama/Mistral, any OpenAI-compatible API), one undo step per AI turn or a
  proposal to accept or reject, tool routing for small local models, relational placement (place on, against, stack,
  align, distribute), scene queries (raycast, free space, what is at a point), smart selection and metadata,
  screenshots for vision models, `run_script` for parametric work, AI-written plugins, and `npm run eval` to compare
  models on the same tasks. Domain skills (architecture, product, jobsite, furniture) for the copilot, a design review
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

Install Ollama, `ollama pull mistral`, keep Ollama running. The copilot uses it by default (Settings → AI to switch).

## Docs

| | |
| --- | --- |
| [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) | SketchUp 2026 teardown (its 187 commands) mapped to what is built, AI-reachable or planned |
| [docs/AI_API.md](docs/AI_API.md) | copilot, MCP, HTTP API, `run_script`, plugins |
| [docs/BRAND.md](docs/BRAND.md) | name, logo, colours |

## Project layout

```
src/core/       pure, tested: mesh kernel, document + undo, animation, the command registry (the API)
src/main/       Electron main: window, settings, file access, AI provider proxy, local HTTP API
src/renderer/   viewport (three.js), tools, UI panels, timeline, copilot, file I/O, bootstrap (app.js)
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
