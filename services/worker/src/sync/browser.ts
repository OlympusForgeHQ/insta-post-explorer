import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { SyncSession } from './api.js';
import type { SyncConfig } from './config.js';
import { SyncError } from './errors.js';
import { prepareProfile } from './profile.js';

export interface CollectorState {
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  pausedReason: {reason: string} | null;
  resumeAt: string | null;
}
export interface BrowserCollector {
  checkLogin(): Promise<boolean>;
  prepareSession(): Promise<void>;
  start(session: SyncSession): Promise<void>;
  getState(): Promise<CollectorState | null>;
  close(): Promise<void>;
}
export class ChromiumCollector implements BrowserCollector {
  private closed = false;
  private readonly closedPromise: Promise<void>;
  constructor(readonly context: BrowserContext, private readonly page: Page) {
    this.closedPromise = new Promise(resolve => context.once('close', () => { this.closed = true; resolve(); }));
  }
  private async send(type: string, data?: SyncSession): Promise<{ok: boolean; task?: CollectorState | null}> {
    const attempts = type === 'startWebSync' ? 1 : 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.closed) throw new SyncError('SYNC_BROWSER_CLOSED');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          this.page.evaluate(async ({type, data}) => {
            const runtime = (globalThis as unknown as {chrome: {runtime: {sendMessage(message: unknown): Promise<{ok?: boolean; task?: {status: string; pausedReason?: {reason?: string}; resumeAt?: string}}>}}}).chrome.runtime;
            const response = await runtime.sendMessage({type, ...(data ? {data} : {})});
            // Omit counters, account names, remote error text and tokens from the public runner state.
            const task = response.task;
            return {ok: response.ok === true, task: task ? {status: task.status, pausedReason: task.pausedReason ? {reason: task.pausedReason.reason ?? ''} : null, resumeAt: task.resumeAt ?? null} : null};
          }, {type, data}) as Promise<{ok: boolean; task: CollectorState | null}>,
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new SyncError('SYNC_EXTENSION_UNAVAILABLE')), 20_000); }),
        ]);
      } catch {
        if (attempt + 1 === attempts) throw new SyncError('SYNC_EXTENSION_UNAVAILABLE');
      } finally { clearTimeout(timer); }
      await delay(250 * (attempt + 1));
    }
    throw new SyncError('SYNC_EXTENSION_UNAVAILABLE');
  }
  async checkLogin(): Promise<boolean> { return (await this.send('checkLogin')).ok; }
  async prepareSession(): Promise<void> {
    // Call only after the API admits a fresh exclusive session. Its predecessor is now fenced.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await this.page.evaluate(async () => {
            await (globalThis as unknown as {chrome: {alarms: {clearAll(): Promise<boolean>}}}).chrome.alarms.clearAll();
          });
          const cdp = await this.context.newCDPSession(this.page);
          try { await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); }
          finally { await cdp.detach(); }
          await this.page.evaluate(async () => {
            const runtime = (globalThis as unknown as {chrome: {runtime: {getURL(path: string): string}}}).chrome.runtime;
            const stores = await import(runtime.getURL('idb.js'));
            await stores.TaskStoreRaw.clear('web-sync');
            await stores.PageStore.clear('web-sync');
          });
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new SyncError('SYNC_EXTENSION_UNAVAILABLE')), 20_000); }),
      ]);
    } catch { throw new SyncError('SYNC_EXTENSION_UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
  async start(session: SyncSession): Promise<void> {
    // Explicitly copy the short-lived session only; the automation credential is never browser input.
    const data: SyncSession = {
      jobId: session.jobId, token: session.token, apiBaseUrl: session.apiBaseUrl,
      knownExternalIds: session.knownExternalIds, knownPostCodes: session.knownPostCodes, knownPosts: session.knownPosts,
      expiresInSeconds: session.expiresInSeconds, heartbeatIntervalSeconds: session.heartbeatIntervalSeconds,
    };
    if (!(await this.send('startWebSync', data)).ok) throw new SyncError('SYNC_EXTENSION_FAILED');
  }
  async getState(): Promise<CollectorState | null> {
    const response = await this.send('getWebSyncState');
    if (!response.ok) throw new SyncError('SYNC_EXTENSION_UNAVAILABLE');
    return response.task ?? null;
  }
  async openLogin(): Promise<void> {
    const login = await this.context.newPage();
    await login.goto('https://www.instagram.com/', {waitUntil: 'domcontentloaded', timeout: 30_000});
  }
  waitForClose(): Promise<void> { return this.closedPromise; }
  async close(): Promise<void> { await this.context.close(); }
}

export async function launchCollector(config: SyncConfig, options: {headed?: boolean; signal?: AbortSignal} = {}): Promise<ChromiumCollector> {
  options.signal?.throwIfAborted();
  if (options.headed && !/^(?:localhost)?:\d+(\.\d+)?$/.test(process.env.DISPLAY ?? '')) throw new SyncError('SYNC_CONFIG_INVALID');
  await prepareProfile(config.profileDir, config.appUrl);
  try {
    const manifest = JSON.parse(await readFile(join(config.extensionDir, 'manifest.json'), 'utf8'));
    if (manifest.version !== '4.2.8' || manifest.background?.service_worker !== 'background.js' || manifest.background?.type !== 'module') throw new Error();
  } catch { throw new SyncError('SYNC_EXTENSION_INVALID'); }
  let context: BrowserContext | undefined;
  try {
    // Chromium gets only the few OS settings it needs, never the worker's API key or service credentials.
    const browserEnv: Record<string, string> = {};
    for (const name of ['HOME', 'PATH', 'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TZ']) {
      if (process.env[name]) browserEnv[name] = process.env[name]!;
    }
    context = await chromium.launchPersistentContext(config.profileDir, {
      channel: 'chromium', headless: !options.headed, timeout: 30_000, env: browserEnv,
      args: [`--disable-extensions-except=${config.extensionDir}`, `--load-extension=${config.extensionDir}`],
    });
    if (options.signal?.aborted) { await context.close(); throw new SyncError('SYNC_INTERRUPTED'); }
    const closeOnAbort = () => { void context?.close().catch(() => {}); };
    options.signal?.addEventListener('abort', closeOnAbort, {once: true});
    context.once('close', () => options.signal?.removeEventListener('abort', closeOnAbort));
    const worker = context.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://')) ??
      await context.waitForEvent('serviceworker', {predicate: candidate => candidate.url().startsWith('chrome-extension://'), timeout: 20_000});
    const extensionId = new URL(worker.url()).hostname;
    if (!/^[a-p]{32}$/.test(extensionId)) throw new SyncError('SYNC_EXTENSION_INVALID');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`, {waitUntil: 'domcontentloaded', timeout: 20_000});
    return new ChromiumCollector(context, page);
  } catch (error) {
    await context?.close().catch(() => {});
    if (error instanceof SyncError) throw error;
    throw new SyncError('SYNC_BROWSER_UNAVAILABLE');
  }
}
