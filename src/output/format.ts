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
