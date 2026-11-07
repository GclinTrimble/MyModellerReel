// The MyStudioReel suite account (#115): one Google sign-in and one device for every Reel app on the PC. The shared
// contract is MyVoiceReel's docs/SUITE_ACCOUNT.md; the values marked "must match" there are the constants below.
// Pure logic, ported from MySnipReel's src/shared/account.ts; src/main/account.cjs talks to Windows and Supabase.
import crypto from 'node:crypto';

/** Windows Credential Manager entry shared by every Reel app (generic credential, user name `account`). Must match. */
export const CREDENTIAL_TARGET = 'MyStudioReel/account';
/** Prefixed to the MachineGuid before hashing, so every Reel app on the PC sends the same device id. Must match. */
export const DEVICE_SALT = 'MyStudioReel device v1:';
/** A session no Reel app refreshed for this long is dropped. */
export const SESSION_IDLE_DAYS = 30;
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
export const PRODUCT = 'mymodellerreel';
export const PING_EVERY_MS = 12 * 3_600_000;
/** After a failed ping (offline, server down), try again this much later. */
export const RETRY_MS = 30 * 60_000;
const CALLBACK_PATH = '/auth/callback';

export const challengeFor = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

export const deviceHash = (machineGuid) =>
  crypto
    .createHash('sha256')
    .update(DEVICE_SALT + machineGuid.trim().toLowerCase())
    .digest('hex');

export const redirectUri = (port) => `http://127.0.0.1:${port}${CALLBACK_PATH}`;

export function authorizeUrl(base, port, challenge) {
  const q = new URLSearchParams({ provider: 'google', redirect_to: redirectUri(port), code_challenge: challenge, code_challenge_method: 's256' });
  return `${base}/auth/v1/authorize?${q}`;
}

/** The request target the browser sends to the loopback listener (`/auth/callback?code=…`): { code } | { error } | 'ignore'. */
export function parseCallback(target) {
  let url;
  try {
    url = new URL(target, 'http://127.0.0.1');
  } catch {
    return 'ignore';
  }
  if (url.pathname !== CALLBACK_PATH) return 'ignore';
  const get = (k) => url.searchParams.get(k) || null;
  const code = get('code');
  return code ? { code } : { error: get('error_description') ?? get('error') ?? "Sign-in didn't finish" };
}

export function sessionExpired(lastRefresh, now = new Date()) {
  const t = Date.parse(lastRefresh);
  return !Number.isFinite(t) || now.getTime() - t > SESSION_IDLE_DAYS * 86_400_000;
}

/** The `lease` function's answer: { plan } | { otherDevice } | { refused }; throws on anything else. */
export function parseLease(status, body) {
  let a = {};
  try {
    a = JSON.parse(body) ?? {};
  } catch {
    // an empty or HTML answer: the status decides
  }
  if (status === 200 && a.lease) return { plan: 'pro' };
  if (status === 200 && a.edition === 'free') return { plan: 'free' };
  if (status === 409) {
    const other = a.other_device ?? { name: 'another PC' };
    return { otherDevice: { ...other, revoked: !!(a.revoked || other.revoked) } };
  }
  if (status === 429) return { refused: a.message ?? a.error ?? 'Your licence moved between PCs too often this month. Contact support to move it again' };
  throw new Error(status === 200 ? 'The licence server sent an unexpected answer. Try again later' : `The licence server answered ${status}. Try again later`);
}
