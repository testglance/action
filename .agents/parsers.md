# Parsers (JUnit & CTRF)

**Purpose:** How the two report formats are parsed and normalized into `ParsedTestRun`, plus format/framework detection, file discovery, result merging, and stack-trace location extraction.
**Read this when:** You are adding a report format, fixing a parsing bug, or touching file discovery / format detection / result merging / stack-trace parsing.

Both parsers emit the same normalized contract: `ParsedTestRun` (`src/types.ts`). See [data-model](./data-model.md) for the shape. Parse failures throw `ParseError` and are handled non-blockingly — see [observability](./observability.md) and [known-issues](./known-issues.md).

## Critical rule

**Never trust suite-level count attributes** (`tests=`, `failures=`, `errors=`, `skipped=` on `<testsuite>`/`<testsuites>` or `results.summary.*` in CTRF). Both parsers RECOUNT every status by iterating the actual `<testcase>` / `tests[]` elements. Suite/run-level summary fields in the input are read only for _duration_, never for counts.

## Pipeline (where these run)

`src/index.ts` orchestrates:

1. Discover files — `discoverReportFiles` (`report-path` given) or `autoDetectReportFiles` (no input). Auto-detect adds `junit-swift-testing.xml` beside a detected `junit.xml`; an explicit `report-path` that leaves it out gets a warning.
2. Parse each file — `parseFile` (`src/index.ts`) picks a parser via `detectFormat`, with a dual-parse fallback.
3. Merge — `mergeTestRuns` combines per-file `ParsedTestRun`s into one.
4. Framework detection — `detectRunFramework` (`src/utils/detect-run-framework.ts`) labels the run for the meta envelope.

---

## JUnit parser — `src/parsers/junit.ts`

Entry: `parseJunitXml(content)` (`src/parsers/junit.ts`).

### fast-xml-parser config (`src/parsers/junit.ts`)

- `ignoreAttributes: false`, `attributeNamePrefix: '@_'` — attributes become keys like `@_name`, `@_time`.
- `textNodeName: '#text'` — element text (e.g. a `<failure>` body) lands under `#text`.
- `isArray` forces `testsuite`, `testcase`, `property` to always be arrays (`src/parsers/junit.ts`) — single-element cases don't collapse to objects.
- `trimValues: true`.
- `htmlEntities: true` — decodes numeric references. Swift Testing encodes every non-ASCII character and newline this way (`&#8594;`, `&#10;`). Test and suite names are then collapsed to one line, because they go into Markdown tables.
- `processEntities` is bounded (billion-laughs guard): `maxTotalExpansions: 1_000_000`, `maxExpandedLength: 10_000_000`, `maxEntityCount: 100`, with `appliesTo: 'external'` so the limits cover DOCTYPE entities and not numeric references, which can't amplify and which large reports have millions of (`src/parsers/junit.ts`). See [security](./security.md).

### Flow

1. Strip a leading UTF-8 BOM (`﻿`) and `trim()`; empty input throws `ParseError('JUnit XML is empty')` (`src/parsers/junit.ts`).
2. `xmlParser.parse` wrapped in try/catch; any throw becomes `ParseError('Failed to parse JUnit XML: …')` (`src/parsers/junit.ts`).
3. Root handling (`src/parsers/junit.ts`): prefer a `<testsuites>` root (reads `@_time` as `rootDuration`, recurses its inner `testsuite[]`); else fall back to a top-level `<testsuite>` root. If neither exists, `suites` stays empty (total 0).
4. `flattenSuites` (`src/parsers/junit.ts`) recurses nested `<testsuite>` elements. A suite emits a `ParsedSuite` only when it has direct `<testcase>` children; nested suites are flattened to siblings. Name falls back `@_name → parentName → 'unknown'`.

### resolveStatus precedence (`src/parsers/junit.ts`)

Checked in order; first match wins:

| Order | Child element present                            | status    |
| ----- | ------------------------------------------------ | --------- |
| 1     | `<error>`                                        | `errored` |
| 2     | `<failure>`                                      | `failed`  |
| 3     | `<skipped>` (key present, any value incl. empty) | `skipped` |
| 4     | none                                             | `passed`  |

- Presence of all three elements is tested with `!== undefined`, because a bare `<failure />` parses as `''`.
- `errorMessage` = `@_message` attr, falling back to the element's `#text` body. Several `<failure>` or `<error>` elements on one test (Swift Testing writes one per issue) have their messages joined with newlines.
- `errorType` = `@_type` attr of the first element.
- `stackTrace` = the `#text` bodies, only when non-empty.
- `<skipped>` may be a self-closing tag, carry `@_message`, or hold a comment in its body (Swift Testing).

