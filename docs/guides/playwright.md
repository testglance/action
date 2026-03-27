# Playwright

Step-by-step guide to configure Playwright with TestGlance for GitHub Actions.

## Prerequisites

- Playwright already installed in your project
- A GitHub Actions workflow that runs your tests

## Step 1: Configure Report Output

Add the JUnit reporter to `playwright.config.ts` (built-in, no extra install):

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list'], ['junit', { outputFile: 'test-results/playwright.xml' }]],
});
```

## Step 2: Add to GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Install dependencies
    run: npm ci

  - name: Install Playwright browsers
    run: npx playwright install --with-deps

  - name: Run tests
    run: npx playwright test

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `test-results/playwright.xml` — no `report-path` needed.

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
