#!/usr/bin/env node
// MCP server (stdio) for MyModellerReel. Claude Desktop, Claude Code or any MCP client launches this file;
// it exposes every command of the running app as an MCP tool (plugins included) and starts the app if needed.
// Zero dependencies: MCP over stdio is newline-delimited JSON-RPC 2.0.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = process.env.APPDATA ? join(process.env.APPDATA, 'MyModellerReel') : join(homedir(), '.config', 'MyModellerReel');
const log = (...a) => process.stderr.write(`[mymodellerreel-mcp] ${a.join(' ')}\n`); // stdout is the protocol

function apiInfo() {
  try {
    return JSON.parse(readFileSync(join(DATA, 'api.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** The app writes its command list and guide here, so tools can be listed while it is closed. */
function cached(file) {
  try {
    return readFileSync(join(DATA, file), 'utf8');
  } catch {
    return null;
  }
}

async function call(method, path, body) {
  const info = apiInfo();
  if (!info) throw new Error('not running');
  const res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(600000),
  });
  if (path.startsWith('/api/screenshot')) return Buffer.from(await res.arrayBuffer()).toString('base64');
  const json = await res.json();
  if (res.status >= 400) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

let launching = null;
/** Make sure the desktop app is up; start it (once) if it is not. */
async function ensureApp() {
  try {
    await call('GET', '/api/health');
    return;
  } catch {
    /* start it below */
  }
  launching ||= (async () => {
    log('starting MyModellerReel…');
    const electron = createRequire(import.meta.url)('electron'); // in plain Node this is the path to electron.exe
    spawn(electron, [ROOT], { detached: true, stdio: 'ignore', cwd: ROOT }).unref();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await call('GET', '/api/health');
        return;
      } catch {
        /* still starting */
      }
    }
    throw new Error('MyModellerReel did not start within 30 s.');
  })().finally(() => (launching = null));
  return launching;
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    // Don't launch the app just because Claude Desktop started; the first tool call does that.
    const guide = await call('GET', '/api/guide').catch(() => cached('guide.txt') || '');
    return reply(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'mymodellerreel', version: '0.1.0' },
      instructions: `MyModellerReel is a desktop 3D modeller and animation sequencer. Every tool edits the live model the user sees.\n${guide}`,
    });
  }
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return;
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    const live = await call('GET', '/api/commands').catch(() => null);
    const list = live?.ok ? live.result : JSON.parse(cached('commands.json') || 'null');
    if (!list) {
      return reply(id, { tools: [{ name: 'get_scene', description: 'Start MyModellerReel and summarise the model.', inputSchema: { type: 'object', properties: {} } }] });
    }
    return reply(id, {
      tools: list.map((c) => ({
        name: c.name,
        description: `[${c.category}] ${c.description}`,
        inputSchema: { type: 'object', ...c.params },
        annotations: { readOnlyHint: !c.mutates && ['scene', 'view'].includes(c.category) },
      })),
    });
  }
  if (method === 'tools/call') {
    await ensureApp();
    const r = await call('POST', '/api/run', { command: params.name, args: params.arguments || {} });
    if (!r.ok) return reply(id, { content: [{ type: 'text', text: r.error }], isError: true });
    const image = r.result?.image;
    if (image) {
      return reply(id, {
        content: [
          { type: 'image', data: image.split(',')[1], mimeType: 'image/png' },
          { type: 'text', text: 'Screenshot of the MyModellerReel viewport.' },
        ],
      });
    }
    return reply(id, { content: [{ type: 'text', text: JSON.stringify(r.result ?? { ok: true }) }] });
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(null, -32700, 'Parse error');
      continue;
    }
    handle(msg).catch((e) => msg.id !== undefined && fail(msg.id, -32000, e.message));
  }
});
process.stdin.on('end', () => process.exit(0));
log('ready');
