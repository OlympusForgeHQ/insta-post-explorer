export type SyncErrorCode =
  | 'SYNC_CONFIG_INVALID' | 'SYNC_PROFILE_UNSAFE' | 'SYNC_PROFILE_ORIGIN_MISMATCH'
  | 'SYNC_EXTENSION_INVALID' | 'SYNC_BROWSER_UNAVAILABLE' | 'SYNC_BROWSER_CLOSED'
  | 'SYNC_EXTENSION_UNAVAILABLE' | 'SYNC_EXTENSION_FAILED' | 'SYNC_NEEDS_LOGIN'
  | 'SYNC_PAUSE_EXCEEDS_DEADLINE' | 'SYNC_TIMEOUT' | 'SYNC_INTERRUPTED'
  | 'SYNC_API_UNAVAILABLE' | 'SYNC_API_REJECTED' | 'SYNC_SESSION_INVALID'
  | 'SYNC_IN_PROGRESS' | 'SYNC_ALREADY_COMPLETED' | 'SYNC_DAILY_LIMIT'
  | 'SYNC_FAILED' | 'SYNC_COMPLETION_UNCONFIRMED' | 'SYNC_INTERNAL_ERROR';

export class SyncError extends Error {
  constructor(readonly code: SyncErrorCode) { super(code); this.name = 'SyncError'; }
}
export function safeError(error: unknown): SyncError {
  return error instanceof SyncError ? error : new SyncError('SYNC_INTERNAL_ERROR');
}
