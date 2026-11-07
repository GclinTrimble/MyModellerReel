// Built-in example plugin. A plugin is one ES module: export a function that receives the app API (mmr)
// and registers commands (and generators of parametric shapes). Each command is then a toolbar button, an AI tool,
// an HTTP endpoint and an MCP tool; each generator's shapes keep their parameters (set_params).
export default function architecture(mmr) {
  const G = mmr.geometry;
  const rotY = (mesh, deg, at) => {
    const a = (deg * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return { v: mesh.v.map(([x, y, z]) => [at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c]), f: mesh.f };
  };

  mmr.registerGenerator('stairs', {
    description: 'Straight flight of steps rising along +y and running along +z',
    params: { steps: 'number of steps', width: 'm', rise: 'step height, m', run: 'step depth, m' },
    run: ({ params: { steps = 12, width = 1, rise = 0.18, run = 0.28 } }) => {
      if (!(steps >= 1 && steps <= 200)) throw new Error('steps must be 1…200.');
      if (!(width > 0 && rise > 0 && run > 0)) throw new Error('width, rise and run must be positive (metres).');
      const v = [];
      const f = [];
      for (let i = 0; i < Math.round(steps); i++) {
        const b = G.translate(G.box(width, rise, run), [0, i * rise, i * run + run / 2]);
        f.push(...b.f.map((face) => face.map((k) => k + v.length)));
        v.push(...b.v);
      }
      return { mesh: { v, f } };
    },
  });

  mmr.registerGenerator('wall', {
    description: 'Wall between two ground points, with door and window openings cut through it',
    world: true,
    params: { from: '[x, z] start', to: '[x, z] end', height: 'm', thickness: 'm', openings: '[{ at, width, height, sill }]' },
    run: ({ params: { from, to, height = 2.7, thickness = 0.2, openings = [] } }) => {
      const dx = to[0] - from[0];
      const dz = to[1] - from[1];
      const length = Math.hypot(dx, dz);
      if (length < 0.01) throw new Error('The wall is too short.');
      const angle = (-Math.atan2(dz, dx) * 180) / Math.PI;
      const mid = [(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2];
      const wall = rotY(G.box(length, height, thickness), angle, mid);
      const holes = openings.map((o) => {
        const hole = G.translate(G.box(o.width ?? 0.9, o.height ?? 2.1, thickness * 3), [(o.at ?? length / 2) - length / 2, o.sill ?? 0, 0]);
        return rotY(hole, angle, mid);
      });
      return G.recenter(holes.length ? mmr.csg.booleanMeshes('subtract', wall, holes) : wall);
    },
  });

  mmr.registerCommand({
    name: 'create_stairs',
    category: 'plugin',
    description: 'Straight staircase rising along +y, running along +z from position. Parametric: set_params changes steps, width, rise, run. separate: true makes a group of separate steps instead (for build sequences).',
    params: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'number of steps, default 12' },
        width: { type: 'number', description: 'm, default 1' },
        rise: { type: 'number', description: 'step height m, default 0.18' },
        run: { type: 'number', description: 'step depth m, default 0.28' },
        position: { type: 'array', items: { type: 'number' }, description: 'foot of the stairs [x,y,z]' },
        color: { type: 'string' },
        name: { type: 'string' },
        separate: { type: 'boolean', description: 'a group of separate steps (not parametric)' },
      },
    },
    async run({ steps = 12, width = 1, rise = 0.18, run = 0.28, position = [0, 0, 0], color = '#b58a57', name = 'Stairs', separate = false }, api) {
      if (!separate) return api.run('create_parametric', { generator: 'stairs', params: { steps, width, rise, run }, position, color, name });
      const ids = [];
      for (let i = 0; i < steps; i++) {
        const s = await api.run('create_box', { width, height: rise, depth: run, color, name: `Step ${i + 1}`, position: [position[0], position[1] + i * rise, position[2] + i * run + run / 2] });
        ids.push(s.id);
      }
      return api.run('group', { ids, name });
    },
  });

  mmr.registerCommand({
    name: 'create_wall',
    category: 'plugin',
    description: 'Wall from a start to an end point on the ground, with optional door/window openings cut through it. Parametric: set_params moves its ends, height, thickness or openings.',
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
    run: ({ from, to, height = 2.7, thickness = 0.2, openings = [], name = 'Wall', color = '#e9e4d8' }, api) =>
      api.run('create_parametric', { generator: 'wall', params: { from, to, height, thickness, openings }, name, color }),
  });

  mmr.addToolbarButton({ icon: 'stairs', label: 'Stairs (plugin)', command: 'create_stairs' });
}
