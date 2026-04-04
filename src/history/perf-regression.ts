import type { HistoryEntry, PerfRegressionInfo, PerfRegressionResult } from './types';
import { buildTestKey } from './comparison';
import { buildSparkline } from './trends';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function detectPerfRegressions(
  entries: HistoryEntry[],
  threshold: number = 200,
): PerfRegressionResult {
  const currentEntry = entries[entries.length - 1];
  const previousEntries = entries.slice(0, -1);

  const durationMap = new Map<string, number[]>();

  for (const entry of previousEntries) {
    for (const test of entry.tests) {
      if (test.duration <= 0) continue;

      const key = buildTestKey(test.suite, test.name);
      let durations = durationMap.get(key);
      if (!durations) {
        durations = [];
        durationMap.set(key, durations);
      }
      durations.push(test.duration);
    }
  }

  const regressions: PerfRegressionInfo[] = [];

  for (const test of currentEntry.tests) {
    if (test.duration === 0) continue;

    const key = buildTestKey(test.suite, test.name);
    const previousDurations = durationMap.get(key);

    if (!previousDurations || previousDurations.length < 3) continue;

    const med = median(previousDurations);
    if (med === 0) continue;

    const increasePercent = ((test.duration - med) / med) * 100;
    if (increasePercent > threshold) {
      regressions.push({
        name: test.name,
        suite: test.suite,
        currentDuration: test.duration,
        medianDuration: med,
        increasePercent,
      });
    }
  }

  regressions.sort((a, b) => b.increasePercent - a.increasePercent);

  return {
    regressions,
    hasRegressions: regressions.length > 0,
    sparkline: buildDurationSparkline(entries),
  };
}

export function buildDurationSparkline(entries: HistoryEntry[]): string {
  if (entries.length === 0) return '';
  return buildSparkline(entries.map((e) => e.summary.duration));
}
