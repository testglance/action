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

| Level          | Used for                                                       | Examples                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.info`    | success + progress, always visible                             | parse summary `src/index.ts:222`; local-only notice `src/index.ts:146`; submit success `src/index.ts:373`; first-run notice `src/index.ts:250`                                                                                                                              |
| `core.warning` | ALL user-facing errors + invalid inputs                        | every handler in `errors.ts`; invalid-input fallbacks (e.g. `src/index.ts:44`); per-file parse failure `src/index.ts:209`; "all files failed" `src/index.ts:216`; output-step failures (summary `src/index.ts:457`, PR comment `src/index.ts:516`, HTML `src/index.ts:416`) |
| `core.debug`   | detailed analytics-step failures + "not enough runs yet" notes | delta `src/index.ts:267`; tests-changed `src/index.ts:278`; flaky `src/index.ts:296`; perf `src/index.ts:313`; trends `src/index.ts:327`; base-branch delta `src/index.ts:350`                                                                                              |

- **No `core.notice`** anywhere. **No `core.error`** anywhere. (`core.error` would print a red annotation but still not fail; the project deliberately uses `warning` instead — verified absent in `src/`.)
- `core.debug` output is **only visible when the consumer enables step debug logging** (the `ACTIONS_STEP_DEBUG` secret / runner debug). On a normal run it is invisible.

### Picking a level for new code

- Did something the user asked for succeed, or are you reporting normal progress? → `core.info`.
- Did a feature the user can see (summary, PR comment, check run, submission, parsing, an input) fail or get skipped? → `core.warning`. The user should be able to notice and fix it.
- Did an _optional history/analytics_ computation fail or get skipped for lack of data? → `core.debug`. But see the [wart](#wart-silent-analytics-drops) below before choosing this for anything that drops user-visible data.

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

## WART: silent analytics drops

Analytics computations (delta, tests-changed, flaky, perf-regression, trends, base-branch
delta) are wrapped in their own try/catch that logs at **`core.debug`** (e.g.
`src/index.ts:267`, `src/index.ts:296`, `src/index.ts:350`). Because debug is hidden on
normal runs, a failure here **silently drops that analytics section** from the summary / PR
comment with no visible warning — the run looks clean. This is data-affecting, unlike the
benign "need N runs" debug notes that share the same level. Tracked as
[known-issues](./known-issues.md) E. If you add a new history/analytics step, weigh whether
its _failure_ (as opposed to "not enough data yet") deserves `core.warning` instead.

## Testing the no-fail guarantee

The guarantee is enforced by assertions, not just convention. `@actions/core` is mocked and
`setFailed` is asserted never-called:

- `src/__tests__/index.test.ts:354` — `describe('critical: core.setFailed is NEVER called (AC7)')`, covering happy path, no-files, parse error, API-error, and unexpected-exception cases. The empty-`api-key` (local-only) case lives separately at `src/__tests__/index.test.ts:2053`.
- `src/utils/__tests__/errors.test.ts:66` — every `errors.ts` handler asserted not to call `setFailed`.
- `src/output/__tests__/check-run.test.ts:426` and `src/output/__tests__/post-pr-comment.test.ts:141` — output modules likewise never fail.

When you add an error path, add a matching `expect(mockSetFailed).not.toHaveBeenCalled()`
case. See [testing](./testing.md) for the mocking setup.

## Related

- [api-client](./api-client.md) — where `errorCode` (`NETWORK_ERROR` etc.) comes from.
- [output](./output.md) — summary / PR comment / check run, each independently try/caught.
- [known-issues](./known-issues.md) — wart E (silent analytics drops).
- [conventions](./conventions.md) — repo-wide rules including the never-`setFailed` rule.
