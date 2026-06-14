# Output Channels

**Purpose:** How results are rendered to the four output surfaces — CI job summary, PR comment, check-run annotations, and HTML report artifact.
**Read this when:** You are changing what users see — summary markdown, PR comment, inline annotations, the HTML report, or custom Handlebars templates.

All four channels are best-effort. Every one wraps its work in `try/catch` and reports failures via `core.warning()` only — none ever calls `core.setFailed()` (product req FR5; see [conventions](./conventions.md)). They all read the normalized `ParsedTestRun` (see [data-model](./data-model.md)) plus optional history analytics (see [history-analytics](./history-analytics.md)).

## Where they're wired

`run()` in `src/index.ts` drives all four after parsing, in this order:

| Channel                 | Gate (input)                                                                                             | Entry point                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| HTML report + artifact  | `html-report == 'true'`                                                                                  | `generateHtmlReport` → `uploadArtifact` (`src/index.ts:391`) |
| Job summary             | always                                                                                                   | `generateSummary` (`src/index.ts:429`)                       |
| Check run / annotations | `annotate-failures == 'true'` or `create-check == 'true'`, **and** a `github-token` (`src/index.ts:155`) | `createCheckRun` (`src/index.ts:466`)                        |
| PR comment              | `github-token` present **and** (`result.success` or `localOnly`) (`src/index.ts:478`)                    | `postPrComment` (`src/index.ts:480`)                         |

`localOnly` mode (no `api-key`) still produces summary, PR comment, check run, and HTML report — only API submission is skipped. See [inputs-reference](./inputs-reference.md).

## 1. Job summary — `src/output/summary.ts`

`generateSummary(options)` (`src/output/summary.ts:80`) writes Markdown via the `@actions/core` summary API (`core.summary.addRaw` / `addLink`, then a single `core.summary.write()`).

Default rendering order:

1. Metrics strip + pass-rate heading (`renderMetricsStrip` from format.ts).
2. `> ⚠️ API submission failed` banner — only when `!apiSuccess && !localOnly` (`src/output/summary.ts:130`). Suppressed in local-only mode.
3. Progress bar (`renderProgressBar`).
4. Metrics line: duration, `N reports merged` (when `reportFileCount > 1`), health score (`🏥 N/100`, or `available after 5 runs`).
5. Health-score "how is this scored?" `<details>` (only with a real score).
6. Flaky count, highlights, trends.
7. `---` divider, then delta, tests-changed, flaky, perf-regression sections.
8. Suite breakdown (`renderSuiteBreakdown`, `src/output/summary.ts:271`).
9. All-tests section (conditional — see below).
10. Failed tests (`> [!CAUTION]` blocks, capped at `MAX_FAILED_TESTS_SHOWN = 25`, stack traces in `<details>`).
11. Slowest tests `<table>` (only tests with `duration >= 0.2`s).
12. Dashboard link + `Download HTML Report` link (when `artifactUrl` set).

**show-all-tests auto logic** — `shouldRenderAllTests` (`src/output/summary.ts:67`):

- `true` → always render; `false` → never.
- `auto` (default): render the "All Tests" section when `total <= 200` (`AUTO_ALL_TESTS_MAX_TOTAL`), or when there is a single suite and `total <= 1000` (`AUTO_ALL_TESTS_SINGLE_SUITE_MAX_TOTAL`).

`renderAllTests` (`src/output/summary.ts:330`) lists each suite in a `<details>` block, sorted by health (`compareSuitesByHealth`). A block opens (`open` attr) when it has failures/skips or `total <= SUITE_OPEN_MAX_TESTS` (25). It stops appending suite blocks once the body would exceed `MAX_ALL_TESTS_BYTES = 400_000`, then prints `…and N more suite(s) elided`.

**Custom template path** (`src/output/summary.ts:102`): when both `summaryTemplate` and `meta` are set, the whole default body is replaced by the rendered Handlebars output (capped at `MAX_RENDERED_SUMMARY_BYTES = 900_000`). On any template error it returns `null` and falls through to the default summary. See template-renderer below.

The whole sections 8–11 block is wrapped in `try/catch`; on error it warns `Enhanced summary generation failed, using basic summary` and the earlier sections still ship.

