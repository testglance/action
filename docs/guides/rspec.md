# RSpec

Step-by-step guide to configure RSpec with TestGlance for GitHub Actions.

## Prerequisites

- RSpec already installed in your project
- A GitHub Actions workflow that runs your tests

## Step 1: Install the JUnit Formatter

Add to your `Gemfile`:

```ruby
group :test do
  gem 'rspec_junit_formatter'
end
```

Then run `bundle install`.

## Step 2: Run Tests with JUnit Output

```bash
bundle exec rspec --format RspecJunitFormatter --out test-results/rspec.xml
```

Alternative — configure in `.rspec`:

```
--format RspecJunitFormatter
--out test-results/rspec.xml
```

## Step 3: Add to GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Set up Ruby
    uses: ruby/setup-ruby@v1
    with:
      bundler-cache: true

  - name: Run tests
    run: bundle exec rspec --format RspecJunitFormatter --out test-results/rspec.xml

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `test-results/rspec.xml` — no `report-path` needed.

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
