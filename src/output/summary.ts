import * as core from '@actions/core';
import type { ParsedTestRun, ParsedTestCase } from '../types';

export interface SummaryOptions {
  parsed: ParsedTestRun;
  apiSuccess: boolean;
  runId?: string;
  healthScore?: number | null;
  dashboardUrl?: string;
  flakyCount?: number;
}

const MAX_FAILED_TESTS_SHOWN = 10;
const MAX_ERROR_MESSAGE_LENGTH = 200;

export async function generateSummary(options: SummaryOptions): Promise<void> {
  const { parsed, apiSuccess, healthScore, dashboardUrl, flakyCount } = options;
  const { summary } = parsed;
  const passRate = summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : '0.0';

  core.summary.addHeading('TestGlance Results', 2);

  core.summary.addTable([
    [
      { data: 'Metric', header: true },
      { data: 'Value', header: true },
    ],
    ['Total', String(summary.total)],
    ['Passed', String(summary.passed)],
    ['Failed', String(summary.failed)],
    ['Skipped', String(summary.skipped)],
    ['Errored', String(summary.errored)],
    ['Pass Rate', `${passRate}%`],
    ['Duration', formatDuration(summary.duration)],
  ]);

  if (apiSuccess && healthScore !== null && healthScore !== undefined) {
    core.summary.addRaw(`**Health Score:** ${healthScore}/100\n\n`);
  } else if (apiSuccess) {
    core.summary.addRaw('**Health Score:** available after 5 runs\n\n');
  }

  if (flakyCount && flakyCount > 0) {
    core.summary.addRaw(`**Flaky tests detected:** ${flakyCount}\n\n`);
  }

  const failedTests = collectFailedTests(parsed);
  if (failedTests.length > 0) {
    core.summary.addHeading('Failed Tests', 3);
    const shown = failedTests.slice(0, MAX_FAILED_TESTS_SHOWN);
    const rows = shown.map((t) => [
      t.suite,
      t.name,
      truncate(t.errorMessage ?? 'No error message', MAX_ERROR_MESSAGE_LENGTH),
    ]);
    core.summary.addTable([
      [
        { data: 'Suite', header: true },
        { data: 'Test', header: true },
        { data: 'Error', header: true },
      ],
      ...rows,
    ]);
    if (failedTests.length > MAX_FAILED_TESTS_SHOWN) {
      core.summary.addRaw(
        `... and ${failedTests.length - MAX_FAILED_TESTS_SHOWN} more failed tests\n\n`,
      );
    }
  }

  if (!apiSuccess) {
    core.summary.addRaw('> **Note:** API submission failed — dashboard data not updated.\n\n');
  }

  if (dashboardUrl) {
    core.summary.addLink('View Dashboard', dashboardUrl);
    core.summary.addRaw('\n');
  }

  await core.summary.write();
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toFixed(1)}s`;
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function collectFailedTests(parsed: ParsedTestRun): ParsedTestCase[] {
  return parsed.suites.flatMap((suite) =>
    suite.tests.filter((t) => t.status === 'failed' || t.status === 'errored'),
  );
}
