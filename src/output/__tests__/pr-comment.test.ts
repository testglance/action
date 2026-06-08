import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const mockCoreWarning = vi.hoisted(() => vi.fn());

vi.mock('@actions/core', () => ({
  warning: mockCoreWarning,
}));

import type { PrCommentSection } from '../pr-comment';
import {
  renderPrComment,
  mergeTestJobSection,
  renderBaseBranchSection,
  renderFlakyCompact,
  renderPerfRegressionCompact,
  renderTrendLine,
  decodeJobBlobs,
} from '../pr-comment';
import type { Highlight, ParsedTestRun } from '../../types';
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

describe('renderPrComment — unified table', () => {
  it('wraps the comment with the top marker, header, and updated footer', () => {
    const result = renderPrComment([makeSection()]);
    expect(result).toContain('<!-- testglance-pr-summary -->');
    expect(result).toContain('## 🔬 TestGlance');
    expect(result).toContain('*Updated ');
  });

  it('renders a rollup line summarizing all table jobs', () => {
    const result = renderPrComment([
      makeSection({ testJobName: 'test', total: 420, passed: 420, duration: 15.4 }),
      makeSection({ testJobName: 'test-e2e', total: 18, passed: 18, duration: 94.4 }),
    ]);
    expect(result).toContain('✅ 438 passed across 2 jobs — 100.0%');
  });

  it('uses singular "job" for a single job', () => {
    const result = renderPrComment([makeSection({ total: 313, passed: 313 })]);
    expect(result).toContain('across 1 job —');
  });

  it('renders one table row per job with name, result, pass rate, duration, health, links', () => {
    const result = renderPrComment([
      makeSection({
        testJobName: 'test',
        total: 420,
        passed: 420,
        duration: 15.4,
        healthScore: 95,
      }),
    ]);
    expect(result).toContain('| Job | Result | Pass rate | Duration | Health |  |');
    expect(result).toContain(
      '| test | ✅ | 420/420 · 100.0% | 15.4s | 95 | [Run](https://www.testglance.dev/runs/run_abc123) |',
    );
  });

  it('marks failed jobs with 🔴 in the rollup and row', () => {
    const result = renderPrComment([
      makeSection({ status: 'failed', total: 100, passed: 98, failed: 2 }),
    ]);
    expect(result).toContain('🔴 98 passed, 2 failed across 1 job — 98.0%');
    expect(result).toContain('| ci/test | 🔴 |');
  });

  it('renders an em dash for the health cell when health score is null', () => {
    const result = renderPrComment([makeSection({ healthScore: null })]);
    expect(result).toContain('| ci/test | ✅ | 313/313 · 100.0% | 11.2s | — |');
  });

  it('renders an em dash for the links cell when no urls are provided', () => {
    const result = renderPrComment([makeSection({ runUrl: undefined, artifactUrl: undefined })]);
    expect(result).toMatch(/\| 11\.2s \| 94 \| — \|/);
  });

  it('renders the artifact report link alongside the run link', () => {
    const result = renderPrComment([
      makeSection({ artifactUrl: 'https://example.com/report.html' }),
    ]);
    expect(result).toContain(
      '[Run](https://www.testglance.dev/runs/run_abc123) · [Report](https://example.com/report.html)',
    );
  });

  it('does not render a details block for an all-green job', () => {
    const result = renderPrComment([makeSection()]);
    expect(result).not.toContain('<details>');
  });

  it('renders a single global baseline note when every job lacks baseline data', () => {
    const result = renderPrComment([
      makeSection({ testJobName: 'a', baseBranch: 'main', baseDelta: null }),
      makeSection({ testJobName: 'b', baseBranch: 'main', baseDelta: null }),
    ]);
    const matches = result.match(/No base branch data available/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(result).toContain('push to `main`');
  });

  it('omits the baseline note when no job has a base branch configured', () => {
    const result = renderPrComment([makeSection()]);
    expect(result).not.toContain('No base branch data available');
  });

  it('embeds a hidden tj-data blob per job', () => {
    const result = renderPrComment([makeSection({ testJobName: 'unit' })]);
    expect(result).toMatch(/<!-- tj-data:unit [A-Za-z0-9+/=]+ -->/);
  });

  it('sanitizes the job name used as the blob key', () => {
    const result = renderPrComment([makeSection({ testJobName: 'test-->hack' })]);
    expect(result).toContain('<!-- tj-data:testhack ');
  });
});

describe('renderPrComment — per-job details', () => {
  function critical(): Highlight {
    return {
      type: 'new_failures',
      severity: 'critical',
      message: '1 new failure',
      data: { tests: [{ name: 'checkout.payment_flow', suite: 'checkout' }] },
    };
  }

  it('does not expand a job whose only highlight is informational', () => {
    const result = renderPrComment([
      makeSection({
        highlights: [
          {
            type: 'health_score_delta',
            severity: 'info',
            message: 'Health Score: 95 → 95',
            data: { previous: 95, current: 95, direction: 'flat' },
          },
        ],
      }),
    ]);
    expect(result).not.toContain('<details>');
  });

  it('expands a job with a critical highlight and renders the signal table', () => {
    const result = renderPrComment([makeSection({ highlights: [critical()] })]);
    expect(result).toContain('<details>');
    expect(result).toContain('<summary>🟡 ci/test — details</summary>');
    expect(result).toContain('| Signal | Details |');
    expect(result).toContain('🔴');
  });

  it('uses a 🔴 summary marker when the job has failures', () => {
    const result = renderPrComment([
      makeSection({
        status: 'failed',
        total: 100,
        passed: 99,
        failed: 1,
        highlights: [critical()],
      }),
    ]);
    expect(result).toContain('<summary>🔴 ci/test — details</summary>');
  });

  it('keeps the progress bar inside the details block', () => {
    const result = renderPrComment([makeSection({ highlights: [critical()] })]);
    const detailsIdx = result.indexOf('<details>');
    const barIdx = result.indexOf('█');
    expect(detailsIdx).toBeGreaterThanOrEqual(0);
    expect(barIdx).toBeGreaterThan(detailsIdx);
  });

  it('renders the trend line inside the details block when present', () => {
    const result = renderPrComment([
      makeSection({
        highlights: [critical()],
        trends: {
          passRate: { direction: 'up', current: 97.5, delta: 2.3, sparkline: '' },
          duration: {
            direction: 'down',
            current: 12.4,
            delta: -1.2,
            deltaPercent: -8.8,
            sparkline: '',
          },
          testCount: { current: 100, delta: 3 },
        },
      }),
    ]);
    expect(result).toContain('📈');
    expect(result).toContain('Pass rate: 97.5% ↑');
  });

  it('expands a job with base-branch regressions and renders the comparison', () => {
    const baseDelta: DeltaComparison = {
      testsAdded: [],
      testsRemoved: [],
      newlyFailing: [{ name: 'login.auth', suite: 's' }],
      newlyPassing: [],
      passRatePrev: 100,
      passRateCurr: 99,
      passRateDelta: -1,
      durationPrev: 10,
      durationCurr: 11,
      durationDelta: 1,
      durationDeltaPercent: 10,
      hasChanges: true,
    };
    const result = renderPrComment([makeSection({ baseBranch: 'main', baseDelta })]);
    expect(result).toContain('<details>');
    expect(result).toContain('🔴 **Regressions:**');
    expect(result).toContain('`login.auth`');
  });
});

describe('mergeTestJobSection — upsert by job key', () => {
  it('appends a new job, preserving the existing one', () => {
    const initial = renderPrComment([
      makeSection({ testJobName: 'unit', total: 100, passed: 100 }),
    ]);
    const merged = mergeTestJobSection(
      initial,
      makeSection({ testJobName: 'e2e', total: 50, passed: 50 }),
    );
    expect(merged).toContain('| unit |');
    expect(merged).toContain('| e2e |');
    const blobs = decodeJobBlobs(merged);
    expect(blobs.map((b) => b.key)).toEqual(['unit', 'e2e']);
  });

  it('replaces an existing job in place without duplicating it', () => {
    const initial = renderPrComment([
      makeSection({ testJobName: 'unit', total: 100, passed: 100 }),
    ]);
    const merged = mergeTestJobSection(
      initial,
      makeSection({ testJobName: 'unit', total: 200, passed: 200 }),
    );
    expect(merged).toContain('200/200 · 100.0%');
    expect(merged).not.toContain('100/100');
    const blobs = decodeJobBlobs(merged);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].key).toBe('unit');
  });

  it('preserves job order across multiple merges', () => {
    let body = renderPrComment([makeSection({ testJobName: 'unit' })]);
    body = mergeTestJobSection(body, makeSection({ testJobName: 'integration' }));
    body = mergeTestJobSection(body, makeSection({ testJobName: 'e2e' }));
    body = mergeTestJobSection(
      body,
      makeSection({ testJobName: 'integration', passed: 1, total: 1 }),
    );
    expect(decodeJobBlobs(body).map((b) => b.key)).toEqual(['unit', 'integration', 'e2e']);
  });

  it('rebuilds from only the incoming job when the existing comment has no blobs (legacy)', () => {
    const legacyBody = [
      '<!-- testglance-pr-summary -->',
      '## 🔬 TestGlance',
      '### old-job',
      '*Updated 2026-03-18T00:00:00.000Z*',
    ].join('\n');
    const merged = mergeTestJobSection(legacyBody, makeSection({ testJobName: 'unit' }));
    expect(decodeJobBlobs(merged).map((b) => b.key)).toEqual(['unit']);
    expect(merged).toContain('| unit |');
  });

  it('preserves sibling jobs from a pre-blob comment (old tj: markers, no blobs)', () => {
    const legacyBody = [
      '<!-- testglance-pr-summary -->',
      '## 🔬 TestGlance',
      '',
      '<!-- tj:unit -->',
      '### ✅ unit',
      '**100 tests** | 5.0s | Health: 90/100',
      '<!-- /tj:unit -->',
      '',
      '---',
      '',
      '<!-- tj:e2e -->',
      '### ❌ e2e',
      '**20 tests** | 30.0s',
      '<!-- /tj:e2e -->',
      '',
      '*Updated 2026-03-18T00:00:00.000Z*',
    ].join('\n');

    const merged = mergeTestJobSection(
      legacyBody,
      makeSection({ testJobName: 'unit', passed: 1, total: 1 }),
    );
    const keys = decodeJobBlobs(merged).map((b) => b.key);
    expect(keys).toContain('unit');
    expect(keys).toContain('e2e');
    expect(merged).toContain('**20 tests**');
  });
});

