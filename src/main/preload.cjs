// The only bridge from the page to the system. Each channel is checked in main.cjs.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = new Set([
  'app:info', 'app:close-confirmed', 'settings:get', 'settings:set', 'window:title', 'shell:open-path', 'shell:open-url',
  'file:save-dialog', 'file:open-dialog', 'file:folder-dialog', 'project:copy', 'file:exists', 'file:read', 'file:read-text', 'file:read-binary', 'file:write', 'plugins:list', 'plugins:write', 'ai:chat', 'ai:abort', 'update:check', 'update:install', 'help:read',
  'account:status', 'account:sign-in', 'account:cancel', 'account:sign-out', 'account:take-over', 'startup:get', 'startup:set',
  'ai:image', 'library:list', 'library:path', 'library:add', 'library:meta', 'glb:compress', 'net:json', 'net:download', 'mesh:generate', 'voice:transcribe', 'autosave:write', 'autosave:list', 'autosave:read', 'ai:detect',
  'ai:setup-status', 'ai:ollama-start', 'ai:ollama-install', 'ai:ollama-pull', 'ai:ollama-pull-cancel', 'ai:builtin-download', 'ai:builtin-delete', 'ref:watch',
  'mytools:list', 'mytools:write', 'mytools:delete', 'codelib:call', 'feedback:save', 'feedback:list', 'feedback:share', 'feedback:export',
  'ogc:get', 'ogc:cache', 'ogc:cache-info', 'ogc:cache-clear', 'ogc:cache-limit', 'map:services', 'gpkg:write', 'gpkg:read',
]);

contextBridge.exposeInMainWorld('native', {
  invoke: (ch, ...args) => {
    if (!CHANNELS.has(ch)) throw new Error(`Unknown channel ${ch}`);
    return ipcRenderer.invoke(ch, ...args);
  },
  pathOf: (file) => webUtils.getPathForFile(file), // a file dropped on the page
  onBeforeClose: (fn) => ipcRenderer.on('app:before-close', () => fn()),
  onAccount: (fn) => ipcRenderer.on('account:status', (_, s) => fn(s)),
  onAiDelta: (fn) => ipcRenderer.on('ai:delta', (_, t, id) => fn(t, id)),
  onPullProgress: (fn) => ipcRenderer.on('ai:pull-progress', (_, p) => fn(p)),
  onRefChanged: (fn) => ipcRenderer.on('ref:changed', (_, p) => fn(p)),
  onUpdateReady: (fn) => ipcRenderer.on('update:ready', (_, v) => fn(v)),
});
