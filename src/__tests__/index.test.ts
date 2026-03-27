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

const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
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

const mockDiscoverReportFiles = vi.fn();
vi.mock('../utils/discover-files', () => ({
  discoverReportFiles: (...args: unknown[]) => mockDiscoverReportFiles(...args),
}));

const mockMergeTestRuns = vi.fn();
vi.mock('../utils/merge-results', () => ({
  mergeTestRuns: (...args: unknown[]) => mockMergeTestRuns(...args),
}));

const mockAutoDetectReportFiles = vi.fn();
vi.mock('../utils/auto-detect', () => ({
  autoDetectReportFiles: (...args: unknown[]) => mockAutoDetectReportFiles(...args),
  AUTO_DETECT_PATTERNS: [
    '**/test-results/**/*.xml',
    '**/junit.xml',
    '**/test-report.xml',
    '**/surefire-reports/*.xml',
    '**/test-results/**/*.json',
    '**/ctrf-report.json',
    '**/test-report.json',
  ],
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

const mockCreateCheckRun = vi.fn().mockResolvedValue(undefined);
vi.mock('../output/check-run', () => ({
  createCheckRun: (...args: unknown[]) => mockCreateCheckRun(...args),
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
    'send-results': '',
    'github-token': '',
    'create-check': '',
    'check-name': '',
    'slowest-tests': '',
  };
  const inputs = { ...defaults, ...overrides };
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.xml']);
  mockReadFileSync.mockReturnValue('<xml>content</xml>');
  mockDetectFormat.mockReturnValue('junit');
  mockParseJunitXml.mockReturnValue(VALID_PARSED_RUN);
  mockParseCtrfJson.mockReturnValue(VALID_PARSED_RUN);
  mockMergeTestRuns.mockReturnValue(VALID_PARSED_RUN);
  mockSendTestRun.mockResolvedValue({ success: true, runId: 'run-1', healthScore: 85 });
  setupInputs();
});

describe('run() integration', () => {
  describe('happy path — JUnit XML + API 200', () => {
    it('discovers file, parses, sends to API, logs success', async () => {
      await run();

      expect(mockDiscoverReportFiles).toHaveBeenCalledWith('/path/to/report.xml');
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
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.json']);
      mockDetectFormat.mockReturnValue('ctrf');

      await run();

      expect(mockParseCtrfJson).toHaveBeenCalled();
      expect(mockSendTestRun).toHaveBeenCalled();
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('submitted successfully'));
    });
  });

  describe('no files found (AC4 — glob matches nothing)', () => {
    it('logs warning and returns gracefully, never calls setFailed', async () => {
      mockDiscoverReportFiles.mockResolvedValue([]);

      await run();

      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringContaining('No report files found matching'),
      );
      expect(mockSendTestRun).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('parse error', () => {
    it('warns per-file and continues with remaining files', async () => {
      mockDiscoverReportFiles.mockResolvedValue(['/a.xml', '/b.xml']);
      mockReadFileSync.mockReturnValue('<xml/>');
      mockParseJunitXml
        .mockImplementationOnce(() => {
          throw new Error('Invalid XML');
        })
        .mockReturnValueOnce(VALID_PARSED_RUN);

      await run();

      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('Failed to parse /a.xml'));
      expect(mockSendTestRun).toHaveBeenCalled();
    });

    it('warns and returns when ALL files fail to parse', async () => {
      mockParseJunitXml.mockImplementation(() => {
        throw new Error('bad');
      });

      await run();

      expect(mockWarning).toHaveBeenCalledWith('All report files failed to parse');
      expect(mockSendTestRun).not.toHaveBeenCalled();
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
      mockDiscoverReportFiles.mockRejectedValue(new Error('Disk error'));

      await run();

      expect(errors.handleUnexpectedError).toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('format auto-detection (AC8)', () => {
    it('detects .xml as JUnit', async () => {
      setupInputs({ 'report-path': '/path/to/report.xml' });
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.xml']);
      mockDetectFormat.mockReturnValue('junit');

      await run();

      expect(mockParseJunitXml).toHaveBeenCalled();
      expect(mockParseCtrfJson).not.toHaveBeenCalled();
    });

    it('detects .json as CTRF', async () => {
      setupInputs({ 'report-path': '/path/to/report.json' });
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.json']);
      mockDetectFormat.mockReturnValue('ctrf');

      await run();

      expect(mockParseCtrfJson).toHaveBeenCalled();
      expect(mockParseJunitXml).not.toHaveBeenCalled();
    });

    it('tries both parsers when auto-detect returns null', async () => {
      setupInputs({ 'report-path': '/path/to/report.dat' });
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.dat']);
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
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.json']);

      await run();

      expect(mockDetectFormat).not.toHaveBeenCalled();
      expect(mockParseJunitXml).toHaveBeenCalled();
    });

    it('uses CTRF parser when report-format=ctrf on a .xml file', async () => {
      setupInputs({ 'report-path': '/path/to/report.xml', 'report-format': 'ctrf' });
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.xml']);

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

    it('is not called when no files found', async () => {
      mockDiscoverReportFiles.mockResolvedValue([]);
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
      mockDiscoverReportFiles.mockRejectedValue(new Error('boom'));
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

  describe('send-results flag', () => {
    it('skips API call when send-results is false', async () => {
      setupInputs({ 'send-results': 'false' });
      await run();

      expect(mockSendTestRun).not.toHaveBeenCalled();
    });

    it('still generates summary when send-results is false', async () => {
      setupInputs({ 'send-results': 'false' });
      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          parsed: VALID_PARSED_RUN,
          apiSuccess: false,
          runId: undefined,
          healthScore: undefined,
          dashboardUrl: undefined,
          highlights: [],
        }),
      );
    });

    it('does not post PR comment when send-results is false', async () => {
      setupInputs({ 'send-results': 'false', 'github-token': 'ghp_abc123' });
      await run();

      expect(mockPostPrComment).not.toHaveBeenCalled();
    });

    it('sends to API by default (empty string)', async () => {
      await run();
      expect(mockSendTestRun).toHaveBeenCalled();
    });

    it('sends to API when send-results is true', async () => {
      setupInputs({ 'send-results': 'true' });
      await run();
      expect(mockSendTestRun).toHaveBeenCalled();
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
        slowestTests: 10,
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
        slowestTests: 10,
      });
    });

    it('does not call generateSummary when no files found', async () => {
      mockDiscoverReportFiles.mockResolvedValue([]);
      await run();
      expect(mockGenerateSummary).not.toHaveBeenCalled();
    });

    it('does not call generateSummary when all files fail to parse', async () => {
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

  describe('slowest-tests input validation (Story 6.1)', () => {
    it('passes through 0 to disable slowest tests section', async () => {
      setupInputs({ 'slowest-tests': '0' });
      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith(
        expect.objectContaining({ slowestTests: 0 }),
      );
      expect(mockWarning).not.toHaveBeenCalled();
    });

    it('falls back to 10 and warns when slowest-tests is not numeric', async () => {
      setupInputs({ 'slowest-tests': 'abc' });
      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith(
        expect.objectContaining({ slowestTests: 10 }),
      );
      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringContaining('Invalid "slowest-tests" input "abc"'),
      );
    });

    it('falls back to 10 and warns when slowest-tests is negative', async () => {
      setupInputs({ 'slowest-tests': '-3' });
      await run();

      expect(mockGenerateSummary).toHaveBeenCalledWith(
        expect.objectContaining({ slowestTests: 10 }),
      );
      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('Invalid "slowest-tests"'));
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

    it('calls detectFramework with first file path and format for CTRF', async () => {
      setupInputs({ 'report-path': '/path/to/report.json' });
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.json']);
      mockDetectFormat.mockReturnValue('ctrf');
      const parsedWithTool = { ...VALID_PARSED_RUN, toolName: 'vitest' };
      mockParseCtrfJson.mockReturnValue(parsedWithTool);
      mockMergeTestRuns.mockReturnValue(parsedWithTool);

      await run();

      expect(mockDetectFramework).toHaveBeenCalledWith('/path/to/report.json', 'ctrf', 'vitest');
    });

    it('calls detectFramework with first file path and format for JUnit', async () => {
      setupInputs({ 'report-path': '/path/to/vitest-report/results.xml' });
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/vitest-report/results.xml']);
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
      mockDiscoverReportFiles.mockResolvedValue(['/path/to/report.json']);
      mockDetectFormat.mockReturnValue('ctrf');
      const parsedWithTool = { ...VALID_PARSED_RUN, toolName: 'playwright' };
      mockParseCtrfJson.mockReturnValue(parsedWithTool);
      mockMergeTestRuns.mockReturnValue(parsedWithTool);

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

    it('does not call postPrComment when github-token and GITHUB_TOKEN are both missing', async () => {
      setupInputs({ 'github-token': '' });
      const original = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;

      await run();

      expect(mockPostPrComment).not.toHaveBeenCalled();
      if (original !== undefined) process.env.GITHUB_TOKEN = original;
    });

    it('falls back to GITHUB_TOKEN env var when github-token input is empty', async () => {
      setupInputs({ 'github-token': '' });
      const original = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'ghs_env_fallback';

      await run();

      expect(mockPostPrComment).toHaveBeenCalledWith(
        expect.objectContaining({ githubToken: 'ghs_env_fallback' }),
      );
      if (original !== undefined) {
        process.env.GITHUB_TOKEN = original;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
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

  describe('multi-file pipeline (Story 6.2)', () => {
    it('discovers multiple files and calls mergeTestRuns', async () => {
      mockDiscoverReportFiles.mockResolvedValue(['/a.xml', '/b.xml']);
      mockReadFileSync.mockReturnValue('<xml/>');
      mockDetectFormat.mockReturnValue('junit');

      await run();

      expect(mockMergeTestRuns).toHaveBeenCalledWith([
        { filePath: '/a.xml', parsed: VALID_PARSED_RUN },
        { filePath: '/b.xml', parsed: VALID_PARSED_RUN },
      ]);
    });

    it('skips files that fail to parse and continues', async () => {
      mockDiscoverReportFiles.mockResolvedValue(['/bad.xml', '/good.xml']);
      mockReadFileSync.mockReturnValue('<xml/>');
      mockParseJunitXml
        .mockImplementationOnce(() => {
          throw new Error('bad');
        })
        .mockReturnValueOnce(VALID_PARSED_RUN);

      await run();

      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('Failed to parse /bad.xml'));
      expect(mockMergeTestRuns).toHaveBeenCalledWith([
        { filePath: '/good.xml', parsed: VALID_PARSED_RUN },
      ]);
    });

    it('logs file count in info message', async () => {
      mockDiscoverReportFiles.mockResolvedValue(['/a.xml', '/b.xml']);

      await run();

      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('from 2 file(s)'));
    });

    it('handles mixed formats — JUnit + CTRF', async () => {
      mockDiscoverReportFiles.mockResolvedValue(['/a.xml', '/b.json']);
      mockReadFileSync.mockReturnValue('content');
      mockDetectFormat.mockImplementation((path: string) =>
        path.endsWith('.xml') ? 'junit' : 'ctrf',
      );

      await run();

      expect(mockParseJunitXml).toHaveBeenCalledTimes(1);
      expect(mockParseCtrfJson).toHaveBeenCalledTimes(1);
    });

    it('single-file backward compatibility — no merge needed', async () => {
      mockDiscoverReportFiles.mockResolvedValue(['/single.xml']);

      await run();

      expect(mockMergeTestRuns).toHaveBeenCalledWith([
        { filePath: '/single.xml', parsed: VALID_PARSED_RUN },
      ]);
    });
  });

  describe('auto-detection mode (Story 6.3)', () => {
    it('enters auto-detect mode when report-path is empty', async () => {
      setupInputs({ 'report-path': '' });
      mockAutoDetectReportFiles.mockResolvedValue({
        files: ['/project/junit.xml'],
        scannedPatterns: ['**/junit.xml'],
      });

      await run();

      expect(mockAutoDetectReportFiles).toHaveBeenCalled();
      expect(mockDiscoverReportFiles).not.toHaveBeenCalled();
      expect(mockMergeTestRuns).toHaveBeenCalled();
    });

    it('logs info message when entering auto-detect mode', async () => {
      setupInputs({ 'report-path': '' });
      mockAutoDetectReportFiles.mockResolvedValue({
        files: ['/project/junit.xml'],
        scannedPatterns: ['**/junit.xml'],
      });

      await run();

      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('auto-detect'));
    });

    it('processes auto-detected files through normal pipeline', async () => {
      setupInputs({ 'report-path': '' });
      mockAutoDetectReportFiles.mockResolvedValue({
        files: ['/project/a.xml', '/project/b.json'],
        scannedPatterns: [],
      });
      mockReadFileSync.mockReturnValue('content');
      mockDetectFormat.mockImplementation((path: string) =>
        path.endsWith('.xml') ? 'junit' : 'ctrf',
      );

      await run();

      expect(mockMergeTestRuns).toHaveBeenCalledWith([
        { filePath: '/project/a.xml', parsed: VALID_PARSED_RUN },
        { filePath: '/project/b.json', parsed: VALID_PARSED_RUN },
      ]);
    });

    it('warns and returns gracefully when auto-detect finds zero files', async () => {
      setupInputs({ 'report-path': '' });
      mockAutoDetectReportFiles.mockResolvedValue({
        files: [],
        scannedPatterns: [
          '**/test-results/**/*.xml',
          '**/junit.xml',
          '**/test-report.xml',
          '**/surefire-reports/*.xml',
          '**/test-results/**/*.json',
          '**/ctrf-report.json',
          '**/test-report.json',
        ],
      });

      await run();

      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringContaining('No test report files found'),
      );
      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('report-path'));
      expect(mockSendTestRun).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('skips auto-detect when report-path IS provided (AC #4)', async () => {
      setupInputs({ 'report-path': '/explicit/path.xml' });
      mockDiscoverReportFiles.mockResolvedValue(['/explicit/path.xml']);

      await run();

      expect(mockAutoDetectReportFiles).not.toHaveBeenCalled();
      expect(mockDiscoverReportFiles).toHaveBeenCalledWith('/explicit/path.xml');
    });
  });

  describe('Check Run creation (Story 6.4)', () => {
    it('calls createCheckRun when create-check is true and github-token is provided', async () => {
      setupInputs({ 'create-check': 'true', 'github-token': 'ghp_abc123' });

      await run();

      expect(mockCreateCheckRun).toHaveBeenCalledWith(
        expect.objectContaining({
          githubToken: 'ghp_abc123',
          checkName: 'Test Results',
          parsed: VALID_PARSED_RUN,
        }),
      );
    });

    it('uses custom check-name when provided', async () => {
      setupInputs({
        'create-check': 'true',
        'check-name': 'Unit Tests',
        'github-token': 'ghp_abc123',
      });

      await run();

      expect(mockCreateCheckRun).toHaveBeenCalledWith(
        expect.objectContaining({ checkName: 'Unit Tests' }),
      );
    });

    it('does not call createCheckRun when create-check is false', async () => {
      setupInputs({ 'create-check': 'false', 'github-token': 'ghp_abc123' });

      await run();

      expect(mockCreateCheckRun).not.toHaveBeenCalled();
    });

    it('does not call createCheckRun when create-check is empty (default)', async () => {
      setupInputs({ 'create-check': '', 'github-token': 'ghp_abc123' });

      await run();

      expect(mockCreateCheckRun).not.toHaveBeenCalled();
    });

    it('warns and skips when create-check is true but github-token is missing', async () => {
      setupInputs({ 'create-check': 'true', 'github-token': '' });
      const original = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;

      await run();

      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringContaining('create-check requires github-token'),
      );
      expect(mockCreateCheckRun).not.toHaveBeenCalled();
      if (original !== undefined) process.env.GITHUB_TOKEN = original;
    });

    it('continues normally when createCheckRun throws', async () => {
      setupInputs({ 'create-check': 'true', 'github-token': 'ghp_abc123' });
      mockCreateCheckRun.mockRejectedValue(new Error('Check run failed'));

      await run();

      expect(mockGenerateSummary).toHaveBeenCalled();
    });

    it('works independently of send-results flag', async () => {
      setupInputs({
        'create-check': 'true',
        'github-token': 'ghp_abc123',
        'send-results': 'false',
      });

      await run();

      expect(mockCreateCheckRun).toHaveBeenCalled();
      expect(mockSendTestRun).not.toHaveBeenCalled();
    });
  });
});
