# Agent Playbook

**Purpose:** Step-by-step recipes for the most common change types in this repo, with the exact wiring points and gotchas.
**Read this when:** You are about to implement a change and want the known path + pitfalls before starting.

All recipes converge on `src/index.ts:run()` (`src/index.ts:140`) — the single entry point that reads inputs, parses files, runs analytics, and fans out to every output channel. Read it first; it is the map.

---

## Recipe: add a new report format / parser

Both parsers emit the same normalized `ParsedTestRun` (`src/types.ts:1`) — keep that contract stable.

1. Create `src/parsers/<fmt>.ts` exporting `parse<Fmt>(content: string): ParsedTestRun`. Mirror `parseJunitXml` (`src/parsers/junit.ts:105`). Throw `ParseError` (`src/utils/errors.ts`) on bad input.
2. **Recount the summary from individual test elements** — never trust suite-level count attributes. JUnit does this at `src/parsers/junit.ts:146` (flatten all `<testcase>`, then `filter` by status). Apply the same pattern.
3. Wire format detection in `src/utils/detect-format.ts:3` — it maps file extension → format and is the source of `ReportFormat`. Add your extension there, and extend the `ReportFormat` union (`src/utils/detect-format.ts:1`).
4. Wire `parseFile` in `src/index.ts:119`: add an `else if (format === '<fmt>')` branch, and add your parser to the auto-detect fallback `try/catch` chain (`src/index.ts:128`) so extensionless / `report-format: auto` files still resolve.
5. Add fixtures under `fixtures/` (small ones committed; large ones generated at test time) and parser tests in `src/parsers/__tests__/<fmt>.test.ts` using real fixture files.

Deep dive: [parsers](./parsers.md), [data-model](./data-model.md).

---

## Recipe: add a new action input

1. Add the input to `action.yml` under `inputs:` (`action.yml:4`) with `description`, `required: false`, and a `default`.
2. Read + parse it at the top of `run()`, alongside the other `core.getInput(...)` calls (`src/index.ts:142`–`175`). For anything non-string, write a `parse*` helper next to the existing ones and **validate via `core.warning` + fall back to a default** — never throw. Copy the shape of:
   - `parseAnnotationLevel` (`src/index.ts:50`) — enum input.
   - `parseSlowestTestsCount` (`src/index.ts:63`) / `parsePerfThreshold` (`src/index.ts:103`) — non-negative integer with default const (`DEFAULT_*` at `src/index.ts:35`).
   - `parseFlakyThreshold` (`src/index.ts:79`) — positive integer (rejects `< 1`).
   - `parseShowAllTests` (`src/index.ts:39`) — `'auto' | boolean` tri-state.
   - Boolean inputs use the inline `core.getInput('x') === 'true'` / `!== 'false'` idiom (`src/index.ts:154`).
3. Thread the value through to wherever it is consumed (summary options, comment section, `sendTestRun`, etc.).
4. Document it in [inputs-reference](./inputs-reference.md) and add a step exercising it to the e2e workflow (`.github/workflows/e2e-local.yml`, run via `pnpm e2e:act`).

Deep dive: [inputs-reference](./inputs-reference.md).

---

## Recipe: add a new output channel

Existing channels: summary (`src/output/summary.ts`), PR comment (`src/output/post-pr-comment.ts`), check run / annotations (`src/output/check-run.ts`), HTML report + artifact upload (`src/output/html-report.ts`, `src/output/upload-artifact.ts`).

1. Create `src/output/<channel>.ts`. Take a typed options object (see `SummaryOptions`, `src/output/summary.ts:35`).
2. Call it from `run()` near the other output calls (`src/index.ts:391`–`520`). **Wrap the call in `try/catch` and `core.warning` on failure** — an output channel must never break the run. Every existing output does this (e.g. summary at `src/index.ts:456`).
3. Gate it behind an input if it is opt-in, and respect the `localOnly` / `result?.success` conditions the way PR comment posting does (`src/index.ts:478`).
4. **Respect size caps.** GitHub job summaries and comments have hard limits; copy the byte/row budgets from `summary.ts` constants (`src/output/summary.ts:58`–`65`, e.g. `MAX_RENDERED_SUMMARY_BYTES = 900_000`) and elide with a truncation notice rather than overflowing.
5. Add unit tests in `src/output/__tests__/`.

Deep dive: [output](./output.md).

---

## Recipe: change the API payload contract

The wire payload is assembled in one place: `buildPayload` (`src/api/client.ts:39`), typed by `ApiPayload` (`src/types.ts:21`). Posted to `POST {apiUrl}/api/v1/runs` (`src/api/client.ts:85`).

