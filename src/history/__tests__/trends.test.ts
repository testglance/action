import { describe, it, expect } from 'vitest';
import { computeTrends, buildSparkline } from '../trends';
import type { HistoryEntry } from '../types';

function makeSummaryEntry(overrides: Partial<HistoryEntry['summary']> = {}): HistoryEntry {
  return {
    timestamp: '2026-04-01T12:00:00.000Z',
    commitSha: 'abc1234',
    summary: {
      total: 100,
      passed: 95,
      failed: 3,
      skipped: 2,
      errored: 0,
      duration: 12.0,
      ...overrides,
    },
    tests: [],
  };
}

describe('computeTrends', () => {
  describe('pass rate direction', () => {
    it('detects improving pass rate (↑)', () => {
      const entries = [
        makeSummaryEntry({ total: 100, passed: 90 }),
        makeSummaryEntry({ total: 100, passed: 91 }),
        makeSummaryEntry({ total: 100, passed: 96 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.passRate.direction).toBe('up');
      expect(trends.passRate.current).toBe(96);
      expect(trends.passRate.delta).toBeGreaterThan(1.0);
    });

    it('detects stable pass rate (→)', () => {
      const entries = [
        makeSummaryEntry({ total: 100, passed: 95 }),
        makeSummaryEntry({ total: 100, passed: 95 }),
        makeSummaryEntry({ total: 100, passed: 95 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.passRate.direction).toBe('stable');
      expect(trends.passRate.delta).toBeCloseTo(0, 1);
    });

    it('detects declining pass rate (↓)', () => {
      const entries = [
        makeSummaryEntry({ total: 100, passed: 96 }),
        makeSummaryEntry({ total: 100, passed: 95 }),
        makeSummaryEntry({ total: 100, passed: 90 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.passRate.direction).toBe('down');
      expect(trends.passRate.current).toBe(90);
      expect(trends.passRate.delta).toBeLessThan(-1.0);
    });

    it('classifies within ±1% as stable', () => {
      const entries = [
        makeSummaryEntry({ total: 100, passed: 95 }),
        makeSummaryEntry({ total: 100, passed: 95 }),
        makeSummaryEntry({ total: 100, passed: 96 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.passRate.direction).toBe('stable');
    });
  });

  describe('duration direction', () => {
    it('detects slower duration (↑)', () => {
      const entries = [
        makeSummaryEntry({ duration: 10.0 }),
        makeSummaryEntry({ duration: 10.0 }),
        makeSummaryEntry({ duration: 12.0 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.duration.direction).toBe('up');
      expect(trends.duration.current).toBe(12.0);
      expect(trends.duration.deltaPercent).toBeGreaterThan(5.0);
    });

    it('detects stable duration (→)', () => {
      const entries = [
        makeSummaryEntry({ duration: 10.0 }),
        makeSummaryEntry({ duration: 10.0 }),
        makeSummaryEntry({ duration: 10.2 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.duration.direction).toBe('stable');
    });

    it('detects faster duration (↓)', () => {
      const entries = [
        makeSummaryEntry({ duration: 12.0 }),
        makeSummaryEntry({ duration: 12.0 }),
        makeSummaryEntry({ duration: 10.0 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.duration.direction).toBe('down');
      expect(trends.duration.deltaPercent).toBeLessThan(-5.0);
    });

    it('classifies within ±5% as stable', () => {
      const entries = [
        makeSummaryEntry({ duration: 10.0 }),
        makeSummaryEntry({ duration: 10.0 }),
        makeSummaryEntry({ duration: 10.4 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.duration.direction).toBe('stable');
    });
  });

  describe('test count delta', () => {
    it('detects positive delta (tests added)', () => {
      const entries = [
        makeSummaryEntry({ total: 100 }),
        makeSummaryEntry({ total: 100 }),
        makeSummaryEntry({ total: 103 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.testCount.current).toBe(103);
      expect(trends.testCount.delta).toBe(3);
    });

    it('detects negative delta (tests removed)', () => {
      const entries = [
        makeSummaryEntry({ total: 100 }),
        makeSummaryEntry({ total: 100 }),
        makeSummaryEntry({ total: 97 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.testCount.delta).toBe(-3);
    });

    it('detects zero delta (no change)', () => {
      const entries = [
        makeSummaryEntry({ total: 100 }),
        makeSummaryEntry({ total: 100 }),
        makeSummaryEntry({ total: 100 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.testCount.delta).toBe(0);
    });
  });

  describe('sparklines', () => {
    it('generates sparklines when >= 5 entries', () => {
      const entries = [
        makeSummaryEntry({ total: 100, passed: 90, duration: 10 }),
        makeSummaryEntry({ total: 100, passed: 92, duration: 11 }),
        makeSummaryEntry({ total: 100, passed: 94, duration: 12 }),
        makeSummaryEntry({ total: 100, passed: 96, duration: 13 }),
        makeSummaryEntry({ total: 100, passed: 98, duration: 14 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.passRate.sparkline).toHaveLength(5);
      expect(trends.duration.sparkline).toHaveLength(5);
    });

    it('omits sparklines when < 5 entries', () => {
      const entries = [
        makeSummaryEntry({ total: 100, passed: 90, duration: 10 }),
        makeSummaryEntry({ total: 100, passed: 92, duration: 11 }),
        makeSummaryEntry({ total: 100, passed: 94, duration: 12 }),
        makeSummaryEntry({ total: 100, passed: 96, duration: 13 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.passRate.sparkline).toBe('');
      expect(trends.duration.sparkline).toBe('');
    });

    it('omits sparklines when exactly 3 entries', () => {
      const entries = [
        makeSummaryEntry({ duration: 10 }),
        makeSummaryEntry({ duration: 11 }),
        makeSummaryEntry({ duration: 12 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.passRate.sparkline).toBe('');
      expect(trends.duration.sparkline).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles all identical values', () => {
      const entries = Array.from({ length: 5 }, () =>
        makeSummaryEntry({ total: 100, passed: 95, duration: 10.0 }),
      );

      const trends = computeTrends(entries);
      expect(trends.passRate.direction).toBe('stable');
      expect(trends.duration.direction).toBe('stable');
      expect(trends.testCount.delta).toBe(0);
      expect(trends.passRate.sparkline).toHaveLength(5);
    });

    it('handles single entry (minimum for computeTrends, though gate is 3)', () => {
      const entries = [makeSummaryEntry({ total: 50, passed: 45, duration: 5.0 })];

      const trends = computeTrends(entries);
      expect(trends.passRate.current).toBe(90);
      expect(trends.duration.current).toBe(5.0);
      expect(trends.testCount.current).toBe(50);
      expect(trends.testCount.delta).toBe(0);
      expect(trends.passRate.sparkline).toBe('');
    });

    it('handles entries with zero total tests', () => {
      const entries = [
        makeSummaryEntry({ total: 0, passed: 0, duration: 0 }),
        makeSummaryEntry({ total: 0, passed: 0, duration: 0 }),
        makeSummaryEntry({ total: 0, passed: 0, duration: 0 }),
      ];

      const trends = computeTrends(entries);
      expect(trends.passRate.current).toBe(0);
      expect(trends.passRate.direction).toBe('stable');
    });
  });
});

describe('buildSparkline', () => {
  it('generates sparkline from numeric values', () => {
    const result = buildSparkline([1, 2, 3, 4, 5]);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe('▁');
    expect(result[4]).toBe('█');
  });

  it('returns empty for empty array', () => {
    expect(buildSparkline([])).toBe('');
  });

  it('handles all identical values', () => {
    const result = buildSparkline([5, 5, 5, 5]);
    expect(result).toBe('▅▅▅▅');
  });

  it('handles single value', () => {
    const result = buildSparkline([42]);
    expect(result).toBe('▅');
  });

  it('handles two values', () => {
    const result = buildSparkline([0, 100]);
    expect(result).toBe('▁█');
  });
});
