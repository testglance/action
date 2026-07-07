import * as core from '@actions/core';
import type { Highlight, HighlightSeverity, ParsedTestRun } from '../types';
import type {
  DeltaComparison,
  HistoryEntry,
  TestsChangedReport,
  FlakyDetectionResult,
  PerfRegressionResult,
  TrendIndicators,
} from '../history/types';
import {
  escapeHtml,
  formatDuration,
  formatDurationPair,
  renderMetricsStrip,
  renderProgressBar,
} from './format';
import {
  renderTemplate,
  buildTemplateContext,
  type TemplateContextMeta,
} from './template-renderer';

export interface PrCommentSection {
  testJobName: string;
  status: 'passed' | 'failed';
  total: number;
  passed: number;
  failed: number;
  skipped?: number;
  errored?: number;
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
  artifactUrl?: string;
  parsed?: ParsedTestRun;
  delta?: DeltaComparison | null;
  history?: HistoryEntry[] | null;
  slowestLimit?: number;
  commentTemplate?: string;
  meta?: TemplateContextMeta;
}

/**
 * Per-job state persisted inside the comment as a hidden `tj-data` blob. Each
 * job runs as a separate Action invocation and only knows its own data, so the
 * whole comment is re-rendered from the decoded blobs of every job on each
 * merge. This is what lets independent jobs share one consolidated table.
 *
 * Jobs that use a custom comment template can't fold into the shared table, so
 * they carry their pre-rendered `customBody` and render as standalone blocks.
 */
export interface StoredJobData {
  key: string;
  testJobName: string;
  customBody?: string;
  status?: 'passed' | 'failed';
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  errored?: number;
  duration?: number;
  healthScore?: number | null;
  highlights?: Highlight[];
  runUrl?: string;
  artifactUrl?: string;
  testsChanged?: TestsChangedReport | null;
  baseDelta?: DeltaComparison | null;
  baseBranch?: string;
  flaky?: FlakyDetectionResult | null;
  perfRegression?: PerfRegressionResult | null;
  trends?: TrendIndicators | null;
}

const SUMMARY_MARKER = '<!-- testglance-pr-summary -->';
const MAX_RENDERED_COMMENT_BYTES = 60_000;
const TJ_DATA_PATTERN = /<!--\s*tj-data:(\S+)\s+([A-Za-z0-9+/=]+)\s*-->/g;
const MARKER_STRIP_PATTERN = /<!--\s*\/?\s*tj(?:-data)?:[^>]*-->/g;
// Pre-blob comments wrapped each job in <!-- tj:KEY -->…<!-- /tj:KEY -->. Used to
// preserve those jobs (as opaque standalone blocks) when migrating an existing
// comment that has no tj-data blobs yet.
const LEGACY_SECTION_PATTERN = /<!--\s*tj:(\S+?)\s*-->\n?([\s\S]*?)\n?<!--\s*\/tj:\1\s*-->/g;

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
  // The key is embedded in tj-data/tj markers and recovered by regexes that
  // capture it as a single whitespace-free token, so collapse internal
  // whitespace — GitHub matrix job names like "test (ubuntu-latest)" contain
  // spaces and would otherwise produce a blob that can never be decoded.
  const stripped = name.replace(/-->/g, '').trim().replace(/\s+/g, '-');
  return stripped.length > 0 ? stripped : 'tests';
}

function stripMarkers(body: string): string {
  return body.replace(MARKER_STRIP_PATTERN, '');
}

function escapeTableCell(value: string): string {
  return escapeHtml(value.replace(/\r?\n/g, ' ')).replace(/\|/g, '\\|');
}

