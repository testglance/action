import * as core from '@actions/core';
import { existsSync, readFileSync } from 'node:fs';
import { parseJunitXml } from './parsers/junit';
import { parseCtrfJson } from './parsers/ctrf';
import { sendTestRun } from './api/client';
import { detectFormat } from './utils/detect-format';
import { detectFramework } from './utils/detect-framework';
import {
  handleFileNotFound,
  handleParseError,
  handleApiUnreachable,
  handleApiError,
  handleUnexpectedError,
} from './utils/errors';
import { generateSummary } from './output/summary';
import { postPrComment } from './output/post-pr-comment';
import type { ParsedTestRun } from './types';

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

export async function run(): Promise<void> {
  try {
    const reportPath = core.getInput('report-path', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const apiUrl = core.getInput('api-url') || 'https://www.testglance.dev';
    const reportFormat = core.getInput('report-format') || 'auto';
    const testJobName = core.getInput('test-job-name') || '';
    const githubToken = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
    const sendResults = core.getInput('send-results') !== 'false';
    const slowestTestsCount = parseSlowestTestsCount(core.getInput('slowest-tests'));

    if (!existsSync(reportPath)) {
      handleFileNotFound(reportPath);
      return;
    }

    const content = readFileSync(reportPath, 'utf-8');

    let parsed: ParsedTestRun | null = null;
    const format = reportFormat === 'auto' ? detectFormat(reportPath) : reportFormat;

    if (format === 'junit') {
      try {
        parsed = parseJunitXml(content);
      } catch (err) {
        handleParseError('JUnit XML', err as Error);
        return;
      }
    } else if (format === 'ctrf') {
      try {
        parsed = parseCtrfJson(content);
      } catch (err) {
        handleParseError('CTRF JSON', err as Error);
        return;
      }
    } else {
      try {
        parsed = parseJunitXml(content);
      } catch {
        try {
          parsed = parseCtrfJson(content);
        } catch (err) {
          handleParseError('auto-detected', err as Error);
          return;
        }
      }
    }

    if (!parsed) return;

    core.info(
      `Parsed ${parsed.summary.total} tests: ${parsed.summary.passed} passed, ${parsed.summary.failed} failed, ${parsed.summary.skipped} skipped, ${parsed.summary.errored} errored`,
    );

    const framework = detectFramework(
      reportPath,
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