describe('tj-data blob round-trip', () => {
  it('decodes the data embedded by the renderer', () => {
    const body = renderPrComment([
      makeSection({ testJobName: 'unit', total: 200, passed: 198, failed: 2, healthScore: 88 }),
    ]);
    const [job] = decodeJobBlobs(body);
    expect(job.key).toBe('unit');
    expect(job.passed).toBe(198);
    expect(job.failed).toBe(2);
    expect(job.healthScore).toBe(88);
  });

  it('skips malformed blobs without throwing', () => {
    const body = [
      renderPrComment([makeSection({ testJobName: 'unit' })]),
      '<!-- tj-data:broken @@@not-base64@@@ -->',
    ].join('\n');
    const blobs = decodeJobBlobs(body);
    expect(blobs.map((b) => b.key)).toEqual(['unit']);
  });

  it('keeps blob payloads inside HTML comments so they stay hidden', () => {
    const body = renderPrComment([makeSection({ testJobName: 'unit' })]);
    const blobLine = body.split('\n').find((l) => l.includes('tj-data:unit'));
    expect(blobLine).toMatch(/^<!--.*-->$/);
  });
});

describe('errored tests are treated as failures', () => {
  it('marks an errored-but-not-failed job 🔴 in the row and rollup', () => {
    const result = renderPrComment([
      makeSection({ status: 'passed', total: 100, passed: 98, failed: 0, errored: 2 }),
    ]);
    expect(result).toContain('| ci/test | 🔴 |');
    expect(result).toContain('🔴 98 passed, 2 errored across 1 job —');
  });

  it('expands an errored job and surfaces the errored count', () => {
    const result = renderPrComment([
      makeSection({ status: 'passed', total: 100, passed: 98, failed: 0, errored: 2 }),
    ]);
    expect(result).toContain('<details>');
    expect(result).toContain('<summary>🔴 ci/test — details</summary>');
    expect(result).toContain('💥 2 errored');
  });

  it('surfaces skipped counts in the details metrics strip', () => {
    const result = renderPrComment([
      makeSection({ status: 'failed', total: 100, passed: 97, failed: 1, skipped: 2 }),
    ]);
    expect(result).toContain('⏭️ 2 skipped');
  });
});

