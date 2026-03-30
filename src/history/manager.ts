import * as core from '@actions/core';
import type { ParsedTestRun } from '../types';
import type { HistoryEntry, HistoryFile, HistoryStorage } from './types';

const SIZE_LIMIT = 4 * 1024 * 1024;

export interface RunMeta {
  timestamp: string;
  commitSha: string;
  branch: string;
}

export class HistoryManager {
  private history: HistoryFile | null = null;
  private loadError = false;

  constructor(
    private readonly storage: HistoryStorage,
    private readonly historyLimit: number,
  ) {}

  async loadHistory(): Promise<HistoryFile | null> {
    try {
      this.history = await this.storage.load();
      this.loadError = false;
      return this.history;
    } catch (err) {
      core.warning(`Failed to load history: ${err instanceof Error ? err.message : String(err)}`);
      this.loadError = true;
      this.history = null;
      return null;
    }
  }

  isFirstRun(): boolean {
    return !this.loadError && this.history === null;
  }

  appendRun(run: ParsedTestRun, meta: RunMeta): HistoryFile {
    const entry: HistoryEntry = {
      timestamp: meta.timestamp,
      commitSha: meta.commitSha,
      summary: {
        total: run.summary.total,
        passed: run.summary.passed,
        failed: run.summary.failed,
        skipped: run.summary.skipped,
        errored: run.summary.errored,
        duration: run.summary.duration,
      },
      tests: run.suites.flatMap((suite) =>
        suite.tests.map((t) => ({
          name: t.name,
          suite: t.suite,
          status: t.status,
          duration: t.duration,
        })),
      ),
    };

    if (!this.history) {
      this.history = {
        version: 1,
        branch: meta.branch,
        entries: [],
      };
    }

    this.history.entries.push(entry);

    while (this.history.entries.length > this.historyLimit) {
      this.history.entries.shift();
    }

    this.enforceSizeLimit();

    return this.history;
  }

  async saveHistory(): Promise<void> {
    if (!this.history) {
      core.debug('No history to save');
      return;
    }

    try {
      await this.storage.save(this.history);
    } catch (err) {
      core.warning(`Failed to save history: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getHistory(): HistoryFile | null {
    return this.history;
  }

  private enforceSizeLimit(): void {
    if (!this.history) return;

    let size = Buffer.byteLength(JSON.stringify(this.history), 'utf-8');

    if (size <= SIZE_LIMIT) return;

    core.debug(`History size (${size} bytes) exceeds ${SIZE_LIMIT} — trimming test details`);

    for (let i = 0; i < this.history.entries.length; i++) {
      if (this.history.entries[i].tests.length === 0) continue;

      this.history.entries[i].tests = [];
      size = Buffer.byteLength(JSON.stringify(this.history), 'utf-8');

      if (size <= SIZE_LIMIT) return;
    }

    if (size > SIZE_LIMIT) {
      core.debug('Still over size limit after trimming all test arrays — pruning oldest entries');
      while (
        this.history.entries.length > 1 &&
        Buffer.byteLength(JSON.stringify(this.history), 'utf-8') > SIZE_LIMIT
      ) {
        this.history.entries.shift();
      }
    }
  }
}
