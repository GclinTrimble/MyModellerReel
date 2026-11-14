// 3Dconnexion SpaceMouse (#303): the HID reports decoded, the device table, the axis maths (dead zone, curve,
// sensitivity, invert, dominant axis) and the button mapping. Pure: the renderer reads WebHID and moves the camera.

/** WebHID filters: every 3Dconnexion device, and the older Logitech-made ones (multi-axis controller usage). */
export const FILTERS = [{ vendorId: 0x256f }, { vendorId: 0x046d, usagePage: 1, usage: 8 }];
export const isSpaceMouse = (vendorId, productId) => vendorId === 0x256f || (vendorId === 0x046d && productId >> 8 === 0xc6);

// The button numbering of the newer devices: bit i of the button report is 3Dconnexion's virtual key i + 1.
const VKEYS = ['Menu', 'Fit', 'T', 'L', 'R', 'F', 'B', 'Bk', 'Roll +', 'Roll −', 'Iso 1', 'Iso 2', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Esc', 'Alt', 'Shift', 'Ctrl', 'Rotate', 'Pan/Zoom', 'Dominant', '+', '−'];
const EXPLORER = ['1', '2', 'T', 'L', 'R', 'F', 'Esc', 'Alt', 'Shift', 'Ctrl', 'Fit', 'Menu', '−', '+', 'Rotate'];

/** Product id → model (and its button names when they differ from the virtual key order). */
export const DEVICES = {
  0xc603: { model: 'SpaceMouse Plus XT' },
  0xc605: { model: 'CadMan' },
  0xc606: { model: 'SpaceMouse Classic' },
  0xc621: { model: 'SpaceBall 5000' },
  0xc623: { model: 'SpaceTraveler' },
  0xc625: { model: 'SpacePilot' },
  0xc626: { model: 'SpaceNavigator' },
  0xc627: { model: 'SpaceExplorer', buttons: EXPLORER },
  0xc628: { model: 'SpaceNavigator for Notebooks' },
  0xc629: { model: 'SpacePilot Pro' },
  0xc62b: { model: 'SpaceMouse Pro' },
  0xc62e: { model: 'SpaceMouse Wireless (cable)' },
  0xc62f: { model: 'SpaceMouse Wireless (receiver)' },
  0xc631: { model: 'SpaceMouse Pro Wireless (cable)' },
  0xc632: { model: 'SpaceMouse Pro Wireless (receiver)' },
  0xc633: { model: 'SpaceMouse Enterprise' },
  0xc635: { model: 'SpaceMouse Compact' },
  0xc636: { model: 'SpaceMouse Module' },
  0xc652: { model: '3Dconnexion Universal Receiver' },
};
export const modelOf = (productId) => DEVICES[productId]?.model || `3Dconnexion device 0x${(productId || 0).toString(16)}`;
/** The name of button i (0-based) on a device. */
export const buttonName = (productId, i) => (DEVICES[productId]?.buttons || VKEYS)[i] || `Button ${i + 1}`;

/** A fresh device state: the six raw axes and the pressed buttons (by index). */
export const newState = () => ({ raw: [0, 0, 0, 0, 0, 0], pressed: new Set() });

const i16 = (b, at) => {
  const v = b[at] | (b[at + 1] << 8);
  return v & 0x8000 ? v - 0x10000 : v;
};

/**
 * Read one input report into the state. Report 1: translation (6 bytes) or all six axes (12 bytes, newer devices);
 * report 2: rotation; report 3: a button bitmask; report 0x1c (Enterprise): the numbers of the pressed keys.
 * Returns { axes: true } or { down: [i…], up: [i…] }, or null for a report that is not one of these.
 */
export function decode(state, reportId, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
  if (reportId === 1 && b.length >= 6) {
    for (let k = 0; k < (b.length >= 12 ? 6 : 3); k++) state.raw[k] = i16(b, 2 * k);
    return { axes: true };
  }
  if (reportId === 2 && b.length >= 6) {
    for (let k = 0; k < 3; k++) state.raw[3 + k] = i16(b, 2 * k);
    return { axes: true };
  }
  let now = null;
  if (reportId === 3) {
    now = new Set();
    for (let i = 0; i < b.length * 8; i++) if (b[i >> 3] & (1 << (i & 7))) now.add(i);
  } else if (reportId === 0x1c) {
    // shortcut: key numbers as 1-based virtual keys, from 3Dconnexion's docs; check the ids on a real Enterprise
    now = new Set([...b].filter(Boolean).map((n) => n - 1));
  }
  if (!now) return null;
  const down = [...now].filter((i) => !state.pressed.has(i));
  const up = [...state.pressed].filter((i) => !now.has(i));
  state.pressed = now;
  return { down, up };
}

export const AXES = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'];
export const MODES = ['object', 'fly', 'walk', '2d'];
export const PIVOTS = ['view', 'cursor', 'selection'];
export const CURVES = ['linear', 'quadratic'];
const each = (v) => Object.fromEntries(AXES.map((a) => [a, v]));
export const DEFAULTS = { mode: 'object', speed: 1, sensitivity: each(1), invert: each(false), enable: each(true), dead_zone: 0.05, curve: 'quadratic', lock_horizon: true, dominant: false, pivot: 'view' };
const FULL = 350; // raw value at full deflection on current devices (older ones reach about ±512: clamped)

/** The settings over the defaults, checked: a patch from set_spacemouse merged into the saved ones. */
export function configure(saved = {}, patch = {}) {
  const c = { ...DEFAULTS, ...saved, sensitivity: { ...DEFAULTS.sensitivity, ...saved.sensitivity }, invert: { ...DEFAULTS.invert, ...saved.invert }, enable: { ...DEFAULTS.enable, ...saved.enable } };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || k === 'buttons') continue;
    if (k === 'sensitivity' || k === 'invert' || k === 'enable') {
      for (const [a, x] of Object.entries(v || {})) {
        if (!AXES.includes(a)) throw new Error(`No axis "${a}": ${AXES.join(', ')}.`);
        if (k === 'sensitivity' && !(x >= 0 && x <= 10)) throw new Error('A sensitivity is 0 to 10.');
        c[k][a] = k === 'sensitivity' ? +x : !!x;
      }
    } else if (k === 'mode' && !MODES.includes(v)) throw new Error(`Mode is ${MODES.join(', ')}.`);
    else if (k === 'pivot' && !PIVOTS.includes(v)) throw new Error(`Pivot is ${PIVOTS.join(', ')}.`);
    else if (k === 'curve' && !CURVES.includes(v)) throw new Error(`Curve is ${CURVES.join(' or ')}.`);
    else if (k === 'speed' && !(v > 0 && v <= 20)) throw new Error('Speed is above 0, up to 20.');
    else if (k === 'dead_zone' && !(v >= 0 && v < 1)) throw new Error('The dead zone is 0 to 1 (a share of full deflection).');
    else if (!(k in DEFAULTS)) throw new Error(`No SpaceMouse setting "${k}".`);
    else c[k] = typeof DEFAULTS[k] === 'boolean' ? !!v : v;
  }
  return c;
}

