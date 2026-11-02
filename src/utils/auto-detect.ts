import { basename } from 'node:path';
import { discoverReportFiles } from './discover-files';
import { findSwiftTestingReport } from './swiftpm-report-pair';

export const AUTO_DETECT_PATTERNS = [
  '**/test-results/**/*.xml',
  '**/junit.xml',
  '**/test-report.xml',
  '**/surefire-reports/*.xml',
  '**/test-results/**/*.json',
  '**/ctrf-report.json',
  '**/test-report.json',
] as const;

export async function autoDetectReportFiles(): Promise<{
  files: string[];
  scannedPatterns: string[];
}> {
  const seen = new Set<string>();

  for (const pattern of AUTO_DETECT_PATTERNS) {
    const found = await discoverReportFiles(pattern);
    for (const file of found) {
      seen.add(file);
    }
  }

  for (const file of [...seen]) {
    if (basename(file) !== 'junit.xml') continue;
    const swiftTestingReport = await findSwiftTestingReport(file);
    if (swiftTestingReport) seen.add(swiftTestingReport);
  }

  return {
    files: [...seen].sort(),
    scannedPatterns: [...AUTO_DETECT_PATTERNS],
  };
}
