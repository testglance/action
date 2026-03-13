# TestGlance

![Build](https://github.com/testglance/action/actions/workflows/ci.yml/badge.svg)

Track test suite health over time. Never breaks your CI.

## Quick Start

```yaml
- uses: testglance/action@v1
  with:
    report-path: test-results.xml
    api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

That's it. Two lines, zero permissions required.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `report-path` | Yes | | Path to the test report file |
| `api-key` | Yes | | TestGlance project API key |
| `api-url` | No | `https://www.testglance.dev` | TestGlance API URL |
| `report-format` | No | `auto` | Format: `junit`, `ctrf`, or `auto` (detect from extension) |

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

After each CI run, TestGlance adds a Job Summary with your test results:

```
## TestGlance Results

| Metric    | Value  |
|-----------|--------|
| Total     | 142    |
| Passed    | 138    |
| Failed    | 3      |
| Skipped   | 1      |
| Errored   | 0      |
| Pass Rate | 97.2%  |
| Duration  | 12.3s  |

Health Score: 94/100

### Failed Tests

| Suite        | Test                         | Error                         |
|--------------|------------------------------|-------------------------------|
| auth.login   | should reject expired token  | Expected 401 but received 200 |
| api.users    | should validate email format | Invalid email was accepted    |

View Dashboard
```

## Non-Blocking Guarantee

This Action **never fails your CI pipeline**. If anything goes wrong — file not found, parse error, API timeout — the Action logs a warning and exits with code 0. Your builds are safe.

- No `core.setFailed()` calls anywhere in the codebase
- No repository permissions required
- No `GITHUB_TOKEN` usage
- Only outbound HTTPS POST to the TestGlance API

## Getting Started

1. Sign up at [www.testglance.dev](https://www.testglance.dev)
2. Create a project and connect your repository
3. Copy your project API key
4. Add it as a repository secret: `Settings > Secrets > TESTGLANCE_API_KEY`
5. Add the Action to your workflow

## License

MIT