### SwiftPM reports (`swift test --xunit-output`)

Checked against captured reports in `fixtures/junit-swift*.xml`. Each fixture records its `swift --version`: Swift Testing from Apple Swift 6.4 (Command Line Tools), XCTest from Swift 6.4.2 on Linux. **No report has been captured from Xcode**, so what XCTest writes on Apple platforms is inferred from the shared SwiftPM source.

- **`TestResults` suites.** The real suite is only in `classname`, and test identity is suite + name, so a suite with exactly this name is split by `classname`, unless none of its tests has one. Each split suite's `duration` is the sum of its tests, and the suite's declared `@_time` still counts toward the run.
- **Several test products.** Swift Testing writes one `TestResults` suite per product under one `<testsuites>` root. The merger writes non-ASCII text literally instead of as numeric references. Products run one at a time, so the run's `duration` adds up their `@_time` values.
- **`@_time` differs by writer.** Swift Testing's is wall-clock time. XCTest's is the sum of its test times, so a parallel XCTest run is overstated and nothing in the report can correct it.
- **Suite counts are not test counts.** Swift Testing's `tests` leaves out skipped tests and `failures` counts issues, for example `tests="8" failures="5"` for 10 test cases with 4 failed. The recount rule above already handles this.
- **Which files are written.** The table is for `--xunit-output test-results/junit.xml`:

  | Run                                     | `junit.xml`                                       | `junit-swift-testing.xml` |
  | --------------------------------------- | ------------------------------------------------- | ------------------------- |
  | `--parallel`, XCTest enabled            | XCTest results, or zero test cases if it has none | Swift Testing results     |
  | No `--parallel`, XCTest enabled         | Not written                                       | Swift Testing results     |
  | XCTest not enabled (Command Line Tools) | Swift Testing results                             | Not written               |

  Auto-detect reads both, using `findSwiftTestingReport` (`src/utils/swiftpm-report-pair.ts`) beside any detected `junit.xml`. A `report-path` naming only one file reads only that file, and if it leaves out a `-swift-testing.xml` beside it, the action warns instead of merging, because a workflow may report each half in its own step and the sibling may be stale.

- **Create the directory first** (`mkdir -p test-results`). A single Swift Testing product opens the file directly, and if the directory is missing it runs no tests, prints `No such file or directory` and `swift test` exits 1, even when every test would pass. Two cases survive only because another writer creates the directory first: `--parallel` with XCTest enabled, and several test products.
- **`XCTSkip` is reported as passed.** SwiftPM's `XUnitGenerator` only knows success or failure and writes no `<skipped>`, so the parser can't tell. Swift Testing skips are reported correctly.
- **No source locations.** Swift Testing failures carry only a message and XCTest failures only say `failure`, so annotations fall back to the report file. XCTest's hidden `--experimental-xunit-message-failure` puts the test output in the message, where `resolveLocation` (`src/output/check-run.ts`) can find its `File.swift:line: error:` line.

### Per-testcase extraction (`src/parsers/junit.ts`)

- `name` = `@_name`, fallback `'unknown'`.
- `duration` = `parseFloat(@_time) || 0`.
- `file` = `@_file` (only if present); `line` = `parseInt(@_line)` (only if `Number.isFinite`).

### Summary (`src/parsers/junit.ts`)

Counts recounted from `allTests` (flattened across suites). `duration` = `rootDuration` from `<testsuites @_time>` if present, else `flattenSuites`' `runTime`: each suite's declared `@_time`, falling back to the sum of its tests for a split `TestResults` suite with no declared time.

---

## CTRF parser — `src/parsers/ctrf.ts`

Entry: `parseCtrfJson(content)` (`src/parsers/ctrf.ts`). Uses native `JSON.parse` (no schema library).

### Flow

1. Empty / whitespace-only input throws `ParseError('CTRF file is empty')` (`src/parsers/ctrf.ts`).
2. `JSON.parse` failure → `ParseError('Invalid JSON: …')` (`src/parsers/ctrf.ts`).
3. `validateCtrfStructure` (`src/parsers/ctrf.ts`) throws `ParseError` for each missing required field: `results`, `results.tests` (must be array), `results.tool`, `results.tool.name` (string), `results.summary`.

### STATUS_MAP (`src/parsers/ctrf.ts`)

| CTRF status           | normalized                                            |
| --------------------- | ----------------------------------------------------- |
| `passed`              | `passed`                                              |
| `failed`              | `failed`                                              |
| `skipped`             | `skipped`                                             |
| `pending`             | `skipped`                                             |
| `other`               | `errored`                                             |
| _(anything unmapped)_ | `errored` (via `?? 'errored'`, `src/parsers/ctrf.ts`) |

