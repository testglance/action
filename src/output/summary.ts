import * as core from '@actions/core';
import type { ParsedTestRun, ParsedTestCase, Highlight, HighlightSeverity } from '../types';

export interface SummaryOptions {
  parsed: ParsedTestRun;
  apiSuccess: boolean;
  runId?: string;
  healthScore?: number | null;
  dashboardUrl?: string;
  flakyCount?: number;
  highlights?: Highlight[];
  slowestTests?: number;
}

const MAX_FAILED_TESTS_SHOWN = 25;
const MAX_ERROR_MESSAGE_LENGTH = 200;
const MAX_STACK_TRACE_LINES = 30;

export async function generateSummary(options: SummaryOptions): Promise<void> {
  const { parsed, apiSuccess, healthScore, dashboardUrl, flakyCount, highlights, slowestTests } =
    options;
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

  if (highlights && highlights.length > 0) {
    core.summary.addRaw(renderHighlights(highlights, dashboardUrl));
  }

  try {
    const failedTests = collectFailedTests(parsed).sort((a, b) => a.suite.localeCompare(b.suite));
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

      for (const t of shown) {
        if (t.stackTrace) {
          core.summary.addRaw(renderStackTrace(t.name, t.stackTrace));
        }
      }

      if (failedTests.length > MAX_FAILED_TESTS_SHOWN) {
        core.summary.addRaw(
          `... and ${failedTests.length - MAX_FAILED_TESTS_SHOWN} more failed tests\n\n`,
        );
      }
    }

    if (slowestTests && slowestTests > 0) {
      const allTests = parsed.suites.flatMap((s) => s.tests);
      const withDuration = allTests.filter((t) => t.duration > 0);
      const sorted = [...withDuration].sort((a, b) => b.duration - a.duration);
      const top = sorted.slice(0, slowestTests);
      if (top.length > 0) {
        core.summary.addHeading('Slowest Tests', 3);
        core.summary.addTable([
          [
            { data: 'Test', header: true },
            { data: 'Suite', header: true },
            { data: 'Duration', header: true },
          ],
          ...top.map((t) => [t.name, t.suite, formatDuration(t.duration)]),
        ]);
      }
    }
  } catch (err) {
    core.warning(
      `Enhanced summary generation failed, using basic summary: ${err instanceof Error ? err.message : String(err)}`,
    );
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

function renderStackTrace(testName: string, stackTrace: string): string {
  const lines = stackTrace.split('\n');
  let truncated = lines.slice(0, MAX_STACK_TRACE_LINES).join('\n');
  if (lines.length > MAX_STACK_TRACE_LINES) {
    truncated += `\n... ${lines.length - MAX_STACK_TRACE_LINES} more lines truncated`;
  }
  return `<details><summary>Stack trace: ${testName}</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n\n</details>\n\n`;
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

const MAX_HIGHLIGHTS_SHOWN = 3;
const MAX_TEST_NAMES_SHOWN = 3;

const SEVERITY_EMOJI: Record<HighlightSeverity, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

const SEVERITY_ORDER: Record<HighlightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function renderHighlights(highlights: Highlight[], dashboardUrl?: string): string {
  const sorted = [...highlights].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const shown = sorted.slice(0, MAX_HIGHLIGHTS_SHOWN);
  const lines: string[] = ['### Highlights\n\n'];

  for (const h of shown) {
    lines.push(`${SEVERITY_EMOJI[h.severity]} ${renderHighlightMessage(h)}\n\n`);
  }

  if (sorted.length > MAX_HIGHLIGHTS_SHOWN && dashboardUrl) {
    lines.push(`**[View all highlights on dashboard →](${dashboardUrl})**\n\n`);
  }

  return lines.join('');
}

function renderHighlightMessage(h: Highlight): string {
  const data = h.data as Record<string, unknown>;
  switch (h.type) {
    case 'new_failures': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      const names = tests.slice(0, MAX_TEST_NAMES_SHOWN).map((t) => t.name);
      const suffix =
        tests.length > MAX_TEST_NAMES_SHOWN ? `, +${tests.length - MAX_TEST_NAMES_SHOWN} more` : '';
      return `**NEW FAILURES:** ${names.join(', ')}${suffix}`;
    }
    case 'health_score_delta': {
      const prev = data.previous as number | null;
      const current = data.current as number | null;
      const direction = data.direction as string;
      const arrow = direction === 'down' ? '▼' : direction === 'up' ? '▲' : '';
      return `**Health Score:** ${prev ?? '?'} → ${current ?? '?'} ${arrow}`;
    }
    case 'duration_delta': {
      const currentDuration = data.currentDuration as number;
      const deltaPercent = data.deltaPercent as number;
      const sign = deltaPercent >= 0 ? '+' : '';
      return `**Duration:** ${formatDuration(currentDuration)} (${sign}${deltaPercent}% vs baseline)`;
    }
    case 'fixed_tests': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      return `**Fixed:** ${tests.length} test(s) now passing`;
    }
    case 'new_tests': {
      const count = (data.count as number) ?? 0;
      return `**${count} new test(s) added**`;
    }
    case 'known_flaky': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      return `**${tests.length} known flaky test(s) in this run**`;
    }
    default:
      return h.message;
  }
}
