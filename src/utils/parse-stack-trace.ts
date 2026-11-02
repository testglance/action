import { stripVTControlCharacters } from 'node:util';

const DEPENDENCY_DIRS = ['node_modules/', 'site-packages/', '.gradle/', 'vendor/', '_vendor/'];
const SWIFT_DEPENDENCY_DIRS = [
  '.build/',
  'SourcePackages/checkouts/',
  'usr/lib/swift/',
  'Contents/Developer/',
];

// These regexes backtrack polynomially on long lines, which failure output (hex dumps, tokens) can
// contain, and the cost repeats for every failed test. A location is near the start of a line.
const MAX_SCANNED_LINE_LENGTH = 1000;
const MAX_SCANNED_LINES = 2000;
const MAX_SOURCE_LINE = 1_000_000;

function isDependencyPath(filePath: string): boolean {
  const dirs = filePath.endsWith('.swift')
    ? [...DEPENDENCY_DIRS, ...SWIFT_DEPENDENCY_DIRS]
    : DEPENDENCY_DIRS;
  const rooted = `/${filePath}`;
  return dirs.some((dir) => rooted.includes(`/${dir}`));
}

// Without a directory, "payments.internal" and "api.example.com" look just like file names.
const SOURCE_EXTENSIONS = new Set(
  'c cc cjs coffee cpp cs cts cxx dart ex exs fs go groovy h hpp java js jsx kt kts lua m mjs mm mts php pl py rb rs scala sh svelte swift ts tsx vb vue zig'.split(
    ' ',
  ),
);

function looksLikeSourcePath(path: string): boolean {
  if (path.includes('/')) return true;
  return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase());
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

function toWorkspaceRoot(workspace?: string): string | undefined {
  return workspace ? toForwardSlashes(workspace).replace(/\/+$/, '') : undefined;
}

export function normalizePath(filePath: string, workspace?: string): string {
  let p = toForwardSlashes(filePath);
  const root = toWorkspaceRoot(workspace);
  if (root && p.startsWith(`${root}/`)) p = p.slice(root.length + 1);
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

const ABSOLUTE_PATH = /^(?:[A-Za-z]:)?\//;

export function isRepoFile(filePath: string, workspace?: string): boolean {
  const root = toWorkspaceRoot(workspace);
  let path = toForwardSlashes(filePath);
  if (root && path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  if (isDependencyPath(path)) return false;
  return !(workspace && ABSOLUTE_PATH.test(path));
}

interface FileLocation {
  path: string;
  line: number;
}

type PatternExtractor = (line: string) => FileLocation | null;

const PATTERNS: PatternExtractor[] = [
  // JS/TS: at Something (path:line:col) or at path:line:col. The path must look like a source file,
  // so "started at 20:12:40" and "at api.example.com:443:1" aren't locations.
  (line) => {
    const match = line.match(
      /\bat\s+(?:[^()]*\(([^()]+\.[a-z]\w*):(\d+):\d+\)|([^()]+?\.[a-z]\w*):(\d+):\d+)/i,
    );
    if (!match) return null;
    const path = match[1] ?? match[3];
    if (!looksLikeSourcePath(path)) return null;
    return { path, line: Number.parseInt(match[2] ?? match[4], 10) };
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
    const match = line.includes('.go:') ? line.match(/([\w./-]+\.go):(\d+)/) : null;
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },

  // Ruby: path/file.rb:N:in
  (line) => {
    const match = line.includes('.rb:') ? line.match(/([\w./-]+\.rb):(\d+)/) : null;
    if (!match) return null;
    return { path: match[1], line: Number.parseInt(match[2], 10) };
  },

  // Swift (XCTest and Swift Testing): path/File.swift:line[:col]
  (line) => {
    const match = line.includes('.swift:')
      ? line.match(/((?:[A-Za-z]:\/)?[^\s:'"()<>[\]]+\.swift):(\d+)/)
      : null;
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

const DIAGNOSTIC_LINE = /^\s*((?:[A-Za-z]:\/)?[^:]+\.\w+):(\d+)(?::\d+)?: error:/;

// XCTest and compilers write "path:line: error: message" at the start of a line. This is the
// assertion itself, unlike other paths in captured output. Spaces are only part of the path when
// the workspace prefix shows where it starts; otherwise they are prose ("Build failed in a.swift").
function createDiagnosticLineExtractor(root?: string): PatternExtractor {
  return (line) => {
    const match = line.match(DIAGNOSTIC_LINE);
    if (!match) return null;
    const inWorkspace = root !== undefined && match[1].startsWith(`${root}/`);
    const path = inWorkspace ? match[1].slice(root.length + 1) : match[1];
    if (!inWorkspace && /\s/.test(path)) return null;
    if (!looksLikeSourcePath(path)) return null;
    return { path, line: Number.parseInt(match[2], 10) };
  };
}

function findFirstLocation(
  lines: string[],
  patterns: PatternExtractor[],
  workspace?: string,
): FileLocation | null {
  for (const line of lines) {
    for (const extract of patterns) {
      const result = extract(line);
      if (result && isValidSourceLine(result.line) && isRepoFile(result.path, workspace)) {
        return { path: normalizePath(result.path), line: result.line };
      }
    }
  }
  return null;
}

function toScannableLines(text: string): string[] {
  return text
    .split('\n')
    .slice(0, MAX_SCANNED_LINES)
    .map((line) =>
      toForwardSlashes(stripVTControlCharacters(line))
        .replace(/file:\/\/(?:\/(?=[A-Za-z]:\/))?/g, '')
        .slice(0, MAX_SCANNED_LINE_LENGTH),
    );
}

// Only where a path starts, so a longer path containing the workspace isn't spliced together.
function stripWorkspacePrefix(lines: string[], root?: string): string[] {
  if (!root) return lines;
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = new RegExp(`(?<![^\\s("'=[])${escapedRoot}/`, 'g');
  return lines.map((line) => line.replace(prefix, ''));
}

export function parseFileLocation(stackTrace: string, workspace?: string): FileLocation | null {
  if (!stackTrace) return null;

  const root = toWorkspaceRoot(workspace);
  const lines = toScannableLines(stackTrace);
  return (
    findFirstLocation(lines, [createDiagnosticLineExtractor(root)], workspace) ??
    findFirstLocation(stripWorkspacePrefix(lines, root), PATTERNS, workspace)
  );
}

// A message is free text that can name any path (an expected value, a host and port), so unlike a
// stack trace, only a diagnostic line says where the failure is.
export function parseFailureMessageLocation(
  message: string,
  workspace?: string,
): FileLocation | null {
  if (!message) return null;

  const extractor = createDiagnosticLineExtractor(toWorkspaceRoot(workspace));
  return findFirstLocation(toScannableLines(message), [extractor], workspace);
}
