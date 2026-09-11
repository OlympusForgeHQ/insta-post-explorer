import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SyncError } from './errors.js';

export async function prepareProfile(profileDir: string, origin: string): Promise<void> {
  try {
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    const info = await lstat(profileDir);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 ||
        (process.getuid && info.uid !== process.getuid()) || await realpath(profileDir) !== resolve(profileDir)) {
      throw new SyncError('SYNC_PROFILE_UNSAFE');
    }
    const marker = join(profileDir, '.sync-origin');
    try {
      const file = await open(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(`${origin}\n`); } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const file = await open(marker, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const markerInfo = await file.stat();
      if (!markerInfo.isFile() || (markerInfo.mode & 0o777) !== 0o600 || markerInfo.uid !== info.uid || markerInfo.size > 200) throw new SyncError('SYNC_PROFILE_UNSAFE');
      if (await file.readFile('utf8') !== `${origin}\n`) throw new SyncError('SYNC_PROFILE_ORIGIN_MISMATCH');
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError('SYNC_PROFILE_UNSAFE');
  }
}
