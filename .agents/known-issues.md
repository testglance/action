# Known Issues & Tech Debt

**Purpose:** Catalog of known best-practice gaps and tech debt in this repo, each with a tracking GitHub issue.
**Read this when:** You hit something that looks wrong or sub-standard, or before "fixing" behavior that's a documented known wart — check here first so you don't re-discover or accidentally undo a deliberate state.

These were surfaced during the AI-native docs revamp. Each has a tracking issue on `testglance/action`. Docs elsewhere in `.agents/` link here instead of pretending the behavior is ideal.

| #   | Issue                                                                                                                 | Area          | Severity | Status |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------- | -------- | ------ |
| A   | [#158 — Add LICENSE file (MIT) to match README badge](https://github.com/testglance/action/issues/158)                | Licensing     | Medium   | Fixed  |
| B   | [#159 — Reconsider Renovate auto-merge of devDeps + GitHub Actions](https://github.com/testglance/action/issues/159)  | Supply chain  | Medium   | Open   |
| C   | [#160 — Add test coverage collection and thresholds in CI](https://github.com/testglance/action/issues/160)           | Testing       | Low      | Open   |
| D   | [#161 — Stop shipping the ~6.5MB source map in published dist/](https://github.com/testglance/action/issues/161)      | Build/perf    | Low      | Open   |
| E   | [#162 — Promote silent analytics failures from debug() to warning()](https://github.com/testglance/action/issues/162) | Observability | Medium   | Open   |
| F   | [#163 — Clarify index.test.ts is an orchestration unit test](https://github.com/testglance/action/issues/163)         | Testing/docs  | Low      | Open   |

---

## A — No LICENSE file ([#158](https://github.com/testglance/action/issues/158))

**Fixed:** a top-level `LICENSE` file with the standard MIT text (holder: TestGlance) now exists, and `package.json` declares `"license": "MIT"`. Originally: the README showed an MIT badge linking to `/LICENSE`, but no `LICENSE` file existed, so the default was "all rights reserved".

## B — Renovate auto-merges devDeps + GitHub Actions ([#159](https://github.com/testglance/action/issues/159))

`renovate.json` auto-merges patch/minor updates for `devDependencies` and the `github-actions` manager without review (`minimumReleaseAge: 3 days` mitigates but does not eliminate). For a widely-consumed action whose `v1` bundle is CI-built from `main`, an unreviewed compromised dep/tag is a supply-chain risk. See [security](./security.md) and [build-and-release](./build-and-release.md).

## C — No coverage thresholds ([#160](https://github.com/testglance/action/issues/160))

`vitest.config.ts` has no coverage config and CI doesn't gate on coverage despite a large suite. Add `--coverage` (v8) and enforce minimums in the `test` job. See [testing](./testing.md).

## D — Source map shipped to consumers ([#161](https://github.com/testglance/action/issues/161))

`ncc ... --source-map` emits `dist/index.js.map` (~6.5MB), committed to `main` and downloaded by every consumer on every run. Usually unnecessary for a published action. See [build-and-release](./build-and-release.md).

## E — Analytics failures logged at debug level ([#162](https://github.com/testglance/action/issues/162))

History/delta/flaky/perf computation failures use `core.debug()`, invisible unless the consumer enables Actions step debug logging — analytics can silently vanish. Promote data-affecting failures to `core.warning()` (still never `setFailed`, always exit 0). See [observability](./observability.md) and [history-analytics](./history-analytics.md).

## F — "Integration" test is heavily mocked ([#163](https://github.com/testglance/action/issues/163))

`src/__tests__/index.test.ts` mocks `@actions/core`, `node:fs`, parsers, API, and utils — it verifies `run()` orchestration, not real module integration. True integration lives in `.github/workflows/e2e.yml`. Relabel wording; optionally add a thin unmocked integration test. See [testing](./testing.md).
