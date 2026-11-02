import { describe, it, expect } from 'vitest';
import { detectRunFramework } from '../detect-run-framework';
import type { FileParseResult } from '../merge-results';
import type { ParsedTestRun } from '../../types';

function report(filePath: string, total: number, toolName?: string): FileParseResult {
  const parsed: ParsedTestRun = {
    summary: { total, passed: total, failed: 0, skipped: 0, errored: 0, duration: 0 },
    suites: [],
    toolName,
  };
  return { filePath, parsed };
}

describe('detectRunFramework', () => {
  it('labels a single report', () => {
    expect(detectRunFramework([report('/vitest/a.xml', 1)], 'auto')).toBe('vitest');
  });

  it('ignores an empty XCTest report beside the Swift Testing report', () => {
    expect(
      detectRunFramework(
        [report('/r/junit-swift-testing.xml', 10), report('/r/junit.xml', 0)],
        'auto',
      ),
    ).toBe('swift-testing');
  });

  it('leaves a run unlabelled when its reports with tests disagree', () => {
    expect(
      detectRunFramework(
        [report('/r/junit-swift-testing.xml', 10), report('/r/junit.xml', 3)],
        'auto',
      ),
    ).toBeUndefined();
  });

  it('keeps a label shared by every report', () => {
    expect(
      detectRunFramework([report('/vitest/a.xml', 1), report('/vitest/b.xml', 1)], 'auto'),
    ).toBe('vitest');
  });

  it('labels a run with no tests from its first report', () => {
    expect(detectRunFramework([report('/vitest/a.xml', 0)], 'auto')).toBe('vitest');
  });

  it('uses each CTRF report tool name', () => {
    expect(detectRunFramework([report('/a.json', 1, 'jest')], 'auto')).toBe('jest');
  });
});
