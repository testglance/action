# TestGlance Action

Track test suite health over time. Parse JUnit XML or CTRF JSON test reports from your CI and send results to [TestGlance](https://testglance.com).

## Usage

```yaml
- uses: testglance/action@v1
  with:
    report-path: test-results/junit.xml
    api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `report-path` | Yes | | Path to the test report file |
| `api-key` | Yes | | TestGlance project API key |
| `api-url` | No | `https://api.testglance.com` | TestGlance API URL |
| `report-format` | No | `auto` | Format: `junit`, `ctrf`, or `auto` (detect from extension) |

## Supported Formats

- **JUnit XML** (`.xml`) — Output from Jest, pytest, Go test, JUnit 5, RSpec, and most test frameworks
- **CTRF JSON** (`.json`) — Coming soon

## Non-Blocking

This Action never fails your CI pipeline. Parse or API errors are logged as warnings and the Action exits with code 0.

## Development

```bash
pnpm install
pnpm test
pnpm build
pnpm lint
```
