// The MyStudioReel suite account (#115), ported from MySnipReel's src/main/account.ts: sign in with Google through the
// suite's Supabase Auth in the system browser (loopback redirect + PKCE, RFC 8252: Google blocks sign-in inside
// embedded webviews). The refresh token lives in Windows Credential Manager, shared with every Reel app on the PC, and
// is read again before each refresh because Supabase rotates it on every use. A licence lease ping keeps this PC
// counted as one device. Contract: MyVoiceReel's docs/SUITE_ACCOUNT.md. Sign-in is required.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { app, ipcMain, powerMonitor, shell } = require('electron');
const A = require('../core/account.js');

const APP_NAME = 'MyModellerReel';

/** Public values (the anon key only allows what row-level security allows). Release builds get them from suite.json,
 *  written by scripts/check-suite-config.mjs, which refuses to build without them. Unpackaged runs read the same
 *  environment variables directly. E2E runs (MMR_TEST) never use the real project: MMR_SUITE_URL points at a mock. */
function suiteConfig() {
  if (process.env.MMR_TEST) return { url: process.env.MMR_SUITE_URL ?? '', anonKey: 'test' };
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'suite.json'), 'utf8'));
  } catch {
    if (app.isPackaged) return { url: '', anonKey: '' };
    return { url: process.env.MYSTUDIOREEL_SUPABASE_URL ?? '', anonKey: process.env.MYSTUDIOREEL_SUPABASE_ANON_KEY ?? '' };
  }
}
const SUITE = suiteConfig();
const configured = () => !!(SUITE.url && SUITE.anonKey);
/** E2E runs keep their own credential, so they never touch the real sign-in of this PC. */
const TARGET = process.env.MMR_TEST ? `${A.CREDENTIAL_TARGET}-test` : A.CREDENTIAL_TARGET;

/** signedOut: no session, or the server refused it (sign in again). Otherwise offline or a server failure. */
class AuthError extends Error {
  constructor(message, signedOut = false) {
    super(message);
    this.signedOut = signedOut;
  }
}

// ---- PKCE and device id ----

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 64 random alphanumeric characters (the modulo bias of 256 % 62 is irrelevant for a one-time verifier). */
const newVerifier = () => Array.from(crypto.randomBytes(64), (b) => ALNUM[b % ALNUM.length]).join('');

let deviceIdCache;
/** This PC's device id, the same in every Reel app; "" when Windows gives no MachineGuid. */
function deviceId() {
  if (deviceIdCache === undefined) {
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { encoding: 'utf8', windowsHide: true });
      const guid = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out)?.[1];
      deviceIdCache = guid ? A.deviceHash(guid) : '';
    } catch {
      deviceIdCache = '';
    }
  }
  return deviceIdCache;
}

// ---- Windows Credential Manager (generic credential, local machine persistence) ----

let credApi;
function cred() {
  if (credApi !== undefined) return credApi;
  if (process.platform !== 'win32') return (credApi = null);
  const koffi = require('koffi');
  const adv = koffi.load('advapi32.dll');
  const FILETIME = koffi.struct('ACCT_FILETIME', { lo: 'uint32_t', hi: 'uint32_t' });
  const CREDENTIALW = koffi.struct('ACCT_CREDENTIALW', {
    Flags: 'uint32_t',
    Type: 'uint32_t',
    TargetName: 'str16',
    Comment: 'str16',
    LastWritten: FILETIME,
    CredentialBlobSize: 'uint32_t',
    CredentialBlob: 'void *',
    Persist: 'uint32_t',
    AttributeCount: 'uint32_t',
    Attributes: 'void *',
    TargetAlias: 'str16',
    UserName: 'str16',
  });
  const CredWriteW = adv.func('bool __stdcall CredWriteW(ACCT_CREDENTIALW *cred, uint32_t flags)');
  const CredReadW = adv.func('bool __stdcall CredReadW(str16 target, uint32_t type, uint32_t flags, _Out_ void **cred)');
  const CredDeleteW = adv.func('bool __stdcall CredDeleteW(str16 target, uint32_t type, uint32_t flags)');
  const CredFree = adv.func('void __stdcall CredFree(void *p)');
  const GENERIC = 1;
  const PERSIST_LOCAL_MACHINE = 2;
  return (credApi = {
    write: (blob, target = TARGET) =>
      CredWriteW({ Flags: 0, Type: GENERIC, TargetName: target, CredentialBlobSize: blob.length, CredentialBlob: blob, Persist: PERSIST_LOCAL_MACHINE, UserName: 'account' }, 0),
    read: (target = TARGET) => {
      const out = [null];
      if (!CredReadW(target, GENERIC, 0, out)) return null;
      try {
        const c = koffi.decode(out[0], CREDENTIALW);
        return Buffer.from(koffi.decode(c.CredentialBlob, 'uint8_t', c.CredentialBlobSize));
      } finally {
        CredFree(out[0]);
      }
    },
    remove: (target = TARGET) => void CredDeleteW(target, GENERIC, 0),
  });
}

