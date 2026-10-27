import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

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
const mockLstatSync = vi.fn();
const mockChmodSync = vi.fn();

vi.mock('node:fs', () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  lstatSync: (...args: unknown[]) => mockLstatSync(...args),
  chmodSync: (...args: unknown[]) => mockChmodSync(...args),
}));

import { join } from 'node:path';
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
    mockLstatSync.mockReturnValue({
      isDirectory: () => true,
      uid: process.getuid?.() ?? 0,
      mode: 0o40700,
    });
  });

  it('cache key format includes branch, hash, and runId', () => {
    const storage = new ActionsCacheStorage('main', 'ab12cd34', '12345');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('testglance-history-main-ab12cd34'),
      expect.anything(),
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

  it('load() returns null and warns when cache hit but history file is missing on disk', async () => {
    mockRestoreCache.mockResolvedValue('testglance-history-main-abc');
    mockExistsSync.mockReturnValue(false);

    const storage = new ActionsCacheStorage('main', 'abc');
    const result = await storage.load();

    expect(result).toBeNull();
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('history file not found on disk'),
    );
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('run history unavailable this run'),
    );
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

  describe('temp dir on a shared tmpdir (real filesystem)', () => {
    type Fs = typeof import('node:fs');
    let fs: Fs;
    let base: string;
    let prevTmpdir: string | undefined;

    beforeEach(async () => {
      fs = await vi.importActual<Fs>('node:fs');
      mockMkdirSync.mockImplementation(fs.mkdirSync as never);
      mockWriteFileSync.mockImplementation(fs.writeFileSync as never);
      mockReadFileSync.mockImplementation(fs.readFileSync as never);
      mockExistsSync.mockImplementation(fs.existsSync);
      mockLstatSync.mockImplementation(fs.lstatSync as never);
      mockChmodSync.mockImplementation(fs.chmodSync);
      mockSaveCache.mockResolvedValue(1);
      const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
      base = fs.mkdtempSync(join(tmpdir(), 'tg-shared-tmp-'));
      prevTmpdir = process.env.TMPDIR;
      process.env.TMPDIR = base;
    });

    afterEach(() => {
      if (prevTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmpdir;
      fs.rmSync(base, { recursive: true, force: true });
    });

    it('refuses a pre-planted symlink in place of the history dir', async () => {
      const attacker = join(base, 'attacker');
      fs.mkdirSync(attacker);
      fs.symlinkSync(attacker, join(base, 'testglance-history-main-hash1'), 'dir');

      const storage = new ActionsCacheStorage('main', 'hash1', '1');
      await storage.save(SAMPLE_HISTORY);

      expect(fs.existsSync(join(attacker, 'history.json'))).toBe(false);
      expect(mockSaveCache).not.toHaveBeenCalled();
      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('History disabled'));
    });

    it('refuses a pre-planted symlink at an intermediate path segment', async () => {
      const attacker = join(base, 'attacker');
      fs.mkdirSync(attacker);
      fs.symlinkSync(attacker, join(base, 'testglance-history-feat'), 'dir');

      const storage = new ActionsCacheStorage('feat/x', 'hash1', '1');
      await storage.save(SAMPLE_HISTORY);

      expect(fs.existsSync(join(attacker, 'x-hash1', 'history.json'))).toBe(false);
      expect(mockSaveCache).not.toHaveBeenCalled();
    });

    it('does not read history from a refused dir', async () => {
      const attacker = join(base, 'attacker');
      fs.mkdirSync(attacker);
      fs.writeFileSync(join(attacker, 'history.json'), JSON.stringify(SAMPLE_HISTORY));
      fs.symlinkSync(attacker, join(base, 'testglance-history-main-hash1'), 'dir');
      mockRestoreCache.mockResolvedValue('testglance-history-main-hash1');

      const storage = new ActionsCacheStorage('main', 'hash1', '1');

      expect(await storage.load()).toBeNull();
      expect(mockRestoreCache).not.toHaveBeenCalled();
    });

    it('creates the history dir private to the runner user', async () => {
      const storage = new ActionsCacheStorage('main', 'hash1', '1');
      await storage.save(SAMPLE_HISTORY);

      const dir = join(base, 'testglance-history-main-hash1');
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.existsSync(join(dir, 'history.json'))).toBe(true);
      expect(mockSaveCache).toHaveBeenCalled();
    });

    it('tightens a pre-existing world-writable dir it owns', async () => {
      const dir = join(base, 'testglance-history-main-hash1');
      fs.mkdirSync(dir);
      fs.chmodSync(dir, 0o777);

      new ActionsCacheStorage('main', 'hash1', '1');

      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    });

    it('keeps the cache path stable across runs (cache version depends on it)', () => {
      const a = new ActionsCacheStorage('main', 'hash1', '1');
      const b = new ActionsCacheStorage('main', 'hash1', '2');
      mockRestoreCache.mockResolvedValue(undefined);
      void a.load();
      void b.load();

      const [pathsA] = mockRestoreCache.mock.calls[0];
      const [pathsB] = mockRestoreCache.mock.calls[1];
      expect(pathsA).toEqual([join(base, 'testglance-history-main-hash1', 'history.json')]);
      expect(pathsB).toEqual(pathsA);
    });
  });
});
