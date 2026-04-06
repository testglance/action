import { describe, it, expect } from 'vitest';
import { generateHtmlReport, type HtmlReportOptions } from '../html-report';
import type { ParsedTestRun } from '../../types';
import type {
  DeltaComparison,
  TestsChangedReport,
  FlakyDetectionResult,
  PerfRegressionResult,
  TrendIndicators,
} from '../../history/types';

function makeParsed(
  overrides: Partial<ParsedTestRun['summary']> = {},
  suites: ParsedTestRun['suites'] = [],
): ParsedTestRun {
  return {
    summary: {
      total: 142,
      passed: 138,
      failed: 3,
      skipped: 1,
      errored: 0,
      duration: 12.345,
      ...overrides,
    },
    suites:
      suites.length > 0
        ? suites
        : [
            {
              name: 'default-suite',
              duration: 12.345,
              tests: [
                { name: 'passing-test', suite: 'default-suite', status: 'passed', duration: 1.0 },
                {
                  name: 'failing-test',
                  suite: 'default-suite',
                  status: 'failed',
                  duration: 0.5,
                  errorMessage: 'Expected true to be false',
                  stackTrace:
                    'Error: Expected true to be false\n    at Object.<anonymous> (test.ts:10:5)',
                },
              ],
            },
          ],
  };
}

function makeOptions(overrides: Partial<HtmlReportOptions> = {}): HtmlReportOptions {
  return {
    parsed: makeParsed(),
    apiSuccess: true,
    healthScore: 85,
    commitSha: 'abc1234567890',
    branch: 'feature/test',
    workflowRunUrl: 'https://github.com/owner/repo/actions/runs/12345',
    timestamp: '2026-04-06T12:00:00Z',
    ...overrides,
  };
}

