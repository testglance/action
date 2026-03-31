import type { HistoryEntry, DeltaComparison, DeltaTestInfo } from './types';

function buildTestKey(suite: string, name: string): string {
  return `${suite}::${name}`;
}

function computePassRate(entry: HistoryEntry): number {
  const { total, passed } = entry.summary;
  return total > 0 ? (passed / total) * 100 : 0;
}

export function computeDelta(previous: HistoryEntry, current: HistoryEntry): DeltaComparison {
  const prevMap = new Map<string, HistoryEntry['tests'][number]>();
  for (const t of previous.tests) {
    prevMap.set(buildTestKey(t.suite, t.name), t);
  }

  const currMap = new Map<string, HistoryEntry['tests'][number]>();
  for (const t of current.tests) {
    currMap.set(buildTestKey(t.suite, t.name), t);
  }

  const testsAdded: DeltaTestInfo[] = [];
  const testsRemoved: DeltaTestInfo[] = [];
  const newlyFailing: DeltaTestInfo[] = [];
  const newlyPassing: DeltaTestInfo[] = [];

  // Only compute test-level diffs when both entries have test data
  if (previous.tests.length > 0 && current.tests.length > 0) {
    for (const [key, curr] of currMap) {
      const prev = prevMap.get(key);
      if (!prev) {
        testsAdded.push({ name: curr.name, suite: curr.suite });
      } else {
        if (prev.status === 'passed' && (curr.status === 'failed' || curr.status === 'errored')) {
          newlyFailing.push({ name: curr.name, suite: curr.suite });
        }
        if ((prev.status === 'failed' || prev.status === 'errored') && curr.status === 'passed') {
          newlyPassing.push({ name: curr.name, suite: curr.suite });
        }
      }
    }

    for (const [key, prev] of prevMap) {
      if (!currMap.has(key)) {
        testsRemoved.push({ name: prev.name, suite: prev.suite });
      }
    }
  } else if (previous.tests.length === 0 && current.tests.length > 0) {
    // Previous was trimmed by size guard — skip test-level comparison
  }

  const passRatePrev = computePassRate(previous);
  const passRateCurr = computePassRate(current);
  const passRateDelta = passRateCurr - passRatePrev;

  const durationPrev = previous.summary.duration;
  const durationCurr = current.summary.duration;
  const durationDelta = durationCurr - durationPrev;
  const durationDeltaPercent = durationPrev > 0 ? (durationDelta / durationPrev) * 100 : 0;

  const hasChanges =
    testsAdded.length > 0 ||
    testsRemoved.length > 0 ||
    newlyFailing.length > 0 ||
    newlyPassing.length > 0;

  return {
    testsAdded,
    testsRemoved,
    newlyFailing,
    newlyPassing,
    passRatePrev,
    passRateCurr,
    passRateDelta,
    durationPrev,
    durationCurr,
    durationDelta,
    durationDeltaPercent,
    hasChanges,
  };
}
