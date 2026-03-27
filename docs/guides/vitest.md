# Vitest

Step-by-step guide to configure Vitest with TestGlance for GitHub Actions.

## Prerequisites

- Vitest already installed in your project
- A GitHub Actions workflow that runs your tests

## Step 1: Configure Report Output

Add the JUnit reporter to `vitest.config.ts` (built-in, no extra install):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/vitest.xml',
    },
  },
});
```

## Step 2: Add to GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Install dependencies
    run: npm ci

  - name: Run tests
    run: npx vitest run

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `test-results/vitest.xml` — no `report-path` needed.

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
