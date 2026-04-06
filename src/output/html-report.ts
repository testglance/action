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
import { escapeHtml, formatDuration, truncate, renderMetricsStrip } from './format';

export interface HtmlReportOptions {
  parsed: ParsedTestRun;
  apiSuccess: boolean;
  healthScore?: number | null;
  dashboardUrl?: string;
  highlights?: Highlight[];
  slowestTests?: number;
  delta?: DeltaComparison | null;
  testsChanged?: TestsChangedReport | null;
  flaky?: FlakyDetectionResult | null;
  perfRegression?: PerfRegressionResult | null;
  trends?: TrendIndicators | null;
  commitSha: string;
  branch: string;
  workflowRunUrl: string;
  timestamp: string;
}

const MAX_FAILED_TESTS_SHOWN = 25;
const MAX_ERROR_MESSAGE_LENGTH = 200;
const MAX_STACK_TRACE_LINES = 30;
const MAX_HIGHLIGHTS_SHOWN = 3;
const MAX_DELTA_TESTS_SHOWN = 10;
const MAX_TESTS_CHANGED_SHOWN = 20;
const MAX_FLAKY_TESTS_SHOWN = 15;
const MAX_PERF_REGRESSIONS_SHOWN = 15;

const SEVERITY_EMOJI: Record<HighlightSeverity, string> = {
  critical: '&#x1F534;',
  warning: '&#x1F7E1;',
  info: '&#x1F535;',
};

const SEVERITY_ORDER: Record<HighlightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const TREND_ARROW: Record<string, string> = {
  up: '&uarr;',
  stable: '&rarr;',
  down: '&darr;',
};

const FLAKY_STATUS_DOT: Record<string, string> = {
  passed: '&#9679;', // green dot via CSS
  failed: '&#9679;', // red dot via CSS
  skipped: '&#9679;', // gray dot via CSS
  errored: '&#9679;', // orange dot via CSS
};

export function generateHtmlReport(options: HtmlReportOptions): string {
  const {
    parsed,
    apiSuccess,
    healthScore,
    dashboardUrl,
    highlights,
    slowestTests,
    delta,
    testsChanged,
    flaky,
    perfRegression,
    trends,
    commitSha,
    branch,
    workflowRunUrl,
    timestamp,
  } = options;
  const { summary } = parsed;
  const passRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;
  const statusClass = summary.failed > 0 ? 'fail' : 'pass';

  const sections: string[] = [];

  sections.push(renderHeader(summary, passRate, statusClass, apiSuccess, healthScore));

  if (highlights && highlights.length > 0) {
    sections.push(renderHighlights(highlights, dashboardUrl));
  }

  if (trends) {
    sections.push(renderTrends(trends));
  }

  if (delta && delta.hasChanges) {
    sections.push(renderDelta(delta));
  }

  if (testsChanged && testsChanged.hasChanges) {
    sections.push(renderTestsChanged(testsChanged));
  }

  if (flaky && flaky.hasFlakyTests) {
    sections.push(renderFlaky(flaky));
  }

  if (perfRegression && perfRegression.hasRegressions) {
    sections.push(renderPerfRegressions(perfRegression));
  }

  if (parsed.suites.length > 1) {
    sections.push(renderSuiteBreakdown(parsed.suites));
  }

  const failedTests = collectFailedTests(parsed).sort((a, b) => a.suite.localeCompare(b.suite));
  if (failedTests.length > 0) {
    sections.push(renderFailedTests(failedTests));
  }

  if (slowestTests && slowestTests > 0) {
    sections.push(renderSlowestTests(parsed, slowestTests));
  }

  const formattedTime = new Date(timestamp).toUTCString();
  const shortSha = commitSha.slice(0, 7);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TestGlance Report — ${passRate.toFixed(1)}% pass rate</title>
<style>${CSS}</style>
</head>
<body>
<div class="container">
${sections.join('\n')}
<footer>
  <span>Generated ${escapeHtml(formattedTime)}</span>
  <span>Commit <a href="${escapeHtml(workflowRunUrl.replace(/\/actions\/runs\/.*/, ''))}/commit/${escapeHtml(commitSha)}">${escapeHtml(shortSha)}</a></span>
  <span>Branch <strong>${escapeHtml(branch)}</strong></span>
  <span><a href="${escapeHtml(workflowRunUrl)}">Workflow Run</a></span>
</footer>
</div>
</body>
</html>`;
}

function renderHeader(
  summary: ParsedTestRun['summary'],
  passRate: number,
  statusClass: string,
  apiSuccess: boolean,
  healthScore?: number | null,
): string {
  const metricsStrip = escapeHtml(renderMetricsStrip(summary));
  const duration = formatDuration(summary.duration);
  let healthHtml = '';
  if (apiSuccess && healthScore !== null && healthScore !== undefined) {
    healthHtml = ` &middot; &#x1F3E5; ${healthScore}/100`;
  }

  const pct = passRate.toFixed(1);
  const barFilled = passRate === 100 ? 100 : Math.floor(passRate);

  return `<header>
  <h1 class="${statusClass}">${statusClass === 'fail' ? '&#x1F534;' : '&#x2705;'} TestGlance Results &mdash; ${pct}% pass rate</h1>
  <div class="progress-bar"><div class="progress-fill ${statusClass}" style="width:${barFilled}%"></div></div>
  <p class="metrics">${metricsStrip} &middot; &#x23F1;&#xFE0F; ${duration}${healthHtml}</p>
</header>`;
}

