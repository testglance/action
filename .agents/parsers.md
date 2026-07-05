# Parsers (JUnit & CTRF)

**Purpose:** How the two report formats are parsed and normalized into `ParsedTestRun`, plus format/framework detection, file discovery, result merging, and stack-trace location extraction.
**Read this when:** You are adding a report format, fixing a parsing bug, or touching file discovery / format detection / result merging / stack-trace parsing.

Both parsers emit the same normalized contract: `ParsedTestRun` (`src/types.ts:1`). See [data-model](./data-model.md) for the shape. Parse failures throw `ParseError` and are handled non-blockingly — see [observability](./observability.md) and [known-issues](./known-issues.md).

## Critical rule

**Never trust suite-level count attributes** (`tests=`, `failures=`, `errors=`, `skipped=` on `<testsuite>`/`<testsuites>` or `results.summary.*` in CTRF). Both parsers RECOUNT every status by iterating the actual `<testcase>` / `tests[]` elements. Suite/run-level summary fields in the input are read only for _duration_, never for counts.

## Pipeline (where these run)

`src/index.ts` orchestrates:

1. Discover files — `discoverReportFiles` (`report-path` given) or `autoDetectReportFiles` (no input).
2. Parse each file — `parseFile` (`src/index.ts:119`) picks a parser via `detectFormat`, with a dual-parse fallback.
3. Merge — `mergeTestRuns` combines per-file `ParsedTestRun`s into one.
4. Framework detection — `detectFramework` (`src/index.ts:358`) labels the run for the meta envelope.

---

## JUnit parser — `src/parsers/junit.ts`

Entry: `parseJunitXml(content)` (`src/parsers/junit.ts:105`).

### fast-xml-parser config (`src/parsers/junit.ts:7`)

- `ignoreAttributes: false`, `attributeNamePrefix: '@_'` — attributes become keys like `@_name`, `@_time`.
- `textNodeName: '#text'` — element text (e.g. a `<failure>` body) lands under `#text`.
- `isArray` forces `testsuite`, `testcase`, `property` to always be arrays (`src/parsers/junit.ts:11`) — single-element cases don't collapse to objects.
- `trimValues: true`.
- `processEntities` is bounded (billion-laughs guard): `maxTotalExpansions: 1_000_000`, `maxExpandedLength: 10_000_000`, `maxEntityCount: 100` (`src/parsers/junit.ts:13`). See [security](./security.md).

### Flow

1. Strip a leading UTF-8 BOM (`﻿`) and `trim()`; empty input throws `ParseError('JUnit XML is empty')` (`src/parsers/junit.ts:113`).
2. `xmlParser.parse` wrapped in try/catch; any throw becomes `ParseError('Failed to parse JUnit XML: …')` (`src/parsers/junit.ts:120`).
3. Root handling (`src/parsers/junit.ts:127`): prefer a `<testsuites>` root (reads `@_time` as `rootDuration`, recurses its inner `testsuite[]`); else fall back to a top-level `<testsuite>` root. If neither exists, `suites` stays empty (total 0).
4. `flattenSuites` (`src/parsers/junit.ts:80`) recurses nested `<testsuite>` elements. A suite emits a `ParsedSuite` only when it has direct `<testcase>` children; nested suites are flattened to siblings. Name falls back `@_name → parentName → 'unknown'`.

### resolveStatus precedence (`src/parsers/junit.ts:21`)

Checked in order; first match wins:

| Order | Child element present                            | status    |
| ----- | ------------------------------------------------ | --------- |
| 1     | `<error>`                                        | `errored` |
| 2     | `<failure>`                                      | `failed`  |
| 3     | `<skipped>` (key present, any value incl. empty) | `skipped` |
| 4     | none                                             | `passed`  |

- `errorMessage` = `@_message` attr, falling back to the element's `#text` body.
- `errorType` = `@_type` attr.
- `stackTrace` = the `#text` body, only when non-empty.
- `<skipped>` may be a self-closing tag (parsed as `''`) or carry `@_message`; presence is tested with `!== undefined`.

