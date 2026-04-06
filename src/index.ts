import * as core from '@actions/core';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseJunitXml } from './parsers/junit';
import { parseCtrfJson } from './parsers/ctrf';
import { sendTestRun } from './api/client';
import { detectFormat } from './utils/detect-format';
import { detectFramework } from './utils/detect-framework';
import { discoverReportFiles } from './utils/discover-files';
import { autoDetectReportFiles } from './utils/auto-detect';
import { mergeTestRuns } from './utils/merge-results';
import { handleApiUnreachable, handleApiError, handleUnexpectedError } from './utils/errors';
import { generateSummary } from './output/summary';
import { postPrComment } from './output/post-pr-comment';
import { createCheckRun } from './output/check-run';
import { generateHtmlReport } from './output/html-report';
import { uploadArtifact } from './output/upload-artifact';
import { ActionsCacheStorage } from './history/actions-cache-storage';
import { HistoryManager } from './history/manager';
import type { ParsedTestRun } from './types';
import type { FileParseResult } from './utils/merge-results';
import type {
  HistoryFile,
  DeltaComparison,
  TestsChangedReport,
  FlakyDetectionResult,
  PerfRegressionResult,
  TrendIndicators,
} from './history/types';
import { computeDelta, computeTestsChanged } from './history/comparison';
import { detectFlakyTests } from './history/flaky-detection';
import { detectPerfRegressions } from './history/perf-regression';
import { computeTrends } from './history/trends';

const DEFAULT_SLOWEST_TESTS = 10;
const DEFAULT_FLAKY_THRESHOLD = 2;
const DEFAULT_PERF_THRESHOLD = 200;

function parseSlowestTestsCount(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_SLOWEST_TESTS;
  }

  if (!/^\d+$/.test(trimmed)) {
    core.warning(
      `Invalid "slowest-tests" input "${input}". Expected a non-negative integer; defaulting to ${DEFAULT_SLOWEST_TESTS}.`,
    );
    return DEFAULT_SLOWEST_TESTS;
  }

  return Number.parseInt(trimmed, 10);
}

function parseFlakyThreshold(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_FLAKY_THRESHOLD;
  }

  if (!/^\d+$/.test(trimmed)) {
    core.warning(
      `Invalid "flaky-threshold" input "${input}". Expected a positive integer; defaulting to ${DEFAULT_FLAKY_THRESHOLD}.`,
    );
    return DEFAULT_FLAKY_THRESHOLD;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 1) {
    core.warning(
      `Invalid "flaky-threshold" input "${input}". Expected a positive integer; defaulting to ${DEFAULT_FLAKY_THRESHOLD}.`,
    );
    return DEFAULT_FLAKY_THRESHOLD;
  }

  return parsed;
}

function parsePerfThreshold(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_PERF_THRESHOLD;
  }

  if (!/^\d+$/.test(trimmed)) {
    core.warning(
      `Invalid "perf-threshold" input "${input}". Expected a non-negative integer; defaulting to ${DEFAULT_PERF_THRESHOLD}.`,
    );
    return DEFAULT_PERF_THRESHOLD;
  }

  return Number.parseInt(trimmed, 10);
}

function parseFile(filePath: string, reportFormat: string): ParsedTestRun | null {
  const content = readFileSync(filePath, 'utf-8');
  const format = reportFormat === 'auto' ? detectFormat(filePath) : reportFormat;

  if (format === 'junit') {
    return parseJunitXml(content);
  } else if (format === 'ctrf') {
    return parseCtrfJson(content);
  } else {
    try {
      return parseJunitXml(content);
    } catch {
      return parseCtrfJson(content);
    }
  }
}

export interface RunResult {
  history: HistoryFile | null;
}

