export type ReportFormat = 'junit' | 'ctrf';

export function detectFormat(filePath: string): ReportFormat | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'xml') return 'junit';
  if (ext === 'json') return 'ctrf';
  return null;
}
