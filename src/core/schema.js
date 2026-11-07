// Argument checking for commands, written for AI callers: small local models send "2" for 2, a bare id for a list,
// or a near-miss enum. Coerce what is unambiguous, and explain the rest in words a model can act on.

const typeName = (s) => (s.type === 'array' && s.items?.type === 'number' && s.minItems === 3 ? '[x,y,z] numbers' : s.type);

function coerce(name, s, v, path) {
  if (v === undefined || v === null || !s || !s.type) return v;
  const where = `${name}.${path}`;
  const bad = () => new Error(`${where} must be ${typeName(s)}${s.description ? ` (${s.description})` : ''}; got ${JSON.stringify(v)?.slice(0, 60)}.`);
  if (s.type === 'number' || s.type === 'integer') {
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) v = +v;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw bad();
    return v;
  }
  if (s.type === 'boolean') {
    if (v === 'true' || v === 'false') v = v === 'true';
    if (typeof v !== 'boolean') throw bad();
    return v;
  }
  if (s.type === 'string') {
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string') throw bad();
    if (s.enum) {
      const hit = s.enum.find((x) => x.toLowerCase() === v.toLowerCase());
      if (!hit) throw new Error(`${where} must be one of ${s.enum.join(', ')}; got "${v}".`);
      return hit;
    }
    return v;
  }
  if (s.type === 'array') {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('[')) {
        try {
          v = JSON.parse(t);
        } catch {
          throw bad();
        }
      } else if (!s.items || s.items.type === 'string') v = [v];
      else throw bad();
    }
    if (!Array.isArray(v)) throw bad();
    if (s.minItems !== undefined && v.length < s.minItems) throw bad();
    if (s.maxItems !== undefined && v.length > s.maxItems) throw bad();
    return s.items ? v.map((x, i) => coerce(name, s.items, x, `${path}[${i}]`)) : v;
  }
  if (s.type === 'object') {
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        throw bad();
      }
    }
    if (typeof v !== 'object' || Array.isArray(v)) throw bad();
    return v;
  }
  return v;
}

/** Check and coerce a command's arguments against its params schema. Returns the (possibly new) args object. */
export function validate(name, params, args) {
  args = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  const props = params?.properties || {};
  const keys = Object.keys(props);
  // The most common slip: one id where a list is expected (targets() also accepts `id`).
  if (props.ids && !props.id && args.id !== undefined && args.ids === undefined) (args.ids = [args.id]), delete args.id;
  for (const r of params?.required || [])
    if (args[r] === undefined || args[r] === null) {
      const s = props[r] || {};
      throw new Error(`${name}: missing required parameter "${r}"${s.description ? ` (${s.description})` : ''}. Required: ${params.required.join(', ')}.`);
    }
  if (keys.length && params.additionalProperties !== true) {
    const unknown = Object.keys(args).filter((k) => !(k in props) && args[k] !== undefined);
    if (unknown.length) throw new Error(`${name}: unknown parameter${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')}. Valid: ${keys.join(', ')}.`);
  }
  for (const k of keys) if (args[k] !== undefined) args[k] = coerce(name, props[k], args[k], k);
  return args;
}
