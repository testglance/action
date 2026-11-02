import { basename } from 'node:path';

const PATH_HEURISTICS: [RegExp, string][] = [
  [/vitest/i, 'vitest'],
  [/jest/i, 'jest'],
  [/pytest/i, 'pytest'],
  [/surefire/i, 'maven-surefire'],
];

// Absolute paths include the repo name, so these only look at the report's own file name.
const FILE_NAME_HEURISTICS: [RegExp, string][] = [
  [/swift-testing/i, 'swift-testing'],
  [/xctest/i, 'xctest'],
];

export function detectFramework(
  reportPath: string,
  format: 'junit' | 'ctrf' | null,
  ctrfToolName?: string,
): string | undefined {
  if (format === 'ctrf' && ctrfToolName) {
    return ctrfToolName;
  }

  for (const [pattern, framework] of PATH_HEURISTICS) {
    if (pattern.test(reportPath)) {
      return framework;
    }
  }

  for (const [pattern, framework] of FILE_NAME_HEURISTICS) {
    if (pattern.test(basename(reportPath))) {
      return framework;
    }
  }

  return undefined;
}
