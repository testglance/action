import { describe, it, expect } from 'vitest';
import type { PrCommentSection } from '../pr-comment';
import {
  renderTestJobSection,
  renderPrComment,
  mergeTestJobSection,
  renderBaseBranchSection,
  renderFlakyCompact,
  renderPerfRegressionCompact,
  renderTrendLine,
} from '../pr-comment';
import type { Highlight } from '../../types';
import type {
  DeltaComparison,
  TestsChangedReport,
  FlakyDetectionResult,
  PerfRegressionResult,
  TrendIndicators,
} from '../../history/types';

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
    expect(result).toContain('### ✅ ci/test —');
    expect(result).toContain('✅ 313 passed');
    expect(result).not.toContain('❌ 0 failed');
    expect(result).toContain('11.2s');
    expect(result).toContain('🏥 94/100');
  });

  it('renders failed section with failure emoji', () => {
    const result = renderTestJobSection(makeSection({ status: 'failed', failed: 2 }));
    expect(result).toContain('### ❌ ci/test —');
  });

  it('omits health score when null', () => {
    const result = renderTestJobSection(makeSection({ healthScore: null }));
    expect(result).not.toContain('🏥');
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
    expect(result).toContain('## 🔬 TestGlance');
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
    const newSection = makeSection({ testJobName: 'unit', total: 200, passed: 200 });
    const result = mergeTestJobSection(existingBody, newSection);
    expect(result).toContain('✅ 200 passed');
    expect(result).not.toContain('**100 tests**');
    expect(result).toContain('<!-- tj:unit -->');
  });

  it('appends new section when not found', () => {
    const newSection = makeSection({ testJobName: 'e2e', total: 50, passed: 50 });
    const result = mergeTestJobSection(existingBody, newSection);
    expect(result).toContain('<!-- tj:unit -->');
    expect(result).toContain('<!-- tj:e2e -->');
    expect(result).toContain('✅ 50 passed');
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

    const newSection = makeSection({ testJobName: 'unit', total: 150, passed: 150 });
    const result = mergeTestJobSection(bodyWithTwo, newSection);
    expect(result).toContain('✅ 150 passed');
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
      passRatePrev: 95.0,
      passRateCurr: 90.0,
      passRateDelta: -5.0,
      durationPrev: 10.0,
      durationCurr: 12.0,
      durationDelta: 2.0,
      durationDeltaPercent: 20.0,
      hasChanges: true,
      ...overrides,
    };
  }

  it('renders no-data message when baseDelta is null', () => {
    const result = renderBaseBranchSection(null, 'main');
    expect(result).toContain('No base branch data available');
    expect(result).toContain('`main`');
    expect(result).toContain('establish baseline');
  });

  it('renders no-data message when baseDelta is undefined', () => {
    const result = renderBaseBranchSection(undefined, 'develop');
    expect(result).toContain('No base branch data available');
    expect(result).toContain('`develop`');
  });

  it('renders no-regressions checkmark when hasChanges is false', () => {
    const result = renderBaseBranchSection(makeDelta({ hasChanges: false }), 'main');
    expect(result).toContain(':white_check_mark:');
    expect(result).toContain('No regressions vs `main`');
  });

  it('renders comparison table with pass rate and duration deltas', () => {
    const result = renderBaseBranchSection(makeDelta(), 'main');
    expect(result).toContain('**vs `main`**');
    expect(result).toContain('| Pass rate | 95.0% | 90.0% | -5.0% |');
    expect(result).toContain('| Duration | 10.0s | 12.0s | +20.0% |');
  });

  it('renders regressions when newlyFailing tests exist', () => {
    const delta = makeDelta({
      newlyFailing: [
        { name: 'checkout.payment', suite: 's1' },
        { name: 'login.auth', suite: 's2' },
      ],
    });
    const result = renderBaseBranchSection(delta, 'main');
    expect(result).toContain('🔴 **Regressions:**');
    expect(result).toContain('`checkout.payment`');
    expect(result).toContain('`login.auth`');
  });

  it('renders improvements when newlyPassing tests exist', () => {
    const delta = makeDelta({
      newlyPassing: [{ name: 'fixed.test', suite: 's1' }],
    });
    const result = renderBaseBranchSection(delta, 'main');
    expect(result).toContain('🟢 **Improvements:**');
    expect(result).toContain('`fixed.test`');
  });

  it('caps regressions list at 5 with overflow count', () => {
    const delta = makeDelta({
      newlyFailing: Array.from({ length: 7 }, (_, i) => ({
        name: `test${i}`,
        suite: 's',
      })),
    });
    const result = renderBaseBranchSection(delta, 'main');
    expect(result).toContain('`test0`');
    expect(result).toContain('`test4`');
    expect(result).not.toContain('`test5`');
    expect(result).toContain('and 2 more');
  });
});

