# Known Issues & Tech Debt

**Purpose:** Catalog of known best-practice gaps and tech debt in this repo, each with a tracking GitHub issue.
**Read this when:** You hit something that looks wrong or sub-standard, or before "fixing" behavior that's a documented known wart — check here first so you don't re-discover or accidentally undo a deliberate state.

These were surfaced during the AI-native docs revamp. Each has a tracking issue on `testglance/action`. Docs elsewhere in `.agents/` link here instead of pretending the behavior is ideal.

| #   | Issue                                                                                                                 | Area          | Severity | Status |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------- | -------- | ------ |
| D   | [#161 — Stop shipping the ~6.5MB source map in published dist/](https://github.com/testglance/action/issues/161)      | Build/perf    | Low      | Open   |
| E   | [#162 — Promote silent analytics failures from debug() to warning()](https://github.com/testglance/action/issues/162) | Observability | Medium   | Open   |
| F   | [#163 — Clarify index.test.ts is an orchestration unit test](https://github.com/testglance/action/issues/163)         | Testing/docs  | Low      | Open   |

---

## A — No LICENSE file ([#158](https://github.com/testglance/action/issues/158))

**Fixed:** a top-level `LICENSE` file with the standard MIT text (holder: TestGlance) now exists, and `package.json` declares `"license": "MIT"`. Originally: the README showed an MIT badge linking to `/LICENSE`, but no `LICENSE` file existed, so the default was "all rights reserved".

## B — Renovate auto-merge posture (Resolved, [#159](https://github.com/testglance/action/issues/159))

**Resolved.** Auto-merge was previously broad: `:automergePatch` covered _all_ patch
updates (including production `dependencies`, which ncc bundles into `dist/`), and
third-party actions were pinned to mutable major-version tags. The posture is now:

- **Third-party actions are SHA-pinned** (`helpers:pinGitHubActionDigests`), and the
  workflow `uses:` lines are pinned to full commit SHAs with a `# vX` comment. Auto-merge
  applies only to immutable digest re-pins + patch/minor tag moves.
- **Production `dependencies` require human review** - `:automergePatch` was removed and an
  explicit `dependencies → automerge:false` rule added. devDependencies / linters / testers
  / `@types` and `lockFileMaintenance` still auto-merge.
- Gates unchanged: `minimumReleaseAge: "3 days"`, `internalChecksFilter: "strict"`.

See [security](./security.md) and [build-and-release](./build-and-release.md).

## C — Coverage collection & thresholds ([#160](https://github.com/testglance/action/issues/160)) — Resolved

`vitest.config.ts` now configures the v8 coverage provider with global thresholds
(statements 93 / branches 81 / functions 97 / lines 94, seeded at then-current levels), and
the CI `test` job runs `vitest run --coverage`, so coverage regressions fail the build. See
[testing](./testing.md).

## D — Source map shipped to consumers ([#161](https://github.com/testglance/action/issues/161))

`ncc ... --source-map` emits `dist/index.js.map` (~6.5MB), committed to `main` and downloaded by every consumer on every run. Usually unnecessary for a published action. See [build-and-release](./build-and-release.md).

## E — Analytics failures logged at debug level ([#162](https://github.com/testglance/action/issues/162))

History/delta/flaky/perf computation failures use `core.debug()`, invisible unless the consumer enables Actions step debug logging — analytics can silently vanish. Promote data-affecting failures to `core.warning()` (still never `setFailed`, always exit 0). See [observability](./observability.md) and [history-analytics](./history-analytics.md).