function renderHighlights(highlights: Highlight[], dashboardUrl?: string): string {
  const sorted = [...highlights].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const shown = sorted.slice(0, MAX_HIGHLIGHTS_SHOWN);
  const items = shown
    .map((h) => `<li>${SEVERITY_EMOJI[h.severity]} ${renderHighlightMessage(h)}</li>`)
    .join('\n');

  let extra = '';
  if (sorted.length > MAX_HIGHLIGHTS_SHOWN && dashboardUrl) {
    extra = `<p><a href="${escapeHtml(dashboardUrl)}">View all highlights on dashboard &rarr;</a></p>`;
  }

  return `<section>
  <h2>&#x1F4A1; Highlights</h2>
  <ul class="highlights">${items}</ul>
  ${extra}
</section>`;
}

function renderHighlightMessage(h: Highlight): string {
  const data = h.data as Record<string, unknown>;
  const MAX_TEST_NAMES_SHOWN = 3;
  switch (h.type) {
    case 'new_failures': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      const names = tests.slice(0, MAX_TEST_NAMES_SHOWN).map((t) => escapeHtml(t.name));
      const suffix =
        tests.length > MAX_TEST_NAMES_SHOWN ? `, +${tests.length - MAX_TEST_NAMES_SHOWN} more` : '';
      return `<strong>NEW FAILURES:</strong> ${names.join(', ')}${suffix}`;
    }
    case 'health_score_delta': {
      const prev = data.previous as number | null;
      const current = data.current as number | null;
      const direction = data.direction as string;
      const arrow = direction === 'down' ? '&#x25BC;' : direction === 'up' ? '&#x25B2;' : '';
      return `<strong>Health Score:</strong> ${prev ?? '?'} &rarr; ${current ?? '?'} ${arrow}`;
    }
    case 'duration_delta': {
      const currentDuration = data.currentDuration as number;
      const deltaPercent = data.deltaPercent as number;
      const sign = deltaPercent >= 0 ? '+' : '';
      return `<strong>Duration:</strong> ${formatDuration(currentDuration)} (${sign}${deltaPercent}% vs baseline)`;
    }
    case 'fixed_tests': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      return `<strong>Fixed:</strong> ${tests.length} test(s) now passing`;
    }
    case 'new_tests': {
      const count = (data.count as number) ?? 0;
      return `<strong>${count} new test(s) added</strong>`;
    }
    case 'known_flaky': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      return `<strong>${tests.length} known flaky test(s) in this run</strong>`;
    }
    default:
      return escapeHtml(h.message);
  }
}

