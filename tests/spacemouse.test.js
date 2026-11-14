// SpaceMouse (#303): reports decoded, axis maths, button mapping, and the commands that keep the settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import * as SM from '../src/core/spacemouse.js';

const le = (...v) => new Uint8Array(new Int16Array(v).buffer); // int16 little endian, as the device sends them

test('decode: six axes in report 1 (12 bytes), or translation then rotation (reports 1 and 2)', () => {
  const s = SM.newState();
  // a report as a SpaceMouse Wireless sends it: a push right with a little twist
  assert.deepEqual(SM.decode(s, 1, new Uint8Array([0x5e, 0x01, 0xfb, 0xff, 0x02, 0x00, 0x00, 0x00, 0x01, 0x00, 0xd0, 0xff])), { axes: true });
  assert.deepEqual(s.raw, [350, -5, 2, 0, 1, -48]);
  const old = SM.newState();
  SM.decode(old, 1, le(-100, 20, 300));
  assert.deepEqual(old.raw, [-100, 20, 300, 0, 0, 0]);
  SM.decode(old, 2, le(7, -8, 9));
  assert.deepEqual(old.raw, [-100, 20, 300, 7, -8, 9]);
  // a DataView, as WebHID hands it over
  const dv = new DataView(le(1, 2, 3, 4, 5, 6).buffer);
  SM.decode(old, 1, dv);
  assert.deepEqual(old.raw, [1, 2, 3, 4, 5, 6]);
  assert.equal(SM.decode(old, 9, new Uint8Array(4)), null);
});

test('decode: buttons from a bitmask (report 3) and from key numbers (report 0x1c)', () => {
  const s = SM.newState();
  assert.deepEqual(SM.decode(s, 3, new Uint8Array([0b10, 0, 0, 0])), { down: [1], up: [] });
  assert.deepEqual(SM.decode(s, 3, new Uint8Array([0b11, 0, 0, 0])), { down: [0], up: [] });
  assert.deepEqual(SM.decode(s, 3, new Uint8Array([0, 0, 0, 0])), { down: [], up: [0, 1] });
  assert.deepEqual(SM.decode(s, 3, new Uint8Array([0, 0, 0, 0b10])), { down: [25], up: [] });
  assert.equal(SM.buttonName(0xc62b, 25), 'Ctrl');
  assert.equal(SM.buttonName(0xc635, 1), 'Fit');
  assert.equal(SM.buttonName(0xc627, 11), 'Menu', 'the SpaceExplorer has its own order');
  assert.equal(SM.buttonName(0xc633, 40), 'Button 41');
  const e = SM.newState();
  assert.deepEqual(SM.decode(e, 0x1c, new Uint8Array([2, 0, 0])), { down: [1], up: [] });
  assert.deepEqual(SM.decode(e, 0x1c, new Uint8Array([0, 0, 0])), { down: [], up: [1] });
});

test('devices: the table knows the models and the vendor ids', () => {
  assert.equal(SM.modelOf(0xc635), 'SpaceMouse Compact');
  assert.equal(SM.modelOf(0xc633), 'SpaceMouse Enterprise');
  assert.match(SM.modelOf(0xc6ff), /0xc6ff/);
  assert.ok(SM.isSpaceMouse(0x256f, 0xc635) && SM.isSpaceMouse(0x046d, 0xc626));
  assert.ok(!SM.isSpaceMouse(0x046d, 0xc52b), 'a Logitech receiver is not one');
});

