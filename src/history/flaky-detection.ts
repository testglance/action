import type { HistoryEntry, FlakyTestInfo, FlakyDetectionResult } from './types';
import { buildTestKey } from './comparison';

type TestStatus = 'passed' | 'failed' | 'skipped' | 'errored';

export function detectFlakyTests(
  entries: HistoryEntry[],
  threshold: number = 2,
  windowSize: number = 10,
): FlakyDetectionResult {
  const window = entries.slice(-windowSize);

  const testStatuses = new Map<
    string,
    { suite: string; name: string; statuses: (TestStatus | null)[] }
  >();

  for (let i = 0; i < window.length; i++) {
    const entry = window[i];
    const seen = new Set<string>();

    for (const test of entry.tests) {
      const key = buildTestKey(test.suite, test.name);
      seen.add(key);

      let record = testStatuses.get(key);
      if (!record) {
        record = { suite: test.suite, name: test.name, statuses: new Array(i).fill(null) };
        testStatuses.set(key, record);
      }
      record.statuses.push(test.status);
    }

    for (const [key, record] of testStatuses) {
      if (!seen.has(key) && record.statuses.length === i) {
        record.statuses.push(null);
      }
    }
  }

  const flakyTests: FlakyTestInfo[] = [];

  for (const [, record] of testStatuses) {
    const relevant = record.statuses.filter((s): s is TestStatus => s !== null && s !== 'skipped');

    if (relevant.length < 2) continue;

    let flipCount = 0;
    for (let i = 1; i < relevant.length; i++) {
      const prev = relevant[i - 1];
      const curr = relevant[i];
      const prevFailing = prev === 'failed' || prev === 'errored';
      const currFailing = curr === 'failed' || curr === 'errored';
      const prevPassing = prev === 'passed';
      const currPassing = curr === 'passed';

      if ((prevPassing && currFailing) || (prevFailing && currPassing)) {
        flipCount++;
      }
    }

    if (flipCount < threshold) continue;

    const flakyRate = (flipCount / (relevant.length - 1)) * 100;

    const recentStatuses: TestStatus[] = record.statuses
      .map((s) => s ?? 'skipped')
      .slice(-windowSize) as TestStatus[];

    flakyTests.push({
      name: record.name,
      suite: record.suite,
      flakyRate,
      flipCount,
      recentStatuses,
    });
  }

  flakyTests.sort((a, b) => {
    if (b.flakyRate !== a.flakyRate) return b.flakyRate - a.flakyRate;
    return b.flipCount - a.flipCount;
  });

  return {
    flakyTests,
    hasFlakyTests: flakyTests.length > 0,
  };
}
