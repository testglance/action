# Architecture

**Purpose:** The end-to-end `run()` pipeline, the `src/` module map, and the cross-cutting design patterns that hold it together.
**Read this when:** You need the big-picture flow, want to know where a subsystem plugs in, or are tracing how data moves from a report file to the rendered outputs.

## High-level flow

```
inputs ──► discover/auto-detect files ──► parse each ──► mergeTestRuns
                                                              │
                                          ┌───────────────────┤
                                          ▼                   ▼
                              history (load/append/save)   detectFramework
                                          │
            delta · testsChanged · flaky · perf · trends · baseDelta
                                          │
                  ┌───────────────────────┼─────────────────────────┐
                  ▼                        ▼                         ▼
            sendTestRun (API)        outputs: summary · check run · PR comment · HTML artifact
            (skipped in local-only)
```

A single `ParsedTestRun` (`src/types.ts:1`) is the spine: every parser produces it, history derives from it, and every output consumes it. The whole pipeline is wrapped in one top-level `try/catch` that downgrades any escape to a `core.warning` so the action always exits 0 — see [Non-blocking errors](#non-blocking-errors).

## Tracing `run()` (`src/index.ts:140`)

The entire pipeline is one `async function run()`, called at module load (`src/index.ts:529`). Step by step:

| Stage                    | Lines                    | Notes                                                                                                                                                               |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read & coerce inputs     | `src/index.ts:142`–`175` | `getInput` calls + the `parse*` validators at the top of the file. See [inputs-reference](./inputs-reference.md).                                                   |
| `localOnly` detection    | `src/index.ts:144`       | `localOnly = !apiKey`. Forces `sendResults = false` (`src/index.ts:154`). See [Dual-mode](#dual-mode-local-only-vs-api).                                            |
| Discover vs auto-detect  | `src/index.ts:179`–`198` | If `report-path` set → `discoverReportFiles` (glob or literal). Else → `autoDetectReportFiles` scanning `AUTO_DETECT_PATTERNS`. Empty result → warn + early return. |
| Per-file parse           | `src/index.ts:202`–`213` | `parseFile` (`src/index.ts:119`) picks parser by format/extension; per-file failures are warned and skipped, not fatal.                                             |
| All-failed guard         | `src/index.ts:215`–`218` | Warn + return if nothing parsed.                                                                                                                                    |
| `mergeTestRuns`          | `src/index.ts:220`       | Concatenates suites, **recounts** the summary from `<testcase>`/test elements (`src/utils/merge-results.ts:39`). Single-file runs pass through unchanged.           |
| History load/append/save | `src/index.ts:230`–`288` | Lazy, guarded block; see [History & analytics](#history-stage).                                                                                                     |
| Delta + testsChanged     | `src/index.ts:262`–`282` | Computed only when `entries.length >= 2`; each in its own `try/catch` → `core.debug`.                                                                               |
| Flaky detection          | `src/index.ts:290`–`300` | Needs `>= 5` entries (`detectFlakyTests`).                                                                                                                          |
| Perf regressions         | `src/index.ts:302`–`319` | Needs `>= 3` entries; `< 4` still warns it's "collecting baseline".                                                                                                 |
| Trends                   | `src/index.ts:321`–`329` | Needs `>= 3` entries (`computeTrends`).                                                                                                                             |
| Base-branch comparison   | `src/index.ts:331`–`354` | Only on PRs (`GITHUB_BASE_REF`). Loads the **base** branch's history via a second `ActionsCacheStorage` and computes `baseDelta`.                                   |
| Framework detection      | `src/index.ts:356`–`362` | `detectFramework` from path heuristics + CTRF `toolName`.                                                                                                           |
| `sendTestRun`            | `src/index.ts:366`–`382` | Only if `sendResults`. POSTs `/api/v1/runs` with retry. Failures route to `handleApiUnreachable`/`handleApiError`. See [api-client](./api-client.md).               |
| HTML report + artifact   | `src/index.ts:391`–`420` | Only if `html-report`. `generateHtmlReport` → `uploadArtifact`; sets `artifactUrl` on success.                                                                      |
| CI summary               | `src/index.ts:428`–`460` | `generateSummary` always runs (even local-only).                                                                                                                    |
| Check run                | `src/index.ts:462`–`476` | Only if `annotate-failures`/`create-check` and a `github-token` is present.                                                                                         |
| PR comment               | `src/index.ts:478`–`520` | Posts when `github-token` present **and** (API succeeded **or** `localOnly`). See [Multi-job consolidation](#multi-job-pr-comment-consolidation).                   |
| Return / catch           | `src/index.ts:522`–`526` | Returns `{ history }`; the outer `catch` calls `handleUnexpectedError`.                                                                                             |

Note the merged `ParsedTestCase` does not retain its origin file, so the check run falls back to `successful[0].filePath` for tests lacking a location (`src/index.ts:464`).

## Module map (`src/`)

| Dir / file                            | Role                                                                                                                                               | Deep dive                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `index.ts`                            | Orchestrator — the `run()` pipeline above.                                                                                                         | (this doc)                                               |
| `types.ts`                            | `ParsedTestRun` / `ParsedSuite` / `ParsedTestCase`, the `ApiPayload` envelope, `Highlight`.                                                        | [data-model](./data-model.md)                            |
| `parsers/junit.ts`, `parsers/ctrf.ts` | Format-specific parsers → `ParsedTestRun`.                                                                                                         | [parsers](./parsers.md)                                  |
| `api/client.ts`                       | `sendTestRun` / `buildPayload`, retry + timeout, error classification.                                                                             | [api-client](./api-client.md)                            |
| `history/`                            | `manager.ts`, `actions-cache-storage.ts`, `comparison.ts`, `flaky-detection.ts`, `perf-regression.ts`, `trends.ts`, `types.ts`.                    | [history-analytics](./history-analytics.md)              |
| `output/`                             | `summary.ts`, `pr-comment.ts` + `post-pr-comment.ts`, `check-run.ts`, `html-report.ts`, `upload-artifact.ts`, `template-renderer.ts`, `format.ts`. | [output](./output.md)                                    |
| `utils/`                              | `detect-format.ts`, `detect-framework.ts`, `discover-files.ts`, `auto-detect.ts`, `merge-results.ts`, `parse-stack-trace.ts`, `errors.ts`.         | [parsers](./parsers.md), [conventions](./conventions.md) |

## History stage

`historyEnabled` defaults true (off only with `history: false`). The block (`src/index.ts:230`):

1. Derives `branch`, an 8-char SHA-256 hash of `report-path` (or `'auto'`), `commitSha`, `runId` from env.
2. Builds `ActionsCacheStorage(branch, reportPathHash, runId)` (`src/history/actions-cache-storage.ts:17`) and a `HistoryManager(storage, historyLimit)`.
3. `loadHistory()` → `isFirstRun()` check → `appendRun(parsed, meta)` → `saveHistory()` → `getHistory()`.

`ActionsCacheStorage` keys on `testglance-history-<branch>-<hash>[-<runId>]` with broadening `restoreKeys`, backed by `@actions/cache` over a temp file. `HistoryManager` trims to `historyLimit` (FIFO) and enforces a 4 MB ceiling by first dropping per-entry `tests[]`, then pruning oldest entries (`src/history/manager.ts:97`). All analytics derive from `HistoryEntry[]` (`src/history/types.ts:8`), which stores per-test name/suite/status/duration only.

## Key design patterns

### Non-blocking errors

Product req FR5: this action must **never** break CI. Concretely:

- `core.setFailed()` is never called; `run()` always returns and the process exits 0.
- Outer `try/catch` (`src/index.ts:141`/`523`) funnels anything unexpected to `handleUnexpectedError` → `core.warning` (`src/utils/errors.ts:28`).
- Each optional stage (history, each analytic, HTML, summary, check run, PR comment) has its **own** `try/catch`. User-facing failures use `core.warning`; analytics that are merely "not enough data yet" use `core.debug` (`src/index.ts:267`, `296`, `308`). See [observability](./observability.md) and [known-issues](./known-issues.md).

### Lazy history init

There is no init step. `HistoryManager.appendRun` materializes a fresh `HistoryFile` (`version: 1`) only when none was loaded (`src/history/manager.ts:61`); `isFirstRun()` distinguishes a genuine cache miss from a load error (`src/history/manager.ts:35`). Analytics self-gate on `entries.length` thresholds, so early runs simply produce fewer signals.

### Dual-mode (local-only vs API)

No `api-key` → `localOnly = true` → `sendResults` forced false (`src/index.ts:154`); the action logs the mode and never POSTs. Summary, check run, PR comment, and HTML still run — the PR-comment guard explicitly allows `localOnly` (`src/index.ts:478`). With a key, `sendTestRun` runs unless `send-results: false`. See [inputs-reference](./inputs-reference.md).

### Multi-job PR comment consolidation

Multiple jobs (each its own action invocation) share **one** PR comment, keyed by the marker `<!-- testglance-pr-summary -->` (`src/output/pr-comment.ts:83`). `postPrComment` lists comments, and if a marked one exists it calls `mergeTestJobSection` (`src/output/pr-comment.ts:652`) to update that job's section in place; otherwise `renderPrComment([section])` creates it (`src/output/post-pr-comment.ts:47`). Each section is identified by `testJobName`.

### Handlebars templating

`summary-template` / `comment-template` inputs select user templates rendered via Handlebars in `src/output/template-renderer.ts`, with registered helpers (`formatDuration`, `truncate`, `escapeHtml`, `passRate`, `limit`) and a compile cache. Template paths are resolved through `realpathSync` and confined to the workspace. See [output](./output.md) and [security](./security.md).

### Adaptive output sizing

Outputs are bounded to fit GitHub limits. In `src/output/summary.ts`: the rendered summary is hard-capped at `MAX_RENDERED_SUMMARY_BYTES` (900 000), failed tests at `MAX_FAILED_TESTS_SHOWN` (25), error messages at 200 chars, stack traces at 30 lines, and the "all tests" block at `MAX_ALL_TESTS_BYTES` (400 000). `show-all-tests: auto` (`shouldRenderAllTests`, `src/output/summary.ts:67`) renders every test only when `total <= 200` (or `<= 1000` for a single suite). See [output](./output.md).

## Pointers

- Shape of the data flowing through: [data-model](./data-model.md)
- How files become `ParsedTestRun`: [parsers](./parsers.md)
- Delta/flaky/perf/trends internals: [history-analytics](./history-analytics.md)
- Rendering (summary, PR comment, check run, HTML): [output](./output.md)
- API submission + retries: [api-client](./api-client.md)
- Logging levels and what surfaces where: [observability](./observability.md)
