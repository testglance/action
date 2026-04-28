import * as path from 'node:path';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import * as core from '@actions/core';
import Handlebars from 'handlebars';
import { escapeHtml, formatDuration, truncate } from './format';
import type { ParsedTestRun, ParsedSuite, ParsedTestCase } from '../types';
import type {
  DeltaComparison,
  FlakyDetectionResult,
  HistoryEntry,
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
  history?: HistoryEntry[] | null;
  slowestLimit?: number;
}

const DEFAULT_SLOWEST_LIMIT = 10;
const MAX_TEMPLATE_FILE_BYTES = 1024 * 1024;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  template: HandlebarsTemplateDelegate;
}

const handlebars = Handlebars.create();
const compileCache = new Map<string, CacheEntry>();

function computePassRate(passed: number, total: number): string {
  if (total <= 0) return '0.0';
  return ((passed / total) * 100).toFixed(1);
}

handlebars.registerHelper('formatDuration', (seconds: unknown) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
  return formatDuration(seconds);
});
handlebars.registerHelper('truncate', (str: unknown, maxLen: unknown) => {
  if (typeof str !== 'string') return '';
  const limit = typeof maxLen === 'number' && Number.isFinite(maxLen) ? maxLen : 100;
  return truncate(str, limit);
});
handlebars.registerHelper('escapeHtml', (value: unknown) => {
  if (typeof value !== 'string') return '';
  return escapeHtml(value);
});
handlebars.registerHelper('passRate', (passed: unknown, total: unknown) => {
  if (typeof passed !== 'number' || typeof total !== 'number') return '0.0';
  return computePassRate(passed, total);
});
handlebars.registerHelper('limit', (arr: unknown, n: unknown) => {
  if (!Array.isArray(arr)) return [];
  const count = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : arr.length;
  return arr.slice(0, count);
});

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

function flattenHistory(
  history: HistoryEntry[] | null | undefined,
): TemplateContextHistoryEntry[] | undefined {
  if (!history || history.length === 0) return undefined;
  return history.map((entry) => ({
    sha: entry.commitSha,
    passRate: computePassRate(entry.summary.passed, entry.summary.total),
    duration: entry.summary.duration,
    timestamp: entry.timestamp,
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
    history: flattenHistory(history),
    delta: delta ?? undefined,
    flaky: flattenFlaky(flaky),
    trends: trends ?? undefined,
    perfRegression: perfRegression ?? undefined,
    meta,
  };
}

function getWorkspace(): string | null {
  const ws = process.env.GITHUB_WORKSPACE;
  if (typeof ws !== 'string' || ws.length === 0) return null;
  return ws;
}

function sanitizeForLog(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

interface ResolvedPath {
  ok: true;
  path: string;
  mtimeMs: number;
  size: number;
}

interface ResolveError {
  ok: false;
  reason: string;
}

export function resolveTemplatePath(templatePath: string): string {
  // Kept for backwards compatibility with tests/callers that only need the lexical resolution.
  if (path.isAbsolute(templatePath)) return templatePath;
  const base = getWorkspace() ?? process.cwd();
  return path.resolve(base, templatePath);
}

function resolveAndValidate(templatePath: string): ResolvedPath | ResolveError {
  if (/[\r\n]/.test(templatePath)) {
    return { ok: false, reason: 'template path contains newline characters' };
  }

  const workspace = getWorkspace();
  if (!workspace) {
    return {
      ok: false,
      reason: 'GITHUB_WORKSPACE is not set; refusing to resolve template path',
    };
  }

  const workspaceReal = (() => {
    try {
      return realpathSync(workspace);
    } catch {
      return path.resolve(workspace);
    }
  })();

  const lexical = path.isAbsolute(templatePath)
    ? path.resolve(templatePath)
    : path.resolve(workspaceReal, templatePath);

  let real: string;
  let stat: ReturnType<typeof statSync>;
  try {
    real = realpathSync(lexical);
    stat = statSync(real);
  } catch (err) {
    return {
      ok: false,
      reason: `cannot read ${sanitizeForLog(lexical)}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const prefix = workspaceReal.endsWith(path.sep) ? workspaceReal : workspaceReal + path.sep;
  if (real !== workspaceReal && !real.startsWith(prefix)) {
    return {
      ok: false,
      reason: `template path resolves outside GITHUB_WORKSPACE (${sanitizeForLog(real)})`,
    };
  }

  if (!stat.isFile()) {
    return {
      ok: false,
      reason: `template path is not a regular file: ${sanitizeForLog(real)}`,
    };
  }

  if (stat.size > MAX_TEMPLATE_FILE_BYTES) {
    return {
      ok: false,
      reason: `template file exceeds ${MAX_TEMPLATE_FILE_BYTES} bytes (${stat.size}): ${sanitizeForLog(real)}`,
    };
  }

  return { ok: true, path: real, mtimeMs: stat.mtimeMs, size: stat.size };
}

function loadAndCompile(resolved: ResolvedPath, label: string): HandlebarsTemplateDelegate | null {
  const cached = compileCache.get(resolved.path);
  if (cached && cached.mtimeMs === resolved.mtimeMs && cached.size === resolved.size) {
    return cached.template;
  }

  let source: string;
  try {
    source = readFileSync(resolved.path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    core.warning(
      `Custom ${label} template failed: cannot read ${sanitizeForLog(resolved.path)}: ${reason}. Falling back to default ${label}.`,
    );
    return null;
  }

  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
  }

  try {
    // Eagerly parse so syntax errors surface here (compile defers parsing until render time).
    handlebars.parse(source);
    const compiled = handlebars.compile(source, {
      strict: false,
      noEscape: false,
    });
    compileCache.set(resolved.path, {
      mtimeMs: resolved.mtimeMs,
      size: resolved.size,
      template: compiled,
    });
    return compiled;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    core.warning(
      `Custom ${label} template failed: parse error in ${sanitizeForLog(resolved.path)}: ${reason}. Falling back to default ${label}.`,
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

  const resolved = resolveAndValidate(templatePath);
  if (!resolved.ok) {
    core.warning(
      `Custom ${label} template failed: ${resolved.reason}. Falling back to default ${label}.`,
    );
    return null;
  }

  const compiled = loadAndCompile(resolved, label);
  if (!compiled) return null;

  try {
    return compiled(context, {
      allowProtoPropertiesByDefault: false,
      allowProtoMethodsByDefault: false,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    core.warning(
      `Custom ${label} template failed: render error in ${sanitizeForLog(resolved.path)}: ${reason}. Falling back to default ${label}.`,
    );
    return null;
  }
}

export function _resetTemplateRendererForTests(): void {
  compileCache.clear();
}

export function _getHandlebarsInstanceForTests(): typeof handlebars {
  return handlebars;
}