describe('trend indicators are not lost on quiet jobs', () => {
  it('shows trend arrows in the table row for an all-green job with trends', () => {
    const result = renderPrComment([
      makeSection({
        trends: {
          passRate: { direction: 'up', current: 100, delta: 1, sparkline: '' },
          duration: {
            direction: 'down',
            current: 11.2,
            delta: -1,
            deltaPercent: -8,
            sparkline: '',
          },
          testCount: { current: 313, delta: 0 },
        },
      }),
    ]);
    expect(result).not.toContain('<details>');
    expect(result).toMatch(/100\.0% ↑ \| 11\.2s ↓ \|/);
  });
});

describe('baseline note', () => {
  it('surfaces the note when only some jobs lack baseline data (mixed)', () => {
    const withData: DeltaComparison = {
      testsAdded: [],
      testsRemoved: [],
      newlyFailing: [],
      newlyPassing: [],
      passRatePrev: 100,
      passRateCurr: 100,
      passRateDelta: 0,
      durationPrev: 5,
      durationCurr: 5,
      durationDelta: 0,
      durationDeltaPercent: 0,
      hasChanges: false,
    };
    const result = renderPrComment([
      makeSection({ testJobName: 'a', baseBranch: 'main', baseDelta: withData }),
      makeSection({ testJobName: 'b', baseBranch: 'main', baseDelta: null }),
    ]);
    expect(result).toContain('No base branch data available');
    expect(result).toContain('push to `main`');
  });
});

