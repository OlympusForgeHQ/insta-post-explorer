import { chmod, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isScheduleDue, loadSyncConfig } from '../src/sync/config.js';
import { prepareProfile } from '../src/sync/profile.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true }))); dirs.length = 0; });
const env = { SYNC_APP_URL: 'http://localhost:3000', SYNC_PROFILE_DIR: '/tmp/instagram-runner-profile', INSTAGRAM_AUTO_SYNC_KEY: `ips_sync_${'x'.repeat(43)}` };
describe('sync configuration and private profile', () => {
  it('rejects unsafe targets, credentials, durations, profile paths and timezone configuration', () => {
    for (const override of [
      { SYNC_APP_URL: 'https://attacker.example' }, { SYNC_APP_URL: 'https://user:pass@insta-explorer.hz.kalyros.dev' },
      { SYNC_APP_URL: 'http://localhost:3000', NODE_ENV: 'production' }, { SYNC_APP_URL: 'https://insta-explorer.hz.kalyros.dev/path' },
      { SYNC_PROFILE_DIR: '.' }, { SYNC_PROFILE_DIR: process.cwd() }, { SYNC_MAX_RUN_MS: '14400000' },
      { INSTAGRAM_AUTO_SYNC_KEY: 'read-key' }, { SYNC_TIMEZONE: 'invalid' }, { SYNC_HOUR: '24' },
    ]) expect(() => loadSyncConfig({ ...env, ...override })).toThrow();
  });
  it('catches up after local 04:00 across both DST transitions', () => {
    const config = loadSyncConfig(env);
    for (const [utc, due] of [['2026-03-29T01:59:00Z', false], ['2026-03-29T02:00:00Z', true], ['2026-10-25T02:59:00Z', false], ['2026-10-25T03:00:00Z', true], ['2026-10-25T20:00:00Z', true]] as const) {
      expect(isScheduleDue(config, new Date(utc))).toBe(due);
    }
  });
  it('creates a private origin-bound profile and refuses insecure or symlink profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-profile-test-')); dirs.push(root);
    const profile = join(root, 'profile');
    await prepareProfile(profile, 'http://localhost:3000');
    expect((await stat(profile)).mode & 0o777).toBe(0o700);
    expect(await readFile(join(profile, '.sync-origin'), 'utf8')).toBe('http://localhost:3000\n');
    await expect(prepareProfile(profile, 'https://insta-explorer.hz.kalyros.dev')).rejects.toThrow('SYNC_PROFILE_ORIGIN_MISMATCH');
    await chmod(profile, 0o755);
    await expect(prepareProfile(profile, 'http://localhost:3000')).rejects.toThrow('SYNC_PROFILE_UNSAFE');
    await chmod(profile, 0o700);
    const link = join(root, 'linked'); await symlink(profile, link);
    await expect(prepareProfile(link, 'http://localhost:3000')).rejects.toThrow('SYNC_PROFILE_UNSAFE');
  });
});
