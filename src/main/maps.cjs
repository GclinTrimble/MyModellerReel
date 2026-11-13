// Web maps and feature services from the main process (#264–#268): GET requests to OGC services with the user's key for
// that service added here (keys never reach the page), a disk cache of responses so layers stay up offline, the user's
// map services kept in settings and in their suite account, and GeoPackage files through node:sqlite.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function registerMaps({ ipcMain, userDir, settings: S, saveSettings, account }) {
  const CACHE = path.join(userDir, 'map-cache');
  const limitMB = () => S().maps?.cache_mb ?? 2000;
  const fileOf = (url) => {
    const k = crypto.createHash('sha1').update(url).digest('hex');
    return path.join(CACHE, k.slice(0, 2), k);
  };
  const checkUrl = (url) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error(`Not a web address: ${String(url).slice(0, 100)}`);
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https services can be added.');
    return u;
  };
  let writes = 0;
  const trim = () => {
    // shortcut: trims by file age every 500 writes; a long session over the limit waits for the next trim
    const files = [];
    if (!fs.existsSync(CACHE)) return;
    for (const d of fs.readdirSync(CACHE)) for (const f of fs.readdirSync(path.join(CACHE, d))) {
      const p = path.join(CACHE, d, f);
      const s = fs.statSync(p);
      files.push([p, s.size, s.mtimeMs]);
    }
    let total = files.reduce((a, f) => a + f[1], 0);
    for (const [p, size] of files.sort((a, b) => a[2] - b[2])) {
      if (total <= limitMB() * 1e6) break;
      fs.rmSync(p, { force: true });
      total -= size;
    }
  };
  /** GET a service URL: { status, type, text } or { status, type, bytes }; from the cache when offline. */
  async function get(url, { service = null, binary = false, prefer_cache = false } = {}) {
    const u = checkUrl(url);
    const file = fileOf(url);
    const cached = () => {
      const b = fs.readFileSync(file);
      const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
      return { status: 200, type: meta.type, cached: true, ...(binary ? { bytes: b } : { text: b.toString('utf8') }) };
    };
    if (prefer_cache && fs.existsSync(file)) return cached();
    // a key goes only to the host its service was saved with, whatever address a caller pairs it with
    const saved = service && (S().maps?.services || []).find((x) => x.name === service);
    let sameHost = false;
    try {
      sameHost = !!saved && new URL(saved.url.replace(/{[^}]+}/g, '0')).host === u.host;
    } catch {}
    const secret = sameHost ? account.getSecret(service) : null;
    const headers = { 'user-agent': 'MyModellerReel' };
    if (secret?.header) headers[secret.header] = secret.value;
    if (secret?.query) u.searchParams.set(secret.query, secret.value);
    let r;
    try {
      r = await fetch(u, { headers, signal: AbortSignal.timeout(binary ? 30000 : 60000) });
    } catch (e) {
      if (fs.existsSync(file)) return cached();
      throw new Error(`The service did not answer (${e.cause?.code || e.name}).`);
    }
    const type = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 200e6) throw new Error('The answer is over 200 MB: ask for a smaller area or fewer features.');
    if (r.ok && !/xml.*exception|ServiceException|ExceptionReport/i.test(binary && /image/.test(type) ? '' : buf.subarray(0, 600).toString('utf8'))) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      fs.writeFileSync(`${file}.json`, JSON.stringify({ url: url.slice(0, 2000), type }));
      if (++writes % 500 === 0) trim();
    } else if (!r.ok && fs.existsSync(file)) return cached();
    const text = !binary || !/image/.test(type) ? buf.toString('utf8') : null;
    if (!r.ok) throw new Error(`The service answered ${r.status}${text ? `: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}` : ''}`);
    if (binary && !/image/.test(type)) throw new Error(`The service sent ${type || 'no type'}, not an image: ${(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}`);
    return { status: r.status, type, ...(binary ? { bytes: buf } : { text }) };
  }
  ipcMain.handle('ogc:get', (_, url, opts) => get(url, opts));
  /** Take an area offline (#268): fetch the given tile and feature URLs into the cache, a few at a time. */
  ipcMain.handle('ogc:cache', async (_, { urls, service = null }) => {
    let done = 0;
    let failed = 0;
    const queue = [...new Set(urls)].slice(0, 20000);
    const worker = async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        try {
          await get(u, { service, binary: true, prefer_cache: true });
          done++;
        } catch {
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return { cached: done, failed };
  });
  ipcMain.handle('ogc:cache-info', () => {
    let bytes = 0;
    let files = 0;
    if (fs.existsSync(CACHE)) for (const d of fs.readdirSync(CACHE)) for (const f of fs.readdirSync(path.join(CACHE, d))) if (!f.endsWith('.json')) (bytes += fs.statSync(path.join(CACHE, d, f)).size), files++;
    return { files, mb: Math.round(bytes / 1e5) / 10, limit_mb: limitMB(), folder: CACHE };
  });
  ipcMain.handle('ogc:cache-clear', () => (fs.rmSync(CACHE, { recursive: true, force: true }), { cleared: true }));
  ipcMain.handle('ogc:cache-limit', (_, mb) => ((S().maps = { ...S().maps, cache_mb: Math.max(50, +mb || 2000) }), saveSettings(), trim(), { limit_mb: limitMB() }));

  // ---- the user's services (#267): local first, then their suite account
  const local = () => (S().maps = { ...S().maps, services: S().maps?.services || [] }).services;
  const strip = (s) => ({ name: String(s.name).slice(0, 200), kind: s.kind, url: s.url || '', config: s.config || {}, updated_at: s.updated_at || new Date().toISOString() });
  async function sync() {
    try {
      const remote = await account.mapServices.list();
      if (!remote) return { synced: false, why: 'no suite account on this build' };
      const mine = local();
      for (const r of remote) {
        const i = mine.findIndex((m) => m.name === r.name);
        if (i < 0) mine.push(strip(r));
        else if (new Date(r.updated_at) > new Date(mine[i].updated_at || 0)) mine[i] = strip(r);
      }
      for (const m of mine) if (!remote.some((r) => r.name === m.name) && !m.deleted) await account.mapServices.save(m);
      saveSettings();
      return { synced: true };
    } catch (e) {
      return { synced: false, why: e.message };
    }
  }
  ipcMain.handle('map:services', async (_, { action = 'list', service = null, name = null, secret } = {}) => {
    const mine = local();
    let sync1 = null;
    if (action === 'save') {
      const row = strip({ ...service, updated_at: new Date().toISOString() });
      const i = mine.findIndex((m) => m.name === row.name);
      if (i < 0) mine.push(row);
      else mine[i] = row;
      if (secret !== undefined) account.setSecret(row.name, secret);
      saveSettings();
      sync1 = await account.mapServices.save(row).then(() => ({ synced: true }), (e) => ({ synced: false, why: e.message }));
    } else if (action === 'remove') {
      const i = mine.findIndex((m) => m.name === name);
      if (i < 0) throw new Error(`No map service "${name}".`);
      mine.splice(i, 1);
      account.setSecret(name, null);
      saveSettings();
      sync1 = await account.mapServices.remove(name).then(() => ({ synced: true }), (e) => ({ synced: false, why: e.message }));
    } else sync1 = await sync();
    return { services: mine.map((s) => ({ ...s, has_key: !!account.getSecret(s.name) })), ...sync1 };
  });

  // ---- GeoPackage (#268)
  const gpkgPath = (f) => {
    if (!/.gpkg$/i.test(String(f))) throw new Error('A GeoPackage file ends in .gpkg.');
  };
  ipcMain.handle('gpkg:write', (_, file, payload) => {
    gpkgPath(file);
    const { DatabaseSync } = require('node:sqlite');
    return import('../core/gpkg.js').then((G) => G.writeGpkg(DatabaseSync, file, payload));
  });
  ipcMain.handle('gpkg:read', (_, file) => {
    gpkgPath(file);
    const { DatabaseSync } = require('node:sqlite');
    return import('../core/gpkg.js').then((G) => G.readGpkg(DatabaseSync, file));
  });
}

module.exports = { registerMaps };
