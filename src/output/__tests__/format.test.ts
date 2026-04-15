import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  formatDuration,
  truncate,
  renderProgressBar,
  statusEmoji,
  renderMetricsStrip,
} from '../format';

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes all special chars together', () => {
    expect(escapeHtml('<img src="x" alt=\'y\'> & z')).toBe(
      '&lt;img src=&quot;x&quot; alt=&#39;y&#39;&gt; &amp; z',
    );
  });
});

describe('formatDuration', () => {
  it('formats 0 seconds as 0ms', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('formats sub-second values in ms', () => {
    expect(formatDuration(0.236)).toBe('236ms');
    expect(formatDuration(0.303)).toBe('303ms');
  });

  it('formats sub-minute with one decimal', () => {
    expect(formatDuration(12.345)).toBe('12.3s');
  });

  it('formats 59.9 seconds', () => {
    expect(formatDuration(59.9)).toBe('59.9s');
  });

  it('formats exactly 60 seconds as minutes', () => {
    expect(formatDuration(60)).toBe('1m 0.0s');
  });

  it('formats multi-minute values', () => {
    expect(formatDuration(125.7)).toBe('2m 5.7s');
  });
});

describe('truncate', () => {
  it('returns short string unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns string at exactly limit unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates over-limit string with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });
});

describe('renderProgressBar', () => {
  it('renders 0% as all empty', () => {
    const result = renderProgressBar(0);
    expect(result).toBe('░░░░░░░░░░░░░░░░ 0.0%');
  });

  it('renders 100% as all filled', () => {
    const result = renderProgressBar(100);
    expect(result).toBe('████████████████ 100.0%');
  });

  it('renders 50% as half filled', () => {
    const result = renderProgressBar(50);
    expect(result).toBe('████████░░░░░░░░ 50.0%');
  });

  it('rounds correctly for fractional values', () => {
    const result = renderProgressBar(97.2);
    expect(result).toContain('97.2%');
    const filled = (result.match(/█/g) || []).length;
    const empty = (result.match(/░/g) || []).length;
    expect(filled + empty).toBe(16);
  });

  it('does not show full bar below 100%', () => {
    const result = renderProgressBar(99);
    const filled = (result.match(/█/g) || []).length;
    expect(filled).toBeLessThan(16);
    expect(result).toContain('░');
  });

  it('supports custom width', () => {
    const result = renderProgressBar(50, 10);
    const filled = (result.match(/█/g) || []).length;
    const empty = (result.match(/░/g) || []).length;
    expect(filled).toBe(5);
    expect(empty).toBe(5);
  });

  it('clamps values above 100', () => {
    const result = renderProgressBar(150);
    expect(result).toContain('100.0%');
  });

  it('clamps values below 0', () => {
    const result = renderProgressBar(-10);
    expect(result).toContain('0.0%');
  });
});

describe('statusEmoji', () => {
  it('returns ✅ when failed is 0', () => {
    expect(statusEmoji(0)).toBe('✅');
  });

  it('returns 🔴 when failed > 0', () => {
    expect(statusEmoji(1)).toBe('🔴');
    expect(statusEmoji(10)).toBe('🔴');
  });
});

describe('renderMetricsStrip', () => {
  it('renders all categories when populated', () => {
    const result = renderMetricsStrip({ passed: 138, failed: 3, skipped: 1, errored: 0 });
    expect(result).toBe('✅ 138 passed · ❌ 3 failed · ⏭️ 1 skipped');
  });

  it('omits zero-count categories except passed', () => {
    const result = renderMetricsStrip({ passed: 100, failed: 0, skipped: 0, errored: 0 });
    expect(result).toBe('✅ 100 passed');
  });

  it('includes errored when present', () => {
    const result = renderMetricsStrip({ passed: 10, failed: 1, skipped: 0, errored: 2 });
    expect(result).toBe('✅ 10 passed · ❌ 1 failed · 💥 2 errored');
  });

  it('handles all zeros', () => {
    const result = renderMetricsStrip({ passed: 0, failed: 0, skipped: 0, errored: 0 });
    expect(result).toBe('✅ 0 passed');
  });

  it('handles all categories populated', () => {
    const result = renderMetricsStrip({ passed: 5, failed: 2, skipped: 3, errored: 1 });
    expect(result).toBe('✅ 5 passed · ❌ 2 failed · ⏭️ 3 skipped · 💥 1 errored');
  });
});
