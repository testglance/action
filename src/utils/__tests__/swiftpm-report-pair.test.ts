import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockWarning = vi.fn();
vi.mock('@actions/core', () => ({ warning: (...args: unknown[]) => mockWarning(...args) }));

import { findSwiftTestingReport, warnAboutUnreadSwiftTestingReports } from '../swiftpm-report-pair';

describe('SwiftPM report pairs', () => {
  let dir: string;

  beforeEach(() => {
    mockWarning.mockReset();
    dir = mkdtempSync(join(tmpdir(), 'tg-pair-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeReport = (...segments: string[]) => {
    const path = join(dir, ...segments);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '<testsuites />');
    return path;
  };

  it('finds the Swift Testing report beside a report', async () => {
    const named = writeReport('junit.xml');
    const sibling = writeReport('junit-swift-testing.xml');
    expect(await findSwiftTestingReport(named)).toBe(sibling);
  });

  it('returns null when there is no sibling', async () => {
    expect(await findSwiftTestingReport(writeReport('junit.xml'))).toBeNull();
  });

  it('treats glob characters in the path literally', async () => {
    const named = writeReport('shard[1]', 'results.xml');
    const sibling = writeReport('shard[1]', 'results-swift-testing.xml');
    writeReport('shard1', 'results-swift-testing.xml');
    expect(await findSwiftTestingReport(named)).toBe(sibling);
  });

  it('has no sibling for a Swift Testing report or a non-XML report', async () => {
    expect(await findSwiftTestingReport(writeReport('junit-swift-testing.xml'))).toBeNull();
    expect(await findSwiftTestingReport(writeReport('report.json'))).toBeNull();
  });

  it('warns about a sibling that report-path left out', async () => {
    const named = writeReport('junit.xml');
    const sibling = writeReport('junit-swift-testing.xml');
    await warnAboutUnreadSwiftTestingReports([named]);
    expect(mockWarning).toHaveBeenCalledOnce();
    expect(mockWarning.mock.calls[0][0]).toContain(sibling);
  });

  it('does not warn when the sibling is already read', async () => {
    const named = writeReport('junit.xml');
    const sibling = writeReport('junit-swift-testing.xml');
    await warnAboutUnreadSwiftTestingReports([named, sibling]);
    expect(mockWarning).not.toHaveBeenCalled();
  });
});