## 2. PR comment — `src/output/pr-comment.ts` + `post-pr-comment.ts`

`postPrComment` (`src/output/post-pr-comment.ts:13`) resolves the PR number from the event payload, lists up to 100 comments, finds the one containing the marker `<!-- testglance-pr-summary -->`, and **find-or-creates**:

- found → `mergeTestJobSection(existing.body, section)` → `octokit.rest.issues.updateComment`.
- not found → `renderPrComment([section])` → `octokit.rest.issues.createComment`.

**Multi-job consolidation.** Each Action invocation only knows its own job, so per-job state is persisted inside the comment as hidden base64 `tj-data` blobs (`StoredJobData`, `src/output/pr-comment.ts:60`). On every merge the comment is fully re-rendered from the decoded blobs of _all_ jobs:

- `decodeJobBlobs` (`src/output/pr-comment.ts:413`) recovers each job from `<!-- tj-data:KEY b64 -->`.
- `mergeTestJobSection` (`src/output/pr-comment.ts:652`) replaces the blob with the matching `key` (or appends), then `renderCommentFromStored` rebuilds rollup line + per-job table + per-job `<details>` + re-encoded blobs.
- Job names are sanitized to a whitespace-free `key` via `sanitizeMarkerName` (`src/output/pr-comment.ts:104`) so matrix names like `test (ubuntu-latest)` survive the marker regex.
- Legacy pre-blob comments (`<!-- tj:KEY -->…<!-- /tj:KEY -->`) are migrated via `decodeLegacySections` (`src/output/pr-comment.ts:433`) and kept as opaque standalone blocks until each job re-runs.

**Custom template** jobs (`commentTemplate` set) can't fold into the shared table; their pre-rendered `customBody` renders as a standalone block (`renderCustomBody`, `src/output/pr-comment.ts:324`).

**Size caps.** Visible body capped at `MAX_RENDERED_COMMENT_BYTES = 60_000`. Blobs carry un-truncatable state, so `renderCommentFromStored` reserves blob room first and caps the visible body to what's left (`src/output/pr-comment.ts:642`). If all full blobs together exceed `MAX_BLOB_BYTES = 40_000`, `encodeJobBlobs` falls back to `summaryOnlyJob` blobs (row + rollup fields only, heavy detail arrays dropped).

## 3. Check run / annotations — `src/output/check-run.ts`

`createCheckRun` (`src/output/check-run.ts:27`) calls `octokit.rest.checks.create` with `status: 'completed'`.

- **head SHA:** `pull_request.head.sha` if present, else `github.context.sha`.
- **conclusion:** `'failure'` when `summary.failed > 0 || summary.errored > 0`, else `'success'` (`src/output/check-run.ts:38`).
- **annotations:** one per failed/errored test, hard-capped at `MAX_ANNOTATIONS = 50`.
- **`annotation_level`:** from the `annotation-level` input, default `'failure'` (also accepts `warning`, `notice`).
- **403 handling:** warns that `checks: write` permission is required and suggests the `workflow_run` pattern for forked PRs (`src/output/check-run.ts:90`).

**Location resolution** — `resolveLocation` (`src/output/check-run.ts:9`), in order:

1. `test.file` → `normalizePath(test.file)` at `test.line ?? 1`.
2. else parse `test.stackTrace` via `parseFileLocation` (`src/utils/parse-stack-trace.ts:65`).
3. else, if a `reportFile` fallback was passed, annotate that file at line 1. `index.ts` passes `successful[0].filePath` as this fallback. A test with no location and no `reportFile` is skipped.

## 4. HTML report + artifact — `src/output/html-report.ts` + `upload-artifact.ts`

`generateHtmlReport(options)` (`src/output/html-report.ts:77`) returns one self-contained HTML string (inlined `CSS` constant, no external assets). Sections mirror the summary: header (metrics strip + progress bar + health-score tooltip), highlights, trends, delta, tests-changed, flaky, perf-regressions, suite breakdown (**only when `suites.length > 1`**, `src/output/html-report.ts:127`), failed tests, slowest tests. Row caps match the summary (failed 25, delta 10, tests-changed 20, flaky 15, perf 15).

`uploadArtifact(html, artifactName)` (`src/output/upload-artifact.ts:8`):

