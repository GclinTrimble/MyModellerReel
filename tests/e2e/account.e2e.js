// Required sign-in (#115) against a mock of the suite's Supabase project (MMR_SUITE_URL), ported from MySnipReel's
// tests/e2e/account.spec.ts. Under MMR_TEST the app keeps its session in the MyStudioReel/account-test credential and
// its data in a temp folder (MMR_HOME), so this never touches the real sign-in or models of this PC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import electronPath from 'electron';
import { _electron } from 'playwright';

const forget = () => {
  try {
    execFileSync('cmdkey', ['/delete:MyStudioReel/account-test'], { stdio: 'ignore' });
  } catch {
    // not there
  }
};

test('the app waits at the sign-in screen, signs in with Google and goes back to it on sign out', async () => {
  forget();
  const seen = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    seen.push(`${u.pathname}?${u.searchParams.get('grant_type') ?? ''}`);
    const json = (status, o) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
    if (u.pathname === '/auth/v1/authorize') return res.writeHead(302, { Location: `${u.searchParams.get('redirect_to')}?code=CODE1` }).end();
    if (u.pathname === '/auth/v1/token')
      return json(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { email: 'ada@example.com', user_metadata: { full_name: 'Ada Lovelace' } } });
    if (u.pathname === '/functions/v1/lease') return json(404, { message: 'Requested function was not found' }); // not deployed yet
    res.writeHead(204).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-e2e-'));
  const a = await _electron.launch({
    executablePath: electronPath,
    args: ['.'],
    env: { ...process.env, MMR_TEST: '1', MMR_HOME: home, MMR_SUITE_URL: `http://127.0.0.1:${server.address().port}` },
  });
  try {
    const w = await a.firstWindow();
    await w.locator('#signin-gate').waitFor();
    assert.equal(await w.locator('#viewport').count(), 0, 'nothing but the sign-in screen');
    assert.equal(await w.textContent('h1'), 'Sign in to use MyModellerReel');
    // the browser step: follow the authorize redirect here instead of opening the real browser
    await a.evaluate((e) => {
      e.shell.openExternal = async (url) => void (await fetch(url));
    });
    await w.click('#signin-google');
    await w.locator('#viewport').waitFor();
    assert.ok(seen.includes('/auth/v1/token?pkce'));

    await a.evaluate((e) => {
      e.app.relaunch = () => void (globalThis.relaunched = true);
      e.app.quit = () => void (globalThis.quitAsked = true);
    });
    await w.click('[data-tab="settings"]');
    const card = w.locator('#pref-account');
    await card.getByText('Ada Lovelace').waitFor();
    await card.getByText('Free plan').waitFor(); // the lease 404 fails quietly
    assert.equal(await card.locator('.acct-problem').count(), 0);
    assert.equal(await card.locator('.acct-avatar').textContent(), 'A');
    await w.click('#account-sign-out');
    for (let i = 0; i < 50 && !(await a.evaluate(() => globalThis.relaunched === true)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await a.evaluate(() => globalThis.relaunched === true), true, 'relaunched to the sign-in screen');
    assert.ok(seen.includes('/auth/v1/logout?'));
  } finally {
    forget();
    await a.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await a.close().catch(() => {});
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
