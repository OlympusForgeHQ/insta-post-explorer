import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

export interface TempWorkdirManager {
  create(jobId: string): Promise<string>;
  remove(workdir: string): Promise<void>;
  cleanupStale(now?: Date, removeAll?: boolean): Promise<number>;
}

export function createTempWorkdirManager(options: { root: string; maxAgeMs: number }): TempWorkdirManager {
  const root = path.resolve(options.root);
  if (root === path.parse(root).root) throw new Error("WORKER_WORKDIR_UNSAFE");

  const assertDirectChild = (candidate: string): string => {
    const resolved = path.resolve(candidate);
    if (path.dirname(resolved) !== root) throw new Error("WORKER_WORKDIR_UNSAFE");
    return resolved;
  };

  return {
    async create() {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const workdir = assertDirectChild(path.join(root, randomUUID()));
      await mkdir(workdir, { mode: 0o700 });
      return workdir;
    },

    async remove(workdir) {
      const target = assertDirectChild(workdir);
      await rm(target, { recursive: true, force: true });
    },

    async cleanupStale(now = new Date(), removeAll = false) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const entries = await readdir(root, { withFileTypes: true });
      let removed = 0;
      for (const entry of entries) {
        const target = assertDirectChild(path.join(root, entry.name));
        const stats = await lstat(target);
        const unsafeLink = stats.isSymbolicLink();
        const stale = now.getTime() - stats.mtimeMs > options.maxAgeMs;
        if (!removeAll && !unsafeLink && !stale) continue;
        await rm(target, { recursive: true, force: true });
        removed += 1;
      }
      return removed;
    },
  };
}
