import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockWarning = vi.fn();
const mockDebug = vi.fn();

vi.mock('@actions/core', () => ({
  warning: (...args: unknown[]) => mockWarning(...args),
  debug: (...args: unknown[]) => mockDebug(...args),
}));

import { HistoryManager } from '../manager';
import type { HistoryFile, HistoryStorage } from '../types';
import type { ParsedTestRun } from '../../types';

function createMockStorage(initial: HistoryFile | null = null): HistoryStorage {
  return {
    load: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

const SAMPLE_RUN: ParsedTestRun = {
  summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 1.5 },
  suites: [
    {
      name: 'suite-a',
      duration: 1.5,
      tests: [
        { name: 'test1', suite: 'suite-a', status: 'passed', duration: 0.5 },
        { name: 'test2', suite: 'suite-a', status: 'passed', duration: 0.5 },
        { name: 'test3', suite: 'suite-a', status: 'failed', duration: 0.5, errorMessage: 'oops' },
      ],
    },
  ],
};

const META = {
  timestamp: '2026-03-29T12:00:00.000Z',
  commitSha: 'abc1234',
  branch: 'main',
};

describe('HistoryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends entry to empty history (creates new)', async () => {
    const storage = createMockStorage(null);
    const manager = new HistoryManager(storage, 20);

    await manager.loadHistory();
    const result = manager.appendRun(SAMPLE_RUN, META);

    expect(result.version).toBe(1);
    expect(result.branch).toBe('main');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].commitSha).toBe('abc1234');
    expect(result.entries[0].summary.total).toBe(3);
    expect(result.entries[0].tests).toHaveLength(3);
  });

  it('appends entry to existing history', async () => {
    const existing: HistoryFile = {
      version: 1,
      branch: 'main',
      entries: [
        {
          timestamp: '2026-03-28T12:00:00.000Z',
          commitSha: 'prev123',
          summary: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0, duration: 1.0 },
          tests: [],
        },
      ],
    };
    const storage = createMockStorage(existing);
    const manager = new HistoryManager(storage, 20);

    await manager.loadHistory();
    const result = manager.appendRun(SAMPLE_RUN, META);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].commitSha).toBe('prev123');
    expect(result.entries[1].commitSha).toBe('abc1234');
  });

  it('prunes entries beyond history-limit (oldest first)', async () => {
    const existing: HistoryFile = {
      version: 1,
      branch: 'main',
      entries: Array.from({ length: 5 }, (_, i) => ({
        timestamp: `2026-03-${20 + i}T12:00:00.000Z`,
        commitSha: `sha-${i}`,
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 0.1 },
        tests: [],
      })),
    };
    const storage = createMockStorage(existing);
    const manager = new HistoryManager(storage, 3);

    await manager.loadHistory();
    const result = manager.appendRun(SAMPLE_RUN, META);

    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].commitSha).toBe('sha-3');
    expect(result.entries[1].commitSha).toBe('sha-4');
    expect(result.entries[2].commitSha).toBe('abc1234');
  });

  it('size guard trims per-test details from oldest entries when approaching 5MB', async () => {
    const bigTests = Array.from({ length: 5000 }, (_, i) => ({
      name: `test-${i}-${'x'.repeat(200)}`,
      suite: 'big-suite',
      status: 'passed' as const,
      duration: 0.1,
    }));

    const bigRun: ParsedTestRun = {
      summary: { total: 5000, passed: 5000, failed: 0, skipped: 0, errored: 0, duration: 500 },
      suites: [{ name: 'big-suite', duration: 500, tests: bigTests }],
    };

    const existing: HistoryFile = {
      version: 1,
      branch: 'main',
      entries: Array.from({ length: 19 }, (_, i) => ({
        timestamp: `2026-03-${i + 1}T12:00:00.000Z`,
        commitSha: `sha-${i}`,
        summary: { total: 5000, passed: 5000, failed: 0, skipped: 0, errored: 0, duration: 500 },
        tests: bigTests.map((t) => ({ ...t })),
      })),
    };

    const storage = createMockStorage(existing);
    const manager = new HistoryManager(storage, 20);

    await manager.loadHistory();
    manager.appendRun(bigRun, META);
    const result = manager.getHistory()!;

    const serialized = JSON.stringify(result);
    expect(serialized.length).toBeLessThanOrEqual(4 * 1024 * 1024);

    const trimmedEntries = result.entries.filter((e) => e.tests.length === 0);
    expect(trimmedEntries.length).toBeGreaterThan(0);

    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('trimming test details'));
  });

  it('size guard prunes oldest entries when still over limit after trimming all test arrays', async () => {
    const hugeSummary = {
      total: 50000,
      passed: 50000,
      failed: 0,
      skipped: 0,
      errored: 0,
      duration: 5000,
    };
    const hugeEntries = Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2026-03-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`,
      commitSha: `sha-${i}`,
      summary: hugeSummary,
      tests: [],
    }));

    const totalBytes = Buffer.byteLength(
      JSON.stringify({
        version: 1,
        branch: 'main',
        entries: hugeEntries,
      }),
      'utf-8',
    );

    if (totalBytes <= 4 * 1024 * 1024) {
      const padding = 'x'.repeat(Math.ceil((4 * 1024 * 1024 - totalBytes) / 20));
      for (const e of hugeEntries) {
        e.commitSha = `sha-${padding}`;
      }
    }

    const existing: HistoryFile = {
      version: 1,
      branch: 'main',
      entries: hugeEntries,
    };

    const storage = createMockStorage(existing);
    const manager = new HistoryManager(storage, 25);

    await manager.loadHistory();
    manager.appendRun(SAMPLE_RUN, META);
    const result = manager.getHistory()!;

    const resultSize = Buffer.byteLength(JSON.stringify(result), 'utf-8');
    expect(resultSize).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(result.entries.length).toBeLessThan(21);
    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('pruning oldest entries'));
  });

  it('isFirstRun returns true only on genuine cache miss, not on error', async () => {
    const storage = createMockStorage(null);
    const manager = new HistoryManager(storage, 20);

    await manager.loadHistory();
    expect(manager.isFirstRun()).toBe(true);

    const errorStorage = createMockStorage(null);
    (errorStorage.load as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    const errorManager = new HistoryManager(errorStorage, 20);

    await errorManager.loadHistory();
    expect(errorManager.isFirstRun()).toBe(false);
  });

  it('handles null from storage (first run scenario)', async () => {
    const storage = createMockStorage(null);
    const manager = new HistoryManager(storage, 20);

    const loaded = await manager.loadHistory();

    expect(loaded).toBeNull();
    expect(manager.getHistory()).toBeNull();
  });

  it('error in storage load does not throw (warning logged)', async () => {
    const storage = createMockStorage(null);
    (storage.load as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cache down'));
    const manager = new HistoryManager(storage, 20);

    const loaded = await manager.loadHistory();

    expect(loaded).toBeNull();
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('cache down'));
  });

  it('error in storage save does not throw (warning logged)', async () => {
    const storage = createMockStorage(null);
    (storage.save as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('save failed'));
    const manager = new HistoryManager(storage, 20);

    await manager.loadHistory();
    manager.appendRun(SAMPLE_RUN, META);
    await manager.saveHistory();

    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('save failed'));
  });

  it('maps tests from all suites in ParsedTestRun', async () => {
    const multiSuiteRun: ParsedTestRun = {
      summary: { total: 3, passed: 3, failed: 0, skipped: 0, errored: 0, duration: 1.0 },
      suites: [
        {
          name: 'suite-a',
          duration: 0.5,
          tests: [{ name: 'a1', suite: 'suite-a', status: 'passed', duration: 0.5 }],
        },
        {
          name: 'suite-b',
          duration: 0.5,
          tests: [
            { name: 'b1', suite: 'suite-b', status: 'passed', duration: 0.3 },
            { name: 'b2', suite: 'suite-b', status: 'passed', duration: 0.2 },
          ],
        },
      ],
    };

    const storage = createMockStorage(null);
    const manager = new HistoryManager(storage, 20);

    await manager.loadHistory();
    const result = manager.appendRun(multiSuiteRun, META);

    expect(result.entries[0].tests).toHaveLength(3);
    expect(result.entries[0].tests.map((t) => t.name)).toEqual(['a1', 'b1', 'b2']);
  });

  it('does not save when no history loaded or appended', async () => {
    const storage = createMockStorage(null);
    const manager = new HistoryManager(storage, 20);

    await manager.saveHistory();

    expect(storage.save).not.toHaveBeenCalled();
  });
});
