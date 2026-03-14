import type { ParsedTestRun, ParsedSuite, ParsedTestCase } from '../types';
import { ParseError } from '../utils/errors';

interface CtrfReport {
  results: {
    tool: { name: string; version?: string };
    summary: {
      tests: number;
      passed: number;
      failed: number;
      skipped: number;
      pending: number;
      other: number;
      start?: number;
      stop?: number;
    };
    tests: CtrfTest[];
    environment?: Record<string, unknown>;
  };
}

interface CtrfTest {
  name: string;
  status: string;
  duration?: number;
  suite?: string;
  filePath?: string;
  message?: string;
  trace?: string;
}

const STATUS_MAP: Record<string, ParsedTestCase['status']> = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  pending: 'skipped',
  other: 'errored',
};

function validateCtrfStructure(raw: unknown): CtrfReport {
  if (!raw || typeof raw !== 'object') {
    throw new ParseError('CTRF content is not a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.results || typeof obj.results !== 'object') {
    throw new ParseError('Missing required field: results');
  }
  const results = obj.results as Record<string, unknown>;
  if (!Array.isArray(results.tests)) {
    throw new ParseError('Missing required field: results.tests (expected array)');
  }
  if (!results.tool || typeof results.tool !== 'object') {
    throw new ParseError('Missing required field: results.tool');
  }
  const tool = results.tool as Record<string, unknown>;
  if (typeof tool.name !== 'string') {
    throw new ParseError('Missing required field: results.tool.name (expected string)');
  }
  if (!results.summary || typeof results.summary !== 'object') {
    throw new ParseError('Missing required field: results.summary');
  }
  return raw as CtrfReport;
}

export function parseCtrfJson(content: string): ParsedTestRun {
  if (!content || content.trim().length === 0) {
    throw new ParseError('CTRF file is empty');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new ParseError(`Invalid JSON: ${(err as Error).message}`);
  }

  const report = validateCtrfStructure(raw);
  const { results } = report;
  const toolName = results.tool.name;

  const suiteMap = new Map<string, ParsedTestCase[]>();

  for (const test of results.tests) {
    const suiteName = test.suite || test.filePath || toolName;
    const durationSeconds = (test.duration ?? 0) / 1000;
    const status = STATUS_MAP[test.status] ?? 'errored';

    const hasError = status === 'failed' || status === 'errored';
    const testCase: ParsedTestCase = {
      name: test.name,
      suite: suiteName,
      status,
      duration: durationSeconds,
      ...(hasError && test.message ? { errorMessage: test.message } : {}),
      ...(hasError && test.trace ? { errorType: test.trace.split('\n')[0] } : {}),
    };

    const existing = suiteMap.get(suiteName);
    if (existing) {
      existing.push(testCase);
    } else {
      suiteMap.set(suiteName, [testCase]);
    }
  }

  const suites: ParsedSuite[] = [];
  for (const [name, tests] of suiteMap) {
    suites.push({
      name,
      tests,
      duration: tests.reduce((sum, t) => sum + t.duration, 0),
    });
  }

  const allTests = suites.flatMap((s) => s.tests);

  let totalDuration = 0;
  if (results.summary.start != null && results.summary.stop != null) {
    totalDuration = (results.summary.stop - results.summary.start) / 1000;
  } else {
    totalDuration = suites.reduce((sum, s) => sum + s.duration, 0);
  }

  return {
    summary: {
      total: allTests.length,
      passed: allTests.filter((t) => t.status === 'passed').length,
      failed: allTests.filter((t) => t.status === 'failed').length,
      skipped: allTests.filter((t) => t.status === 'skipped').length,
      errored: allTests.filter((t) => t.status === 'errored').length,
      duration: totalDuration,
    },
    suites,
    toolName,
  };
}
