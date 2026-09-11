import { describe, expect, it } from 'vitest';
import { HttpSyncApi } from '../src/sync/api.js';

const base = 'http://localhost:3000';
const session = { jobId: 'job', token: 'ephemeral-token', apiBaseUrl: base, knownExternalIds: [], knownPostCodes: [], knownPosts: [], expiresInSeconds: 14400, heartbeatIntervalSeconds: 30 };
describe('sync HTTP credential boundary', () => {
  it('never retries admission, maps safe conflicts, and never leaks API error details', async () => {
    for (const [status, payload, expected] of [
      [409, {error: {code: 'SYNC_IN_PROGRESS'}}, 'SYNC_IN_PROGRESS'],
      [409, {error: {code: 'SYNC_ALREADY_COMPLETED'}}, 'SYNC_ALREADY_COMPLETED'],
      [429, {error: {code: 'SYNC_DAILY_LIMIT'}}, 'SYNC_DAILY_LIMIT'],
      [500, {error: {message: 'private response'}}, 'SYNC_API_UNAVAILABLE'],
    ] as const) {
      let calls = 0;
      const api = new HttpSyncApi(base, async () => { calls++; return Response.json(payload, {status}); });
      await expect(api.createSession('long-secret')).rejects.toThrow(expected);
      expect(calls).toBe(1);
    }
  });
  it('rejects destination changes and redirects before a run token reaches another origin', async () => {
    const api = new HttpSyncApi(base, async (_url, options) => {
      expect(options?.redirect).toBe('error');
      return Response.json({...session, apiBaseUrl: 'https://attacker.example'}, {status: 201});
    });
    await expect(api.createSession('long-secret')).rejects.toThrow('SYNC_SESSION_INVALID');
  });
  it('uses the long key only for admission and temporary token for bounded retry heartbeats/status', async () => {
    const seen: {url: string; auth: string | null}[] = []; let transient = true;
    const api = new HttpSyncApi(base, async (url, options) => {
      seen.push({url: String(url), auth: new Headers(options?.headers).get('Authorization')});
      if (String(url).endsWith('/session')) return Response.json(session, {status: 201});
      if (transient) { transient = false; return Response.json({}, {status: 503}); }
      return Response.json({ok: true});
    }, 1);
    const accepted = await api.createSession('long-secret');
    await api.heartbeat(accepted.token);
    expect(seen).toEqual([
      {url: `${base}/api/v1/sync/session`, auth: 'Bearer long-secret'},
      {url: `${base}/api/sync/heartbeat`, auth: 'Bearer ephemeral-token'},
      {url: `${base}/api/sync/heartbeat`, auth: 'Bearer ephemeral-token'},
    ]);
  });
});
