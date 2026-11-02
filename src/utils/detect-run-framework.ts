import { detectFormat } from './detect-format';
import { detectFramework } from './detect-framework';
import type { FileParseResult } from './merge-results';

// One label covers the whole merged run, so reports that disagree leave it unlabelled rather than
// mislabel some of its tests. An empty report, like SwiftPM's XCTest file, says nothing either way.
export function detectRunFramework(
  runs: FileParseResult[],
  reportFormat: string,
): string | undefined {
  const runsWithTests = runs.filter((run) => run.parsed.summary.total > 0);
  const labels = (runsWithTests.length > 0 ? runsWithTests : runs).map(({ filePath, parsed }) => {
    const format = reportFormat === 'auto' ? detectFormat(filePath) : reportFormat;
    return detectFramework(
      filePath,
      format === 'junit' || format === 'ctrf' ? format : null,
      parsed.toolName,
    );
  });
  return new Set(labels).size === 1 ? labels[0] : undefined;
}
