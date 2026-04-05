import type { Highlight, HighlightSeverity } from '../types';
import type {
  DeltaComparison,
  TestsChangedReport,
  FlakyDetectionResult,
  PerfRegressionResult,
  TrendIndicators,
} from '../history/types';
import { formatDuration, renderProgressBar } from './format';

export interface PrCommentSection {
  testJobName: string;
  status: 'passed' | 'failed';
  total: number;
  passed: number;
  failed: number;
  duration: number;
  healthScore?: number | null;
  highlights: Highlight[];
  runUrl?: string;
  testsChanged?: TestsChangedReport | null;
  baseDelta?: DeltaComparison | null;
  baseBranch?: string;
  flaky?: FlakyDetectionResult | null;
  perfRegression?: PerfRegressionResult | null;
  trends?: TrendIndicators | null;
}

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

function sanitizeMarkerName(name: string): string {
  return name.replace(/-->/g, '');
}

function renderHighlightRow(h: Highlight): string {
  const emoji = SEVERITY_EMOJI[h.severity];
  const data = h.data as Record<string, unknown>;

  let details: string;
  switch (h.type) {
    case 'new_failures': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      const names = tests
        .slice(0, 3)
        .map((t) => `\`${t.name}\``)
        .join(', ');
      const suffix = tests.length > 3 ? `, +${tests.length - 3} more` : '';
      details = `${tests.length} new failure(s): ${names}${suffix}`;
      break;
    }
    case 'health_score_delta': {
      const prev = data.previous as number | null;
      const current = data.current as number | null;
      const direction = data.direction as string;
      const arrow = direction === 'down' ? '↓' : direction === 'up' ? '↑' : '';
      details = `Health Score: ${prev ?? '?'} → ${current ?? '?'} ${arrow}`;
      break;
    }
    case 'duration_delta': {
      const currentDuration = data.currentDuration as number;
      const deltaPercent = data.deltaPercent as number;
      const sign = deltaPercent >= 0 ? '+' : '';
      details = `Duration ${sign}${deltaPercent}% vs baseline (${formatDuration(currentDuration)})`;
      break;
    }
    case 'fixed_tests': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      details = `${tests.length} test(s) now passing`;
      break;
    }
    case 'new_tests': {
      const count = (data.count as number) ?? 0;
      details = `${count} new test(s) added`;
      break;
    }
    case 'known_flaky': {
      const tests = (data.tests as Array<{ name: string }>) ?? [];
      details = `${tests.length} known flaky test(s) in this run`;
      break;
    }
    default:
      details = h.message;
  }

  return `| ${emoji} | ${details} |`;
}

export function renderBaseBranchSection(
  baseDelta: DeltaComparison | null | undefined,
  baseBranch: string,
): string {
  if (baseDelta === undefined || baseDelta === null) {
    return `> No base branch data available — push to \`${baseBranch}\` to establish baseline`;
  }
  if (!baseDelta.hasChanges) {
    return `> :white_check_mark: No regressions vs \`${baseBranch}\``;
  }

  const lines: string[] = [];
  lines.push(`**vs \`${baseBranch}\`**`);

  const passSign = baseDelta.passRateDelta >= 0 ? '+' : '';
  const durSign = baseDelta.durationDelta >= 0 ? '+' : '';
  lines.push(
    `| Metric | ${baseBranch} | PR | Delta |`,
    '|--------|------|----|----|',
    `| Pass rate | ${baseDelta.passRatePrev.toFixed(1)}% | ${baseDelta.passRateCurr.toFixed(1)}% | ${passSign}${baseDelta.passRateDelta.toFixed(1)}% |`,
    `| Duration | ${formatDuration(baseDelta.durationPrev)} | ${formatDuration(baseDelta.durationCurr)} | ${durSign}${baseDelta.durationDeltaPercent.toFixed(1)}% |`,
  );

  if (baseDelta.newlyFailing.length > 0) {
    const names = baseDelta.newlyFailing
      .slice(0, 5)
      .map((t) => `\`${t.name}\``)
      .join(', ');
    const suffix =
      baseDelta.newlyFailing.length > 5 ? `, and ${baseDelta.newlyFailing.length - 5} more` : '';
    lines.push('', `🔴 **Regressions:** ${names}${suffix}`);
  }

  if (baseDelta.newlyPassing.length > 0) {
    const names = baseDelta.newlyPassing
      .slice(0, 5)
      .map((t) => `\`${t.name}\``)
      .join(', ');
    const suffix =
      baseDelta.newlyPassing.length > 5 ? `, and ${baseDelta.newlyPassing.length - 5} more` : '';
    lines.push('', `🟢 **Improvements:** ${names}${suffix}`);
  }

  return lines.join('\n');
}

