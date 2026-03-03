import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJunitXml } from '../junit';
import type { ParsedTestRun } from '../../types';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../../fixtures', name), 'utf-8');

const fixtureRaw = (name: string) =>
  readFileSync(join(__dirname, '../../../fixtures', name));

describe('parseJunitXml', () => {
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
      const failed = result.suites[0].tests.find(
        (t) => t.status === 'failed',
      );
      expect(failed?.errorMessage).toBe('Expected 401 but got 200');
      expect(failed?.errorType).toBe('AssertionError');
    });

    it('extracts error messages from error elements', () => {
      const errored = result.suites[0].tests.find(
        (t) => t.status === 'errored',
      );
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
      const entityTest = result.suites[0].tests.find((t) =>
        t.name.includes('XML entities'),
      );
      expect(entityTest).toBeDefined();
      expect(entityTest!.name).toContain('&');
      expect(entityTest!.name).toContain('<');
    });

    it('handles emoji in test names', () => {
      const result = parseJunitXml(fixture('junit-encoding.xml'));
      const emojiTest = result.suites[0].tests.find((t) =>
        t.name.includes('emoji'),
      );
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
});
