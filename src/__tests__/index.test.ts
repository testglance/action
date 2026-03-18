import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockGetInput = vi.fn();
const mockInfo = vi.fn();
const mockWarning = vi.fn();
const mockSetFailed = vi.fn();

vi.mock('@actions/core', () => ({
  getInput: (...args: unknown[]) => mockGetInput(...args),
  info: (...args: unknown[]) => mockInfo(...args),
  warning: (...args: unknown[]) => mockWarning(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

const mockParseJunitXml = vi.fn();
vi.mock('../parsers/junit', () => ({
  parseJunitXml: (...args: unknown[]) => mockParseJunitXml(...args),
}));

const mockParseCtrfJson = vi.fn();
vi.mock('../parsers/ctrf', () => ({
  parseCtrfJson: (...args: unknown[]) => mockParseCtrfJson(...args),
}));

const mockSendTestRun = vi.fn();
vi.mock('../api/client', () => ({
  sendTestRun: (...args: unknown[]) => mockSendTestRun(...args),
}));

const mockDetectFormat = vi.fn();
vi.mock('../utils/detect-format', () => ({
  detectFormat: (...args: unknown[]) => mockDetectFormat(...args),
}));

const mockDetectFramework = vi.fn();
vi.mock('../utils/detect-framework', () => ({
  detectFramework: (...args: unknown[]) => mockDetectFramework(...args),
}));

vi.mock('../utils/errors', () => ({
  handleFileNotFound: vi.fn(),
  handleParseError: vi.fn(),
  handleApiUnreachable: vi.fn(),
  handleApiError: vi.fn(),
  handleUnexpectedError: vi.fn(),
}));

const mockGenerateSummary = vi.fn().mockResolvedValue(undefined);
vi.mock('../output/summary', () => ({
  generateSummary: (...args: unknown[]) => mockGenerateSummary(...args),
}));

const mockPostPrComment = vi.fn().mockResolvedValue(undefined);
vi.mock('../output/post-pr-comment', () => ({
  postPrComment: (...args: unknown[]) => mockPostPrComment(...args),
}));

import { run } from '../index';
import * as errors from '../utils/errors';
import type { ParsedTestRun } from '../types';

const VALID_PARSED_RUN: ParsedTestRun = {
  summary: { total: 2, passed: 1, failed: 1, skipped: 0, errored: 0, duration: 1.0 },
  suites: [
    {
      name: 'suite1',
      duration: 1.0,
      tests: [
        { name: 'test1', suite: 'suite1', status: 'passed', duration: 0.5 },
        { name: 'test2', suite: 'suite1', status: 'failed', duration: 0.5, errorMessage: 'fail' },
      ],
    },
  ],
};

function setupInputs(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    'report-path': '/path/to/report.xml',
    'api-key': 'tg_key_123',
    'api-url': '',
    'report-format': '',
    'test-job-name': '',
    'github-token': '',
  };
  const inputs = { ...defaults, ...overrides };
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue('<xml>content</xml>');
  mockDetectFormat.mockReturnValue('junit');
  mockParseJunitXml.mockReturnValue(VALID_PARSED_RUN);
  mockParseCtrfJson.mockReturnValue(VALID_PARSED_RUN);
  mockSendTestRun.mockResolvedValue({ success: true, runId: 'run-1', healthScore: 85 });
  setupInputs();
});

describe('run() integration', () => {
  describe('happy path — JUnit XML + API 200', () => {
    it('parses file, sends to API, logs success', async () => {
      await run();

      expect(mockExistsSync).toHaveBeenCalledWith('/path/to/report.xml');
      expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/report.xml', 'utf-8');
      expect(mockParseJunitXml).toHaveBeenCalled();
      expect(mockSendTestRun).toHaveBeenCalledWith(
        'https://www.testglance.dev',
        'tg_key_123',
        VALID_PARSED_RUN,
        { framework: undefined, testJobName: undefined },
      );
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('submitted successfully'));
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Health score: 85'));
    });
  });

  describe('happy path — CTRF JSON + API 200', () => {
    it('parses CTRF file and sends to API', async () => {
      setupInputs({ 'report-path': '/path/to/report.json' });
      mockDetectFormat.mockReturnValue('ctrf');

      await run();

      expect(mockParseCtrfJson).toHaveBeenCalled();
      expect(mockSendTestRun).toHaveBeenCalled();
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('submitted successfully'));
    });
  });

  describe('file not found (AC5)', () => {
    it('calls handleFileNotFound, never calls setFailed', async () => {
      mockExistsSync.mockReturnValue(false);

      await run();

      expect(errors.handleFileNotFound).toHaveBeenCalledWith('/path/to/report.xml');
      expect(mockSendTestRun).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('parse error (AC6)', () => {
    it('calls handleParseError for JUnit, never calls setFailed', async () => {
      mockParseJunitXml.mockImplementation(() => {
        throw new Error('Invalid XML');
      });

      await run();

      expect(errors.handleParseError).toHaveBeenCalledWith('JUnit XML', expect.any(Error));
      expect(mockSendTestRun).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('calls handleParseError for CTRF, never calls setFailed', async () => {
      setupInputs({ 'report-path': '/path/to/report.json' });
      mockDetectFormat.mockReturnValue('ctrf');
      mockParseCtrfJson.mockImplementation(() => {
        throw new Error('Invalid JSON');
      });

      await run();

      expect(errors.handleParseError).toHaveBeenCalledWith('CTRF JSON', expect.any(Error));
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('API unreachable (AC3)', () => {
    it('calls handleApiUnreachable, never calls setFailed', async () => {
      mockSendTestRun.mockResolvedValue({
        success: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'fetch failed',
      });

      await run();

      expect(errors.handleApiUnreachable).toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('API 401 error (AC4)', () => {
    it('calls handleApiError, never calls setFailed', async () => {
      mockSendTestRun.mockResolvedValue({
        success: false,
        errorCode: 'UNAUTHORIZED',
        errorMessage: 'Invalid API key',
      });

      await run();

      expect(errors.handleApiError).toHaveBeenCalledWith('UNAUTHORIZED', 'Invalid API key');
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('unexpected exception (AC7)', () => {
    it('calls handleUnexpectedError, never calls setFailed', async () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error('Disk error');
      });

      await run();

      expect(errors.handleUnexpectedError).toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('format auto-detection (AC8)', () => {
    it('detects .xml as JUnit', async () => {
      setupInputs({ 'report-path': '/path/to/report.xml' });
      mockDetectFormat.mockReturnValue('junit');

      await run();

      expect(mockParseJunitXml).toHaveBeenCalled();
      expect(mockParseCtrfJson).not.toHaveBeenCalled();
    });

    it('detects .json as CTRF', async () => {
      setupInputs({ 'report-path': '/path/to/report.json' });
      mockDetectFormat.mockReturnValue('ctrf');

      await run();

      expect(mockParseCtrfJson).toHaveBeenCalled();
      expect(mockParseJunitXml).not.toHaveBeenCalled();
    });

    it('tries both parsers when auto-detect returns null', async () => {
      setupInputs({ 'report-path': '/path/to/report.dat' });
      mockDetectFormat.mockReturnValue(null);
      mockParseJunitXml.mockImplementation(() => {
        throw new Error('not xml');
      });

      await run();

      expect(mockParseJunitXml).toHaveBeenCalled();
      expect(mockParseCtrfJson).toHaveBeenCalled();
    });
  });

  describe('explicit format override (AC9)', () => {
    it('uses JUnit parser when report-format=junit on a .json file', async () => {
      setupInputs({ 'report-path': '/path/to/report.json', 'report-format': 'junit' });

      await run();

      expect(mockDetectFormat).not.toHaveBeenCalled();
      expect(mockParseJunitXml).toHaveBeenCalled();
    });

    it('uses CTRF parser when report-format=ctrf on a .xml file', async () => {
      setupInputs({ 'report-path': '/path/to/report.xml', 'report-format': 'ctrf' });

      await run();

      expect(mockDetectFormat).not.toHaveBeenCalled();
      expect(mockParseCtrfJson).toHaveBeenCalled();
    });
  });

  describe('critical: core.setFailed is NEVER called (AC7)', () => {
    it('is not called on happy path', async () => {
      await run();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('is not called on file not found', async () => {
      mockExistsSync.mockReturnValue(false);
      await run();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('is not called on parse error', async () => {
      mockParseJunitXml.mockImplementation(() => {
        throw new Error('bad');
      });
      await run();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('is not called on API error', async () => {
      mockSendTestRun.mockResolvedValue({ success: false, errorCode: 'ERR', errorMessage: 'fail' });
      await run();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('is not called on unexpected exception', async () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error('boom');
      });
      await run();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('API URL handling', () => {
    it('uses default URL when api-url is empty', async () => {
      await run();
      expect(mockSendTestRun).toHaveBeenCalledWith(
        'https://www.testglance.dev',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('uses custom URL when api-url is provided', async () => {
      setupInputs({ 'api-url': 'https://custom.api.com' });
      await run();
      expect(mockSendTestRun).toHaveBeenCalledWith(
        'https://custom.api.com',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('healthScore logging', () => {
    it('does not log health score when null', async () => {
      mockSendTestRun.mockResolvedValue({ success: true, runId: 'run-1', healthScore: null });
      await run();

      const healthCalls = mockInfo.mock.calls.filter((c: string[]) =>
        c[0]?.includes('Health score'),
      );
      expect(healthCalls).toHaveLength(0);
    });
  });

  describe('summary generation (Story 1.5)', () => {
    it('calls generateSummary with correct args on API success', async () => {
      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith({
        parsed: VALID_PARSED_RUN,
        apiSuccess: true,
        runId: 'run-1',
        healthScore: 85,
        dashboardUrl: 'https://www.testglance.dev/runs/run-1',
        highlights: [],
      });
    });

    it('calls generateSummary with apiSuccess=false on API failure', async () => {
      mockSendTestRun.mockResolvedValue({
        success: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'fetch failed',
      });

      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith({
        parsed: VALID_PARSED_RUN,
        apiSuccess: false,
        runId: undefined,
        healthScore: undefined,
        dashboardUrl: undefined,
        highlights: [],
      });
    });

    it('does not call generateSummary when file not found', async () => {
      mockExistsSync.mockReturnValue(false);
      await run();
      expect(mockGenerateSummary).not.toHaveBeenCalled();
    });

    it('does not call generateSummary when parse fails', async () => {
      mockParseJunitXml.mockImplementation(() => {
        throw new Error('bad xml');
      });
      await run();
      expect(mockGenerateSummary).not.toHaveBeenCalled();
    });
  });

  describe('highlights passthrough (Story 3.12)', () => {
    it('passes highlights from API response to generateSummary', async () => {
      const highlights = [
        {
          type: 'new_failures',
          severity: 'critical',
          message: '1 failed',
          data: { tests: [{ name: 'test1', suite: 'suite1' }] },
        },
      ];
      mockSendTestRun.mockResolvedValue({
        success: true,
        runId: 'run-hl',
        healthScore: 90,
        highlights,
      });

      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith(expect.objectContaining({ highlights }));
    });

    it('defaults highlights to empty array when API returns no highlights', async () => {
      mockSendTestRun.mockResolvedValue({ success: true, runId: 'run-1', healthScore: 85 });

      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith(expect.objectContaining({ highlights: [] }));
    });

    it('defaults highlights to empty array on API failure', async () => {
      mockSendTestRun.mockResolvedValue({
        success: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'fail',
      });

      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith(expect.objectContaining({ highlights: [] }));
    });
  });

  describe('metadata envelope (Story 1.6)', () => {
    it('passes test-job-name input through to sendTestRun metaFields', async () => {
      setupInputs({ 'test-job-name': 'Unit Tests' });
      await run();

      expect(mockSendTestRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ testJobName: 'Unit Tests' }),
      );
    });

    it('passes undefined testJobName when test-job-name is empty', async () => {
      setupInputs({ 'test-job-name': '' });
      await run();

      expect(mockSendTestRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ testJobName: undefined }),
      );
    });

    it('calls detectFramework with report path and format for CTRF', async () => {
      setupInputs({ 'report-path': '/path/to/report.json' });
      mockDetectFormat.mockReturnValue('ctrf');
      const parsedWithTool = { ...VALID_PARSED_RUN, toolName: 'vitest' };
      mockParseCtrfJson.mockReturnValue(parsedWithTool);

      await run();

      expect(mockDetectFramework).toHaveBeenCalledWith('/path/to/report.json', 'ctrf', 'vitest');
    });

    it('calls detectFramework with report path and format for JUnit', async () => {
      setupInputs({ 'report-path': '/path/to/vitest-report/results.xml' });
      mockDetectFormat.mockReturnValue('junit');

      await run();

      expect(mockDetectFramework).toHaveBeenCalledWith(
        '/path/to/vitest-report/results.xml',
        'junit',
        undefined,
      );
    });

    it('passes detected framework to sendTestRun', async () => {
      mockDetectFramework.mockReturnValue('vitest');

      await run();

      expect(mockSendTestRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ framework: 'vitest' }),
      );
    });

    it('passes undefined framework when detection returns undefined', async () => {
      mockDetectFramework.mockReturnValue(undefined);

      await run();

      expect(mockSendTestRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ framework: undefined }),
      );
    });

    it('passes CTRF toolName through to detectFramework', async () => {
      setupInputs({ 'report-path': '/path/to/report.json' });
      mockDetectFormat.mockReturnValue('ctrf');
      const parsedWithTool = { ...VALID_PARSED_RUN, toolName: 'playwright' };
      mockParseCtrfJson.mockReturnValue(parsedWithTool);

      await run();

      expect(mockDetectFramework).toHaveBeenCalledWith(
        '/path/to/report.json',
        'ctrf',
        'playwright',
      );
    });
  });

  describe('PR comment posting (Story 3.13)', () => {
    it('calls postPrComment when github-token is provided and API succeeds', async () => {
      setupInputs({ 'github-token': 'ghp_abc123' });

      await run();

      expect(mockPostPrComment).toHaveBeenCalledWith(
        expect.objectContaining({
          githubToken: 'ghp_abc123',
          section: expect.objectContaining({
            status: 'failed',
            total: 2,
            passed: 1,
            failed: 1,
          }),
        }),
      );
    });

    it('does not call postPrComment when github-token is missing', async () => {
      setupInputs({ 'github-token': '' });

      await run();

      expect(mockPostPrComment).not.toHaveBeenCalled();
    });

    it('does not call postPrComment when API fails', async () => {
      setupInputs({ 'github-token': 'ghp_abc123' });
      mockSendTestRun.mockResolvedValue({
        success: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'fail',
      });

      await run();

      expect(mockPostPrComment).not.toHaveBeenCalled();
    });
  });
});