describe('generateHtmlReport', () => {
  describe('basic HTML structure', () => {
    it('returns valid self-contained HTML document', () => {
      const html = generateHtmlReport(makeOptions());

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain('<style>');
      expect(html).toContain('</style>');
      expect(html).toContain('</html>');
    });

    it('has no external resource references', () => {
      const html = generateHtmlReport(makeOptions());

      expect(html).not.toMatch(/href="https?:\/\/.*\.(css|js)/);
      expect(html).not.toMatch(/src="https?:\/\//);
      expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    });

    it('includes viewport meta for responsive rendering', () => {
      const html = generateHtmlReport(makeOptions());
      expect(html).toContain('viewport');
      expect(html).toContain('width=device-width');
    });
  });

  describe('header section', () => {
    it('shows pass rate in title', () => {
      const html = generateHtmlReport(makeOptions());
      expect(html).toContain('<title>TestGlance Report');
      expect(html).toContain('97.2%');
    });

    it('shows fail indicator when tests fail', () => {
      const html = generateHtmlReport(makeOptions({ parsed: makeParsed({ failed: 3 }) }));
      expect(html).toContain('class="fail"');
    });

    it('shows pass indicator when all tests pass', () => {
      const html = generateHtmlReport(makeOptions({ parsed: makeParsed({ failed: 0 }) }));
      expect(html).toContain('class="pass"');
    });

    it('includes progress bar', () => {
      const html = generateHtmlReport(makeOptions());
      expect(html).toContain('progress-bar');
      expect(html).toContain('progress-fill');
    });

    it('includes metrics strip', () => {
      const html = generateHtmlReport(makeOptions());
      expect(html).toContain('138 passed');
      expect(html).toContain('3 failed');
    });

    it('includes health score when available', () => {
      const html = generateHtmlReport(makeOptions({ healthScore: 92 }));
      expect(html).toContain('92/100');
    });

    it('omits health score when not available', () => {
      const html = generateHtmlReport(makeOptions({ healthScore: null, apiSuccess: false }));
      expect(html).not.toContain('/100');
    });
  });

  describe('metadata footer', () => {
    it('includes timestamp', () => {
      const html = generateHtmlReport(makeOptions());
      expect(html).toContain('Generated');
      expect(html).toContain('2026');
    });

    it('includes short commit SHA linked to GitHub', () => {
      const html = generateHtmlReport(makeOptions({ commitSha: 'abc1234567890def' }));
      expect(html).toContain('abc1234');
      expect(html).toContain('/commit/abc1234567890def');
    });

    it('includes branch name', () => {
      const html = generateHtmlReport(makeOptions({ branch: 'main' }));
      expect(html).toContain('main');
    });

    it('includes workflow run link', () => {
      const html = generateHtmlReport(makeOptions());
      expect(html).toContain('Workflow Run');
      expect(html).toContain('actions/runs/12345');
    });
  });

  describe('failed tests section', () => {
    it('renders failed tests with error messages', () => {
      const parsed = makeParsed({ failed: 1 }, [
        {
          name: 'suite-a',
          duration: 1,
          tests: [
            {
              name: 'broken test',
              suite: 'suite-a',
              status: 'failed',
              duration: 0.3,
              errorMessage: 'assertion failed',
            },
          ],
        },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).toContain('Failed Tests');
      expect(html).toContain('broken test');
      expect(html).toContain('assertion failed');
    });

    it('renders collapsible stack traces with <details>', () => {
      const parsed = makeParsed({ failed: 1 }, [
        {
          name: 'suite-a',
          duration: 1,
          tests: [
            {
              name: 'crash test',
              suite: 'suite-a',
              status: 'failed',
              duration: 0.1,
              errorMessage: 'boom',
              stackTrace: 'Error: boom\n    at test.ts:1:1',
            },
          ],
        },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).toContain('<details>');
      expect(html).toContain('Stack trace');
      expect(html).toContain('at test.ts:1:1');
    });

    it('truncates stack traces beyond MAX_STACK_TRACE_LINES', () => {
      const longStack = Array.from(
        { length: 50 },
        (_, i) => `    at line${i} (file.ts:${i}:1)`,
      ).join('\n');
      const parsed = makeParsed({ failed: 1 }, [
        {
          name: 'suite-a',
          duration: 1,
          tests: [
            {
              name: 'deep-stack',
              suite: 'suite-a',
              status: 'failed',
              duration: 0.1,
              errorMessage: 'deep',
              stackTrace: longStack,
            },
          ],
        },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).toContain('more lines truncated');
    });

    it('limits displayed failed tests to MAX_FAILED_TESTS_SHOWN', () => {
      const tests = Array.from({ length: 30 }, (_, i) => ({
        name: `fail-${i}`,
        suite: 'suite',
        status: 'failed' as const,
        duration: 0.1,
        errorMessage: `error-${i}`,
      }));
      const parsed = makeParsed({ failed: 30, passed: 112 }, [
        { name: 'suite', duration: 3, tests },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).toContain('and 5 more failed tests');
    });

    it('omits section when no tests failed', () => {
      const parsed = makeParsed({ failed: 0, passed: 142 }, [
        {
          name: 'suite-a',
          duration: 1,
          tests: [{ name: 't', suite: 'suite-a', status: 'passed', duration: 0.1 }],
        },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).not.toContain('Failed Tests');
    });
  });

  describe('slowest tests section', () => {
    it('renders slowest tests table', () => {
      const parsed = makeParsed({}, [
        {
          name: 'suite',
          duration: 5,
          tests: [
            { name: 'slow-one', suite: 'suite', status: 'passed', duration: 3.5 },
            { name: 'fast-one', suite: 'suite', status: 'passed', duration: 0.1 },
          ],
        },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed, slowestTests: 5 }));
      expect(html).toContain('Slowest Tests');
      expect(html).toContain('slow-one');
    });

    it('omits section when slowestTests is 0', () => {
      const html = generateHtmlReport(makeOptions({ slowestTests: 0 }));
      expect(html).not.toContain('Slowest Tests');
    });
  });

  describe('suite breakdown section', () => {
    it('renders when multiple suites exist', () => {
      const parsed = makeParsed({}, [
        {
          name: 'api',
          duration: 2,
          tests: [{ name: 't1', suite: 'api', status: 'passed', duration: 2 }],
        },
        {
          name: 'ui',
          duration: 3,
          tests: [{ name: 't2', suite: 'ui', status: 'failed', duration: 3, errorMessage: 'e' }],
        },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).toContain('Suite Breakdown');
      expect(html).toContain('api');
      expect(html).toContain('ui');
    });

    it('omits when only one suite', () => {
      const parsed = makeParsed({}, [
        {
          name: 'only-suite',
          duration: 1,
          tests: [{ name: 't', suite: 'only-suite', status: 'passed', duration: 1 }],
        },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).not.toContain('Suite Breakdown');
    });
  });

  describe('highlights section', () => {
    it('renders highlights sorted by severity', () => {
      const highlights = [
        { type: 'new_tests' as const, severity: 'info' as const, message: '', data: { count: 5 } },
        {
          type: 'new_failures' as const,
          severity: 'critical' as const,
          message: '',
          data: { tests: [{ name: 'fail1' }] },
        },
      ];
      const html = generateHtmlReport(makeOptions({ highlights }));
      expect(html).toContain('Highlights');
      expect(html).toContain('NEW FAILURES');
      expect(html).toContain('5 new test(s) added');
    });

    it('omits section when no highlights', () => {
      const html = generateHtmlReport(makeOptions({ highlights: [] }));
      expect(html).not.toContain('Highlights');
    });
  });

  describe('trends section', () => {
    const trends: TrendIndicators = {
      passRate: { direction: 'up', current: 98.5, delta: 1.2, sparkline: '▁▂▃▅▇' },
      duration: {
        direction: 'down',
        current: 10.5,
        delta: -2.0,
        deltaPercent: -16,
        sparkline: '▇▅▃▂▁',
      },
      testCount: { current: 150, delta: 5 },
    };

    it('renders trend data with sparklines', () => {
      const html = generateHtmlReport(makeOptions({ trends }));
      expect(html).toContain('Trends');
      expect(html).toContain('98.5%');
      expect(html).toContain('+1.2%');
    });

    it('omits section when no trends', () => {
      const html = generateHtmlReport(makeOptions({ trends: null }));
      expect(html).not.toContain('Trends');
    });
  });

  describe('delta comparison section', () => {
    const delta: DeltaComparison = {
      testsAdded: [{ name: 'new-test', suite: 'suite', status: 'passed', duration: 0.1 }],
      testsRemoved: [],
      newlyFailing: [{ name: 'broke', suite: 'suite', status: 'failed', duration: 0.5 }],
      newlyPassing: [],
      passRatePrev: 95.0,
      passRateCurr: 97.2,
      passRateDelta: 2.2,
      durationPrev: 10.0,
      durationCurr: 12.3,
      durationDelta: 2.3,
      durationDeltaPercent: 23,
      hasChanges: true,
    };

    it('renders delta with pass rate and duration changes', () => {
      const html = generateHtmlReport(makeOptions({ delta }));
      expect(html).toContain('Changes Since Last Run');
      expect(html).toContain('95.0%');
      expect(html).toContain('97.2%');
    });

    it('renders added and newly failing tests', () => {
      const html = generateHtmlReport(makeOptions({ delta }));
      expect(html).toContain('new-test');
      expect(html).toContain('broke');
    });

    it('omits section when no changes', () => {
      const noDelta: DeltaComparison = { ...delta, hasChanges: false };
      const html = generateHtmlReport(makeOptions({ delta: noDelta }));
      expect(html).not.toContain('Changes Since Last Run');
    });
  });

  describe('tests changed section', () => {
    const testsChanged: TestsChangedReport = {
      newTests: [{ name: 'brand-new', suite: 'suite', status: 'passed', duration: 0.2 }],
      removedTests: [],
      statusChanged: [
        {
          name: 'flipped',
          suite: 'suite',
          status: 'passed',
          duration: 0.1,
          previousStatus: 'failed',
        },
      ],
      hasChanges: true,
    };

    it('renders new tests and status changes', () => {
      const html = generateHtmlReport(makeOptions({ testsChanged }));
      expect(html).toContain('Tests Changed');
      expect(html).toContain('brand-new');
      expect(html).toContain('flipped');
    });

    it('omits section when no changes', () => {
      const html = generateHtmlReport(
        makeOptions({
          testsChanged: { newTests: [], removedTests: [], statusChanged: [], hasChanges: false },
        }),
      );
      expect(html).not.toContain('Tests Changed');
    });
  });

  describe('flaky tests section', () => {
    const flaky: FlakyDetectionResult = {
      flakyTests: [
        {
          name: 'flaky-one',
          suite: 'suite',
          flakyRate: 40,
          flipCount: 4,
          recentStatuses: ['passed', 'failed', 'passed', 'failed', 'passed'],
        },
      ],
      hasFlakyTests: true,
    };

    it('renders flaky test table with timeline', () => {
      const html = generateHtmlReport(makeOptions({ flaky }));
      expect(html).toContain('Flaky Tests');
      expect(html).toContain('flaky-one');
      expect(html).toContain('40%');
    });

    it('omits section when no flaky tests', () => {
      const html = generateHtmlReport(
        makeOptions({ flaky: { flakyTests: [], hasFlakyTests: false } }),
      );
      expect(html).not.toContain('Flaky Tests');
    });
  });

  describe('performance regressions section', () => {
    const perfRegression: PerfRegressionResult = {
      regressions: [
        {
          name: 'slow-test',
          suite: 'suite',
          currentDuration: 5.0,
          medianDuration: 1.0,
          increasePercent: 400,
        },
      ],
      hasRegressions: true,
      sparkline: '▁▂▃▅▇',
    };

    it('renders performance regression table', () => {
      const html = generateHtmlReport(makeOptions({ perfRegression }));
      expect(html).toContain('Performance Regressions');
      expect(html).toContain('slow-test');
      expect(html).toContain('+400%');
    });

    it('omits section when no regressions', () => {
      const html = generateHtmlReport(
        makeOptions({ perfRegression: { regressions: [], hasRegressions: false, sparkline: '' } }),
      );
      expect(html).not.toContain('Performance Regressions');
    });
  });

  describe('XSS safety', () => {
    it('escapes HTML in test names', () => {
      const parsed = makeParsed({ failed: 1 }, [
        {
          name: '<script>alert("xss")</script>',
          duration: 1,
          tests: [
            {
              name: '<img onerror=alert(1)>',
              suite: '<script>alert("xss")</script>',
              status: 'failed',
              duration: 0.1,
              errorMessage: '<b>bad</b>',
            },
          ],
        },
      ]);
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).not.toContain('<script>alert');
      expect(html).not.toContain('<img onerror');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('edge cases', () => {
    it('handles zero tests', () => {
      const parsed = makeParsed(
        { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 0 },
        [],
      );
      const html = generateHtmlReport(makeOptions({ parsed }));
      expect(html).toContain('0.0%');
    });

    it('handles all optional data missing', () => {
      const html = generateHtmlReport(
        makeOptions({
          highlights: undefined,
          delta: null,
          testsChanged: null,
          flaky: null,
          perfRegression: null,
          trends: null,
          healthScore: null,
          dashboardUrl: undefined,
        }),
      );
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).not.toContain('Highlights');
      expect(html).not.toContain('Trends');
    });
  });
});
