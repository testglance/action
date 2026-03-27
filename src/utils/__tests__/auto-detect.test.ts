import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockDiscoverReportFiles = vi.fn();
vi.mock('../discover-files', () => ({
  discoverReportFiles: (...args: unknown[]) => mockDiscoverReportFiles(...args),
}));

import { autoDetectReportFiles, AUTO_DETECT_PATTERNS } from '../auto-detect';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AUTO_DETECT_PATTERNS', () => {
  it('contains expected common test report patterns', () => {
    expect(AUTO_DETECT_PATTERNS).toContain('**/test-results/**/*.xml');
    expect(AUTO_DETECT_PATTERNS).toContain('**/junit.xml');
    expect(AUTO_DETECT_PATTERNS).toContain('**/test-report.xml');
    expect(AUTO_DETECT_PATTERNS).toContain('**/surefire-reports/*.xml');
    expect(AUTO_DETECT_PATTERNS).toContain('**/test-results/**/*.json');
    expect(AUTO_DETECT_PATTERNS).toContain('**/ctrf-report.json');
    expect(AUTO_DETECT_PATTERNS).toContain('**/test-report.json');
    expect(AUTO_DETECT_PATTERNS).toHaveLength(7);
  });
});

describe('autoDetectReportFiles', () => {
  it('calls discoverReportFiles for each pattern', async () => {
    mockDiscoverReportFiles.mockResolvedValue([]);

    await autoDetectReportFiles();

    expect(mockDiscoverReportFiles).toHaveBeenCalledTimes(AUTO_DETECT_PATTERNS.length);
    for (const pattern of AUTO_DETECT_PATTERNS) {
      expect(mockDiscoverReportFiles).toHaveBeenCalledWith(pattern);
    }
  });

  it('returns discovered files from multiple patterns', async () => {
    mockDiscoverReportFiles
      .mockResolvedValueOnce(['/project/test-results/a.xml'])
      .mockResolvedValueOnce(['/project/junit.xml'])
      .mockResolvedValue([]);

    const result = await autoDetectReportFiles();

    expect(result.files).toContain('/project/test-results/a.xml');
    expect(result.files).toContain('/project/junit.xml');
    expect(result.files).toHaveLength(2);
  });

  it('deduplicates files found by multiple patterns', async () => {
    mockDiscoverReportFiles
      .mockResolvedValueOnce(['/project/test-results/junit.xml'])
      .mockResolvedValueOnce(['/project/test-results/junit.xml'])
      .mockResolvedValue([]);

    const result = await autoDetectReportFiles();

    expect(result.files).toEqual(['/project/test-results/junit.xml']);
  });

  it('returns all scanned patterns even when no files found', async () => {
    mockDiscoverReportFiles.mockResolvedValue([]);

    const result = await autoDetectReportFiles();

    expect(result.files).toEqual([]);
    expect(result.scannedPatterns).toEqual(AUTO_DETECT_PATTERNS);
  });

  it('returns sorted file list', async () => {
    mockDiscoverReportFiles
      .mockResolvedValueOnce(['/z.xml'])
      .mockResolvedValueOnce(['/a.xml'])
      .mockResolvedValue([]);

    const result = await autoDetectReportFiles();

    expect(result.files).toEqual(['/a.xml', '/z.xml']);
  });

  it('returns scanned patterns alongside found files', async () => {
    mockDiscoverReportFiles.mockResolvedValueOnce(['/project/junit.xml']).mockResolvedValue([]);

    const result = await autoDetectReportFiles();

    expect(result.scannedPatterns).toEqual(AUTO_DETECT_PATTERNS);
    expect(result.files).toHaveLength(1);
  });
});
