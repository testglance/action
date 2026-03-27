import { basename } from 'node:path';
import type { ParsedTestRun, ParsedSuite } from '../types';

export interface FileParseResult {
  filePath: string;
  parsed: ParsedTestRun;
}

export function mergeTestRuns(runs: FileParseResult[]): ParsedTestRun {
  if (runs.length === 1) {
    return runs[0].parsed;
  }

  const allSuites: ParsedSuite[] = [];
  let toolName: string | undefined;

  for (const { filePath, parsed } of runs) {
    toolName ??= parsed.toolName;

    for (const suite of parsed.suites) {
      const isGenericName = parsed.toolName && suite.name === parsed.toolName;
      const isSingleSuite = parsed.suites.length === 1;

      if (isGenericName && isSingleSuite) {
        allSuites.push({ ...suite, name: basename(filePath) });
      } else {
        allSuites.push(suite);
      }
    }
  }

  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errored = 0;
  let duration = 0;

  for (const suite of allSuites) {
    duration += suite.duration;
    for (const test of suite.tests) {
      total++;
      if (test.status === 'passed') passed++;
      else if (test.status === 'failed') failed++;
      else if (test.status === 'skipped') skipped++;
      else if (test.status === 'errored') errored++;
    }
  }

  return {
    summary: { total, passed, failed, skipped, errored, duration },
    suites: allSuites,
    toolName,
  };
}
