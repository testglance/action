import fg from 'fast-glob';

const GLOB_CHARS = /[*?{[]/;

export async function discoverReportFiles(pattern: string): Promise<string[]> {
  if (!GLOB_CHARS.test(pattern)) {
    const { existsSync } = await import('node:fs');
    if (existsSync(pattern)) {
      return [pattern];
    }
    return [];
  }

  const files = await fg(pattern, { absolute: true, onlyFiles: true });
  return files.sort();
}
