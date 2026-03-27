import { describe, it, expect } from 'vitest';
import { mergeTestRuns } from '../merge-results';
import type { ParsedTestRun } from '../../types';
import type { FileParseResult } from '../merge-results';

function makeRun(
  overrides: Partial<ParsedTestRun['summary']> & { suiteName?: string; toolName?: string } = {},
): ParsedTestRun {
  const { suiteName = 'default-suite', toolName, ...summaryOverrides } = overrides;
  const summary = {
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    errored: 0,
    duration: 1.0,
    ...summaryOverrides,
  };
  return {
    summary,
    suites: [
      {
        name: suiteName,
        duration: summary.duration,
        tests: [
          { name: 'test-pass', suite: suiteName, status: 'passed', duration: 0.5 },
          {
            name: 'test-fail',
            suite: suiteName,
            status: 'failed',
            duration: 0.5,
            errorMessage: 'fail',
          },
        ],
      },
    ],
    toolName,
  };
}

describe('mergeTestRuns', () => {
  it('returns the single run unchanged when given one file', () => {
    const single: FileParseResult = { filePath: '/a.xml', parsed: makeRun() };
    const result = mergeTestRuns([single]);
    expect(result).toBe(single.parsed);
  });

  it('merges summary totals from multiple runs', () => {
    const runs: FileParseResult[] = [
      { filePath: '/a.xml', parsed: makeRun({ suiteName: 'suite-a', duration: 1.0 }) },
      { filePath: '/b.xml', parsed: makeRun({ suiteName: 'suite-b', duration: 2.0 }) },
    ];
    const result = mergeTestRuns(runs);

    expect(result.summary.total).toBe(4);
    expect(result.summary.passed).toBe(2);
    expect(result.summary.failed).toBe(2);
    expect(result.summary.duration).toBe(3.0);
  });

  it('concatenates suites from all runs', () => {
    const runs: FileParseResult[] = [
      { filePath: '/a.xml', parsed: makeRun({ suiteName: 'suite-a' }) },
      { filePath: '/b.xml', parsed: makeRun({ suiteName: 'suite-b' }) },
    ];
    const result = mergeTestRuns(runs);

    expect(result.suites).toHaveLength(2);
    expect(result.suites[0].name).toBe('suite-a');
    expect(result.suites[1].name).toBe('suite-b');
  });

  it('renames generic suite to filename when single suite matches toolName', () => {
    const parsed: ParsedTestRun = {
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 0.5 },
      suites: [
        {
          name: 'vitest',
          duration: 0.5,
          tests: [{ name: 'test1', suite: 'vitest', status: 'passed', duration: 0.5 }],
        },
      ],
      toolName: 'vitest',
    };
    const runs: FileParseResult[] = [
      { filePath: '/reports/api-tests.json', parsed },
      { filePath: '/b.xml', parsed: makeRun({ suiteName: 'real-suite' }) },
    ];
    const result = mergeTestRuns(runs);

    expect(result.suites[0].name).toBe('api-tests.json');
    expect(result.suites[1].name).toBe('real-suite');
  });

  it('does not rename suite when name differs from toolName', () => {
    const parsed: ParsedTestRun = {
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0, duration: 0.5 },
      suites: [
        {
          name: 'auth.login',
          duration: 0.5,
          tests: [{ name: 'test1', suite: 'auth.login', status: 'passed', duration: 0.5 }],
        },
      ],
      toolName: 'vitest',
    };
    const runs: FileParseResult[] = [
      { filePath: '/a.json', parsed },
      { filePath: '/b.xml', parsed: makeRun({ suiteName: 'other' }) },
    ];
    const result = mergeTestRuns(runs);
    expect(result.suites[0].name).toBe('auth.login');
  });

  it('does not rename when file has multiple suites even if one matches toolName', () => {
    const parsed: ParsedTestRun = {
      summary: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0, duration: 1.0 },
      suites: [
        {
          name: 'vitest',
          duration: 0.5,
          tests: [{ name: 'test1', suite: 'vitest', status: 'passed', duration: 0.5 }],
        },
        {
          name: 'auth',
          duration: 0.5,
          tests: [{ name: 'test2', suite: 'auth', status: 'passed', duration: 0.5 }],
        },
      ],
      toolName: 'vitest',
    };
    const runs: FileParseResult[] = [
      { filePath: '/a.json', parsed },
      { filePath: '/b.xml', parsed: makeRun({ suiteName: 'other' }) },
    ];
    const result = mergeTestRuns(runs);
    expect(result.suites[0].name).toBe('vitest');
  });

  it('preserves toolName from first run', () => {
    const runs: FileParseResult[] = [
      { filePath: '/a.json', parsed: makeRun({ suiteName: 'a', toolName: 'jest' }) },
      { filePath: '/b.xml', parsed: makeRun({ suiteName: 'b', toolName: 'vitest' }) },
    ];
    const result = mergeTestRuns(runs);
    expect(result.toolName).toBe('jest');
  });

  it('counts all status types correctly across merged runs', () => {
    const runA: ParsedTestRun = {
      summary: { total: 2, passed: 1, failed: 0, skipped: 1, errored: 0, duration: 1.0 },
      suites: [
        {
          name: 'a',
          duration: 1.0,
          tests: [
            { name: 't1', suite: 'a', status: 'passed', duration: 0.5 },
            { name: 't2', suite: 'a', status: 'skipped', duration: 0 },
          ],
        },
      ],
    };
    const runB: ParsedTestRun = {
      summary: { total: 2, passed: 0, failed: 1, skipped: 0, errored: 1, duration: 0.5 },
      suites: [
        {
          name: 'b',
          duration: 0.5,
          tests: [
            { name: 't3', suite: 'b', status: 'failed', duration: 0.3 },
            { name: 't4', suite: 'b', status: 'errored', duration: 0.2 },
          ],
        },
      ],
    };
    const result = mergeTestRuns([
      { filePath: '/a.xml', parsed: runA },
      { filePath: '/b.xml', parsed: runB },
    ]);

    expect(result.summary).toEqual({
      total: 4,
      passed: 1,
      failed: 1,
      skipped: 1,
      errored: 1,
      duration: 1.5,
    });
  });
});
