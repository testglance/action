const DEPENDENCY_DIRS = ['node_modules/', 'site-packages/', '.gradle/', 'vendor/', '_vendor/'];

function isDependencyPath(filePath: string): boolean {
  return DEPENDENCY_DIRS.some((dir) => filePath.includes(dir));
}

function normalizePath(filePath: string): string {
  let p = filePath;
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

interface FileLocation {
  path: string;
  line: number;
}

type PatternExtractor = (line: string) => FileLocation | null;

const PATTERNS: PatternExtractor[] = [
  // JS/TS: at Something (path:line:col) or at path:line:col
  (line) => {
    const match = line.match(/at\s+(?:.+?\s+\()?([^()]+?):(\d+):\d+\)?/);
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },

  // Python: File "path", line N
  (line) => {
    const match = line.match(/File\s+"([^"]+)",\s+line\s+(\d+)/);
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },

  // Java: at package.Class(File.java:N)
  (line) => {
    const match = line.match(/at\s+[\w.$]+\(([A-Za-z][\w]*\.java):(\d+)\)/);
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },

  // Go: path/file.go:N
  (line) => {
    const match = line.match(/([\w./-]+\.go):(\d+)/);
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },

  // Ruby: path/file.rb:N:in
  (line) => {
    const match = line.match(/([\w./-]+\.rb):(\d+)/);
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },

  // .NET: in /path/File.cs:line N
  (line) => {
    const match = line.match(/in\s+([\w./-]+\.cs):line\s+(\d+)/);
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },
];

export function parseFileLocation(stackTrace: string): FileLocation | null {
  if (!stackTrace) return null;

  const lines = stackTrace.split('\n');

  for (const line of lines) {
    for (const extract of PATTERNS) {
      const result = extract(line);
      if (result && !isDependencyPath(result.path)) {
        return { path: normalizePath(result.path), line: result.line };
      }
    }
  }

  return null;
}
