import * as core from '@actions/core';
import type {
  ParsedTestRun,
  ParsedSuite,
  ParsedTestCase,
  Highlight,
  HighlightSeverity,
} from '../types';
import type {
  DeltaComparison,
  TestsChangedReport,
  FlakyDetectionResult,
  PerfRegressionResult,
  TrendIndicators,
} from '../history/types';
import {
  escapeHtml,
  formatDuration,
  formatDurationPair,
  truncate,
  renderProgressBar,
  statusEmoji,
  renderMetricsStrip,
} from './format';

export { formatDuration, truncate } from './format';

export interface SummaryOptions {
  parsed: ParsedTestRun;
  apiSuccess: boolean;
  runId?: string;
  healthScore?: number | null;
  dashboardUrl?: string;
  flakyCount?: number;
  highlights?: Highlight[];
  slowestTests?: number;
  delta?: DeltaComparison | null;
  testsChanged?: TestsChangedReport | null;
  flaky?: FlakyDetectionResult | null;
  perfRegression?: PerfRegressionResult | null;
  trends?: TrendIndicators | null;
  artifactUrl?: string;
}

const MAX_FAILED_TESTS_SHOWN = 25;
const MAX_ERROR_MESSAGE_LENGTH = 200;
const MAX_STACK_TRACE_LINES = 30;

