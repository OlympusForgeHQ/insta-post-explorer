import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchCollector } from '../dist/sync/browser.js';
import { loadSyncConfig } from '../dist/sync/config.js';
import { runSync } from '../dist/sync/runner.js';

// Actual Chromium + unmodified extension + HTTP client. Only remote services are fixtures.
// No operator profile, credentials or Instagram requests are used.
const root = await mkdtemp(join(tmpdir(), 'insta-sync-collector-smoke-'));
const key = `ips_sync_${'T'.repeat(43)}`;
const token = 'synthetic-run-token';
const counters = {sessions: 0, heartbeat: 0, instagram: 0, media: 0, upload: 0, posts: 0};
let status = 'PENDING';
let failure;
const payloads = [];
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/sync/session') {
      assert.equal(req.headers.authorization, `Bearer ${key}`);
      counters.sessions++;
      if (status === 'COMPLETED') {
        res.writeHead(409).end(JSON.stringify({error: {code: 'SYNC_ALREADY_COMPLETED'}})); return;
      }
      res.writeHead(201).end(JSON.stringify({jobId: 'fixture-job', token, apiBaseUrl: 'http://localhost:3000',
        knownExternalIds: [], knownPostCodes: [], knownPosts: [], expiresInSeconds: 14400, heartbeatIntervalSeconds: 1})); return;
    }
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.url === '/api/sync/status') {
      res.end(JSON.stringify({id: 'fixture-job', status, collected: counters.posts, imported: counters.posts, updated: 0, errorCode: null, leaseExpiresAt: new Date(Date.now() + 300000).toISOString()}));
    } else if (req.url === '/api/sync/heartbeat') {
      counters.heartbeat++; res.end(JSON.stringify({ok: true}));
    } else if (req.url === '/api/sync/media/prepare') {
      const input = JSON.parse(body);
      assert.equal(input.postCode, 'FixtureCode'); assert.equal(input.byteSize, 4);
      res.end(JSON.stringify({uploadUrl: 'https://fixture.r2.cloudflarestorage.com/upload', objectKey: 'originals/fixture/FixtureCode.jpg', sourcePath: 'fixture/FixtureCode.jpg'}));
    } else if (req.url === '/api/sync/posts') {
      const post = JSON.parse(body);
      assert.equal(post.external_id, '900000001'); assert.equal(post.media[0].byteSize, 4);
      assert.equal(counters.upload, 1);
      payloads.push(post); counters.posts++; status = 'RUNNING';
      res.writeHead(201).end(JSON.stringify({imported: 1, updated: 0}));
    } else if (req.url === '/api/sync/complete') {
      const result = JSON.parse(body);
      assert.equal(result.status, 'completed'); assert.equal(counters.posts, 1);
      status = 'COMPLETED'; res.end(JSON.stringify({ok: true, status}));
    } else { throw new Error('UNEXPECTED_FIXTURE_REQUEST'); }
  } catch (error) { failure = error; res.writeHead(500).end('{}'); }
});
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3000, 'localhost', resolve); });
  const config = {...loadSyncConfig({SYNC_APP_URL: 'http://localhost:3000', INSTAGRAM_AUTO_SYNC_KEY: key, SYNC_PROFILE_DIR: join(root, 'profile')}), maxRunMs: 60000, pollMs: 250};
  const launch = async (value, signal) => {
    const collector = await launchCollector(value, {signal});
    await collector.context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === config.appUrl || url.protocol === 'chrome-extension:') return route.continue();
      if (url.hostname === 'www.instagram.com' && url.pathname === '/api/v1/feed/saved/posts/') {
        counters.instagram++;
        return route.fulfill({json: {items: [{media: {pk: '900000001', code: 'FixtureCode', media_type: 1, taken_at: 1789128000,
          user: {username: 'fixture'}, caption: {text: 'Synthetic collector test'}, like_count: 1, comment_count: 0,
          image_versions2: {candidates: [{url: 'https://fixture.cdninstagram.com/image.jpg', width: 1, height: 1}]}}}], more_available: false}});
      }
      if (url.hostname === 'fixture.cdninstagram.com') {
        counters.media++; return route.fulfill({contentType: 'image/jpeg', body: Buffer.from([255, 216, 255, 217])});
      }
      if (url.hostname === 'fixture.r2.cloudflarestorage.com') {
        assert.equal(route.request().method(), 'PUT'); assert.equal(route.request().postDataBuffer().length, 4);
        counters.upload++; return route.fulfill({status: 200, body: ''});
      }
      return route.abort();
    });
    await collector.context.addCookies([{name: 'sessionid', value: 'synthetic-session', domain: '.instagram.com', path: '/', secure: true}]);
    return collector;
  };
  assert.deepEqual(await runSync(config, {launch}), {status: 'completed'});
  assert.deepEqual(await runSync(config, {launch}), {status: 'skipped', reason: 'SYNC_ALREADY_COMPLETED'});
  if (failure) throw failure;
  assert.equal(payloads.length, 1);
  assert.equal(counters.instagram, 1); assert.equal(counters.media, 1); assert.ok(counters.heartbeat >= 1);
  console.log(JSON.stringify({status: 'passed', checks: ['actual_extension_collects_post', 'media_download_prepare_upload_import', 'http_completion_confirmed', 'second_run_skipped'], counters}));
} catch (error) {
  console.error(JSON.stringify({status: 'failed', code: error.message?.startsWith('SYNC_') ? error.message : 'SYNC_COLLECTOR_SMOKE_FAILED', counters}));
  process.exitCode = 1;
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(root, {recursive: true, force: true});
}
