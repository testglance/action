import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockRestoreCache = vi.fn();
const mockSaveCache = vi.fn();

vi.mock('@actions/cache', () => ({
  restoreCache: (...args: unknown[]) => mockRestoreCache(...args),
  saveCache: (...args: unknown[]) => mockSaveCache(...args),
  ReserveCacheError: class ReserveCacheError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'ReserveCacheError';
    }
  },
}));

const mockDebug = vi.fn();
const mockWarning = vi.fn();

vi.mock('@actions/core', () => ({
  debug: (...args: unknown[]) => mockDebug(...args),
  warning: (...args: unknown[]) => mockWarning(...args),
}));

const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('node:fs', () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

import { ActionsCacheStorage } from '../actions-cache-storage';
import type { HistoryFile } from '../types';

const SAMPLE_HISTORY: HistoryFile = {
  version: 1,
  branch: 'main',
  entries: [
    {
      timestamp: '2026-03-29T12:00:00.000Z',
      commitSha: 'abc1234',
      summary: { total: 5, passed: 5, failed: 0, skipped: 0, errored: 0, duration: 2.0 },
      tests: [{ name: 'test1', suite: 'suite1', status: 'passed', duration: 0.5 }],
    },
  ],
};

describe('ActionsCacheStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('cache key format includes branch, hash, and runId', () => {
    const storage = new ActionsCacheStorage('main', 'ab12cd34', '12345');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('testglance-history-main-ab12cd34'),
      { recursive: true },
    );

    mockRestoreCache.mockResolvedValue(undefined);
    storage.load();

    expect(mockRestoreCache).toHaveBeenCalledWith(
      expect.any(Array),
      'testglance-history-main-ab12cd34-12345',
      ['testglance-history-main-ab12cd34-', 'testglance-history-main-'],
    );
  });

  it('cache key without runId omits suffix', () => {
    mockRestoreCache.mockResolvedValue(undefined);
    const storage = new ActionsCacheStorage('main', 'ab12cd34');

    storage.load();

    expect(mockRestoreCache).toHaveBeenCalledWith(
      expect.any(Array),
      'testglance-history-main-ab12cd34',
      ['testglance-history-main-ab12cd34-', 'testglance-history-main-'],
    );
  });

  it('restore keys use branch prefix for partial matching', async () => {
    mockRestoreCache.mockResolvedValue(undefined);
    const storage = new ActionsCacheStorage('feat/branch', 'hash123', '99');

    await storage.load();

    expect(mockRestoreCache).toHaveBeenCalledWith(
      expect.any(Array),
      'testglance-history-feat/branch-hash123-99',
      ['testglance-history-feat/branch-hash123-', 'testglance-history-feat/branch-'],
    );
  });

  it('load() returns parsed HistoryFile on cache hit', async () => {
    mockRestoreCache.mockResolvedValue('testglance-history-main-abc');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(SAMPLE_HISTORY));

    const storage = new ActionsCacheStorage('main', 'abc');
    const result = await storage.load();

    expect(result).toEqual(SAMPLE_HISTORY);
    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('History loaded from cache'));
  });

  it('load() returns null on cache miss', async () => {
    mockRestoreCache.mockResolvedValue(undefined);

    const storage = new ActionsCacheStorage('main', 'abc');
    const result = await storage.load();

    expect(result).toBeNull();
    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('cache miss'));
  });

  it('load() returns null and warns on error', async () => {
    mockRestoreCache.mockRejectedValue(new Error('network timeout'));

    const storage = new ActionsCacheStorage('main', 'abc');
    const result = await storage.load();

    expect(result).toBeNull();
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('network timeout'));
  });

  it('save() writes to temp file and calls saveCache', async () => {
    mockSaveCache.mockResolvedValue(42);

    const storage = new ActionsCacheStorage('main', 'hash1', '555');
    await storage.save(SAMPLE_HISTORY);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('history.json'),
      JSON.stringify(SAMPLE_HISTORY),
    );
    expect(mockSaveCache).toHaveBeenCalledWith(
      [expect.stringContaining('history.json')],
      'testglance-history-main-hash1-555',
    );
  });

  it('save() handles ReserveCacheError silently (key already exists)', async () => {
    const { ReserveCacheError } = await import('@actions/cache');
    mockSaveCache.mockRejectedValue(new ReserveCacheError('already exists'));

    const storage = new ActionsCacheStorage('main', 'hash1', '555');
    await storage.save(SAMPLE_HISTORY);

    expect(mockWarning).not.toHaveBeenCalled();
    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });

  it('save() warns on other errors', async () => {
    mockSaveCache.mockRejectedValue(new Error('disk full'));

    const storage = new ActionsCacheStorage('main', 'hash1', '555');
    await storage.save(SAMPLE_HISTORY);

    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });

  it('clear() is a no-op', async () => {
    const storage = new ActionsCacheStorage('main', 'hash1', '555');
    await storage.clear();

    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('no-op'));
  });
});
