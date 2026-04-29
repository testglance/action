import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const mockWarning = vi.hoisted(() => vi.fn());

vi.mock('@actions/core', () => ({
  warning: mockWarning,
}));

import {
  renderTemplate,
  buildTemplateContext,
  resolveTemplatePath,
  _resetTemplateRendererForTests,
  _getHandlebarsInstanceForTests,
  type TemplateContext,
} from '../template-renderer';
import type { ParsedTestRun } from '../../types';
import type { DeltaComparison, FlakyDetectionResult, HistoryEntry } from '../../history/types';

const FIXTURES = path.resolve(__dirname, 'fixtures');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function makeParsed(): ParsedTestRun {
  return {
    summary: { total: 10, passed: 8, failed: 2, skipped: 0, errored: 0, duration: 12.345 },
    suites: [
      {
        name: 'auth',
        duration: 3.5,
        tests: [
          { name: 'logs in', suite: 'auth', status: 'passed', duration: 0.4 },
          {
            name: 'logs out',
            suite: 'auth',
            status: 'failed',
            duration: 1.2,
            errorMessage: 'expected true to be false',
            stackTrace: 'at auth.test.ts:42',
          },
          {
            name: 'errors on bad token',
            suite: 'auth',
            status: 'errored',
            duration: 0.1,
            errorMessage: 'TypeError: undefined is not a function',
          },
        ],
      },
      {
        name: 'billing',
        duration: 8.8,
        tests: [
          { name: 'charges card', suite: 'billing', status: 'passed', duration: 5.0 },
          { name: 'refunds', suite: 'billing', status: 'passed', duration: 2.0 },
          { name: 'skipped pro features', suite: 'billing', status: 'skipped', duration: 0 },
        ],
      },
    ],
  };
}

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  const base = buildTemplateContext({
    parsed: makeParsed(),
    meta: {
      commitSha: 'abc1234',
      branch: 'feat/x',
      workflowRunUrl: 'https://github.com/o/r/actions/runs/1',
      timestamp: '2026-04-27T10:00:00Z',
      jobName: 'tests',
    },
  });
  return { ...base, ...overrides };
}

describe('buildTemplateContext', () => {
  it('produces results with computed pass rate and counts', () => {
    const ctx = buildTemplateContext({
      parsed: makeParsed(),
      meta: {
        commitSha: 'abc1234',
        branch: 'main',
        workflowRunUrl: 'https://example.com',
        timestamp: '2026-04-27T10:00:00Z',
        jobName: 'tests',
      },
    });
    expect(ctx.results.total).toBe(10);
    expect(ctx.results.passed).toBe(8);
    expect(ctx.results.passRate).toBe('80.0');
    expect(ctx.results.duration).toBeCloseTo(12.345);
  });

  it('extracts failures (failed + errored) with error metadata', () => {
    const ctx = makeContext();
    expect(ctx.failures.map((f) => f.name)).toEqual(['logs out', 'errors on bad token']);
    expect(ctx.failures[0].errorMessage).toBe('expected true to be false');
    expect(ctx.failures[0].stackTrace).toBe('at auth.test.ts:42');
  });

  it('returns slowest tests sorted descending by duration', () => {
    const ctx = makeContext();
    expect(ctx.slowest[0].name).toBe('charges card');
    expect(ctx.slowest[0].duration).toBe(5.0);
    expect(ctx.slowest[1].duration).toBe(2.0);
  });

  it('summarises suites with per-status counts', () => {
    const ctx = makeContext();
    const auth = ctx.suites.find((s) => s.name === 'auth')!;
    expect(auth.total).toBe(3);
    expect(auth.passed).toBe(1);
    expect(auth.failed).toBe(1);
    expect(auth.errored).toBe(1);
    const billing = ctx.suites.find((s) => s.name === 'billing')!;
    expect(billing.skipped).toBe(1);
  });

  it('flattens flaky from FlakyDetectionResult', () => {
    const flaky: FlakyDetectionResult = {
      hasFlakyTests: true,
      flakyTests: [
        {
          name: 'sometimes',
          suite: 'auth',
          flipCount: 3,
          flakyRate: 30,
          recentStatuses: ['passed', 'failed', 'passed', 'failed', 'passed'],
        },
      ],
    };
    const ctx = buildTemplateContext({
      parsed: makeParsed(),
      meta: makeContext().meta,
      flaky,
    });
    expect(ctx.flaky).toEqual([{ name: 'sometimes', suite: 'auth', flipCount: 3, flakyRate: 30 }]);
  });

  it('omits flaky when no flaky tests', () => {
    const ctx = buildTemplateContext({
      parsed: makeParsed(),
      meta: makeContext().meta,
      flaky: { hasFlakyTests: false, flakyTests: [] },
    });
    expect(ctx.flaky).toBeUndefined();
  });

  it('passes through delta when provided', () => {
    const delta: DeltaComparison = {
      testsAdded: [],
      testsRemoved: [],
      newlyFailing: [],
      newlyPassing: [],
      passRatePrev: 90,
      passRateCurr: 80,
      passRateDelta: -10,
      durationPrev: 10,
      durationCurr: 12,
      durationDelta: 2,
      durationDeltaPercent: 20,
      hasChanges: true,
    };
    const ctx = buildTemplateContext({
      parsed: makeParsed(),
      meta: makeContext().meta,
      delta,
    });
    expect(ctx.delta).toBe(delta);
  });

  it('produces 0.0 pass rate when total is 0', () => {
    const empty: ParsedTestRun = {
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0, duration: 0 },
      suites: [],
    };
    const ctx = buildTemplateContext({ parsed: empty, meta: makeContext().meta });
    expect(ctx.results.passRate).toBe('0.0');
  });
});

