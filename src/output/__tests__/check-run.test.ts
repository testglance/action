import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ParsedTestRun } from '../../types';

const mockWarning = vi.fn();
const mockSetFailed = vi.fn();
const mockInfo = vi.fn();
const mockError = vi.fn();
const mockDebug = vi.fn();
const mockSummaryAddRaw = vi.fn();
const mockSummaryWrite = vi.fn();

vi.mock('@actions/core', () => ({
  warning: (...args: unknown[]) => mockWarning(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  info: (...args: unknown[]) => mockInfo(...args),
  error: (...args: unknown[]) => mockError(...args),
  debug: (...args: unknown[]) => mockDebug(...args),
  summary: {
    addRaw: (...args: unknown[]) => mockSummaryAddRaw(...args),
    write: (...args: unknown[]) => mockSummaryWrite(...args),
  },
}));

const mockChecksCreate = vi.fn();

const mockGetOctokit = vi.fn(() => ({
  rest: {
    checks: {
      create: mockChecksCreate,
    },
  },
}));

const mockContext = vi.hoisted(() => ({
  repo: { owner: 'test-owner', repo: 'test-repo' },
  payload: {
    pull_request: { head: { sha: 'pr-sha-abc123' } },
  } as Record<string, unknown>,
  sha: 'push-sha-def456',
}));

vi.mock('@actions/github', () => ({
  getOctokit: (...args: unknown[]) => mockGetOctokit(...args),
  context: mockContext,
}));

import { createCheckRun } from '../check-run';

function makeParsed(overrides: Partial<ParsedTestRun> = {}): ParsedTestRun {
  return {
    summary: { total: 10, passed: 8, failed: 2, skipped: 0, errored: 0, duration: 5.2 },
    suites: [
      {
        name: 'suite1',
        duration: 5.2,
        tests: [
          { name: 'passes', suite: 'suite1', status: 'passed', duration: 1.0 },
          {
            name: 'fails with location',
            suite: 'suite1',
            status: 'failed',
            duration: 0.5,
            errorMessage: 'Expected 3 but got 4',
            stackTrace: `Error: Expected 3 but got 4
    at Object.<anonymous> (src/math.test.ts:42:5)`,
          },
          {
            name: 'fails without location',
            suite: 'suite1',
            status: 'failed',
            duration: 0.3,
            errorMessage: 'Something broke',
            stackTrace: 'Some error without file reference',
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChecksCreate.mockResolvedValue({ data: { id: 1 } });
  mockSummaryWrite.mockResolvedValue(undefined);
  mockContext.payload = { pull_request: { head: { sha: 'pr-sha-abc123' } } };
  mockContext.sha = 'push-sha-def456';
});

describe('createCheckRun', () => {
  it('creates check run with correct params on success', async () => {
    const parsed = makeParsed({
      summary: { total: 10, passed: 10, failed: 0, skipped: 0, errored: 0, duration: 3.0 },
      suites: [
        {
          name: 'suite1',
          duration: 3.0,
          tests: [{ name: 'test1', suite: 'suite1', status: 'passed', duration: 1.0 }],
        },
      ],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Test Results', parsed });

    expect(mockGetOctokit).toHaveBeenCalledWith('ghp_test');
    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'Test Results',
        head_sha: 'pr-sha-abc123',
        status: 'completed',
        conclusion: 'success',
        output: expect.objectContaining({
          title: expect.stringContaining('10 passed'),
          summary: expect.any(String),
          annotations: [],
        }),
      }),
    );
  });

  it('formats title and body with metrics strip and pass rate', async () => {
    const parsed = makeParsed({
      summary: { total: 10, passed: 7, failed: 2, skipped: 1, errored: 0, duration: 4.2 },
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Test Results', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.title).toBe('Tests: ✅ 7 passed · ❌ 2 failed · ⏭️ 1 skipped — 70.0%');
    expect(call.output.summary).toContain('**✅ 7 passed · ❌ 2 failed · ⏭️ 1 skipped — 70.0%**');
    expect(call.output.summary).toContain('⏱️ 4.2s');
    expect(call.output.summary).toContain('📊 10 tests');
    expect(call.output.summary).not.toContain('**Pass rate:**');
  });

  it('sets conclusion to failure when tests fail', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Test Results',
      parsed: makeParsed(),
    });

    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        conclusion: 'failure',
      }),
    );
  });

  it('builds annotations for failed tests with file locations', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Test Results',
      parsed: makeParsed(),
    });

    const call = mockChecksCreate.mock.calls[0][0];
    const annotations = call.output.annotations;

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({
      path: 'src/math.test.ts',
      start_line: 42,
      end_line: 42,
      annotation_level: 'failure',
      message: 'Expected 3 but got 4',
      title: 'fails with location',
    });
  });

  it('skips failed tests without extractable file location when no reportFile', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Test Results',
      parsed: makeParsed(),
    });

    const call = mockChecksCreate.mock.calls[0][0];
    const titles = call.output.annotations.map((a: { title: string }) => a.title);
    expect(titles).not.toContain('fails without location');
  });

  it('falls back to reportFile at line 1 for failed tests without a location', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Test Results',
      parsed: makeParsed(),
      reportFile: './reports/junit.xml',
    });

    const call = mockChecksCreate.mock.calls[0][0];
    const fallback = call.output.annotations.find(
      (a: { title: string }) => a.title === 'fails without location',
    );
    expect(fallback).toEqual({
      path: 'reports/junit.xml',
      start_line: 1,
      end_line: 1,
      annotation_level: 'failure',
      message: 'Something broke',
      title: 'fails without location',
    });
  });

  it('falls back to reportFile for a failed test with an unparseable stack trace', async () => {
    const parsed = makeParsed({
      suites: [
        {
          name: 'suite1',
          duration: 1.0,
          tests: [
            {
              name: 'unparseable trace',
              suite: 'suite1',
              status: 'failed',
              duration: 0.1,
              errorMessage: 'Kaboom',
              stackTrace: 'no file reference here at all',
            },
          ],
        },
      ],
    });

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed,
      reportFile: './reports/results.json',
    });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations).toHaveLength(1);
    expect(call.output.annotations[0]).toEqual({
      path: 'reports/results.json',
      start_line: 1,
      end_line: 1,
      annotation_level: 'failure',
      message: 'Kaboom',
      title: 'unparseable trace',
    });
  });

  it('annotates errored tests that have a location', async () => {
    const parsed = makeParsed({
      suites: [
        {
          name: 'suite1',
          duration: 1.0,
          tests: [
            {
              name: 'errored with native location',
              suite: 'suite1',
              status: 'errored',
              duration: 0.1,
              errorMessage: 'Setup threw',
              file: 'src/db/connection.ts',
              line: 12,
            },
            {
              name: 'errored with stack trace',
              suite: 'suite1',
              status: 'errored',
              duration: 0.1,
              errorMessage: 'Boom',
              stackTrace: `Error\n    at Object.<anonymous> (src/api/handler.ts:88:3)`,
            },
          ],
        },
      ],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations).toEqual([
      {
        path: 'src/db/connection.ts',
        start_line: 12,
        end_line: 12,
        annotation_level: 'failure',
        message: 'Setup threw',
        title: 'errored with native location',
      },
      {
        path: 'src/api/handler.ts',
        start_line: 88,
        end_line: 88,
        annotation_level: 'failure',
        message: 'Boom',
        title: 'errored with stack trace',
      },
    ]);
  });

  it('falls back to reportFile for an errored test without a location', async () => {
    const parsed = makeParsed({
      suites: [
        {
          name: 'suite1',
          duration: 1.0,
          tests: [
            {
              name: 'errored no location',
              suite: 'suite1',
              status: 'errored',
              duration: 0.1,
              errorMessage: 'Crashed',
            },
          ],
        },
      ],
    });

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed,
      reportFile: 'reports/junit.xml',
    });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations).toHaveLength(1);
    expect(call.output.annotations[0]).toEqual({
      path: 'reports/junit.xml',
      start_line: 1,
      end_line: 1,
      annotation_level: 'failure',
      message: 'Crashed',
      title: 'errored no location',
    });
  });

  it('concludes failure when a run has only errored tests (no failures)', async () => {
    const parsed = makeParsed({
      summary: { total: 1, passed: 0, failed: 0, skipped: 0, errored: 1, duration: 0.1 },
      suites: [
        {
          name: 'suite1',
          duration: 0.1,
          tests: [
            {
              name: 'errored',
              suite: 'suite1',
              status: 'errored',
              duration: 0.1,
              errorMessage: 'Crashed',
              file: 'src/db/connection.ts',
              line: 12,
            },
          ],
        },
      ],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.conclusion).toBe('failure');
  });

  it('caps annotations at 50', async () => {
    const tests = Array.from({ length: 60 }, (_, i) => ({
      name: `fail-${i}`,
      suite: 'suite1',
      status: 'failed' as const,
      duration: 0.1,
      errorMessage: `Error ${i}`,
      stackTrace: `Error\n    at Object.<anonymous> (src/test-${i}.ts:${i + 1}:1)`,
    }));

    const parsed = makeParsed({
      summary: { total: 60, passed: 0, failed: 60, skipped: 0, errored: 0, duration: 6.0 },
      suites: [{ name: 'suite1', duration: 6.0, tests }],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations).toHaveLength(50);
  });

  it('uses PR head SHA when in PR context', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
    });

    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ head_sha: 'pr-sha-abc123' }),
    );
  });

  it('falls back to context.sha when not in PR context', async () => {
    mockContext.payload = {};

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
    });

    expect(mockChecksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ head_sha: 'push-sha-def456' }),
    );
  });

  it('warns about permissions on 403 error and does not retry', async () => {
    const error = new Error('Resource not accessible by integration');
    (error as Record<string, unknown>).status = 403;
    mockChecksCreate.mockRejectedValue(error);

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
    });

    expect(mockChecksCreate).toHaveBeenCalledTimes(1);
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('checks: write permission is required'),
    );
    expect(mockError).not.toHaveBeenCalled();
  });

  it('escalates to core.error (not warning) when a non-permission error persists', async () => {
    mockChecksCreate.mockRejectedValue(new Error('Bad request'));

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
    });

    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Failed to create Check Run'));
    expect(mockSummaryAddRaw).toHaveBeenCalledWith(expect.stringContaining('could not post'));
    expect(mockSummaryWrite).toHaveBeenCalled();
  });

  it('logs a success line with id and conclusion after creating the check run', async () => {
    mockChecksCreate.mockResolvedValue({ data: { id: 4242 } });

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Unit Tests',
      parsed: makeParsed(),
    });

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Created check run "Unit Tests" (id=4242, conclusion=failure)'),
    );
  });

  it('retries a transient 5xx and then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const error = Object.assign(new Error('Server Error'), { status: 500 });
      mockChecksCreate.mockRejectedValueOnce(error).mockResolvedValueOnce({ data: { id: 9 } });

      const promise = createCheckRun({
        githubToken: 'ghp_test',
        checkName: 'Tests',
        parsed: makeParsed(),
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockChecksCreate).toHaveBeenCalledTimes(2);
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created check run "Tests"'));
      expect(mockError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a secondary-rate-limit 403 (retry-after header), not treating it as a permission error', async () => {
    vi.useFakeTimers();
    try {
      const error = Object.assign(new Error('You have exceeded a secondary rate limit'), {
        status: 403,
        response: { headers: { 'retry-after': '1' } },
      });
      mockChecksCreate.mockRejectedValueOnce(error).mockResolvedValueOnce({ data: { id: 11 } });

      const promise = createCheckRun({
        githubToken: 'ghp_test',
        checkName: 'Tests',
        parsed: makeParsed(),
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockChecksCreate).toHaveBeenCalledTimes(2);
      expect(mockWarning).not.toHaveBeenCalled();
      expect(mockError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exhausts retries on persistent 5xx, escalates to core.error, and never calls setFailed', async () => {
    vi.useFakeTimers();
    try {
      mockChecksCreate.mockRejectedValue(Object.assign(new Error('Server Error'), { status: 503 }));

      const promise = createCheckRun({
        githubToken: 'ghp_test',
        checkName: 'Tests',
        parsed: makeParsed(),
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockChecksCreate).toHaveBeenCalledTimes(4);
      expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Failed to create Check Run'));
      expect(mockSetFailed).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never calls core.setFailed', async () => {
    mockChecksCreate.mockRejectedValue(new Error('any error'));

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
    });

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    mockChecksCreate.mockRejectedValue(new Error('kaboom'));

    await expect(
      createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed: makeParsed() }),
    ).resolves.toBeUndefined();
  });

  it('uses custom check name', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Unit Tests',
      parsed: makeParsed(),
    });

    expect(mockChecksCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Unit Tests' }));
  });

  it('uses "Test failed" as fallback message when errorMessage is missing', async () => {
    const parsed = makeParsed({
      suites: [
        {
          name: 'suite1',
          duration: 1.0,
          tests: [
            {
              name: 'no-message',
              suite: 'suite1',
              status: 'failed',
              duration: 0.1,
              stackTrace: `Error\n    at Object.<anonymous> (src/foo.ts:10:1)`,
            },
          ],
        },
      ],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations[0].message).toBe('Test failed');
  });

  it('annotates using native file/line with no stack trace', async () => {
    const parsed = makeParsed({
      suites: [
        {
          name: 'suite1',
          duration: 1.0,
          tests: [
            {
              name: 'native location',
              suite: 'suite1',
              status: 'failed',
              duration: 0.1,
              errorMessage: 'Boom',
              file: 'src/checkout/cart.test.ts',
              line: 57,
            },
          ],
        },
      ],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations).toHaveLength(1);
    expect(call.output.annotations[0]).toEqual({
      path: 'src/checkout/cart.test.ts',
      start_line: 57,
      end_line: 57,
      annotation_level: 'failure',
      message: 'Boom',
      title: 'native location',
    });
  });

  it('prefers native file/line over stack trace location', async () => {
    const parsed = makeParsed({
      suites: [
        {
          name: 'suite1',
          duration: 1.0,
          tests: [
            {
              name: 'native wins',
              suite: 'suite1',
              status: 'failed',
              duration: 0.1,
              errorMessage: 'Boom',
              file: 'src/native.test.ts',
              line: 5,
              stackTrace: `Error\n    at Object.<anonymous> (src/from-trace.ts:99:1)`,
            },
          ],
        },
      ],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations[0].path).toBe('src/native.test.ts');
    expect(call.output.annotations[0].start_line).toBe(5);
  });

  it('defaults to line 1 when native file has no line', async () => {
    const parsed = makeParsed({
      suites: [
        {
          name: 'suite1',
          duration: 1.0,
          tests: [
            {
              name: 'no line',
              suite: 'suite1',
              status: 'failed',
              duration: 0.1,
              errorMessage: 'Boom',
              file: 'src/checkout/cart.test.ts',
            },
          ],
        },
      ],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations[0].start_line).toBe(1);
    expect(call.output.annotations[0].end_line).toBe(1);
  });

  it('defaults annotation_level to "failure" when annotationLevel is not provided', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
    });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations).toHaveLength(1);
    expect(call.output.annotations[0].annotation_level).toBe('failure');
  });

  it('uses "warning" annotation_level when annotationLevel is "warning"', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
      annotationLevel: 'warning',
    });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations[0].annotation_level).toBe('warning');
    expect(call.conclusion).toBe('failure');
  });

  it('uses "notice" annotation_level when annotationLevel is "notice"', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
      annotationLevel: 'notice',
    });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations[0].annotation_level).toBe('notice');
    expect(call.conclusion).toBe('failure');
  });

  it('normalizes native file paths to repo-relative', async () => {
    const parsed = makeParsed({
      suites: [
        {
          name: 'suite1',
          duration: 1.0,
          tests: [
            {
              name: 'leading slash',
              suite: 'suite1',
              status: 'failed',
              duration: 0.1,
              errorMessage: 'Boom',
              file: './src/checkout/cart.test.ts',
              line: 3,
            },
          ],
        },
      ],
    });

    await createCheckRun({ githubToken: 'ghp_test', checkName: 'Tests', parsed });

    const call = mockChecksCreate.mock.calls[0][0];
    expect(call.output.annotations[0].path).toBe('src/checkout/cart.test.ts');
  });
});
