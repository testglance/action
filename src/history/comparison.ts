import type {
  HistoryEntry,
  DeltaComparison,
  DeltaTestInfo,
  TestsChangedReport,
  TestsChangedEntry,
} from './types';

function buildTestKey(suite: string, name: string): string {
  return `${suite}::${name}`;
}

function computePassRate(entry: HistoryEntry): number {
  const { total, passed } = entry.summary;
  return total > 0 ? (passed / total) * 100 : 0;
}

type TestStatus = HistoryEntry['tests'][number]['status'];
type StatusCounts = Record<TestStatus, number>;

function zeroCounts(): StatusCounts {
  return {
    passed: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
  };
}

function countStatuses(tests: HistoryEntry['tests']): StatusCounts {
  const counts = zeroCounts();
  for (const t of tests) {
    counts[t.status] += 1;
  }
  return counts;
}

function sumCounts(counts: StatusCounts): number {
  return counts.passed + counts.failed + counts.skipped + counts.errored;
}

function pushRepeated(target: DeltaTestInfo[], entry: DeltaTestInfo, count: number): void {
  for (let i = 0; i < count; i++) {
    target.push(entry);
  }
}

export function computeTestsChanged(
  previous: HistoryEntry,
  current: HistoryEntry,
): TestsChangedReport {
  const empty: TestsChangedReport = {
    newTests: [],
    removedTests: [],
    statusChanged: [],
    hasChanges: false,
  };

  if (previous.tests.length === 0 || current.tests.length === 0) {
    return empty;
  }

  const prevMap = new Map<string, HistoryEntry['tests'][number]>();
  for (const t of previous.tests) {
    prevMap.set(buildTestKey(t.suite, t.name), t);
  }

  const currMap = new Map<string, HistoryEntry['tests'][number]>();
  for (const t of current.tests) {
    currMap.set(buildTestKey(t.suite, t.name), t);
  }

  const newTests: TestsChangedEntry[] = [];
  const removedTests: TestsChangedEntry[] = [];
  const statusChanged: TestsChangedEntry[] = [];

  for (const [key, curr] of currMap) {
    const prev = prevMap.get(key);
    if (!prev) {
      newTests.push({
        name: curr.name,
        suite: curr.suite,
        status: curr.status,
        duration: curr.duration,
      });
    } else if (prev.status !== curr.status) {
      statusChanged.push({
        name: curr.name,
        suite: curr.suite,
        status: curr.status,
        duration: curr.duration,
        previousStatus: prev.status,
      });
    }
  }

  for (const [key, prev] of prevMap) {
    if (!currMap.has(key)) {
      removedTests.push({
        name: prev.name,
        suite: prev.suite,
        status: prev.status,
        duration: prev.duration,
      });
    }
  }

  const hasChanges = newTests.length > 0 || removedTests.length > 0 || statusChanged.length > 0;

  return { newTests, removedTests, statusChanged, hasChanges };
}

export function computeDelta(previous: HistoryEntry, current: HistoryEntry): DeltaComparison {
  const prevMap = new Map<string, HistoryEntry['tests']>();
  for (const t of previous.tests) {
    const key = buildTestKey(t.suite, t.name);
    const existing = prevMap.get(key) ?? [];
    existing.push(t);
    prevMap.set(key, existing);
  }

  const currMap = new Map<string, HistoryEntry['tests']>();
  for (const t of current.tests) {
    const key = buildTestKey(t.suite, t.name);
    const existing = currMap.get(key) ?? [];
    existing.push(t);
    currMap.set(key, existing);
  }

  const testsAdded: DeltaTestInfo[] = [];
  const testsRemoved: DeltaTestInfo[] = [];
  const newlyFailing: DeltaTestInfo[] = [];
  const newlyPassing: DeltaTestInfo[] = [];

  // Only compute test-level diffs when both entries have test data
  if (previous.tests.length > 0 && current.tests.length > 0) {
    const allKeys = new Set<string>([...prevMap.keys(), ...currMap.keys()]);

    for (const key of allKeys) {
      const prevTests = prevMap.get(key) ?? [];
      const currTests = currMap.get(key) ?? [];

      const [suite, name] = key.split('::');
      const entry = { name, suite };

      const prevCounts = countStatuses(prevTests);
      const currCounts = countStatuses(currTests);

      // Remove unchanged tests first, then analyze status changes among remaining.
      const remainingPrev = zeroCounts();
      const remainingCurr = zeroCounts();
      for (const status of ['passed', 'failed', 'skipped', 'errored'] as const) {
        const unchanged = Math.min(prevCounts[status], currCounts[status]);
        remainingPrev[status] = prevCounts[status] - unchanged;
        remainingCurr[status] = currCounts[status] - unchanged;
      }

      const remainingPrevFailing = remainingPrev.failed + remainingPrev.errored;
      const remainingCurrFailing = remainingCurr.failed + remainingCurr.errored;

      const becameFailing = Math.min(remainingPrev.passed, remainingCurrFailing);
      const becamePassing = Math.min(remainingPrevFailing, remainingCurr.passed);

      pushRepeated(newlyFailing, entry, becameFailing);
      pushRepeated(newlyPassing, entry, becamePassing);

      const remainingPrevTotal = sumCounts(remainingPrev);
      const remainingCurrTotal = sumCounts(remainingCurr);
      const countAdded = Math.max(0, remainingCurrTotal - remainingPrevTotal);
      const countRemoved = Math.max(0, remainingPrevTotal - remainingCurrTotal);

      pushRepeated(testsAdded, entry, countAdded);
      pushRepeated(testsRemoved, entry, countRemoved);
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
  const EPSILON = 1e-9;
  const metricsChanged =
    Math.abs(passRateDelta) > EPSILON ||
    Math.abs(durationDelta) > EPSILON ||
    Math.abs(durationDeltaPercent) > EPSILON;

  const hasChanges =
    testsAdded.length > 0 ||
    testsRemoved.length > 0 ||
    newlyFailing.length > 0 ||
    newlyPassing.length > 0 ||
    metricsChanged;

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
