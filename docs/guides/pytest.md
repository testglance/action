# pytest

Step-by-step guide to configure pytest with TestGlance for GitHub Actions.

## Prerequisites

- pytest already installed in your project
- A GitHub Actions workflow that runs your tests

## Step 1: Configure Report Output

No extra packages needed — JUnit XML output is built into pytest:

```bash
pytest --junitxml=test-results/pytest.xml
```

> **Note:** `pytest-cov` is for coverage reporting and is unrelated to test result output.

## Step 2: Add to GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Install dependencies
    run: pip install -r requirements.txt

  - name: Run tests
    run: pytest --junitxml=test-results/pytest.xml

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `test-results/pytest.xml` — no `report-path` needed.

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
