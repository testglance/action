# Observability & Error Handling

**Purpose:** The "never break CI" philosophy and exactly how the action logs and degrades.
**Read this when:** You are adding logging, handling a new error path, or deciding what log level to use.

## Core principle: never break CI

The action is non-blocking by design (product req FR5). It MUST NOT fail the consumer's
workflow no matter what goes wrong — bad input, unparseable reports, a down API, an
unexpected crash. Two rules enforce this:

1. **Never call `core.setFailed()`.** It is not used anywhere in `src/` (only asserted-absent in tests). There is no code path that sets a failing exit code.
2. **Always exit 0 / return gracefully.** `run()` wraps its entire body in one top-level try/catch. The catch funnels any escaped error into `handleUnexpectedError` and returns `{ history: null }` — see `src/index.ts:523`-`src/index.ts:526`.

`run()` returns a `RunResult`, never throws. `run()` is invoked unguarded at module load
(`src/index.ts:529`); the internal try/catch is what keeps that call from ever rejecting.

## Log levels

No external telemetry, metrics, or tracing. The only data that leaves the runner is the
normalized results JSON POSTed to the API (see [api-client](./api-client.md)) — and only
when an `api-key` is set. Everything else is GitHub Actions log output via `@actions/core`.

| Level          | Used for                                                          | Examples                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.info`    | success + progress, always visible                                | parse summary `src/index.ts:222`; local-only notice `src/index.ts:146`; submit success `src/index.ts:373`; first-run notice `src/index.ts:250`                                                                                                                                                                                                                                     |
| `core.warning` | ALL user-facing errors + invalid inputs + analytics-step failures | every handler in `errors.ts`; invalid-input fallbacks (e.g. `src/index.ts:44`); per-file parse failure `src/index.ts:209`; "all files failed" `src/index.ts:216`; output-step failures (summary, PR comment, HTML); analytics failures (delta, tests-changed, flaky, perf, trends, base-branch) each `… section skipped`; cache-hit-but-missing-file in `actions-cache-storage.ts` |
| `core.debug`   | verbose tracing + "not enough runs yet" notes                     | "need 5 runs for flaky detection"; "perf baseline collecting"; "need 3 runs for perf"; cache miss / load-save success traces in `actions-cache-storage.ts`                                                                                                                                                                                                                         |

- **No `core.notice`** anywhere. `core.error` is used in exactly **one** place: when the `check-name` check run fails to post after retries (`src/output/check-run.ts`). This is deliberate — a _required_ check run that silently never posts blocks the PR forever, so that specific failure escalates from `warning` to a red `error` annotation (plus a job-summary note). It still **never** fails the step (no `setFailed`, exit 0). Everywhere else, user-facing failures use `core.warning`.
- `core.debug` output is **only visible when the consumer enables step debug logging** (the `ACTIONS_STEP_DEBUG` secret / runner debug). On a normal run it is invisible.

### Picking a level for new code

- Did something the user asked for succeed, or are you reporting normal progress? → `core.info`.
- Did a feature the user can see (summary, PR comment, check run, submission, parsing, an input) fail or get skipped? → `core.warning`. The user should be able to notice and fix it. (Sole exception: a `check-name` check run that fails to post after retries uses `core.error` — see above — because a missing _required_ check silently blocks merges.)
- Did an _optional history/analytics_ computation **fail** (throw), dropping a user-visible section? → `core.warning`, naming the section that was skipped (e.g. `… delta section skipped.`). This is data-affecting and must be visible on a normal run.
- Did an analytics step get skipped only because there is **not enough data yet** ("need N runs"), or is it pure verbose tracing? → `core.debug`.

## `errors.ts` handlers

`src/utils/errors.ts` holds the canonical error handlers and the `ParseError` class
(`src/utils/errors.ts:3`). Every handler calls `core.warning` and returns `void` — none
fail the build.

| Handler                           | Line                     | Message gist                                                                  |
| --------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `handleFileNotFound(path)`        | `src/utils/errors.ts:10` | `Test report file not found at {path}.`                                       |
| `handleParseError(format, error)` | `src/utils/errors.ts:14` | `Failed to parse test report as {format}: …`                                  |
| `handleApiUnreachable()`          | `src/utils/errors.ts:18` | `… unreachable. Test data was not submitted. Your CI pipeline is unaffected.` |
| `handleApiError(code, message)`   | `src/utils/errors.ts:24` | `TestGlance API error: {code} - {message}`                                    |
| `handleUnexpectedError(error)`    | `src/utils/errors.ts:28` | `… unexpected error: {message}. Your CI pipeline is unaffected.`              |

Who calls what:

- `handleApiUnreachable` / `handleApiError` — submission branch in `run()` (`src/index.ts:378`, `src/index.ts:380`), keyed off `result.errorCode`.
- `handleUnexpectedError` — the top-level catch (`src/index.ts:524`).
- `handleFileNotFound` / `handleParseError` are **defined but not wired into `run()`** today — `run()` emits its own inline `core.warning` for file-discovery and per-file parse failures (`src/index.ts:183`, `src/index.ts:209`, `src/index.ts:216`). Prefer reusing these handlers if you touch those paths.

## Reassurance pattern

User-facing failure messages that could alarm someone end with an explicit reassurance,
e.g. `Your CI pipeline is unaffected.` (`handleApiUnreachable`, `handleUnexpectedError`).
Keep this convention for any new top-level failure message so a red warning never reads
like a broken build.

## Analytics failures are visible (was wart E)

Analytics computations (delta, tests-changed, flaky, perf-regression, trends, base-branch
delta) are each wrapped in their own try/catch. A **failure** logs at `core.warning` with a
`… section skipped.` clarifier (`src/index.ts` — delta, tests-changed, flaky, perf, trends,
base-branch), and a cache-hit-but-missing-file history loss warns from
`src/history/actions-cache-storage.ts`. The benign "need N runs yet" notices stay at
`core.debug`. So a dropped analytics section is now visible on a normal run. This was
[known-issues](./known-issues.md) E ([#162](https://github.com/testglance/action/issues/162)),
now resolved. If you add a new history/analytics step, follow the same rule: its _failure_
(as opposed to "not enough data yet") is a `core.warning`.

## Testing the no-fail guarantee

The guarantee is enforced by assertions, not just convention. `@actions/core` is mocked and
`setFailed` is asserted never-called:

- `src/__tests__/index.test.ts:354` — `describe('critical: core.setFailed is NEVER called (AC7)')`, covering happy path, no-files, parse error, API-error, and unexpected-exception cases. The empty-`api-key` (local-only) case lives separately at `src/__tests__/index.test.ts:2053`.
- `src/utils/__tests__/errors.test.ts:66` — every `errors.ts` handler asserted not to call `setFailed`.
- `src/output/__tests__/check-run.test.ts` (`'never calls core.setFailed'`, and the exhausted-retry escalation test) and `src/output/__tests__/post-pr-comment.test.ts:141` — output modules likewise never fail.

When you add an error path, add a matching `expect(mockSetFailed).not.toHaveBeenCalled()`
case. See [testing](./testing.md) for the mocking setup.

## Related

- [api-client](./api-client.md) — where `errorCode` (`NETWORK_ERROR` etc.) comes from.
- [output](./output.md) — summary / PR comment / check run, each independently try/caught.
- [known-issues](./known-issues.md) — item E (silent analytics drops), now resolved.
- [conventions](./conventions.md) — repo-wide rules including the never-`setFailed` rule.
