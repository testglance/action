# Permissions Reference

TestGlance requires no special permissions for core functionality. CI summaries, auto-detection, and report parsing work out of the box. Additional features require specific GitHub permissions and degrade gracefully when they are missing.

## Permissions Table

| Permission             | Feature                         | Behavior if Missing                      |
| ---------------------- | ------------------------------- | ---------------------------------------- |
| `contents: read`       | Baseline (checkout code)        | Required for all modes                   |
| `pull-requests: write` | PR comments                     | Skipped with warning log, CI stays green |
| `checks: write`        | Check Runs + inline annotations | Skipped with warning log, CI stays green |

Every feature gated on permissions follows the same pattern: if the permission is absent, TestGlance logs a `core.warning()` and continues. It never calls `core.setFailed()`. Your build stays green regardless of which permissions you grant.

## Minimum Standalone Permissions

For standalone mode (no PR comments, no Check Runs):

```yaml
permissions:
  contents: read
```

## Full Feature Permissions

For PR comments and inline failure annotations:

```yaml
permissions:
  contents: read
  pull-requests: write
  checks: write
```

## Important: GitHub Permission Model

When you add a `permissions` block to a job or workflow, GitHub removes **all** default permissions and grants only what you list. If your job checks out code (most do), you must include `contents: read` explicitly.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read # needed for actions/checkout
      pull-requests: write # needed for PR comments
      checks: write # needed for inline annotations
    steps:
      - uses: actions/checkout@v4
      -  # ... run tests ...
      - uses: testglance/action@v1
        with:
          github-token: ${{ github.token }}
          annotate-failures: true
```

---

Back to [README](../README.md)
