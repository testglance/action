# Go

Step-by-step guide to configure Go tests with TestGlance for GitHub Actions.

## Prerequisites

- Go project with tests
- A GitHub Actions workflow that runs your tests

## Step 1: Install gotestsum

Go's built-in `go test` doesn't output JUnit XML. Use `gotestsum` to convert:

```bash
go install gotest.tools/gotestsum@latest
```

## Step 2: Run Tests with JUnit Output

```bash
gotestsum --junitfile test-results/go-test.xml ./...
```

Alternative — pipe from `go test`:

```bash
go test -json ./... | gotestsum --raw-command --junitfile test-results/go-test.xml
```

## Step 3: Add to GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Set up Go
    uses: actions/setup-go@v5
    with:
      go-version-file: go.mod

  - name: Install gotestsum
    run: go install gotest.tools/gotestsum@latest

  - name: Run tests
    run: gotestsum --junitfile test-results/go-test.xml ./...

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `test-results/go-test.xml` — no `report-path` needed.

<details>
<summary>Standalone mode (no SaaS)</summary>

```yaml
- name: TestGlance
  if: always()
  uses: testglance/action@v1
  with:
    api-key: unused
    send-results: false
```

</details>