### Per-testcase extraction (`src/parsers/junit.ts:58`)

- `name` = `@_name`, fallback `'unknown'`.
- `duration` = `parseFloat(@_time) || 0`.
- `file` = `@_file` (only if present); `line` = `parseInt(@_line)` (only if `Number.isFinite`).

### Summary (`src/parsers/junit.ts:148`)

Counts recounted from `allTests` (flattened across suites). `duration` = `rootDuration` from `<testsuites @_time>` if present, else the sum of per-suite durations.

---

## CTRF parser — `src/parsers/ctrf.ts`

Entry: `parseCtrfJson(content)` (`src/parsers/ctrf.ts:66`). Uses native `JSON.parse` (no schema library).

### Flow

1. Empty / whitespace-only input throws `ParseError('CTRF file is empty')` (`src/parsers/ctrf.ts:67`).
2. `JSON.parse` failure → `ParseError('Invalid JSON: …')` (`src/parsers/ctrf.ts:75`).
3. `validateCtrfStructure` (`src/parsers/ctrf.ts:41`) throws `ParseError` for each missing required field: `results`, `results.tests` (must be array), `results.tool`, `results.tool.name` (string), `results.summary`.

### STATUS_MAP (`src/parsers/ctrf.ts:33`)

| CTRF status           | normalized                                               |
| --------------------- | -------------------------------------------------------- |
| `passed`              | `passed`                                                 |
| `failed`              | `failed`                                                 |
| `skipped`             | `skipped`                                                |
| `pending`             | `skipped`                                                |
| `other`               | `errored`                                                |
| _(anything unmapped)_ | `errored` (via `?? 'errored'`, `src/parsers/ctrf.ts:87`) |

### Per-test extraction (`src/parsers/ctrf.ts:84`)

- Suite name = `test.suite || test.filePath || toolName` (`src/parsers/ctrf.ts:85`) — this fallback chain is why merge does the "generic name" rename (below).
- `duration` = `(test.duration ?? 0) / 1000` — CTRF durations are **milliseconds**, normalized to **seconds**.
- Error fields only attached when status is `failed`/`errored`: `errorMessage` = `test.message`; `errorType` = first line of `test.trace`; `stackTrace` = full `test.trace`.
- `file` = `test.filePath`; `line` = `test.line` (only if `typeof === 'number'`).

### Suites & summary