1. Edit `ApiPayload` / `MetaEnvelope` in `src/types.ts:14` to reflect the new shape.
2. Populate the new fields in `buildPayload` (`src/api/client.ts:39`) — env-derived fields (`GITHUB_*`) go here, not in the parser.
3. **Do not change `ParsedTestRun`** to carry payload-only concerns — `results` spreads the parsed run and adds `repository` / `git` / `ciRunId` on top (`src/api/client.ts:56`). Keep the parser contract clean.
4. Pass new caller-supplied values through `MetaFields` (`src/api/client.ts:34`) and the `metaFields` arg at the `sendTestRun` call site (`src/index.ts:367`).
5. Update `src/api/__tests__/client.test.ts`. The action is non-blocking: send only runs when `sendResults` is true, and failures route through `handleApiUnreachable` / `handleApiError` (`src/index.ts:377`).

Deep dive: [api-client](./api-client.md).

---

## Recipe: add a history metric

History is loaded from Actions Cache, a new entry is appended, then metrics are computed off the entry list. All metrics live behind a "need N runs" guard in `run()`.

1. If the metric needs new fields, extend the types in `src/history/types.ts` (e.g. `HistoryEntry`, `src/history/types.ts:8`, or a new result interface beside `FlakyDetectionResult` at `src/history/types.ts:57`).
2. Compute it in a `src/history/*.ts` module — follow `detectFlakyTests` (`src/history/flaky-detection.ts`), `detectPerfRegressions` (`src/history/perf-regression.ts`), `computeTrends` (`src/history/trends.ts`), `computeDelta` / `computeTestsChanged` (`src/history/comparison.ts`).
3. Call it in `run()` with the correct **minimum-runs guard** and a `core.debug` "collecting baseline" message when below threshold. Existing thresholds (read them, don't guess):
   - delta / tests-changed: `>= 2` entries (`src/index.ts:262`)
   - perf regression / trends: `>= 3` entries (`src/index.ts:304`, `src/index.ts:323`)
   - flaky: `>= 5` entries (`src/index.ts:292`)
4. Each computation is wrapped in `try/catch` that logs via `core.debug` (analytics failures are non-fatal and quiet — see [known-issues](./known-issues.md)), unlike the top-level history load which uses `core.warning` (`src/index.ts:284`).
5. Surface it: add it to `SummaryOptions` (`src/output/summary.ts:35`), render a section (e.g. `renderTrendsSection`, `src/output/summary.ts:627`), and thread it into the PR-comment section object (`src/index.ts:494`).

Deep dive: [history-analytics](./history-analytics.md), [output](./output.md).

---

## Gotchas checklist (read before every change)

- **Never `core.setFailed()`. Always exit 0.** Non-blocking by design (product req FR5). All errors go through `core.warning()` — or `core.debug()` for analytics failures. The whole of `run()` is wrapped in a `try/catch` that ends in `handleUnexpectedError` and returns, never re-throws (`src/index.ts:523`).
- **Recount from `<testcase>` / `test` elements.** Never trust suite-level count attributes (`src/parsers/junit.ts:146`).
- **Never commit `dist/`.** It is gitignored and built + committed to `main` only by the `release-v1` CI job. Run `pnpm build` locally only to verify the bundle compiles. See [build-and-release](./build-and-release.md).
- **Runtime is `node24`** (`action.yml:90`), not node20.
- **Pre-push enforces `pnpm typecheck && pnpm test`** (`.husky/pre-push`). Pre-commit runs `lint-staged` (eslint --fix + prettier) on staged files (`.husky/pre-commit`). Run `pnpm typecheck && pnpm lint && pnpm test` before pushing to avoid a hook bounce.
- **Conventional commit messages.** `commit-msg` runs commitlint (`.husky/commit-msg`); non-conventional messages are rejected.
- **Fixtures:** small ones committed under `fixtures/`; large ones generated at test time, not committed. Tests read real files. See [testing](./testing.md).
- **The postinstall ESM patch.** `scripts/patch-esm-exports.cjs` (run via `postinstall`, `package.json:19`) rewrites `@actions/*` `package.json` `exports['.']` to add a `default` entry pointing at the ESM build, so ncc/CommonJS resolution works. If `@actions/*` resolution breaks after a dependency bump, re-run `pnpm install` (triggers postinstall) before debugging deeper. See [build-and-release](./build-and-release.md).
- **`api-key` is optional.** With no key the action runs **local-only** (`localOnly`, `src/index.ts:144`): summary, PR comment, check run, and HTML report still work; API submission is skipped (`sendResults` forced false). Don't gate output channels solely on API success.

---

## Quick map: where each thing wires in `run()`

| Concern                                   | Line in `src/index.ts` |
| ----------------------------------------- | ---------------------- |
| Input reads + `parse*` helpers            | `142`–`175`            |
| File discovery / auto-detect              | `179`–`198`            |
| Parse loop → `mergeTestRuns`              | `202`–`220`            |
| History load + delta/tests-changed        | `230`–`288`            |
| Flaky / perf / trends / base-branch delta | `290`–`354`            |
| API submission (`sendResults`)            | `366`–`382`            |
| HTML report + artifact upload             | `391`–`420`            |
| CI summary                                | `428`–`460`            |
| Check run annotations                     | `462`–`476`            |
| PR comment                                | `478`–`520`            |
