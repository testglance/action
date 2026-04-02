import { describe, it, expect } from 'vitest';
import { detectFlakyTests } from '../flaky-detection';
import type { HistoryEntry, HistoryTestEntry } from '../types';

function makeEntry(tests: HistoryTestEntry[], overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const skipped = tests.filter((t) => t.status === 'skipped').length;
  const errored = tests.filter((t) => t.status === 'errored').length;
  return {
    timestamp: '2026-04-01T12:00:00.000Z',
    commitSha: 'abc1234',
    summary: {
      total: tests.length,
      passed,
      failed,
      skipped,
      errored,
      duration: 10.0,
    },
    tests,
    ...overrides,
  };
}

function makeTest(
  name: string,
  suite: string,
  status: HistoryTestEntry['status'],
): HistoryTestEntry {
  return { name, suite, status, duration: 1.0 };
}

describe('detectFlakyTests', () => {
  it('detects a test that flips between passed and failed', () => {
    const entries = [
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
    ];

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(true);
    expect(result.flakyTests).toHaveLength(1);
    expect(result.flakyTests[0].name).toBe('login');
    expect(result.flakyTests[0].suite).toBe('auth');
    expect(result.flakyTests[0].flipCount).toBe(4);
    expect(result.flakyTests[0].flakyRate).toBe(100);
  });

  it('does not flag a consistently passing test', () => {
    const entries = Array.from({ length: 5 }, () =>
      makeEntry([makeTest('stable', 'core', 'passed')]),
    );

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(false);
    expect(result.flakyTests).toHaveLength(0);
  });

  it('does not flag a consistently failing test', () => {
    const entries = Array.from({ length: 5 }, () =>
      makeEntry([makeTest('broken', 'core', 'failed')]),
    );

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(false);
  });

  it('respects the threshold parameter', () => {
    const entries = [
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
    ];

    const result2 = detectFlakyTests(entries, 2);
    expect(result2.hasFlakyTests).toBe(true);

    const result3 = detectFlakyTests(entries, 3);
    expect(result3.hasFlakyTests).toBe(false);
  });

  it('sorts by flakyRate descending, then flipCount descending', () => {
    const entries = [
      makeEntry([makeTest('a', 'suite', 'passed'), makeTest('b', 'suite', 'passed')]),
      makeEntry([makeTest('a', 'suite', 'failed'), makeTest('b', 'suite', 'failed')]),
      makeEntry([makeTest('a', 'suite', 'passed'), makeTest('b', 'suite', 'passed')]),
      makeEntry([makeTest('a', 'suite', 'passed'), makeTest('b', 'suite', 'failed')]),
      makeEntry([makeTest('a', 'suite', 'passed'), makeTest('b', 'suite', 'passed')]),
    ];

    const result = detectFlakyTests(entries, 2);
    expect(result.flakyTests).toHaveLength(2);
    expect(result.flakyTests[0].name).toBe('b');
    expect(result.flakyTests[0].flipCount).toBe(4);
    expect(result.flakyTests[1].name).toBe('a');
    expect(result.flakyTests[1].flipCount).toBe(2);
  });

  it('skips tests that are always skipped', () => {
    const entries = Array.from({ length: 5 }, () =>
      makeEntry([makeTest('ignored', 'suite', 'skipped')]),
    );

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(false);
  });

  it('ignores skipped entries when counting flips', () => {
    const entries = [
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'skipped')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'skipped')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
    ];

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(true);
    expect(result.flakyTests[0].flipCount).toBe(2);
  });

  it('handles tests that only appear in some entries', () => {
    const entries = [
      makeEntry([makeTest('stable', 'core', 'passed')]),
      makeEntry([makeTest('stable', 'core', 'passed'), makeTest('new', 'core', 'passed')]),
      makeEntry([makeTest('stable', 'core', 'passed'), makeTest('new', 'core', 'failed')]),
      makeEntry([makeTest('stable', 'core', 'passed'), makeTest('new', 'core', 'passed')]),
      makeEntry([makeTest('stable', 'core', 'passed'), makeTest('new', 'core', 'failed')]),
    ];

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(true);
    expect(result.flakyTests).toHaveLength(1);
    expect(result.flakyTests[0].name).toBe('new');
    expect(result.flakyTests[0].flipCount).toBe(3);
  });

  it('handles test with only 1 non-skipped run', () => {
    const entries = [
      makeEntry([makeTest('solo', 'suite', 'skipped')]),
      makeEntry([makeTest('solo', 'suite', 'skipped')]),
      makeEntry([makeTest('solo', 'suite', 'passed')]),
      makeEntry([makeTest('solo', 'suite', 'skipped')]),
      makeEntry([makeTest('solo', 'suite', 'skipped')]),
    ];

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(false);
  });

  it('uses windowSize to limit entries considered', () => {
    const oldEntries = [
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
    ];
    const recentEntries = Array.from({ length: 5 }, () =>
      makeEntry([makeTest('login', 'auth', 'passed')]),
    );

    const result = detectFlakyTests([...oldEntries, ...recentEntries], 2, 5);
    expect(result.hasFlakyTests).toBe(false);
  });

  it('treats errored as failing for flip counting', () => {
    const entries = [
      makeEntry([makeTest('crash', 'core', 'passed')]),
      makeEntry([makeTest('crash', 'core', 'errored')]),
      makeEntry([makeTest('crash', 'core', 'passed')]),
      makeEntry([makeTest('crash', 'core', 'errored')]),
      makeEntry([makeTest('crash', 'core', 'passed')]),
    ];

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(true);
    expect(result.flakyTests[0].flipCount).toBe(4);
  });

  it('stores recent statuses in order', () => {
    const entries = [
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
    ];

    const result = detectFlakyTests(entries, 2);
    expect(result.flakyTests[0].recentStatuses).toEqual([
      'passed',
      'failed',
      'passed',
      'failed',
      'passed',
    ]);
  });

  it('returns empty result for fewer than 2 entries', () => {
    const entries = [makeEntry([makeTest('login', 'auth', 'passed')])];

    const result = detectFlakyTests(entries, 2);
    expect(result.hasFlakyTests).toBe(false);
    expect(result.flakyTests).toHaveLength(0);
  });

  it('uses default threshold and windowSize', () => {
    const entries = [
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
    ];

    const result = detectFlakyTests(entries);
    expect(result.hasFlakyTests).toBe(true);
  });

  it('calculates flakyRate correctly', () => {
    const entries = [
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'failed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
      makeEntry([makeTest('login', 'auth', 'passed')]),
    ];

    const result = detectFlakyTests(entries, 2);
    expect(result.flakyTests[0].flakyRate).toBe(50);
  });
});
