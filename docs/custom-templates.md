# Custom Report Templates

TestGlance ships with sensible defaults for the CI Job Summary and PR comment. When you need a different layout — to match team conventions, expose extra metadata, or strip sections — provide a [Handlebars](https://handlebarsjs.com/) template via either of two inputs:

- `summary-template` — replaces the default CI Job Summary body
- `comment-template` — replaces the default PR comment body (the per-job section, between markers)

Both templates receive the **same context object**, so you only need to learn it once.

## Quick start

```yaml
- uses: testglance/action@v1
  with:
    summary-template: .github/testglance/summary.hbs
    comment-template: .github/testglance/comment.hbs
```

Paths are resolved relative to `GITHUB_WORKSPACE` (your checked-out repo) when not absolute.

## Template context

```ts
interface TemplateContext {
  results: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
    passRate: string; // "98.5"
    duration: number; // seconds
  };
  failures: Array<{
    name: string;
    suite: string;
    errorMessage: string;
    stackTrace: string;
    duration: number;
  }>;
  slowest: Array<{ name: string; suite: string; duration: number }>;
  suites: Array<{
    name: string;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
    duration: number;
  }>;
  history?: Array<{
    sha: string;
    passRate: string;
    duration: number;
    timestamp: string;
  }>;
  delta?: {
    passRatePrev: number;
    passRateCurr: number;
    passRateDelta: number;
    durationPrev: number;
    durationCurr: number;
    durationDelta: number;
    durationDeltaPercent: number;
    testsAdded: Array<{ name: string; suite: string }>;
    testsRemoved: Array<{ name: string; suite: string }>;
    newlyFailing: Array<{ name: string; suite: string }>;
    newlyPassing: Array<{ name: string; suite: string }>;
    hasChanges: boolean;
  };
  flaky?: Array<{
    name: string;
    suite: string;
    flipCount: number;
    flakyRate: number;
  }>;
  trends?: TrendIndicators;
  perfRegression?: PerfRegressionResult;
  meta: {
    commitSha: string;
    branch: string;
    workflowRunUrl: string;
    timestamp: string; // ISO 8601
    jobName: string;
  };
}
```

Optional fields (`history`, `delta`, `flaky`, `trends`, `perfRegression`) only appear when the relevant data is available — for example, `delta` requires at least two history entries. Templates that reference missing fields render an empty string for those expressions; they do not crash.

## Available helpers

The following Handlebars helpers are pre-registered:

| Helper           | Signature                                   | Example                                              |
| ---------------- | ------------------------------------------- | ---------------------------------------------------- |
| `formatDuration` | `(seconds: number) => string`               | `{{formatDuration results.duration}}` → `12.3s`      |
| `truncate`       | `(str: string, maxLen: number) => string`   | `{{truncate failures.0.errorMessage 80}}`            |
| `escapeHtml`     | `(value: string) => string`                 | `{{escapeHtml suite.name}}`                          |
| `passRate`       | `(passed: number, total: number) => string` | `{{passRate results.passed results.total}}` → `97.2` |

Handlebars HTML-escapes interpolations by default (`{{ }}`). Use the triple-stash form (`{{{ }}}`) when you intentionally want raw markup.

## Example: minimal summary template

<!-- prettier-ignore -->
```handlebars
## Tests: {{results.passed}}/{{results.total}} ({{results.passRate}}%)

Duration: {{formatDuration results.duration}}
Branch: `{{meta.branch}}` · Commit: `{{meta.commitSha}}`

{{#if failures.length}}
### Failures

{{#each failures}}
- **{{name}}** in `{{suite}}` — {{truncate errorMessage 100}}
{{/each}}
{{/if}}

{{#if delta}}
Pass rate change: {{delta.passRateDelta}}%
{{/if}}
```

## Example: minimal comment template

<!-- prettier-ignore -->
```handlebars
### {{meta.jobName}}: {{passRate results.passed results.total}}% pass rate

{{results.passed}}/{{results.total}} passing in {{formatDuration results.duration}}

{{#if failures.length}}
**{{failures.length}} failing tests:**
{{#each failures}}
- `{{name}}` ({{suite}})
{{/each}}
{{/if}}

{{#if flaky.length}}
**Flaky tests:** {{flaky.length}}
{{/if}}
```

The PR comment body produced by `comment-template` is wrapped in TestGlance's per-job markers automatically (`<!-- tj:<jobName> --> ... <!-- /tj:<jobName> -->`), so multi-job repos still merge cleanly into a single PR comment.

## Error handling

TestGlance never breaks your CI. If your template:

- doesn't exist on disk,
- fails to parse, or
- throws at render time,

the Action logs a `core.warning` describing the problem and falls back to the default rendering for that surface. Other outputs (PR comments, HTML report, API submission, annotations) continue unaffected.

## Output size

When you take over rendering, you also take responsibility for output size. GitHub limits Job Summaries to ~1 MB and PR comments to 65,536 characters. If you iterate over `failures` or `slowest`, cap the loop yourself, e.g.:

```handlebars
{{#each failures}}
  {{#if @index_lt_25}}- `{{name}}`{{/if}}
{{/each}}
```

(`@index` is built in to Handlebars; for conditionals on it, register custom helpers in your own pre-build step or rely on slicing the data before rendering.)
