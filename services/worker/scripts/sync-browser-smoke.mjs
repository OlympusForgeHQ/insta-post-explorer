import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchCollector } from '../dist/sync/browser.js';
import { loadSyncConfig } from '../dist/sync/config.js';

// This rehearsal uses only a fresh temporary profile; it never reads an operator session.
const root = await mkdtemp(join(tmpdir(), 'insta-sync-browser-smoke-'));
let collector;
let stage = 'launch';
try {
  const config = loadSyncConfig({SYNC_APP_URL: 'http://localhost:3000', SYNC_PROFILE_DIR: join(root, 'profile')}, false);
  collector = await launchCollector(config);
  stage = 'check_login';
  assert.equal(await collector.checkLogin(), false);
  assert.equal(await collector.getState(), null);
  stage = 'profile_lock';
  await assert.rejects(launchCollector(config), {message: 'SYNC_BROWSER_UNAVAILABLE'});
  const optionsPage = collector.context.pages().find(page => page.url().startsWith('chrome-extension://'));
  assert.ok(optionsPage);
  stage = 'service_worker_restart';
  const cdp = await collector.context.newCDPSession(optionsPage);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  assert.equal(await collector.getState(), null);
  assert.equal(await collector.checkLogin(), false);
  stage = 'admitted_stale_task_recovery';
  await optionsPage.evaluate(async () => {
    const {TaskStoreRaw, PageStore, ArchiveStore} = await import(chrome.runtime.getURL('idb.js'));
    await TaskStoreRaw.put({id: 'web-sync', status: 'running', updatedAt: new Date().toISOString()});
    await PageStore.add('web-sync', 0, [{sentinel: 'obsolete'}]);
    await TaskStoreRaw.put({id: 'archive-export', status: 'completed', sentinel: 'keep'});
    await ArchiveStore.put({seenPks: ['archive-sentinel'], count: 1});
  });
  await collector.prepareSession();
  const retained = await optionsPage.evaluate(async () => {
    const {TaskStoreRaw, PageStore, ArchiveStore} = await import(chrome.runtime.getURL('idb.js'));
    return {obsolete: (await TaskStoreRaw.get('web-sync')) ?? null, pages: (await PageStore.all('web-sync')).length,
      other: (await TaskStoreRaw.get('archive-export')).sentinel, archive: (await ArchiveStore.get()).seenPks};
  });
  assert.deepEqual(retained, {obsolete: null, pages: 0, other: 'keep', archive: ['archive-sentinel']});
  assert.equal(await collector.getState(), null);
  const alarmRestored = await optionsPage.evaluate(async () => Boolean(await chrome.alarms.get('ig-export-tick')));
  assert.equal(alarmRestored, true);
  console.log(JSON.stringify({status: 'passed', checks: ['bundled_chromium', 'extension_4.2.8', 'empty_profile_login_check', 'profile_lock_refusal', 'service_worker_restart_messaging', 'admitted_stale_task_recovery_preserves_archive']}));
} catch {
  console.error(JSON.stringify({status: 'failed', code: 'SYNC_BROWSER_SMOKE_FAILED', stage}));
  process.exitCode = 1;
} finally {
  await collector?.close();
  await rm(root, {recursive: true, force: true});
}
