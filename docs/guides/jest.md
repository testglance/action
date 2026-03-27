# Jest

Step-by-step guide to configure Jest with TestGlance for GitHub Actions.

## Prerequisites

- Jest already installed in your project
- A GitHub Actions workflow that runs your tests

## Step 1: Install the JUnit Reporter

```bash
npm install --save-dev jest-junit
```

## Step 2: Configure Report Output

Option A — environment variables (no config changes):

```bash
JEST_JUNIT_OUTPUT_DIR=test-results JEST_JUNIT_OUTPUT_NAME=junit.xml npx jest
```

Option B — `jest.config.js`:

```js
module.exports = {
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'test-results', outputName: 'junit.xml' }],
  ],
};
```

## Step 3: Add to GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Install dependencies
    run: npm ci

  - name: Run tests
    run: npx jest --reporters=default --reporters=jest-junit
    env:
      JEST_JUNIT_OUTPUT_DIR: test-results

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `test-results/junit.xml` — no `report-path` needed.

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
