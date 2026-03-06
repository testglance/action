import { XMLParser } from 'fast-xml-parser';
import type { ParsedTestRun, ParsedSuite, ParsedTestCase } from '../types';
import { ParseError } from '../utils/errors';

const BOM = '\uFEFF';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (tagName: string) =>
    ['testsuite', 'testcase', 'property'].includes(tagName),
  trimValues: true,
});

function resolveStatus(
  testcase: Record<string, unknown>,
): Pick<ParsedTestCase, 'status' | 'errorMessage' | 'errorType'> {
  if (testcase['error']) {
    const err = testcase['error'] as Record<string, unknown>;
    return {
      status: 'errored',
      errorMessage: (err['@_message'] as string) ?? (err['#text'] as string),
      errorType: err['@_type'] as string | undefined,
    };
  }
  if (testcase['failure']) {
    const fail = testcase['failure'] as Record<string, unknown>;
    return {
      status: 'failed',
      errorMessage: (fail['@_message'] as string) ?? (fail['#text'] as string),
      errorType: fail['@_type'] as string | undefined,
    };
  }
  if (testcase['skipped'] !== undefined) {
    const skip = testcase['skipped'];
    const msg =
      typeof skip === 'object' && skip !== null
        ? ((skip as Record<string, unknown>)['@_message'] as string | undefined)
        : undefined;
    return {
      status: 'skipped',
      errorMessage: msg,
    };
  }
  return { status: 'passed' };
}

function extractTestCases(
  testcases: Record<string, unknown>[],
  suiteName: string,
): ParsedTestCase[] {
  return testcases.map((tc) => {
    const { status, errorMessage, errorType } = resolveStatus(tc);
    return {
      name: (tc['@_name'] as string) ?? 'unknown',
      suite: suiteName,
      status,
      duration: parseFloat(tc['@_time'] as string) || 0,
      ...(errorMessage ? { errorMessage } : {}),
      ...(errorType ? { errorType } : {}),
    };
  });
}

function flattenSuites(
  suite: Record<string, unknown>,
  parentName?: string,
): ParsedSuite[] {
  const name = (suite['@_name'] as string) ?? parentName ?? 'unknown';
  const results: ParsedSuite[] = [];

  const nestedSuites = suite['testsuite'] as
    | Record<string, unknown>[]
    | undefined;
  const testcases = (suite['testcase'] as Record<string, unknown>[]) ?? [];

  if (testcases.length > 0) {
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

  const testsuites = parsed['testsuites'] as
    | Record<string, unknown>
    | undefined;
  const topSuite = parsed['testsuite'] as
    | Record<string, unknown>[]
    | undefined;

  let rootDuration: number | undefined;

  if (testsuites) {
    rootDuration = parseFloat(testsuites['@_time'] as string) || undefined;
    const innerSuites = testsuites['testsuite'] as
      | Record<string, unknown>[]
      | undefined;
    if (innerSuites) {
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
