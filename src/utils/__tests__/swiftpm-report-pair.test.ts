import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockDiscoverReportFiles = vi.fn();
vi.mock('../discover-files', () => ({
  discoverReportFiles: (...args: unknown[]) => mockDiscoverReportFiles(...args),
}));
vi.mock('@actions/core', () => ({ info: vi.fn() }));

import { withSwiftPmReportPairs } from '../swiftpm-report-pair';

describe('withSwiftPmReportPairs', () => {
  beforeEach(() => {
    mockDiscoverReportFiles.mockReset();
    mockDiscoverReportFiles.mockImplementation((path: string) =>
      Promise.resolve(
        ['/r/results.xml', '/r/results-swift-testing.xml'].includes(path) ? [path] : [],
      ),
    );
  });

  it('adds the Swift Testing report beside a named report', async () => {
    expect(await withSwiftPmReportPairs(['/r/results.xml'])).toEqual([
      '/r/results-swift-testing.xml',
      '/r/results.xml',
    ]);
  });

  it('adds the named report beside a Swift Testing report', async () => {
    expect(await withSwiftPmReportPairs(['/r/results-swift-testing.xml'])).toEqual([
      '/r/results-swift-testing.xml',
      '/r/results.xml',
    ]);
  });

  it('leaves reports without a pair alone', async () => {
    expect(await withSwiftPmReportPairs(['/other/junit.xml', '/other/report.json'])).toEqual([
      '/other/junit.xml',
      '/other/report.json',
    ]);
  });

  it('does not look for a pair of a non-XML report', async () => {
    await withSwiftPmReportPairs(['/other/report.json']);
    expect(mockDiscoverReportFiles).not.toHaveBeenCalled();
  });
});
