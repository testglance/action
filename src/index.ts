import * as core from '@actions/core';
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
import type { ParsedTestRun } from './types';
import type { FileParseResult } from './utils/merge-results';

const DEFAULT_SLOWEST_TESTS = 10;

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

export async function run(): Promise<void> {
  try {
    const reportPath = core.getInput('report-path');
    const apiKey = core.getInput('api-key', { required: true });
    const apiUrl = core.getInput('api-url') || 'https://www.testglance.dev';
    const reportFormat = core.getInput('report-format') || 'auto';
    const testJobName = core.getInput('test-job-name') || '';
    const githubToken = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
    const sendResults = core.getInput('send-results') !== 'false';
    const slowestTestsCount = parseSlowestTestsCount(core.getInput('slowest-tests'));

    let files: string[];

    if (reportPath) {
      files = await discoverReportFiles(reportPath);

      if (files.length === 0) {
        core.warning(`No report files found matching: ${reportPath}`);
        return;
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
        return;
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
      return;
    }

    const parsed = mergeTestRuns(successful);

    core.info(
      `Parsed ${parsed.summary.total} tests from ${successful.length} file(s): ${parsed.summary.passed} passed, ${parsed.summary.failed} failed, ${parsed.summary.skipped} skipped, ${parsed.summary.errored} errored`,
    );

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

    await generateSummary({
      parsed,
      apiSuccess: result?.success ?? false,
      runId: result?.runId,
      healthScore: result?.healthScore,
      dashboardUrl,
      highlights: result?.highlights ?? [],
      slowestTests: slowestTestsCount,
    });

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
        },
      });
    }
  } catch (err) {
    handleUnexpectedError(err instanceof Error ? err : new Error(String(err)));
  }
}

run();
