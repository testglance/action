# .NET (xUnit / NUnit / MSTest)

Step-by-step guide to configure .NET tests with TestGlance for GitHub Actions.

## Prerequisites

- .NET project with xUnit, NUnit, or MSTest tests
- A GitHub Actions workflow that runs your tests

## Step 1: Install the JUnit Logger

```bash
dotnet add package JunitXml.TestLogger
```

This works with all three .NET test frameworks (xUnit, NUnit, MSTest).

## Step 2: Run Tests with JUnit Output

```bash
dotnet test --logger "junit;LogFilePath=test-results/dotnet.xml"
```

## Step 3: Add to GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Set up .NET
    uses: actions/setup-dotnet@v4
    with:
      dotnet-version: 8.0.x

  - name: Restore dependencies
    run: dotnet restore

  - name: Run tests
    run: dotnet test --logger "junit;LogFilePath=test-results/dotnet.xml"

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `test-results/dotnet.xml` — no `report-path` needed.

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