/** The stored session { refresh_token, email, name, last_refresh }, unless the 30-day idle rule ended it (then it is
 *  removed for every Reel app). Never logged, never in settings. */
function load() {
  let s;
  try {
    const blob = cred()?.read();
    s = blob ? JSON.parse(blob.toString('utf8')) : null;
  } catch {
    s = null;
  }
  if (!s?.refresh_token) return null;
  if (A.sessionExpired(s.last_refresh)) {
    cred()?.remove();
    return null;
  }
  return s;
}

// ---- Supabase Auth ----

async function post(route, body, bearer) {
  try {
    return await fetch(`${SUITE.url}${route}`, {
      method: 'POST',
      headers: { apikey: SUITE.anonKey, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AuthError("Couldn't reach your account. Check your connection");
  }
}

async function tokenRequest(grant, body) {
  const r = await post(`/auth/v1/token?grant_type=${grant}`, body);
  if (r.status >= 400 && r.status < 500) throw new AuthError('Signed out', true);
  if (!r.ok) throw new AuthError(`Your account server answered ${r.status}. Try again later`);
  try {
    return await r.json();
  } catch {
    throw new AuthError('Your account server sent an unexpected answer');
  }
}

/** Only the access token stays in memory; the refresh token is always read from Credential Manager. */
let access = null;

function keep(tr, previous) {
  const meta = tr.user?.user_metadata;
  const stored = {
    refresh_token: tr.refresh_token,
    email: tr.user?.email ?? previous?.email ?? null,
    name: meta?.full_name ?? meta?.name ?? previous?.name ?? null,
    last_refresh: new Date().toISOString(),
  };
  if (!cred()?.write(Buffer.from(JSON.stringify(stored), 'utf8'))) throw new AuthError("Couldn't keep you signed in: Windows Credential Manager refused");
  access = { token: tr.access_token, until: Date.now() + tr.expires_in * 1000 };
  return tr.access_token;
}

/** A valid access token, refreshed through the shared credential when needed. */
async function accessToken() {
  if (access && Date.now() + 60_000 < access.until) return access.token;
  access = null;
  // on a refusal read the credential again: another Reel app may have just rotated the token
  let lastTried = null;
  for (let i = 0; i < 2; i++) {
    const stored = load();
    if (!stored) throw new AuthError('Signed out', true);
    if (stored.refresh_token === lastTried) break;
    try {
      return keep(await tokenRequest('refresh_token', { refresh_token: stored.refresh_token }), stored);
    } catch (e) {
      if (!(e instanceof AuthError && e.signedOut)) throw e;
      lastTried = stored.refresh_token;
    }
  }
  cred()?.remove();
  throw new AuthError('Your session ended. Sign in again', true);
}

// ---- Sign in and out ----

let cancelPending = null;

const callbackPage = (title) =>
  `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title><body style="font-family:system-ui,sans-serif;text-align:center;padding-top:20vh"><h1>${title}</h1><p>You can close this tab and go back to ${APP_NAME}.</p>`;

/** Listen on a free loopback port, open Google sign-in in the browser and resolve with the code it sends back. */
function waitForCode(challenge) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const cb = A.parseCallback(req.url ?? '/');
      if (cb === 'ignore') return void res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(callbackPage('code' in cb ? "You're signed in" : "Sign-in didn't finish"));
      finish(() => ('code' in cb ? resolve(cb.code) : reject(new AuthError(cb.error))));
    });
    const timer = setTimeout(() => finish(() => reject(new AuthError('Sign-in timed out. Try again'))), A.SIGN_IN_TIMEOUT_MS);
    const finish = (settle) => {
      clearTimeout(timer);
      server.close();
      cancelPending = null;
      settle();
    };
    cancelPending?.();
    cancelPending = () => finish(() => reject(new AuthError('Sign-in cancelled')));
    server.on('error', (e) => finish(() => reject(new AuthError(`Couldn't start the sign-in (${e.message})`))));
    server.listen(0, '127.0.0.1', () => {
      shell
        .openExternal(A.authorizeUrl(SUITE.url, server.address().port, challenge))
        .catch((e) => finish(() => reject(new AuthError(`Couldn't open your browser (${e.message})`))));
    });
  });
}

