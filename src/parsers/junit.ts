import { XMLParser } from 'fast-xml-parser';
import type { ParsedTestRun, ParsedSuite, ParsedTestCase } from '../types';
import { ParseError } from '../utils/errors';

const BOM = '\uFEFF';

// SwiftPM and Swift Testing put every test in one <testsuite> with this name and keep the real
// suite only in classname. Test identity is suite + name, so without splitting, same-named tests
// in different Swift suites would collide in history.
const SWIFTPM_SUITE_NAME = 'TestResults';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (tagName: string) => ['testsuite', 'testcase', 'property'].includes(tagName),
  trimValues: true,
  // Swift Testing encodes every non-ASCII character and newline as a numeric reference.
  htmlEntities: true,
  processEntities: {
    enabled: true,
    maxTotalExpansions: 1_000_000,
    maxExpandedLength: 10_000_000,
    maxEntityCount: 100,
  },
});

function toElements(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((v) => {
    if (typeof v === 'object' && v !== null) return v as Record<string, unknown>;
    return v === '' ? {} : { '#text': String(v) };
  });
}

function bodyOf(element: Record<string, unknown>): string | undefined {
  const body = element['#text'];
  return body === undefined ? undefined : String(body);
}

function describeIssues(
  value: unknown,
): Pick<ParsedTestCase, 'errorMessage' | 'errorType' | 'stackTrace'> {
  const elements = toElements(value);
  const messages = elements.flatMap((el) => (el['@_message'] as string) ?? bodyOf(el) ?? []);
  const stackTraces = elements.flatMap((el) => bodyOf(el) ?? []);
  return {
    errorMessage: messages.length > 0 ? messages.join('\n') : undefined,
    errorType: elements[0]['@_type'] as string | undefined,
    ...(stackTraces.length > 0 ? { stackTrace: stackTraces.join('\n') } : {}),
  };
}

function resolveStatus(
  testcase: Record<string, unknown>,
): Pick<ParsedTestCase, 'status' | 'errorMessage' | 'errorType' | 'stackTrace'> {
  if (testcase['error'] !== undefined) {
    return { status: 'errored', ...describeIssues(testcase['error']) };
  }
  if (testcase['failure'] !== undefined) {
    return { status: 'failed', ...describeIssues(testcase['failure']) };
  }
  if (testcase['skipped'] !== undefined) {
    const [skip] = toElements(testcase['skipped']);
    return {
      status: 'skipped',
      errorMessage: (skip['@_message'] as string | undefined) ?? bodyOf(skip),
    };
  }
  return { status: 'passed' };
}

function extractTestCases(
  testcases: Record<string, unknown>[],
  suiteName: string,
): ParsedTestCase[] {
  return testcases.map((tc) => {
    const { status, errorMessage, errorType, stackTrace } = resolveStatus(tc);
    const file = tc['@_file'] as string | undefined;
    const line = Number.parseInt(tc['@_line'] as string, 10);
    return {
      name: (tc['@_name'] as string) ?? 'unknown',
      suite: suiteName,
      status,
      duration: parseFloat(tc['@_time'] as string) || 0,
      ...(errorMessage ? { errorMessage } : {}),
      ...(errorType ? { errorType } : {}),
      ...(stackTrace ? { stackTrace } : {}),
      ...(file ? { file } : {}),
      ...(Number.isFinite(line) ? { line } : {}),
    };
  });
}

function splitByClassname(testcases: Record<string, unknown>[], fallback: string): ParsedSuite[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const tc of testcases) {
    const suiteName = (tc['@_classname'] as string | undefined) ?? fallback;
    groups.set(suiteName, [...(groups.get(suiteName) ?? []), tc]);
  }
  return [...groups].map(([name, cases]) => {
    const tests = extractTestCases(cases, name);
    return { name, tests, duration: tests.reduce((sum, t) => sum + t.duration, 0) };
  });
}

function flattenSuites(suite: Record<string, unknown>, parentName?: string): ParsedSuite[] {
  const name = (suite['@_name'] as string) ?? parentName ?? 'unknown';
  const results: ParsedSuite[] = [];

  const nestedSuites = suite['testsuite'] as Record<string, unknown>[] | undefined;
  const testcases = (suite['testcase'] as Record<string, unknown>[]) ?? [];

  if (name === SWIFTPM_SUITE_NAME) {
    results.push(...splitByClassname(testcases, name));
  } else if (testcases.length > 0) {
    const tests = extractTestCases(testcases, name);
    results.push({
      name,
      tests,
      duration: parseFloat(suite['@_time'] as string) || 0,
    });
  }

  if (nestedSuites) {
    for (const nested of nestedSuites) {
      results.push(...flattenSuites(nested, name));
    }
  }

  return results;
}

export function parseJunitXml(content: string): ParsedTestRun {
  let xml = content;
  if (xml.startsWith(BOM)) {
    xml = xml.slice(1);
  }
  xml = xml.trim();

  if (!xml) {
    throw new ParseError('JUnit XML is empty');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = xmlParser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new ParseError(
      `Failed to parse JUnit XML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const suites: ParsedSuite[] = [];

  const testsuites = parsed['testsuites'] as Record<string, unknown> | undefined;
  const topSuite = parsed['testsuite'] as Record<string, unknown>[] | undefined;

  let rootDuration: number | undefined;

  if (testsuites) {
    rootDuration = parseFloat(testsuites['@_time'] as string) || undefined;
    const innerSuites = testsuites['testsuite'] as Record<string, unknown>[] | undefined;
    if (innerSuites) {
      // Split suites only sum their tests, which overstates Swift Testing's wall-clock time. SwiftPM
      // runs test products one at a time and writes one TestResults suite for each.
      if (innerSuites.every((s) => s['@_name'] === SWIFTPM_SUITE_NAME)) {
        const productTimes = innerSuites.map((s) => parseFloat(s['@_time'] as string) || 0);
        rootDuration ??= productTimes.reduce((sum, time) => sum + time, 0) || undefined;
      }
      for (const s of innerSuites) {
        suites.push(...flattenSuites(s));
      }
    }
  } else if (topSuite) {
    for (const s of topSuite) {
      suites.push(...flattenSuites(s));
    }
  }

  const allTests = suites.flatMap((s) => s.tests);
  const suiteDurationSum = suites.reduce((sum, s) => sum + s.duration, 0);
  const summary = {
    total: allTests.length,
    passed: allTests.filter((t) => t.status === 'passed').length,
    failed: allTests.filter((t) => t.status === 'failed').length,
    skipped: allTests.filter((t) => t.status === 'skipped').length,
    errored: allTests.filter((t) => t.status === 'errored').length,
    duration: rootDuration ?? suiteDurationSum,
  };

  return { summary, suites };
}
