import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJunitXml } from '../junit';
import type { ParsedTestRun } from '../../types';

const fixture = (name: string) => readFileSync(join(__dirname, '../../../fixtures', name), 'utf-8');

const fixtureRaw = (name: string) => readFileSync(join(__dirname, '../../../fixtures', name));

describe('parseJunitXml', () => {
  describe('Swift Testing report (junit-swift-testing.xml)', () => {
    let result: ParsedTestRun;
    const findTest = (suite: string, name: string) =>
      result.suites.find((s) => s.name === suite)?.tests.find((t) => t.name === name);

    beforeAll(() => {
      result = parseJunitXml(fixture('junit-swift-testing.xml'));
    });

    it('recounts statuses from test cases', () => {
      expect(result.summary).toMatchObject({
        total: 10,
        passed: 4,
        failed: 4,
        skipped: 2,
        errored: 0,
      });
    });

    it('uses classname as the suite instead of the generic TestResults', () => {
      expect(result.suites.map((s) => s.name)).toEqual([
        'ProbeTests.SecondSuite.Nested',
        'ProbeTests.SecondSuite',
        'ProbeTests',
        'ProbeTests.FirstSuite',
      ]);
    });

    it('keeps same-named tests in different Swift suites distinct', () => {
      expect(findTest('ProbeTests.FirstSuite', 'sameName()')?.status).toBe('passed');
      expect(findTest('ProbeTests.SecondSuite', 'sameName()')?.status).toBe('failed');
    });

    it('keeps every issue of a test with several failures', () => {
      expect(findTest('ProbeTests.FirstSuite', 'twoIssues()')?.errorMessage).toBe(
        'Expectation failed: name == "work" (error)\n' +
          'Expectation failed: answer() == 1 (error): must be one\n' +
          'second line → with arrow',
      );
    });

    it('reads the skip comment from the element body', () => {
      expect(findTest('ProbeTests.FirstSuite', 'skippedWithComment()')?.errorMessage).toBe(
        'not on this platform — sorry',
      );
      expect(findTest('ProbeTests.FirstSuite', 'skippedPlain()')?.errorMessage).toBeUndefined();
    });

    it('reports wall-clock run time, not the sum of tests that ran in parallel', () => {
      expect(result.summary.duration).toBe(0.001562667);
    });

    it('gives each suite the sum of its test durations', () => {
      const freeFunctions = result.suites.find((s) => s.name === 'ProbeTests');
      expect(freeFunctions?.duration).toBeCloseTo(0.000907584 + 0.000933417, 9);
    });
  });

  describe('Swift Testing report merged from several test products', () => {
    const result = parseJunitXml(fixture('junit-swift-testing-merged.xml'));

    it('reads the tests of every product', () => {
      expect(result.suites.map((s) => s.name)).toEqual(['BetaTests.Shared', 'AlphaTests.Shared']);
      expect(result.summary).toMatchObject({ total: 4, passed: 2, failed: 1, skipped: 1 });
    });

    it('adds up the run time of every product', () => {
      expect(result.summary.duration).toBeCloseTo(0.001342959 + 0.001481541, 9);
    });

    it('reads the literal non-ASCII text the merger writes', () => {
      expect(result.suites[0].tests[0].errorMessage).toBe('off → beta');
    });
  });

  describe('SwiftPM XCTest reports', () => {
    it('uses classname as the suite (junit-swiftpm-xctest.xml)', () => {
      const result = parseJunitXml(fixture('junit-swiftpm-xctest.xml'));

      expect(result.suites.map((s) => s.name)).toEqual(['ProbeTests.XCFirstTests']);
      expect(result.summary).toMatchObject({ total: 3, failed: 1 });
      expect(result.summary.duration).toBe(0.01691592);
    });

    it('reports XCTSkip as passed because SwiftPM writes no skipped element', () => {
      const result = parseJunitXml(fixture('junit-swiftpm-xctest.xml'));

      const skipped = result.suites[0].tests.find((t) => t.name === 'testSkipped');
      expect(skipped?.status).toBe('passed');
      expect(result.summary).toMatchObject({ passed: 2, skipped: 0 });
    });

    it('has only a placeholder failure message without the experimental flag', () => {
      const result = parseJunitXml(fixture('junit-swiftpm-xctest.xml'));

      const failed = result.suites[0].tests.find((t) => t.name === 'testFails');
      expect(failed).toMatchObject({ status: 'failed', errorMessage: 'failure' });
      expect(failed?.stackTrace).toBeUndefined();
    });

    it('parses the empty report SwiftPM writes without XCTest tests', () => {
      const result = parseJunitXml(fixture('junit-swiftpm-xctest-empty.xml'));

      expect(result.suites).toEqual([]);
      expect(result.summary).toMatchObject({ total: 0, duration: 0 });
    });
  });

  describe('failure element shapes (junit-failure-shapes.xml)', () => {
    const tests = parseJunitXml(fixture('junit-failure-shapes.xml')).suites[0].tests;
    const findShape = (name: string) => tests.find((t) => t.name === name);

    it('counts a bare <failure /> as failed', () => {
      expect(findShape('bareFailure')?.status).toBe('failed');
    });

    it('counts a bare <error /> as errored', () => {
      expect(findShape('bareError')?.status).toBe('errored');
    });

    it('keeps the body of a <failure> without attributes', () => {
      expect(findShape('bodyOnly')).toMatchObject({
        status: 'failed',
        errorMessage: 'boom at a.swift:3',
        stackTrace: 'boom at a.swift:3',
      });
    });

    it('uses the body when the message attribute is empty', () => {
      expect(findShape('emptyMessage')?.errorMessage).toBe('from body');
      expect(findShape('emptySkipMessage')?.errorMessage).toBe('skip body');
    });

    it('keeps a decoded test name on one line for Markdown tables', () => {
      expect(findShape("two lines 'quoted'")).toBeDefined();
    });
  });

  describe('run duration with suites named TestResults', () => {
    it('keeps the declared time of a TestResults suite beside other suites', () => {
      const { summary } = parseJunitXml(fixture('junit-testresults-mixed.xml'));
      expect(summary.duration).toBe(102);
    });

    it('keeps the declared time of a top-level TestResults suite', () => {
      const { summary, suites } = parseJunitXml(fixture('junit-testresults-top-level.xml'));
      expect(summary.duration).toBe(12.5);
      expect(suites.map((s) => s.name)).toEqual(['a']);
    });

    it('keeps the declared time of a nested TestResults suite', () => {
      expect(parseJunitXml(fixture('junit-testresults-nested.xml')).summary.duration).toBe(9);
    });

    it('does not split a TestResults suite whose tests have no classname', () => {
      const { summary, suites } = parseJunitXml(fixture('junit-testresults-no-classname.xml'));
      expect(summary.duration).toBe(12.5);
      expect(suites).toMatchObject([{ name: 'TestResults', duration: 12.5 }]);
    });

    it('falls back to the suite name for an empty classname', () => {
      const { suites } = parseJunitXml(fixture('junit-testresults-empty-classname.xml'));
      expect(suites.map((s) => s.name)).toEqual(['TestResults']);
    });
  });

  describe('entity limits', () => {
    const reportWithOutput = (output: string, doctype = '') =>
      `<?xml version="1.0"?>${doctype}<testsuites><testsuite name="s"><testcase name="t"><system-out>${output}</system-out></testcase></testsuite></testsuites>`;

    it('parses more numeric references than the expansion limit', () => {
      const result = parseJunitXml(reportWithOutput('&#xA;'.repeat(1_000_001)));
      expect(result.summary.total).toBe(1);
    });

    it('still rejects DOCTYPE entity expansion past the limit', () => {
      const doctype = '<!DOCTYPE t [<!ENTITY big "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">]>';
      const output = '&big;'.repeat(1_000_001);
      expect(() => parseJunitXml(reportWithOutput(output, doctype))).toThrow(/limit exceeded/);
    });
  });

  it('groups a very large suite without copying its tests for every test', () => {
    const cases = '<testcase classname="c" name="t" />'.repeat(100_000);
    const started = performance.now();
    const result = parseJunitXml(
      `<testsuites><testsuite name="TestResults">${cases}</testsuite></testsuites>`,
    );
    expect(result.summary.total).toBe(100_000);
    expect(performance.now() - started).toBeLessThan(4000);
  });

  it('keeps the suite name of non-SwiftPM reports that also have classname', () => {
    const result = parseJunitXml(fixture('junit-classname-with-suite-name.xml'));

    expect(result.suites.map((s) => s.name)).toEqual(['pytest']);
  });

  describe('basic parsing (junit-basic.xml)', () => {
    let result: ParsedTestRun;

    beforeAll(() => {
      result = parseJunitXml(fixture('junit-basic.xml'));
    });

    it('has correct summary counts', () => {
      expect(result.summary.total).toBe(6);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.errored).toBe(1);
      expect(result.summary.skipped).toBe(1);
    });

    it('has one suite with correct name', () => {
      expect(result.suites).toHaveLength(1);
      expect(result.suites[0].name).toBe('auth.login');
    });

    it('extracts test names correctly', () => {
      const names = result.suites[0].tests.map((t) => t.name);
      expect(names).toContain('should login with valid credentials');
      expect(names).toContain('should reject invalid password');
      expect(names).toContain('should handle server error');
      expect(names).toContain('should skip disabled test');
    });

    it('extracts durations as numbers', () => {
      const login = result.suites[0].tests.find(
        (t) => t.name === 'should login with valid credentials',
      );
      expect(login?.duration).toBe(0.123);
    });

    it('maps statuses correctly', () => {
      const tests = result.suites[0].tests;
      expect(tests.find((t) => t.name.includes('valid credentials'))?.status).toBe('passed');
      expect(tests.find((t) => t.name.includes('invalid password'))?.status).toBe('failed');
      expect(tests.find((t) => t.name.includes('server error'))?.status).toBe('errored');
      expect(tests.find((t) => t.name.includes('skip disabled'))?.status).toBe('skipped');
    });

    it('extracts error messages from failure elements', () => {
      const failed = result.suites[0].tests.find((t) => t.status === 'failed');
      expect(failed?.errorMessage).toBe('Expected 401 but got 200');
      expect(failed?.errorType).toBe('AssertionError');
    });

    it('extracts error messages from error elements', () => {
      const errored = result.suites[0].tests.find((t) => t.status === 'errored');
      expect(errored?.errorMessage).toBe('Connection timeout');
      expect(errored?.errorType).toBe('TimeoutError');
    });

    it('sets suite name on each test case', () => {
      for (const test of result.suites[0].tests) {
        expect(test.suite).toBe('auth.login');
      }
    });
  });

  describe('multi-suite parsing (junit-multi-suite.xml)', () => {
    let result: ParsedTestRun;

    beforeAll(() => {
      result = parseJunitXml(fixture('junit-multi-suite.xml'));
    });

    it('finds all three suites', () => {
      expect(result.suites).toHaveLength(3);
      const names = result.suites.map((s) => s.name);
      expect(names).toContain('api.users');
      expect(names).toContain('api.projects');
      expect(names).toContain('api.billing');
    });

    it('has correct total counts across suites', () => {
      expect(result.summary.total).toBe(9);
      expect(result.summary.passed).toBe(7);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.skipped).toBe(1);
    });

    it('groups tests under correct suites', () => {
      const users = result.suites.find((s) => s.name === 'api.users')!;
      expect(users.tests).toHaveLength(3);
      expect(users.tests.every((t) => t.suite === 'api.users')).toBe(true);
    });
  });

  describe('nested suite parsing (junit-nested.xml)', () => {
    let result: ParsedTestRun;

    beforeAll(() => {
      result = parseJunitXml(fixture('junit-nested.xml'));
    });

    it('flattens nested suites and finds all tests', () => {
      expect(result.summary.total).toBe(6);
      expect(result.summary.passed).toBe(6);
    });

    it('creates separate suites for nested elements', () => {
      const names = result.suites.map((s) => s.name);
      expect(names).toContain('components.Button');
      expect(names).toContain('components.Modal');
    });
  });

  describe('encoding resilience (junit-encoding.xml)', () => {
    it('handles UTF-8 BOM', () => {
      const raw = fixtureRaw('junit-encoding.xml');
      expect(raw[0]).toBe(0xef);
      expect(raw[1]).toBe(0xbb);
      expect(raw[2]).toBe(0xbf);

      const result = parseJunitXml(raw.toString('utf-8'));
      expect(result.summary.total).toBe(5);
    });

    it('preserves special characters in test names', () => {
      const result = parseJunitXml(fixture('junit-encoding.xml'));
      const names = result.suites[0].tests.map((t) => t.name);

      expect(names.some((n) => n.includes('café'))).toBe(true);
      expect(names.some((n) => n.includes('señor'))).toBe(true);
      expect(names.some((n) => n.includes('日本語'))).toBe(true);
    });

    it('handles XML entities', () => {
      const result = parseJunitXml(fixture('junit-encoding.xml'));
      const entityTest = result.suites[0].tests.find((t) => t.name.includes('XML entities'));
      expect(entityTest).toBeDefined();
      expect(entityTest!.name).toContain('&');
      expect(entityTest!.name).toContain('<');
    });

    it('handles emoji in test names', () => {
      const result = parseJunitXml(fixture('junit-encoding.xml'));
      const emojiTest = result.suites[0].tests.find((t) => t.name.includes('emoji'));
      expect(emojiTest).toBeDefined();
    });
  });

  describe('malformed XML handling (junit-malformed.xml)', () => {
    it('throws a descriptive error', () => {
      expect(() => parseJunitXml(fixture('junit-malformed.xml'))).toThrowError(
        /Failed to parse JUnit XML/,
      );
    });

    it('does not throw an unhandled exception', () => {
      try {
        parseJunitXml(fixture('junit-malformed.xml'));
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/Failed to parse/);
      }
    });
  });

  describe('empty file handling (junit-empty.xml)', () => {
    it('throws when reading the actual empty fixture file', () => {
      const content = fixture('junit-empty.xml');
      expect(() => parseJunitXml(content)).toThrowError(/empty/i);
    });

    it('throws a descriptive error for empty content', () => {
      expect(() => parseJunitXml('')).toThrowError(/empty/i);
    });

    it('throws for whitespace-only content', () => {
      expect(() => parseJunitXml('   \n  ')).toThrowError(/empty/i);
    });
  });

  describe('no tests (junit-no-tests.xml)', () => {
    it('returns valid ParsedTestRun with zero counts', () => {
      const result = parseJunitXml(fixture('junit-no-tests.xml'));
      expect(result.summary.total).toBe(0);
      expect(result.summary.passed).toBe(0);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.skipped).toBe(0);
      expect(result.summary.errored).toBe(0);
      expect(result.suites).toHaveLength(0);
    });
  });

  describe('large file performance', () => {
    function generateLargeXml(suites: number, testsPerSuite: number): string {
      const total = suites * testsPerSuite;
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<testsuites name="large-run" tests="${total}" time="600.000">\n`;
      for (let s = 1; s <= suites; s++) {
        const suiteName = `com.testglance.module${s}.ServiceTest`;
        xml += `  <testsuite name="${suiteName}" tests="${testsPerSuite}" time="12.000">\n`;
        for (let t = 1; t <= testsPerSuite; t++) {
          xml += `    <testcase name="test${t}_scenario" classname="${suiteName}" time="${(Math.random() * 2).toFixed(3)}"/>\n`;
        }
        xml += `  </testsuite>\n`;
      }
      xml += '</testsuites>\n';
      return xml;
    }

    it('parses 10,000+ tests within 5 seconds', () => {
      const content = generateLargeXml(200, 60);
      const start = performance.now();
      const result = parseJunitXml(content);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5000);
      expect(result.summary.total).toBe(12_000);
    });

    it('parses reports with >1000 built-in entity references (no XML-bomb false positive)', () => {
      const testCount = 1200;
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<testsuites name="entity-heavy" tests="${testCount}" time="1.0">\n`;
      xml += `  <testsuite name="suite" tests="${testCount}" time="1.0">\n`;
      for (let i = 0; i < testCount; i++) {
        xml += `    <testcase name="describe &gt; nested &gt; case${i}" classname="suite" time="0"/>\n`;
      }
      xml += `  </testsuite>\n</testsuites>\n`;

      const result = parseJunitXml(xml);
      expect(result.summary.total).toBe(testCount);
      expect(result.suites[0].tests[0].name).toBe('describe > nested > case0');
    });
  });

  describe('status mapping edge cases', () => {
    it('defaults to passed when no child elements', () => {
      const xml = `<testsuite name="s" tests="1"><testcase name="t" classname="s" time="0.1"/></testsuite>`;
      const result = parseJunitXml(xml);
      expect(result.suites[0].tests[0].status).toBe('passed');
    });

    it('handles missing time attribute', () => {
      const xml = `<testsuite name="s" tests="1"><testcase name="t" classname="s"/></testsuite>`;
      const result = parseJunitXml(xml);
      expect(result.suites[0].tests[0].duration).toBe(0);
    });

    it('handles integer time values', () => {
      const xml = `<testsuite name="s" tests="1"><testcase name="t" classname="s" time="5"/></testsuite>`;
      const result = parseJunitXml(xml);
      expect(result.suites[0].tests[0].duration).toBe(5);
    });

    it('handles float time values', () => {
      const xml = `<testsuite name="s" tests="1"><testcase name="t" classname="s" time="1.234"/></testsuite>`;
      const result = parseJunitXml(xml);
      expect(result.suites[0].tests[0].duration).toBe(1.234);
    });

    it('prefers error over failure when both present', () => {
      const xml = `<testsuite name="s" tests="1">
        <testcase name="t" classname="s" time="0">
          <failure message="fail msg"/>
          <error message="err msg" type="RuntimeError"/>
        </testcase>
      </testsuite>`;
      const result = parseJunitXml(xml);
      expect(result.suites[0].tests[0].status).toBe('errored');
    });
  });

  describe('duration handling', () => {
    it('uses root testsuites time attribute when available', () => {
      const result = parseJunitXml(fixture('junit-multi-suite.xml'));
      expect(result.summary.duration).toBe(3.456);
    });

    it('falls back to suite sum when no root time', () => {
      const result = parseJunitXml(fixture('junit-basic.xml'));
      expect(result.summary.duration).toBe(1.234);
    });
  });

  describe('stack trace extraction (junit-with-stacktraces.xml)', () => {
    let result: ParsedTestRun;

    beforeAll(() => {
      result = parseJunitXml(fixture('junit-with-stacktraces.xml'));
    });

    it('extracts stack trace from failure element text content', () => {
      const authSuite = result.suites.find((s) => s.name === 'auth.login')!;
      const failed = authSuite.tests.find((t) => t.name === 'should reject expired token')!;
      expect(failed.stackTrace).toBeDefined();
      expect(failed.stackTrace).toContain('AssertionError: Expected 401 but received 200');
      expect(failed.stackTrace).toContain('auth.test.ts:23:5');
    });

    it('extracts stack trace from error element text content', () => {
      const authSuite = result.suites.find((s) => s.name === 'auth.login')!;
      const errored = authSuite.tests.find((t) => t.name === 'should handle timeout')!;
      expect(errored.stackTrace).toBeDefined();
      expect(errored.stackTrace).toContain('TimeoutError: Connection timeout');
      expect(errored.stackTrace).toContain('net.ts:42:10');
    });

    it('does not set stackTrace on passing tests', () => {
      const authSuite = result.suites.find((s) => s.name === 'auth.login')!;
      const passed = authSuite.tests.find((t) => t.name === 'should login successfully')!;
      expect(passed.stackTrace).toBeUndefined();
    });

    it('extracts stack trace from failure in another suite', () => {
      const usersSuite = result.suites.find((s) => s.name === 'api.users')!;
      const failed = usersSuite.tests.find((t) => t.name === 'should validate email format')!;
      expect(failed.stackTrace).toBeDefined();
      expect(failed.stackTrace).toContain('ValidationError: Invalid email not rejected');
    });
  });

  describe('output structure', () => {
    it('matches ParsedTestRun interface', () => {
      const result = parseJunitXml(fixture('junit-basic.xml'));

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('suites');
      expect(result.summary).toHaveProperty('total');
      expect(result.summary).toHaveProperty('passed');
      expect(result.summary).toHaveProperty('failed');
      expect(result.summary).toHaveProperty('skipped');
      expect(result.summary).toHaveProperty('errored');
      expect(result.summary).toHaveProperty('duration');

      for (const suite of result.suites) {
        expect(suite).toHaveProperty('name');
        expect(suite).toHaveProperty('tests');
        expect(suite).toHaveProperty('duration');

        for (const test of suite.tests) {
          expect(test).toHaveProperty('name');
          expect(test).toHaveProperty('suite');
          expect(test).toHaveProperty('status');
          expect(test).toHaveProperty('duration');
          expect(['passed', 'failed', 'skipped', 'errored']).toContain(test.status);
        }
      }
    });
  });

  describe('native file/line attributes (junit-native-location.xml)', () => {
    let result: ParsedTestRun;

    beforeAll(() => {
      result = parseJunitXml(fixture('junit-native-location.xml'));
    });

    it('captures file and line from testcase attributes', () => {
      const test = result.suites[0].tests.find((t) => t.name === 'applies discount');
      expect(test?.file).toBe('src/checkout/cart.test.ts');
      expect(test?.line).toBe(57);
    });

    it('captures file when line attribute is absent, leaving line undefined', () => {
      const test = result.suites[0].tests.find((t) => t.name === 'removes item');
      expect(test?.file).toBe('src/checkout/cart.test.ts');
      expect(test?.line).toBeUndefined();
    });

    it('leaves file/line undefined when attributes are absent', () => {
      const result = parseJunitXml(fixture('junit-basic.xml'));
      const test = result.suites[0].tests[0];
      expect(test.file).toBeUndefined();
      expect(test.line).toBeUndefined();
    });
  });
});
