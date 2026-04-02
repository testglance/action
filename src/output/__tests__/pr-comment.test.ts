import { describe, it, expect } from 'vitest';
import type { PrCommentSection } from '../pr-comment';
import { renderTestJobSection, renderPrComment, mergeTestJobSection } from '../pr-comment';
import type { Highlight } from '../../types';
import type { TestsChangedReport } from '../../history/types';

function makeSection(overrides: Partial<PrCommentSection> = {}): PrCommentSection {
  return {
    testJobName: 'ci/test',
    status: 'passed',
    total: 313,
    passed: 313,
    failed: 0,
    duration: 11.2,
    healthScore: 94,
    highlights: [],
    runUrl: 'https://www.testglance.dev/runs/run_abc123',
    ...overrides,
  };
}

describe('renderTestJobSection', () => {
  it('renders passed section with correct emoji and stats', () => {
    const result = renderTestJobSection(makeSection());
    expect(result).toContain('<!-- tj:ci/test -->');
    expect(result).toContain('<!-- /tj:ci/test -->');
    expect(result).toContain('### ✅ ci/test');
    expect(result).toContain('**313 tests**');
    expect(result).toContain('11.2s');
    expect(result).toContain('Health: 94/100');
  });

  it('renders failed section with failure emoji', () => {
    const result = renderTestJobSection(makeSection({ status: 'failed', failed: 2 }));
    expect(result).toContain('### ❌ ci/test');
  });

  it('omits health score when null', () => {
    const result = renderTestJobSection(makeSection({ healthScore: null }));
    expect(result).not.toContain('Health:');
  });

  it('renders highlights as signal table', () => {
    const highlights: Highlight[] = [
      {
        type: 'new_failures',
        severity: 'critical',
        message: '1 new failure',
        data: { tests: [{ name: 'checkout.payment_flow', suite: 'checkout' }] },
      },
      {
        type: 'new_tests',
        severity: 'info',
        message: '2 new tests',
        data: { count: 2 },
      },
    ];
    const result = renderTestJobSection(makeSection({ highlights }));
    expect(result).toContain('| Signal | Details |');
    expect(result).toContain('🔴');
    expect(result).toContain('🔵');
  });

  it('renders View Run link when runUrl provided', () => {
    const result = renderTestJobSection(makeSection());
    expect(result).toContain('[View Run →](https://www.testglance.dev/runs/run_abc123)');
  });

  it('omits View Run link when runUrl is undefined', () => {
    const result = renderTestJobSection(makeSection({ runUrl: undefined }));
    expect(result).not.toContain('View Run');
  });

  it('renders clean section without signal table when no highlights', () => {
    const result = renderTestJobSection(makeSection({ highlights: [] }));
    expect(result).not.toContain('| Signal | Details |');
  });

  it('sanitizes testJobName markers to prevent HTML comment breakout', () => {
    const result = renderTestJobSection(makeSection({ testJobName: 'test-->hack' }));
    expect(result).toContain('<!-- tj:testhack -->');
    expect(result).toContain('<!-- /tj:testhack -->');
  });
});

describe('renderPrComment', () => {
  it('wraps sections with top marker, header, and footer', () => {
    const result = renderPrComment([makeSection()]);
    expect(result).toContain('<!-- testglance-pr-summary -->');
    expect(result).toContain('## 🔬 TestGlance Test Summary');
    expect(result).toContain('*Updated ');
  });

  it('separates multiple sections with ---', () => {
    const sections = [makeSection({ testJobName: 'unit' }), makeSection({ testJobName: 'e2e' })];
    const result = renderPrComment(sections);
    expect(result).toContain('<!-- tj:unit -->');
    expect(result).toContain('<!-- tj:e2e -->');
    expect(result).toContain('---');
  });
});

