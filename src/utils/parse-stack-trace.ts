const DEPENDENCY_DIRS = ['node_modules/', 'site-packages/', '.gradle/', 'vendor/', '_vendor/'];
const SWIFT_DEPENDENCY_DIRS = [
  '.build/',
  'SourcePackages/checkouts/',
  'usr/lib/swift/',
  'Contents/Developer/',
];

// A location is near the start of a line, and these regexes backtrack polynomially on long lines,
// which failure messages (hex dumps, tokens) can contain.
const MAX_SCANNED_LINE_LENGTH = 1000;
const MAX_SOURCE_LINE = 1_000_000;

function isDependencyPath(filePath: string): boolean {
  const dirs = filePath.endsWith('.swift')
    ? [...DEPENDENCY_DIRS, ...SWIFT_DEPENDENCY_DIRS]
    : DEPENDENCY_DIRS;
  const rooted = `/${filePath}`;
  return dirs.some((dir) => rooted.includes(`/${dir}`));
}

export function isValidSourceLine(line: number | undefined): line is number {
  return line !== undefined && Number.isInteger(line) && line >= 1 && line <= MAX_SOURCE_LINE;
}

// JVM frames carry only a bare file name, so DEPENDENCY_DIRS can't see library code;
// filter on the frame's package instead.
const JVM_LIBRARY_PACKAGES = [
  'java.',
  'javax.',
  'jdk.',
  'sun.',
  'com.sun.',
  'kotlin.',
  'kotlinx.',
  'scala.',
  'groovy.',
  'org.codehaus.groovy.',
  'org.junit.',
  'junit.',
  'org.opentest4j.',
  'org.testng.',
  'org.gradle.',
  'org.apache.maven.',
  'io.kotest.',
  'io.mockk.',
  'org.mockito.',
  'org.assertj.',
  'org.hamcrest.',
  'assertk.',
  'strikt.',
  'org.spockframework.',
  'org.scalatest.',
];

function isJvmLibraryFrame(frame: string): boolean {
  return JVM_LIBRARY_PACKAGES.some((pkg) => frame.startsWith(pkg));
}

function toForwardSlashes(path: string): string {
  return path.replaceAll('\\', '/');
}

function workspaceRoot(workspace?: string): string | undefined {
  return workspace ? toForwardSlashes(workspace).replace(/\/+$/, '') : undefined;
}

export function normalizePath(filePath: string, workspace?: string): string {
  let p = toForwardSlashes(filePath);
  const root = workspaceRoot(workspace);
  if (root && p.startsWith(`${root}/`)) p = p.slice(root.length + 1);
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
  // JS/TS: at Something (path:line:col) or at path:line:col. The path must have a file extension,
  // so "started at 20:12:40" and "at 127.0.0.1:8080:1" in a failure message aren't locations.
  (line) => {
    const match = line.match(
      /\bat\s+(?:[^()]*\(([^()]+\.[a-z]\w*):(\d+):\d+\)|([^\s()]+\.[a-z]\w*):(\d+):\d+)/i,
    );
    if (!match) return null;
    return { path: match[1] ?? match[3], line: Number.parseInt(match[2] ?? match[4], 10) };
  },

  // Python: File "path", line N
  (line) => {
    const match = line.match(/File\s+"([^"]+)",\s+line\s+(\d+)/);
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },

  // JVM: at [loader//]pkg.Class.method(File.java:N) — also .kt, .kts, .scala, .groovy
  (line) => {
    const match = line.match(
      /^\s*at\s+(?:[^\s/()]*\/)*([^()/]+)\(([\w$][\w$.-]*\.(?:java|kts?|scala|groovy)):(\d+)\)/,
    );
    if (!match || isJvmLibraryFrame(match[1])) return null;
    return { path: match[2], line: Number.parseInt(match[3], 10) };
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

  // Swift (XCTest and Swift Testing): path/File.swift:line[:col]
  (line) => {
    const match = line.match(/((?:[A-Za-z]:\/)?[^\s:'"()<>[\]]+\.swift):(\d+)/);
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

// XCTest and compilers write "path:line: error: message" at the start of a line. This is the
// assertion itself, unlike other paths in captured output, and only this format allows spaces.
const ERROR_LINE_PATTERN: PatternExtractor = (line) => {
  const match = line.match(/^\s*((?:[A-Za-z]:\/)?[\w./~][^:]*\.\w+):(\d+)(?::\d+)?: error:/);
  if (!match) return null;
  return { path: match[1], line: Number.parseInt(match[2], 10) };
};

function firstLocation(
  lines: string[],
  patterns: PatternExtractor[],
  workspace?: string,
): FileLocation | null {
  for (const line of lines) {
    for (const extract of patterns) {
      const result = extract(line);
      if (!result || !isValidSourceLine(result.line) || isDependencyPath(result.path)) continue;
      // The workspace is already stripped, so an absolute path here isn't in the repo.
      if (workspace && /^(?:[A-Za-z]:)?\//.test(result.path)) continue;
      return { path: normalizePath(result.path), line: result.line };
    }
  }
  return null;
}

export function parseFileLocation(stackTrace: string, workspace?: string): FileLocation | null {
  if (!stackTrace) return null;

  const root = workspaceRoot(workspace);
  const lines = toForwardSlashes(stackTrace)
    .split('\n')
    .map((line) => (root ? line.replaceAll(`${root}/`, '') : line))
    .map((line) => line.slice(0, MAX_SCANNED_LINE_LENGTH));

  return (
    firstLocation(lines, [ERROR_LINE_PATTERN], workspace) ??
    firstLocation(lines, PATTERNS, workspace)
  );
}
