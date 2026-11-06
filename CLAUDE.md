# MyModellerReel: notes for Claude

AI-first 3D modeller + animation sequencer. Electron 45, three.js 0.187, plain ES modules (no bundler, no TypeScript).

## The one rule

Every capability is a command in `src/core/commands.js` (or a plugin's `registerCommand`). UI tools commit through
`app.reg.run(...)`; the copilot, HTTP API and MCP list and call the same registry. Never add a feature that only the
UI can reach. Mutating commands set `mutates: true` (one undo snapshot each; `run_script` and AI turns batch).

## Layout

- `src/core/` pure modules, run in Node tests: `geometry.js` (polygon mesh kernel, push/pull, primitives,
  triangulation), `document.js` (doc JSON, Store with snapshot undo, transforms), `animation.js` (keys, easing,
  evaluate), `commands.js` (registry + GUIDE text sent to AIs).
- `src/main/main.cjs` window, settings (`%APPDATA%\MyModellerReel\settings.json`), file IPC with extension allow-lists,
  AI provider proxy (keys never reach the page), HTTP API on 127.0.0.1:7717 (token in `api.json`), renderer errors
  to `renderer.log`.
- `src/renderer/` `app.js` bootstrap and `window.mmr`, `viewport.js`, `tools.js`, `ui.js`, `timeline.js`, `ai.js`, `io.js`.
- `src/mcp/server.js` stdio MCP, zero deps, proxies the HTTP API, launches the app on first tool call.

## Conventions

- Metres, Y up. Mesh faces are CCW around their outward normal. Primitives have their pivot at the base centre.
- Darkroom tokens only in CSS (`tokens.css` is the family file; app colours in `styles.css` `:root`).
- Icons: Phosphor class names (`ph ph-…`). Check a name exists in `node_modules/@phosphor-icons/web/src/regular/style.css`.

## Check your work

- `npm test` (core).
- Run the app (`npm start`) and drive it over the HTTP API: `POST /api/run`, `GET /api/window-screenshot`,
  `POST /api/input` for real clicks (DIP coordinates: screenshots are physical pixels, divide by the display scale).
- Read `%APPDATA%\MyModellerReel\renderer.log` for page errors.
