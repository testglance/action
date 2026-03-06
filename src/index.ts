import * as core from '@actions/core';
import { existsSync, readFileSync } from 'node:fs';
import { parseJunitXml } from './parsers/junit';
import { parseCtrfJson } from './parsers/ctrf';
import { sendTestRun } from './api/client';
import { detectFormat } from './utils/detect-format';
import {
  handleFileNotFound,
  handleParseError,
  handleApiUnreachable,
  handleApiError,
  handleUnexpectedError,
} from './utils/errors';
import type { ParsedTestRun } from './types';

export async function run(): Promise<void> {
  try {
    const reportPath = core.getInput('report-path', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const apiUrl = core.getInput('api-url') || 'https://api.testglance.com';
    const reportFormat = core.getInput('report-format') || 'auto';

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
      // Auto-detect returned null (unknown extension) — try both parsers
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

    const result = await sendTestRun(apiUrl, apiKey, parsed);

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

    // Story 1.5 integration point: generateSummary(parsed, result)
  } catch (err) {
    handleUnexpectedError(err instanceof Error ? err : new Error(String(err)));
  }
}

run();