/**
 * The raw axes as the app's six motions, each −1…1 times sensitivity and speed: tx right, ty up, tz towards you,
 * rx tilt (pitch), ry spin about up (yaw), rz roll. HID gives y towards you and z down, so they swap.
 */
export function shape(raw, cfg) {
  const [x, y, z, rx, ry, rz] = raw.map((v) => Math.max(-1, Math.min(1, v / FULL)));
  const v = [x, -z, y, rx, -rz, ry];
  const out = v.map((a, k) => {
    const name = AXES[k];
    if (!cfg.enable[name]) return 0;
    const m = Math.abs(a);
    if (m <= cfg.dead_zone) return 0;
    let t = (m - cfg.dead_zone) / (1 - cfg.dead_zone);
    if (cfg.curve === 'quadratic') t *= t;
    return Math.sign(a) * t * cfg.sensitivity[name] * cfg.speed * (cfg.invert[name] ? -1 : 1);
  });
  if (cfg.lock_horizon || cfg.mode === 'walk') out[5] = 0;
  if (cfg.mode === '2d') out[3] = out[4] = out[5] = 0;
  if (cfg.mode === 'walk') out[1] = 0; // eye height follows the floor
  if (cfg.dominant) {
    const k = out.reduce((best, a, i) => (Math.abs(a) > Math.abs(out[best]) ? i : best), 0);
    return out.map((a, i) => (i === k ? a : 0));
  }
  return out;
}
export const atRest = (m) => m.every((a) => a === 0);

/**
 * Default button actions, by button name. A string is a menu action, "tool:<id>", "sm:<spacemouse action>",
 * "key:<key>" (a key held while the button is) or a command; { command, args } runs a command with arguments.
 */
export const DEFAULT_BUTTONS = {
  Menu: 'sm:palette',
  Fit: { command: 'zoom_extents' },
  T: { command: 'set_view', args: { preset: 'top' } },
  F: { command: 'set_view', args: { preset: 'front' } },
  R: { command: 'set_view', args: { preset: 'right' } },
  L: { command: 'set_view', args: { preset: 'left' } },
  B: { command: 'set_view', args: { preset: 'bottom' } },
  Bk: { command: 'set_view', args: { preset: 'back' } },
  'Iso 1': { command: 'set_view', args: { preset: 'iso' } },
  'Iso 2': { command: 'set_view', args: { preset: 'iso' } },
  Rotate: 'sm:rotate',
  'Pan/Zoom': 'sm:mode',
  Dominant: 'sm:dominant',
  '+': 'sm:faster',
  '−': 'sm:slower',
  Esc: 'key:Escape',
  Ctrl: 'key:Control',
  Shift: 'key:Shift',
  Alt: 'key:Alt',
};
/** SpaceMouse actions a button can take. */
export const SM_ACTIONS = { palette: 'open the command palette', rotate: 'rotations on / off (rotate lock)', mode: 'next navigation mode', dominant: 'dominant axis on / off', faster: 'speed × 1.25', slower: 'speed ÷ 1.25', clip: 'hold to move the selected clip box' };

/** What a button does: the user's mapping over the defaults; null when nothing ("none" unmaps a default). */
export function actionOf(name, mine = {}) {
  const a = name in mine ? mine[name] : DEFAULT_BUTTONS[name];
  return !a || a === 'none' ? null : a;
}

export const nextMode = (m) => MODES[(MODES.indexOf(m) + 1) % MODES.length];

const TURN = Math.PI / 2; // radians per second at full deflection
/**
 * One frame's motion of the camera from the shaped axes, in the camera's frame: move [x right, y up, z back] in
 * metres, turn [pitch, yaw, roll] in radians. dt is the real time step (capped, so a dropped frame does not jump);
 * scale is the distance to the pivot or the scene, so a push feels the same on a site and on a detail. Object mode
 * moves the model with the hand, so the camera goes the other way; fly, walk and 2D move the eye with the hand.
 */
export function step(m, dt, scale, mode) {
  const t = Math.min(Math.max(dt, 0), 0.1);
  const k = mode === 'object' ? -1 : 1;
  const s = Math.max(scale, 0.5);
  return { move: [m[0] * s * t * k, m[1] * s * t * k, m[2] * s * t * k], turn: [m[3] * TURN * t * k, m[4] * TURN * t * k, m[5] * TURN * t * k] };
}
