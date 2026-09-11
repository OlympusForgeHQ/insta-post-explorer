import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCommand } from '../src/sync/cli.js';

afterEach(() => vi.useRealTimers());
describe('sync command dispatch', () => {
  it('rejects unknown commands and masks invalid configuration before any browser launch', async () => {
    await expect(executeCommand('unknown', {})).rejects.toThrow('SYNC_CONFIG_INVALID');
    await expect(executeCommand('run', {SYNC_APP_URL: 'private-invalid-target', INSTAGRAM_AUTO_SYNC_KEY: 'private-raw-key'})).rejects.toThrow('SYNC_CONFIG_INVALID');
  });
  it('skips the pre-schedule window without requiring or using the long-lived credential', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
    expect(await executeCommand('scheduled', {SYNC_APP_URL: 'http://localhost:3000'})).toEqual({status: 'skipped', reason: 'BEFORE_SCHEDULE'});
  });
});
