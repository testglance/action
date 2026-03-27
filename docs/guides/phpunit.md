# PHPUnit

Step-by-step guide to configure PHPUnit with TestGlance for GitHub Actions.

## Prerequisites

- PHPUnit already installed in your project
- A GitHub Actions workflow that runs your tests

## Step 1: Configure Report Output

No extra packages needed — JUnit XML output is built into PHPUnit:

```bash
phpunit --log-junit test-results/phpunit.xml
```

Alternative — configure in `phpunit.xml`:

```xml
<phpunit>
  <logging>
    <junit outputFile="test-results/phpunit.xml" />
  </logging>
</phpunit>
```

## Step 2: Add to GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Set up PHP
    uses: shivammathur/setup-php@v2
    with:
      php-version: 8.3

  - name: Install dependencies
    run: composer install

  - name: Run tests
    run: vendor/bin/phpunit --log-junit test-results/phpunit.xml

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `test-results/phpunit.xml` — no `report-path` needed.

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
