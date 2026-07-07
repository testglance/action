# Action Inputs Reference

**Purpose:** Catalog of every `action.yml` input — its default, meaning, and how it is parsed/validated in code.
**Read this when:** You are adding/changing an input, or need to know an exact default or accepted value.

All inputs are read at the top of `run()` in `src/index.ts:140`. The full input set lives in `action.yml:4` (`inputs:`). None are `required`. Defaults below are copied verbatim from `action.yml`.

## Inputs

| Input               | Default (`action.yml`)         | Accepted values                                  | What it does                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-path`       | `''`                           | path / glob (e.g. `**/test-results/*.xml`)       | Report file(s) to parse. Empty → auto-detect mode (`src/index.ts:179`, `src/index.ts:186`).                                                                                                                                                                           |
| `api-key`           | `''`                           | string                                           | TestGlance project API key. Empty → `localOnly` mode, no API submission (`src/index.ts:143`). Reserved/inactive per description.                                                                                                                                      |
| `api-url`           | `'https://www.testglance.dev'` | URL                                              | API base for run submission. Falls back to same default if blank (`src/index.ts:150`).                                                                                                                                                                                |
| `report-format`     | `'auto'`                       | `junit`, `ctrf`, `auto`                          | Forces parser, or auto-detect from extension. Falls back to `auto` if blank (`src/index.ts:151`). See [parsers](./parsers.md).                                                                                                                                        |
| `test-job-name`     | `''`                           | string                                           | Display name for this job in summary/comment/API. Empty → falls back to `GITHUB_JOB` then `'tests'` (`src/index.ts:425`).                                                                                                                                             |
| `slowest-tests`     | `'10'`                         | non-negative integer (`0` disables)              | Count of slowest tests shown in summary. Parsed by `parseSlowestTestsCount` (`src/index.ts:159`).                                                                                                                                                                     |
| `show-all-tests`    | `'auto'`                       | `auto`, `true`, `false`                          | List every test under each suite. `auto` shows when small enough (≤200 tests, or ≤1000 with a single suite). Parsed by `parseShowAllTests` (`src/index.ts:160`).                                                                                                      |
| `send-results`      | `'true'`                       | `true` / `false`                                 | Submit parsed results to API. Forced `false` in `localOnly` mode (`src/index.ts:154`).                                                                                                                                                                                |
| `github-token`      | _(none)_                       | token / PAT                                      | Enables PR comments and inline annotations. Falls back to `process.env.GITHUB_TOKEN` (`src/index.ts:153`).                                                                                                                                                            |
| `annotate-failures` | `'false'`                      | `true` / `false`                                 | Annotate failed tests inline via a GitHub Check Run. Requires `github-token` (`src/index.ts:462`).                                                                                                                                                                    |
| `create-check`      | `'false'`                      | `true` / `false`                                 | **Deprecated** alias for `annotate-failures` (`deprecationMessage` in `action.yml:48`). Either set to `true` enables annotations (`src/index.ts:155`).                                                                                                                |
| `check-name`        | `'Test Results'`               | string                                           | Name of the Check Run created by `annotate-failures`. Blank → default (`src/index.ts:157`).                                                                                                                                                                           |
| `annotation-level`  | `'failure'`                    | `failure`, `warning`, `notice`                   | Severity of inline annotations. `warning`/`notice` keep the check advisory. Parsed by `parseAnnotationLevel` (`src/index.ts:158`).                                                                                                                                    |
| `flaky-threshold`   | `'2'`                          | positive integer                                 | Minimum status flips (last 10 runs) to flag a test flaky. Parsed by `parseFlakyThreshold` (`src/index.ts:161`).                                                                                                                                                       |
| `perf-threshold`    | `'200'`                        | non-negative integer (% over median; `200` = 3x) | Duration increase over median to flag a perf regression. Parsed by `parsePerfThreshold` (`src/index.ts:162`).                                                                                                                                                         |
| `history`           | `'true'`                       | `true` / `false`                                 | Enable run-history tracking via Actions Cache. Disabled only when set exactly to `'false'` (`src/index.ts:167`).                                                                                                                                                      |
| `history-limit`     | `'20'`                         | positive integer                                 | Max runs kept in history. Parsed inline (`src/index.ts:168`).                                                                                                                                                                                                         |
| `compare-branch`    | `''`                           | branch name                                      | On `pull_request` builds, baseline the trend line / trend blocks **and** the "vs base" comparison against this branch (e.g. `main`). Blank → the PR base branch (`GITHUB_BASE_REF`). Ignored on push builds and for self-compare. Parsed inline (`src/index.ts:176`). |
| `html-report`       | `'true'`                       | `true` / `false`                                 | Generate self-contained HTML report and upload as artifact. Enabled only when exactly `'true'` (`src/index.ts:163`).                                                                                                                                                  |
| `artifact-name`     | `'testglance-report'`          | string                                           | Name of the uploaded HTML artifact. Blank → default (`src/index.ts:164`).                                                                                                                                                                                             |
| `summary-template`  | `''`                           | path (relative to `GITHUB_WORKSPACE`)            | Handlebars template overriding default CI summary (`src/index.ts:165`).                                                                                                                                                                                               |
| `comment-template`  | `''`                           | path (relative to `GITHUB_WORKSPACE`)            | Handlebars template overriding default PR comment body (`src/index.ts:166`).                                                                                                                                                                                          |

See [inputs → features map](./output.md) and [history-analytics](./history-analytics.md) for downstream behavior.

## Parsing & validation helpers

All live at the top of `src/index.ts`. Module-level defaults: `DEFAULT_SLOWEST_TESTS = 10`, `DEFAULT_FLAKY_THRESHOLD = 2`, `DEFAULT_PERF_THRESHOLD = 200` (`src/index.ts:35`).

Every helper degrades to a default on invalid input via `core.warning` — never throws, never fails CI (see [known-issues](./known-issues.md) for the always-exit-0 contract).

| Helper                          | Location                     | Return type                          | Invalid/empty → fallback                                                                                       |
| ------------------------------- | ---------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `parseShowAllTests(input)`      | `src/index.ts:39`            | `'auto' \| boolean`                  | `''`/`'auto'` → `'auto'`; `'true'`→`true`; `'false'`→`false`; else warn + `'auto'`. Case-insensitive, trimmed. |
| `parseAnnotationLevel(input)`   | `src/index.ts:50` (exported) | `'failure' \| 'warning' \| 'notice'` | Matches one of the three (case-insensitive). Non-empty invalid → warn; empty silent; both → `'failure'`.       |
| `parseSlowestTestsCount(input)` | `src/index.ts:63`            | `number`                             | Empty → `10`. Non-`/^\d+$/` → warn + `10`. Else `parseInt`. (`0` is valid and disables.)                       |
| `parseFlakyThreshold(input)`    | `src/index.ts:79`            | `number`                             | Empty → `2`. Non-digit OR parsed `< 1` → warn + `2`.                                                           |
| `parsePerfThreshold(input)`     | `src/index.ts:103`           | `number`                             | Empty → `200`. Non-`/^\d+$/` → warn + `200`. (`0` accepted.)                                                   |

`history-limit` has no named helper — it is parsed inline at `src/index.ts:168`: `parseInt`, then if `isNaN` or the raw string doesn't round-trip (`historyLimitRaw !== String(historyLimitParsed)`) it warns; final value is `Math.max(1, historyLimitParsed || 20)` (`src/index.ts:175`).

## `localOnly` derivation

`localOnly = !apiKey` (`src/index.ts:144`). With no `api-key`:

- An info banner is logged (`src/index.ts:145`).
- `sendResults` is forced `false` regardless of the `send-results` input (`src/index.ts:154`).
- Summary, HTML report, PR comment, and check run still run. PR comment posts when `githubToken && (result?.success || localOnly)` (`src/index.ts:478`).

`send-results` outside local-only: enabled unless the input is exactly the string `'false'` (`src/index.ts:154`).

## Required permissions per feature

These are caller-side workflow `permissions:` — link [security](./security.md) for the full matrix.

| Feature            | Input                                        | Permission needed                            |
| ------------------ | -------------------------------------------- | -------------------------------------------- |
| PR comments        | `github-token` set                           | `pull-requests: write`                       |
| Inline annotations | `annotate-failures: true` (+ `github-token`) | `checks: write`                              |
| Run history        | `history: true`                              | Actions Cache (default `actions` read/write) |

If `annotate-failures` is on but `github-token` is missing, annotations are skipped with a warning (`src/index.ts:474`).

## Adding a new input

End-to-end wiring (declare in `action.yml`, read+parse in `run()`, thread to the consuming module, test) is covered in [agent-playbook](./agent-playbook.md). Keep the parse helper next to the existing `parse*` functions at the top of `src/index.ts`, follow the warn-and-default pattern, and never let an invalid input throw.
