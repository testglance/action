import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedTestRun } from '../../types';

const mockSummary = vi.hoisted(() => ({
  addHeading: vi.fn().mockReturnThis(),
  addTable: vi.fn().mockReturnThis(),
  addRaw: vi.fn().mockReturnThis(),
  addLink: vi.fn().mockReturnThis(),
  write: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@actions/core', () => ({
  summary: mockSummary,
}));

import {
  generateSummary,
  formatDuration,
  truncate,
  collectFailedTests,
  renderHighlights,
  renderSuiteBreakdown,
} from '../summary';
import type { Highlight } from '../../types';

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
    suites,
  };
}

describe('generateSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('outputs heading and summary table with correct counts and pass rate', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true });

    expect(mockSummary.addHeading).toHaveBeenCalledWith('TestGlance Results', 2);
    expect(mockSummary.addTable).toHaveBeenCalledWith([
      [
        { data: 'Metric', header: true },
        { data: 'Value', header: true },
      ],
      ['Total', '142'],
      ['Passed', '138'],
      ['Failed', '3'],
      ['Skipped', '1'],
      ['Errored', '0'],
      ['Pass Rate', '97.2%'],
      ['Duration', '12.3s'],
    ]);
  });

  it('shows health score when API succeeds with a score', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true, healthScore: 94 });

    expect(mockSummary.addRaw).toHaveBeenCalledWith('**Health Score:** 94/100\n\n');
  });

  it('shows "available after 5 runs" when health score is null', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true, healthScore: null });

    expect(mockSummary.addRaw).toHaveBeenCalledWith('**Health Score:** available after 5 runs\n\n');
  });

  it('shows "available after 5 runs" when health score is undefined and API succeeded', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true });

    expect(mockSummary.addRaw).toHaveBeenCalledWith('**Health Score:** available after 5 runs\n\n');
  });

  it('shows API failure note when apiSuccess is false', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: false });

    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      '> **Note:** API submission failed — dashboard data not updated.\n\n',
    );
  });

  it('does not show health score section when API failed', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: false });

    const healthCalls = mockSummary.addRaw.mock.calls.filter((c: string[]) =>
      c[0].includes('Health Score'),
    );
    expect(healthCalls).toHaveLength(0);
  });

  it('shows flaky count when greater than 0', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true, flakyCount: 5 });

    expect(mockSummary.addRaw).toHaveBeenCalledWith('**Flaky tests detected:** 5\n\n');
  });

  it('omits flaky section when count is 0', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true, flakyCount: 0 });

    const flakyCalls = mockSummary.addRaw.mock.calls.filter((c: string[]) =>
      c[0].includes('Flaky'),
    );
    expect(flakyCalls).toHaveLength(0);
  });

  it('omits flaky section when count is undefined', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true });

    const flakyCalls = mockSummary.addRaw.mock.calls.filter((c: string[]) =>
      c[0].includes('Flaky'),
    );
    expect(flakyCalls).toHaveLength(0);
  });

  it('shows failed test details with suite, name, and error', async () => {
    const parsed = makeParsed({ failed: 1 }, [
      {
        name: 'auth.login',
        duration: 1.0,
        tests: [
          {
            name: 'should reject expired token',
            suite: 'auth.login',
            status: 'failed',
            duration: 0.5,
            errorMessage: 'Expected 401 but received 200',
          },
          { name: 'should login ok', suite: 'auth.login', status: 'passed', duration: 0.3 },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    expect(mockSummary.addHeading).toHaveBeenCalledWith('Failed Tests', 3);
    const tableCall = mockSummary.addTable.mock.calls[1];
    expect(tableCall[0]).toEqual([
      [
        { data: 'Suite', header: true },
        { data: 'Test', header: true },
        { data: 'Error', header: true },
      ],
      ['auth.login', 'should reject expired token', 'Expected 401 but received 200'],
    ]);
  });

  it('truncates error messages longer than 200 characters', async () => {
    const longError = 'A'.repeat(250);
    const parsed = makeParsed({ failed: 1 }, [
      {
        name: 'suite1',
        duration: 1.0,
        tests: [
          {
            name: 'test1',
            suite: 'suite1',
            status: 'failed',
            duration: 0.1,
            errorMessage: longError,
          },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const tableCall = mockSummary.addTable.mock.calls[1];
    const errorCell = tableCall[0][1][2];
    expect(errorCell.length).toBe(200);
    expect(errorCell.endsWith('...')).toBe(true);
  });

  it('shows "... and N more" when more than 25 failed tests', async () => {
    const tests = Array.from({ length: 30 }, (_, i) => ({
      name: `test-${i}`,
      suite: 'suite1',
      status: 'failed' as const,
      duration: 0.1,
      errorMessage: `error ${i}`,
    }));
    const parsed = makeParsed({ failed: 30 }, [{ name: 'suite1', duration: 1.0, tests }]);

    await generateSummary({ parsed, apiSuccess: true });

    expect(mockSummary.addRaw).toHaveBeenCalledWith(expect.stringContaining('and 5 more'));
  });

  it('sorts failed tests by suite name', async () => {
    const parsed = makeParsed({ failed: 3 }, [
      {
        name: 'z-suite',
        duration: 1.0,
        tests: [
          {
            name: 'test-z',
            suite: 'z-suite',
            status: 'failed',
            duration: 0.1,
            errorMessage: 'err',
          },
        ],
      },
      {
        name: 'a-suite',
        duration: 1.0,
        tests: [
          {
            name: 'test-a',
            suite: 'a-suite',
            status: 'failed',
            duration: 0.1,
            errorMessage: 'err',
          },
        ],
      },
      {
        name: 'm-suite',
        duration: 1.0,
        tests: [
          {
            name: 'test-m',
            suite: 'm-suite',
            status: 'failed',
            duration: 0.1,
            errorMessage: 'err',
          },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const tableCall = mockSummary.addTable.mock.calls.find(
      (c: unknown[][]) => c[0][0]?.[0]?.data === 'Suite' && c[0][0]?.[1]?.data === 'Test',
    );
    expect(tableCall).toBeDefined();
    const suiteOrder = tableCall![0].slice(1).map((row: string[]) => row[0]);
    expect(suiteOrder).toEqual(['a-suite', 'm-suite', 'z-suite']);
  });

  it('renders stack traces in details/summary collapse', async () => {
    const parsed = makeParsed({ failed: 1 }, [
      {
        name: 'auth.test',
        duration: 1.0,
        tests: [
          {
            name: 'should reject expired token',
            suite: 'auth.test',
            status: 'failed',
            duration: 0.5,
            errorMessage: 'Expected 401',
            stackTrace: 'Error: Expected 401\n    at Object.<anonymous> (auth.test.ts:23:5)',
          },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const rawCalls = mockSummary.addRaw.mock.calls.map((c: string[]) => c[0]);
    const detailsCall = rawCalls.find((c: string) => c.includes('<details>'));
    expect(detailsCall).toBeDefined();
    expect(detailsCall).toContain('should reject expired token');
    expect(detailsCall).toContain('auth.test.ts:23:5');
  });

  it('escapes HTML in stack trace summary test name', async () => {
    const parsed = makeParsed({ failed: 1 }, [
      {
        name: 'suite1',
        duration: 1.0,
        tests: [
          {
            name: '<img src=x onerror=alert(1)> & "x" \'y\'',
            suite: 'suite1',
            status: 'failed',
            duration: 0.1,
            errorMessage: 'err',
            stackTrace: 'Error: boom\n    at suite1.ts:1:1',
          },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const rawCalls = mockSummary.addRaw.mock.calls.map((c: string[]) => c[0]);
    const detailsCall = rawCalls.find((c: string) => c.includes('<details>'));
    expect(detailsCall).toBeDefined();
    expect(detailsCall).toContain(
      'Stack trace: &lt;img src=x onerror=alert(1)&gt; &amp; &quot;x&quot; &#39;y&#39;',
    );
    expect(detailsCall).not.toContain('Stack trace: <img src=x onerror=alert(1)>');
  });

  it('truncates stack traces longer than 30 lines', async () => {
    const longTrace = Array.from({ length: 50 }, (_, i) => `    at line${i} (file.ts:${i}:1)`).join(
      '\n',
    );
    const parsed = makeParsed({ failed: 1 }, [
      {
        name: 'suite1',
        duration: 1.0,
        tests: [
          {
            name: 'test1',
            suite: 'suite1',
            status: 'failed',
            duration: 0.1,
            errorMessage: 'err',
            stackTrace: longTrace,
          },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const rawCalls = mockSummary.addRaw.mock.calls.map((c: string[]) => c[0]);
    const detailsCall = rawCalls.find((c: string) => c.includes('<details>'));
    expect(detailsCall).toBeDefined();
    const traceLines = detailsCall!.split('\n').filter((l: string) => l.includes('at line'));
    expect(traceLines.length).toBe(30);
    expect(detailsCall).toContain('... 20 more lines truncated');
  });

  it('omits failed test section when no tests failed', async () => {
    const parsed = makeParsed({ failed: 0 }, [
      {
        name: 'suite1',
        duration: 1.0,
        tests: [{ name: 'test1', suite: 'suite1', status: 'passed', duration: 0.1 }],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const failedHeading = mockSummary.addHeading.mock.calls.filter(
      (c: unknown[]) => c[0] === 'Failed Tests',
    );
    expect(failedHeading).toHaveLength(0);
  });

  it('renders dashboard link when available', async () => {
    await generateSummary({
      parsed: makeParsed(),
      apiSuccess: true,
      dashboardUrl: 'https://www.testglance.dev/projects/my-project',
    });

    expect(mockSummary.addLink).toHaveBeenCalledWith(
      'View Dashboard',
      'https://www.testglance.dev/projects/my-project',
    );
  });

  it('does not render dashboard link when not available', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true });

    expect(mockSummary.addLink).not.toHaveBeenCalled();
  });

  it('calls core.summary.write() exactly once', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true });

    expect(mockSummary.write).toHaveBeenCalledTimes(1);
  });

  it('handles 0 total tests with 0.0% pass rate', async () => {
    await generateSummary({
      parsed: makeParsed({ total: 0, passed: 0, failed: 0, skipped: 0, errored: 0 }),
      apiSuccess: true,
    });

    const tableCall = mockSummary.addTable.mock.calls[0];
    const passRateRow = tableCall[0].find((row: string[]) => row[0] === 'Pass Rate');
    expect(passRateRow[1]).toBe('0.0%');
  });

  it('uses "No error message" when errorMessage is undefined', async () => {
    const parsed = makeParsed({ failed: 1 }, [
      {
        name: 'suite1',
        duration: 1.0,
        tests: [{ name: 'test1', suite: 'suite1', status: 'failed', duration: 0.1 }],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const tableCall = mockSummary.addTable.mock.calls[1];
    expect(tableCall[0][1][2]).toBe('No error message');
  });
});

describe('renderHighlights', () => {
  it('renders new_failures with test names and NEW FAILURES label', () => {
    const highlights: Highlight[] = [
      {
        type: 'new_failures',
        severity: 'critical',
        message: '2 tests failed',
        data: {
          tests: [
            { name: 'loginTest', suite: 'auth' },
            { name: 'signupTest', suite: 'auth' },
          ],
        },
      },
    ];
    const result = renderHighlights(highlights);
    expect(result).toContain('🔴');
    expect(result).toContain('**NEW FAILURES:**');
    expect(result).toContain('loginTest');
    expect(result).toContain('signupTest');
  });

  it('renders health_score_delta with arrow', () => {
    const highlights: Highlight[] = [
      {
        type: 'health_score_delta',
        severity: 'warning',
        message: 'score dropped',
        data: { previous: 94, current: 91, direction: 'down' },
      },
    ];
    const result = renderHighlights(highlights);
    expect(result).toContain('🟡');
    expect(result).toContain('94 → 91 ▼');
  });

  it('renders duration_delta with percentage', () => {
    const highlights: Highlight[] = [
      {
        type: 'duration_delta',
        severity: 'warning',
        message: 'duration up',
        data: { currentDuration: 11.5, baselineMedian: 9.8, deltaPercent: 17 },
      },
    ];
    const result = renderHighlights(highlights);
    expect(result).toContain('🟡');
    expect(result).toContain('11.5s');
    expect(result).toContain('+17% vs baseline');
  });

  it('renders fixed_tests with count', () => {
    const highlights: Highlight[] = [
      {
        type: 'fixed_tests',
        severity: 'info',
        message: '3 fixed',
        data: {
          tests: [
            { name: 'a', suite: 's' },
            { name: 'b', suite: 's' },
            { name: 'c', suite: 's' },
          ],
        },
      },
    ];
    const result = renderHighlights(highlights);
    expect(result).toContain('🔵');
    expect(result).toContain('3 test(s) now passing');
  });

  it('renders new_tests with count', () => {
    const highlights: Highlight[] = [
      { type: 'new_tests', severity: 'info', message: '5 new', data: { tests: [], count: 5 } },
    ];
    const result = renderHighlights(highlights);
    expect(result).toContain('5 new test(s) added');
  });

  it('renders known_flaky with count', () => {
    const highlights: Highlight[] = [
      {
        type: 'known_flaky',
        severity: 'warning',
        message: '2 flaky',
        data: {
          tests: [
            { name: 'a', suite: 's', flakyRate: 0.3 },
            { name: 'b', suite: 's', flakyRate: 0.1 },
          ],
        },
      },
    ];
    const result = renderHighlights(highlights);
    expect(result).toContain('2 known flaky test(s)');
  });

  it('sorts by severity: critical first, then warning, then info', () => {
    const highlights: Highlight[] = [
      {
        type: 'fixed_tests',
        severity: 'info',
        message: '',
        data: { tests: [{ name: 'a', suite: 's' }] },
      },
      {
        type: 'new_failures',
        severity: 'critical',
        message: '',
        data: { tests: [{ name: 'b', suite: 's' }] },
      },
      {
        type: 'duration_delta',
        severity: 'warning',
        message: '',
        data: { currentDuration: 10, baselineMedian: 8, deltaPercent: 25 },
      },
    ];
    const result = renderHighlights(highlights);
    const criticalPos = result.indexOf('🔴');
    const warningPos = result.indexOf('🟡');
    const infoPos = result.indexOf('🔵');
    expect(criticalPos).toBeLessThan(warningPos);
    expect(warningPos).toBeLessThan(infoPos);
  });

  it('caps at 3 highlights and shows overflow link', () => {
    const highlights: Highlight[] = [
      {
        type: 'new_failures',
        severity: 'critical',
        message: '',
        data: { tests: [{ name: 'a', suite: 's' }] },
      },
      {
        type: 'duration_delta',
        severity: 'warning',
        message: '',
        data: { currentDuration: 10, baselineMedian: 8, deltaPercent: 25 },
      },
      {
        type: 'known_flaky',
        severity: 'warning',
        message: '',
        data: { tests: [{ name: 'b', suite: 's', flakyRate: 0.2 }] },
      },
      {
        type: 'fixed_tests',
        severity: 'info',
        message: '',
        data: { tests: [{ name: 'c', suite: 's' }] },
      },
    ];
    const result = renderHighlights(highlights, 'https://www.testglance.dev/runs/run123');
    const lines = result
      .split('\n')
      .filter((l) => l.startsWith('🔴') || l.startsWith('🟡') || l.startsWith('🔵'));
    expect(lines).toHaveLength(3);
    expect(result).toContain('View all highlights on dashboard');
    expect(result).toContain('https://www.testglance.dev/runs/run123');
  });

  it('does not show overflow link when exactly 3 highlights', () => {
    const highlights: Highlight[] = [
      {
        type: 'new_failures',
        severity: 'critical',
        message: '',
        data: { tests: [{ name: 'a', suite: 's' }] },
      },
      {
        type: 'duration_delta',
        severity: 'warning',
        message: '',
        data: { currentDuration: 10, baselineMedian: 8, deltaPercent: 25 },
      },
      {
        type: 'fixed_tests',
        severity: 'info',
        message: '',
        data: { tests: [{ name: 'c', suite: 's' }] },
      },
    ];
    const result = renderHighlights(highlights, 'https://www.testglance.dev/runs/run123');
    expect(result).not.toContain('View all highlights on dashboard');
  });

  it('does not show overflow link when no dashboardUrl', () => {
    const highlights: Highlight[] = [
      {
        type: 'new_failures',
        severity: 'critical',
        message: '',
        data: { tests: [{ name: 'a', suite: 's' }] },
      },
      {
        type: 'duration_delta',
        severity: 'warning',
        message: '',
        data: { currentDuration: 10, baselineMedian: 8, deltaPercent: 25 },
      },
      {
        type: 'known_flaky',
        severity: 'warning',
        message: '',
        data: { tests: [{ name: 'b', suite: 's', flakyRate: 0.2 }] },
      },
      {
        type: 'fixed_tests',
        severity: 'info',
        message: '',
        data: { tests: [{ name: 'c', suite: 's' }] },
      },
    ];
    const result = renderHighlights(highlights);
    expect(result).not.toContain('View all highlights on dashboard');
  });

  it('limits new_failures test names to 3 with overflow count', () => {
    const tests = [
      { name: 'a', suite: 's' },
      { name: 'b', suite: 's' },
      { name: 'c', suite: 's' },
      { name: 'd', suite: 's' },
      { name: 'e', suite: 's' },
    ];
    const highlights: Highlight[] = [
      { type: 'new_failures', severity: 'critical', message: '', data: { tests } },
    ];
    const result = renderHighlights(highlights);
    expect(result).toContain('a, b, c');
    expect(result).toContain('+2 more');
    expect(result).not.toContain('d');
  });
});

describe('generateSummary slowest tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders slowest tests section sorted by duration descending', async () => {
    const parsed = makeParsed({ total: 4, passed: 4, failed: 0 }, [
      {
        name: 'suite1',
        duration: 5.0,
        tests: [
          { name: 'fast-test', suite: 'suite1', status: 'passed', duration: 0.1 },
          { name: 'slow-test', suite: 'suite1', status: 'passed', duration: 3.5 },
          { name: 'medium-test', suite: 'suite1', status: 'passed', duration: 1.2 },
          { name: 'quick-test', suite: 'suite1', status: 'passed', duration: 0.3 },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true, slowestTests: 3 });

    const headingCalls = mockSummary.addHeading.mock.calls;
    expect(headingCalls).toContainEqual(['Slowest Tests', 3]);

    const tableCall = mockSummary.addTable.mock.calls.find(
      (c: unknown[][]) => c[0][0]?.[0]?.data === 'Test',
    );
    expect(tableCall).toBeDefined();
    const rows = tableCall![0].slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0][0]).toBe('slow-test');
    expect(rows[1][0]).toBe('medium-test');
    expect(rows[2][0]).toBe('quick-test');
  });

  it('skips slowest tests section when slowestTests is 0', async () => {
    const parsed = makeParsed({ total: 2, passed: 2, failed: 0 }, [
      {
        name: 'suite1',
        duration: 2.0,
        tests: [
          { name: 'test1', suite: 'suite1', status: 'passed', duration: 1.0 },
          { name: 'test2', suite: 'suite1', status: 'passed', duration: 1.0 },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true, slowestTests: 0 });

    const headingCalls = mockSummary.addHeading.mock.calls;
    const slowestHeading = headingCalls.filter((c: unknown[]) => c[0] === 'Slowest Tests');
    expect(slowestHeading).toHaveLength(0);
  });

  it('skips slowest tests section when slowestTests is undefined', async () => {
    const parsed = makeParsed({ total: 2, passed: 2, failed: 0 }, [
      {
        name: 'suite1',
        duration: 2.0,
        tests: [
          { name: 'test1', suite: 'suite1', status: 'passed', duration: 1.0 },
          { name: 'test2', suite: 'suite1', status: 'passed', duration: 1.0 },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const headingCalls = mockSummary.addHeading.mock.calls;
    const slowestHeading = headingCalls.filter((c: unknown[]) => c[0] === 'Slowest Tests');
    expect(slowestHeading).toHaveLength(0);
  });

  it('excludes tests under 0.2s and hides section if none qualify', async () => {
    const parsed = makeParsed({ total: 3, passed: 3, failed: 0 }, [
      {
        name: 'suite1',
        duration: 0.3,
        tests: [
          { name: 'fast-a', suite: 'suite1', status: 'passed', duration: 0.1 },
          { name: 'fast-b', suite: 'suite1', status: 'passed', duration: 0.15 },
          { name: 'zero', suite: 'suite1', status: 'passed', duration: 0 },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true, slowestTests: 10 });

    const headingCalls = mockSummary.addHeading.mock.calls;
    const slowestHeading = headingCalls.filter((c: unknown[]) => c[0] === 'Slowest Tests');
    expect(slowestHeading).toHaveLength(0);
  });

  it('only includes tests with duration >= 0.2s', async () => {
    const parsed = makeParsed({ total: 3, passed: 3, failed: 0 }, [
      {
        name: 'suite1',
        duration: 2.0,
        tests: [
          { name: 'has-time', suite: 'suite1', status: 'passed', duration: 1.5 },
          { name: 'too-fast', suite: 'suite1', status: 'passed', duration: 0.1 },
          { name: 'also-time', suite: 'suite1', status: 'passed', duration: 0.5 },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true, slowestTests: 10 });

    const tableCall = mockSummary.addTable.mock.calls.find(
      (c: unknown[][]) => c[0][0]?.[0]?.data === 'Test',
    );
    expect(tableCall).toBeDefined();
    const rows = tableCall![0].slice(1);
    expect(rows).toHaveLength(2);
  });

  it('includes formatted duration in table', async () => {
    const parsed = makeParsed({ total: 1, passed: 1, failed: 0 }, [
      {
        name: 'suite1',
        duration: 2.0,
        tests: [{ name: 'slow-test', suite: 'suite1', status: 'passed', duration: 65.3 }],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true, slowestTests: 5 });

    const tableCall = mockSummary.addTable.mock.calls.find(
      (c: unknown[][]) => c[0][0]?.[0]?.data === 'Test',
    );
    expect(tableCall).toBeDefined();
    expect(tableCall![0][1][2]).toBe('1m 5.3s');
  });
});

describe('generateSummary with highlights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders highlights section when highlights are provided', async () => {
    const highlights: Highlight[] = [
      {
        type: 'new_failures',
        severity: 'critical',
        message: '1 test failed',
        data: { tests: [{ name: 'test1', suite: 'suite1' }] },
      },
    ];
    await generateSummary({ parsed: makeParsed(), apiSuccess: true, highlights });

    const highlightCalls = mockSummary.addRaw.mock.calls.filter((c: string[]) =>
      c[0].includes('Highlights'),
    );
    expect(highlightCalls).toHaveLength(1);
  });

  it('does not render highlights section when highlights is empty', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true, highlights: [] });

    const highlightCalls = mockSummary.addRaw.mock.calls.filter((c: string[]) =>
      c[0].includes('Highlights'),
    );
    expect(highlightCalls).toHaveLength(0);
  });

  it('does not render highlights section when highlights is undefined', async () => {
    await generateSummary({ parsed: makeParsed(), apiSuccess: true });

    const highlightCalls = mockSummary.addRaw.mock.calls.filter((c: string[]) =>
      c[0].includes('Highlights'),
    );
    expect(highlightCalls).toHaveLength(0);
  });
});

describe('generateSummary fallback on error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back gracefully when stack trace rendering throws', async () => {
    const parsed = makeParsed({ failed: 1 }, [
      {
        name: 'suite1',
        duration: 1.0,
        tests: [
          {
            name: 'test1',
            suite: 'suite1',
            status: 'failed',
            duration: 0.1,
            errorMessage: 'err',
            stackTrace: null as unknown as string,
          },
        ],
      },
    ]);

    await expect(
      generateSummary({ parsed, apiSuccess: true, slowestTests: 5 }),
    ).resolves.not.toThrow();
    expect(mockSummary.write).toHaveBeenCalledTimes(1);
  });
});

describe('renderSuiteBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders collapsible details with suite stats sorted by pass rate ascending', () => {
    renderSuiteBreakdown([
      {
        name: 'auth.test.ts',
        duration: 1.2,
        tests: [
          { name: 't1', suite: 'auth.test.ts', status: 'passed', duration: 0.4 },
          { name: 't2', suite: 'auth.test.ts', status: 'failed', duration: 0.8 },
        ],
      },
      {
        name: 'api.test.ts',
        duration: 0.8,
        tests: [
          { name: 't3', suite: 'api.test.ts', status: 'passed', duration: 0.3 },
          { name: 't4', suite: 'api.test.ts', status: 'passed', duration: 0.5 },
        ],
      },
    ]);

    const html = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(html).toContain('<details>');
    expect(html).toContain('<strong>Suite Breakdown</strong> (2 suites)');
    const authIdx = html.indexOf('auth.test.ts');
    const apiIdx = html.indexOf('api.test.ts');
    expect(authIdx).toBeLessThan(apiIdx);
    expect(html).toContain('50.0%');
    expect(html).toContain('100.0%');
  });

  it('places zero-test suites at the bottom', () => {
    renderSuiteBreakdown([
      {
        name: 'empty-suite',
        duration: 0,
        tests: [],
      },
      {
        name: 'real-suite',
        duration: 1.0,
        tests: [{ name: 't1', suite: 'real-suite', status: 'passed', duration: 1.0 }],
      },
    ]);

    const html = mockSummary.addRaw.mock.calls[0][0] as string;
    const realIdx = html.indexOf('real-suite');
    const emptyIdx = html.indexOf('empty-suite');
    expect(realIdx).toBeLessThan(emptyIdx);
    expect(html).toContain('N/A');
  });

  it('counts all status types correctly', () => {
    renderSuiteBreakdown([
      {
        name: 'mixed',
        duration: 2.0,
        tests: [
          { name: 't1', suite: 'mixed', status: 'passed', duration: 0.5 },
          { name: 't2', suite: 'mixed', status: 'failed', duration: 0.5 },
          { name: 't3', suite: 'mixed', status: 'skipped', duration: 0 },
          { name: 't4', suite: 'mixed', status: 'errored', duration: 1.0 },
        ],
      },
    ]);

    const html = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(html).toContain('<td>4</td>');
    expect(html).toContain('<td>1</td><td>2</td><td>1</td>');
    expect(html).toContain('25.0%');
  });

  it('includes formatted duration', () => {
    renderSuiteBreakdown([
      {
        name: 'slow-suite',
        duration: 75.3,
        tests: [{ name: 't1', suite: 'slow-suite', status: 'passed', duration: 75.3 }],
      },
    ]);

    const html = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(html).toContain('1m 15.3s');
  });

  it('escapes HTML in suite names', () => {
    renderSuiteBreakdown([
      {
        name: '<script>alert("xss")</script>',
        duration: 1.0,
        tests: [{ name: 't1', suite: 'x', status: 'passed', duration: 1.0 }],
      },
    ]);

    const html = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('generateSummary suite breakdown integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders suite breakdown when multiple suites exist', async () => {
    const parsed = makeParsed({ total: 4, passed: 4, failed: 0 }, [
      {
        name: 'suite-a',
        duration: 1.0,
        tests: [
          { name: 't1', suite: 'suite-a', status: 'passed', duration: 0.5 },
          { name: 't2', suite: 'suite-a', status: 'passed', duration: 0.5 },
        ],
      },
      {
        name: 'suite-b',
        duration: 1.0,
        tests: [
          { name: 't3', suite: 'suite-b', status: 'passed', duration: 0.5 },
          { name: 't4', suite: 'suite-b', status: 'passed', duration: 0.5 },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const breakdownCall = mockSummary.addRaw.mock.calls.find((c: string[]) =>
      c[0].includes('Suite Breakdown'),
    );
    expect(breakdownCall).toBeDefined();
    expect(breakdownCall![0]).toContain('<details>');
  });

  it('skips suite breakdown for single-suite reports', async () => {
    const parsed = makeParsed({ total: 2, passed: 2, failed: 0 }, [
      {
        name: 'only-suite',
        duration: 1.0,
        tests: [
          { name: 't1', suite: 'only-suite', status: 'passed', duration: 0.5 },
          { name: 't2', suite: 'only-suite', status: 'passed', duration: 0.5 },
        ],
      },
    ]);

    await generateSummary({ parsed, apiSuccess: true });

    const breakdownCall = mockSummary.addRaw.mock.calls.find((c: string[]) =>
      c[0].includes('Suite Breakdown'),
    );
    expect(breakdownCall).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('formats 0 seconds', () => {
    expect(formatDuration(0)).toBe('0.0s');
  });

  it('formats seconds with one decimal', () => {
    expect(formatDuration(12.345)).toBe('12.3s');
  });

  it('formats 59.9 seconds', () => {
    expect(formatDuration(59.9)).toBe('59.9s');
  });

  it('formats exactly 60 seconds as minutes', () => {
    expect(formatDuration(60)).toBe('1m 0.0s');
  });

  it('formats 125.7 seconds as minutes and seconds', () => {
    expect(formatDuration(125.7)).toBe('2m 5.7s');
  });
});

describe('truncate', () => {
  it('returns short string unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns string at exactly limit unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates over-limit string with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });
});

describe('collectFailedTests', () => {
  it('collects failed and errored tests across suites', () => {
    const parsed = makeParsed({}, [
      {
        name: 'suite1',
        duration: 1.0,
        tests: [
          { name: 'pass1', suite: 'suite1', status: 'passed', duration: 0.1 },
          { name: 'fail1', suite: 'suite1', status: 'failed', duration: 0.1, errorMessage: 'err' },
        ],
      },
      {
        name: 'suite2',
        duration: 1.0,
        tests: [
          { name: 'err1', suite: 'suite2', status: 'errored', duration: 0.1, errorMessage: 'err' },
          { name: 'skip1', suite: 'suite2', status: 'skipped', duration: 0.0 },
        ],
      },
    ]);

    const result = collectFailedTests(parsed);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('fail1');
    expect(result[1].name).toBe('err1');
  });

  it('returns empty array when all tests pass', () => {
    const parsed = makeParsed({}, [
      {
        name: 'suite1',
        duration: 1.0,
        tests: [{ name: 'pass1', suite: 'suite1', status: 'passed', duration: 0.1 }],
      },
    ]);

    expect(collectFailedTests(parsed)).toHaveLength(0);
  });
});
