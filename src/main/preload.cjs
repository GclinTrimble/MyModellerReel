// The only bridge from the page to the system. Each channel is checked in main.cjs.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'app:info', 'app:close-confirmed', 'settings:get', 'settings:set', 'window:title', 'shell:open-path', 'shell:open-url',
  'file:save-dialog', 'file:open-dialog', 'file:read', 'file:read-text', 'file:read-binary', 'file:write', 'plugins:list', 'plugins:write', 'ai:chat',
  'account:status', 'account:sign-in', 'account:cancel', 'account:sign-out', 'account:take-over', 'startup:get', 'startup:set',
]);

contextBridge.exposeInMainWorld('native', {
  invoke: (ch, ...args) => {
    if (!CHANNELS.has(ch)) throw new Error(`Unknown channel ${ch}`);
    return ipcRenderer.invoke(ch, ...args);
  },
  onBeforeClose: (fn) => ipcRenderer.on('app:before-close', () => fn()),
  onAccount: (fn) => ipcRenderer.on('account:status', (_, s) => fn(s)),
});
