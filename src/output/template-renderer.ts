import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import * as core from '@actions/core';
import Handlebars from 'handlebars';
import { escapeHtml, formatDuration, truncate } from './format';
import type { ParsedTestRun, ParsedSuite, ParsedTestCase } from '../types';
import type {
  DeltaComparison,
  FlakyDetectionResult,
  PerfRegressionResult,
  TrendIndicators,
} from '../history/types';

export interface TemplateContextResults {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  passRate: string;
  duration: number;
}

export interface TemplateContextFailure {
  name: string;
  suite: string;
  errorMessage: string;
  stackTrace: string;
  duration: number;
}

export interface TemplateContextSlowest {
  name: string;
  suite: string;
  duration: number;
}

export interface TemplateContextSuite {
  name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  duration: number;
}

export interface TemplateContextHistoryEntry {
  sha: string;
  passRate: string;
  duration: number;
  timestamp: string;
}

export interface TemplateContextFlaky {
  name: string;
  suite: string;
  flipCount: number;
  flakyRate: number;
}

export interface TemplateContextMeta {
  commitSha: string;
  branch: string;
  workflowRunUrl: string;
  timestamp: string;
  jobName: string;
}

export interface TemplateContext {
  results: TemplateContextResults;
  failures: TemplateContextFailure[];
  slowest: TemplateContextSlowest[];
  suites: TemplateContextSuite[];
  history?: TemplateContextHistoryEntry[];
  delta?: DeltaComparison;
  flaky?: TemplateContextFlaky[];
  trends?: TrendIndicators;
  perfRegression?: PerfRegressionResult;
  meta: TemplateContextMeta;
}

export interface BuildTemplateContextInput {
  parsed: ParsedTestRun;
  meta: TemplateContextMeta;
  delta?: DeltaComparison | null;
  flaky?: FlakyDetectionResult | null;
  trends?: TrendIndicators | null;
  perfRegression?: PerfRegressionResult | null;
  history?: TemplateContextHistoryEntry[];
  slowestLimit?: number;
}

const DEFAULT_SLOWEST_LIMIT = 10;
const compileCache = new Map<string, HandlebarsTemplateDelegate>();
let helpersRegistered = false;

function registerHelpers(): void {
  if (helpersRegistered) return;
  Handlebars.registerHelper('formatDuration', (seconds: unknown) => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
    return formatDuration(seconds);
  });
  Handlebars.registerHelper('truncate', (str: unknown, maxLen: unknown) => {
    if (typeof str !== 'string') return '';
    const limit = typeof maxLen === 'number' && Number.isFinite(maxLen) ? maxLen : 100;
    return truncate(str, limit);
  });
  Handlebars.registerHelper('escapeHtml', (value: unknown) => {
    if (typeof value !== 'string') return '';
    return escapeHtml(value);
  });
  Handlebars.registerHelper('passRate', (passed: unknown, total: unknown) => {
    if (typeof passed !== 'number' || typeof total !== 'number' || total <= 0) {
      return '0.0';
    }
    return ((passed / total) * 100).toFixed(1);
  });
  helpersRegistered = true;
}

function computePassRate(passed: number, total: number): string {
  if (total <= 0) return '0.0';
  return ((passed / total) * 100).toFixed(1);
}

function collectFailures(parsed: ParsedTestRun): TemplateContextFailure[] {
  const failed: TemplateContextFailure[] = [];
  for (const suite of parsed.suites) {
    for (const test of suite.tests) {
      if (test.status === 'failed' || test.status === 'errored') {
        failed.push({
          name: test.name,
          suite: test.suite,
          errorMessage: test.errorMessage ?? '',
          stackTrace: test.stackTrace ?? '',
          duration: test.duration,
        });
      }
    }
  }
  return failed;
}

function collectSlowest(parsed: ParsedTestRun, limit: number): TemplateContextSlowest[] {
  if (limit <= 0) return [];
  const all: ParsedTestCase[] = parsed.suites.flatMap((s) => s.tests);
  return [...all]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, limit)
    .map((t) => ({ name: t.name, suite: t.suite, duration: t.duration }));
}

function summariseSuites(parsed: ParsedTestRun): TemplateContextSuite[] {
  return parsed.suites.map((s: ParsedSuite) => {
    const total = s.tests.length;
    const passed = s.tests.filter((t) => t.status === 'passed').length;
    const failed = s.tests.filter((t) => t.status === 'failed').length;
    const skipped = s.tests.filter((t) => t.status === 'skipped').length;
    const errored = s.tests.filter((t) => t.status === 'errored').length;
    return { name: s.name, total, passed, failed, skipped, errored, duration: s.duration };
  });
}

function flattenFlaky(
  flaky: FlakyDetectionResult | null | undefined,
): TemplateContextFlaky[] | undefined {
  if (!flaky || !flaky.hasFlakyTests) return undefined;
  return flaky.flakyTests.map((t) => ({
    name: t.name,
    suite: t.suite,
    flipCount: t.flipCount,
    flakyRate: t.flakyRate,
  }));
}

export function buildTemplateContext(input: BuildTemplateContextInput): TemplateContext {
  const { parsed, meta, delta, flaky, trends, perfRegression, history } = input;
  const slowestLimit = input.slowestLimit ?? DEFAULT_SLOWEST_LIMIT;
  const summary = parsed.summary;

  return {
    results: {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      errored: summary.errored,
      passRate: computePassRate(summary.passed, summary.total),
      duration: summary.duration,
    },
    failures: collectFailures(parsed),
    slowest: collectSlowest(parsed, slowestLimit),
    suites: summariseSuites(parsed),
    history,
    delta: delta ?? undefined,
    flaky: flattenFlaky(flaky),
    trends: trends ?? undefined,
    perfRegression: perfRegression ?? undefined,
    meta,
  };
}

export function resolveTemplatePath(templatePath: string): string {
  if (path.isAbsolute(templatePath)) return templatePath;
  const base = process.env.GITHUB_WORKSPACE || process.cwd();
  return path.resolve(base, templatePath);
}

function loadAndCompile(absolutePath: string, label: string): HandlebarsTemplateDelegate | null {
  const cached = compileCache.get(absolutePath);
  if (cached) return cached;

  let source: string;
  try {
    source = readFileSync(absolutePath, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    core.warning(
      `Custom ${label} template failed: cannot read ${absolutePath}: ${reason}. Falling back to default ${label}.`,
    );
    return null;
  }

  try {
    Handlebars.parse(source);
    const compiled = Handlebars.compile(source, { strict: false, noEscape: false });
    compileCache.set(absolutePath, compiled);
    return compiled;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    core.warning(
      `Custom ${label} template failed: parse error in ${absolutePath}: ${reason}. Falling back to default ${label}.`,
    );
    return null;
  }
}

export interface RenderTemplateOptions {
  label?: 'summary' | 'comment';
}

export function renderTemplate(
  templatePath: string,
  context: TemplateContext,
  options: RenderTemplateOptions = {},
): string | null {
  const label = options.label ?? 'summary';
  registerHelpers();

  const absolutePath = resolveTemplatePath(templatePath);
  const compiled = loadAndCompile(absolutePath, label);
  if (!compiled) return null;

  try {
    return compiled(context);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    core.warning(
      `Custom ${label} template failed: render error in ${absolutePath}: ${reason}. Falling back to default ${label}.`,
    );
    return null;
  }
}

export function _resetTemplateRendererForTests(): void {
  compileCache.clear();
  helpersRegistered = false;
}
