# Testing

**Purpose:** How tests are structured and run — Vitest config, fixtures, the mocking strategy in the orchestration tests, and the real e2e / `act` smoke layers.
**Read this when:** You are writing or fixing a test, adding a fixture, or changing the e2e / self-test flow.

## Runner & config

- Vitest (`vitest run`). Config is `vitest.config.ts`:
  - `globals: true` (`vitest.config.ts:5`) — `describe`/`it`/`expect`/`vi` are global; tests still import them explicitly.
  - `testTimeout: 30_000` (`vitest.config.ts:6`) — 30s per test, generous for the large-fixture perf tests.
- No coverage gate is configured (no `coverage` block, no threshold in CI). Coverage is not enforced — see [known-issues](./known-issues.md).

### Commands

| Command           | What                                                     |
| ----------------- | -------------------------------------------------------- |
| `pnpm test`       | `vitest run` (single pass) — `package.json:10`           |
| `pnpm test:watch` | `vitest` watch mode — `package.json:11`                  |
| `pnpm e2e:act`    | local bundled-action smoke via `act` — `package.json:12` |

CI runs the suite with `pnpm exec vitest run --reporter=default --reporter=junit --outputFile=test-results/vitest.xml` (`.github/workflows/ci.yml:56`) so the action can dogfood its own JUnit output (see [self-test](#real-integration--self-test--e2e) below).

## Layout

- Tests are `{module}.test.ts` inside `__tests__/` dirs next to the code (25 files under `src/`). See [conventions](./conventions.md).
- Parser tests read **real fixture files** from `fixtures/` via a tiny helper, e.g.:

  ```ts
  const fixture = (name: string) =>
    readFileSync(join(__dirname, '../../../fixtures', name), 'utf-8');
  ```

  (`src/parsers/__tests__/junit.test.ts:7`; same in `ctrf.test.ts:8`). JUnit also has `fixtureRaw` returning a `Buffer` for the BOM/encoding test (`junit.test.ts:9`).

## Fixtures

`fixtures/` holds **21 small committed fixtures** in three families:

- `junit-*.xml` (11) — basic, multi-suite, nested, encoding (UTF-8 BOM), malformed, empty, no-tests, native-location, with-stacktraces, suite-a/suite-b.
- `ctrf-*.json` (8) — basic, multi-suite, optional-fields, native-location, with-stacktraces, malformed, invalid-schema, empty.
- `e2e-history-*.xml` (2) — `e2e-history-base.xml` / `e2e-history-changed.xml`, used by the e2e history flow (the workflow `cp`s them to `fixtures/e2e-history.xml`).

`ctrf-empty.json` and `junit-empty.xml` are intentionally **0-byte** files (the empty-file error paths).

### Large fixtures are generated, not committed

Performance tests build big inputs in-memory rather than committing megabyte fixtures (this is what CLAUDE.md means by "large fixtures generated at test time"):

- `generateLargeXml(suites, testsPerSuite)` (`src/parsers/__tests__/junit.test.ts:202`) — the perf test feeds `generateLargeXml(200, 60)` = **12,000** tests and asserts `< 5000` ms (`junit.test.ts:218`). A second test builds 1,200 entity-heavy testcases to guard against an XML-bomb false positive (`junit.test.ts:228`).
- `generateLargeCtrfJson(testCount)` (`src/parsers/__tests__/ctrf.test.ts:312`) — perf test runs `generateLargeCtrfJson(1200)` and asserts `< 5000` ms (`ctrf.test.ts:338`).

When adding a parser perf assertion, generate the input — do not commit a large fixture.

## Mocking strategy (orchestration tests)

`src/__tests__/index.test.ts` tests the full `run()` pipeline but is **heavily mocked** — it is orchestration-level, not true integration (parsers, API, history math, and all I/O are stubbed); its top-level `describe` is named `run() orchestration (all collaborators mocked)` to make that explicit. The real, unmocked pipeline (real parsers → merge → summary against committed fixtures) is exercised by `src/__tests__/index.integration.test.ts`, complementing the CI-level `.github/workflows/e2e.yml`.

What it mocks (all via `vi.mock`, top of file):

- `@actions/core` — `getInput`/`info`/`warning`/`setFailed`/`debug` captured as `vi.fn()` (`index.test.ts:9`).
- `node:fs` — `readFileSync`/`mkdirSync`/`writeFileSync`/`existsSync` (`index.test.ts:19`).
- `@actions/cache` — `restoreCache`/`saveCache`/`ReserveCacheError` (`index.test.ts:108`), so history cache round-trips are simulated.
- Both parsers (`../parsers/junit`, `../parsers/ctrf`), the API client (`../api/client`), and util/output modules: `detect-format`, `detect-framework`, `discover-files`, `merge-results`, `auto-detect`, `errors`, and `output/*` (summary, post-pr-comment, check-run, html-report, upload-artifact).

Key test scaffolding:

- `VALID_PARSED_RUN` (`index.test.ts:118`) — a canonical `ParsedTestRun` returned by the mocked parsers.
- `setupInputs(overrides)` (`index.test.ts:132`) — factory that drives `core.getInput`; pass `{ 'api-key': '' }`, `{ history: 'true' }`, etc. to flip a single input. See [inputs-reference](./inputs-reference.md) for the input names.
- `beforeEach` (`index.test.ts:158`) wires default happy-path return values and calls `setupInputs()`.

### The "setFailed is NEVER called" invariant

The product requirement (FR5: never break CI, always exit 0 — see [architecture](./architecture.md)) is pinned by a dedicated block (`index.test.ts:350`) asserting `mockSetFailed` is **not** called on: happy path, no files, parse error, API error, and unexpected exception. Many other tests re-assert `expect(mockSetFailed).not.toHaveBeenCalled()` inline. **Do not remove these.** Note also that several analytics failures (delta, flaky, tests-changed) only emit `core.debug`, not `core.warning` (`index.test.ts:1126`, `1202`, `1460`) — see [known-issues](./known-issues.md).

## Real integration — self-test & e2e

These layers exercise the _bundled_ action (`uses: ./` against `dist/`), so they catch packaging/runtime breakage the mocked tests cannot.

- **Self-test** (`.github/workflows/ci.yml:59`): the `test` job builds `dist/`, then runs `uses: ./` on its own `test-results/vitest.xml` with a real `api-key` secret + `annotate-failures`. The action consumes its own JUnit output.
- **E2E** (`.github/workflows/e2e.yml`): runs on push/PR to `main`. Builds, then drives ~16 `uses: ./` steps over `fixtures/` — local-only mode (no `api-key`), JUnit/CTRF auto-detect + explicit format, multi-suite, stack traces, custom inputs, the two-step history flow (seed `e2e-history-base.xml`, swap in `e2e-history-changed.xml`), and edge cases (malformed/empty/missing/invalid-schema) that **must warn but exit 0**.

## Local `act` smoke

Bundled-action smoke you can run before pushing, without hitting GitHub:

- `pnpm e2e:act` → `scripts/e2e-act.sh`, which runs `.github/workflows/e2e-local.yml` under `act` in Docker (`scripts/e2e-act.sh:51`). That workflow is `workflow_dispatch`-only and must **never** run in hosted CI (`e2e.yml` is authoritative).
- The script `pnpm build`s `dist/` first (`scripts/e2e-act.sh:41`) because `dist/` is gitignored and is the action's `runs.main` — see [build-and-release](./build-and-release.md).
- **Graceful skip:** if Docker isn't running or `act` isn't installed, the script prints a SKIP and `exit 0` (`scripts/e2e-act.sh:28`, `:34`) — it never hard-fails a machine without them.
- Marker assertions after the run (`scripts/e2e-act.sh:60`+): act exited 0; **no `::error::`/`setFailed`** markers (FR5); `local-only mode` marker present; `>= 6` `Parsed N tests` lines (breaking either parser drops below the threshold); missing-file and empty-file edge cases warned; Check Run smoke warned (a dummy token can't reach the GitHub API, so it must warn and still exit 0).
- Cannot verify real Check Run annotations or PR comments (no live GitHub API) — those stay covered by the mocked vitest suite and hosted `e2e.yml`. First run needs `act --pull` once to seed the runner image; the script uses `--pull=false` and `--bind`.

## Git hooks (Husky)

- `pre-commit` → `pnpm lint-staged` (eslint --fix + prettier on staged files).
- `pre-push` → `pnpm typecheck && pnpm test` — the full suite must pass before any push.
