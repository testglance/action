# Data Model & Contracts

**Purpose:** The normalized in-memory shapes and the API payload envelope that all parsers and outputs share.
**Read this when:** You are changing a type, adding a field, or need to know the exact contract between parser, history, API, and outputs.

All core types live in `src/types.ts`. History types live in `src/history/types.ts`. Both files are pure type declarations — no runtime code. Changing a field here ripples to every parser, output, and the API; treat it as the cross-module contract.

## ParsedTestRun

The normalized output of every parser (`parseJunitXml`, `parseCtrfJson`) and of `mergeTestRuns`. Defined at `src/types.ts:1`.

| field       | type            | notes                                                 |
| ----------- | --------------- | ----------------------------------------------------- |
| `summary`   | object (below)  | recounted totals, never trusted from suite attributes |
| `suites`    | `ParsedSuite[]` | one per test suite                                    |
| `toolName?` | `string`        | provenance hint (see below)                           |

`summary` object (`src/types.ts:2`):

| field      | type     | invariant                                    |
| ---------- | -------- | -------------------------------------------- |
| `total`    | `number` | equals `passed + failed + skipped + errored` |
| `passed`   | `number` | recounted from test cases                    |
| `failed`   | `number` | recounted from test cases                    |
| `skipped`  | `number` | recounted from test cases                    |
| `errored`  | `number` | recounted from test cases                    |
| `duration` | `number` | **seconds**, total run duration              |

**Counts are recounted, never trusted.** JUnit recounts by filtering `allTests` per status at `src/parsers/junit.ts:148`; `mergeTestRuns` re-accumulates across files at `src/utils/merge-results.ts:42`. Suite-level `tests`/`failures`/`errors` XML attributes are ignored. See [parsers](./parsers.md).

## ParsedSuite

Defined at `src/types.ts:30`.

| field      | type               | notes                    |
| ---------- | ------------------ | ------------------------ |
| `name`     | `string`           | suite display name       |
| `tests`    | `ParsedTestCase[]` | test cases in this suite |
| `duration` | `number`           | **seconds**              |

## ParsedTestCase

Defined at `src/types.ts:36`. Optional fields are present only when the source report supplies them.

| field           | type                                             | notes                                           |
| --------------- | ------------------------------------------------ | ----------------------------------------------- |
| `name`          | `string`                                         | test case name                                  |
| `suite`         | `string`                                         | owning suite name (denormalized onto each case) |
| `status`        | `'passed' \| 'failed' \| 'skipped' \| 'errored'` | the only legal status set                       |
| `duration`      | `number`                                         | **seconds**                                     |
| `errorMessage?` | `string`                                         | failure/error message                           |
| `errorType?`    | `string`                                         | exception/error type                            |
| `stackTrace?`   | `string`                                         | raw stack trace                                 |
| `file?`         | `string`                                         | source file path                                |
| `line?`         | `number`                                         | source line                                     |

### Status mapping

`status` is a closed union of four values. JUnit derives it in `resolveStatus` (`src/parsers/junit.ts:21`): `<error>` → `errored`, `<failure>` → `failed`, `<skipped>` → `skipped`, otherwise `passed`. CTRF maps its own status strings via `STATUS_MAP` (`src/parsers/ctrf.ts:33`), defaulting unknown values to `errored`. Any output or history code that switches on status must handle all four — including `errored`, which is distinct from `failed`.

## Unit convention: durations are seconds

Every `duration` in these types is **seconds**. Parsers normalize at the boundary:

- **JUnit** XML `time` attributes are already seconds — used as-is (`parseFloat(tc['@_time'])` at `src/parsers/junit.ts:70`).
- **CTRF** reports durations in **milliseconds**; the parser divides by 1000 on the way in: per-test `(test.duration ?? 0) / 1000` (`src/parsers/ctrf.ts:86`) and run total `(summary.stop - summary.start) / 1000` (`src/parsers/ctrf.ts:124`).

If you add a new parser or touch CTRF, convert to seconds at parse time. Downstream code (summary, history, API) assumes seconds everywhere.

## Provenance: toolName and framework

Two distinct provenance fields — do not conflate them:

- **`toolName`** (on `ParsedTestRun`) — set by the CTRF parser from `results.tool.name` (`src/parsers/ctrf.ts:80`). JUnit does not set it. Used as a fallback suite name and as input to framework detection.
- **`framework`** (on `MetaEnvelope`, payload only) — derived in `detectFramework` (`src/utils/detect-framework.ts:8`). For CTRF it returns `toolName`; otherwise it path-matches heuristics (vitest/jest/pytest/maven-surefire) against the report path. Returns `undefined` when nothing matches, and is then omitted from `meta`.

