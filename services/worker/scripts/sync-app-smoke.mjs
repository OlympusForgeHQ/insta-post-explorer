import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { launchCollector } from '../dist/sync/browser.js';
import { loadSyncConfig } from '../dist/sync/config.js';
import { runSync } from '../dist/sync/runner.js';

// Real Next.js + PostgreSQL + Chromium/extension. Empty Instagram feed is intercepted.
// Requires a disposable migrated DB; refuses non-loopback database connections.
const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(databaseUrl && ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname), 'Disposable loopback TEST_DATABASE_URL required');
const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const prisma = new PrismaClient({datasources: {db: {url: databaseUrl}}});
const root = await mkdtemp(join(tmpdir(), 'insta-sync-app-smoke-'));
const owner = `collector-test-${randomUUID()}`;
const key = `ips_sync_${randomBytes(32).toString('base64url')}`;
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', 'localhost', '--port', '3000'], {
  cwd, stdio: 'ignore', env: {...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl,
    APP_OWNER_ID: owner, AUTH_DISABLED: 'false', AUTH_SECRET: randomBytes(48).toString('base64url'),
    ADMIN_PASSWORD_HASH: `$2b$12$${'A'.repeat(53)}`, NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    INSTAGRAM_AUTO_SYNC_ENABLED: '1', INSTAGRAM_AUTO_SYNC_KEY_SHA256: createHash('sha256').update(key).digest('hex'),
    INSTAGRAM_AUTO_SYNC_TIMEZONE: 'Europe/Brussels', EXTERNAL_API_KEY_SHA256: '',
  },
});
const stopped = once(app, 'exit');
let requests = 0;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (app.exitCode !== null) break;
    try { if ((await fetch('http://localhost:3000/api/health', {signal: AbortSignal.timeout(2000)})).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'TEST_APPLICATION_NOT_READY');
  const config = {...loadSyncConfig({SYNC_APP_URL: 'http://localhost:3000', INSTAGRAM_AUTO_SYNC_KEY: key, SYNC_PROFILE_DIR: join(root, 'profile')}), pollMs: 500, maxRunMs: 120000};
  const launch = async (value, signal) => {
    const browser = await launchCollector(value, {signal});
    await browser.context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === config.appUrl || url.protocol === 'chrome-extension:') return route.continue();
      if (url.hostname === 'www.instagram.com' && url.pathname === '/api/v1/feed/saved/posts/') {
        requests++; return route.fulfill({json: {items: [], more_available: false}});
      }
      return route.abort();
    });
    await browser.context.addCookies([{name: 'sessionid', value: 'synthetic-session', domain: '.instagram.com', path: '/', secure: true}]);
    return browser;
  };
  assert.deepEqual(await runSync(config, {launch}), {status: 'completed'});
  const jobs = await prisma.syncJob.findMany({where: {ownerId: owner}});
  assert.equal(jobs.length, 1); assert.equal(jobs[0].status, 'COMPLETED'); assert.ok(jobs[0].automationDay);
  assert.deepEqual(await runSync(config, {launch}), {status: 'skipped', reason: 'SYNC_ALREADY_COMPLETED'});
  assert.equal(await prisma.syncJob.count({where: {ownerId: owner}}), 1);
  assert.equal(requests, 1);
  console.log(JSON.stringify({status: 'passed', checks: ['real_next_session_jwt', 'real_extension_empty_feed', 'postgres_completion', 'postgres_daily_deduplication']}));
} catch (error) {
  console.error(JSON.stringify({status: 'failed', code: error.message?.startsWith('SYNC_') ? error.message : 'SYNC_APP_SMOKE_FAILED', requests}));
  process.exitCode = 1;
} finally {
  app.kill('SIGTERM'); const timer = setTimeout(() => app.kill('SIGKILL'), 5000);
  await stopped; clearTimeout(timer);
  await prisma.syncJob.deleteMany({where: {ownerId: owner}}); await prisma.$disconnect();
  await rm(root, {recursive: true, force: true});
}