describe('renderTestJobSection with baseDelta', () => {
  function makeDelta(overrides: Partial<DeltaComparison> = {}): DeltaComparison {
    return {
      testsAdded: [],
      testsRemoved: [],
      newlyFailing: [],
      newlyPassing: [],
      passRatePrev: 100.0,
      passRateCurr: 100.0,
      passRateDelta: 0,
      durationPrev: 5.0,
      durationCurr: 5.0,
      durationDelta: 0,
      durationDeltaPercent: 0,
      hasChanges: false,
      ...overrides,
    };
  }

  it('includes base branch section when baseBranch and baseDelta are set', () => {
    const result = renderTestJobSection(
      makeSection({ baseBranch: 'main', baseDelta: makeDelta() }),
    );
    expect(result).toContain('No regressions vs `main`');
  });

  it('includes no-data message when baseDelta is null with baseBranch set', () => {
    const result = renderTestJobSection(makeSection({ baseBranch: 'main', baseDelta: null }));
    expect(result).toContain('No base branch data available');
  });

  it('omits base branch section when baseBranch is not set', () => {
    const result = renderTestJobSection(makeSection({ baseDelta: null }));
    expect(result).not.toContain('base branch');
  });

  it('places base branch section between highlights and testsChanged', () => {
    const tc: TestsChangedReport = {
      newTests: [{ name: 'a', suite: 's', status: 'passed', duration: 0.1 }],
      removedTests: [],
      statusChanged: [],
      hasChanges: true,
    };
    const result = renderTestJobSection(
      makeSection({
        baseBranch: 'main',
        baseDelta: makeDelta(),
        testsChanged: tc,
        highlights: [
          { type: 'new_tests', severity: 'info', message: '1 new test', data: { count: 1 } },
        ],
      }),
    );

    const highlightsIdx = result.indexOf('| Signal | Details |');
    const baseBranchIdx = result.indexOf('No regressions vs');
    const testsChangedIdx = result.indexOf('📝');
    expect(highlightsIdx).toBeLessThan(baseBranchIdx);
    expect(baseBranchIdx).toBeLessThan(testsChangedIdx);
  });
});

describe('renderFlakyCompact', () => {
  it('renders flaky test names with warning emoji', () => {
    const result: FlakyDetectionResult = {
      hasFlakyTests: true,
      flakyTests: [
        {
          name: 'test_login',
          suite: 'auth',
          flakyRate: 60,
          flipCount: 3,
          recentStatuses: ['passed', 'failed', 'passed'],
        },
        {
          name: 'test_upload',
          suite: 'files',
          flakyRate: 40,
          flipCount: 2,
          recentStatuses: ['passed', 'failed', 'passed'],
        },
      ],
    };
    const output = renderFlakyCompact(result);
    expect(output).toBe('⚠️ 2 flaky tests: `test_login`, `test_upload`');
  });

  it('returns empty string when no flaky tests', () => {
    const result: FlakyDetectionResult = { hasFlakyTests: false, flakyTests: [] };
    expect(renderFlakyCompact(result)).toBe('');
  });

  it('caps at 5 tests and shows +N more', () => {
    const flakyTests = Array.from({ length: 8 }, (_, i) => ({
      name: `test_${i}`,
      suite: 'suite',
      flakyRate: 50,
      flipCount: 2,
      recentStatuses: ['passed', 'failed', 'passed'] as const,
    }));
    const result: FlakyDetectionResult = { hasFlakyTests: true, flakyTests };
    const output = renderFlakyCompact(result);
    expect(output).toContain('+3 more');
    expect(output).toContain('⚠️ 8 flaky tests');
  });

  it('uses singular when only 1 flaky test', () => {
    const result: FlakyDetectionResult = {
      hasFlakyTests: true,
      flakyTests: [
        {
          name: 'test_solo',
          suite: 'suite',
          flakyRate: 50,
          flipCount: 2,
          recentStatuses: ['passed', 'failed', 'passed'],
        },
      ],
    };
    const output = renderFlakyCompact(result);
    expect(output).toBe('⚠️ 1 flaky test: `test_solo`');
  });

  it('renders names containing backticks safely in inline code', () => {
    const result: FlakyDetectionResult = {
      hasFlakyTests: true,
      flakyTests: [
        {
          name: 'test `with` tick\nline2',
          suite: 'suite',
          flakyRate: 50,
          flipCount: 2,
          recentStatuses: ['passed', 'failed', 'passed'],
        },
      ],
    };

    const output = renderFlakyCompact(result);
    expect(output).toBe('⚠️ 1 flaky test: ``test `with` tick line2``');
  });

  it('is wired into renderTestJobSection after testsChanged', () => {
    const section = makeSection({
      flaky: {
        hasFlakyTests: true,
        flakyTests: [
          {
            name: 'flaky_test',
            suite: 'suite',
            flakyRate: 50,
            flipCount: 2,
            recentStatuses: ['passed', 'failed', 'passed'],
          },
        ],
      },
    });
    const result = renderTestJobSection(section);
    expect(result).toContain('⚠️ 1 flaky test: `flaky_test`');
  });

  it('flaky section appears after testsChanged in renderTestJobSection', () => {
    const testsChanged: TestsChangedReport = {
      newTests: [{ name: 'new_test', suite: 'suite', status: 'passed', duration: 1.0 }],
      removedTests: [],
      statusChanged: [],
      hasChanges: true,
    };
    const section = makeSection({
      testsChanged,
      flaky: {
        hasFlakyTests: true,
        flakyTests: [
          {
            name: 'flaky_test',
            suite: 'suite',
            flakyRate: 50,
            flipCount: 2,
            recentStatuses: ['passed', 'failed', 'passed'],
          },
        ],
      },
    });
    const result = renderTestJobSection(section);
    const testsChangedIdx = result.indexOf('📝');
    const flakyIdx = result.indexOf('⚠️ 1 flaky test');
    expect(testsChangedIdx).toBeLessThan(flakyIdx);
  });
});

