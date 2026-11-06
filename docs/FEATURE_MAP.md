# Feature map: SketchUp 2026 → MyModellerReel

## How this was reverse engineered

No binary was decompiled. The teardown uses what SketchUp 2026 ships in plain files on this PC
(`C:\Program Files\SketchUp\SketchUp 2026\SketchUp\`):

- `Resources\en-US\commands.json`: SketchUp's own catalogue of its **187 commands** (key, title, menu, tags).
  This is the inventory below.
- `Importers\`, `Exporters\`, `*.strings`: the file formats it reads and writes.
- `ShippedExtensions\`: what Trimble ships as extensions (Sandbox, Dynamic Components, AI Assistant, Diffusion…).

Behaviour (push/pull sliding prisms, inference snapping, typed measurements, `x5` arrays, 15° protractor snaps,
double-click to repeat push/pull, edit-inside-group context) was reproduced from how the product is used, not
from its code. Names, icons and text are our own.

Legend: ✅ built · 🤖 doable today through the AI / `run_script` · 🔜 roadmap · ➖ deliberately not needed

## The 187 commands, grouped

| Area | SketchUp command(s) | MyModellerReel | |
| --- | --- | --- | --- |
| **Draw** | Line | Line tool (L), closes into a face | ✅ |
| | Rectangle, Rotated rectangle | Rectangle tool (R) on the ground or on any face plane; typed `3,2` | ✅ / 🔜 rotated |
| | Circle, Polygon | Circle (C), Polygon (G), typed radius, `48s` sides | ✅ |
| | Arc, 2-point arc, 3-point arc, Pie | `create_prism` with arc points via `run_script` | 🤖 / 🔜 tools |
| | Freehand | | 🔜 |
| | 3D Text | | 🔜 |
| **Modify** | Push/Pull | Push/Pull (P): slides prism faces, extrudes others, typed distance, double-click repeats, snaps to other geometry | ✅ |
| | Move (+ copy, arrays) | Move (M), Ctrl copies, `x5` / `/5` arrays, arrow-key axis lock; `duplicate` also does radial arrays | ✅ |
| | Rotate | Rotate (Q), protractor on faces, 15° snaps, typed angle | ✅ |
| | Scale | Scale (S), typed factor or `1,2,1` | ✅ |
| | Flip along | `mirror` | ✅ |
| | Follow Me | `create_lathe` covers revolve; path sweep not yet | ✅ / 🔜 |
| | Offset | | 🔜 |
| | Divide, Weld edges, Intersect faces (×3) | | 🔜 |
| | Soften / smooth edges | automatic: edges under 25° are hidden | ✅ |
| **Solid tools** | Union, Outer shell | `boolean union` | ✅ |
| | Subtract, Trim | `boolean subtract` (`keep_tools` = Trim) | ✅ |
| | Intersect | `boolean intersect` | ✅ |
| | Split | | 🔜 |
| **Construct** | Tape measure | Tape (T), `measure` command | ✅ (guides 🔜) |
| | Section plane, Section cuts/fill/planes | Section tool (X): click a face, slide the cut | ✅ (fill 🔜) |
| | Protractor, Dimension, Text, Axes, Comment | | 🔜 |
| **Select** | Select, Select all/none | Select (Space), box select, Shift/Ctrl, Ctrl+A, Esc | ✅ |
| | Lasso, Invert, Deselect edges/faces | | 🔜 / ➖ |
| **Edit** | Undo, Redo | snapshot undo; every AI turn and every script is ONE step | ✅ |
| | Delete, Hide, Unhide all/last/selected, Lock, Unlock | Del, Edit menu, Outliner eye/lock | ✅ |
| | Make group, Explode, Close group, edit inside | Ctrl+G, Ctrl+Shift+G, double-click / Esc | ✅ |
| | Make component (instances) | | 🔜 |
| | Copy, Cut, Paste, Paste in place | Duplicate (Ctrl+D) | 🔜 clipboard |
| **Paint** | Paint bucket, Sample material | Paint (B), Alt samples, 16 PBR presets | ✅ |
| | Position/Project/Reset texture, Make unique texture | | 🔜 textures |
| **Tags** | Tag tool, tag visibility | Entity panel tag field, Outliner tag eyes, `set_tag_visibility` | ✅ |
| | Color by tag, Show new tags, dashes | | 🔜 |
| **Camera** | Orbit, Pan, Zoom, Zoom extents, Zoom selection | middle/right mouse, wheel to cursor, O/H tools, Shift+Z | ✅ |
| | Standard views (top/front/…/iso), Field of view | view bar, `set_view`, `set_camera fov` | ✅ |
| | Zoom window, Previous/Next view, Align view | | 🔜 |
| | Parallel / Perspective / Two-point | | 🔜 |
| | Position camera, Walk, Look around | | 🔜 |
| **Scenes** | Create scene, Next/Previous scene | Scenes panel, `add_scene`, `go_to_scene` | ✅ |
| | Play animation (between scenes) | "Animate through scenes", plus a full keyframe timeline | ✅ and far beyond |
| **Styles** | Edges, Shaded, X-ray, Wireframe, Shadows, Sun, Grid, Sky/ground, transparency | view bar + View menu + `set_style` | ✅ |
| | Hidden line, Monochrome, Back edges, Profiles, Depth cue, Jitter, Extension, Endpoints, Edge colour modes | | 🔜 / ➖ |
| | Photoreal materials, Environment / skydome / reflections, Ambient occlusion, Fog | PBR metal/rough only | 🔜 |
| | Inference, Crosshairs, Grid snapping | endpoint/midpoint/axis/face inference with labels | ✅ / 🔜 |
| **Files** | New, Open, Save, Save as | GLB is the native file (editable round-trip) | ✅ |
| | Insert / Import (3DS, DAE, DEM, DWG, GLB, IFC, KMZ, STL, USDZ…) | GLB, glTF, OBJ, STL, FBX | ✅ / ➖ CAD+BIM |
| | Export PNG, OBJ, STL, (DAE, FBX, 3DS, DWG, DXF, KMZ, VRML, XSI, IFC) | PNG (4K), GLB, glTF, OBJ, STL, **video** | ✅ / ➖ |
| | New from template, Purge unused, Print | | 🔜 / ➖ |
| **Extensions** | Extension Manager / Warehouse, Ruby console | Plugins panel, hot-loaded JS plugins, `run_script`, AI-written plugins | ✅ |
| | 3D Warehouse | | 🔜 (import from URL) |
| **AI** | AI Assistant | Copilot panel: Claude, local Mistral (Ollama), any OpenAI-compatible model; acts through every command | ✅ |
| | Diffusion (AI render) | | 🔜 |
| **App** | Search, Preferences, Shortcuts, Accessibility | Command palette (Ctrl+K, falls back to "ask AI"), Settings, shortcut sheet | ✅ |
| | Check for update, Licensing, Sign-in, Analysis hub, PreDesign, Habitat | | ➖ |

## Beyond SketchUp: what MyModellerReel adds

| Gap in SketchUp | MyModellerReel |
| --- | --- |
| No real animation (only scene-to-scene camera tweens) | Keyframe timeline for position, rotation, scale, opacity, colour, visibility and the camera; 7 easings; draggable keys; Auto-key |
| No sequencing | `build_sequence`: 4D-style construction/assembly sequences (rise, drop, grow, fade, slide; bottom-up order) |
| Presentation reels need an extra tool | `turntable`, scene-to-scene camera moves, **video export** (MP4/WebM) straight from the timeline |
| Proprietary .skp | **GLB** native: opens in Blender, Unreal, Unity, three.js, Windows 3D viewer; animation included as a glTF clip |
| AI is a side panel | AI-first: one command registry drives UI, AI, HTTP API, MCP and plugins; every AI turn is one undo step; the AI sees screenshots (Claude) |
| Ruby extensions need restarts and packaging | One JS file per plugin, hot-loaded; the AI can **write and load plugins** (`create_plugin`) |
| Cloud-bound AI | Local model support (Mistral through Ollama), Claude API, any OpenAI-compatible endpoint |
| No automation surface for agents | MCP server for Claude Desktop/Code, local HTTP API, synthetic input and window screenshots for UI agents |
| Booleans are Pro-only | Solid tools in the base app |

## Roadmap (most value first)

1. **Sticky geometry**: drawing on a face splits it (true SketchUp topology), so push/pull cuts holes without booleans.
2. **Offset** and **Follow Me** (path sweep): the two missing power tools.
3. **Components** (shared definitions, instance editing) and clipboard copy/paste.
4. Arcs, 3D text, guides, dimensions, labels.
5. Textures and UV mapping; photoreal environment lighting.
6. Parallel projection, walk/look-around, previous/next view.
7. AI render ("diffusion") of the viewport, and voice prompts through MyVoiceReel.
8. H.264 MP4 through a bundled ffmpeg; installer and auto-update (electron-builder is configured: `npm run dist`).