function renderTrends(trends: TrendIndicators): string {
  const passSign = trends.passRate.delta >= 0 ? '+' : '';
  const passArrow = TREND_ARROW[trends.passRate.direction];
  let passLine = '<strong>Pass rate:</strong> ';
  if (trends.passRate.sparkline) {
    passLine += `${escapeHtml(trends.passRate.sparkline)} `;
  }
  passLine += `${trends.passRate.current.toFixed(1)}% ${passArrow} (${passSign}${trends.passRate.delta.toFixed(1)}%)`;

  const durSign = trends.duration.delta >= 0 ? '+' : '';
  const durArrow = TREND_ARROW[trends.duration.direction];
  let durLine = '<strong>Duration:</strong> ';
  if (trends.duration.sparkline) {
    durLine += `${escapeHtml(trends.duration.sparkline)} `;
  }
  durLine += `${formatDuration(trends.duration.current)} ${durArrow} (${durSign}${formatDuration(Math.abs(trends.duration.delta))})`;

  const countSign = trends.testCount.delta >= 0 ? '+' : '';
  const countLine = `<strong>Tests:</strong> ${trends.testCount.current} (${countSign}${trends.testCount.delta})`;

  return `<section>
  <h2>&#x1F4C8; Trends</h2>
  <p>${passLine}</p>
  <p>${durLine}</p>
  <p>${countLine}</p>
</section>`;
}

function renderDelta(delta: DeltaComparison): string {
  const sign = (n: number) => (n >= 0 ? '+' : '-');

  const lines: string[] = [];
  lines.push(
    `<p><strong>Pass rate:</strong> ${delta.passRatePrev.toFixed(1)}% &rarr; ${delta.passRateCurr.toFixed(1)}% (${sign(delta.passRateDelta)}${Math.abs(delta.passRateDelta).toFixed(1)}%)</p>`,
  );
  lines.push(
    `<p><strong>Duration:</strong> ${formatDuration(delta.durationPrev)} &rarr; ${formatDuration(delta.durationCurr)} (${sign(delta.durationDelta)}${formatDuration(Math.abs(delta.durationDelta))})</p>`,
  );

  const DELTA_LABELS: Record<string, string> = {
    added: '&#x1F195; Added',
    removed: '&#x1F5D1;&#xFE0F; Removed',
    newlyFailing: '&#x274C; New Failure',
    newlyPassing: '&#x2705; Now Passing',
  };

  const categories = [
    { key: 'added', tests: delta.testsAdded },
    { key: 'newlyFailing', tests: delta.newlyFailing },
    { key: 'newlyPassing', tests: delta.newlyPassing },
    { key: 'removed', tests: delta.testsRemoved },
  ];

  const nonEmpty = categories.filter((c) => c.tests.length > 0);

  if (nonEmpty.length > 0) {
    const rows = nonEmpty.flatMap((cat) => {
      const shown = cat.tests.slice(0, MAX_DELTA_TESTS_SHOWN);
      const result = shown.map(
        (t) =>
          `<tr><td>${DELTA_LABELS[cat.key]}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td></tr>`,
      );
      if (cat.tests.length > MAX_DELTA_TESTS_SHOWN) {
        result.push(
          `<tr><td>${DELTA_LABELS[cat.key]}</td><td colspan="2"><em>and ${cat.tests.length - MAX_DELTA_TESTS_SHOWN} more&hellip;</em></td></tr>`,
        );
      }
      return result;
    });

    const totalTests = nonEmpty.reduce((sum, c) => sum + c.tests.length, 0);
    const table = `<table><thead><tr><th>Status</th><th>Test</th><th>Suite</th></tr></thead><tbody>${rows.join('\n')}</tbody></table>`;

    if (totalTests > MAX_DELTA_TESTS_SHOWN) {
      lines.push(
        `<details><summary><strong>Changed tests</strong> (${totalTests} tests)</summary>${table}</details>`,
      );
    } else {
      lines.push(table);
    }
  }

  return `<section>
  <h2>&#x1F504; Changes Since Last Run</h2>
  ${lines.join('\n')}
</section>`;
}