let problem = null;

async function signIn() {
  if (!configured()) return status();
  problem = null;
  const verifier = newVerifier();
  const done = waitForCode(A.challengeFor(verifier));
  publish();
  try {
    keep(await tokenRequest('pkce', { auth_code: await done, code_verifier: verifier }), null);
    void ping();
  } catch (e) {
    if (e.message !== 'Sign-in cancelled') problem = e.signedOut ? 'Google sign-in was refused. Try again' : e.message;
  }
  return publish();
}

/** Revoke this PC's session (best effort, offline it just expires) and forget it in every Reel app on the PC. */
async function signOut() {
  try {
    await post('/auth/v1/logout?scope=local', {}, await accessToken());
  } catch {
    // offline or already signed out
  }
  cred()?.remove();
  access = null;
  lease = { plan: null, otherDevice: null };
  problem = null;
  const s = publish();
  void backToSignIn();
  return s;
}

let hooks = { send: () => {}, busy: async () => false, beforeRelaunch: async () => {} };
let relaunching = false;

/** Signed out (here, in another Reel app or by the server): start again at the sign-in screen, once no video export
 *  is running. While one is, the 3 s poll calls this again. */
async function backToSignIn() {
  if (relaunching || !configured() || load() || (await hooks.busy())) return;
  relaunching = true;
  await hooks.beforeRelaunch();
  app.relaunch();
  app.quit();
}

let signedInWaiters = [];

/** Sign-in is required and this PC has no session yet. */
const needsSignIn = () => configured() && !load();

/** Resolves once this PC has a session (at once when one is stored, also when another Reel app signed in). */
function whenSignedIn() {
  if (!needsSignIn()) return Promise.resolve();
  return new Promise((resolve) => signedInWaiters.push(resolve));
}

// ---- Licence lease ----

let lease = { plan: null, otherDevice: null };
let pingTimer;

/** Ping the `lease` function: the device hash, the PC name and the product, nothing else. */
async function ping(takeOver = false) {
  clearTimeout(pingTimer);
  if (!configured() || !load()) return;
  let ok = false;
  try {
    const r = await post(
      '/functions/v1/lease',
      { device_id: deviceId(), device_name: process.env.COMPUTERNAME || os.hostname(), product: A.PRODUCT, take_over: takeOver },
      await accessToken(),
    );
    const out = A.parseLease(r.status, await r.text());
    if ('plan' in out) lease = { plan: out.plan, otherDevice: null };
    else if ('otherDevice' in out) lease = { plan: 'free', otherDevice: out.otherDevice };
    problem = 'refused' in out ? out.refused : null;
    ok = true;
  } catch (e) {
    if (e instanceof AuthError && e.signedOut) {
      lease = { plan: null, otherDevice: null };
      publish();
      void backToSignIn();
      return;
    }
    // offline, or the lease function is not deployed yet (404, MyShareReel#52): quietly Free until a ping answers
    lease.plan ??= 'free';
    console.warn(`Lease ping: ${e.message}`);
  }
  publish();
  pingTimer = setTimeout(() => void ping(), ok ? A.PING_EVERY_MS : A.RETRY_MS);
}

