// Adds MyModellerReel to Claude Desktop's MCP servers (claude_desktop_config.json). Run: npm run mcp:config
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp', 'server.js');
const dir = process.platform === 'win32' ? join(process.env.APPDATA, 'Claude') : join(homedir(), 'Library', 'Application Support', 'Claude');
const file = join(dir, 'claude_desktop_config.json');
mkdirSync(dir, { recursive: true });
let cfg = {};
if (existsSync(file)) {
  cfg = JSON.parse(readFileSync(file, 'utf8'));
  copyFileSync(file, `${file}.bak`);
}
cfg.mcpServers = { ...(cfg.mcpServers || {}), mymodellerreel: { command: 'node', args: [server] } };
writeFileSync(file, JSON.stringify(cfg, null, 2));
console.log(`Added "mymodellerreel" to ${file} (backup: ${file}.bak). Restart Claude Desktop.`);
