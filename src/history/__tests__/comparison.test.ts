import { describe, it, expect } from 'vitest';
import { computeDelta, computeTestsChanged } from '../comparison';
import type { HistoryEntry } from '../types';

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: '2026-03-31T12:00:00.000Z',
    commitSha: 'abc1234',
    summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 10.0 },
    tests: [
      { name: 'test1', suite: 'auth', status: 'passed', duration: 3.0 },
      { name: 'test2', suite: 'auth', status: 'passed', duration: 4.0 },
      { name: 'test3', suite: 'auth', status: 'failed', duration: 3.0 },
    ],
    ...overrides,
  };
}

describe('computeDelta', () => {
  it('detects tests added (new tests not in previous run)', () => {
    const previous = makeEntry();
    const current = makeEntry({
      tests: [
        ...previous.tests,
        { name: 'test_new', suite: 'auth', status: 'passed', duration: 1.0 },
      ],
      summary: { total: 4, passed: 3, failed: 1, skipped: 0, errored: 0, duration: 11.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.testsAdded).toEqual([{ name: 'test_new', suite: 'auth' }]);
    expect(delta.hasChanges).toBe(true);
  });

  it('detects tests removed (tests in previous but not current)', () => {
    const previous = makeEntry();
    const current = makeEntry({
      tests: [previous.tests[0], previous.tests[1]],
      summary: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0, duration: 7.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.testsRemoved).toEqual([{ name: 'test3', suite: 'auth' }]);
    expect(delta.hasChanges).toBe(true);
  });

  it('detects newly failing tests (passed → failed)', () => {
    const previous = makeEntry();
    const current = makeEntry({
      tests: [
        { name: 'test1', suite: 'auth', status: 'failed', duration: 3.0 },
        { name: 'test2', suite: 'auth', status: 'passed', duration: 4.0 },
        { name: 'test3', suite: 'auth', status: 'failed', duration: 3.0 },
      ],
      summary: { total: 3, passed: 1, failed: 2, skipped: 0, errored: 0, duration: 10.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.newlyFailing).toEqual([{ name: 'test1', suite: 'auth' }]);
    expect(delta.hasChanges).toBe(true);
  });

  it('detects newly failing tests (passed → errored)', () => {
    const previous = makeEntry();
    const current = makeEntry({
      tests: [
        { name: 'test1', suite: 'auth', status: 'errored', duration: 3.0 },
        { name: 'test2', suite: 'auth', status: 'passed', duration: 4.0 },
        { name: 'test3', suite: 'auth', status: 'failed', duration: 3.0 },
      ],
      summary: { total: 3, passed: 1, failed: 1, skipped: 0, errored: 1, duration: 10.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.newlyFailing).toEqual([{ name: 'test1', suite: 'auth' }]);
  });

  it('detects newly passing tests (failed → passed)', () => {
    const previous = makeEntry();
    const current = makeEntry({
      tests: [
        { name: 'test1', suite: 'auth', status: 'passed', duration: 3.0 },
        { name: 'test2', suite: 'auth', status: 'passed', duration: 4.0 },
        { name: 'test3', suite: 'auth', status: 'passed', duration: 3.0 },
      ],
      summary: { total: 3, passed: 3, failed: 0, skipped: 0, errored: 0, duration: 10.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.newlyPassing).toEqual([{ name: 'test3', suite: 'auth' }]);
    expect(delta.hasChanges).toBe(true);
  });

  it('detects newly passing tests (errored → passed)', () => {
    const previous = makeEntry({
      tests: [
        { name: 'test1', suite: 'auth', status: 'passed', duration: 3.0 },
        { name: 'test2', suite: 'auth', status: 'passed', duration: 4.0 },
        { name: 'test3', suite: 'auth', status: 'errored', duration: 3.0 },
      ],
    });
    const current = makeEntry({
      tests: [
        { name: 'test1', suite: 'auth', status: 'passed', duration: 3.0 },
        { name: 'test2', suite: 'auth', status: 'passed', duration: 4.0 },
        { name: 'test3', suite: 'auth', status: 'passed', duration: 3.0 },
      ],
      summary: { total: 3, passed: 3, failed: 0, skipped: 0, errored: 0, duration: 10.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.newlyPassing).toEqual([{ name: 'test3', suite: 'auth' }]);
  });

  it('computes pass rate delta correctly', () => {
    const previous = makeEntry({
      summary: { total: 100, passed: 94, failed: 6, skipped: 0, errored: 0, duration: 10.0 },
    });
    const current = makeEntry({
      summary: { total: 100, passed: 97, failed: 3, skipped: 0, errored: 0, duration: 10.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.passRatePrev).toBe(94);
    expect(delta.passRateCurr).toBe(97);
    expect(delta.passRateDelta).toBe(3);
  });

  it('computes duration delta and percentage correctly', () => {
    const previous = makeEntry({
      summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 12.4 },
    });
    const current = makeEntry({
      summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 13.1 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.durationPrev).toBe(12.4);
    expect(delta.durationCurr).toBe(13.1);
    expect(delta.durationDelta).toBeCloseTo(0.7, 5);
    expect(delta.durationDeltaPercent).toBeCloseTo(5.645, 1);
  });

  it('returns hasChanges=false when nothing changed', () => {
    const previous = makeEntry();
    const current = makeEntry();

    const delta = computeDelta(previous, current);
    expect(delta.hasChanges).toBe(false);
    expect(delta.testsAdded).toEqual([]);
    expect(delta.testsRemoved).toEqual([]);
    expect(delta.newlyFailing).toEqual([]);
    expect(delta.newlyPassing).toEqual([]);
  });

  it('sets hasChanges=true when only aggregate metrics changed', () => {
    const previous = makeEntry({
      summary: { total: 100, passed: 95, failed: 5, skipped: 0, errored: 0, duration: 12.0 },
    });
    const current = makeEntry({
      summary: { total: 100, passed: 95, failed: 5, skipped: 0, errored: 0, duration: 10.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.testsAdded).toEqual([]);
    expect(delta.testsRemoved).toEqual([]);
    expect(delta.newlyFailing).toEqual([]);
    expect(delta.newlyPassing).toEqual([]);
    expect(delta.durationDelta).toBe(-2);
    expect(delta.hasChanges).toBe(true);
  });

  it('handles empty test arrays gracefully (oldest entries with trimmed tests)', () => {
    const previous = makeEntry({
      tests: [],
      summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 10.0 },
    });
    const current = makeEntry();

    const delta = computeDelta(previous, current);
    expect(delta.testsAdded).toEqual([]);
    expect(delta.testsRemoved).toEqual([]);
    expect(delta.newlyFailing).toEqual([]);
    expect(delta.newlyPassing).toEqual([]);
    expect(delta.hasChanges).toBe(false);
    expect(delta.passRatePrev).toBeCloseTo(66.667, 1);
    expect(delta.passRateCurr).toBeCloseTo(66.667, 1);
  });

  it('handles edge case where previous entry has no tests (size-guard trimmed)', () => {
    const previous = makeEntry({
      tests: [],
      summary: { total: 50, passed: 40, failed: 10, skipped: 0, errored: 0, duration: 30.0 },
    });
    const current = makeEntry({
      summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 10.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.hasChanges).toBe(true);
    expect(delta.passRatePrev).toBe(80);
    expect(delta.passRateCurr).toBeCloseTo(66.667, 1);
    expect(delta.passRateDelta).toBeCloseTo(-13.333, 1);
    expect(delta.durationDelta).toBe(-20);
  });

  it('uses suite::name composite key to distinguish tests in different suites', () => {
    const previous = makeEntry({
      tests: [
        { name: 'login', suite: 'auth', status: 'passed', duration: 1.0 },
        { name: 'login', suite: 'api', status: 'passed', duration: 1.0 },
      ],
      summary: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0, duration: 2.0 },
    });
    const current = makeEntry({
      tests: [
        { name: 'login', suite: 'auth', status: 'passed', duration: 1.0 },
        { name: 'login', suite: 'api', status: 'failed', duration: 1.0 },
      ],
      summary: { total: 2, passed: 1, failed: 1, skipped: 0, errored: 0, duration: 2.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.newlyFailing).toEqual([{ name: 'login', suite: 'api' }]);
    expect(delta.testsAdded).toEqual([]);
    expect(delta.testsRemoved).toEqual([]);
  });

  it('handles duplicate test names within same suite without collapsing entries', () => {
    const previous = makeEntry({
      tests: [
        { name: 'same', suite: 'auth', status: 'passed', duration: 1.0 },
        { name: 'same', suite: 'auth', status: 'passed', duration: 1.0 },
      ],
      summary: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0, duration: 2.0 },
    });
    const current = makeEntry({
      tests: [{ name: 'same', suite: 'auth', status: 'passed', duration: 1.0 }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 1.0 },
    });

    const delta = computeDelta(previous, current);
    expect(delta.testsRemoved).toEqual([{ name: 'same', suite: 'auth' }]);
    expect(delta.testsAdded).toEqual([]);
    expect(delta.newlyFailing).toEqual([]);
    expect(delta.newlyPassing).toEqual([]);
    expect(delta.hasChanges).toBe(true);
  });
});

describe('computeTestsChanged', () => {
  it('detects new tests with correct status and duration', () => {
    const previous = makeEntry();
    const current = makeEntry({
      tests: [
        ...previous.tests,
        { name: 'test_new', suite: 'auth', status: 'passed', duration: 1.5 },
      ],
      summary: { total: 4, passed: 3, failed: 1, skipped: 0, errored: 0, duration: 11.5 },
    });

    const report = computeTestsChanged(previous, current);
    expect(report.newTests).toEqual([
      { name: 'test_new', suite: 'auth', status: 'passed', duration: 1.5 },
    ]);
    expect(report.hasChanges).toBe(true);
  });

  it('detects removed tests with correct previous status', () => {
    const previous = makeEntry();
    const current = makeEntry({
      tests: [previous.tests[0], previous.tests[1]],
      summary: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0, duration: 7.0 },
    });

    const report = computeTestsChanged(previous, current);
    expect(report.removedTests).toEqual([
      { name: 'test3', suite: 'auth', status: 'failed', duration: 3.0 },
    ]);
    expect(report.hasChanges).toBe(true);
  });

  it('detects status changes (passed→failed, failed→passed, etc.)', () => {
    const previous = makeEntry();
    const current = makeEntry({
      tests: [
        { name: 'test1', suite: 'auth', status: 'failed', duration: 3.0 },
        { name: 'test2', suite: 'auth', status: 'passed', duration: 4.0 },
        { name: 'test3', suite: 'auth', status: 'passed', duration: 3.0 },
      ],
      summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 10.0 },
    });

    const report = computeTestsChanged(previous, current);
    expect(report.statusChanged).toEqual(
      expect.arrayContaining([
        {
          name: 'test1',
          suite: 'auth',
          status: 'failed',
          duration: 3.0,
          previousStatus: 'passed',
        },
        {
          name: 'test3',
          suite: 'auth',
          status: 'passed',
          duration: 3.0,
          previousStatus: 'failed',
        },
      ]),
    );
    expect(report.statusChanged).toHaveLength(2);
  });

  it('does NOT include added/removed tests in statusChanged array', () => {
    const previous = makeEntry({
      tests: [{ name: 'test1', suite: 'auth', status: 'passed', duration: 3.0 }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 3.0 },
    });
    const current = makeEntry({
      tests: [{ name: 'test_new', suite: 'auth', status: 'failed', duration: 2.0 }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0, errored: 0, duration: 2.0 },
    });

    const report = computeTestsChanged(previous, current);
    expect(report.newTests).toHaveLength(1);
    expect(report.removedTests).toHaveLength(1);
    expect(report.statusChanged).toHaveLength(0);
  });

  it('returns hasChanges=false when all tests identical', () => {
    const previous = makeEntry();
    const current = makeEntry();

    const report = computeTestsChanged(previous, current);
    expect(report.hasChanges).toBe(false);
    expect(report.newTests).toEqual([]);
    expect(report.removedTests).toEqual([]);
    expect(report.statusChanged).toEqual([]);
  });

  it('handles empty tests arrays (trimmed entries) — returns empty report', () => {
    const previous = makeEntry({
      tests: [],
      summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 10.0 },
    });
    const current = makeEntry();

    const report = computeTestsChanged(previous, current);
    expect(report.hasChanges).toBe(false);
    expect(report.newTests).toEqual([]);
    expect(report.removedTests).toEqual([]);
    expect(report.statusChanged).toEqual([]);
  });

  it('handles suite::name composite key correctly (same name, different suites)', () => {
    const previous = makeEntry({
      tests: [
        { name: 'login', suite: 'auth', status: 'passed', duration: 1.0 },
        { name: 'login', suite: 'api', status: 'passed', duration: 1.0 },
      ],
      summary: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0, duration: 2.0 },
    });
    const current = makeEntry({
      tests: [
        { name: 'login', suite: 'auth', status: 'passed', duration: 1.0 },
        { name: 'login', suite: 'api', status: 'failed', duration: 1.0 },
      ],
      summary: { total: 2, passed: 1, failed: 1, skipped: 0, errored: 0, duration: 2.0 },
    });

    const report = computeTestsChanged(previous, current);
    expect(report.statusChanged).toEqual([
      { name: 'login', suite: 'api', status: 'failed', duration: 1.0, previousStatus: 'passed' },
    ]);
    expect(report.newTests).toEqual([]);
    expect(report.removedTests).toEqual([]);
  });
});
