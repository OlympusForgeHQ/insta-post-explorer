import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { SyncError, type SyncErrorCode } from './errors.js';

const sessionSchema = z.object({
  jobId: z.string().min(1), token: z.string().min(1), apiBaseUrl: z.string(),
  knownExternalIds: z.array(z.string()).max(10_000), knownPostCodes: z.array(z.string()).max(10_000),
  knownPosts: z.array(z.object({ externalId: z.string().nullable(), postCode: z.string().nullable() })).max(10_000),
  expiresInSeconds: z.literal(14_400), heartbeatIntervalSeconds: z.number().int().min(1).max(60),
});
const statusSchema = z.object({
  id: z.string().min(1), status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  collected: z.number().int().nonnegative(), imported: z.number().int().nonnegative(), updated: z.number().int().nonnegative(),
  errorCode: z.string().nullable(), leaseExpiresAt: z.string().nullable(),
});
export type SyncSession = z.infer<typeof sessionSchema>;
export type SyncJobStatus = z.infer<typeof statusSchema>;
export interface SyncApi {
  createSession(key: string, signal?: AbortSignal): Promise<SyncSession>;
  heartbeat(token: string, signal?: AbortSignal): Promise<void>;
  status(token: string, signal?: AbortSignal): Promise<SyncJobStatus>;
  fail(token: string, code: SyncErrorCode): Promise<void>;
}
export class HttpSyncApi implements SyncApi {
  constructor(private readonly origin: string, private readonly request: typeof fetch = fetch, private readonly retryDelayMs = 500) {}

  private async call(path: string, token: string, method: 'GET' | 'POST', retry: boolean, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let response: Response;
      try {
        response = await this.request(`${this.origin}${path}`, {
          method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
        });
      } catch {
        if (!signal?.aborted && retry && attempt < 2) { await delay(this.retryDelayMs * (attempt + 1), undefined, {signal}); continue; }
        throw new SyncError('SYNC_API_UNAVAILABLE');
      }
      if ((response.status === 429 || response.status >= 500) && retry && attempt < 2) {
        await response.body?.cancel();
        await delay(this.retryDelayMs * (attempt + 1), undefined, {signal}); continue;
      }
      let data: unknown;
      try { data = await response.json(); } catch { throw new SyncError(response.ok ? 'SYNC_SESSION_INVALID' : 'SYNC_API_UNAVAILABLE'); }
      if (!response.ok) {
        const parsed = z.object({error: z.object({code: z.string()})}).safeParse(data);
        const code = parsed.success ? parsed.data.error.code : undefined;
        if ((response.status === 409 || response.status === 429) && ['SYNC_IN_PROGRESS', 'SYNC_ALREADY_COMPLETED', 'SYNC_DAILY_LIMIT'].includes(code ?? '')) throw new SyncError(code as SyncErrorCode);
        throw new SyncError(response.status >= 500 ? 'SYNC_API_UNAVAILABLE' : 'SYNC_API_REJECTED');
      }
      return data;
    }
  }
  async createSession(key: string, signal?: AbortSignal): Promise<SyncSession> {
    const parsed = sessionSchema.safeParse(await this.call('/api/v1/sync/session', key, 'POST', false, undefined, signal));
    if (!parsed.success || parsed.data.apiBaseUrl !== this.origin) throw new SyncError('SYNC_SESSION_INVALID');
    return parsed.data;
  }
  async heartbeat(token: string, signal?: AbortSignal): Promise<void> {
    const parsed = z.object({ok: z.literal(true)}).safeParse(await this.call('/api/sync/heartbeat', token, 'POST', true, undefined, signal));
    if (!parsed.success) throw new SyncError('SYNC_API_REJECTED');
  }
  async status(token: string, signal?: AbortSignal): Promise<SyncJobStatus> {
    const parsed = statusSchema.safeParse(await this.call('/api/sync/status', token, 'GET', true, undefined, signal));
    if (!parsed.success) throw new SyncError('SYNC_API_REJECTED');
    return parsed.data;
  }
  async fail(token: string, code: SyncErrorCode): Promise<void> {
    await this.call('/api/sync/complete', token, 'POST', false, {status: 'failed', error: code, mediaFailed: 0});
  }
}
