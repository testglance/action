const PATH_HEURISTICS: [RegExp, string][] = [
  [/vitest/i, 'vitest'],
  [/jest/i, 'jest'],
  [/pytest/i, 'pytest'],
  [/surefire/i, 'maven-surefire'],
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

  return undefined;
}