describe('mergeTestJobSection', () => {
  const existingBody = [
    '<!-- testglance-pr-summary -->',
    '## 🔬 TestGlance Test Summary',
    '',
    '<!-- tj:unit -->',
    '### ✅ unit',
    '**100 tests** | 5.0s | Health: 90/100',
    '<!-- /tj:unit -->',
    '',
    '---',
    '',
    '*Updated 2026-03-18T00:00:00.000Z*',
  ].join('\n');

  it('replaces existing section by marker', () => {
    const newSection = makeSection({ testJobName: 'unit', total: 200 });
    const result = mergeTestJobSection(existingBody, newSection);
    expect(result).toContain('**200 tests**');
    expect(result).not.toContain('**100 tests**');
    expect(result).toContain('<!-- tj:unit -->');
  });

  it('appends new section when not found', () => {
    const newSection = makeSection({ testJobName: 'e2e', total: 50 });
    const result = mergeTestJobSection(existingBody, newSection);
    expect(result).toContain('<!-- tj:unit -->');
    expect(result).toContain('<!-- tj:e2e -->');
    expect(result).toContain('**50 tests**');
  });

  it('preserves other TestJob sections', () => {
    const bodyWithTwo = [
      '<!-- testglance-pr-summary -->',
      '## 🔬 TestGlance Test Summary',
      '',
      '<!-- tj:unit -->',
      '### ✅ unit',
      '**100 tests** | 5.0s',
      '<!-- /tj:unit -->',
      '',
      '---',
      '',
      '<!-- tj:e2e -->',
      '### ❌ e2e',
      '**20 tests** | 30.0s',
      '<!-- /tj:e2e -->',
      '',
      '---',
      '',
      '*Updated 2026-03-18T00:00:00.000Z*',
    ].join('\n');

    const newSection = makeSection({ testJobName: 'unit', total: 150 });
    const result = mergeTestJobSection(bodyWithTwo, newSection);
    expect(result).toContain('**150 tests**');
    expect(result).toContain('<!-- tj:e2e -->');
    expect(result).toContain('**20 tests**');
  });
});

describe('PR comment tests-changed compact summary', () => {
  function makeTestsChanged(overrides: Partial<TestsChangedReport> = {}): TestsChangedReport {
    return {
      newTests: [],
      removedTests: [],
      statusChanged: [],
      hasChanges: true,
      ...overrides,
    };
  }

  it('compact summary line renders with correct counts', () => {
    const tc = makeTestsChanged({
      newTests: [
        { name: 'a', suite: 's', status: 'passed', duration: 0.1 },
        { name: 'b', suite: 's', status: 'passed', duration: 0.1 },
        { name: 'c', suite: 's', status: 'passed', duration: 0.1 },
        { name: 'd', suite: 's', status: 'passed', duration: 0.1 },
        { name: 'e', suite: 's', status: 'passed', duration: 0.1 },
      ],
      removedTests: [{ name: 'r', suite: 's', status: 'passed', duration: 0.1 }],
      statusChanged: [
        { name: 'x', suite: 's', status: 'failed', duration: 0.1, previousStatus: 'passed' },
        { name: 'y', suite: 's', status: 'passed', duration: 0.1, previousStatus: 'failed' },
      ],
    });
    const result = renderTestJobSection(makeSection({ testsChanged: tc }));
    expect(result).toContain('📝 5 new tests, 1 removed, 2 status changes');
  });

  it('newly failing tests highlighted with warning emoji', () => {
    const tc = makeTestsChanged({
      statusChanged: [
        { name: 'x', suite: 's', status: 'failed', duration: 0.1, previousStatus: 'passed' },
      ],
    });
    const result = renderTestJobSection(makeSection({ testsChanged: tc }));
    expect(result).toContain('⚠️ 1 newly failing');
  });

  it('summary line omitted when no changes', () => {
    const tc = makeTestsChanged({ hasChanges: false });
    const result = renderTestJobSection(makeSection({ testsChanged: tc }));
    expect(result).not.toContain('📝');
    expect(result).not.toContain('⚠️');
  });

  it('summary line omitted when testsChanged is null', () => {
    const result = renderTestJobSection(makeSection({ testsChanged: null }));
    expect(result).not.toContain('📝');
    expect(result).not.toContain('⚠️');
  });
});