describe('renderPerfRegressionCompact', () => {
  it('renders regression names with snail emoji and percentages', () => {
    const result: PerfRegressionResult = {
      hasRegressions: true,
      regressions: [
        {
          name: 'test_heavy_query',
          suite: 'db',
          currentDuration: 4.0,
          medianDuration: 1.0,
          increasePercent: 350,
        },
        {
          name: 'test_render',
          suite: 'ui',
          currentDuration: 3.0,
          medianDuration: 1.0,
          increasePercent: 280,
        },
      ],
      sparkline: '▁▅',
    };
    const output = renderPerfRegressionCompact(result);
    expect(output).toBe('🐌 2 slower tests: `test_heavy_query` (+350%), `test_render` (+280%)');
  });

  it('returns empty string when no regressions', () => {
    const result: PerfRegressionResult = {
      hasRegressions: false,
      regressions: [],
      sparkline: '▄▄▄',
    };
    expect(renderPerfRegressionCompact(result)).toBe('');
  });

  it('caps at 3 tests and shows +N more', () => {
    const regressions = Array.from({ length: 5 }, (_, i) => ({
      name: `test_${i}`,
      suite: 'suite',
      currentDuration: 10.0,
      medianDuration: 1.0,
      increasePercent: 900 - i * 100,
    }));
    const result: PerfRegressionResult = {
      hasRegressions: true,
      regressions,
      sparkline: '▁',
    };
    const output = renderPerfRegressionCompact(result);
    expect(output).toContain('+2 more');
    expect(output).toContain('🐌 5 slower tests');
    expect(output).not.toContain('test_3');
  });

  it('uses singular when only 1 regression', () => {
    const result: PerfRegressionResult = {
      hasRegressions: true,
      regressions: [
        {
          name: 'test_solo',
          suite: 'suite',
          currentDuration: 10.0,
          medianDuration: 1.0,
          increasePercent: 900,
        },
      ],
      sparkline: '▁',
    };
    const output = renderPerfRegressionCompact(result);
    expect(output).toBe('🐌 1 slower test: `test_solo` (+900%)');
  });

  it('renders names containing backticks safely', () => {
    const result: PerfRegressionResult = {
      hasRegressions: true,
      regressions: [
        {
          name: 'test `with` ticks',
          suite: 'suite',
          currentDuration: 10.0,
          medianDuration: 1.0,
          increasePercent: 900,
        },
      ],
      sparkline: '▁',
    };
    const output = renderPerfRegressionCompact(result);
    expect(output).toContain('``test `with` ticks``');
  });

  it('is wired into renderTestJobSection after flaky', () => {
    const section = makeSection({
      perfRegression: {
        hasRegressions: true,
        regressions: [
          {
            name: 'slow_test',
            suite: 'suite',
            currentDuration: 10.0,
            medianDuration: 1.0,
            increasePercent: 900,
          },
        ],
        sparkline: '▁',
      },
    });
    const result = renderTestJobSection(section);
    expect(result).toContain('🐌 1 slower test: `slow_test` (+900%)');
  });

  it('perf section appears after flaky in renderTestJobSection', () => {
    const section = makeSection({
      flaky: {
        hasFlakyTests: true,
        flakyTests: [
          {
            name: 'flaky_test',
            suite: 'suite',
            flakyRate: 50,
            flipCount: 2,
            recentStatuses: ['passed', 'failed', 'passed'],
          },
        ],
      },
      perfRegression: {
        hasRegressions: true,
        regressions: [
          {
            name: 'slow_test',
            suite: 'suite',
            currentDuration: 10.0,
            medianDuration: 1.0,
            increasePercent: 900,
          },
        ],
        sparkline: '▁',
      },
    });
    const result = renderTestJobSection(section);
    const flakyIdx = result.indexOf('⚠️ 1 flaky test');
    const perfIdx = result.indexOf('🐌 1 slower test');
    expect(flakyIdx).toBeLessThan(perfIdx);
  });
});

