import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ParsedTestRun } from '../../types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const FAKE_API_URL = 'https://api.testglance.com';
const FAKE_API_KEY = 'tg_test_key_123';

const PARSED_RUN: ParsedTestRun = {
  summary: { total: 3, passed: 2, failed: 1, skipped: 0, errored: 0, duration: 1.5 },
  suites: [
    {
      name: 'auth',
      duration: 1.5,
      tests: [
        { name: 'login', suite: 'auth', status: 'passed', duration: 0.5 },
        { name: 'logout', suite: 'auth', status: 'passed', duration: 0.4 },
        { name: 'signup', suite: 'auth', status: 'failed', duration: 0.6, errorMessage: 'timeout' },
      ],
    },
  ],
};

function okResponse(runId: string, healthScore: number | null = null) {
  return new Response(
    JSON.stringify({ data: { runId, healthScore } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse(status: number, code: string, message: string) {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

// Mock the sleep function to resolve immediately
vi.mock('../client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../client')>();
  return mod;
});

let sendTestRun: typeof import('../client').sendTestRun;

beforeEach(async () => {
  mockFetch.mockReset();
  vi.useFakeTimers();
  const mod = await import('../client');
  sendTestRun = mod.sendTestRun;
});

// Helper: run sendTestRun while advancing fake timers to resolve sleep() calls
async function runWithTimers(
  fn: () => Promise<unknown>,
): Promise<unknown> {
  const promise = fn();
  // Advance timers repeatedly to resolve any pending sleep() calls
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(5000);
  }
  return promise;
}

describe('sendTestRun', () => {
  describe('successful POST (AC1, AC2)', () => {
    it('returns success with runId and healthScore on 200', async () => {
      mockFetch.mockResolvedValueOnce(okResponse('run-abc', 87));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toEqual({
        success: true,
        runId: 'run-abc',
        healthScore: 87,
      });
    });

    it('returns healthScore as null when API returns null', async () => {
      mockFetch.mockResolvedValueOnce(okResponse('run-xyz', null));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: true, healthScore: null });
    });

    it('sends correct URL: apiUrl + /api/v1/runs', async () => {
      mockFetch.mockResolvedValueOnce(okResponse('run-1'));

      await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(mockFetch).toHaveBeenCalledWith(
        `${FAKE_API_URL}/api/v1/runs`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('sends Bearer token in Authorization header', async () => {
      mockFetch.mockResolvedValueOnce(okResponse('run-1'));

      await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    });

    it('sends Content-Type application/json header', async () => {
      mockFetch.mockResolvedValueOnce(okResponse('run-1'));

      await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers['Content-Type']).toBe('application/json');
    });

    it('sends ParsedTestRun as JSON body', async () => {
      mockFetch.mockResolvedValueOnce(okResponse('run-1'));

      await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      const callArgs = mockFetch.mock.calls[0][1];
      expect(JSON.parse(callArgs.body)).toEqual(PARSED_RUN);
    });
  });

  describe('non-retryable errors (AC4)', () => {
    it('returns error on 401 without retry', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'UNAUTHORIZED', 'Invalid API key'));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toEqual({
        success: false,
        errorCode: 'UNAUTHORIZED',
        errorMessage: 'Invalid API key',
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns error on 400 without retry', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(400, 'BAD_REQUEST', 'Invalid payload'));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: false, errorCode: 'BAD_REQUEST' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns error on 403 without retry', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, 'FORBIDDEN', 'Access denied'));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: false, errorCode: 'FORBIDDEN' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryable errors (AC3, AC4)', () => {
    it('retries on 429 up to 3 times', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(429, 'RATE_LIMITED', 'Too many requests'))
        .mockResolvedValueOnce(errorResponse(429, 'RATE_LIMITED', 'Too many requests'))
        .mockResolvedValueOnce(errorResponse(429, 'RATE_LIMITED', 'Too many requests'));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: false });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('retries on 500 up to 3 times', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500, 'INTERNAL_ERROR', 'Server error'))
        .mockResolvedValueOnce(errorResponse(500, 'INTERNAL_ERROR', 'Server error'))
        .mockResolvedValueOnce(errorResponse(500, 'INTERNAL_ERROR', 'Server error'));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: false });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('succeeds on second attempt after retryable error', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500, 'INTERNAL_ERROR', 'Server error'))
        .mockResolvedValueOnce(okResponse('run-retry', 92));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: true, runId: 'run-retry' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('network errors (AC3)', () => {
    it('retries on network error up to 3 times', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockRejectedValueOnce(new Error('fetch failed'));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toEqual({
        success: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'fetch failed',
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('succeeds after transient network error', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('DNS failure'))
        .mockResolvedValueOnce(okResponse('run-recovered', 75));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: true, runId: 'run-recovered' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('timeout (AC10)', () => {
    it('sends request with AbortController signal', async () => {
      mockFetch.mockResolvedValueOnce(okResponse('run-1'));

      await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });

    it('treats abort as network error and retries', async () => {
      mockFetch
        .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))
        .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))
        .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: false, errorCode: 'NETWORK_ERROR' });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('all retries exhausted', () => {
    it('returns NETWORK_ERROR after all retries fail', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockRejectedValueOnce(new Error('connection refused'));

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toEqual({
        success: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'connection refused',
      });
    });
  });

  describe('error response body parsing', () => {
    it('handles unparseable error response body', async () => {
      const badResponse = new Response('not json', {
        status: 401,
        headers: { 'Content-Type': 'text/plain' },
      });
      Object.defineProperty(badResponse, 'ok', { value: false });
      Object.defineProperty(badResponse, 'status', { value: 401 });

      mockFetch.mockResolvedValueOnce(badResponse);

      const result = await runWithTimers(() => sendTestRun(FAKE_API_URL, FAKE_API_KEY, PARSED_RUN));

      expect(result).toMatchObject({ success: false, errorCode: 'UNKNOWN' });
    });
  });
});
