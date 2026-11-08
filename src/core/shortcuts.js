// Custom keyboard shortcuts (#110): key combinations written one way, matched against key events.

/** "shift+ctrl+f" → "Ctrl+Shift+F"; "space" → "Space". */
export function normalise(key) {
  const parts = String(key).split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Give a key, like "Ctrl+Shift+F" or "G".');
  const mods = new Set(parts.slice(0, -1).map((m) => ({ control: 'Ctrl', ctrl: 'Ctrl', cmd: 'Ctrl', meta: 'Ctrl', shift: 'Shift', alt: 'Alt', option: 'Alt' })[m.toLowerCase()] || m));
  let k = parts.at(-1);
  k = k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1).toLowerCase();
  if (k === ' ') k = 'Space';
  return [...['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)), k].join('+');
}

/** The normalised combination of a keyboard event. */
export function comboOf(ev) {
  const k = ev.key === ' ' ? 'Space' : ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
  return [ev.ctrlKey || ev.metaKey ? 'Ctrl' : null, ev.altKey ? 'Alt' : null, ev.shiftKey ? 'Shift' : null, k].filter(Boolean).join('+');
}