test('shape: dead zone, curve, sensitivity, invert, enable, lock horizon, dominant, modes', () => {
  const c = SM.configure();
  assert.ok(SM.atRest(SM.shape([10, -12, 5, 0, 8, -15], c)), 'small noise at rest is in the dead zone');
  const full = SM.shape([350, 0, 0, 0, 0, 0], c);
  assert.equal(full[0], 1);
  const half = SM.shape([175, 0, 0, 0, 0, 0], c)[0];
  assert.ok(half > 0.2 && half < 0.3, 'quadratic: half a push is about a quarter of the speed');
  assert.ok(Math.abs(SM.shape([175, 0, 0, 0, 0, 0], SM.configure({}, { curve: 'linear' }))[0] - 0.4737) < 1e-3);
  // HID: y towards you, z down → app: ty up, tz towards you; rz twist → ry yaw; ry → rz roll
  const m = SM.shape([0, 350, 350, 0, 350, 350], SM.configure({}, { lock_horizon: false }));
  assert.deepEqual(m.map((v) => Math.round(v)), [0, -1, 1, 0, -1, 1]);
  assert.equal(SM.shape([0, 0, 0, 0, 350, 0], c)[5], 0, 'lock horizon: no roll');
  const cfg = SM.configure({}, { sensitivity: { tx: 2 }, invert: { ty: true }, enable: { tz: false }, speed: 0.5 });
  assert.deepEqual(SM.shape([350, 350, 0, 0, 0, 0], cfg).slice(0, 3), [1, 0, 0]);
  assert.equal(SM.shape([0, 0, -350, 0, 0, 0], cfg)[1], -0.5, 'inverted lift');
  const dom = SM.shape([200, 0, 340, 300, 0, 0], SM.configure({}, { dominant: true }));
  assert.deepEqual(dom.map((v) => v !== 0), [false, true, false, false, false, false], 'only the strongest axis');
  assert.deepEqual(SM.shape([0, 0, 0, 350, 350, 350], SM.configure({}, { mode: '2d' })).slice(3), [0, 0, 0], '2D: pan and zoom only');
  assert.equal(SM.shape([0, 0, 350, 0, 0, 0], SM.configure({}, { mode: 'walk' }))[1], 0, 'walk: no lift');
  assert.equal(SM.shape([900, 0, 0, 0, 0, 0], c)[0], 1, 'an older device past ±350 is clamped');
});

test('step: real time step, capped; object mode moves the camera the other way; speed scales with the distance', () => {
  const m = [1, 0, 0, 0, 1, 0];
  const a = SM.step(m, 1 / 60, 30, 'fly');
  assert.ok(Math.abs(a.move[0] - 0.5) < 1e-9 && a.turn[1] > 0);
  const b = SM.step(m, 1 / 60, 30, 'object');
  assert.ok(b.move[0] < 0 && b.turn[1] < 0);
  assert.equal(SM.step(m, 5, 30, 'fly').move[0], 3, 'a dropped frame moves at most 0.1 s');
  assert.equal(SM.step(m, 1 / 60, 300, 'fly').move[0], 5, 'farther: faster');
  assert.deepEqual(SM.step([0, 0, 0, 0, 0, 0], 1 / 60, 30, 'fly').move, [0, 0, 0], 'at rest: no drift');
});

test('configure checks its values; buttons map over the defaults', () => {
  assert.throws(() => SM.configure({}, { mode: 'orbit' }), /Mode is/);
  assert.throws(() => SM.configure({}, { sensitivity: { qx: 1 } }), /No axis/);
  assert.throws(() => SM.configure({}, { dead_zone: 2 }), /dead zone/);
  assert.throws(() => SM.configure({}, { nonsense: 1 }), /No SpaceMouse setting/);
  assert.deepEqual(SM.actionOf('Fit'), { command: 'zoom_extents' });
  assert.equal(SM.actionOf('Menu'), 'sm:palette');
  assert.equal(SM.actionOf('Fit', { Fit: 'none' }), null);
  assert.equal(SM.actionOf('3', { 3: 'toggleXray' }), 'toggleXray');
  assert.equal(SM.actionOf('7'), null);
  assert.equal(SM.nextMode('2d'), 'object');
});

test('set_spacemouse and map_spacemouse_button keep the settings; list_input_devices answers without a device', async () => {
  const { reg, ctx } = makeCtx();
  let saved = {};
  ctx.io = { settings: () => saved, setSettings: async (p) => (saved = { spacemouse: { ...saved.spacemouse, ...p.spacemouse } }) }; // main.cjs merges deep
  const r = await reg.run('set_spacemouse', { mode: 'fly', speed: 2, invert: { rz: true } });
  assert.equal(r.mode, 'fly');
  assert.equal(saved.spacemouse.invert.rz, true);
  await reg.run('set_spacemouse', { pivot: 'cursor' });
  assert.equal(saved.spacemouse.mode, 'fly', 'a later call keeps the earlier settings');
  await reg.run('map_spacemouse_button', { button: '1', command: 'set_style', args: { xray: true } });
  await reg.run('map_spacemouse_button', { button: 'Fit', action: 'none' });
  assert.deepEqual(saved.spacemouse.buttons, { 1: { command: 'set_style', args: { xray: true } }, Fit: 'none' });
  const b = await reg.run('map_spacemouse_button', { button: '2', action: 'sm:clip' });
  assert.equal(b.buttons['2'], 'sm:clip');
  await assert.rejects(reg.run('map_spacemouse_button', { button: '1', command: 'no_such_command' }), /No command/);
  await assert.rejects(reg.run('map_spacemouse_button', { button: '1', action: 'sm:fly_away' }), /SpaceMouse action/);
  const d = await reg.run('list_input_devices', {});
  assert.deepEqual(d.devices, []);
});
