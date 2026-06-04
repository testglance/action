export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toFixed(1)}s`;
}

export function formatDurationPair(a: number, b: number): [string, string] {
  const scale = Math.max(a, b);
  if (scale < 1) return [formatDuration(a), formatDuration(b)];
  if (scale < 60) return [`${a.toFixed(1)}s`, `${b.toFixed(1)}s`];
  return [formatDuration(a), formatDuration(b)];
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function renderProgressBar(passRate: number, width = 16): string {
  const clamped = Math.max(0, Math.min(100, passRate));
  const filled = clamped === 100 ? width : Math.floor((clamped / 100) * width);
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${clamped.toFixed(1)}%`;
}

export function statusEmoji(failed: number): string {
  return failed > 0 ? '🔴' : '✅';
}

export function renderMetricsStrip(summary: {
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
}): string {
  const parts: string[] = [`✅ ${summary.passed} passed`];
  if (summary.failed > 0) parts.push(`❌ ${summary.failed} failed`);
  if (summary.skipped > 0) parts.push(`⏭️ ${summary.skipped} skipped`);
  if (summary.errored > 0) parts.push(`💥 ${summary.errored} errored`);
  return parts.join(' · ');
}

const HEALTH_SCORE_FACTORS: { label: string; weight: string; detail: string }[] = [
  { label: 'Pass rate', weight: '70%', detail: 'share of tests passing' },
  { label: 'Flakiness', weight: '20%', detail: 'fewer flaky tests scores higher' },
  {
    label: 'Runtime trend',
    weight: '10%',
    detail: 'getting faster scores above neutral, slower below',
  },
];

const HEALTH_SCORE_FOOTNOTE =
  'A fully green, stable suite scores ~95; the final points require a measurably improving runtime trend. Needs at least 5 runs.';

export function renderHealthScoreDetails(): string {
  const factors = HEALTH_SCORE_FACTORS.map(
    (f) => `- **${f.label} (${f.weight})** — ${f.detail}`,
  ).join('\n');
  return [
    '<details><summary>ⓘ How is this scored?</summary>',
    '',
    'Health Score (0–100), blended over the last 30 days:',
    '',
    factors,
    '',
    HEALTH_SCORE_FOOTNOTE,
    '</details>',
  ].join('\n');
}

export function renderHealthScoreTooltipHtml(): string {
  const factors = HEALTH_SCORE_FACTORS.map(
    (f) =>
      `<li><strong>${escapeHtml(f.label)} (${f.weight})</strong> — ${escapeHtml(f.detail)}</li>`,
  ).join('');
  return (
    `<span class="health-info" tabindex="0" aria-label="How the health score is calculated">&#9432;` +
    `<span class="health-tooltip">` +
    `<strong>Health Score (0&ndash;100)</strong>, blended over the last 30 days:` +
    `<ul>${factors}</ul>` +
    `<span class="health-foot">${escapeHtml(HEALTH_SCORE_FOOTNOTE)}</span>` +
    `</span></span>`
  );
}

export interface SuiteHealth {
  passRate: number;
  failed: number;
  skipped: number;
  duration: number;
}

export function compareSuitesByHealth(a: SuiteHealth, b: SuiteHealth): number {
  if (a.passRate < 0 && b.passRate >= 0) return 1;
  if (b.passRate < 0 && a.passRate >= 0) return -1;
  if (a.passRate !== b.passRate) return a.passRate - b.passRate;
  if (a.failed !== b.failed) return b.failed - a.failed;
  if (a.skipped !== b.skipped) return b.skipped - a.skipped;
  return b.duration - a.duration;
}