export async function generateSummary(options: SummaryOptions): Promise<void> {
  const {
    parsed,
    apiSuccess,
    healthScore,
    dashboardUrl,
    flakyCount,
    highlights,
    slowestTests,
    delta,
    testsChanged,
    flaky,
    perfRegression,
    trends,
  } = options;
  const { summary } = parsed;
  const passRate = summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : '0.0';

  core.summary.addRaw(
    `## ${statusEmoji(summary.failed)} TestGlance Results — ${passRate}% pass rate\n\n`,
  );

  if (!apiSuccess) {
    core.summary.addRaw('> ⚠️ **API submission failed** — dashboard data not updated\n\n');
  }

  core.summary.addRaw(`${renderProgressBar(Number(passRate))}\n\n`);

  let metricsLine = `${renderMetricsStrip(summary)} · ⏱️ ${formatDuration(summary.duration)}`;
  if (apiSuccess && healthScore !== null && healthScore !== undefined) {
    metricsLine += ` · 🏥 ${healthScore}/100`;
  } else if (apiSuccess) {
    metricsLine += ' · 🏥 available after 5 runs';
  }
  core.summary.addRaw(`${metricsLine}\n\n`);

  if (flakyCount && flakyCount > 0) {
    core.summary.addRaw(`**Flaky tests detected:** ${flakyCount}\n\n`);
  }

  if (highlights && highlights.length > 0) {
    core.summary.addRaw(renderHighlights(highlights, dashboardUrl));
  }

  if (trends) {
    core.summary.addRaw(renderTrendsSection(trends));
  }

  core.summary.addRaw('---\n\n');

  if (delta) {
    core.summary.addRaw(renderDeltaSection(delta));
  }

  if (testsChanged && testsChanged.hasChanges) {
    core.summary.addRaw(renderTestsChangedSection(testsChanged));
  }

  if (flaky && flaky.hasFlakyTests) {
    core.summary.addRaw(renderFlakySection(flaky));
  }

  if (perfRegression) {
    core.summary.addRaw(renderPerfRegressionSection(perfRegression));
  }

  try {
    if (parsed.suites.length > 1) {
      renderSuiteBreakdown(parsed.suites);
    }

    const failedTests = collectFailedTests(parsed).sort((a, b) => a.suite.localeCompare(b.suite));
    if (failedTests.length > 0) {
      core.summary.addRaw('---\n\n');
      core.summary.addRaw('### ❌ Failed Tests\n\n');
      const shown = failedTests.slice(0, MAX_FAILED_TESTS_SHOWN);

      for (const t of shown) {
        const error = truncate(t.errorMessage ?? 'No error message', MAX_ERROR_MESSAGE_LENGTH);
        core.summary.addRaw(
          `🔴 **\`${escapeHtml(t.name)}\`** · \`${escapeHtml(t.suite)}\`\n` +
            `> ${escapeHtml(error)}\n\n`,
        );
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
      const withDuration = allTests.filter((t) => t.duration >= 0.2);
      const sorted = [...withDuration].sort((a, b) => b.duration - a.duration);
      const top = sorted.slice(0, slowestTests);
      if (top.length > 0) {
        core.summary.addRaw('### 🐌 Slowest Tests\n\n');
        core.summary.addRaw(
          '<details><summary>Slowest ' +
            top.length +
            ' tests</summary>\n\n' +
            '<table>\n<tr><th>Test</th><th>Suite</th><th>Duration</th></tr>\n' +
            top
              .map(
                (t) =>
                  `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td><td>${formatDuration(t.duration)}</td></tr>`,
              )
              .join('\n') +
            '\n</table>\n\n</details>\n\n',
        );
      }
    }
  } catch (err) {
    core.warning(
      `Enhanced summary generation failed, using basic summary: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (dashboardUrl) {
    core.summary.addLink('View Dashboard', dashboardUrl);
    core.summary.addRaw('\n');
  }

  if (options.artifactUrl) {
    core.summary.addRaw(`📄 [Download HTML Report](${options.artifactUrl})\n`);
  }

  await core.summary.write();
}

function renderStackTrace(testName: string, stackTrace: string): string {
  const lines = stackTrace.split('\n');
  let truncated = lines.slice(0, MAX_STACK_TRACE_LINES).join('\n');
  const safeTestName = escapeHtml(testName);
  if (lines.length > MAX_STACK_TRACE_LINES) {
    truncated += `\n... ${lines.length - MAX_STACK_TRACE_LINES} more lines truncated`;
  }
  return `<details><summary>Stack trace: ${safeTestName}</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n\n</details>\n\n`;
}

export function collectFailedTests(parsed: ParsedTestRun): ParsedTestCase[] {
  return parsed.suites.flatMap((suite) =>
    suite.tests.filter((t) => t.status === 'failed' || t.status === 'errored'),
  );
}

export function renderSuiteBreakdown(suites: ParsedSuite[]): void {
  const rows = suites
    .map((s) => {
      const total = s.tests.length;
      const passed = s.tests.filter((t) => t.status === 'passed').length;
      const failed = s.tests.filter((t) => t.status === 'failed' || t.status === 'errored').length;
      const skipped = s.tests.filter((t) => t.status === 'skipped').length;
      const passRate = total > 0 ? (passed / total) * 100 : -1;
      return { name: s.name, total, passed, failed, skipped, passRate, duration: s.duration };
    })
    .sort((a, b) => {
      if (a.passRate < 0) return 1;
      if (b.passRate < 0) return -1;
      return a.passRate - b.passRate;
    });

  const tableRows = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${r.total}</td><td>${r.passed}</td><td>${r.failed}</td><td>${r.skipped}</td><td>${r.total > 0 ? `${r.passRate.toFixed(1)}%` : 'N/A'}</td><td>${formatDuration(r.duration)}</td></tr>`,
    )
    .join('\n');

  core.summary.addRaw(
    `<details><summary><strong>Suite Breakdown</strong> (${suites.length} suites)</summary>\n\n` +
      '<table>\n' +
      '<tr><th>Suite</th><th>Total</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Pass Rate</th><th>Duration</th></tr>\n' +
      tableRows +
      '\n</table>\n\n</details>\n\n',
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
  const lines: string[] = ['### 💡 Highlights\n\n'];

  for (const h of shown) {
    lines.push(`${SEVERITY_EMOJI[h.severity]} ${renderHighlightMessage(h)}\n\n`);
  }

  if (sorted.length > MAX_HIGHLIGHTS_SHOWN && dashboardUrl) {
    lines.push(`**[View all highlights on dashboard →](${dashboardUrl})**\n\n`);
  }

  return lines.join('');
}

const MAX_DELTA_TESTS_SHOWN = 10;

const DELTA_STATUS_EMOJI: Record<string, string> = {
  added: '🆕 Added',
  removed: '🗑️ Removed',
  newlyFailing: '❌ New Failure',
  newlyPassing: '✅ Now Passing',
};

export function renderDeltaSection(delta: DeltaComparison): string {
  const lines: string[] = ['### 🔄 Changes Since Last Run\n\n'];

  const sign = (n: number) => (n >= 0 ? '+' : '-');

  if (!delta.hasChanges) {
    lines.push('✅ No changes since last run\n\n');
    return lines.join('');
  }

  lines.push(
    `**Pass rate:** ${delta.passRatePrev.toFixed(1)}% → ${delta.passRateCurr.toFixed(1)}% (${sign(delta.passRateDelta)}${Math.abs(delta.passRateDelta).toFixed(1)}%)\n\n`,
  );

  const durSign = sign(delta.durationDelta);
  const [prevDur, currDur] = formatDurationPair(delta.durationPrev, delta.durationCurr);
  lines.push(
    `**Duration:** ${prevDur} → ${currDur} (${durSign}${formatDuration(Math.abs(delta.durationDelta))}, ${durSign}${Math.abs(delta.durationDeltaPercent).toFixed(1)}%)\n\n`,
  );

  const categories: { key: string; tests: DeltaComparison[keyof DeltaComparison] }[] = [
    { key: 'added', tests: delta.testsAdded },
    { key: 'newlyFailing', tests: delta.newlyFailing },
    { key: 'newlyPassing', tests: delta.newlyPassing },
    { key: 'removed', tests: delta.testsRemoved },
  ];

  const nonEmpty = categories.filter(
    (c) => Array.isArray(c.tests) && (c.tests as unknown[]).length > 0,
  );

  if (nonEmpty.length > 0) {
    const allRows: string[] = [];

    for (const cat of nonEmpty) {
      const tests = cat.tests as DeltaComparison['testsAdded'];
      const shown = tests.slice(0, MAX_DELTA_TESTS_SHOWN);
      for (const t of shown) {
        allRows.push(
          `<tr><td>${DELTA_STATUS_EMOJI[cat.key]}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td></tr>`,
        );
      }
      if (tests.length > MAX_DELTA_TESTS_SHOWN) {
        allRows.push(
          `<tr><td>${DELTA_STATUS_EMOJI[cat.key]}</td><td colspan="2"><em>and ${tests.length - MAX_DELTA_TESTS_SHOWN} more...</em></td></tr>`,
        );
      }
    }

    const totalTests = nonEmpty.reduce((sum, c) => sum + (c.tests as unknown[]).length, 0);
    const needsCollapse = totalTests > MAX_DELTA_TESTS_SHOWN;

    const table =
      '<table>\n<tr><th>Status</th><th>Test</th><th>Suite</th></tr>\n' +
      allRows.join('\n') +
      '\n</table>\n\n';

    if (needsCollapse) {
      lines.push(
        `<details><summary><strong>Changed tests</strong> (${totalTests} tests)</summary>\n\n${table}</details>\n\n`,
      );
    } else {
      lines.push(table);
    }
  }

  return lines.join('');
}

const MAX_TESTS_CHANGED_SHOWN = 20;

const TESTS_CHANGED_STATUS_EMOJI: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  skipped: '⏭️',
  errored: '💥',
};

export function renderTestsChangedSection(report: TestsChangedReport): string {
  if (!report.hasChanges) return '';

  const lines: string[] = ['### 📝 Tests Changed\n\n'];

  if (report.newTests.length > 0) {
    lines.push(`#### New Tests (${report.newTests.length})\n\n`);
    const shown = report.newTests.slice(0, MAX_TESTS_CHANGED_SHOWN);
    const rows = shown.map(
      (t) =>
        `| ${escapeHtml(t.name)} | ${escapeHtml(t.suite)} | ${TESTS_CHANGED_STATUS_EMOJI[t.status] ?? ''} ${t.status} | ${formatDuration(t.duration)} |`,
    );
    const table =
      '| Test | Suite | Status | Duration |\n|------|-------|--------|----------|\n' +
      rows.join('\n') +
      '\n\n';

    if (report.newTests.length > MAX_TESTS_CHANGED_SHOWN) {
      lines.push(
        `<details><summary>Showing ${MAX_TESTS_CHANGED_SHOWN} of ${report.newTests.length} new tests</summary>\n\n${table}and ${report.newTests.length - MAX_TESTS_CHANGED_SHOWN} more...\n\n</details>\n\n`,
      );
    } else {
      lines.push(table);
    }
  }

  if (report.statusChanged.length > 0) {
    lines.push(`#### Status Changed (${report.statusChanged.length})\n\n`);
    const shown = report.statusChanged.slice(0, MAX_TESTS_CHANGED_SHOWN);
    const rows = shown.map((t) => {
      const prevEmoji = TESTS_CHANGED_STATUS_EMOJI[t.previousStatus ?? ''] ?? '';
      const currEmoji = TESTS_CHANGED_STATUS_EMOJI[t.status] ?? '';
      return `| ${escapeHtml(t.name)} | ${escapeHtml(t.suite)} | ${prevEmoji} → ${currEmoji} |`;
    });
    const table =
      '| Test | Suite | Change |\n|------|-------|--------|\n' + rows.join('\n') + '\n\n';

    if (report.statusChanged.length > MAX_TESTS_CHANGED_SHOWN) {
      lines.push(
        `<details><summary>Showing ${MAX_TESTS_CHANGED_SHOWN} of ${report.statusChanged.length} status changes</summary>\n\n${table}and ${report.statusChanged.length - MAX_TESTS_CHANGED_SHOWN} more...\n\n</details>\n\n`,
      );
    } else {
      lines.push(table);
    }
  }

  if (report.removedTests.length > 0) {
    lines.push(`#### Removed Tests (${report.removedTests.length})\n\n`);
    const shown = report.removedTests.slice(0, MAX_TESTS_CHANGED_SHOWN);
    const rows = shown.map(
      (t) =>
        `| ${escapeHtml(t.name)} | ${escapeHtml(t.suite)} | ${TESTS_CHANGED_STATUS_EMOJI[t.status] ?? ''} ${t.status} |`,
    );
    const table =
      '| Test | Suite | Previous Status |\n|------|-------|-----------------|\n' +
      rows.join('\n') +
      '\n\n';

    if (report.removedTests.length > MAX_TESTS_CHANGED_SHOWN) {
      lines.push(
        `<details><summary>Showing ${MAX_TESTS_CHANGED_SHOWN} of ${report.removedTests.length} removed tests</summary>\n\n${table}and ${report.removedTests.length - MAX_TESTS_CHANGED_SHOWN} more...\n\n</details>\n\n`,
      );
    } else {
      lines.push(table);
    }
  }

  return lines.join('');
}

const MAX_FLAKY_TESTS_SHOWN = 15;

const FLAKY_STATUS_EMOJI: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  skipped: '⏭️',
  errored: '💥',
};

export function renderFlakySection(result: FlakyDetectionResult): string {
  if (!result.hasFlakyTests) return '';

  const lines: string[] = ['### 🔀 Potentially Flaky Tests\n\n'];

  const shown = result.flakyTests.slice(0, MAX_FLAKY_TESTS_SHOWN);
  const rows = shown.map((t) => {
    const timeline = t.recentStatuses.map((s) => FLAKY_STATUS_EMOJI[s] ?? '').join('');
    return `| ${escapeHtml(t.name)} | ${escapeHtml(t.suite)} | ${Math.round(t.flakyRate)}% | ${t.flipCount} | ${timeline} |`;
  });

  const table =
    '| Test | Suite | Flaky Rate | Flips | Recent Runs |\n|------|-------|------------|-------|-------------|\n' +
    rows.join('\n') +
    '\n\n';

  if (result.flakyTests.length > MAX_FLAKY_TESTS_SHOWN) {
    lines.push(
      `<details><summary>Showing ${MAX_FLAKY_TESTS_SHOWN} of ${result.flakyTests.length} flaky tests</summary>\n\n${table}and ${result.flakyTests.length - MAX_FLAKY_TESTS_SHOWN} more...\n\n</details>\n\n`,
    );
  } else {
    lines.push(table);
  }

  return lines.join('');
}

const TREND_ARROW: Record<string, string> = {
  up: '↑',
  stable: '→',
  down: '↓',
};

export function renderTrendsSection(trends: TrendIndicators): string {
  const lines: string[] = ['### 📈 Trends\n\n'];

  const passSign = trends.passRate.delta >= 0 ? '+' : '';
  const passArrow = TREND_ARROW[trends.passRate.direction];
  let passLine = `**Pass rate:** `;
  if (trends.passRate.sparkline) {
    passLine += `${trends.passRate.sparkline} `;
  }
  passLine += `${trends.passRate.current.toFixed(1)}% ${passArrow} (${passSign}${trends.passRate.delta.toFixed(1)}%)\n\n`;
  lines.push(passLine);

  const durSign = trends.duration.delta >= 0 ? '+' : '';
  const durArrow = TREND_ARROW[trends.duration.direction];
  let durLine = `**Duration:** `;
  if (trends.duration.sparkline) {
    durLine += `${trends.duration.sparkline} `;
  }
  durLine += `${formatDuration(trends.duration.current)} ${durArrow} (${durSign}${formatDuration(Math.abs(trends.duration.delta))})\n\n`;
  lines.push(durLine);

  const countSign = trends.testCount.delta >= 0 ? '+' : '';
  lines.push(`**Tests:** ${trends.testCount.current} (${countSign}${trends.testCount.delta})\n\n`);

  return lines.join('');
}

const MAX_PERF_REGRESSIONS_SHOWN = 15;

export function renderPerfRegressionSection(result: PerfRegressionResult): string {
  const lines: string[] = ['### ⚡ Performance Regressions\n\n'];

  lines.push(`**Duration trend:** ${result.sparkline}\n\n`);

  if (!result.hasRegressions) {
    return lines.join('');
  }

  const shown = result.regressions.slice(0, MAX_PERF_REGRESSIONS_SHOWN);
  const rows = shown.map(
    (t) =>
      `| ${escapeHtml(t.name)} | ${escapeHtml(t.suite)} | ${formatDuration(t.currentDuration)} | ${formatDuration(t.medianDuration)} | +${Math.round(t.increasePercent)}% |`,
  );

  const table =
    '| Test | Suite | Current | Median | Increase |\n|------|-------|---------|--------|----------|\n' +
    rows.join('\n') +
    '\n\n';

  if (result.regressions.length > MAX_PERF_REGRESSIONS_SHOWN) {
    lines.push(
      `<details><summary>Showing ${MAX_PERF_REGRESSIONS_SHOWN} of ${result.regressions.length} regressions</summary>\n\n${table}and ${result.regressions.length - MAX_PERF_REGRESSIONS_SHOWN} more...\n\n</details>\n\n`,
    );
  } else {
    lines.push(table);
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
