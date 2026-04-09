# TestGlance

[![CI](https://github.com/testglance/action/actions/workflows/ci.yml/badge.svg)](https://github.com/testglance/action/actions/workflows/ci.yml) [![GitHub Marketplace](https://img.shields.io/badge/Marketplace-TestGlance-green?logo=github)](https://github.com/marketplace/actions/testglance) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Coverage](https://img.shields.io/badge/coverage-92%25-brightgreen)](https://github.com/testglance/action/actions/workflows/ci.yml)

Zero-config test reporting for GitHub Actions. Never breaks your CI — even on fork PRs.

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

### With TestGlance Platform

Connect to the TestGlance dashboard for health scores, flaky test detection, and trend tracking:

```yaml
- uses: testglance/action@v1
  with:
    api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

## Features

- **Failed Test Details** — up to 30 lines of stack traces per failure, formatted in collapsible sections
- **Slowest Tests** — configurable top-N ranking to spot performance bottlenecks
- **Suite Breakdown** — per-suite pass/fail/skip counts and durations
- **Auto-Detection** — finds `**/test-results/*.xml`, `**/junit.xml`, `**/ctrf/*.json`, and more
- **Multi-File Merge** — glob patterns merge multiple report files into a single summary
- **Inline Annotations** — opt-in failure annotations on the PR diff at the exact file:line
- **PR Comments** — multi-job summaries merged into a single comment, updated on re-runs
- **SaaS Dashboard** — optional health scores, flaky test detection, and trend tracking

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
| SaaS Dashboard      |      Optional      |         :x:         |             :x:              |             :x:              |                   :x:                    |

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

### With TestGlance Platform

```yaml
- uses: testglance/action@v1
  with:
    api-key: ${{ secrets.TESTGLANCE_API_KEY }}
    github-token: ${{ github.token }}
```

### Org-Wide Reusable Workflow

See [`examples/reusable-workflow.yml`](examples/reusable-workflow.yml) for a `workflow_call` template you can deploy across your organization. More examples in the [`examples/`](examples/) directory.

## Inputs

| Input               | Required | Default                      | Description                                                                                    |
| ------------------- | :------: | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `report-path`       |    No    | `''` (auto-detect)           | Path to test report file(s). Supports glob patterns.                                           |
| `api-key`           |    No    | `''`                         | TestGlance project API key (optional, enables SaaS features)                                   |
| `api-url`           |    No    | `https://www.testglance.dev` | TestGlance API URL                                                                             |
| `report-format`     |    No    | `auto`                       | Format: `junit`, `ctrf`, or `auto` (detect from extension)                                     |
| `test-job-name`     |    No    | `''`                         | Override the display name for this test job                                                    |
| `slowest-tests`     |    No    | `10`                         | Number of slowest tests to show in CI summary (0 to disable)                                   |
| `send-results`      |    No    | `true`                       | Send results to TestGlance API. Automatically forced to `false` when no `api-key` is provided. |
| `github-token`      |    No    | `''`                         | GitHub token for PR comments and Check Runs                                                    |
| `annotate-failures` |    No    | `false`                      | Annotate failed tests inline on the PR diff (creates a Check Run)                              |
| `check-name`        |    No    | `Test Results`               | Name of the Check Run created by `annotate-failures`                                           |

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

- [Jest](docs/guides/jest.md)
- [Vitest](docs/guides/vitest.md)
- [pytest](docs/guides/pytest.md)
- [JUnit 5 (Maven & Gradle)](docs/guides/junit.md)
- [Go](docs/guides/go.md)
- [.NET (xUnit / NUnit / MSTest)](docs/guides/dotnet.md)
- [RSpec](docs/guides/rspec.md)
- [PHPUnit](docs/guides/phpunit.md)
- [Playwright](docs/guides/playwright.md)

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

### With TestGlance Platform

1. Sign up at [testglance.dev](https://www.testglance.dev)
2. Create a project and connect your repository
3. Copy your project API key
4. Add it as a repository secret: `Settings > Secrets > TESTGLANCE_API_KEY`
5. Add the Action to your workflow (see [Quick Start](#with-testglance-platform))

## License

MIT
