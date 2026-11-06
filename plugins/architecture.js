// Built-in example plugin. A plugin is one ES module: export a function that receives the app API (mmr)
// and registers commands. Each command is then a toolbar button, an AI tool, an HTTP endpoint and an MCP tool.
export default function architecture(mmr) {
  mmr.registerCommand({
    name: 'create_stairs',
    category: 'plugin',
    description: 'Straight staircase as a group of steps. Rises along +y, runs along +z from position.',
    params: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'number of steps, default 12' },
        width: { type: 'number', description: 'm, default 1' },
        rise: { type: 'number', description: 'step height m, default 0.18' },
        run: { type: 'number', description: 'step depth m, default 0.28' },
        position: { type: 'array', items: { type: 'number' }, description: 'foot of the stairs [x,y,z]' },
        color: { type: 'string' },
      },
    },
    async run({ steps = 12, width = 1, rise = 0.18, run = 0.28, position = [0, 0, 0], color = '#b58a57' }, api) {
      const ids = [];
      for (let i = 0; i < steps; i++) {
        const s = await api.run('create_box', { width, height: rise, depth: run, color, name: `Step ${i + 1}`, position: [position[0], position[1] + i * rise, position[2] + i * run + run / 2] });
        ids.push(s.id);
      }
      return api.run('group', { ids, name: 'Stairs' });
    },
  });

  mmr.registerCommand({
    name: 'create_wall',
    category: 'plugin',
    description: 'Wall from a start to an end point on the ground, with optional door/window openings cut through it.',
    params: {
      type: 'object',
      properties: {
        from: { type: 'array', items: { type: 'number' }, description: '[x, z] start on the ground' },
        to: { type: 'array', items: { type: 'number' }, description: '[x, z] end on the ground' },
        height: { type: 'number', description: 'm, default 2.7' },
        thickness: { type: 'number', description: 'm, default 0.2' },
        openings: {
          type: 'array',
          description: 'holes: { at: distance along the wall to the opening centre, width, height, sill (bottom height, 0 for doors) }',
          items: { type: 'object', properties: { at: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, sill: { type: 'number' } } },
        },
        name: { type: 'string' },
        color: { type: 'string' },
      },
      required: ['from', 'to'],
    },
    async run({ from, to, height = 2.7, thickness = 0.2, openings = [], name = 'Wall', color = '#e9e4d8' }, api) {
      const dx = to[0] - from[0];
      const dz = to[1] - from[1];
      const length = Math.hypot(dx, dz);
      if (length < 0.01) throw new Error('Wall is too short.');
      const angle = (-Math.atan2(dz, dx) * 180) / Math.PI;
      const mid = [(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2];
      const wall = await api.run('create_box', { width: length, height, depth: thickness, position: mid, rotation: [0, angle, 0], name, color });
      const tools = [];
      for (const o of openings) {
        const along = (o.at ?? length / 2) - length / 2;
        const c = Math.cos((angle * Math.PI) / 180);
        const s = Math.sin((angle * Math.PI) / 180);
        const hole = await api.run('create_box', {
          width: o.width ?? 0.9,
          height: o.height ?? 2.1,
          depth: thickness * 3,
          position: [mid[0] + along * c, o.sill ?? 0, mid[2] - along * s],
          rotation: [0, angle, 0],
        });
        tools.push(hole.id);
      }
      if (tools.length) return api.run('boolean', { op: 'subtract', target: wall.id, tools });
      return wall;
    },
  });

  mmr.addToolbarButton({ icon: 'stairs', label: 'Stairs (plugin)', command: 'create_stairs' });
}
