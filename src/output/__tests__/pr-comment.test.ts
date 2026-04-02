import { describe, it, expect } from 'vitest';
import type { PrCommentSection } from '../pr-comment';
import {
  renderTestJobSection,
  renderPrComment,
  mergeTestJobSection,
  renderBaseBranchSection,
} from '../pr-comment';
import type { Highlight } from '../../types';
import type { DeltaComparison, TestsChangedReport } from '../../history/types';

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

  it('counts passed→errored as newly failing', () => {
    const tc = makeTestsChanged({
      statusChanged: [
        { name: 'x', suite: 's', status: 'errored', duration: 0.1, previousStatus: 'passed' },
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

describe('renderBaseBranchSection', () => {
  function makeDelta(overrides: Partial<DeltaComparison> = {}): DeltaComparison {
    return {
      testsAdded: [],
      testsRemoved: [],
      newlyFailing: [],
      newlyPassing: [],
      passRatePrev: 100,
      passRateCurr: 95,
      passRateDelta: -5,
      durationPrev: 10,
      durationCurr: 12,
      durationDelta: 2,
      durationDeltaPercent: 20,
      hasChanges: true,
      ...overrides,
    };
  }

  it('renders "no data" message when baseDelta is null', () => {
    const result = renderBaseBranchSection(null, 'main');
    expect(result).toContain('No base branch data available');
    expect(result).toContain('`main`');
    expect(result).toContain('establish baseline');
  });

  it('renders "no data" message when baseDelta is undefined', () => {
    const result = renderBaseBranchSection(undefined, 'main');
    expect(result).toContain('No base branch data available');
  });

  it('renders "no regressions" when hasChanges is false', () => {
    const result = renderBaseBranchSection(makeDelta({ hasChanges: false }), 'main');
    expect(result).toContain(':white_check_mark:');
    expect(result).toContain('No regressions vs `main`');
  });

  it('renders pass rate and duration deltas when changes exist', () => {
    const result = renderBaseBranchSection(makeDelta(), 'main');
    expect(result).toContain('vs `main`');
    expect(result).toContain('100.0%');
    expect(result).toContain('95.0%');
    expect(result).toContain('-5.0%');
    expect(result).toContain('10.0s');
    expect(result).toContain('12.0s');
    expect(result).toContain('+20%');
  });

  it('renders regressions when newlyFailing has entries', () => {
    const delta = makeDelta({
      newlyFailing: [
        { name: 'test1', suite: 'auth' },
        { name: 'test2', suite: 'checkout' },
      ],
    });
    const result = renderBaseBranchSection(delta, 'main');
    expect(result).toContain('🔴 **Regressions:**');
    expect(result).toContain('`auth::test1`');
    expect(result).toContain('`checkout::test2`');
  });

  it('renders improvements when newlyPassing has entries', () => {
    const delta = makeDelta({
      newlyPassing: [{ name: 'test1', suite: 'auth' }],
    });
    const result = renderBaseBranchSection(delta, 'main');
    expect(result).toContain('🟢 **Improvements:**');
    expect(result).toContain('`auth::test1`');
  });

  it('caps regressions at 5 with "and N more"', () => {
    const failing = Array.from({ length: 8 }, (_, i) => ({
      name: `test${i}`,
      suite: 'suite',
    }));
    const delta = makeDelta({ newlyFailing: failing });
    const result = renderBaseBranchSection(delta, 'main');
    expect(result).toContain('and 3 more');
    expect(result).not.toContain('test5');
  });

  it('caps improvements at 5 with "and N more"', () => {
    const passing = Array.from({ length: 7 }, (_, i) => ({
      name: `test${i}`,
      suite: 'suite',
    }));
    const delta = makeDelta({ newlyPassing: passing });
    const result = renderBaseBranchSection(delta, 'main');
    expect(result).toContain('and 2 more');
  });
});

describe('renderTestJobSection with baseDelta', () => {
  it('renders base branch section when baseBranch is set with delta', () => {
    const delta: DeltaComparison = {
      testsAdded: [],
      testsRemoved: [],
      newlyFailing: [],
      newlyPassing: [],
      passRatePrev: 100,
      passRateCurr: 100,
      passRateDelta: 0,
      durationPrev: 10,
      durationCurr: 10,
      durationDelta: 0,
      durationDeltaPercent: 0,
      hasChanges: false,
    };
    const result = renderTestJobSection(makeSection({ baseDelta: delta, baseBranch: 'main' }));
    expect(result).toContain('No regressions vs `main`');
  });

  it('renders "no data" when baseBranch is set but baseDelta is null', () => {
    const result = renderTestJobSection(makeSection({ baseDelta: null, baseBranch: 'main' }));
    expect(result).toContain('No base branch data available');
  });

  it('omits base branch section when baseBranch is not set', () => {
    const result = renderTestJobSection(makeSection());
    expect(result).not.toContain('base branch');
    expect(result).not.toContain('regressions');
  });

  it('places base branch section before testsChanged', () => {
    const delta: DeltaComparison = {
      testsAdded: [],
      testsRemoved: [],
      newlyFailing: [],
      newlyPassing: [],
      passRatePrev: 100,
      passRateCurr: 100,
      passRateDelta: 0,
      durationPrev: 10,
      durationCurr: 10,
      durationDelta: 0,
      durationDeltaPercent: 0,
      hasChanges: false,
    };
    const tc: TestsChangedReport = {
      newTests: [{ name: 'a', suite: 's', status: 'passed', duration: 0.1 }],
      removedTests: [],
      statusChanged: [],
      hasChanges: true,
    };
    const result = renderTestJobSection(
      makeSection({ baseDelta: delta, baseBranch: 'main', testsChanged: tc }),
    );
    const baseIdx = result.indexOf('No regressions');
    const changedIdx = result.indexOf('1 new tests');
    expect(baseIdx).toBeLessThan(changedIdx);
  });
});