## API envelope

What gets POSTed to `POST {apiUrl}/api/v1/runs` (only when an `api-key` is present; no key → local-only mode, no submission). Assembled by `buildPayload` (`src/api/client.ts:39`) and sent by `sendTestRun` (`src/api/client.ts:70`). See [api-client](./api-client.md).

### MetaEnvelope (`src/types.ts:14`)

| field          | type     | source                                       |
| -------------- | -------- | -------------------------------------------- |
| `workflow`     | `string` | `process.env.GITHUB_WORKFLOW`                |
| `job`          | `string` | `process.env.GITHUB_JOB`                     |
| `framework?`   | `string` | `detectFramework(...)`; omitted if undefined |
| `testJobName?` | `string` | from action input; omitted if unset          |

### ApiPayload (`src/types.ts:21`)

```
{
  meta: MetaEnvelope,
  results: ParsedTestRun & {
    repository: { name: string; id: number };
    git: { sha: string; branch: string };
    ciRunId: string;
  }
}
```

`results` is the full `ParsedTestRun` (summary + suites + toolName) spread, plus CI context injected from the environment in `buildPayload`:

| field             | source                                             |
| ----------------- | -------------------------------------------------- |
| `repository.name` | `GITHUB_REPOSITORY`                                |
| `repository.id`   | `Number(GITHUB_REPOSITORY_ID)` (falls back to `0`) |
| `git.sha`         | `GITHUB_SHA`                                       |
| `git.branch`      | `GITHUB_REF_NAME`                                  |
| `ciRunId`         | `GITHUB_RUN_ID`                                    |

Missing env vars resolve to `''` (or `0` for the numeric id), never throw — consistent with the never-fail mandate. The API response body (`runId`, `healthScore`, `highlights`, `projectId`, `projectCreated`) is parsed into `SendResult` (`src/api/client.ts:23`).

## Highlight types

Returned by the API in the success response and surfaced in outputs. Defined at `src/types.ts:48`.

- **`HighlightType`** — `'new_failures' | 'fixed_tests' | 'new_tests' | 'duration_delta' | 'known_flaky' | 'health_score_delta'`.
- **`HighlightSeverity`** — `'info' | 'warning' | 'critical'`.
- **`Highlight`** (`src/types.ts:58`):

| field      | type                      |
| ---------- | ------------------------- |
| `type`     | `HighlightType`           |
| `severity` | `HighlightSeverity`       |
| `message`  | `string`                  |
| `data`     | `Record<string, unknown>` |

## History types

Local, file-backed run history powering offline analytics (flaky detection, perf regression, deltas, trends). Defined in `src/history/types.ts`. Full semantics in [history-analytics](./history-analytics.md).

- **`HistoryTestEntry`** (`src/history/types.ts:1`) — `name`, `suite`, `status` (same four-value union), `duration` (seconds). A leaner per-test record than `ParsedTestCase` (no error/source fields).
- **`HistoryEntry`** (`src/history/types.ts:8`) — one stored run: `timestamp` (string), `commitSha`, a `summary` block identical in shape to `ParsedTestRun.summary`, and `tests: HistoryTestEntry[]`.
- **`HistoryFile`** (`src/history/types.ts:22`) — `version: 1` (literal), `branch`, `entries: HistoryEntry[]`. The `version` literal gates the on-disk schema; bump it if you change the file format.
- **`HistoryStorage`** (`src/history/types.ts:28`) — the storage port:

```
load(): Promise<HistoryFile | null>
save(history: HistoryFile): Promise<void>
clear(): Promise<void>
```

Analytics result types (`TestsChangedReport`, `FlakyDetectionResult`, `PerfRegressionResult`, `DeltaComparison`, `TrendIndicators`, and their item types) also live in `src/history/types.ts:34`+ — see [history-analytics](./history-analytics.md) for how they are computed and consumed.

## Changing a type

- Adding an optional field to `ParsedTestCase` / `ParsedSuite` is backward-safe; parsers that don't set it leave it `undefined`.
- Adding a `summary` count field requires updating **both** recount sites (`src/parsers/junit.ts:148`, `src/utils/merge-results.ts:42`) and the `HistoryEntry.summary` block.
- Changing a `status` value is breaking: update the unions in `src/types.ts` and `src/history/types.ts`, both parsers, and every output switch.
- Changing the payload shape must be coordinated with the SaaS API; bump `HistoryFile.version` only for on-disk format changes.

See also: [architecture](./architecture.md), [conventions](./conventions.md), [known-issues](./known-issues.md).
