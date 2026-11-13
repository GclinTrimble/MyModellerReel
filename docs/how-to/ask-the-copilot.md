# Ask Plumb to build or change something

You would rather say what you want than click it: Plumb (Claude, or a local model) drives the same commands as the menus.

![Ask Plumb to build or change something](media/ask-the-copilot/ask-the-copilot.gif)

## In the app

1. The AI panel: type what you want in plain words and press Enter. It sees your selection; each of its turns is one undo step; the stop button stops it.
   ![The AI panel: type what you want in plain words and press Enter. It sees your se](media/ask-the-copilot/01.jpg)
2. **Ctrl+K** (or the search at the bottom of the window) searches every command by what you want to do ("hinge a door") and can ask an agent from there. Over the model, Ctrl+K and Ctrl+Space open it where you point, with that point; the matches list above the field.
   ![Ctrl+K searches every command by what you want to do ("hinge a door") and can as](media/ask-the-copilot/02.jpg)
3. While Plumb works, its card at the end of the thread says what it does now (thinking, reasoning, running a command), the seconds so far and the step; **Stop** ends the turn and keeps what is done. Each command shows as it runs, with its arguments, then a tick or the error and its time, and the model in the view changes as it goes. A model that reasons first shows its reasoning folded, with the latest words.
   ![While Plumb works: what it does now, the time so far, each command as it runs, and Stop](media/ask-the-copilot/03.jpg)
4. A finished turn keeps its numbers: total time, model time, tool time, steps, tokens and tokens per second. Click them for each step.

## Ask Plumb

> Add a 2 m deep terrace along the south wall, and a pergola over it.

Plumb runs the same commands as the steps above; with **AI › Propose AI changes for review** on, you accept or reject its changes first.

## From a script, the HTTP API or MCP

```js
// Any AI can drive the app through MCP (src/mcp/server.js) or the HTTP API on 127.0.0.1:7717:
await fetch('http://127.0.0.1:7717/api/run', { method: 'POST', headers: { authorization: 'Bearer <token from api.json>' }, body: JSON.stringify({ command: 'list_commands', args: { query: 'hinge a door' } }) });
```

## Good to know

- **AI › Propose AI changes for review** shows the changes as a preview to accept or reject.
- Skills (Architecture, Landscape, Jobsite…) give Plumb domain know-how.
- The command `ai_turns` (also over the HTTP API and MCP) gives the last turns' timings and each step's: model time against tool time shows where a slow turn spends it.

## Related

- [Check a model and count what is in it](howto:review-and-quantities)
