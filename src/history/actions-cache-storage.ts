import * as cache from '@actions/cache';
import { ReserveCacheError } from '@actions/cache';
import * as core from '@actions/core';
import { mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, chmodSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { HistoryFile, HistoryStorage } from './types';

const HISTORY_FILENAME = 'history.json';
const PRIVATE_DIR_MODE = 0o700;

// The history file must live at the same absolute path on every run: @actions/cache derives
// the cache version from the path, so a randomized (mkdtemp) dir would never restore. On a
// shared tmpdir that predictable path could be pre-planted by another local user, so every
// segment we create under tmpdir must be a real directory owned by us and private to us.
function preparePrivateDir(base: string, dir: string): string | null {
  const uid = process.getuid?.();
  let current = base;
  for (const segment of relative(base, dir).split(sep)) {
    current = join(current, segment);
    try {
      mkdirSync(current, { mode: PRIVATE_DIR_MODE });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        return `cannot create ${current}: ${(err as Error).message}`;
      }
    }
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory()) return `${current} is not a directory (symlink or file)`;
      if (uid !== undefined && stat.uid !== uid) return `${current} is owned by another user`;
      if ((stat.mode & 0o777) !== PRIVATE_DIR_MODE) chmodSync(current, PRIVATE_DIR_MODE);
    } catch (err) {
      return `cannot verify ${current}: ${(err as Error).message}`;
    }
  }
  return null;
}

export class ActionsCacheStorage implements HistoryStorage {
  private readonly cacheKey: string;
  private readonly restoreKeys: string[];
  private readonly tempDir: string;
  private readonly filePath: string;
  private readonly unusableReason: string | null;

  constructor(branch: string, reportPathHash: string, runId?: string) {
    const suffix = runId ? `-${runId}` : '';
    this.cacheKey = `testglance-history-${branch}-${reportPathHash}${suffix}`;
    this.restoreKeys = [
      `testglance-history-${branch}-${reportPathHash}-`,
      `testglance-history-${branch}-`,
    ];
    const base = tmpdir();
    this.tempDir = join(base, `testglance-history-${branch}-${reportPathHash}`);
    this.filePath = join(this.tempDir, HISTORY_FILENAME);
    this.unusableReason = preparePrivateDir(base, this.tempDir);
    if (this.unusableReason) {
      core.warning(
        `History disabled: ${this.unusableReason}. Refusing to use a history dir another user could control.`,
      );
    }
  }

  async load(): Promise<HistoryFile | null> {
    if (this.unusableReason) return null;
    try {
      const restoredKey = await cache.restoreCache(
        [this.filePath],
        this.cacheKey,
        this.restoreKeys,
      );

      if (!restoredKey) {
        core.debug('History cache miss — no previous history found');
        return null;
      }

      if (!existsSync(this.filePath)) {
        core.warning(
          'Cache restored but history file not found on disk; run history unavailable this run.',
        );
        return null;
      }

      const raw = readFileSync(this.filePath, 'utf-8');
      const history = JSON.parse(raw) as HistoryFile;
      core.debug(
        `History loaded from cache (key: ${restoredKey}, ${history.entries.length} entries)`,
      );
      return history;
    } catch (err) {
      core.warning(
        `Failed to load history from cache: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async save(history: HistoryFile): Promise<void> {
    if (this.unusableReason) return;
    try {
      writeFileSync(this.filePath, JSON.stringify(history));
      await cache.saveCache([this.filePath], this.cacheKey);
      core.debug(
        `History saved to cache (key: ${this.cacheKey}, ${history.entries.length} entries)`,
      );
    } catch (err) {
      if (err instanceof ReserveCacheError) {
        core.debug(`Cache key already exists: ${this.cacheKey} — treating as success`);
        return;
      }
      core.warning(
        `Failed to save history to cache: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async clear(): Promise<void> {
    core.debug('ActionsCacheStorage.clear() is a no-op — cache entries expire via LRU');
  }
}
