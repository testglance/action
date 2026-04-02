import type { Highlight, HighlightSeverity } from '../types';
import type { TestsChangedReport } from '../history/types';
import { formatDuration } from './summary';

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

export function renderTestJobSection(section: PrCommentSection): string {
  const safeKey = sanitizeMarkerName(section.testJobName);
  const statusEmoji = section.failed > 0 ? '❌' : '✅';

  const lines: string[] = [];
  lines.push(`<!-- tj:${safeKey} -->`);
  lines.push(`### ${statusEmoji} ${section.testJobName}`);

  let statsLine = `**${section.total} tests** | ${formatDuration(section.duration)}`;
  if (section.healthScore !== null && section.healthScore !== undefined) {
    statsLine += ` | Health: ${section.healthScore}/100`;
  }
  lines.push(statsLine);
  lines.push('');

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

  if (section.testsChanged && section.testsChanged.hasChanges) {
    lines.push(renderTestsChangedCompact(section.testsChanged));
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

export function renderPrComment(sections: PrCommentSection[]): string {
  const lines: string[] = [];
  lines.push('<!-- testglance-pr-summary -->');
  lines.push('## 🔬 TestGlance Test Summary');
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
