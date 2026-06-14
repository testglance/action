# History & Analytics

**Purpose:** The run-history subsystem (storage + manager) and the analytics derived from it — delta, flaky detection, perf regression, and trends.
**Read this when:** You are touching history storage, the cache-key scheme, or any analytic (flaky / perf / trends / delta / cross-branch).

History tracking is enabled by default (`history` input, gated by `historyEnabled` in `src/index.ts:167`, `default: 'true'` in `action.yml`). It runs even in local-only mode — it never touches the TestGlance API. All analytics are best-effort and never block CI; see the [wart below](#wart-silent-analytics-failures).

## Module map

| File                                   | Role                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/history/types.ts`                 | All history & analytic interfaces (`HistoryFile`, `HistoryEntry`, `HistoryStorage`, result types) |
| `src/history/manager.ts`               | `HistoryManager` — load / append / save / trim                                                    |
| `src/history/actions-cache-storage.ts` | `ActionsCacheStorage` — `@actions/cache`-backed `HistoryStorage`                                  |
| `src/history/comparison.ts`            | `computeDelta` + `computeTestsChanged` (run-over-run diff)                                        |
| `src/history/flaky-detection.ts`       | `detectFlakyTests`                                                                                |
| `src/history/perf-regression.ts`       | `detectPerfRegressions`                                                                           |
| `src/history/trends.ts`                | `computeTrends` + `buildSparkline`                                                                |

Orchestration lives in `src/index.ts:226`–`354`.

## Data model (`src/history/types.ts`)

- `HistoryFile` (`types.ts:22`): `{ version: 1, branch, entries: HistoryEntry[] }`.
- `HistoryEntry` (`types.ts:8`): `timestamp`, `commitSha`, `summary` (total/passed/failed/skipped/errored/duration), and `tests: HistoryTestEntry[]`.
- `HistoryTestEntry` (`types.ts:1`): `name`, `suite`, `status` (`passed|failed|skipped|errored`), `duration`.
- `HistoryStorage` (`types.ts:28`): `load()`, `save(history)`, `clear()`.

`appendRun` flattens every suite's tests into the entry-level `tests` array (`manager.ts:51`). `enforceSizeLimit` may later wipe these arrays (see below), so analytics must tolerate `tests.length === 0`.

## Storage — `ActionsCacheStorage`

Implements `HistoryStorage` over `@actions/cache`. One `history.json` file per branch + report-path.

**Cache-key scheme** (`actions-cache-storage.ts:17`-`27`):

```
cacheKey   = testglance-history-<branch>-<reportPathHash><suffix>   // suffix = "-<runId>" if runId given, else ""
restoreKeys = [ testglance-history-<branch>-<reportPathHash>-,
                testglance-history-<branch>- ]
```

- `reportPathHash` = first 8 hex chars of `sha256(reportPath || 'auto')`, computed in `src/index.ts:237`.
- The per-run `suffix` makes each run's save key unique, so the same run never clashes; `restoreKeys` are prefix fallbacks so a run restores the most recent matching cache (Actions Cache restore is prefix-matched). This is the standard "save under a unique key, restore by prefix" pattern.
- Temp file: `<os.tmpdir()>/testglance-history-<branch>-<reportPathHash>/history.json` (`actions-cache-storage.ts:24`-`26`). The dir is `mkdir -p`'d in the constructor.

**`load()`** (`actions-cache-storage.ts:29`): `restoreCache` → on miss or missing-file-on-disk returns `null` (`core.debug`). Any thrown error is caught, `core.warning`'d, and returns `null`.

**`save()`** (`actions-cache-storage.ts:61`): writes JSON then `saveCache`. A `ReserveCacheError` (key already exists — concurrent run won the race) is swallowed at `core.debug` and treated as success (`actions-cache-storage.ts:69`). Other errors → `core.warning`.

**`clear()`** is a no-op (`actions-cache-storage.ts:79`) — entries expire via the Actions Cache LRU.

## `HistoryManager` (`manager.ts:13`)

Constructed with a `HistoryStorage` and `historyLimit`. Typical lifecycle in `src/index.ts:244`-`260`: `new` → `loadHistory()` → `appendRun()` → `saveHistory()` → `getHistory()`.

- `loadHistory()` (`manager.ts:22`): delegates to `storage.load()`. On throw: `core.warning`, sets `loadError = true`, returns `null`.
- `isFirstRun()` (`manager.ts:35`): `!loadError && history === null` — distinguishes a genuine first run from a load failure.
- `appendRun(run, meta)` (`manager.ts:39`): builds the entry, lazily creates the `HistoryFile`, pushes, then trims to `historyLimit` (`shift()` oldest, `manager.ts:72`), then `enforceSizeLimit()`.
- `saveHistory()` (`manager.ts:80`): no-op + `core.debug` when nothing to save; otherwise `storage.save()`, errors → `core.warning`.

**`enforceSizeLimit()`** (`manager.ts:97`) — `SIZE_LIMIT = 4 MiB` (`manager.ts:5`):

1. If serialized size ≤ limit, return.
2. Wipe `tests` arrays oldest-first, re-measuring after each, until under limit. **This is why older `HistoryEntry`s often have `tests: []`** — delta/flaky/perf all special-case empty test arrays.
3. If still over after wiping all test arrays, `shift()` oldest entries (keeping at least 1).

`historyLimit` comes from the `history-limit` input (default `20`, floored to `1`; parsed at `src/index.ts:168`-`175`).

## Delta — `comparison.ts`

`buildTestKey(suite, name)` → `` `${suite}::${name}` `` (`comparison.ts:9`). This is the join key used by **every** analytic; status-flip/perf grouping all depend on stable `suite`+`name`.

**`computeDelta(previous, current)`** (`comparison.ts:164`) → `DeltaComparison` (`types.ts:103`): `testsAdded`, `testsRemoved`, `newlyFailing`, `newlyPassing` (each `DeltaTestInfo[]` = `{name, suite}`), plus `passRatePrev/Curr/Delta`, `durationPrev/Curr/Delta`, `durationDeltaPercent`, `hasChanges`.

- Test-level diffs run **only when both entries have non-empty `tests`** (`comparison.ts:187`). If `previous.tests` was trimmed to `[]`, only the summary-level pass-rate/duration deltas are produced.
- Diffing is multiset-based per key: unchanged status counts are cancelled first, then remaining prev-passing→curr-failing become `newlyFailing` (errored counts as failing), and net count changes become added/removed.
- `metricsChanged` uses an `EPSILON = 1e-9` guard so float noise doesn't flip `hasChanges` (`comparison.ts:238`).

**`computeTestsChanged(previous, current)`** (`comparison.ts:61`) → `TestsChangedReport` (`types.ts:42`): `newTests`, `removedTests`, `statusChanged` (each `TestsChangedEntry[]`, carrying full status + `previousStatus`), `hasChanges`. Returns the empty report if either side has no test data (`comparison.ts:72`).

**Wiring** (`src/index.ts:262`): both run only when `loadedHistory.entries.length >= 2`, comparing the last two entries.

## Flaky detection — `flaky-detection.ts`

`detectFlakyTests(entries, threshold = 2, windowSize = 10)` (`flaky-detection.ts:6`) → `FlakyDetectionResult` (`types.ts:57`).

- Operates on the last `windowSize` entries (`slice(-windowSize)`, `flaky-detection.ts:11`). Tracks each test key's per-run status, padding `null` for runs where the test was absent.
- For each test, builds `relevant` statuses ignoring `null` and `skipped` (`flaky-detection.ts:44`); needs `relevant.length >= 2`.
- Counts **status flips** between adjacent runs (passing↔failing; `errored` counts as failing). A test is flaky when `flipCount >= threshold` (`flaky-detection.ts:62`).
- `flakyRate = flipCount / (relevant.length - 1) * 100`. Results sorted by `flakyRate` then `flipCount` desc.
- `threshold` default `2` comes from the `flaky-threshold` input (`DEFAULT_FLAKY_THRESHOLD = 2` at `src/index.ts:36`; parser `parseFlakyThreshold` at `src/index.ts:79`).

**Gate** (`src/index.ts:292`): only runs when `entries.length >= 5`; below that, `core.debug('Need at least 5 runs for flaky detection')`.

## Perf regression — `perf-regression.ts`

`detectPerfRegressions(entries, threshold = 200)` (`perf-regression.ts:12`) → `PerfRegressionResult` (`types.ts:70`): `regressions`, `hasRegressions`, `sparkline`.

- Baseline = all entries except the last; current = last entry.
- Per test key, collects baseline `duration`s (`>0` only). A current test regresses when its duration exceeds the **median** baseline by more than `threshold` percent (`perf-regression.ts:49`).
- **Requires `>= 3` baseline durations per test** (`previousDurations.length < 3` → skip, `perf-regression.ts:43`). So meaningful detection needs 4 total runs (3 baseline + current).
- `increasePercent = (current - median) / median * 100`. Sorted desc. Zero-duration tests/medians are skipped.
- `threshold` default `200` (= 3× slower) from `perf-threshold` input (`DEFAULT_PERF_THRESHOLD = 200` at `src/index.ts:37`; `parsePerfThreshold` at `src/index.ts:103`).
- `sparkline` = `buildDurationSparkline(entries)` (`perf-regression.ts:69`) over each entry's `summary.duration` (delegates to `buildSparkline`).

**Gate** (`src/index.ts:304`): runs when `entries.length >= 3` (so it can build sparkline + warm baseline), but with `< 4` entries `core.debug`s that it's still "collecting baseline data" — no regressions can fire yet.

## Trends — `trends.ts`

`computeTrends(entries)` (`trends.ts:33`) → `TrendIndicators` (`types.ts:83`): `passRate`, `duration`, `testCount` blocks.

- Compares the current entry against the **average** of all previous entries (pass rate and duration). `testCount.delta` compares only against the immediately previous entry (`trends.ts:53`).
- `classifyDirection(delta, threshold)` (`trends.ts:27`) → `up | down | stable`. Thresholds: `PASS_RATE_THRESHOLD = 1.0` (points), `DURATION_THRESHOLD = 5.0` (percent) — `trends.ts:4`-`5`.
- **Sparklines** (`buildSparkline`, `trends.ts:8`): 8-level block chars `▁▂▃▄▅▆▇█`. Only emitted when `entries.length >= MIN_SPARKLINE_ENTRIES` (`= 5`, `trends.ts:6`); otherwise empty string (`trends.ts:65`, `trends.ts:72`). All-equal values render as the mid char.

**Gate** (`src/index.ts:323`): runs when `entries.length >= 3` (but sparklines stay empty until 5 entries).

## Cross-branch comparison (base-branch delta)

On PRs, the action loads the **base branch's** history with a separate `ActionsCacheStorage` and diffs head-vs-base latest entries (`src/index.ts:331`-`354`).

- `baseBranch` = `process.env.GITHUB_BASE_REF` (stripped of `refs/heads/`). Empty for non-PR events.
- A fresh `ActionsCacheStorage(baseBranch, reportPathHash)` is built **without a `runId`** (`src/index.ts:340`) — so its `cacheKey` has no run suffix and it restores the base branch's existing history rather than reserving a new key.
- Same `reportPathHash` as the head run, so head and base align on the same report path.
- `baseDelta = computeDelta(baseLatest, currentEntry)` (`src/index.ts:347`), only when base history has `entries.length > 0`.
- Surfaced to output as `baseDelta` / `baseBranch` (`src/index.ts:498`-`499`). See [output](./output.md).

## <a id="wart-silent-analytics-failures"></a>Wart — silent analytics failures

The top-level history block logs failures at `core.warning` (`src/index.ts:284`), but the **inner analytic try/catches log at `core.debug`** and then leave the result `null`:

- delta / testsChanged (`src/index.ts:267`, `:278`)
- flaky (`src/index.ts:296`), perf (`src/index.ts:313`), trends (`src/index.ts:327`), base-branch (`src/index.ts:350`)

`core.debug` only shows when `ACTIONS_STEP_DEBUG=true`, so a thrown analytic silently produces no output and no warning. When an analytic "didn't show up", suspect a swallowed `debug`. Tracked in [known-issues](./known-issues.md).

## Cross-links

- [data-model](./data-model.md) — `ParsedTestRun` that feeds `appendRun`.
- [output](./output.md) — how delta/flaky/perf/trends render in the summary and PR comment.
- [inputs-reference](./inputs-reference.md) — `history`, `history-limit`, `flaky-threshold`, `perf-threshold`.
- [architecture](./architecture.md) — where history sits in the `run()` pipeline.
- [known-issues](./known-issues.md) — the silent-`core.debug` analytics wart.
