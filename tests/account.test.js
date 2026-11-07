// Suite account (#115), ported from MySnipReel's tests/unit/account.test.ts: the spec's check values pass unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeUrl, challengeFor, deviceHash, parseCallback, parseLease, sessionExpired } from '../src/core/account.js';

test('computes the PKCE challenge as in RFC 7636', () => {
  assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('computes the same device id as every Reel app (SUITE_ACCOUNT.md check value)', () => {
  const id = 'd696964beefaf8de7a626d7fa13b6c21d659686d8f4d418e200536d54876a709';
  assert.equal(deviceHash('6f1d2c3b-0000-4a5b-9c8d-123456789abc'), id);
  assert.equal(deviceHash(' 6F1D2C3B-0000-4A5B-9C8D-123456789ABC\n'), id);
});

test('builds the authorize URL with the loopback redirect', () => {
  const u = authorizeUrl('https://abc.supabase.co', 51234, 'chal');
  assert.ok(u.startsWith('https://abc.supabase.co/auth/v1/authorize?provider=google&'));
  assert.ok(u.includes('redirect_to=http%3A%2F%2F127.0.0.1%3A51234%2Fauth%2Fcallback'));
  assert.ok(u.includes('code_challenge=chal&code_challenge_method=s256'));
});

test('parses the callback', () => {
  assert.deepEqual(parseCallback('/auth/callback?code=abc-123'), { code: 'abc-123' });
  assert.deepEqual(parseCallback('/auth/callback?error=access_denied&error_description=User+said+no'), { error: 'User said no' });
  assert.deepEqual(parseCallback('/auth/callback?error=access_denied'), { error: 'access_denied' });
  assert.deepEqual(parseCallback('/auth/callback'), { error: "Sign-in didn't finish" });
  assert.equal(parseCallback('/favicon.ico'), 'ignore');
  assert.equal(parseCallback('/auth/callbackx?code=1'), 'ignore');
});

test('ends a session after 30 idle days', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  assert.equal(sessionExpired('2026-09-28T00:00:00Z', now), false);
  assert.equal(sessionExpired('2026-09-27T00:00:00Z', now), true);
  assert.equal(sessionExpired('not a date', now), true);
});

test('reads lease answers', () => {
  assert.deepEqual(parseLease(200, '{"edition":"pro","lease":"msr2.a.b"}'), { plan: 'pro' });
  assert.deepEqual(parseLease(200, '{"edition":"free"}'), { plan: 'free' });
  assert.throws(() => parseLease(200, 'oops'), /unexpected/);
  assert.deepEqual(parseLease(409, '{"other_device":{"name":"DESKTOP-ABC","last_seen":"2026-10-27T08:00:00Z"}}'), {
    otherDevice: { name: 'DESKTOP-ABC', last_seen: '2026-10-27T08:00:00Z', revoked: false },
  });
  assert.deepEqual(parseLease(409, '{"revoked":true,"other_device":{"name":"VM"}}'), { otherDevice: { name: 'VM', revoked: true } });
  assert.deepEqual(parseLease(429, '{"message":"Contact support"}'), { refused: 'Contact support' });
  assert.throws(() => parseLease(500, ''), /500/);
  assert.throws(() => parseLease(404, ''), /404/); // the lease function is not deployed yet (MyShareReel#52)
});
