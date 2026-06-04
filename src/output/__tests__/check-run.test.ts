import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ParsedTestRun } from '../../types';

const mockWarning = vi.fn();
const mockSetFailed = vi.fn();

vi.mock('@actions/core', () => ({
  warning: (...args: unknown[]) => mockWarning(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
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

  it('skips failed tests without extractable file location', async () => {
    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Test Results',
      parsed: makeParsed(),
    });

    const call = mockChecksCreate.mock.calls[0][0];
    const titles = call.output.annotations.map((a: { title: string }) => a.title);
    expect(titles).not.toContain('fails without location');
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

  it('warns about permissions on 403 error', async () => {
    const error = new Error('Resource not accessible by integration');
    (error as Record<string, unknown>).status = 403;
    mockChecksCreate.mockRejectedValue(error);

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
    });

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('checks: write permission is required'),
    );
  });

  it('warns generically on other errors', async () => {
    mockChecksCreate.mockRejectedValue(new Error('Network failure'));

    await createCheckRun({
      githubToken: 'ghp_test',
      checkName: 'Tests',
      parsed: makeParsed(),
    });

    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('Failed to create Check Run'));
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
