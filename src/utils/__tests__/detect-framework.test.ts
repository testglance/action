import { describe, it, expect } from 'vitest';
import { detectFramework } from '../detect-framework';

describe('detectFramework', () => {
  describe('CTRF format', () => {
    it('returns ctrfToolName when format is ctrf and tool name provided', () => {
      expect(detectFramework('/path/to/report.json', 'ctrf', 'vitest')).toBe('vitest');
    });

    it('returns ctrfToolName for any tool name', () => {
      expect(detectFramework('/path/to/report.json', 'ctrf', 'playwright')).toBe('playwright');
      expect(detectFramework('/path/to/report.json', 'ctrf', 'cypress')).toBe('cypress');
      expect(detectFramework('/path/to/report.json', 'ctrf', 'jest')).toBe('jest');
    });

    it('returns undefined when format is ctrf but no tool name', () => {
      expect(detectFramework('/path/to/report.json', 'ctrf')).toBeUndefined();
      expect(detectFramework('/path/to/report.json', 'ctrf', undefined)).toBeUndefined();
    });
  });

  describe('JUnit format — file path heuristics', () => {
    it('detects vitest from path containing "vitest"', () => {
      expect(detectFramework('/output/vitest/results.xml', 'junit')).toBe('vitest');
    });

    it('detects vitest from filename vitest.xml', () => {
      expect(detectFramework('/output/vitest.xml', 'junit')).toBe('vitest');
    });

    it('detects vitest from vitest-report in path', () => {
      expect(detectFramework('/ci/vitest-report/results.xml', 'junit')).toBe('vitest');
    });

    it('detects jest from path containing "jest"', () => {
      expect(detectFramework('/output/jest/results.xml', 'junit')).toBe('jest');
    });

    it('detects jest from filename jest.xml', () => {
      expect(detectFramework('/output/jest.xml', 'junit')).toBe('jest');
    });

    it('detects jest from jest-junit in path', () => {
      expect(detectFramework('/ci/jest-junit/results.xml', 'junit')).toBe('jest');
    });

    it('detects pytest from path containing "pytest"', () => {
      expect(detectFramework('/output/pytest/results.xml', 'junit')).toBe('pytest');
    });

    it('detects pytest from junit-pytest in path', () => {
      expect(detectFramework('/ci/junit-pytest/results.xml', 'junit')).toBe('pytest');
    });

    it('detects maven-surefire from surefire in path', () => {
      expect(detectFramework('/target/surefire-reports/TEST-MyTest.xml', 'junit')).toBe(
        'maven-surefire',
      );
    });

    it('returns undefined for generic test-results path', () => {
      expect(detectFramework('/output/test-results/results.xml', 'junit')).toBeUndefined();
    });

    it('returns undefined for unrecognizable path', () => {
      expect(detectFramework('/some/random/report.xml', 'junit')).toBeUndefined();
    });
  });

  describe('null format (auto-detect fallback)', () => {
    it('still applies path heuristics when format is null', () => {
      expect(detectFramework('/output/vitest.xml', null)).toBe('vitest');
    });

    it('returns undefined for unrecognizable path with null format', () => {
      expect(detectFramework('/random/report.xml', null)).toBeUndefined();
    });
  });

  describe('case insensitivity', () => {
    it('detects vitest case-insensitively', () => {
      expect(detectFramework('/output/Vitest/results.xml', 'junit')).toBe('vitest');
    });

    it('detects jest case-insensitively', () => {
      expect(detectFramework('/output/JEST/results.xml', 'junit')).toBe('jest');
    });
  });
});