export async function run(): Promise<RunResult> {
  try {
    const reportPath = core.getInput('report-path');
    const apiKey = core.getInput('api-key', { required: true });
    const apiUrl = core.getInput('api-url') || 'https://www.testglance.dev';
    const reportFormat = core.getInput('report-format') || 'auto';
    const testJobName = core.getInput('test-job-name') || '';
    const githubToken = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
    const sendResults = core.getInput('send-results') !== 'false';
    const createCheck = core.getInput('create-check') === 'true';
    const checkName = core.getInput('check-name') || 'Test Results';
    const slowestTestsCount = parseSlowestTestsCount(core.getInput('slowest-tests'));
    const flakyThreshold = parseFlakyThreshold(core.getInput('flaky-threshold'));
    const perfThreshold = parsePerfThreshold(core.getInput('perf-threshold'));
    const htmlReport = core.getInput('html-report') === 'true';
    const artifactName = core.getInput('artifact-name') || 'testglance-report';
    const historyEnabled = core.getInput('history') !== 'false';
    const historyLimitRaw = core.getInput('history-limit') || '20';
    const historyLimitParsed = parseInt(historyLimitRaw, 10);
    if (isNaN(historyLimitParsed) || historyLimitRaw !== String(historyLimitParsed)) {
      core.warning(
        `Invalid "history-limit" input "${historyLimitRaw}". Expected a positive integer; defaulting to 20.`,
      );
    }
    const historyLimit = Math.max(1, historyLimitParsed || 20);

    let files: string[];

    if (reportPath) {
      files = await discoverReportFiles(reportPath);

      if (files.length === 0) {
        core.warning(`No report files found matching: ${reportPath}`);
        return { history: null };
      }
    } else {
      core.info('No report-path provided, entering auto-detect mode');
      const result = await autoDetectReportFiles();
      files = result.files;

      if (files.length === 0) {
        const patterns = result.scannedPatterns.map((p) => `  - ${p}`).join('\n');
        core.warning(
          `No test report files found. Scanned these patterns:\n${patterns}\nTip: Specify the 'report-path' input with the path to your test report file(s).`,
        );
        return { history: null };
      }
    }

    const successful: FileParseResult[] = [];

    for (const filePath of files) {
      try {
        const parsed = parseFile(filePath, reportFormat);
        if (parsed) {
          successful.push({ filePath, parsed });
        }
      } catch (err) {
        core.warning(
          `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (successful.length === 0) {
      core.warning('All report files failed to parse');
      return { history: null };
    }

    const parsed = mergeTestRuns(successful);

    core.info(
      `Parsed ${parsed.summary.total} tests from ${successful.length} file(s): ${parsed.summary.passed} passed, ${parsed.summary.failed} failed, ${parsed.summary.skipped} skipped, ${parsed.summary.errored} errored`,
    );

    let loadedHistory: HistoryFile | null = null;
    let delta: DeltaComparison | null = null;
    let testsChanged: TestsChangedReport | null = null;

    if (historyEnabled) {
      try {
        const branch = (
          process.env.GITHUB_HEAD_REF ||
          process.env.GITHUB_REF_NAME ||
          'unknown'
        ).replace(/^refs\/heads\//, '');
        const reportPathHash = createHash('sha256')
          .update(reportPath || 'auto')
          .digest('hex')
          .slice(0, 8);
        const commitSha = process.env.GITHUB_SHA || 'unknown';
        const runId = process.env.GITHUB_RUN_ID;

        const storage = new ActionsCacheStorage(branch, reportPathHash, runId);
        const manager = new HistoryManager(storage, historyLimit);

        await manager.loadHistory();

        if (manager.isFirstRun()) {
          core.info('First run on this branch — history tracking started');
        }

        manager.appendRun(parsed, {
          timestamp: new Date().toISOString(),
          commitSha,
          branch,
        });

        await manager.saveHistory();
        loadedHistory = manager.getHistory();

        if (loadedHistory && loadedHistory.entries.length >= 2) {
          const entries = loadedHistory.entries;
          try {
            delta = computeDelta(entries[entries.length - 2], entries[entries.length - 1]);
          } catch (err) {
            core.debug(
              `Delta comparison failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          try {
            testsChanged = computeTestsChanged(
              entries[entries.length - 2],
              entries[entries.length - 1],
            );
          } catch (err) {
            core.debug(
              `Tests changed computation failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } catch (err) {
        core.warning(
          `History tracking failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let flaky: FlakyDetectionResult | null = null;

    if (loadedHistory && loadedHistory.entries.length >= 5) {
      try {
        flaky = detectFlakyTests(loadedHistory.entries, flakyThreshold);
      } catch (err) {
        core.debug(`Flaky detection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (historyEnabled && loadedHistory) {
      core.debug('Need at least 5 runs for flaky detection');
    }

    let perfRegression: PerfRegressionResult | null = null;

    if (loadedHistory && loadedHistory.entries.length >= 3) {
      try {
        perfRegression = detectPerfRegressions(loadedHistory.entries, perfThreshold);
        if (loadedHistory.entries.length < 4) {
          core.debug(
            'Performance regression detection needs 4 runs (3 baseline + current); collecting baseline data',
          );
        }
      } catch (err) {
        core.debug(
          `Performance regression detection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (historyEnabled && loadedHistory) {
      core.debug('Need at least 3 runs for performance regression detection');
    }

    let trends: TrendIndicators | null = null;

    if (loadedHistory && loadedHistory.entries.length >= 3) {
      try {
        trends = computeTrends(loadedHistory.entries);
      } catch (err) {
        core.debug(`Trend computation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let baseDelta: DeltaComparison | null = null;
    const baseBranch = (process.env.GITHUB_BASE_REF || '').replace(/^refs\/heads\//, '');

    if (historyEnabled && baseBranch && loadedHistory) {
      try {
        const reportPathHash = createHash('sha256')
          .update(reportPath || 'auto')
          .digest('hex')
          .slice(0, 8);
        const baseStorage = new ActionsCacheStorage(baseBranch, reportPathHash);
        const baseManager = new HistoryManager(baseStorage, historyLimit);
        const baseHistory = await baseManager.loadHistory();

        if (baseHistory && baseHistory.entries.length > 0) {
          const baseLatest = baseHistory.entries[baseHistory.entries.length - 1];
          const currentEntry = loadedHistory.entries[loadedHistory.entries.length - 1];
          baseDelta = computeDelta(baseLatest, currentEntry);
        }
      } catch (err) {
        core.debug(
          `Base branch comparison failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const firstFile = successful[0].filePath;
    const format = reportFormat === 'auto' ? detectFormat(firstFile) : reportFormat;
    const framework = detectFramework(
      firstFile,
      format === 'junit' || format === 'ctrf' ? format : null,
      parsed.toolName,
    );

    let result: Awaited<ReturnType<typeof sendTestRun>> | undefined;

    if (sendResults) {
      result = await sendTestRun(apiUrl, apiKey, parsed, {
        framework,
        testJobName: testJobName || undefined,
      });

      if (result.success) {
        core.info(`TestGlance: Test run submitted successfully (${result.runId})`);
        if (result.healthScore !== null && result.healthScore !== undefined) {
          core.info(`TestGlance: Health score: ${result.healthScore}`);
        }
      } else if (result.errorCode === 'NETWORK_ERROR') {
        handleApiUnreachable();
      } else {
        handleApiError(result.errorCode ?? 'UNKNOWN', result.errorMessage ?? 'Unknown error');
      }
    }

    const dashboardUrl = result?.success
      ? `https://www.testglance.dev/runs/${result.runId}`
      : undefined;

    const runUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    let artifactUrl: string | undefined;

    if (htmlReport) {
      try {
        const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'unknown';
        const html = generateHtmlReport({
          parsed,
          apiSuccess: result?.success ?? false,
          healthScore: result?.healthScore,
          dashboardUrl,
          highlights: result?.highlights ?? [],
          slowestTests: slowestTestsCount,
          delta,
          testsChanged,
          flaky,
          perfRegression,
          trends,
          commitSha: process.env.GITHUB_SHA || 'unknown',
          branch,
          workflowRunUrl: runUrl,
          timestamp: new Date().toISOString(),
        });
        const uploadSuccess = await uploadArtifact(html, artifactName);
        if (uploadSuccess) {
          artifactUrl = `${runUrl}#artifacts`;
        }
      } catch (err) {
        core.warning(
          `HTML report generation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await generateSummary({
      parsed,
      apiSuccess: result?.success ?? false,
      runId: result?.runId,
      healthScore: result?.healthScore,
      dashboardUrl,
      highlights: result?.highlights ?? [],
      slowestTests: slowestTestsCount,
      delta,
      testsChanged,
      flaky,
      perfRegression,
      trends,
      artifactUrl,
    });

    if (createCheck) {
      if (githubToken) {
        await createCheckRun({ githubToken, checkName, parsed });
      } else {
        core.warning('create-check requires github-token — skipping Check Run creation');
      }
    }

    if (githubToken && result?.success) {
      await postPrComment({
        githubToken,
        section: {
          testJobName: testJobName || process.env.GITHUB_JOB || 'tests',
          status: parsed.summary.failed > 0 ? 'failed' : 'passed',
          total: parsed.summary.total,
          passed: parsed.summary.passed,
          failed: parsed.summary.failed,
          duration: parsed.summary.duration,
          healthScore: result.healthScore,
          highlights: result.highlights ?? [],
          runUrl: dashboardUrl,
          testsChanged,
          flaky,
          perfRegression,
          trends,
          baseDelta: historyEnabled && baseBranch ? baseDelta : undefined,
          baseBranch: historyEnabled && baseBranch ? baseBranch : undefined,
          artifactUrl,
        },
      });
    }

    return { history: loadedHistory };
  } catch (err) {
    handleUnexpectedError(err instanceof Error ? err : new Error(String(err)));
    return { history: null };
  }
}

run();
