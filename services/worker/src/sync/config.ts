import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyncError } from './errors.js';

export interface SyncConfig {
  appUrl: string;
  automationKey?: string;
  profileDir: string;
  extensionDir: string;
  timezone: string;
  hour: number;
  maxRunMs: number;
  pollMs: number;
}
const checkout = fileURLToPath(new URL('../../../../', import.meta.url));
function inside(path: string, root: string) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new SyncError('SYNC_CONFIG_INVALID');
  return parsed;
}
export function loadSyncConfig(env: Record<string, string | undefined> = process.env, requireKey = true): SyncConfig {
  try {
    const url = new URL(env.SYNC_APP_URL ?? '');
    const allowed = ['https://insta-explorer.hz.kalyros.dev', 'https://preview-insta-explorer.hz.kalyros.dev'];
    if (env.NODE_ENV !== 'production') allowed.push('http://localhost:3000');
    if (!allowed.includes(url.origin) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    const rawPath = env.SYNC_PROFILE_DIR ?? '/var/lib/insta-sync/profile';
    const profileDir = resolve(rawPath);
    if (!isAbsolute(rawPath) || profileDir === '/' || inside(profileDir, checkout)) throw new Error();
    const automationKey = env.INSTAGRAM_AUTO_SYNC_KEY;
    if (requireKey && !/^ips_sync_[A-Za-z0-9_-]{43}$/.test(automationKey ?? '')) throw new Error();
    const timezone = env.SYNC_TIMEZONE ?? 'Europe/Brussels';
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format();
    return {
      appUrl: url.origin, automationKey: requireKey ? automationKey : undefined, profileDir,
      extensionDir: resolve(env.SYNC_EXTENSION_DIR ?? fileURLToPath(new URL('../../../../extension/ig-saved-sync', import.meta.url))),
      timezone, hour: integer(env.SYNC_HOUR, 4, 0, 23),
      maxRunMs: integer(env.SYNC_MAX_RUN_MS, 3 * 60 * 60 * 1000, 60_000, 3 * 60 * 60 * 1000),
      pollMs: 5_000,
    };
  } catch { throw new SyncError('SYNC_CONFIG_INVALID'); }
}
export function isScheduleDue(config: Pick<SyncConfig, 'timezone' | 'hour'>, now = new Date()): boolean {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(hour) >= config.hour;
}
