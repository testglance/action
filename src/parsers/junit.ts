import { XMLParser } from 'fast-xml-parser';
import type { ParsedTestRun, ParsedSuite, ParsedTestCase } from '../types';
import { ParseError } from '../utils/errors';

const BOM = '\uFEFF';

// SwiftPM and Swift Testing put every test in one <testsuite> with this name and keep the real
// suite only in classname. Test identity is suite + name, so without splitting, same-named tests
// in different Swift suites would collide in history.
const SWIFTPM_SUITE_NAME = 'TestResults';

// DOCTYPE entities can amplify, so they are limited. Numeric references can't, and a large report
// has millions of them, so appliesTo leaves them out. fast-xml-parser's types omit this option.
const ENTITY_LIMITS = {
  enabled: true,
  maxTotalExpansions: 1_000_000,
  maxExpandedLength: 10_000_000,
  maxEntityCount: 100,
  appliesTo: 'external',
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (tagName: string) => ['testsuite', 'testcase', 'property'].includes(tagName),
  trimValues: true,
  // Swift Testing encodes every non-ASCII character and newline as a numeric reference.
  htmlEntities: true,
  processEntities: ENTITY_LIMITS,
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
  const messages = elements.flatMap((el) => (el['@_message'] as string) || bodyOf(el) || []);
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
      errorMessage: (skip['@_message'] as string | undefined) || bodyOf(skip),
    };
  }
  return { status: 'passed' };
}

// A decoded &#10; in a name would split the Markdown tables that show it.
function toSingleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ');
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
      name: toSingleLine((tc['@_name'] as string) ?? 'unknown'),
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
    const suiteName = toSingleLine((tc['@_classname'] as string | undefined) || fallback);
    const group = groups.get(suiteName);
    if (group) {
      group.push(tc);
    } else {
      groups.set(suiteName, [tc]);
    }
  }
  return [...groups].map(([name, cases]) => {
    const tests = extractTestCases(cases, name);
    return { name, tests, duration: tests.reduce((sum, t) => sum + t.duration, 0) };
  });
}

interface FlattenedSuites {
  suites: ParsedSuite[];
  // Differs from the sum of suite durations for split suites: each one only sums its tests, which
  // overstates Swift Testing's wall-clock time and misses time when tests have none of their own.
  // SwiftPM runs test products one at a time and writes one TestResults suite for each.
  runTime: number;
}

function flattenSuites(suite: Record<string, unknown>, parentName?: string): FlattenedSuites {
  const name = toSingleLine((suite['@_name'] as string) ?? parentName ?? 'unknown');
  const declaredTime = parseFloat(suite['@_time'] as string) || 0;
  const suites: ParsedSuite[] = [];
  let runTime = 0;

  const nestedSuites = suite['testsuite'] as Record<string, unknown>[] | undefined;
  const testcases = (suite['testcase'] as Record<string, unknown>[]) ?? [];

  if (name === SWIFTPM_SUITE_NAME && testcases.some((tc) => tc['@_classname'])) {
    const split = splitByClassname(testcases, name);
    suites.push(...split);
    runTime += declaredTime || split.reduce((sum, s) => sum + s.duration, 0);
  } else if (testcases.length > 0) {
    suites.push({ name, tests: extractTestCases(testcases, name), duration: declaredTime });
    runTime += declaredTime;
  }

  for (const nested of nestedSuites ?? []) {
    const flattened = flattenSuites(nested, name);
    suites.push(...flattened.suites);
    runTime += flattened.runTime;
  }

  return { suites, runTime };
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

  const testsuites = parsed['testsuites'] as Record<string, unknown> | undefined;
  const topLevelSuites =
    (testsuites
      ? (testsuites['testsuite'] as Record<string, unknown>[] | undefined)
      : (parsed['testsuite'] as Record<string, unknown>[] | undefined)) ?? [];
  const rootDuration = parseFloat(testsuites?.['@_time'] as string) || undefined;

  const flattened = topLevelSuites.map((s) => flattenSuites(s));
  const suites = flattened.flatMap((f) => f.suites);
  const runTime = flattened.reduce((sum, f) => sum + f.runTime, 0);

  const allTests = suites.flatMap((s) => s.tests);
  const summary = {
    total: allTests.length,
    passed: allTests.filter((t) => t.status === 'passed').length,
    failed: allTests.filter((t) => t.status === 'failed').length,
    skipped: allTests.filter((t) => t.status === 'skipped').length,
    errored: allTests.filter((t) => t.status === 'errored').length,
    duration: rootDuration ?? runTime,
  };

  return { summary, suites };
}