- writes HTML to a temp file `testglance-report-<pid>-<uuid>.html` in `tmpdir()`, uploads it with `@actions/artifact` `DefaultArtifactClient.uploadArtifact`, then unlinks the temp file (best-effort).
- returns `boolean` success.

**`artifactName`** comes from the `artifact-name` input (default `testglance-report`, `src/index.ts:164`). **`artifactUrl`** is `${runUrl}#artifacts` — set only on successful upload (`src/index.ts:413`) — and is threaded into the summary's download link and the PR comment's `Report` link.

## Shared helpers — `src/output/format.ts`

Pure formatters, used by all channels:

| Helper                                                      | Behavior                                                |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| `escapeHtml` (`format.ts:1`)                                | escapes `& < > " '`                                     |
| `formatDuration` (`format.ts:10`)                           | `<1s` → `Nms`; `<60s` → `N.Ns`; else `Nm N.Ns`          |
| `formatDurationPair` (`format.ts:18`)                       | formats two durations on a shared scale                 |
| `truncate` (`format.ts:25`)                                 | clips to `maxLen` with `...` suffix                     |
| `renderProgressBar` (`format.ts:30`)                        | `█`/`░` bar, default width 16                           |
| `renderMetricsStrip` (`format.ts:41`)                       | `✅ N passed · ❌ N failed · …` (omits zero categories) |
| `compareSuitesByHealth` (`format.ts:105`)                   | sort: lowest pass-rate / most failures first            |
| `renderHealthScoreDetails` / `renderHealthScoreTooltipHtml` | the "how is this scored?" explainer (Markdown / HTML)   |

## Custom templates — `src/output/template-renderer.ts`

Both the summary and PR comment support a user-supplied Handlebars template (`summary-template` / `comment-template` inputs). Shared machinery:

- `buildTemplateContext` (`src/output/template-renderer.ts:197`) assembles `TemplateContext` — `results`, `failures`, `slowest` (default limit `DEFAULT_SLOWEST_LIMIT = 10`), `suites`, `history`, `delta`, `flaky`, `trends`, `perfRegression`, and `meta` (commit/branch/run-url/timestamp/job).
- Registered helpers: `formatDuration`, `truncate`, `escapeHtml`, `passRate`, `limit` (`src/output/template-renderer.ts:112`).
- `renderTemplate` (`src/output/template-renderer.ts:362`) resolves + validates the path, compiles (mtime/size-keyed cache), and renders. Returns `null` on any failure so callers fall back to the default render.
- **Security:** `resolveAndValidate` (`src/output/template-renderer.ts:253`) rejects newlines in the path, requires `GITHUB_WORKSPACE`, refuses paths resolving (via `realpathSync`) outside the workspace, non-regular-files, and files over `MAX_TEMPLATE_FILE_BYTES = 1 MiB`. Render runs with `allowProtoPropertiesByDefault: false` / `allowProtoMethodsByDefault: false`. See [security](./security.md).

## Byte / row limits (quick reference)

| Limit                         | Value                   | Where                        |
| ----------------------------- | ----------------------- | ---------------------------- |
| Summary (custom template)     | 900_000 B               | `MAX_RENDERED_SUMMARY_BYTES` |
| Summary "All Tests" body      | 400_000 B               | `MAX_ALL_TESTS_BYTES`        |
| Summary failed-tests shown    | 25                      | `MAX_FAILED_TESTS_SHOWN`     |
| show-all-tests auto threshold | 200 (1000 single-suite) | `AUTO_ALL_TESTS_*`           |
| PR comment visible body       | 60_000 B                | `MAX_RENDERED_COMMENT_BYTES` |
| PR comment blob section       | 40_000 B                | `MAX_BLOB_BYTES`             |
| Check-run annotations         | 50                      | `MAX_ANNOTATIONS`            |
| Stack-trace lines             | 30                      | `MAX_STACK_TRACE_LINES`      |
| Error message length          | 200                     | `MAX_ERROR_MESSAGE_LENGTH`   |
| Custom template file          | 1 MiB                   | `MAX_TEMPLATE_FILE_BYTES`    |

Counts in every channel are derived from the parsed `<testcase>`/test elements (via `summary` and per-suite `tests`), never from suite-level XML count attributes. See [parsers](./parsers.md).