function renderTestsChanged(report: TestsChangedReport): string {
  const STATUS_DOT: Record<string, string> = {
    passed: '<span class="dot pass">&#9679;</span>',
    failed: '<span class="dot fail">&#9679;</span>',
    skipped: '<span class="dot skip">&#9679;</span>',
    errored: '<span class="dot error">&#9679;</span>',
  };

  const parts: string[] = [];

  if (report.newTests.length > 0) {
    const shown = report.newTests.slice(0, MAX_TESTS_CHANGED_SHOWN);
    const rows = shown
      .map(
        (t) =>
          `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td><td>${STATUS_DOT[t.status] ?? ''} ${t.status}</td><td>${formatDuration(t.duration)}</td></tr>`,
      )
      .join('\n');
    const table = `<table><thead><tr><th>Test</th><th>Suite</th><th>Status</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>`;
    const overflow =
      report.newTests.length > MAX_TESTS_CHANGED_SHOWN
        ? `<p><em>and ${report.newTests.length - MAX_TESTS_CHANGED_SHOWN} more&hellip;</em></p>`
        : '';
    parts.push(`<h3>New Tests (${report.newTests.length})</h3>${table}${overflow}`);
  }

  if (report.statusChanged.length > 0) {
    const shown = report.statusChanged.slice(0, MAX_TESTS_CHANGED_SHOWN);
    const rows = shown
      .map(
        (t) =>
          `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td><td>${STATUS_DOT[t.previousStatus ?? ''] ?? ''} &rarr; ${STATUS_DOT[t.status] ?? ''}</td></tr>`,
      )
      .join('\n');
    const table = `<table><thead><tr><th>Test</th><th>Suite</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>`;
    const overflow =
      report.statusChanged.length > MAX_TESTS_CHANGED_SHOWN
        ? `<p><em>and ${report.statusChanged.length - MAX_TESTS_CHANGED_SHOWN} more&hellip;</em></p>`
        : '';
    parts.push(`<h3>Status Changed (${report.statusChanged.length})</h3>${table}${overflow}`);
  }

  if (report.removedTests.length > 0) {
    const shown = report.removedTests.slice(0, MAX_TESTS_CHANGED_SHOWN);
    const rows = shown
      .map(
        (t) =>
          `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td><td>${STATUS_DOT[t.status] ?? ''} ${t.status}</td></tr>`,
      )
      .join('\n');
    const table = `<table><thead><tr><th>Test</th><th>Suite</th><th>Previous Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    const overflow =
      report.removedTests.length > MAX_TESTS_CHANGED_SHOWN
        ? `<p><em>and ${report.removedTests.length - MAX_TESTS_CHANGED_SHOWN} more&hellip;</em></p>`
        : '';
    parts.push(`<h3>Removed Tests (${report.removedTests.length})</h3>${table}${overflow}`);
  }

  return `<section>
  <h2>&#x1F4DD; Tests Changed</h2>
  ${parts.join('\n')}
</section>`;
}

function renderFlaky(result: FlakyDetectionResult): string {
  const shown = result.flakyTests.slice(0, MAX_FLAKY_TESTS_SHOWN);
  const rows = shown
    .map((t) => {
      const timeline = t.recentStatuses
        .map((s) => `<span class="dot ${s}">${FLAKY_STATUS_DOT[s] ?? ''}</span>`)
        .join('');
      return `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td><td>${Math.round(t.flakyRate)}%</td><td>${t.flipCount}</td><td class="timeline">${timeline}</td></tr>`;
    })
    .join('\n');
  const table = `<table><thead><tr><th>Test</th><th>Suite</th><th>Flaky Rate</th><th>Flips</th><th>Recent Runs</th></tr></thead><tbody>${rows}</tbody></table>`;
  const overflow =
    result.flakyTests.length > MAX_FLAKY_TESTS_SHOWN
      ? `<p><em>and ${result.flakyTests.length - MAX_FLAKY_TESTS_SHOWN} more&hellip;</em></p>`
      : '';

  return `<section>
  <h2>&#x1F500; Potentially Flaky Tests</h2>
  ${table}${overflow}
</section>`;
}

function renderPerfRegressions(result: PerfRegressionResult): string {
  const sparkHtml = result.sparkline
    ? `<p><strong>Duration trend:</strong> ${escapeHtml(result.sparkline)}</p>`
    : '';

  const shown = result.regressions.slice(0, MAX_PERF_REGRESSIONS_SHOWN);
  const rows = shown
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td><td>${formatDuration(t.currentDuration)}</td><td>${formatDuration(t.medianDuration)}</td><td class="regression">+${Math.round(t.increasePercent)}%</td></tr>`,
    )
    .join('\n');
  const table = `<table><thead><tr><th>Test</th><th>Suite</th><th>Current</th><th>Median</th><th>Increase</th></tr></thead><tbody>${rows}</tbody></table>`;
  const overflow =
    result.regressions.length > MAX_PERF_REGRESSIONS_SHOWN
      ? `<p><em>and ${result.regressions.length - MAX_PERF_REGRESSIONS_SHOWN} more&hellip;</em></p>`
      : '';

  return `<section>
  <h2>&#x26A1; Performance Regressions</h2>
  ${sparkHtml}${table}${overflow}
</section>`;
}