### Per-test extraction (`src/parsers/ctrf.ts`)

- Suite name = `test.suite || test.filePath || toolName` (`src/parsers/ctrf.ts`) — this fallback chain is why merge does the "generic name" rename (below).
- `duration` = `(test.duration ?? 0) / 1000` — CTRF durations are **milliseconds**, normalized to **seconds**.
- Error fields only attached when status is `failed`/`errored`: `errorMessage` = `test.message`; `errorType` = first line of `test.trace`; `stackTrace` = full `test.trace`.
- `file` = `test.filePath`; `line` = `test.line` (only if `typeof === 'number'`).

### Suites & summary

- Tests are grouped into a `Map` keyed by suite name, preserving first-seen order.
- `toolName` (`results.tool.name`) is captured and returned on `ParsedTestRun.toolName` — feeds [framework detection](#framework-detection) and the merge rename.
- Counts recounted from `allTests`. `duration` = `(summary.stop - summary.start) / 1000` when `start` is positive and `stop` is later, else sum of per-suite durations (`src/parsers/ctrf.ts`).

---

## Format detection — `src/utils/detect-format.ts`

`detectFormat(filePath)` (`src/utils/detect-format.ts`) maps by file extension only:

| Extension     | format  |
| ------------- | ------- |
| `.xml`        | `junit` |
| `.json`       | `ctrf`  |
| anything else | `null`  |

When `report-format: auto` and the extension yields `null`, `parseFile` (`src/index.ts`) **dual-parses**: try JUnit, and on any throw fall back to CTRF. An explicit `report-format` input bypasses detection.

## Framework detection — `src/utils/detect-framework.ts`

`detectFramework(reportPath, format, ctrfToolName?)` (`src/utils/detect-framework.ts`):

1. If `format === 'ctrf'` and a `ctrfToolName` is present, return it verbatim (CTRF tool name wins).
2. Else match the report path against ordered `PATH_HEURISTICS` (`src/utils/detect-framework.ts`):

| Path regex (case-insensitive) | framework        |
| ----------------------------- | ---------------- |
| `vitest`                      | `vitest`         |
| `jest`                        | `jest`           |
| `pytest`                      | `pytest`         |
| `surefire`                    | `maven-surefire` |
| `swift-testing`               | `swift-testing`  |
| `xctest`                      | `xctest`         |

`swift-testing` and `xctest` are checked first, against the file name only, because absolute paths include the repo name.

3. No match → `undefined`. The result populates `MetaEnvelope.framework` (see [data-model](./data-model.md)).

For a whole run, `detectRunFramework` (`src/utils/detect-run-framework.ts`) applies this to each report that has tests, and leaves the run unlabelled if they disagree.

---

## File discovery — `src/utils/discover-files.ts`

`discoverReportFiles(pattern)` (`src/utils/discover-files.ts`):

- Glob detection via `GLOB_CHARS = /[*?{[]/`.
- **No glob chars** → treat as a single literal path: return `[pattern]` if it `existsSync`, else `[]` (no error).
- **Has glob chars** → `fast-glob` with `{ absolute: true, onlyFiles: false, followSymbolicLinks: false }` (directory symlinks are not traversed), filtered to regular files, results `.sort()`ed.
- **Workspace confinement** (both paths): a match whose path lies inside `GITHUB_WORKSPACE` (or `cwd`) but whose realpath escapes it (a planted symlink) is dropped with a warning. The realpath is taken with `realpathSync.native`, which resolves `..` after symlinks as the kernel does (`link/../x.xml`). Paths the workflow author points at _outside_ the workspace (e.g. `RUNNER_TEMP`) are still read.

## Auto-detect — `src/utils/auto-detect.ts`

When no `report-path` is given, `autoDetectReportFiles()` (`src/utils/auto-detect.ts`) runs each pattern through `discoverReportFiles`, de-dups into a `Set`, and returns `{ files (sorted), scannedPatterns }`. The pattern list `AUTO_DETECT_PATTERNS` (`src/utils/auto-detect.ts`):

```
**/test-results/**/*.xml
**/junit.xml
**/test-report.xml
**/surefire-reports/*.xml
**/test-results/**/*.json
**/ctrf-report.json
**/test-report.json
```

`scannedPatterns` is surfaced in the "No test report files found" warning (`src/index.ts`).

---

## Merge — `src/utils/merge-results.ts`

`mergeTestRuns(runs: FileParseResult[])` (`src/utils/merge-results.ts`):

- **Single file** → passthrough, returns `runs[0].parsed` untouched (`src/utils/merge-results.ts`).
- **Multiple files** → concatenate all suites, then recount the summary from scratch by walking every test (`src/utils/merge-results.ts`). `duration` is the sum of each run's `summary.duration`, so a parallel run keeps its wall-clock time.
- `toolName` = first non-undefined across runs (`??=`).
- **Generic-name rename** (`src/utils/merge-results.ts`): when a run has exactly one suite _and_ that suite's name equals its `toolName` (the CTRF "fell back to toolName" case), the suite is renamed to `basename(filePath)` so merged reports stay distinguishable. Otherwise the suite name is kept as-is.

Note: `ParsedTestCase` does not carry its origin file across the merge — a documented limitation that affects annotation fallback (`src/index.ts`). See [known-issues](./known-issues.md).

---

## Stack-trace location — `src/utils/parse-stack-trace.ts`

`parseFileLocation(stackTrace, workspace?)` (`src/utils/parse-stack-trace.ts`) extracts the first usable `{ path, line }` from a stack trace, used to place failure annotations on the right source line. See [output](./output.md).

- Normalizes backslashes, removes the workspace prefix from each line, and scans at most 2,000 lines and the first 1,000 characters of each, because the regexes backtrack polynomially on long unbroken runs. It also removes ANSI codes and `file://`, and only strips the workspace where a path starts.
- First looks for a `path:line: error:` line anywhere in the trace, which is the assertion in XCTest output. Spaces are allowed in its path only after the workspace prefix. Then tries each `PatternExtractor` in `PATTERNS` order.
- `parseFailureMessageLocation(message, workspace?)` is the narrower version for failure messages, which are free text: it accepts only `path:line: error:` lines, with the same dependency and line-number filtering.
- The JS/TS and diagnostic-line patterns require a path that looks like a source file: one with a directory or a known source extension. So `started at 20:12:40`, `at api.example.com:443:1` and `127.0.0.1:5432: error:` aren't locations.
- Skips lines numbered 0 or above 1,000,000, and, when a workspace is given, absolute paths outside it.
- Skips any match whose path is inside a dependency dir, matched as whole path segments after the workspace is removed: `DEPENDENCY_DIRS` (`node_modules/`, `site-packages/`, `.gradle/`, `vendor/`, `_vendor/`), and for `.swift` files only, `SWIFT_DEPENDENCY_DIRS` (`.build/` and `SourcePackages/checkouts/` for packages, `usr/lib/swift/` and `Contents/Developer/` for the toolchain).
- JVM frames carry only a bare file name, so the JVM pattern filters on the frame's package instead — `JVM_LIBRARY_PACKAGES` (`src/utils/parse-stack-trace.ts`) covers the JDK, Kotlin/Scala/Groovy runtimes, and common test frameworks. Extend this list when a library frame gets annotated instead of user code.
- `normalizePath(path, workspace?)` converts backslashes, strips the `GITHUB_WORKSPACE` prefix when given, then a leading `./`, then a leading `/`. Annotations pass `GITHUB_WORKSPACE` (`src/output/check-run.ts`) because Swift's `#filePath` yields absolute runner paths (`/Users/runner/work/<repo>/<repo>/Tests/...`) that would otherwise never match a diff line.
- Returns `null` if no non-dependency match is found.

Supported language patterns (in priority order):

| Lang   | Matches                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| JS/TS  | `at Fn (path:line:col)` or `at path:line:col`                                        |
| Python | `File "path", line N`                                                                |
| JVM    | `at [loader//]pkg.Class.method(File.ext:N)` — `java`, `kt`, `kts`, `scala`, `groovy` |
| Go     | `path/file.go:N`                                                                     |
| Ruby   | `path/file.rb:N`                                                                     |
| Swift  | `path/File.swift:line` (XCTest and Swift Testing)                                    |
| .NET   | `in /path/File.cs:line N`                                                            |

---

## Adding a new format — checklist

1. Write `src/parsers/<format>.ts` exporting a `parse…(content): ParsedTestRun` that **recounts** from leaf test elements and throws `ParseError` on bad input.
2. Map its extension in `detectFormat` (`src/utils/detect-format.ts`) and wire it into `parseFile` (`src/index.ts`), including the dual-parse fallback if it shares an extension.
3. Add path/tool heuristics to `detect-framework.ts` if relevant.
4. Add auto-detect globs to `AUTO_DETECT_PATTERNS` if it has conventional output paths.
5. Add fixtures + tests under `src/parsers/__tests__/`. See [testing](./testing.md).
