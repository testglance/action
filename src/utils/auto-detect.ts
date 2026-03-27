import { discoverReportFiles } from './discover-files';

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

  return {
    files: [...seen].sort(),
    scannedPatterns: [...AUTO_DETECT_PATTERNS],
  };
}