function renderSuiteBreakdown(suites: ParsedSuite[]): string {
  const rows = suites
    .map((s) => {
      const total = s.tests.length;
      const passed = s.tests.filter((t) => t.status === 'passed').length;
      const failed = s.tests.filter((t) => t.status === 'failed' || t.status === 'errored').length;
      const skipped = s.tests.filter((t) => t.status === 'skipped').length;
      const rate = total > 0 ? (passed / total) * 100 : -1;
      return { name: s.name, total, passed, failed, skipped, rate, duration: s.duration };
    })
    .sort((a, b) => {
      if (a.rate < 0) return 1;
      if (b.rate < 0) return -1;
      return a.rate - b.rate;
    });

  const tableRows = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${r.total}</td><td>${r.passed}</td><td>${r.failed}</td><td>${r.skipped}</td><td>${r.total > 0 ? `${r.rate.toFixed(1)}%` : 'N/A'}</td><td>${formatDuration(r.duration)}</td></tr>`,
    )
    .join('\n');

  return `<section>
  <h2>&#x1F4E6; Suite Breakdown</h2>
  <details open><summary><strong>${suites.length} suites</strong></summary>
  <table><thead><tr><th>Suite</th><th>Total</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Pass Rate</th><th>Duration</th></tr></thead><tbody>${tableRows}</tbody></table>
  </details>
</section>`;
}

function renderFailedTests(failedTests: ParsedTestCase[]): string {
  const shown = failedTests.slice(0, MAX_FAILED_TESTS_SHOWN);
  const items = shown
    .map((t) => {
      const error = truncate(t.errorMessage ?? 'No error message', MAX_ERROR_MESSAGE_LENGTH);
      let stackHtml = '';
      if (t.stackTrace) {
        const lines = t.stackTrace.split('\n');
        let truncated = lines.slice(0, MAX_STACK_TRACE_LINES).join('\n');
        if (lines.length > MAX_STACK_TRACE_LINES) {
          truncated += `\n... ${lines.length - MAX_STACK_TRACE_LINES} more lines truncated`;
        }
        stackHtml = `<details><summary>Stack trace</summary><pre><code>${escapeHtml(truncated)}</code></pre></details>`;
      }
      return `<div class="failed-test">
  <p><strong>${escapeHtml(t.name)}</strong> &middot; <code>${escapeHtml(t.suite)}</code></p>
  <blockquote>${escapeHtml(error)}</blockquote>
  ${stackHtml}
</div>`;
    })
    .join('\n');

  const overflow =
    failedTests.length > MAX_FAILED_TESTS_SHOWN
      ? `<p><em>and ${failedTests.length - MAX_FAILED_TESTS_SHOWN} more failed tests&hellip;</em></p>`
      : '';

  return `<section>
  <h2>&#x274C; Failed Tests</h2>
  ${items}${overflow}
</section>`;
}

function renderSlowestTests(parsed: ParsedTestRun, count: number): string {
  const allTests = parsed.suites.flatMap((s) => s.tests);
  const withDuration = allTests.filter((t) => t.duration >= 0.2);
  const sorted = [...withDuration].sort((a, b) => b.duration - a.duration);
  const top = sorted.slice(0, count);
  if (top.length === 0) return '';

  const rows = top
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.suite)}</td><td>${formatDuration(t.duration)}</td></tr>`,
    )
    .join('\n');

  return `<section>
  <h2>&#x1F40C; Slowest Tests</h2>
  <details open><summary>Slowest ${top.length} tests</summary>
  <table><thead><tr><th>Test</th><th>Suite</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>
  </details>
</section>`;
}

