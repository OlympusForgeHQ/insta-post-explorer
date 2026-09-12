import { setTimeout as delay } from 'node:timers/promises';
import { HttpSyncApi, type SyncApi, type SyncJobStatus, type SyncSession } from './api.js';
import { launchCollector, type BrowserCollector } from './browser.js';
import type { SyncConfig } from './config.js';
import { safeError, SyncError } from './errors.js';

export type RunResult = {status: 'completed'} | {status: 'skipped'; reason: 'SYNC_IN_PROGRESS' | 'SYNC_ALREADY_COMPLETED'};
export interface RunDependencies {
  api?: SyncApi;
  launch?: (config: SyncConfig, signal: AbortSignal) => Promise<BrowserCollector>;
  signal?: AbortSignal;
}
async function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason); signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
function verifyStatus(status: SyncJobStatus, session: SyncSession): boolean {
  if (status.id !== session.jobId) throw new SyncError('SYNC_API_REJECTED');
  if (status.status === 'FAILED') throw new SyncError('SYNC_FAILED');
  return status.status === 'COMPLETED';
}
export async function runSync(config: SyncConfig, dependencies: RunDependencies = {}): Promise<RunResult> {
  const api = dependencies.api ?? new HttpSyncApi(config.appUrl);
  const launch = dependencies.launch ?? ((value, signal) => launchCollector(value, {signal}));
  const stop = new AbortController();
  const externalAbort = () => stop.abort(new SyncError('SYNC_INTERRUPTED'));
  dependencies.signal?.addEventListener('abort', externalAbort, {once: true});
  if (dependencies.signal?.aborted) externalAbort();
  const deadline = Date.now() + config.maxRunMs;
  const timer = setTimeout(() => stop.abort(new SyncError('SYNC_TIMEOUT')), config.maxRunMs);
  const signal = stop.signal;
  let session: SyncSession | undefined;
  let browser: BrowserCollector | undefined;
  let completed = false;
  let failure: SyncError | undefined;
  let heartbeat: Promise<void> | undefined;
  const heartbeatStop = new AbortController();
  const heartbeatSignal = AbortSignal.any([signal, heartbeatStop.signal]);
  try {
    if (!config.automationKey) throw new SyncError('SYNC_CONFIG_INVALID');
    const launched = launch(config, signal);
    // Close a context that finishes launching after interruption as well.
    void launched.then(value => { if (signal.aborted) return value.close(); }).catch(() => {});
    browser = await interruptible(launched, signal);
    if (!await interruptible(browser.checkLogin(), signal)) throw new SyncError('SYNC_NEEDS_LOGIN');
    try { session = await api.createSession(config.automationKey, signal); }
    catch (error) {
      if (error instanceof SyncError && (error.code === 'SYNC_IN_PROGRESS' || error.code === 'SYNC_ALREADY_COMPLETED')) return {status: 'skipped', reason: error.code};
      throw error;
    }
    const accepted = session;
    heartbeat = (async () => {
      while (!heartbeatSignal.aborted) {
        try {
          await api.heartbeat(accepted.token, heartbeatSignal);
          await delay(accepted.heartbeatIntervalSeconds * 1000, undefined, {signal: heartbeatSignal});
        } catch (error) {
          if (heartbeatSignal.aborted) return;
          // A completion may race the heartbeat's active-job check. Confirm its terminal DB state.
          try {
            completed = verifyStatus(await api.status(accepted.token, heartbeatSignal), accepted);
            if (completed) return;
          } catch { /* Preserve a safe heartbeat failure below. */ }
          stop.abort(safeError(error)); return;
        }
      }
    })();
    await interruptible(browser.prepareSession(), signal);
    await interruptible(browser.start(accepted), signal);
    let terminalObservedAt: number | undefined;
    for (;;) {
      signal.throwIfAborted();
      if (completed || verifyStatus(await api.status(accepted.token, signal), accepted)) {
        completed = true; return {status: 'completed'};
      }
      const state = await interruptible(browser.getState(), signal);
      if (state?.status === 'failed') throw new SyncError('SYNC_EXTENSION_FAILED');
      if (state?.status === 'paused') {
        if (['auth_error', 'login_required', 'challenge_required', 'checkpoint_required'].includes(state.pausedReason?.reason ?? '')) throw new SyncError('SYNC_NEEDS_LOGIN');
        const resumeAt = state.resumeAt ? Date.parse(state.resumeAt) : NaN;
        if (!Number.isFinite(resumeAt) || resumeAt >= deadline) throw new SyncError('SYNC_PAUSE_EXCEEDS_DEADLINE');
      }
      // The extension swallows completion POST errors. Give in-flight persistence a short bounded window.
      if (state?.status === 'completed') {
        terminalObservedAt ??= Date.now();
        if (Date.now() - terminalObservedAt >= Math.min(30_000, config.pollMs * 3)) throw new SyncError('SYNC_COMPLETION_UNCONFIRMED');
      }
      await delay(config.pollMs, undefined, {signal});
    }
  } catch (error) {
    failure = signal.aborted ? safeError(signal.reason) : safeError(error);
    throw failure;
  } finally {
    clearTimeout(timer);
    dependencies.signal?.removeEventListener('abort', externalAbort);
    heartbeatStop.abort();
    await heartbeat;
    // Fence the collector locally before reporting a failed job to the API.
    await browser?.close().catch(() => {});
    if (session && !completed && failure) await api.fail(session.token, failure.code).catch(() => {});
  }
}