function makeTrends(overrides: Partial<TrendIndicators> = {}): TrendIndicators {
  return {
    passRate: { direction: 'up', current: 97.5, delta: 2.3, sparkline: '' },
    duration: { direction: 'down', current: 12.4, delta: -1.2, deltaPercent: -8.8, sparkline: '' },
    testCount: { current: 100, delta: 3 },
    ...overrides,
  };
}

describe('renderTrendLine', () => {
  it('renders improving pass rate, faster duration, positive test count', () => {
    const line = renderTrendLine(makeTrends());
    expect(line).toContain('📈');
    expect(line).toContain('Pass rate: 97.5% ↑ (+2.3%)');
    expect(line).toContain('Duration: 12.4s ↓');
    expect(line).toContain('Tests: 100 (+3)');
  });

  it('renders stable indicators', () => {
    const line = renderTrendLine(
      makeTrends({
        passRate: { direction: 'stable', current: 95.0, delta: 0.2, sparkline: '' },
        duration: {
          direction: 'stable',
          current: 10.0,
          delta: 0.1,
          deltaPercent: 1.0,
          sparkline: '',
        },
        testCount: { current: 100, delta: 0 },
      }),
    );
    expect(line).toContain('Pass rate: 95.0% →');
    expect(line).toContain('Duration: 10.0s →');
    expect(line).toContain('Tests: 100 (+0)');
  });

  it('renders declining pass rate, slower duration, negative test count', () => {
    const line = renderTrendLine(
      makeTrends({
        passRate: { direction: 'down', current: 88.0, delta: -5.0, sparkline: '' },
        duration: { direction: 'up', current: 15.0, delta: 3.0, deltaPercent: 25.0, sparkline: '' },
        testCount: { current: 97, delta: -3 },
      }),
    );
    expect(line).toContain('Pass rate: 88.0% ↓ (-5.0%)');
    expect(line).toContain('Duration: 15.0s ↑');
    expect(line).toContain('Tests: 97 (-3)');
  });
});

describe('renderTestJobSection with trends', () => {
  it('includes trend line when trends present', () => {
    const section = makeSection({ trends: makeTrends() });
    const result = renderTestJobSection(section);
    expect(result).toContain('📈');
    expect(result).toContain('Pass rate: 97.5% ↑');
  });

  it('omits trend line when trends is null', () => {
    const section = makeSection({ trends: null });
    const result = renderTestJobSection(section);
    expect(result).not.toContain('📈');
  });

  it('omits trend line when trends is undefined', () => {
    const section = makeSection();
    const result = renderTestJobSection(section);
    expect(result).not.toContain('📈');
  });

  it('renders trend line between stats and highlights', () => {
    const section = makeSection({
      trends: makeTrends(),
      highlights: [
        { type: 'new_tests', severity: 'info' as const, message: 'msg', data: { count: 5 } },
      ],
    });
    const result = renderTestJobSection(section);
    const trendIdx = result.indexOf('📈');
    const highlightIdx = result.indexOf('| Signal |');
    expect(trendIdx).toBeGreaterThan(0);
    expect(trendIdx).toBeLessThan(highlightIdx);
  });
});
