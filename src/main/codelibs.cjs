// Feature code libraries (FXL imports, edited codes): one SQLite file in the user's data folder (node:sqlite, built into
// Electron's Node). The page reaches it through the 'codelib:call' channel; commands.js holds the parsing and the rules.
const { DatabaseSync } = require('node:sqlite');

const now = () => new Date().toISOString();

class CodeLibs {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS libraries (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, source TEXT,
        layers TEXT NOT NULL DEFAULT '[]', created TEXT NOT NULL, modified TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS codes (library INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, code TEXT NOT NULL,
        def TEXT NOT NULL, PRIMARY KEY (library, code));`);
  }
  tx(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  row(name) {
    const r = this.db.prepare('SELECT * FROM libraries WHERE name = ?').get(String(name ?? ''));
    if (!r) throw new Error(`No feature library named "${name}". Libraries: ${this.list().map((l) => l.name).join(', ') || 'none yet'}.`);
    return r;
  }
  touch(id) {
    this.db.prepare('UPDATE libraries SET modified = ? WHERE id = ?').run(now(), id);
  }
  list() {
    return this.db.prepare('SELECT l.name, l.source, l.created, l.modified, (SELECT COUNT(*) FROM codes c WHERE c.library = l.id) AS codes FROM libraries l ORDER BY l.name').all().map((r) => ({ ...r }));
  }
  /** { name, source, layers, codes: { CODE: def } } */
  get(name) {
    const r = this.row(name);
    const codes = Object.fromEntries(this.db.prepare('SELECT code, def FROM codes WHERE library = ? ORDER BY code').all(r.id).map((c) => [c.code, JSON.parse(c.def)]));
    return { name: r.name, source: r.source, created: r.created, modified: r.modified, layers: JSON.parse(r.layers), codes };
  }
  /** A new library, or (replace) the codes of an existing one. */
  save({ name, source = null, layers = [], codes = {} }, replace = false) {
    name = String(name || '').trim();
    if (!name) throw new Error('A feature library needs a name.');
    return this.tx(() => {
      const old = this.db.prepare('SELECT id FROM libraries WHERE name = ?').get(name);
      if (old && !replace) throw new Error(`A feature library named "${name}" exists already: give another name, or replace it.`);
      let id = old?.id;
      if (old) {
        this.db.prepare('UPDATE libraries SET source = ?, layers = ?, modified = ? WHERE id = ?').run(source, JSON.stringify(layers), now(), id);
        this.db.prepare('DELETE FROM codes WHERE library = ?').run(id);
      } else id = Number(this.db.prepare('INSERT INTO libraries (name, source, layers, created, modified) VALUES (?, ?, ?, ?, ?)').run(name, source, JSON.stringify(layers), now(), now()).lastInsertRowid);
      const put = this.db.prepare('INSERT INTO codes (library, code, def) VALUES (?, ?, ?)');
      for (const [c, d] of Object.entries(codes)) put.run(id, c.toUpperCase(), JSON.stringify(d));
      return { name, codes: Object.keys(codes).length };
    });
  }
  rename(name, to) {
    const r = this.row(name);
    to = String(to || '').trim();
    if (!to) throw new Error('Give the new name (to).');
    const clash = this.db.prepare('SELECT id FROM libraries WHERE name = ?').get(to);
    if (clash && clash.id !== r.id) throw new Error(`A feature library named "${to}" exists already.`);
    this.db.prepare('UPDATE libraries SET name = ?, modified = ? WHERE id = ?').run(to, now(), r.id);
    return { name: to };
  }
  duplicate(name, to) {
    const lib = this.get(name);
    return this.save({ ...lib, name: to || `${lib.name} copy`, source: lib.source });
  }
  remove(name) {
    this.db.prepare('DELETE FROM libraries WHERE id = ?').run(this.row(name).id);
    return { deleted: name };
  }
  /** Add or change one code (def), or remove it (def null). */
  setCode(name, code, def) {
    const r = this.row(name);
    code = String(code || '').trim().toUpperCase();
    if (!code) throw new Error('Give the code.');
    return this.tx(() => {
      if (def === null) {
        if (!this.db.prepare('DELETE FROM codes WHERE library = ? AND code = ?').run(r.id, code).changes) throw new Error(`${code} is not in ${r.name}.`);
      } else this.db.prepare('INSERT INTO codes (library, code, def) VALUES (?, ?, ?) ON CONFLICT(library, code) DO UPDATE SET def = excluded.def').run(r.id, code, JSON.stringify(def));
      this.touch(r.id);
      return { library: r.name, code };
    });
  }
}

/** The operations the page may call (everything else on the class stays private). */
const OPS = ['list', 'get', 'save', 'rename', 'duplicate', 'remove', 'setCode'];

module.exports = { CodeLibs, OPS };