function status() {
  const s = configured() ? load() : null;
  return {
    configured: configured(),
    signedIn: !!s,
    signingIn: !!cancelPending,
    email: s?.email,
    name: s?.name,
    plan: s ? lease.plan : null,
    otherDevice: s ? lease.otherDevice : null,
    problem,
  };
}

function publish() {
  const s = status();
  if (s.signedIn && signedInWaiters.length) {
    signedInWaiters.forEach((resolve) => resolve());
    signedInWaiters = [];
  }
  hooks.send(s);
  return s;
}

/** send(status) reaches the window; busy() is true while a video export runs; beforeRelaunch() keeps the model. */
function registerAccount(h) {
  hooks = { ...hooks, ...h };
  ipcMain.handle('account:status', () => status());
  ipcMain.handle('account:sign-in', () => signIn());
  ipcMain.handle('account:cancel', () => cancelPending?.());
  ipcMain.handle('account:sign-out', () => signOut());
  ipcMain.handle('account:take-over', () => ping(true).then(status));
  if (!configured()) return;
  // follow the other Reel apps: signed in while this one waits at the sign-in screen, or signed out while it runs
  setInterval(() => {
    const signedIn = !!load();
    if (signedInWaiters.length && signedIn) {
      publish();
      void ping();
    } else if (!signedInWaiters.length && !signedIn && !cancelPending) void backToSignIn();
  }, 3_000).unref();
  // at start, every 12 h (scheduled by ping) and on resume from sleep
  setTimeout(() => void ping(), 5_000);
  powerMonitor.on('resume', () => void ping());
}

/** Copilot feedback (#232): rows into the suite's ai_feedback table as the signed-in user (row-level security). */
async function uploadFeedback(rows) {
  if (!configured()) throw new Error('No suite account on this build.');
  const r = await post('/rest/v1/ai_feedback', rows, await accessToken());
  if (r.status === 409) return { uploaded: 0, already: true }; // the same record id was shared before
  if (!r.ok) throw new Error(`The suite answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { uploaded: rows.length };
}

/** Map service secrets (#267): API keys and tokens per service in Credential Manager, never in settings or the cloud. */
const secretTarget = (name) => `${TARGET}-map:${String(name).slice(0, 200)}`;
function getSecret(name) {
  const b = cred()?.read(secretTarget(name));
  return b ? JSON.parse(b.toString('utf8')) : null;
}
function setSecret(name, value) {
  if (!value) return cred()?.remove(secretTarget(name));
  if (!cred()?.write(Buffer.from(JSON.stringify(value), 'utf8'), secretTarget(name))) throw new Error('Windows Credential Manager refused the key');
}

/** The user's map services in the suite (#267): the map_services table, one row per service name, row-level security. */
async function rest(method, route, body) {
  if (!configured()) return null;
  let r;
  try {
    r = await fetch(`${SUITE.url}/rest/v1/${route}`, { method, headers: { apikey: SUITE.anonKey, Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("Couldn't reach your account. Check your connection");
  }
  if (!r.ok) throw new Error(`The suite answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return method === 'GET' ? r.json() : true;
}
const mapServices = {
  list: () => rest('GET', 'map_services?select=name,kind,url,config,updated_at&app=eq.MyModellerReel&order=name'),
  save: (row) => rest('POST', 'map_services?on_conflict=user_id,app,name', [{ app: 'MyModellerReel', name: row.name, kind: row.kind, url: row.url, config: row.config || {}, updated_at: new Date().toISOString() }]),
  remove: (name) => rest('DELETE', `map_services?app=eq.MyModellerReel&name=eq.${encodeURIComponent(name)}`),
};

module.exports = { registerAccount, needsSignIn, whenSignedIn, uploadFeedback, getSecret, setSecret, mapServices };
