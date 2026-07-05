# TestGlance

[![CI](https://github.com/testglance/action/actions/workflows/ci.yml/badge.svg)](https://github.com/testglance/action/actions/workflows/ci.yml) [![GitHub Marketplace](https://img.shields.io/badge/Marketplace-TestGlance-green?logo=github)](https://github.com/marketplace/actions/testglance) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Coverage](https://img.shields.io/badge/coverage-92%25-brightgreen)](https://github.com/testglance/action/actions/workflows/ci.yml)

Zero-config test reporting for GitHub Actions. Never breaks your CI.

- **Zero config** — auto-detects test report files; no `report-path` required
- **Rich CI summaries** — failed tests with stack traces, slowest tests, per-suite breakdowns
- **PR comments** — multi-job test summaries posted directly on pull requests
- **Inline annotations** — failed tests annotated directly on the PR diff (opt-in)
- **Non-blocking** — guaranteed exit code 0, your builds are always safe

## Quick Start

No signup, no account, no outbound calls to TestGlance.

```yaml
- uses: testglance/action@v1
```

That's it. TestGlance auto-detects your test reports and generates a CI summary.

### Have your AI agent install it

Most agents (Claude Code, Cursor, Windsurf, ...) will set this up end-to-end if you point them at the install prompt:

> Install TestGlance in this project — instructions and per-framework guides at <https://www.testglance.dev/install/index.md>

The agent fetches the matching `https://www.testglance.dev/install/<framework>.md` page (vitest, jest, playwright, mocha, cypress, pytest, go, rspec, phpunit, junit5, dotnet, or `other`), wires up the JUnit reporter, and adds the workflow step. The copy-pasteable prompt is on the [TestGlance landing page](https://www.testglance.dev).

### With PR Comments

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: testglance/action@v1
    with:
      github-token: ${{ github.token }}
```

Requires `pull-requests: write` permission. See [Permissions](#permissions) for details.

### With TestGlance Platform _(coming soon)_

The hosted TestGlance dashboard — health scores, flaky test detection, and trend tracking — is in development. The `api-key` input is reserved for this integration but is not yet active.

```yaml
- uses: testglance/action@v1
  with:
    api-key: ${{ secrets.TESTGLANCE_API_KEY }} # reserved — SaaS coming soon
```

## Features

- **Failed Test Details** — up to 30 lines of stack traces per failure, formatted in collapsible sections
- **Slowest Tests** — configurable top-N ranking to spot performance bottlenecks
- **Suite Breakdown** — per-suite pass/fail/skip counts and durations
- **Auto-Detection** — finds `**/test-results/*.xml`, `**/junit.xml`, `**/ctrf/*.json`, and more
- **Multi-File Merge** — glob patterns merge multiple report files into a single summary
- **Inline Annotations** — opt-in failure annotations on the PR diff at the exact file:line
- **PR Comments** — multi-job summaries merged into a single comment, updated on re-runs
- **Run History** — recent runs tracked via GitHub Actions Cache; no account, no external service
- **Flaky Test Detection** — flags tests that flip between pass and fail across recent runs
- **Performance Regression Detection** — flags tests running far slower than their historical median, with a duration trend sparkline
- **HTML Report** — self-contained report uploaded as a workflow artifact on every run
- **SaaS Dashboard** _(coming soon)_ — optional org-wide health scores and long-term trend tracking

## Feature Comparison

| Feature             |     TestGlance     | dorny/test-reporter | ctrf-io/github-test-reporter | mikepenz/action-junit-report | EnricoMi/publish-unit-test-result-action |
| ------------------- | :----------------: | :-----------------: | :--------------------------: | :--------------------------: | :--------------------------------------: |
| Zero Config         | :white_check_mark: |         :x:         |             :x:              |             :x:              |                   :x:                    |
| JUnit + CTRF        |        Both        |     JUnit only      |          CTRF only           |          JUnit only          |                JUnit only                |
| Failed Test Details | :white_check_mark: | :white_check_mark:  |      :white_check_mark:      |      :white_check_mark:      |            :white_check_mark:            |
| Slowest Tests       | :white_check_mark: |         :x:         |             :x:              |             :x:              |                   :x:                    |
| Suite Breakdown     | :white_check_mark: |         :x:         |             :x:              |             :x:              |            :white_check_mark:            |
| Check Runs          | :white_check_mark: | :white_check_mark:  |      :white_check_mark:      |      :white_check_mark:      |            :white_check_mark:            |
| PR Comments         | :white_check_mark: |         :x:         |      :white_check_mark:      |             :x:              |            :white_check_mark:            |
| Never Fails CI      | :white_check_mark: |         :x:         |         Configurable         |         Configurable         |               Configurable               |
| Multi-File Merge    | :white_check_mark: | :white_check_mark:  |             :x:              |      :white_check_mark:      |            :white_check_mark:            |
| Auto-Detect Files   | :white_check_mark: |         :x:         |             :x:              |             :x:              |                   :x:                    |
| SaaS Dashboard      |    Coming soon     |         :x:         |             :x:              |             :x:              |                   :x:                    |

## Usage Examples

### Basic — Auto-Detect

```yaml
- uses: testglance/action@v1
```

### With PR Comments

```yaml
- uses: testglance/action@v1
  with:
    github-token: ${{ github.token }}
```

### With Inline Failure Annotations

```yaml
permissions:
  checks: write

steps:
  - uses: testglance/action@v1
    with:
      github-token: ${{ github.token }}
      annotate-failures: true
      check-name: Unit Tests
```

### With TestGlance Platform _(coming soon)_

```yaml
- uses: testglance/action@v1
  with:
    api-key: ${{ secrets.TESTGLANCE_API_KEY }} # reserved — SaaS coming soon
    github-token: ${{ github.token }}
```

### Multi-Job Workflows

Each GitHub Actions job runs on its own runner with its own filesystem and Job Summary. Add the TestGlance step to **every job that produces test reports** — results are automatically merged into a single PR comment.

```yaml
jobs:
  unit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install && pnpm test
      - uses: testglance/action@v1
        if: always()
        with:
          github-token: ${{ github.token }}

  e2e:
    needs: unit
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install && pnpm test:e2e
      - uses: testglance/action@v1
        if: always()
        with:
          github-token: ${{ github.token }}
```

Use `if: always()` so results are reported even when tests fail. Use `test-job-name` to disambiguate jobs in the merged PR comment if the default job name isn't clear enough.

### Org-Wide Reusable Workflow

See [`examples/reusable-workflow.yml`](examples/reusable-workflow.yml) for a `workflow_call` template you can deploy across your organization. More examples in the [`examples/`](examples/) directory.

## Inputs

| Input               | Required | Default                      | Description                                                                                                                |
| ------------------- | :------: | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `report-path`       |    No    | `''` (auto-detect)           | Path to test report file(s). Supports glob patterns.                                                                       |
| `api-key`           |    No    | `''`                         | TestGlance project API key _(reserved — SaaS coming soon)_                                                                 |
| `api-url`           |    No    | `https://www.testglance.dev` | TestGlance API URL _(reserved — SaaS coming soon)_                                                                         |
| `report-format`     |    No    | `auto`                       | Format: `junit`, `ctrf`, or `auto` (detect from extension)                                                                 |
| `test-job-name`     |    No    | `''`                         | Override the display name for this test job                                                                                |
| `slowest-tests`     |    No    | `10`                         | Number of slowest tests to show in CI summary (0 to disable)                                                               |
| `show-all-tests`    |    No    | `auto`                       | List every test name under each suite in the CI summary. `auto` shows them when the run is small enough to fit.            |
| `send-results`      |    No    | `true`                       | Send results to TestGlance API. Automatically forced to `false` when no `api-key` is provided.                             |
| `github-token`      |    No    | `''`                         | GitHub token for PR comments and Check Runs                                                                                |
| `annotate-failures` |    No    | `false`                      | Annotate failed tests inline on the PR diff (creates a Check Run)                                                          |
| `check-name`        |    No    | `Test Results`               | Name of the Check Run created by `annotate-failures`                                                                       |
| `annotation-level`  |    No    | `failure`                    | Severity for inline failure annotations: `failure`, `warning`, or `notice`. `warning`/`notice` keep the check advisory.    |
| `summary-template`  |    No    | `''`                         | Path to a Handlebars template that replaces the default CI summary. See [Custom Templates](docs/custom-templates.md).      |
| `comment-template`  |    No    | `''`                         | Path to a Handlebars template that replaces the default PR comment body. See [Custom Templates](docs/custom-templates.md). |
| `history`           |    No    | `true`                       | Track run history via GitHub Actions Cache. Powers flaky and performance-regression detection.                             |
| `history-limit`     |    No    | `20`                         | Maximum number of runs kept in history                                                                                     |
| `flaky-threshold`   |    No    | `2`                          | Minimum pass/fail status flips over the last 10 runs to flag a test as flaky                                               |
| `perf-threshold`    |    No    | `200`                        | Percent increase over a test's median historical duration to flag as a regression (`200` = 3× slower)                      |
| `html-report`       |    No    | `true`                       | Generate a self-contained HTML report and upload it as a workflow artifact                                                 |
| `artifact-name`     |    No    | `testglance-report`          | Name of the uploaded HTML report artifact                                                                                  |

> **Note on `annotation-level`:** The Check Run's `conclusion` is still `failure` whenever tests fail, regardless of `annotation-level`. Setting `warning` or `notice` only changes the severity of the inline annotations — it does not change the check outcome. This is the dial for teams who want inline failure annotations without those annotations tripping required-checks branch protection.

## Permissions

TestGlance's core functionality (CI summaries, auto-detection) requires **no special permissions**. Additional features degrade gracefully when permissions are missing — they log a warning and skip, never failing your build.

| Permission             | Feature                         | Behavior if Missing                      |
| ---------------------- | ------------------------------- | ---------------------------------------- |
| `contents: read`       | Baseline (checkout code)        | Required for all modes                   |
| `pull-requests: write` | PR comments                     | Skipped with warning log, CI stays green |
| `checks: write`        | Check Runs + inline annotations | Skipped with warning log, CI stays green |

### Minimum standalone permissions

```yaml
permissions:
  contents: read
```

### Full feature permissions

```yaml
permissions:
  contents: read
  pull-requests: write
  checks: write
```

### Setting permissions

Add a `permissions` block at the **job level** or **workflow level**:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    steps:
      - uses: testglance/action@v1
        with:
          github-token: ${{ github.token }}
          annotate-failures: true
```

> **Important:** When you add a `permissions` block, GitHub removes all default permissions and grants **only** what you list. If your job needs other permissions (e.g., `contents: read` to check out code), you must include them explicitly.

For the full reference, see [`docs/permissions.md`](docs/permissions.md).

## Run History, Flaky Tests & Performance Regressions

On by default, with no account and no external service: each run's results are stored in GitHub Actions Cache (last 20 runs, configurable via `history-limit`). Once history accumulates, the CI summary and PR comment gain:

- **Flaky test detection** — a test that flips between pass and fail at least `flaky-threshold` times (default `2`) within the last 10 runs is flagged, with its recent status pattern and flip rate.
- **Performance regressions** — a test whose duration exceeds its median across previous runs by more than `perf-threshold` percent (default `200`, i.e. 3× slower) is flagged. Requires at least 3 previous recorded durations for that test.
- **Trends** — pass-rate and duration indicators across recent runs, including a duration sparkline.

History uses Actions Cache under the hood, so it needs no extra permissions and stores nothing outside your repository. Set `history: false` to turn it off.

## HTML Report

Every run also produces a self-contained HTML report and uploads it as a workflow artifact (named `testglance-report` by default, configurable via `artifact-name`). Download it from the run's **Artifacts** section to browse results offline or attach them to a bug report. Set `html-report: false` to disable.

## Supported Formats

### JUnit XML (`.xml`)

Output from most test frameworks:

- **JavaScript/TypeScript:** Jest, Vitest, Mocha, Playwright
- **Python:** pytest, unittest
- **Go:** `go test -v` with gotestsum
- **Java/Kotlin:** JUnit 5, Maven Surefire, Gradle
- **Ruby:** RSpec, Minitest
- **C#/.NET:** xUnit, NUnit, MSTest

### CTRF JSON (`.json`)

[Common Test Report Format](https://ctrf.io/) — a standardized JSON schema supported by many test frameworks.

## Example Output

After each CI run, TestGlance adds a Job Summary:

```
## TestGlance Results

| Metric    | Value  |
|-----------|--------|
| Total     | 142    |
| Passed    | 138    |
| Failed    | 3      |
| Skipped   | 1      |
| Duration  | 12.3s  |

### Failed Tests

| Suite        | Test                         | Error                         |
|--------------|------------------------------|-------------------------------|
| auth.login   | should reject expired token  | Expected 401 but received 200 |
| api.users    | should validate email format | Invalid email was accepted    |

### Slowest Tests

| Test                           | Duration |
|--------------------------------|----------|
| e2e.checkout full flow         | 4.2s     |
| api.users bulk import          | 2.8s     |
| auth.login rate limiting       | 1.9s     |

### Suite Breakdown

| Suite       | Passed | Failed | Skipped | Duration |
|-------------|--------|--------|---------|----------|
| auth        | 42     | 1      | 0       | 3.1s     |
| api         | 89     | 2      | 1       | 7.8s     |
| utils       | 7      | 0      | 0       | 1.4s     |
```

### PR Comment

```
## TestGlance Test Summary

### ci/test (unit tests)
**142 tests** | 12.3s | Health: 94/100

| Signal | Details |
|--------|---------|
|        | Health Score: 94 -> 91   |
|        | 2 new test(s) added      |

View Run ->
```

Multiple test jobs are merged into a single comment. Subsequent runs update the existing comment.

## Org-Wide Adoption

Deploy TestGlance across your organization with a single reusable workflow:

1. Copy [`examples/reusable-workflow.yml`](examples/reusable-workflow.yml) into your org's shared workflow repo
2. Each repo calls it with minimal config:

```yaml
jobs:
  report:
    uses: your-org/.github/.github/workflows/testglance.yml@main
    secrets:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

See the [`examples/`](examples/) directory for more usage patterns.

## Framework Guides

Per-framework install instructions are hosted at <https://www.testglance.dev/install/index.md> — also served as agent-friendly markdown so any AI coding agent can fetch them directly.

- [Vitest](https://www.testglance.dev/install/vitest)
- [Jest](https://www.testglance.dev/install/jest)
- [Playwright](https://www.testglance.dev/install/playwright)
- [Mocha](https://www.testglance.dev/install/mocha)
- [Cypress](https://www.testglance.dev/install/cypress)
- [pytest](https://www.testglance.dev/install/pytest)
- [Go](https://www.testglance.dev/install/go)
- [RSpec](https://www.testglance.dev/install/rspec)
- [PHPUnit](https://www.testglance.dev/install/phpunit)
- [JUnit 5 (Maven & Gradle)](https://www.testglance.dev/install/junit5)
- [.NET (xUnit / NUnit / MSTest)](https://www.testglance.dev/install/dotnet)
- [Other / generic JUnit XML](https://www.testglance.dev/install/other)

## Non-Blocking Guarantee

This Action **never fails your CI pipeline**. If anything goes wrong — file not found, parse error, API timeout, PR comment failure — the Action logs a warning and exits with code 0. Your builds are safe.

- No `core.setFailed()` calls anywhere in the codebase
- No repository permissions required for core functionality
- Optional `github-token` for PR comments and Check Runs only (never affects exit code)
- Only outbound HTTPS to the TestGlance API and GitHub API

## Getting Started

### Standalone (No Account Required)

Add a single step to any workflow that produces test reports:

```yaml
- uses: testglance/action@v1
```

### With TestGlance Platform _(coming soon)_

The hosted dashboard is in development. Once available, you'll be able to:

1. Sign up at [testglance.dev](https://www.testglance.dev)
2. Create a project and connect your repository
3. Copy your project API key
4. Add it as a repository secret: `Settings > Secrets > TESTGLANCE_API_KEY`
5. Add the Action to your workflow (see [Quick Start](#with-testglance-platform-coming-soon))

Until then, the `api-key` input is accepted but inactive — all core features (CI summaries, PR comments, annotations) work without it.

## Local development

Standard workflow (pnpm):

```bash
pnpm install
pnpm test          # vitest
pnpm lint          # eslint
pnpm typecheck     # tsc --noEmit
pnpm build         # bundle to dist/index.js (gitignored; CI rebuilds it)
```

### End-to-end smoke test with `act`

`pnpm e2e:act` runs the **bundled** Action (`dist/index.js` + `action.yml`) against
real report fixtures inside Docker via [`act`](https://github.com/nektos/act), then
asserts it parses JUnit/CTRF, handles edge cases (malformed/empty/missing) with a
warning, and **exits 0**. This catches packaging/runtime breakage that unit tests
can't, before you push.

```bash
pnpm e2e:act
```

**Prerequisites:**

- Docker running (the script skips with exit 0 if the daemon is unavailable).
- `act` installed. First run only, seed the runner image: `act --pull` (subsequent
  runs use `--pull=false`).
- Don't run two `act` invocations against the same Docker daemon concurrently —
  `act` uses host networking and the containers race.

**Caveat:** `act` cannot create real GitHub **Check Run annotations** or **PR
comments** (no live GitHub API). Those are covered by the vitest suite (mocked
octokit) and by the authoritative hosted e2e (`.github/workflows/e2e.yml`). The
Check Run code path is still smoke-exercised here — with a dummy token it warns
gracefully and exits 0, but no annotation is created.

## License

MIT
