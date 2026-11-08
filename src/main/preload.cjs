// The only bridge from the page to the system. Each channel is checked in main.cjs.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'app:info', 'app:close-confirmed', 'settings:get', 'settings:set', 'window:title', 'shell:open-path', 'shell:open-url',
  'file:save-dialog', 'file:open-dialog', 'file:read', 'file:read-text', 'file:read-binary', 'file:write', 'plugins:list', 'plugins:write', 'ai:chat', 'ai:abort', 'update:check', 'update:install', 'help:read',
  'account:status', 'account:sign-in', 'account:cancel', 'account:sign-out', 'account:take-over', 'startup:get', 'startup:set',
  'ai:image', 'library:list', 'library:path', 'glb:compress', 'net:json', 'net:download', 'mesh:generate', 'voice:transcribe', 'autosave:write', 'autosave:list', 'autosave:read',
]);

contextBridge.exposeInMainWorld('native', {
  invoke: (ch, ...args) => {
    if (!CHANNELS.has(ch)) throw new Error(`Unknown channel ${ch}`);
    return ipcRenderer.invoke(ch, ...args);
  },
  onBeforeClose: (fn) => ipcRenderer.on('app:before-close', () => fn()),
  onAccount: (fn) => ipcRenderer.on('account:status', (_, s) => fn(s)),
  onAiDelta: (fn) => ipcRenderer.on('ai:delta', (_, t) => fn(t)),
  onUpdateReady: (fn) => ipcRenderer.on('update:ready', (_, v) => fn(v)),
});