// Markdown inline-link URLs break on unescaped spaces and parentheses; percent-
// encode them so an artifact/run URL with those chars doesn't truncate the link.
function escapeLinkUrl(url: string): string {
  return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function capVisibleBody(
  body: string,
  label: string,
  maxBytes: number = MAX_RENDERED_COMMENT_BYTES,
): string {
  if (body.length <= maxBytes) return body;
  const notice = `\n\n_…rendered ${label} truncated to fit GitHub PR comment limit._`;
  const room = Math.max(0, maxBytes - notice.length);
  return body.slice(0, room) + notice;
}

function passRate(passed: number, total: number): string {
  return total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
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
  const [prevDur, currDur] = formatDurationPair(baseDelta.durationPrev, baseDelta.durationCurr);
  lines.push(
    `| Metric | ${baseBranch} | PR | Delta |`,
    '|--------|------|----|----|',
    `| Pass rate | ${baseDelta.passRatePrev.toFixed(1)}% | ${baseDelta.passRateCurr.toFixed(1)}% | ${passSign}${baseDelta.passRateDelta.toFixed(1)}% |`,
    `| Duration | ${prevDur} | ${currDur} | ${durSign}${baseDelta.durationDeltaPercent.toFixed(1)}% |`,
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

  const baseline = trends.baselineLabel ? `vs \`${trends.baselineLabel}\` · ` : '';
  return `📈 ${baseline}${passStr} · ${durStr} · ${countStr}`;
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

function renderCustomBody(section: PrCommentSection): string | null {
  if (!section.commentTemplate) return null;
  if (!section.parsed || !section.meta) {
    core.warning(
      'Custom comment template provided but parsed/meta context is missing. Falling back to default comment.',
    );
    return null;
  }

  const context = buildTemplateContext({
    parsed: section.parsed,
    meta: section.meta,
    delta: section.delta ?? null,
    flaky: section.flaky ?? null,
    trends: section.trends ?? null,
    perfRegression: section.perfRegression ?? null,
    history: section.history ?? null,
    slowestLimit: section.slowestLimit,
  });
  const rendered = renderTemplate(section.commentTemplate, context, { label: 'comment' });
  if (rendered === null) return null;
  return capVisibleBody(stripMarkers(rendered), 'comment');
}

export function toStoredJobData(section: PrCommentSection): StoredJobData {
  const key = sanitizeMarkerName(section.testJobName);
  const customBody = renderCustomBody(section);
  if (customBody !== null) {
    return { key, testJobName: section.testJobName, customBody };
  }

  return {
    key,
    testJobName: section.testJobName,
    status: section.status,
    total: section.total,
    passed: section.passed,
    failed: section.failed,
    skipped: section.skipped,
    errored: section.errored,
    duration: section.duration,
    healthScore: section.healthScore ?? null,
    highlights: section.highlights ?? [],
    runUrl: section.runUrl,
    artifactUrl: section.artifactUrl,
    testsChanged: section.testsChanged ?? null,
    baseDelta: section.baseDelta ?? undefined,
    baseBranch: section.baseBranch,
    flaky: section.flaky ?? null,
    perfRegression: section.perfRegression ?? null,
    trends: section.trends ?? null,
  };
}

const MAX_BLOB_BYTES = 40_000;

function encodeJobBlob(job: StoredJobData): string {
  const b64 = Buffer.from(JSON.stringify(job), 'utf8').toString('base64');
  return `<!-- tj-data:${job.key} ${b64} -->`;
}

// The summary fields needed to keep a job's table row and rollup intact, without
// the heavy detail arrays. Used as a fallback so the comment stays under
// GitHub's limit when full per-job state would overflow it.
function summaryOnlyJob(job: StoredJobData): StoredJobData {
  return {
    key: job.key,
    testJobName: job.testJobName,
    customBody: job.customBody,
    status: job.status,
    total: job.total,
    passed: job.passed,
    failed: job.failed,
    skipped: job.skipped,
    errored: job.errored,
    duration: job.duration,
    healthScore: job.healthScore,
    runUrl: job.runUrl,
    artifactUrl: job.artifactUrl,
    baseBranch: job.baseBranch,
  };
}

function encodeJobBlobs(jobs: StoredJobData[]): string {
  const full = jobs.map(encodeJobBlob).join('\n');
  if (full.length <= MAX_BLOB_BYTES) return full;
  return jobs.map((j) => encodeJobBlob(summaryOnlyJob(j))).join('\n');
}

export function decodeJobBlobs(body: string): StoredJobData[] {
  const out: StoredJobData[] = [];
  const re = new RegExp(TJ_DATA_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    try {
      const json = Buffer.from(match[2], 'base64').toString('utf8');
      const data = JSON.parse(json) as StoredJobData;
      if (data && typeof data.key === 'string') out.push(data);
    } catch {
      // Malformed or legacy blob — skip; the owning job repopulates on its next run.
    }
  }
  return out;
}

// Recover jobs from a pre-blob comment so a migrating comment keeps every job's
// last-known output (as an opaque standalone block) instead of dropping all but
// the one currently merging. Each block is replaced by its real table row once
// that job runs again.
function decodeLegacySections(body: string): StoredJobData[] {
  const out: StoredJobData[] = [];
  const re = new RegExp(LEGACY_SECTION_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const key = sanitizeMarkerName(match[1]);
    out.push({ key, testJobName: key, customBody: match[2].trim() });
  }
  return out;
}

function isCustomJob(job: StoredJobData): boolean {
  return job.customBody !== undefined;
}

function failureCount(job: StoredJobData): number {
  return (job.failed ?? 0) + (job.errored ?? 0);
}

function jobLinks(job: StoredJobData, style: 'compact' | 'full'): string[] {
  const runLabel = style === 'compact' ? 'Run' : 'View Run →';
  const reportLabel = style === 'compact' ? 'Report' : '📄 HTML Report';
  const links: string[] = [];
  if (job.runUrl) links.push(`[${runLabel}](${escapeLinkUrl(job.runUrl)})`);
  if (job.artifactUrl) links.push(`[${reportLabel}](${escapeLinkUrl(job.artifactUrl)})`);
  return links;
}

function isNoteworthy(job: StoredJobData): boolean {
  return (
    failureCount(job) > 0 ||
    (job.highlights?.some((h) => h.severity !== 'info') ?? false) ||
    (job.baseDelta?.hasChanges ?? false) ||
    (job.testsChanged?.hasChanges ?? false) ||
    (job.flaky?.hasFlakyTests ?? false) ||
    (job.perfRegression?.hasRegressions ?? false)
  );
}

function renderSummaryRow(job: StoredJobData): string {
  const total = job.total ?? 0;
  const passed = job.passed ?? 0;
  const rate = passRate(passed, total);
  const result = failureCount(job) > 0 ? '🔴' : '✅';
  const health =
    job.healthScore === null || job.healthScore === undefined ? '—' : String(job.healthScore);

  const rateArrow = job.trends ? ` ${TREND_ARROW[job.trends.passRate.direction]}` : '';
  const durArrow = job.trends ? ` ${TREND_ARROW[job.trends.duration.direction]}` : '';

  const links = jobLinks(job, 'compact');
  const linkCell = links.length > 0 ? links.join(' · ') : '—';

  return `| ${escapeTableCell(job.testJobName)} | ${result} | ${passed}/${total} · ${rate}%${rateArrow} | ${formatDuration(job.duration ?? 0)}${durArrow} | ${health} | ${linkCell} |`;
}

function renderJobDetails(job: StoredJobData): string | null {
  if (!isNoteworthy(job)) return null;

  const lines: string[] = [];
  const summaryEmoji = failureCount(job) > 0 ? '🔴' : '🟡';
  lines.push('<details>');
  lines.push(`<summary>${summaryEmoji} ${escapeHtml(job.testJobName)} — details</summary>`);
  lines.push('');

  lines.push(
    renderMetricsStrip({
      passed: job.passed ?? 0,
      failed: job.failed ?? 0,
      skipped: job.skipped ?? 0,
      errored: job.errored ?? 0,
    }),
  );
  lines.push(renderProgressBar(Number(passRate(job.passed ?? 0, job.total ?? 0))));

  let statsLine = `⏱️ ${formatDuration(job.duration ?? 0)}`;
  if (job.healthScore !== null && job.healthScore !== undefined) {
    statsLine += ` · 🏥 ${job.healthScore}/100`;
  }
  lines.push(statsLine);

  if (job.trends) {
    lines.push(renderTrendLine(job.trends));
  }

  if (job.highlights && job.highlights.length > 0) {
    const sorted = [...job.highlights].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    lines.push('');
    lines.push('| Signal | Details |');
    lines.push('|--------|---------|');
    for (const h of sorted) {
      lines.push(renderHighlightRow(h));
    }
  }

  if (job.baseBranch && job.baseDelta != null) {
    lines.push('');
    lines.push(renderBaseBranchSection(job.baseDelta, job.baseBranch));
  }

  if (job.testsChanged && job.testsChanged.hasChanges) {
    lines.push('');
    lines.push(renderTestsChangedCompact(job.testsChanged));
  }

  if (job.flaky && job.flaky.hasFlakyTests) {
    lines.push('');
    lines.push(renderFlakyCompact(job.flaky));
  }

  if (job.perfRegression && job.perfRegression.hasRegressions) {
    lines.push('');
    lines.push(renderPerfRegressionCompact(job.perfRegression));
  }

  const links = jobLinks(job, 'full');
  if (links.length > 0) {
    lines.push('');
    lines.push(links.join(' · '));
  }

  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}

function renderRollupLine(tableJobs: StoredJobData[]): string {
  const totals = tableJobs.reduce(
    (acc, j) => ({
      passed: acc.passed + (j.passed ?? 0),
      failed: acc.failed + (j.failed ?? 0),
      errored: acc.errored + (j.errored ?? 0),
      total: acc.total + (j.total ?? 0),
      duration: acc.duration + (j.duration ?? 0),
    }),
    { passed: 0, failed: 0, errored: 0, total: 0, duration: 0 },
  );

  const rate = passRate(totals.passed, totals.total);
  const emoji = totals.failed > 0 || totals.errored > 0 ? '🔴' : '✅';
  const jobWord = tableJobs.length === 1 ? 'job' : 'jobs';
  let counts = `${totals.passed} passed`;
  if (totals.failed > 0) counts += `, ${totals.failed} failed`;
  if (totals.errored > 0) counts += `, ${totals.errored} errored`;

  return `${emoji} ${counts} across ${tableJobs.length} ${jobWord} — ${rate}% · ⏱️ ${formatDuration(totals.duration)}`;
}

function renderGlobalBaselineNote(tableJobs: StoredJobData[]): string | null {
  const awaiting = tableJobs.filter((j) => j.baseBranch && j.baseDelta == null);
  if (awaiting.length === 0) return null;

  const branches = [...new Set(awaiting.map((j) => j.baseBranch as string))];
  if (branches.length === 1) {
    return renderBaseBranchSection(null, branches[0]);
  }
  const branchList = branches.map((b) => `\`${b}\``).join(', ');
  return `> No base branch data available — push to ${branchList} to establish baseline`;
}

function renderCommentFromStored(jobs: StoredJobData[]): string {
  const tableJobs = jobs.filter((j) => !isCustomJob(j));
  const customJobs = jobs.filter(isCustomJob);

  const lines: string[] = [];
  lines.push(SUMMARY_MARKER);
  lines.push('## 🔬 TestGlance');
  lines.push('');

  if (tableJobs.length > 0) {
    lines.push(renderRollupLine(tableJobs));
    lines.push('');
    lines.push('| Job | Result | Pass rate | Duration | Health |  |');
    lines.push('|-----|:------:|-----------|----------|:------:|--|');
    for (const job of tableJobs) {
      lines.push(renderSummaryRow(job));
    }
    lines.push('');

    const baselineNote = renderGlobalBaselineNote(tableJobs);
    if (baselineNote) {
      lines.push(baselineNote);
      lines.push('');
    }

    for (const job of tableJobs) {
      const details = renderJobDetails(job);
      if (details) {
        lines.push(details);
        lines.push('');
      }
    }
  }

  for (const job of customJobs) {
    lines.push(`<!-- tj:${job.key} -->`);
    lines.push(job.customBody!);
    lines.push(`<!-- /tj:${job.key} -->`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Updated ${new Date().toISOString()}*`);

  // Blobs carry the per-job state and can't be lossily truncated, so reserve
  // their room first and cap the visible body to what's left — otherwise the
  // appended blobs push the comment past GitHub's hard limit and the post fails.
  const blobSection = jobs.length > 0 ? `\n\n${encodeJobBlobs(jobs)}` : '';
  const visibleBudget = Math.max(0, MAX_RENDERED_COMMENT_BYTES - blobSection.length);
  const visible = capVisibleBody(lines.join('\n'), 'comment', visibleBudget);
  return `${visible}${blobSection}`;
}

export function renderPrComment(sections: PrCommentSection[]): string {
  return renderCommentFromStored(sections.map(toStoredJobData));
}

export function mergeTestJobSection(existingBody: string, newSection: PrCommentSection): string {
  const existing = decodeJobBlobs(existingBody);
  if (existing.length === 0) {
    existing.push(...decodeLegacySections(existingBody));
  }
  const incoming = toStoredJobData(newSection);

  const idx = existing.findIndex((j) => j.key === incoming.key);
  if (idx >= 0) {
    existing[idx] = incoming;
  } else {
    existing.push(incoming);
  }

  return renderCommentFromStored(existing);
}
