import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCtrfJson } from '../ctrf';
import { ParseError } from '../../utils/errors';
import type { ParsedTestRun } from '../../types';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../../fixtures', name), 'utf-8');

describe('parseCtrfJson', () => {
  describe('basic parsing (ctrf-basic.json)', () => {
    let result: ParsedTestRun;

    beforeAll(() => {
      result = parseCtrfJson(fixture('ctrf-basic.json'));
    });

    it('has correct summary counts', () => {
      expect(result.summary.total).toBe(8);
      expect(result.summary.passed).toBe(5);
      expect(result.summary.failed).toBe(2);
      expect(result.summary.skipped).toBe(1);
      expect(result.summary.errored).toBe(0);
    });

    it('has one suite with correct name', () => {
      expect(result.suites).toHaveLength(1);
      expect(result.suites[0].name).toBe('auth.login');
    });

    it('extracts test names correctly', () => {
      const names = result.suites[0].tests.map((t) => t.name);
      expect(names).toContain('should authenticate with valid credentials');
      expect(names).toContain('should reject invalid password');
      expect(names).toContain('should skip disabled feature');
    });

    it('converts durations from milliseconds to seconds', () => {
      const login = result.suites[0].tests.find(
        (t) => t.name === 'should authenticate with valid credentials',
      );
      expect(login?.duration).toBe(0.123);
    });

    it('maps statuses correctly', () => {
      const tests = result.suites[0].tests;
      expect(tests.find((t) => t.name.includes('valid credentials'))?.status).toBe('passed');
      expect(tests.find((t) => t.name.includes('invalid password'))?.status).toBe('failed');
      expect(tests.find((t) => t.name.includes('skip disabled'))?.status).toBe('skipped');
    });

    it('computes total duration from start/stop timestamps', () => {
      expect(result.summary.duration).toBeCloseTo(12.345, 2);
    });

    it('sets suite name on each test case', () => {
      for (const test of result.suites[0].tests) {
        expect(test.suite).toBe('auth.login');
      }
    });
  });

  describe('multi-suite parsing (ctrf-multi-suite.json)', () => {
    let result: ParsedTestRun;

    beforeAll(() => {
      result = parseCtrfJson(fixture('ctrf-multi-suite.json'));
    });

    it('finds all three suites', () => {
      expect(result.suites).toHaveLength(3);
      const names = result.suites.map((s) => s.name);
      expect(names).toContain('api.users');
      expect(names).toContain('api.projects');
      expect(names).toContain('api.billing');
    });

    it('has correct total counts across suites', () => {
      expect(result.summary.total).toBe(15);
      expect(result.summary.passed).toBe(11);
      expect(result.summary.failed).toBe(2);
      expect(result.summary.skipped).toBe(2);
      expect(result.summary.errored).toBe(0);
    });

    it('groups tests under correct suites', () => {
      const users = result.suites.find((s) => s.name === 'api.users')!;
      expect(users.tests).toHaveLength(5);
      expect(users.tests.every((t) => t.suite === 'api.users')).toBe(true);
    });

    it('computes suite duration from test durations', () => {
      const billing = result.suites.find((s) => s.name === 'api.billing')!;
      const expectedMs = 500 + 450 + 35 + 220 + 180;
      expect(billing.duration).toBeCloseTo(expectedMs / 1000, 3);
    });
  });

  describe('optional fields parsing (ctrf-optional-fields.json)', () => {
    let result: ParsedTestRun;

    beforeAll(() => {
      result = parseCtrfJson(fixture('ctrf-optional-fields.json'));
    });

    it('parses successfully with minimal fields', () => {
      expect(result.summary.total).toBe(4);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.failed).toBe(1);
    });

    it('uses tool name as default suite when no suite property', () => {
      expect(result.suites).toHaveLength(1);
      expect(result.suites[0].name).toBe('pytest');
    });

    it('handles missing start/stop with zero duration', () => {
      expect(result.summary.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('status mapping', () => {
    it('maps passed to passed', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 1, failed: 0, skipped: 0, pending: 0, other: 0 },
          tests: [{ name: 't', status: 'passed', duration: 10 }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].status).toBe('passed');
    });

    it('maps failed to failed', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 0, failed: 1, skipped: 0, pending: 0, other: 0 },
          tests: [{ name: 't', status: 'failed', duration: 10 }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].status).toBe('failed');
    });

    it('maps skipped to skipped', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 0, failed: 0, skipped: 1, pending: 0, other: 0 },
          tests: [{ name: 't', status: 'skipped', duration: 0 }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].status).toBe('skipped');
    });

    it('maps pending to skipped', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 0, failed: 0, skipped: 0, pending: 1, other: 0 },
          tests: [{ name: 't', status: 'pending', duration: 0 }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].status).toBe('skipped');
    });

    it('maps other to errored', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 0, failed: 0, skipped: 0, pending: 0, other: 1 },
          tests: [{ name: 't', status: 'other', duration: 10 }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].status).toBe('errored');
    });
  });

  describe('duration conversion', () => {
    it('converts milliseconds to seconds', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 1, failed: 0, skipped: 0, pending: 0, other: 0 },
          tests: [{ name: 't', status: 'passed', duration: 1500 }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].duration).toBe(1.5);
    });

    it('handles zero duration', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 1, failed: 0, skipped: 0, pending: 0, other: 0 },
          tests: [{ name: 't', status: 'passed', duration: 0 }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].duration).toBe(0);
    });

    it('handles missing duration', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 1, failed: 0, skipped: 0, pending: 0, other: 0 },
          tests: [{ name: 't', status: 'passed' }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].duration).toBe(0);
    });
  });

  describe('error message extraction', () => {
    it('extracts message into errorMessage', () => {
      const result = parseCtrfJson(fixture('ctrf-basic.json'));
      const failed = result.suites[0].tests.find(
        (t) => t.name === 'should reject invalid password',
      );
      expect(failed?.errorMessage).toBe('Expected 401 but received 200');
    });

    it('extracts trace first line into errorType', () => {
      const result = parseCtrfJson(fixture('ctrf-basic.json'));
      const failed = result.suites[0].tests.find(
        (t) => t.name === 'should reject invalid password',
      );
      expect(failed?.errorType).toBe('AssertionError: Expected 401 but received 200');
    });

    it('does not set error fields on passing tests', () => {
      const result = parseCtrfJson(fixture('ctrf-basic.json'));
      const passed = result.suites[0].tests.find(
        (t) => t.name === 'should authenticate with valid credentials',
      );
      expect(passed?.errorMessage).toBeUndefined();
      expect(passed?.errorType).toBeUndefined();
    });

    it('ignores message/trace on non-failed tests', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 1, passed: 1, failed: 0, skipped: 0, pending: 0, other: 0 },
          tests: [{ name: 't', status: 'passed', duration: 10, message: 'info', trace: 'stack' }],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].tests[0].errorMessage).toBeUndefined();
      expect(result.suites[0].tests[0].errorType).toBeUndefined();
    });
  });

  describe('invalid JSON handling (ctrf-malformed.json)', () => {
    it('throws a descriptive ParseError', () => {
      expect(() => parseCtrfJson(fixture('ctrf-malformed.json'))).toThrowError(
        /Invalid JSON/,
      );
    });

    it('throws ParseError (not an unhandled exception)', () => {
      expect.assertions(2);
      try {
        parseCtrfJson(fixture('ctrf-malformed.json'));
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as Error).message).toMatch(/Invalid JSON/);
      }
    });
  });

  describe('invalid schema handling (ctrf-invalid-schema.json)', () => {
    it('throws identifying the missing field', () => {
      expect(() => parseCtrfJson(fixture('ctrf-invalid-schema.json'))).toThrowError(
        /results\.tests/,
      );
    });

    it('throws ParseError when results.summary is missing', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          tests: [{ name: 't', status: 'passed' }],
        },
      });
      expect(() => parseCtrfJson(json)).toThrowError(/results\.summary/);
    });
  });

  describe('empty file handling (ctrf-empty.json)', () => {
    it('throws when reading the actual empty fixture file', () => {
      const content = fixture('ctrf-empty.json');
      expect(() => parseCtrfJson(content)).toThrowError(/empty/i);
    });

    it('throws for empty string', () => {
      expect(() => parseCtrfJson('')).toThrowError(/empty/i);
    });

    it('throws for whitespace-only content', () => {
      expect(() => parseCtrfJson('   \n  ')).toThrowError(/empty/i);
    });
  });

  describe('large file performance', () => {
    function generateLargeCtrfJson(testCount: number): string {
      const tests = [];
      for (let i = 0; i < testCount; i++) {
        tests.push({
          name: `test_${i}_scenario`,
          status: i % 10 === 0 ? 'failed' : 'passed',
          duration: Math.floor(Math.random() * 2000),
          suite: `suite.module${Math.floor(i / 50)}`,
        });
      }
      return JSON.stringify({
        results: {
          tool: { name: 'vitest' },
          summary: {
            tests: testCount,
            passed: testCount - Math.floor(testCount / 10),
            failed: Math.floor(testCount / 10),
            skipped: 0,
            pending: 0,
            other: 0,
          },
          tests,
        },
      });
    }

    it('parses 1000+ tests within 5 seconds', () => {
      const content = generateLargeCtrfJson(1200);
      const start = performance.now();
      const result = parseCtrfJson(content);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5000);
      expect(result.summary.total).toBe(1200);
    });
  });

  describe('default suite grouping', () => {
    it('groups tests without suite or filePath under tool name', () => {
      const result = parseCtrfJson(fixture('ctrf-optional-fields.json'));
      expect(result.suites[0].name).toBe('pytest');
      expect(result.suites[0].tests).toHaveLength(4);
    });

    it('uses filePath as fallback when suite is missing', () => {
      const json = JSON.stringify({
        results: {
          tool: { name: 'test' },
          summary: { tests: 2, passed: 2, failed: 0, skipped: 0, pending: 0, other: 0 },
          tests: [
            { name: 't1', status: 'passed', duration: 10, filePath: 'src/utils/helper.test.ts' },
            { name: 't2', status: 'passed', duration: 20, filePath: 'src/utils/helper.test.ts' },
          ],
        },
      });
      const result = parseCtrfJson(json);
      expect(result.suites[0].name).toBe('src/utils/helper.test.ts');
      expect(result.suites[0].tests).toHaveLength(2);
    });
  });

  describe('output contract', () => {
    it('matches ParsedTestRun interface', () => {
      const result = parseCtrfJson(fixture('ctrf-basic.json'));

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