describe('resolveTemplatePath', () => {
  it('returns absolute paths unchanged', () => {
    expect(resolveTemplatePath('/abs/path/template.hbs')).toBe('/abs/path/template.hbs');
  });

  it('resolves relative paths against GITHUB_WORKSPACE when set', () => {
    const prev = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = '/workspace';
    try {
      expect(resolveTemplatePath('template.hbs')).toBe('/workspace/template.hbs');
    } finally {
      if (prev === undefined) delete process.env.GITHUB_WORKSPACE;
      else process.env.GITHUB_WORKSPACE = prev;
    }
  });
});

describe('renderTemplate', () => {
  let prevWorkspace: string | undefined;

  beforeEach(() => {
    _resetTemplateRendererForTests();
    mockWarning.mockClear();
    prevWorkspace = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = REPO_ROOT;
  });

  afterEach(() => {
    if (prevWorkspace === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = prevWorkspace;
  });

  it('renders a valid template with all context fields', () => {
    const tplPath = path.join(FIXTURES, 'sample-summary.hbs');
    const ctx = makeContext();
    const result = renderTemplate(tplPath, ctx, { label: 'summary' });
    expect(result).not.toBeNull();
    expect(result).toContain('80.0% pass rate (8/10)');
    expect(result).toContain('Branch: feat/x');
    expect(result).toContain('Job: tests');
    expect(result).toContain('Failures (2)');
    expect(result).toContain('logs out in auth');
    expect(mockWarning).not.toHaveBeenCalled();
  });

  it('returns null and warns on missing file', () => {
    const result = renderTemplate('/nope/does-not-exist.hbs', makeContext(), { label: 'summary' });
    expect(result).toBeNull();
    expect(mockWarning).toHaveBeenCalledTimes(1);
    expect(mockWarning.mock.calls[0][0]).toContain('Custom summary template failed');
    expect(mockWarning.mock.calls[0][0]).toContain('/nope/does-not-exist.hbs');
    expect(mockWarning.mock.calls[0][0]).toContain('Falling back to default summary');
  });

  it('returns null and warns on syntax error', () => {
    const tplPath = path.join(FIXTURES, 'syntax-error.hbs');
    const result = renderTemplate(tplPath, makeContext(), { label: 'comment' });
    expect(result).toBeNull();
    expect(mockWarning).toHaveBeenCalledTimes(1);
    expect(mockWarning.mock.calls[0][0]).toContain('parse error');
    expect(mockWarning.mock.calls[0][0]).toContain('Falling back to default comment');
  });

  it('returns null and warns when render-time helper throws', () => {
    const handlebars = _getHandlebarsInstanceForTests();
    handlebars.registerHelper('crash', () => {
      throw new Error('boom');
    });
    const tempPath = path.join(FIXTURES, '__tmp-crash.hbs');
    fs.writeFileSync(tempPath, '{{crash}}', 'utf8');
    try {
      const result = renderTemplate(tempPath, makeContext(), { label: 'summary' });
      expect(result).toBeNull();
      expect(mockWarning).toHaveBeenCalled();
      const msg = mockWarning.mock.calls.map((c) => c[0]).join('\n');
      expect(msg).toContain('render error');
      expect(msg).toContain('boom');
    } finally {
      fs.unlinkSync(tempPath);
      handlebars.unregisterHelper('crash');
    }
  });

  it('registers formatDuration helper', () => {
    const tempPath = path.join(FIXTURES, '__tmp-helper.hbs');
    fs.writeFileSync(tempPath, '{{formatDuration 12.345}}', 'utf8');
    try {
      const result = renderTemplate(tempPath, makeContext(), { label: 'summary' });
      expect(result).toBe('12.3s');
    } finally {
      fs.unlinkSync(tempPath);
    }
  });

  it('registers passRate helper', () => {
    const tempPath = path.join(FIXTURES, '__tmp-passrate.hbs');
    fs.writeFileSync(tempPath, '{{passRate 9 10}}', 'utf8');
    try {
      const result = renderTemplate(tempPath, makeContext(), { label: 'summary' });
      expect(result).toBe('90.0');
    } finally {
      fs.unlinkSync(tempPath);
    }
  });

  it('registers truncate helper', () => {
    const tempPath = path.join(FIXTURES, '__tmp-truncate.hbs');
    fs.writeFileSync(tempPath, '{{truncate "abcdefghij" 5}}', 'utf8');
    try {
      const result = renderTemplate(tempPath, makeContext(), { label: 'summary' });
      expect(result).toBe('ab...');
    } finally {
      fs.unlinkSync(tempPath);
    }
  });

  it('renders missing optional fields as empty without error (strict:false)', () => {
    const tempPath = path.join(FIXTURES, '__tmp-missing.hbs');
    fs.writeFileSync(tempPath, 'A={{delta.passRateDelta}}|B={{flaky.length}}|END', 'utf8');
    try {
      const ctx = makeContext({ delta: undefined, flaky: undefined });
      const result = renderTemplate(tempPath, ctx, { label: 'summary' });
      expect(result).toBe('A=|B=|END');
      expect(mockWarning).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(tempPath);
    }
  });

  it('caches compiled templates by absolute path', () => {
    const handlebars = _getHandlebarsInstanceForTests();
    const compileSpy = vi.spyOn(handlebars, 'compile');
    try {
      const tplPath = path.join(FIXTURES, 'sample-summary.hbs');
      renderTemplate(tplPath, makeContext(), { label: 'summary' });
      renderTemplate(tplPath, makeContext(), { label: 'summary' });
      expect(compileSpy).toHaveBeenCalledTimes(1);
    } finally {
      compileSpy.mockRestore();
    }
  });

  it('rejects template paths that resolve outside GITHUB_WORKSPACE', () => {
    const outsideWorkspace = path.resolve(REPO_ROOT, '..');
    const tempPath = path.join(outsideWorkspace, '__testglance-outside-tmpl.hbs');
    fs.writeFileSync(tempPath, '{{results.total}}', 'utf8');
    try {
      const result = renderTemplate(tempPath, makeContext(), { label: 'summary' });
      expect(result).toBeNull();
      const msg = mockWarning.mock.calls.map((c) => c[0]).join('\n');
      expect(msg).toContain('outside GITHUB_WORKSPACE');
      expect(msg).toContain('Falling back to default summary');
    } finally {
      fs.unlinkSync(tempPath);
    }
  });

  it('rejects template paths containing newline characters', () => {
    const result = renderTemplate('foo\n::error::pwned.hbs', makeContext(), { label: 'summary' });
    expect(result).toBeNull();
    const msg = mockWarning.mock.calls.map((c) => c[0]).join('\n');
    expect(msg).toContain('newline');
  });

  it('rejects symlinks pointing outside GITHUB_WORKSPACE', () => {
    const target = path.resolve(REPO_ROOT, '..', '__testglance-outside-target.hbs');
    const link = path.join(FIXTURES, '__tmp-symlink-out.hbs');
    fs.writeFileSync(target, '{{results.total}}', 'utf8');
    try {
      try {
        fs.symlinkSync(target, link);
      } catch {
        // Skip on systems where symlink creation is unsupported (e.g. some CI Windows runners)
        return;
      }
      try {
        const result = renderTemplate(link, makeContext(), { label: 'summary' });
        expect(result).toBeNull();
        const msg = mockWarning.mock.calls.map((c) => c[0]).join('\n');
        expect(msg).toContain('outside GITHUB_WORKSPACE');
      } finally {
        fs.unlinkSync(link);
      }
    } finally {
      fs.unlinkSync(target);
    }
  });

  it('does not allow prototype property access in templates', () => {
    const tempPath = path.join(FIXTURES, '__tmp-proto.hbs');
    fs.writeFileSync(tempPath, 'X={{constructor.name}}|Y={{__proto__.toString}}|END', 'utf8');
    try {
      const result = renderTemplate(tempPath, makeContext(), { label: 'summary' });
      expect(result).toBe('X=|Y=|END');
    } finally {
      fs.unlinkSync(tempPath);
    }
  });

  it('flattens history into per-run rows for template context', () => {
    const entries: HistoryEntry[] = [
      {
        timestamp: '2026-04-01T00:00:00Z',
        commitSha: 'aaaa',
        summary: { total: 10, passed: 9, failed: 1, skipped: 0, errored: 0, duration: 4.5 },
        tests: [],
      },
      {
        timestamp: '2026-04-02T00:00:00Z',
        commitSha: 'bbbb',
        summary: { total: 10, passed: 10, failed: 0, skipped: 0, errored: 0, duration: 4.0 },
        tests: [],
      },
    ];
    const ctx = buildTemplateContext({
      parsed: makeParsed(),
      meta: makeContext().meta,
      history: entries,
    });
    expect(ctx.history).toEqual([
      { sha: 'aaaa', passRate: '90.0', duration: 4.5, timestamp: '2026-04-01T00:00:00Z' },
      { sha: 'bbbb', passRate: '100.0', duration: 4.0, timestamp: '2026-04-02T00:00:00Z' },
    ]);
  });
});
