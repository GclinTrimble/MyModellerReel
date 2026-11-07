# MyModellerReel: notes for Claude

AI-first 3D modeller + animation sequencer. Electron 45, three.js 0.187, plain ES modules (no bundler, no TypeScript).

## The one rule

Every capability is a command in `src/core/commands.js` (or a plugin's `registerCommand`). UI tools commit through
`app.reg.run(...)`; the copilot, HTTP API and MCP list and call the same registry. Never add a feature that only the
UI can reach. Mutating commands set `mutates: true` (one undo snapshot each; `run_script` and AI turns batch).

## Layout

- `src/core/` pure modules, run in Node tests: `geometry.js` (polygon mesh kernel, push/pull, primitives,
  triangulation), `document.js` (doc JSON, Store with snapshot undo and proposals, transforms), `animation.js` (keys,
  easing, evaluate), `commands.js` (registry + GUIDE text sent to AIs), `schema.js` (argument checking),
  `routing.js` (toolsets, ranking, examples), `query.js` (selection, raycast, free space, placement maths),
  `agent.js` (provider protocols and the turn loop shared by the copilot and `npm run eval`), `curves.js` (curves,
  sweep), `profiles.js` (sweep profile library), `derived.js` (generators and the live dependency graph), `csg.js`.
- Entities: `type` mesh | group | curve. A mesh may carry `derived` (its recipe): edits that change the mesh by hand
  must `R.bake(e)` first. Commands are atomic (`Store.rollback` on error) and journaled into `doc.journal`.
- Keep command bodies in `commands.js` short: put the maths in a pure module with its own test.
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

- `npm test` (core). `npm run e2e` (Playwright on Electron: sign-in against a mock Supabase, and
  `features.e2e.js` driving `window.mmr` in the real renderer). `npm run eval -- --model mock` checks the eval tasks.
- To run the app without sign-in and with its own data folder: `MMR_TEST=1 MMR_SUITE_URL= MMR_HOME=<dir> npx electron .`
  (`src/main/suite.json` from a release build otherwise turns the sign-in gate on).
- Sign-in is required (#115, MyVoiceReel's `docs/SUITE_ACCOUNT.md`): `npm start` without `MYSTUDIOREEL_SUPABASE_URL`
  and `MYSTUDIOREEL_SUPABASE_ANON_KEY` has no sign-in screen; `npm run dist` refuses to build without them (repo
  variables). E2E sets `MMR_TEST`, `MMR_SUITE_URL` and `MMR_HOME`, and uses the `MyStudioReel/account-test` credential.
- Run the app (`npm start`) and drive it over the HTTP API: `POST /api/run`, `GET /api/window-screenshot`,
  `POST /api/input` for real clicks (DIP coordinates: screenshots are physical pixels, divide by the display scale).
- Read `%APPDATA%\MyModellerReel\renderer.log` for page errors.