const TREND_ARROW: Record<string, string> = {
  up: '↑',
  stable: '→',
  down: '↓',
};

export function renderTrendLine(trends: TrendIndicators): string {
  const passSign = trends.passRate.delta >= 0 ? '+' : '';
  const passArrow = TREND_ARROW[trends.passRate.direction];
  const passStr = `Pass rate: ${trends.passRate.current.toFixed(1)}% ${passArrow} (${passSign}${trends.passRate.delta.toFixed(1)}%)`;

  const durSign = trends.duration.delta >= 0 ? '+' : '';
  const durArrow = TREND_ARROW[trends.duration.direction];
  const durStr = `Duration: ${formatDuration(trends.duration.current)} ${durArrow} (${durSign}${formatDuration(Math.abs(trends.duration.delta))}, ${durSign}${trends.duration.deltaPercent.toFixed(1)}%)`;

  const countSign = trends.testCount.delta >= 0 ? '+' : '';
  const countStr = `Tests: ${trends.testCount.current} (${countSign}${trends.testCount.delta})`;

  return `📈 ${passStr} · ${durStr} · ${countStr}`;
}

export function renderTestJobSection(section: PrCommentSection): string {
  const safeKey = sanitizeMarkerName(section.testJobName);
  const emoji = section.failed > 0 ? '❌' : '✅';
  const passRate = section.total > 0 ? ((section.passed / section.total) * 100).toFixed(1) : '0.0';

  const lines: string[] = [];
  lines.push(`<!-- tj:${safeKey} -->`);
  lines.push(`### ${emoji} ${section.testJobName} — ${passRate}% pass rate`);
  lines.push(renderProgressBar(Number(passRate)));

  const statsParts: string[] = [`✅ ${section.passed} passed`];
  if (section.failed > 0) statsParts.push(`❌ ${section.failed} failed`);
  statsParts.push(`⏱️ ${formatDuration(section.duration)}`);
  let statsLine = statsParts.join(' · ');
  if (section.healthScore !== null && section.healthScore !== undefined) {
    statsLine += ` · 🏥 ${section.healthScore}/100`;
  }
  lines.push(statsLine);

  if (section.trends) {
    lines.push(renderTrendLine(section.trends));
  }

  const hasDetails =
    section.highlights.length > 0 ||
    (section.baseBranch && section.baseDelta !== undefined) ||
    (section.testsChanged && section.testsChanged.hasChanges) ||
    (section.flaky && section.flaky.hasFlakyTests) ||
    (section.perfRegression && section.perfRegression.hasRegressions);

  if (hasDetails) {
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (section.highlights.length > 0) {
    const sorted = [...section.highlights].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    lines.push('| Signal | Details |');
    lines.push('|--------|---------|');
    for (const h of sorted) {
      lines.push(renderHighlightRow(h));
    }
    lines.push('');
  }

  if (section.baseBranch && section.baseDelta !== undefined) {
    lines.push(renderBaseBranchSection(section.baseDelta, section.baseBranch));
    lines.push('');
  }

  if (section.testsChanged && section.testsChanged.hasChanges) {
    lines.push(renderTestsChangedCompact(section.testsChanged));
    lines.push('');
  }

  if (section.flaky && section.flaky.hasFlakyTests) {
    lines.push(renderFlakyCompact(section.flaky));
    lines.push('');
  }

  if (section.perfRegression && section.perfRegression.hasRegressions) {
    lines.push(renderPerfRegressionCompact(section.perfRegression));
    lines.push('');
  }

  if (section.runUrl) {
    lines.push(`[View Run →](${section.runUrl})`);
  }

  lines.push(`<!-- /tj:${safeKey} -->`);

  return lines.join('\n');
}

function renderTestsChangedCompact(report: TestsChangedReport): string {
  const parts: string[] = [];
  if (report.newTests.length > 0) parts.push(`${report.newTests.length} new tests`);
  if (report.removedTests.length > 0) parts.push(`${report.removedTests.length} removed`);
  if (report.statusChanged.length > 0) parts.push(`${report.statusChanged.length} status changes`);

  if (parts.length === 0) return '';

  const isFailing = (status: 'passed' | 'failed' | 'skipped' | 'errored' | undefined): boolean =>
    status === 'failed' || status === 'errored';
  const newlyFailing = report.statusChanged.filter(
    (t) => isFailing(t.status) && !isFailing(t.previousStatus),
  );

  let line = `📝 ${parts.join(', ')}`;
  if (newlyFailing.length > 0) {
    line = `⚠️ ${newlyFailing.length} newly failing | ${line}`;
  }
  return line;
}

const MAX_FLAKY_COMPACT = 5;

function toInlineCode(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ');
  const runs = normalized.match(/`+/g);
  const longestRun = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}${normalized}${fence}`;
}

export function renderFlakyCompact(result: FlakyDetectionResult): string {
  if (!result.hasFlakyTests) return '';

  const total = result.flakyTests.length;
  const shown = result.flakyTests.slice(0, MAX_FLAKY_COMPACT);
  const names = shown.map((t) => toInlineCode(t.name)).join(', ');

  if (total > MAX_FLAKY_COMPACT) {
    return `⚠️ ${total} flaky tests: ${names}, +${total - MAX_FLAKY_COMPACT} more`;
  }
  return `⚠️ ${total} flaky test${total === 1 ? '' : 's'}: ${names}`;
}

const MAX_PERF_COMPACT = 3;

export function renderPerfRegressionCompact(result: PerfRegressionResult): string {
  if (!result.hasRegressions) return '';

  const total = result.regressions.length;
  const shown = result.regressions.slice(0, MAX_PERF_COMPACT);
  const names = shown
    .map((t) => `${toInlineCode(t.name)} (+${Math.round(t.increasePercent)}%)`)
    .join(', ');

  if (total > MAX_PERF_COMPACT) {
    return `🐌 ${total} slower tests: ${names}, +${total - MAX_PERF_COMPACT} more`;
  }
  return `🐌 ${total} slower test${total === 1 ? '' : 's'}: ${names}`;
}

export function renderPrComment(sections: PrCommentSection[]): string {
  const lines: string[] = [];
  lines.push('<!-- testglance-pr-summary -->');
  lines.push('## 🔬 TestGlance');
  lines.push('');

  for (let i = 0; i < sections.length; i++) {
    lines.push(renderTestJobSection(sections[i]));
    lines.push('');
    if (i < sections.length - 1) {
      lines.push('---');
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`*Updated ${new Date().toISOString()}*`);

  return lines.join('\n');
}

export function mergeTestJobSection(existingBody: string, newSection: PrCommentSection): string {
  const safeKey = sanitizeMarkerName(newSection.testJobName);
  const startMarker = `<!-- tj:${safeKey} -->`;
  const endMarker = `<!-- /tj:${safeKey} -->`;

  const newSectionContent = renderTestJobSection(newSection);

  const startIdx = existingBody.indexOf(startMarker);
  const endIdx = existingBody.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = existingBody.slice(0, startIdx);
    const after = existingBody.slice(endIdx + endMarker.length);

    const updatedFooter = after.replace(/\*Updated .*?\*/, `*Updated ${new Date().toISOString()}*`);

    return before + newSectionContent + updatedFooter;
  }

  const footerMatch = existingBody.match(/\n---\n\*Updated .*?\*$/);
  if (footerMatch && footerMatch.index !== undefined) {
    const beforeFooter = existingBody.slice(0, footerMatch.index);
    return (
      beforeFooter +
      '\n\n---\n\n' +
      newSectionContent +
      '\n\n---\n' +
      `*Updated ${new Date().toISOString()}*`
    );
  }

  return existingBody + '\n\n---\n\n' + newSectionContent;
}