function collectFailedTests(parsed: ParsedTestRun): ParsedTestCase[] {
  return parsed.suites.flatMap((suite) =>
    suite.tests.filter((t) => t.status === 'failed' || t.status === 'errored'),
  );
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#24292f;background:#f6f8fa;padding:1rem}
.container{max-width:960px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);padding:2rem}
header{margin-bottom:1.5rem}
h1{font-size:1.5rem;margin-bottom:.75rem}
h1.pass{color:#1a7f37}
h1.fail{color:#cf222e}
h2{font-size:1.25rem;margin-bottom:.75rem;padding-bottom:.25rem;border-bottom:1px solid #d0d7de}
h3{font-size:1rem;margin:.75rem 0 .5rem}
section{margin-bottom:1.5rem}
.progress-bar{height:8px;background:#d0d7de;border-radius:4px;overflow:hidden;margin-bottom:.75rem}
.progress-fill{height:100%;border-radius:4px;transition:width .3s}
.progress-fill.pass{background:#1a7f37}
.progress-fill.fail{background:#cf222e}
.metrics{color:#57606a;font-size:.875rem}
table{width:100%;border-collapse:collapse;margin:.5rem 0;font-size:.875rem}
th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #d0d7de}
th{background:#f6f8fa;font-weight:600}
tr:hover{background:#f6f8fa}
details{margin:.5rem 0}
summary{cursor:pointer;font-weight:600;padding:.25rem 0}
pre{background:#161b22;color:#e6edf3;padding:1rem;border-radius:6px;overflow-x:auto;font-size:.8125rem;margin:.5rem 0}
code{font-family:SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace;font-size:.85em}
blockquote{border-left:3px solid #cf222e;padding:.25rem .75rem;color:#57606a;margin:.25rem 0 .5rem;font-size:.875rem}
.failed-test{margin-bottom:1rem;padding:.75rem;background:#fff5f5;border-radius:6px;border:1px solid #ffcecb}
.highlights{list-style:none;padding:0}
.highlights li{padding:.25rem 0}
.dot{font-size:.75rem;margin-right:1px}
.dot.pass,.dot.passed{color:#1a7f37}
.dot.fail,.dot.failed{color:#cf222e}
.dot.skip,.dot.skipped{color:#6e7781}
.dot.error,.dot.errored{color:#bf8700}
.timeline{letter-spacing:2px}
.regression{color:#cf222e;font-weight:600}
footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #d0d7de;font-size:.75rem;color:#57606a;display:flex;flex-wrap:wrap;gap:.75rem}
footer a{color:#0969da;text-decoration:none}
footer a:hover{text-decoration:underline}
a{color:#0969da}
@media(max-width:640px){.container{padding:1rem}table{font-size:.75rem}th,td{padding:.375rem .5rem}}
`;
