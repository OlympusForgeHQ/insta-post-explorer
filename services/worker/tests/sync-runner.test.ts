import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncApi, SyncJobStatus, SyncSession } from '../src/sync/api.js';
import type { BrowserCollector, CollectorState } from '../src/sync/browser.js';
import { loadSyncConfig } from '../src/sync/config.js';
import { SyncError } from '../src/sync/errors.js';
import { runSync } from '../src/sync/runner.js';

const config = {...loadSyncConfig({SYNC_APP_URL: 'http://localhost:3000', SYNC_PROFILE_DIR: '/tmp/sync-runner-test', INSTAGRAM_AUTO_SYNC_KEY: `ips_sync_${'a'.repeat(43)}`}), pollMs: 10, maxRunMs: 500};
const session: SyncSession = {jobId: 'job', token: 'temporary', apiBaseUrl: config.appUrl, knownExternalIds: [], knownPostCodes: [], knownPosts: [], expiresInSeconds: 14400, heartbeatIntervalSeconds: 0.02};
const status: SyncJobStatus = {id: 'job', status: 'RUNNING', collected: 0, imported: 0, updated: 0, errorCode: null, leaseExpiresAt: null};
function rig() {
  const events: string[] = [];
  const api: SyncApi = {
    async createSession(key) { expect(key).toBe(config.automationKey); return session; },
    async heartbeat(token) { expect(token).toBe('temporary'); events.push('heartbeat'); },
    async status() { return status; },
    async fail(_token, code) { events.push(`fail:${code}`); },
  };
  const browser: BrowserCollector = {
    async checkLogin() { return true; },
    async prepareSession() { events.push('prepare'); },
    async start(value) { expect(value).toEqual(session); events.push('start'); },
    async getState() { return {status: 'running', resumeAt: null, pausedReason: null}; },
    async close() { events.push('close'); },
  };
  return {api, browser, events, launch: async () => browser};
}
afterEach(() => vi.useRealTimers());
describe('automatic sync orchestration', () => {
  it('treats admission conflicts as skips and the daily cap as actionable failure, closing the checked browser', async () => {
    const r = rig();
    for (const code of ['SYNC_IN_PROGRESS', 'SYNC_ALREADY_COMPLETED', 'SYNC_DAILY_LIMIT'] as const) {
      r.api.createSession = async () => { throw new SyncError(code); };
      if (code === 'SYNC_DAILY_LIMIT') await expect(runSync(config, r)).rejects.toThrow(code);
      else expect(await runSync(config, r)).toEqual({status: 'skipped', reason: code});
    }
  });
  it('does not consume an admission or erase task state when Instagram login is missing', async () => {
    const r = rig();
    r.browser.checkLogin = async () => false;
    r.api.createSession = async () => { throw new Error('admission must not happen'); };
    await expect(runSync(config, r)).rejects.toThrow('SYNC_NEEDS_LOGIN');
    expect(r.events).toEqual(['close']);
  });
  it('requires DB completion even if the extension claims success', async () => {
    const r = rig();
    r.browser.getState = async () => ({status: 'completed', resumeAt: null, pausedReason: null});
    await expect(runSync(config, r)).rejects.toThrow('SYNC_COMPLETION_UNCONFIRMED');
    expect(r.events.slice(-2)).toEqual(['close', 'fail:SYNC_COMPLETION_UNCONFIRMED']);
  });
  it('returns completion only for the admitted DB job and closes the browser', async () => {
    const r = rig(); r.api.status = async () => ({...status, status: 'COMPLETED'});
    expect(await runSync(config, r)).toEqual({status: 'completed'});
    expect(r.events.at(-1)).toBe('close'); expect(r.events.some(event => event.startsWith('fail:'))).toBe(false);
  });
  it('keeps heartbeat independent of a blocked collector and closes before failing on timeout', async () => {
    const r = rig(); r.browser.getState = () => new Promise(() => {});
    await expect(runSync({...config, maxRunMs: 90}, r)).rejects.toThrow('SYNC_TIMEOUT');
    expect(r.events.filter(e => e === 'heartbeat').length).toBeGreaterThan(1);
    expect(r.events.slice(-2)).toEqual(['close', 'fail:SYNC_TIMEOUT']);
  });
  it('handles login/challenge, unbounded pauses, failed states and signals without disclosing messages', async () => {
    for (const [state, error] of [
      [{status: 'paused', pausedReason: {reason: 'auth_error', note: 'private IG challenge'}, resumeAt: null}, 'SYNC_NEEDS_LOGIN'],
      [{status: 'paused', pausedReason: {reason: 'rate_limited'}, resumeAt: new Date(Date.now() + 60_000).toISOString()}, 'SYNC_PAUSE_EXCEEDS_DEADLINE'],
      [{status: 'failed', error: 'private remote error', pausedReason: null, resumeAt: null}, 'SYNC_EXTENSION_FAILED'],
    ] as const) {
      const r = rig(); r.browser.getState = async () => state as CollectorState;
      await expect(runSync(config, r)).rejects.toThrow(error);
      expect(r.events.slice(-2)).toEqual(['close', `fail:${error}`]);
    }
    const r = rig(); const stop = new AbortController();
    r.browser.getState = async () => { stop.abort(); return null; };
    await expect(runSync(config, {...r, signal: stop.signal})).rejects.toThrow('SYNC_INTERRUPTED');
    expect(r.events.slice(-2)).toEqual(['close', 'fail:SYNC_INTERRUPTED']);
  });
  it('stops collection and releases the job when heartbeats lose authority', async () => {
    const r = rig(); let renewals = 0;
    r.api.heartbeat = async () => { if (++renewals > 1) throw new SyncError('SYNC_API_REJECTED'); };
    r.browser.getState = () => new Promise(() => {});
    await expect(runSync(config, r)).rejects.toThrow('SYNC_API_REJECTED');
    expect(r.events.slice(-2)).toEqual(['close', 'fail:SYNC_API_REJECTED']);
  });
  it('rejects another job status even when that job is completed', async () => {
    const r = rig(); r.api.status = async () => ({...status, id: 'another-job', status: 'COMPLETED'});
    await expect(runSync(config, r)).rejects.toThrow('SYNC_API_REJECTED');
    expect(r.events.slice(-2)).toEqual(['close', 'fail:SYNC_API_REJECTED']);
  });
  it('waits through a finite rate pause and still verifies completion in the API', async () => {
    const r = rig(); let checked = false;
    r.browser.getState = async () => {checked = true; return {status: 'paused', pausedReason: {reason: 'rate_limited'}, resumeAt: new Date(Date.now() + 10).toISOString()};};
    r.api.status = async () => ({...status, status: checked ? 'COMPLETED' : 'RUNNING'});
    expect(await runSync(config, r)).toEqual({status: 'completed'});
  });
});