describe('comment size cap', () => {
  it('keeps the full comment (visible + blobs) within the limit', () => {
    const huge = 'x'.repeat(5000);
    const sections = Array.from({ length: 40 }, (_, i) =>
      makeSection({
        testJobName: `job-${i}`,
        status: 'failed',
        total: 100,
        passed: 50,
        failed: 50,
        highlights: [
          {
            type: 'new_failures',
            severity: 'critical',
            message: huge,
            data: { tests: [{ name: huge, suite: huge }] },
          },
        ],
      }),
    );
    const result = renderPrComment(sections);
    expect(result.length).toBeLessThanOrEqual(60_000);
  });
});

describe('table cell escaping', () => {
  it('percent-encodes parentheses in link URLs so the link does not break', () => {
    const result = renderPrComment([makeSection({ artifactUrl: 'https://ex.com/report(1).html' })]);
    expect(result).toContain('https://ex.com/report%281%29.html');
    expect(result).not.toContain('report(1).html');
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

describe('tests-changed compact summary', () => {
  function makeTestsChanged(overrides: Partial<TestsChangedReport> = {}): TestsChangedReport {
    return {
      newTests: [],
      removedTests: [],
      statusChanged: [],
      hasChanges: true,
      ...overrides,
    };
  }

  it('renders the compact line with correct counts inside details', () => {
    const tc = makeTestsChanged({
      newTests: [
        { name: 'a', suite: 's', status: 'passed', duration: 0.1 },
        { name: 'b', suite: 's', status: 'passed', duration: 0.1 },
      ],
      removedTests: [{ name: 'r', suite: 's', status: 'passed', duration: 0.1 }],
      statusChanged: [
        { name: 'x', suite: 's', status: 'failed', duration: 0.1, previousStatus: 'passed' },
      ],
    });
    const result = renderPrComment([makeSection({ testsChanged: tc })]);
    expect(result).toContain('<details>');
    expect(result).toContain('⚠️ 1 newly failing | 📝 2 new tests, 1 removed, 1 status changes');
  });

  it('does not expand a job when testsChanged has no changes', () => {
    const result = renderPrComment([
      makeSection({ testsChanged: makeTestsChanged({ hasChanges: false }) }),
    ]);
    expect(result).not.toContain('<details>');
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

  it('is wired into the job details block', () => {
    const result = renderPrComment([
      makeSection({
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
      }),
    ]);
    expect(result).toContain('<details>');
    expect(result).toContain('⚠️ 1 flaky test: `flaky_test`');
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

  it('is wired into the job details block', () => {
    const result = renderPrComment([
      makeSection({
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
      }),
    ]);
    expect(result).toContain('<details>');
    expect(result).toContain('🐌 1 slower test: `slow_test` (+900%)');
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

describe('custom comment template', () => {
  const FIXTURES = path.resolve(__dirname, 'fixtures');
  const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

  function makeParsed(): ParsedTestRun {
    return {
      summary: { total: 100, passed: 95, failed: 5, skipped: 0, errored: 0, duration: 10 },
      suites: [
        {
          name: 'all',
          duration: 10,
          tests: [
            { name: 'pass-one', suite: 'all', status: 'passed', duration: 0.1 },
            {
              name: 'fail-one',
              suite: 'all',
              status: 'failed',
              duration: 0.2,
              errorMessage: 'oops',
            },
          ],
        },
      ],
    };
  }

  const meta = {
    commitSha: 'abc1234',
    branch: 'feat/x',
    workflowRunUrl: 'https://github.com/o/r/actions/runs/1',
    timestamp: '2026-04-27T10:00:00Z',
    jobName: 'ci/test',
  };

  let prevWorkspace: string | undefined;

  beforeEach(async () => {
    mockCoreWarning.mockClear();
    const mod = await import('../template-renderer');
    mod._resetTemplateRendererForTests();
    prevWorkspace = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = REPO_ROOT;
  });

  afterEach(() => {
    if (prevWorkspace === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = prevWorkspace;
  });

  it('renders a custom-template job as a standalone block below the table', () => {
    const tplPath = path.join(FIXTURES, '__tmp-comment.hbs');
    fs.writeFileSync(tplPath, 'CUSTOM BODY for {{meta.jobName}}: {{results.passRate}}%', 'utf8');
    try {
      const section = makeSection({
        commentTemplate: tplPath,
        parsed: makeParsed(),
        meta,
      });
      const result = renderPrComment([section]);
      expect(result).toContain(
        '<!-- tj:ci/test -->\nCUSTOM BODY for ci/test: 95.0%\n<!-- /tj:ci/test -->',
      );
      expect(result).not.toContain('| Job | Result |');
      expect(mockCoreWarning).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(tplPath);
    }
  });

  it('falls back to a normal table row when the template is invalid', () => {
    const section = makeSection({
      commentTemplate: '/no/such/comment.hbs',
      parsed: makeParsed(),
      meta,
    });
    const result = renderPrComment([section]);
    expect(result).toContain('| ci/test | ✅ |');
    expect(result).not.toContain('### ci/test');
    expect(mockCoreWarning).toHaveBeenCalledWith(
      expect.stringContaining('Custom comment template failed'),
    );
  });

  it('does not invoke the template renderer when commentTemplate is absent', () => {
    const result = renderPrComment([makeSection({ parsed: makeParsed(), meta })]);
    expect(result).toContain('| ci/test | ✅ |');
    expect(mockCoreWarning).not.toHaveBeenCalled();
  });

  it('merges custom-template jobs by key, replacing in place', () => {
    const tplPath = path.join(FIXTURES, '__tmp-comment-merge.hbs');
    fs.writeFileSync(tplPath, 'CUSTOM-{{meta.jobName}}', 'utf8');
    try {
      const sectionA = makeSection({
        testJobName: 'job-a',
        commentTemplate: tplPath,
        parsed: makeParsed(),
        meta: { ...meta, jobName: 'job-a' },
      });
      const sectionB = makeSection({
        testJobName: 'job-b',
        commentTemplate: tplPath,
        parsed: makeParsed(),
        meta: { ...meta, jobName: 'job-b' },
      });

      const initialBody = renderPrComment([sectionA]);
      expect(initialBody).toContain('<!-- tj:job-a -->\nCUSTOM-job-a\n<!-- /tj:job-a -->');

      const merged = mergeTestJobSection(initialBody, sectionB);
      expect(merged).toContain('<!-- tj:job-a -->\nCUSTOM-job-a\n<!-- /tj:job-a -->');
      expect(merged).toContain('<!-- tj:job-b -->\nCUSTOM-job-b\n<!-- /tj:job-b -->');

      const replacedSectionA = makeSection({
        testJobName: 'job-a',
        commentTemplate: tplPath,
        parsed: makeParsed(),
        meta: { ...meta, jobName: 'job-a-v2' },
      });
      const reMerged = mergeTestJobSection(merged, replacedSectionA);
      expect(reMerged).toContain('<!-- tj:job-a -->\nCUSTOM-job-a-v2\n<!-- /tj:job-a -->');
      expect(reMerged).toContain('<!-- tj:job-b -->\nCUSTOM-job-b\n<!-- /tj:job-b -->');
    } finally {
      fs.unlinkSync(tplPath);
    }
  });

  it('strips embedded job-section markers from the custom body', () => {
    const tplPath = path.join(FIXTURES, '__tmp-marker-inject.hbs');
    fs.writeFileSync(tplPath, 'before<!-- tj:evil -->mid<!-- /tj:evil -->after', 'utf8');
    try {
      const section = makeSection({
        testJobName: 'job-a',
        commentTemplate: tplPath,
        parsed: makeParsed(),
        meta: { ...meta, jobName: 'job-a' },
      });
      const body = renderPrComment([section]);
      expect(body).not.toContain('<!-- tj:evil -->');
      expect(body).not.toContain('<!-- /tj:evil -->');
      expect(body).toContain('beforemidafter');
      expect(body).toContain('<!-- tj:job-a -->');
    } finally {
      fs.unlinkSync(tplPath);
    }
  });

  it('falls back to the "tests" marker when the sanitized job name is empty', () => {
    const tplPath = path.join(FIXTURES, '__tmp-empty-job.hbs');
    fs.writeFileSync(tplPath, 'BODY', 'utf8');
    try {
      const section = makeSection({
        testJobName: '-->',
        commentTemplate: tplPath,
        parsed: makeParsed(),
        meta: { ...meta, jobName: 'whatever' },
      });
      const result = renderPrComment([section]);
      expect(result).toContain('<!-- tj:tests -->\nBODY\n<!-- /tj:tests -->');
    } finally {
      fs.unlinkSync(tplPath);
    }
  });
});
