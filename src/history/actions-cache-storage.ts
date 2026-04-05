import * as cache from '@actions/cache';
import { ReserveCacheError } from '@actions/cache';
import * as core from '@actions/core';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HistoryFile, HistoryStorage } from './types';

const HISTORY_FILENAME = 'history.json';

export class ActionsCacheStorage implements HistoryStorage {
  private readonly cacheKey: string;
  private readonly restoreKeys: string[];
  private readonly tempDir: string;
  private readonly filePath: string;

  constructor(branch: string, reportPathHash: string, runId?: string) {
    const suffix = runId ? `-${runId}` : '';
    this.cacheKey = `testglance-history-${branch}-${reportPathHash}${suffix}`;
    this.restoreKeys = [
      `testglance-history-${branch}-${reportPathHash}-`,
      `testglance-history-${branch}-`,
    ];
    this.tempDir = join(tmpdir(), `testglance-history-${branch}-${reportPathHash}`);
    mkdirSync(this.tempDir, { recursive: true });
    this.filePath = join(this.tempDir, HISTORY_FILENAME);
  }

  async load(): Promise<HistoryFile | null> {
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
        core.debug('Cache restored but history file not found on disk');
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
