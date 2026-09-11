import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCollector } from './browser.js';
import { isScheduleDue, loadSyncConfig } from './config.js';
import { safeError, SyncError } from './errors.js';
import { runSync } from './runner.js';

export async function executeCommand(command: string, env: Record<string, string | undefined> = process.env, signal?: AbortSignal): Promise<{status: string; reason?: string}> {
  if (!['run', 'scheduled', 'login', 'check'].includes(command)) throw new SyncError('SYNC_CONFIG_INVALID');
  const config = loadSyncConfig(env, command === 'run');
  if (command === 'scheduled' && !isScheduleDue(config)) return {status: 'skipped', reason: 'BEFORE_SCHEDULE'};
  if (command === 'scheduled' || command === 'run') return runSync(loadSyncConfig(env), {signal});
  const stop = new AbortController();
  const abort = () => stop.abort(new SyncError('SYNC_INTERRUPTED'));
  signal?.addEventListener('abort', abort, {once: true});
  if (signal?.aborted) abort();
  const timer = command === 'check' ? setTimeout(() => stop.abort(new SyncError('SYNC_TIMEOUT')), 60_000) : undefined;
  let collector: Awaited<ReturnType<typeof launchCollector>> | undefined;
  try {
    collector = await launchCollector(config, {headed: command === 'login', signal: stop.signal});
    if (command === 'login') {
      await collector.openLogin();
      process.stdout.write(`${JSON.stringify({status: 'awaiting_private_login', action: 'Complete Instagram login in the private display, then close Chromium.'})}\n`);
      await collector.waitForClose();
      if (stop.signal.aborted) throw stop.signal.reason;
      return {status: 'browser_closed', reason: 'RUN_CHECK_TO_VERIFY_LOGIN'};
    }
    if (!await collector.checkLogin()) throw new SyncError('SYNC_NEEDS_LOGIN');
    return {status: 'login_present'};
  } catch (error) {
    if (stop.signal.aborted) throw stop.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    await collector?.close().catch(() => {});
  }
}
async function main(): Promise<void> {
  const stop = new AbortController();
  const abort = () => stop.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  try {
    if (process.argv.length !== 3) throw new SyncError('SYNC_CONFIG_INVALID');
    const result = await executeCommand(process.argv[2], process.env, stop.signal);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({status: 'failed', code: safeError(error).code})}\n`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', abort); process.off('SIGTERM', abort);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
