import type { HistoryEntry, TrendDirection, TrendIndicators } from './types';

const SPARKLINE_CHARS = '▁▂▃▄▅▆▇█';
const PASS_RATE_THRESHOLD = 1.0;
const DURATION_THRESHOLD = 5.0;
const MIN_SPARKLINE_ENTRIES = 5;

export function buildSparkline(values: number[]): string {
  if (values.length === 0) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    return SPARKLINE_CHARS[4].repeat(values.length);
  }

  const range = max - min;
  return values
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (SPARKLINE_CHARS.length - 1));
      return SPARKLINE_CHARS[idx];
    })
    .join('');
}

function classifyDirection(delta: number, threshold: number): TrendDirection {
  if (delta > threshold) return 'up';
  if (delta < -threshold) return 'down';
  return 'stable';
}

export function computeTrends(entries: HistoryEntry[]): TrendIndicators {
  const current = entries[entries.length - 1];
  const previous = entries.slice(0, -1);

  const currentPassRate =
    current.summary.total > 0 ? (current.summary.passed / current.summary.total) * 100 : 0;

  const prevPassRates = previous.map((e) =>
    e.summary.total > 0 ? (e.summary.passed / e.summary.total) * 100 : 0,
  );
  const avgPrevPassRate = prevPassRates.reduce((sum, r) => sum + r, 0) / prevPassRates.length;
  const passRateDelta = currentPassRate - avgPrevPassRate;

  const currentDuration = current.summary.duration;
  const prevDurations = previous.map((e) => e.summary.duration);
  const avgPrevDuration = prevDurations.reduce((sum, d) => sum + d, 0) / prevDurations.length;
  const durationDelta = currentDuration - avgPrevDuration;
  const durationDeltaPercent = avgPrevDuration !== 0 ? (durationDelta / avgPrevDuration) * 100 : 0;

  const previousEntry = entries.length >= 2 ? entries[entries.length - 2] : null;
  const testCountDelta = previousEntry ? current.summary.total - previousEntry.summary.total : 0;

  const allPassRates = entries.map((e) =>
    e.summary.total > 0 ? (e.summary.passed / e.summary.total) * 100 : 0,
  );
  const allDurations = entries.map((e) => e.summary.duration);

  return {
    passRate: {
      direction: classifyDirection(passRateDelta, PASS_RATE_THRESHOLD),
      current: currentPassRate,
      delta: passRateDelta,
      sparkline: entries.length >= MIN_SPARKLINE_ENTRIES ? buildSparkline(allPassRates) : '',
    },
    duration: {
      direction: classifyDirection(durationDeltaPercent, DURATION_THRESHOLD),
      current: currentDuration,
      delta: durationDelta,
      deltaPercent: durationDeltaPercent,
      sparkline: entries.length >= MIN_SPARKLINE_ENTRIES ? buildSparkline(allDurations) : '',
    },
    testCount: {
      current: current.summary.total,
      delta: testCountDelta,
    },
  };
}
