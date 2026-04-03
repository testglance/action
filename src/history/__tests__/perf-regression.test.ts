import { describe, it, expect } from 'vitest';
import { detectPerfRegressions, buildDurationSparkline } from '../perf-regression';
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
  duration: number,
  status: HistoryTestEntry['status'] = 'passed',
): HistoryTestEntry {
  return { name, suite, status, duration };
}

describe('detectPerfRegressions', () => {
  it('detects a test that exceeds the threshold', () => {
    const entries = [
      makeEntry([makeTest('slow', 'suite', 1.0)]),
      makeEntry([makeTest('slow', 'suite', 1.0)]),
      makeEntry([makeTest('slow', 'suite', 1.0)]),
      makeEntry([makeTest('slow', 'suite', 4.0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(true);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].name).toBe('slow');
    expect(result.regressions[0].suite).toBe('suite');
    expect(result.regressions[0].currentDuration).toBe(4.0);
    expect(result.regressions[0].medianDuration).toBe(1.0);
    expect(result.regressions[0].increasePercent).toBe(300);
  });

  it('does not flag a test below the threshold', () => {
    const entries = [
      makeEntry([makeTest('fast', 'suite', 1.0)]),
      makeEntry([makeTest('fast', 'suite', 1.0)]),
      makeEntry([makeTest('fast', 'suite', 1.0)]),
      makeEntry([makeTest('fast', 'suite', 2.5)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(false);
  });

  it('flags test exactly above threshold, not at threshold', () => {
    const entries = [
      makeEntry([makeTest('edge', 'suite', 1.0)]),
      makeEntry([makeTest('edge', 'suite', 1.0)]),
      makeEntry([makeTest('edge', 'suite', 1.0)]),
      makeEntry([makeTest('edge', 'suite', 3.0)]),
    ];

    // 200% increase = exactly at threshold → not flagged (> not >=)
    const resultAt = detectPerfRegressions(entries, 200);
    expect(resultAt.hasRegressions).toBe(false);

    // 199% threshold → 200% increase is above → flagged
    const resultAbove = detectPerfRegressions(entries, 199);
    expect(resultAbove.hasRegressions).toBe(true);
  });

  it('excludes tests with fewer than 3 historical runs', () => {
    const entries = [
      makeEntry([makeTest('new', 'suite', 1.0)]),
      makeEntry([makeTest('new', 'suite', 1.0)]),
      makeEntry([makeTest('new', 'suite', 10.0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(false);
  });

  it('excludes new tests not present in history', () => {
    const entries = [
      makeEntry([makeTest('old', 'suite', 1.0)]),
      makeEntry([makeTest('old', 'suite', 1.0)]),
      makeEntry([makeTest('old', 'suite', 1.0)]),
      makeEntry([makeTest('brand_new', 'suite', 100.0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(false);
  });

  it('excludes tests with zero current duration', () => {
    const entries = [
      makeEntry([makeTest('zero', 'suite', 1.0)]),
      makeEntry([makeTest('zero', 'suite', 1.0)]),
      makeEntry([makeTest('zero', 'suite', 1.0)]),
      makeEntry([makeTest('zero', 'suite', 0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(false);
  });

  it('excludes tests with zero median', () => {
    const entries = [
      makeEntry([makeTest('zero_med', 'suite', 0)]),
      makeEntry([makeTest('zero_med', 'suite', 0)]),
      makeEntry([makeTest('zero_med', 'suite', 0)]),
      makeEntry([makeTest('zero_med', 'suite', 5.0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(false);
  });

  it('ignores zero-duration historical samples when building baseline', () => {
    const entries = [
      makeEntry([makeTest('slow', 'suite', 0)]),
      makeEntry([makeTest('slow', 'suite', 1.0)]),
      makeEntry([makeTest('slow', 'suite', 1.0)]),
      makeEntry([makeTest('slow', 'suite', 1.0)]),
      makeEntry([makeTest('slow', 'suite', 4.0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(true);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].medianDuration).toBe(1.0);
  });

  it('sorts regressions by increasePercent descending', () => {
    const entries = [
      makeEntry([makeTest('a', 's', 1.0), makeTest('b', 's', 1.0)]),
      makeEntry([makeTest('a', 's', 1.0), makeTest('b', 's', 1.0)]),
      makeEntry([makeTest('a', 's', 1.0), makeTest('b', 's', 1.0)]),
      makeEntry([makeTest('a', 's', 5.0), makeTest('b', 's', 10.0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.regressions).toHaveLength(2);
    expect(result.regressions[0].name).toBe('b');
    expect(result.regressions[1].name).toBe('a');
  });

  it('computes median correctly for odd number of runs', () => {
    const entries = [
      makeEntry([makeTest('t', 's', 1.0)]),
      makeEntry([makeTest('t', 's', 3.0)]),
      makeEntry([makeTest('t', 's', 2.0)]),
      makeEntry([makeTest('t', 's', 5.0)]),
      makeEntry([makeTest('t', 's', 100.0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    // median of [1, 3, 2, 5] sorted = [1, 2, 3, 5], even → (2+3)/2 = 2.5
    // increase = (100 - 2.5) / 2.5 * 100 = 3900%
    expect(result.hasRegressions).toBe(true);
    expect(result.regressions[0].medianDuration).toBe(2.5);
  });

  it('computes median correctly for even number of runs', () => {
    const entries = [
      makeEntry([makeTest('t', 's', 1.0)]),
      makeEntry([makeTest('t', 's', 2.0)]),
      makeEntry([makeTest('t', 's', 3.0)]),
      makeEntry([makeTest('t', 's', 100.0)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    // median of [1, 2, 3] = 2.0
    expect(result.regressions[0].medianDuration).toBe(2.0);
  });

  it('uses custom threshold', () => {
    const entries = [
      makeEntry([makeTest('t', 's', 1.0)]),
      makeEntry([makeTest('t', 's', 1.0)]),
      makeEntry([makeTest('t', 's', 1.0)]),
      makeEntry([makeTest('t', 's', 2.5)]),
    ];

    // 150% increase, default 200 threshold → not flagged
    expect(detectPerfRegressions(entries, 200).hasRegressions).toBe(false);
    // Custom 100 threshold → flagged
    expect(detectPerfRegressions(entries, 100).hasRegressions).toBe(true);
  });

  it('uses default threshold of 200', () => {
    const entries = [
      makeEntry([makeTest('t', 's', 1.0)]),
      makeEntry([makeTest('t', 's', 1.0)]),
      makeEntry([makeTest('t', 's', 1.0)]),
      makeEntry([makeTest('t', 's', 4.0)]),
    ];

    const result = detectPerfRegressions(entries);
    expect(result.hasRegressions).toBe(true);
  });

  it('returns empty regressions when all tests are below threshold', () => {
    const entries = [
      makeEntry([makeTest('a', 's', 1.0), makeTest('b', 's', 2.0)]),
      makeEntry([makeTest('a', 's', 1.1), makeTest('b', 's', 2.1)]),
      makeEntry([makeTest('a', 's', 1.0), makeTest('b', 's', 2.0)]),
      makeEntry([makeTest('a', 's', 1.2), makeTest('b', 's', 2.2)]),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(false);
    expect(result.regressions).toHaveLength(0);
  });

  it('handles empty history entries', () => {
    const entries = [makeEntry([makeTest('t', 's', 1.0)])];

    const result = detectPerfRegressions(entries, 200);
    expect(result.hasRegressions).toBe(false);
    expect(result.regressions).toHaveLength(0);
  });

  it('always includes sparkline in result', () => {
    const entries = [
      makeEntry([makeTest('t', 's', 1.0)], {
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 5.0 },
      }),
      makeEntry([makeTest('t', 's', 1.0)], {
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 10.0 },
      }),
      makeEntry([makeTest('t', 's', 1.0)], {
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 15.0 },
      }),
      makeEntry([makeTest('t', 's', 1.0)], {
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 20.0 },
      }),
    ];

    const result = detectPerfRegressions(entries, 200);
    expect(result.sparkline).toHaveLength(4);
    expect(result.sparkline).toBe('▁▃▆█');
  });
});

describe('buildDurationSparkline', () => {
  it('generates increasing sparkline', () => {
    const entries = [
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 1.0 },
      }),
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 2.0 },
      }),
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 3.0 },
      }),
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 4.0 },
      }),
    ];

    const sparkline = buildDurationSparkline(entries);
    expect(sparkline).toHaveLength(4);
    expect(sparkline[0]).toBe('▁');
    expect(sparkline[sparkline.length - 1]).toBe('█');
  });

  it('generates decreasing sparkline', () => {
    const entries = [
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 4.0 },
      }),
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 3.0 },
      }),
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 2.0 },
      }),
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 1.0 },
      }),
    ];

    const sparkline = buildDurationSparkline(entries);
    expect(sparkline[0]).toBe('█');
    expect(sparkline[sparkline.length - 1]).toBe('▁');
  });

  it('generates flat sparkline when all durations equal', () => {
    const entries = Array.from({ length: 5 }, () =>
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 10.0 },
      }),
    );

    const sparkline = buildDurationSparkline(entries);
    expect(sparkline).toBe('▅▅▅▅▅');
  });

  it('returns empty string for empty entries', () => {
    expect(buildDurationSparkline([])).toBe('');
  });

  it('handles single entry', () => {
    const entries = [
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 5.0 },
      }),
    ];

    const sparkline = buildDurationSparkline(entries);
    expect(sparkline).toBe('▅');
  });

  it('handles mixed duration patterns', () => {
    const durations = [1, 3, 2, 5, 1];
    const entries = durations.map((d) =>
      makeEntry([], {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: d },
      }),
    );

    const sparkline = buildDurationSparkline(entries);
    expect(sparkline).toHaveLength(5);
    // min=1, max=5: first char should be lowest, 4th should be highest
    expect(sparkline[0]).toBe('▁');
    expect(sparkline[3]).toBe('█');
    expect(sparkline[4]).toBe('▁');
  });
});