- Tests are grouped into a `Map` keyed by suite name, preserving first-seen order.
- `toolName` (`results.tool.name`) is captured and returned on `ParsedTestRun.toolName` — feeds [framework detection](#framework-detection) and the merge rename.
- Counts recounted from `allTests`. `duration` = `(summary.stop - summary.start) / 1000` when both timestamps present, else sum of per-suite durations (`src/parsers/ctrf.ts:122`).

---

## Format detection — `src/utils/detect-format.ts`

`detectFormat(filePath)` (`src/utils/detect-format.ts:3`) maps by file extension only:

| Extension     | format  |
| ------------- | ------- |
| `.xml`        | `junit` |
| `.json`       | `ctrf`  |
| anything else | `null`  |

When `report-format: auto` and the extension yields `null`, `parseFile` (`src/index.ts:127`) **dual-parses**: try JUnit, and on any throw fall back to CTRF. An explicit `report-format` input bypasses detection.

## Framework detection — `src/utils/detect-framework.ts`

`detectFramework(reportPath, format, ctrfToolName?)` (`src/utils/detect-framework.ts:8`):

1. If `format === 'ctrf'` and a `ctrfToolName` is present, return it verbatim (CTRF tool name wins).
2. Else match the report path against ordered `PATH_HEURISTICS` (`src/utils/detect-framework.ts:1`):

| Path regex (case-insensitive) | framework        |
| ----------------------------- | ---------------- |
| `vitest`                      | `vitest`         |
| `jest`                        | `jest`           |
| `pytest`                      | `pytest`         |
| `surefire`                    | `maven-surefire` |

3. No match → `undefined`. The result populates `MetaEnvelope.framework` (see [data-model](./data-model.md)).

---

## File discovery — `src/utils/discover-files.ts`

`discoverReportFiles(pattern)` (`src/utils/discover-files.ts:5`):

- Glob detection via `GLOB_CHARS = /[*?{[]/`.
- **No glob chars** → treat as a single literal path: return `[pattern]` if it `existsSync`, else `[]` (no error).
- **Has glob chars** → `fast-glob` with `{ absolute: true, onlyFiles: true }`, results `.sort()`ed.

## Auto-detect — `src/utils/auto-detect.ts`

When no `report-path` is given, `autoDetectReportFiles()` (`src/utils/auto-detect.ts:13`) runs each pattern through `discoverReportFiles`, de-dups into a `Set`, and returns `{ files (sorted), scannedPatterns }`. The pattern list `AUTO_DETECT_PATTERNS` (`src/utils/auto-detect.ts:3`):

```
**/test-results/**/*.xml
**/junit.xml
**/test-report.xml
**/surefire-reports/*.xml
**/test-results/**/*.json
**/ctrf-report.json
**/test-report.json
```

`scannedPatterns` is surfaced in the "No test report files found" warning (`src/index.ts:192`).

---

## Merge — `src/utils/merge-results.ts`

`mergeTestRuns(runs: FileParseResult[])` (`src/utils/merge-results.ts:9`):

- **Single file** → passthrough, returns `runs[0].parsed` untouched (`src/utils/merge-results.ts:10`).
- **Multiple files** → concatenate all suites, then recount the summary from scratch by walking every test (`src/utils/merge-results.ts:39`).
- `toolName` = first non-undefined across runs (`??=`).
- **Generic-name rename** (`src/utils/merge-results.ts:21`): when a run has exactly one suite _and_ that suite's name equals its `toolName` (the CTRF "fell back to toolName" case), the suite is renamed to `basename(filePath)` so merged reports stay distinguishable. Otherwise the suite name is kept as-is.

Note: `ParsedTestCase` does not carry its origin file across the merge — a documented limitation that affects annotation fallback (`src/index.ts:464`). See [known-issues](./known-issues.md).

---

## Stack-trace location — `src/utils/parse-stack-trace.ts`

`parseFileLocation(stackTrace)` (`src/utils/parse-stack-trace.ts:65`) extracts the first usable `{ path, line }` from a stack trace, used to place failure annotations on the right source line. See [output](./output.md).

- Splits on newlines; for each line, tries each `PatternExtractor` in `PATTERNS` order (`src/utils/parse-stack-trace.ts:21`).
- Skips any match whose path is inside a dependency dir — `DEPENDENCY_DIRS = ['node_modules/', 'site-packages/', '.gradle/', 'vendor/', '_vendor/']` (`src/utils/parse-stack-trace.ts:1`) — and keeps scanning.
- `normalizePath` (`src/utils/parse-stack-trace.ts:7`) strips a leading `./` then a leading `/`.
- Returns `null` if no non-dependency match is found.

Supported language patterns (in priority order):

| Lang   | Matches                                       |
| ------ | --------------------------------------------- |
| JS/TS  | `at Fn (path:line:col)` or `at path:line:col` |
| Python | `File "path", line N`                         |
| Java   | `at pkg.Class(File.java:N)`                   |
| Go     | `path/file.go:N`                              |
| Ruby   | `path/file.rb:N`                              |
| .NET   | `in /path/File.cs:line N`                     |

---

## Adding a new format — checklist

1. Write `src/parsers/<format>.ts` exporting a `parse…(content): ParsedTestRun` that **recounts** from leaf test elements and throws `ParseError` on bad input.
2. Map its extension in `detectFormat` (`src/utils/detect-format.ts`) and wire it into `parseFile` (`src/index.ts:119`), including the dual-parse fallback if it shares an extension.
3. Add path/tool heuristics to `detect-framework.ts` if relevant.
4. Add auto-detect globs to `AUTO_DETECT_PATTERNS` if it has conventional output paths.
5. Add fixtures + tests under `src/parsers/__tests__/`. See [testing](./testing.md).
