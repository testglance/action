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

  it('shows "... and N more" when more than 10 failed tests', async () => {
    const tests = Array.from({ length: 15 }, (_, i) => ({
      name: `test-${i}`,
      suite: 'suite1',
      status: 'failed' as const,
      duration: 0.1,
      errorMessage: `error ${i}`,
    }));
    const parsed = makeParsed({ failed: 15 }, [{ name: 'suite1', duration: 1.0, tests }]);

    await generateSummary({ parsed, apiSuccess: true });

    expect(mockSummary.addRaw).toHaveBeenCalledWith('... and 5 more failed tests\n\n');
    const tableCall = mockSummary.addTable.mock.calls[1];
    expect(tableCall[0].length).toBe(11); // 1 header + 10 data rows
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
